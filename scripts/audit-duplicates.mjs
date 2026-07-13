import { mkdir, readFile, writeFile } from "node:fs/promises";

const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const workDir = new URL("../work/", import.meta.url);
const jsonPath = new URL("duplicate-audit.json", workDir);
const csvPath = new URL("duplicate-audit.csv", workDir);

const confirmedDistinctPairs = new Set([
  ["gz-多福美食馆-BV1pZC4YcEYa", "gz-汶记美食店-BV1pA4m1F7Bw"].sort().join("|||"),
]);

function pairKey(a, b) {
  return [a.id, b.id].sort().join("|||");
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeName(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s·•｜|,，。！!～~\-_/“”"']/g, "")
    .replace(/餐厅|饭店|酒楼|菜馆|私厨|大排档|农家乐|食府|食肆|档口|小馆子|茶点|粤菜|云吞面|煲仔饭/g, "")
    .replace(/分店|总店|老店|新店|旗舰店|直营店/g, "");
}

function normalizeAddress(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s,，。！!～~\-_/“”"']/g, "")
    .replace(/广东省|广州市|佛山市|珠海市|上海市|日本/g, "")
    .replace(/待确认/g, "");
}

function distanceMeters(a, b) {
  if (typeof a.lng !== "number" || typeof a.lat !== "number" || typeof b.lng !== "number" || typeof b.lat !== "number") {
    return Infinity;
  }
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

function sourceCount(item) {
  return item.sourceVideos?.length ?? 1;
}

function sourceSummary(item) {
  const videos = item.sourceVideos?.length ? item.sourceVideos : [item.sourceVideo];
  return videos.map((video) => `${video.publishedAt || ""} ${video.title || ""}`).join(" || ");
}

function pairReason(a, b) {
  const sameName = a.name === b.name;
  const normNameA = normalizeName(a.name);
  const normNameB = normalizeName(b.name);
  const sameNormName = normNameA && normNameA === normNameB;
  const addressA = normalizeAddress(a.address);
  const addressB = normalizeAddress(b.address);
  const sameAddress = addressA && addressA === addressB;
  const addressContains = addressA && addressB && (addressA.includes(addressB) || addressB.includes(addressA));
  const samePoi = a.geocode?.poiName && b.geocode?.poiName && normalizeName(a.geocode.poiName) === normalizeName(b.geocode.poiName);
  const distance = distanceMeters(a, b);
  const close = distance <= 80;
  const sameDistrict = a.city === b.city && a.district === b.district;

  if (sameName && (sameAddress || samePoi || close)) return { level: "auto-merge-candidate", reason: "同名，且地址/POI/坐标高度一致", distance };
  if (sameNormName && (sameAddress || samePoi || close)) return { level: "auto-merge-candidate", reason: "标准化店名一致，且地址/POI/坐标高度一致", distance };
  if (samePoi && sameDistrict) return { level: "review", reason: "高德 POI 一致，但店名或地址写法不同", distance };
  if ((sameName || sameNormName) && sameDistrict) return { level: "review", reason: "同名或近似同名，但地址/坐标不同，可能是分店或重复", distance };
  if (addressContains && sameDistrict && (sameName || sameNormName || close)) return { level: "review", reason: "地址包含关系，且店名/坐标接近", distance };
  return null;
}

function buildGroups(pairs) {
  const parent = new Map();
  const find = (id) => {
    parent.set(id, parent.get(id) ?? id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const pair of pairs) union(pair.a.id, pair.b.id);
  const groups = new Map();
  for (const pair of pairs) {
    for (const item of [pair.a, pair.b]) {
      const root = find(item.id);
      if (!groups.has(root)) groups.set(root, new Map());
      groups.get(root).set(item.id, item);
    }
  }
  return [...groups.values()].map((group) => [...group.values()]);
}

const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const pairs = [];

for (let i = 0; i < restaurants.length; i += 1) {
  for (let j = i + 1; j < restaurants.length; j += 1) {
    const a = restaurants[i];
    const b = restaurants[j];
    if (confirmedDistinctPairs.has(pairKey(a, b))) continue;
    const reason = pairReason(a, b);
    if (reason) pairs.push({ a, b, ...reason });
  }
}

const autoPairs = pairs.filter((pair) => pair.level === "auto-merge-candidate");
const reviewPairs = pairs.filter((pair) => pair.level === "review");
const groups = buildGroups(pairs).map((items) => ({
  level: items.some((item) => autoPairs.some((pair) => pair.a.id === item.id || pair.b.id === item.id)) ? "auto-merge-candidate" : "review",
  items: items.map((item) => ({
    id: item.id,
    name: item.name,
    city: item.city,
    district: item.district,
    address: item.address,
    status: item.status,
    poiName: item.geocode?.poiName ?? "",
    sourceCount: sourceCount(item),
    sourceSummary: sourceSummary(item),
  })),
}));

const report = {
  totalRestaurants: restaurants.length,
  pairCount: pairs.length,
  autoPairCount: autoPairs.length,
  reviewPairCount: reviewPairs.length,
  groupCount: groups.length,
  groups,
};

const headers = ["level", "reason", "distanceMeters", "aName", "aAddress", "aPoi", "aSources", "bName", "bAddress", "bPoi", "bSources"];
const rows = pairs.map((pair) => ({
  level: pair.level,
  reason: pair.reason,
  distanceMeters: Number.isFinite(pair.distance) ? Math.round(pair.distance) : "",
  aName: pair.a.name,
  aAddress: pair.a.address,
  aPoi: pair.a.geocode?.poiName ?? "",
  aSources: sourceSummary(pair.a),
  bName: pair.b.name,
  bAddress: pair.b.address,
  bPoi: pair.b.geocode?.poiName ?? "",
  bSources: sourceSummary(pair.b),
}));

await mkdir(workDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(csvPath, `${[headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n")}\n`);

console.log("重复餐厅审计完成");
console.log(`餐厅总数：${restaurants.length}`);
console.log(`疑似重复关系：${pairs.length}`);
console.log(`可自动合并候选：${autoPairs.length}`);
console.log(`需人工确认关系：${reviewPairs.length}`);
console.log(`疑似重复组：${groups.length}`);
console.log(`JSON：${jsonPath.pathname}`);
console.log(`CSV：${csvPath.pathname}`);
