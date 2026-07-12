import { mkdir, readFile, writeFile } from "node:fs/promises";

const uid = process.argv[2] ?? "700270361";
const inputPath = new URL(`../work/bilibili-${uid}-videos.json`, import.meta.url);
const outputDir = new URL("../work/", import.meta.url);
const jsonPath = new URL(`restaurant-candidates-${uid}.json`, outputDir);
const csvPath = new URL(`restaurant-candidates-${uid}.csv`, outputDir);

const districtNames = [
  "越秀",
  "荔湾",
  "海珠",
  "天河",
  "白云",
  "黄埔",
  "番禺",
  "花都",
  "南沙",
  "从化",
  "增城",
  "禅城",
  "南海",
  "顺德",
  "三水",
  "高明",
];

const cityNames = [
  "广州",
  "佛山",
  "中山",
  "珠海",
  "深圳",
  "东莞",
  "江门",
  "惠州",
  "肇庆",
  "清远",
  "香港",
  "澳门",
  "上海",
  "昆山",
  "东京",
  "日本",
];

const foshanTownToDistrict = {
  大良: "顺德区",
  勒流: "顺德区",
  杏坛: "顺德区",
  容桂: "顺德区",
  北滘: "顺德区",
  陈村: "顺德区",
  九江: "南海区",
  张槎: "禅城区",
};

const guangzhouAreaToDistrict = {
  石溪: "海珠区",
  中山八: "荔湾区",
};

const areaToDistrict = {
  ...foshanTownToDistrict,
  ...guangzhouAreaToDistrict,
};

const nonRestaurantSignals = ["美食地图", "连续踩坑", "合集", "盘点", "攻略"];
const dishKeywords = [
  "炖汤",
  "石娃",
  "猪颈肉",
  "鱼生",
  "鱼汤",
  "豉油鸡",
  "檀香骨",
  "蟛蜞豆腐",
  "瓦缸鸡",
  "老火汤",
  "大和顺",
  "叉烧",
  "黄鳝饭",
  "五味鹅",
  "无骨鲫鱼",
  "蚬肉饭",
  "市师鸡",
  "卤水大肠",
  "台州海鲜面",
  "红烧带鱼",
  "小肠卷",
  "沙口笋",
  "姜汁焗腰子",
  "鲮鱼肠",
  "菜心",
];

function normalizeDistrict(text = "") {
  const clean = text.replace(/^\d{1,2}:\d{2}/, "").trim();
  const hit = districtNames.find((district) => clean.includes(district));
  if (hit) return `${hit}区`;
  return "";
}

function inferArea(text = "") {
  return Object.keys(areaToDistrict).find((area) => text.includes(area)) ?? "";
}

function inferCity(prefix = "", title = "") {
  const cleanPrefix = prefix.replace(/^\d{1,2}:\d{2}/, "").trim();
  if (cleanPrefix.includes("顺德") || cleanPrefix.includes("南海") || cleanPrefix.includes("禅城")) return "佛山";
  if (normalizeDistrict(cleanPrefix)) return "广州";
  const prefixCity = cityNames.find((city) => cleanPrefix.includes(city));
  if (prefixCity) return prefixCity;
  if (title.includes("佛山")) return "佛山";
  return "广州";
}

function cleanName(text = "") {
  return text
    .replace(/^NAV的广州美食地图/, "")
    .replace(/[。！？～~]+$/g, "")
    .trim();
}

function extractDishes(title) {
  return dishKeywords.filter((keyword) => title.includes(keyword));
}

function parseMultiRestaurant(video) {
  if (!video.title.includes("；") || !video.title.includes("-")) return [];
  return video.title
    .replace(/^.*?，/, "")
    .replace(/[。！]$/g, "")
    .split("；")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const pieces = part.split("-").map((item) => item.trim()).filter(Boolean);
      const city = pieces[0]?.includes("佛山") ? "佛山" : normalizeDistrict(pieces[0]) ? "广州" : inferCity(pieces[0], video.title);
      const area = pieces.length >= 3 ? pieces[1] : "";
      const name = cleanName(pieces.at(-1));
      return makeCandidate(video, {
        sequence: index + 1,
        city,
        district: normalizeDistrict(area) || areaToDistrict[area] || "",
        area,
        name,
        confidence: name ? 0.72 : 0.35,
        reason: "multi-restaurant-title",
      });
    });
}

