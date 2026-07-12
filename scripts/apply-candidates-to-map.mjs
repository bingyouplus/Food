import { mkdir, readFile, writeFile } from "node:fs/promises";

const uid = process.argv[2] ?? "700270361";
const inputPath = new URL(`../work/restaurant-candidates-${uid}.json`, import.meta.url);
const reviewJsonPath = new URL(`../work/review-needed-${uid}.json`, import.meta.url);
const reviewCsvPath = new URL(`../work/review-needed-${uid}.csv`, import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);
const restaurantsJsonPath = new URL("../data/restaurants.json", import.meta.url);
const upId = "bilibili-700270361";

const cityCenters = {
  广州: [113.28, 23.08],
  佛山: [113.12, 23.02],
  中山: [113.39, 22.52],
  珠海: [113.57, 22.27],
  深圳: [114.06, 22.54],
  东莞: [113.75, 23.04],
  江门: [113.08, 22.58],
  惠州: [114.42, 23.11],
  肇庆: [112.47, 23.05],
  清远: [113.05, 23.68],
  香港: [114.17, 22.32],
  澳门: [113.55, 22.2],
  上海: [121.47, 31.23],
  昆山: [120.98, 31.38],
  东京: [139.76, 35.68],
  日本: [139.76, 35.68],
};

const districtCenters = {
  天河区: [113.361, 23.124],
  越秀区: [113.267, 23.129],
  荔湾区: [113.244, 23.125],
  海珠区: [113.318, 23.084],
  白云区: [113.273, 23.157],
  番禺区: [113.384, 22.937],
  增城区: [113.811, 23.261],
  顺德区: [113.293, 22.805],
  南海区: [113.143, 23.028],
  禅城区: [113.122, 23.009],
  中山: cityCenters.中山,
  珠海: cityCenters.珠海,
  深圳: cityCenters.深圳,
  东莞: cityCenters.东莞,
  江门: cityCenters.江门,
  惠州: cityCenters.惠州,
  肇庆: cityCenters.肇庆,
  清远: cityCenters.清远,
  香港: cityCenters.香港,
  澳门: cityCenters.澳门,
  上海: cityCenters.上海,
  昆山: cityCenters.昆山,
  东京: cityCenters.东京,
  日本: cityCenters.日本,
};

const areaOffsets = {
  勒流: [-0.03, -0.02],
  大良: [0.0, -0.02],
  杏坛: [-0.08, -0.05],
  容桂: [0.02, -0.08],
  北滘: [0.05, 0.07],
  陈村: [0.08, 0.08],
  九江: [-0.12, -0.04],
  张槎: [-0.03, 0.02],
  石溪: [-0.02, -0.02],
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pseudoPoint(candidate, index) {
  const center = districtCenters[candidate.district] ?? cityCenters[candidate.city] ?? [113.28, 23.08];
  const areaOffset = areaOffsets[candidate.area] ?? [0, 0];
  const ring = index % 8;
  const jitterLng = (Math.cos((ring / 8) * Math.PI * 2) * 0.018) + areaOffset[0];
  const jitterLat = (Math.sin((ring / 8) * Math.PI * 2) * 0.014) + areaOffset[1];
  return {
    lng: Number((center[0] + jitterLng).toFixed(6)),
    lat: Number((center[1] + jitterLat).toFixed(6)),
  };
}

function isMappable(candidate) {
  return (
    candidate.name &&
    candidate.city &&
    candidate.reason !== "collection-or-summary"
  );
}

function cityPrefix(city) {
  const prefixes = {
    广州: "gz",
    佛山: "fs",
    中山: "zs",
    珠海: "zh",
    深圳: "sz",
    东莞: "dg",
    江门: "jm",
    惠州: "hz",
    肇庆: "zq",
    清远: "qy",
    香港: "hk",
    澳门: "mo",
    上海: "sh",
    昆山: "ks",
    东京: "tokyo",
    日本: "jp",
  };
  return prefixes[city] ?? "other";
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const candidates = JSON.parse(await readFile(inputPath, "utf8"));
const mappable = candidates.filter(isMappable);
const review = candidates.filter((candidate) => !isMappable(candidate) || candidate.needsReview);

const restaurants = mappable.map((candidate, index) => {
  const point = pseudoPoint(candidate, index);
  const area = candidate.area ? `${candidate.area}，` : "";
  return {
    id: `${cityPrefix(candidate.city)}-${slugify(candidate.name)}-${candidate.bv}`,
    upId,
    name: candidate.name,
    city: candidate.city,
    district: candidate.district || candidate.city,
    address: `${candidate.city}${candidate.district || ""}${area}${candidate.name}（待确认）`,
    lng: point.lng,
    lat: point.lat,
    signatureDishes: candidate.signatureDishes,
    pricePerPerson: null,
    environmentScore: null,
    sourceVideo: {
      title: candidate.sourceTitle,
      url: candidate.sourceUrl,
      publishedAt: candidate.publishedAt || "",
    },
    comments: [
      {
        author: "系统标记",
        content: "坐标为区/镇街附近临时点位，需确认详细地址后再精确定位。",
        likes: 0,
      },
    ],
    status: "needs_geocode",
    confidence: candidate.confidence,
    missingFields: candidate.missingFields,
  };
});

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

const dataJs = `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants }, null, 2)};\n`;
await writeFile(dataJsPath, dataJs);
await writeFile(restaurantsJsonPath, `${JSON.stringify(restaurants, null, 2)}\n`);

await mkdir(new URL("../work/", import.meta.url), { recursive: true });
await writeFile(reviewJsonPath, `${JSON.stringify(review, null, 2)}\n`);

const headers = [
  "name",
  "city",
  "district",
  "area",
  "confidence",
  "missingFields",
  "reason",
  "sourceUrl",
  "sourceTitle",
];
const csv = [
  headers.join(","),
  ...review.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
].join("\n");
await writeFile(reviewCsvPath, `${csv}\n`);

console.log(`候选总数：${candidates.length}`);
console.log(`入图餐厅：${restaurants.length}`);
console.log(`待确认记录：${review.length}`);
console.log(`网页数据：${dataJsPath.pathname}`);
console.log(`待确认 JSON：${reviewJsonPath.pathname}`);
console.log(`待确认 CSV：${reviewCsvPath.pathname}`);
