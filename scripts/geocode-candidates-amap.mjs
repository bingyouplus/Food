import { mkdir, readFile, writeFile } from "node:fs/promises";

const key = process.env.AMAP_WEB_SERVICE_KEY;
const uid = process.argv[2] ?? "700270361";
const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);
const outputDir = new URL("../work/", import.meta.url);
const resultPath = new URL(`amap-geocode-results-${uid}.json`, outputDir);
const reviewPath = new URL(`amap-geocode-review-${uid}.csv`, outputDir);
const upId = "bilibili-700270361";

if (!key) {
  console.error("缺少 AMAP_WEB_SERVICE_KEY。运行示例：AMAP_WEB_SERVICE_KEY='你的高德Key' npm run geocode:candidates -- 700270361");
  process.exit(1);
}

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[·\s｜|,，。！!～~\-_/•]/g, "")
    .replace(/[未味]/g, "味")
    .replace(/[鷄雞]/g, "鸡")
    .replace(/[嶸榕嵘]/g, "荣")
    .replace(/[臺台]/g, "台")
    .replace(/餐厅|饭店|酒楼|菜馆|私厨|大排档|农家乐|食府|食肆|酒家|餐馆|海鲜城/g, "");
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function parseLocation(location = "") {
  const [lng, lat] = location.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function isFoodPoi(poi) {
  return [poi.type, poi.typecode, poi.biz_type].filter(Boolean).join(" ").includes("餐饮") || /^05/.test(poi.typecode ?? "");
}

function scorePoi(restaurant, poi) {
  let score = 0;
  const rn = normalize(restaurant.name);
  const pn = normalize(poi.name);
  const address = [poi.pname, poi.cityname, poi.adname, poi.address, poi.name].filter(Boolean).join("");

  if (pn === rn) score += 52;
  else if (pn.includes(rn) || rn.includes(pn)) score += 38;
  else if ([...rn].filter((char) => pn.includes(char)).length >= Math.min(3, rn.length)) score += 18;

  if (poi.cityname?.includes(restaurant.city)) score += 18;
  if (poi.adname && restaurant.district && poi.adname.includes(restaurant.district.replace(/区$/, ""))) score += 26;
  if (restaurant.area && address.includes(restaurant.area)) score += 16;
  if (isFoodPoi(poi)) score += 14;

  if (poi.cityname && restaurant.city && !poi.cityname.includes(restaurant.city)) score -= 45;
  if (poi.adname && restaurant.district && !poi.adname.includes(restaurant.district.replace(/区$/, ""))) score -= 18;
  if (!parseLocation(poi.location)) score -= 50;

  return score;
}

function similarity(left = "", right = "") {
  const a = [...new Set(normalize(left))];
  const b = new Set(normalize(right));
  if (!a.length || !b.size) return 0;
  return a.filter((char) => b.has(char)).length / Math.max(a.length, b.size);
}

async function searchAmap(restaurant, city) {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.searchParams.set("key", key);
  url.searchParams.set("keywords", restaurant.name);
  url.searchParams.set("types", "050000");
  url.searchParams.set("city", city);
  url.searchParams.set("citylimit", "true");
  url.searchParams.set("children", "1");
  url.searchParams.set("offset", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("extensions", "all");

  const response = await fetch(url);
  const json = await response.json();
  if (json.status !== "1") {
    throw new Error(`${restaurant.name} 高德搜索失败：${json.info ?? response.status}`);
  }
  return json.pois ?? [];
}

async function locateRestaurant(restaurant) {
  const cities = [...new Set([restaurant.district, restaurant.city].filter(Boolean))];
  const allPois = [];

  for (const city of cities) {
    const pois = await searchAmap(restaurant, city);
    allPois.push(...pois);
    if (pois.length) break;
  }

  const ranked = allPois
    .map((poi) => ({ poi, score: scorePoi(restaurant, poi) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const location = best ? parseLocation(best.poi.location) : null;
  const autoConfirmed =
    Boolean(best && location) &&
    (best.score >= 86 ||
      (best.score >= 76 && (!second || best.score - second.score >= 16)) ||
      (best.score >= 58 &&
        best.poi.adname &&
        restaurant.district &&
        best.poi.adname.includes(restaurant.district.replace(/区$/, "")) &&
        similarity(restaurant.name, best.poi.name) >= 0.62));

  return {
    id: restaurant.id,
    name: restaurant.name,
    city: restaurant.city,
    district: restaurant.district,
    area: restaurant.address.match(/区(.+?)，/)?.[1] ?? "",
    autoConfirmed,
    bestScore: best?.score ?? 0,
    best: best
      ? {
          name: best.poi.name,
          address: best.poi.address,
          pname: best.poi.pname,
          cityname: best.poi.cityname,
          adname: best.poi.adname,
          type: best.poi.type,
          location: best.poi.location,
        }
      : null,
    alternatives: ranked.slice(0, 5).map(({ poi, score }) => ({
      score,
      name: poi.name,
      address: poi.address,
      cityname: poi.cityname,
      adname: poi.adname,
      type: poi.type,
      location: poi.location,
    })),
  };
}

function applyResult(restaurant, result) {
  if (!result.autoConfirmed || !result.best) return restaurant;
  const location = parseLocation(result.best.location);
  return {
    ...restaurant,
    address: [result.best.cityname, result.best.adname, result.best.address]
      .filter(Boolean)
      .join("")
      .replaceAll("[]", ""),
    lng: location.lng,
    lat: location.lat,
    status: "geocoded",
    geocode: {
      provider: "amap",
      confidence: result.bestScore,
      poiName: result.best.name,
      poiType: result.best.type,
    },
    comments: [
      {
        author: "高德核实",
        content: `已按高德 POI 自动匹配：${result.best.name}`,
        likes: 0,
      },
    ],
    missingFields: restaurant.missingFields.filter((field) => !["详细地址", "经纬度"].includes(field)),
  };
}

const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const results = [];
const updated = [];

for (const [index, restaurant] of restaurants.entries()) {
  console.log(`核实 ${index + 1}/${restaurants.length}: ${restaurant.city}${restaurant.district} ${restaurant.name}`);
  const result = await locateRestaurant(restaurant);
  results.push(result);
  updated.push(applyResult(restaurant, result));
  await new Promise((resolve) => setTimeout(resolve, 450));
}

const ups = [
  {
    id: upId,
    platform: "bilibili",
    uid,
    name: "NAV看广州",
    spaceUrl: `https://space.bilibili.com/${uid}`,
    avatar: "",
    accent: "#49b8a6",
    active: true,
  },
];

await mkdir(outputDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
await writeFile(restaurantsPath, `${JSON.stringify(updated, null, 2)}\n`);
await writeFile(dataJsPath, `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants: updated }, null, 2)};\n`);

const reviewRows = results.filter((result) => !result.autoConfirmed);
const headers = [
  "name",
  "city",
  "district",
  "bestScore",
  "bestName",
  "bestAddress",
  "bestDistrict",
  "bestType",
  "alternatives",
];
const csv = [
  headers.join(","),
  ...reviewRows.map((row) =>
    [
      row.name,
      row.city,
      row.district,
      row.bestScore,
      row.best?.name ?? "",
      row.best?.address ?? "",
      row.best?.adname ?? "",
      row.best?.type ?? "",
      row.alternatives.map((item) => `${item.score}:${item.name}:${item.adname}:${item.address}`).join(" | "),
    ]
      .map(csvEscape)
      .join(","),
  ),
].join("\n");
await writeFile(reviewPath, `${csv}\n`);

const confirmedCount = results.filter((result) => result.autoConfirmed).length;
console.log("\n高德核实完成");
console.log(`总数：${results.length}`);
console.log(`自动确认：${confirmedCount}`);
console.log(`需要核对：${reviewRows.length}`);
console.log(`结果 JSON：${resultPath.pathname}`);
console.log(`核对 CSV：${reviewPath.pathname}`);