function makeCandidate(video, parsed) {
  const missing = [];
  if (!parsed.name) missing.push("餐厅名");
  if (!parsed.district) missing.push("所在区");
  missing.push("详细地址", "经纬度");

  return {
    id: `${video.bv}-${parsed.sequence ?? 1}`,
    bv: video.bv,
    sourceTitle: video.title,
    sourceUrl: video.url,
    publishedAt: video.created || "",
    name: parsed.name || "",
    city: parsed.city || "",
    district: parsed.district || "",
    area: parsed.area || "",
    address: "",
    signatureDishes: extractDishes(video.title),
    pricePerPerson: null,
    environmentScore: null,
    confidence: parsed.confidence,
    needsReview: missing.length > 0 || parsed.confidence < 0.75,
    missingFields: missing,
    reason: parsed.reason,
  };
}

function parseVideo(video) {
  const title = video.title.trim();
  const multi = parseMultiRestaurant(video);
  if (multi.length) return multi;

  const labeled = title.match(/店名[:：]\s*([^；;，,。]+).*?地址[:：]\s*([^；;。]+)/);
  if (labeled) {
    return [
      makeCandidate(video, {
        city: inferCity("", title),
        district: video.district || normalizeDistrict(title),
        name: cleanName(labeled[1]),
        confidence: 0.74,
        reason: "labeled-name-address",
      }),
    ];
  }

  const separator = title.includes("｜") ? "｜" : title.includes("|") ? "|" : "";
  if (!separator) {
    return [
      makeCandidate(video, {
        city: inferCity("", title),
        district: video.district || normalizeDistrict(title),
        name: "",
        confidence: 0.2,
        reason: "no-title-separator",
      }),
    ];
  }

  const parts = title.split(separator).map((part) => part.trim()).filter(Boolean);
  const [prefix, secondPart = "", ...tailParts] = parts;
  const city = inferCity(prefix, title);
  const prefixDistrict = normalizeDistrict(prefix) || video.district || "";
  const secondLooksLikeArea = Boolean(tailParts.length && (areaToDistrict[secondPart] || normalizeDistrict(secondPart) || cityNames.includes(city)));
  const rest = (secondLooksLikeArea && tailParts.length ? tailParts.join(separator) : [secondPart, ...tailParts].join(separator)).trim();
  const fragments = rest.split(/[，,。！!]/).map((part) => part.trim()).filter(Boolean);
  const first = fragments[0] ?? "";
  const second = fragments[1] ?? "";
  const contextualArea = inferArea(title);
  const firstLooksLikeArea = Boolean(areaToDistrict[first]);
  const area = secondLooksLikeArea ? secondPart : firstLooksLikeArea ? first : contextualArea;
  const firstLooksDescriptive = /^(这些天|今天|当地|带娃|连续|宝藏|一家|这家|刚下|刚来|每次)/.test(first);
  const name = cleanName(secondLooksLikeArea && firstLooksDescriptive ? secondPart : firstLooksLikeArea && second ? second : first);
  const district = prefixDistrict || normalizeDistrict(area) || areaToDistrict[area] || "";
  const isCollection = nonRestaurantSignals.some((signal) => title.includes(signal));

  return [
    makeCandidate(video, {
      city,
      district,
      area,
      name: isCollection ? "" : name,
      confidence: isCollection ? 0.25 : name && district ? 0.82 : name ? 0.62 : 0.25,
      reason: isCollection ? "collection-or-summary" : "standard-title",
    }),
  ];
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const videos = JSON.parse(await readFile(inputPath, "utf8"));
const candidates = videos.flatMap(parseVideo);

await mkdir(outputDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(candidates, null, 2)}\n`);

const headers = [
  "name",
  "city",
  "district",
  "area",
  "address",
  "signatureDishes",
  "confidence",
  "needsReview",
  "missingFields",
  "publishedAt",
  "sourceUrl",
  "sourceTitle",
];
const csv = [
  headers.join(","),
  ...candidates.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
].join("\n");
await writeFile(csvPath, `${csv}\n`);

console.log(`视频数：${videos.length}`);
console.log(`候选餐厅：${candidates.length}`);
console.log(`高置信度：${candidates.filter((item) => item.confidence >= 0.75).length}`);
console.log(`需确认：${candidates.filter((item) => item.needsReview).length}`);
console.log(`JSON：${jsonPath.pathname}`);
console.log(`CSV：${csvPath.pathname}`);
