// 数据清洗（幂等）：把"以视频为主键"的原始记录收敛成"以餐厅为实体、视频为证据"的模型。
//
// 做三件事：
//   1. 合并重复餐厅：同一真实地址下名称相似的记录、以及同名同区的记录，合并成一家，
//      多个来源视频收拢进 sourceVideos[]，并派生 visitCount（UP 主到访次数，本身就是强推荐信号）。
//   2. 同址不同名（疑似不同店占用同一高德地址）不自动合并，但互相标注 addressSharedWith 提示人工核实。
//   3. 脏店名降级标注（不删除）：把"地名当店名"（乾务/伦教/东京都…）、"整句标题当店名"等
//      标为 nameQuality:"suspect" + needsNameReview:true，前端据此不上图、列表提示待核实。
//
// 幂等：对已清洗过的数据再次运行，结果不变（sourceVideos 已是数组则复用，合并后无同址同名可再并）。
//
// 用法：node scripts/clean-map-data.mjs

import { readFile, writeFile } from "node:fs/promises";

const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const upsPath = new URL("../data/ups.json", import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);

const PENDING_ADDRESS = "待确认";

// ---- 名称归一与相似判定 ----
function normName(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[·•・\s｜|,，。！!～~\-_/]/g, "")
    .replace(
      /美食馆|美食店|美食|饮食店|饮食|烧腊店|甜品店|糖水铺|餐厅|饭店|酒楼|菜馆|私厨|大排档|农家乐|食府|食肆|酒家|餐馆|海鲜城|茶餐厅|小馆子/g,
      "",
    );
}

function nameSimilar(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const setB = new Set(nb);
  const shared = [...new Set(na)].filter((char) => setB.has(char)).length;
  return shared >= Math.min(2, Math.min(na.length, nb.length));
}

// ---- 脏店名判定 ----
const placeNames = new Set([
  "乾务", "伦教", "盐步", "南海", "大良", "容桂", "勒流", "杏坛", "北滘", "陈村",
  "九江", "张槎", "石溪", "斗门", "顺德", "禅城", "东京都", "京都", "大阪", "和歌山",
  "上海", "昆山", "珠海", "中山", "东莞",
]);
const shopKeywords =
  /店|馆|楼|轩|居|记|家|苑|坊|厨|饭|食|餐|城|庄|阁|府|号|铺|档|堂|会|品|味|鸡|鹅|鱼|粥|面|粉|煲|茶|酒|烧|海鲜|码头|山庄|甜品|糖水|云吞|竹升|士多/;
const sentenceStart =
  /^(一个|一家|这家|这些天|今天|当地|带娃|连续|快一?年|找到了?|起初|刚下|刚来|每次|竟然|居然|终于|没想到)/;

function suspectReason(item) {
  const name = item.name ?? "";
  // 强规则：地名 / 城市名 / 句子特征 —— 即便已 geocoded 也判脏（多为标题解析残句）
  if (placeNames.has(name)) return "地名当店名";
  if (/(大阪|和歌山|东京都)/.test(name) && name.length <= 6) return "城市名当店名";
  if (sentenceStart.test(name)) return "整句标题当店名";
  // 弱规则：过长无店铺特征且非外文品牌 —— 已被高德匹配到真实 POI 的豁免
  if (name.length > 10 && !shopKeywords.test(name) && !/[A-Za-z]/.test(name)) {
    if (!(item.status === "geocoded" && item.geocode?.poiName)) return "疑似非店名";
  }
  return "";
}

// ---- 合并一簇记录 ----
function toVideoList(item) {
  if (Array.isArray(item.sourceVideos) && item.sourceVideos.length) return item.sourceVideos;
  return item.sourceVideo ? [item.sourceVideo] : [];
}

function mergeCluster(records) {
  const geocoded = records.filter((r) => r.status === "geocoded");
  const pool = geocoded.length ? geocoded : records;
  // 规范名：优先已核实记录中最短的（最短通常最接近正名，去掉冗余后缀/前缀）
  const canonicalName = pool.slice().sort((a, b) => a.name.length - b.name.length)[0].name;
  const primary = geocoded[0] ?? records[0];

  const videos = [];
  const seenUrl = new Set();
  for (const r of records) {
    for (const v of toVideoList(r)) {
      if (v?.url && !seenUrl.has(v.url)) {
        seenUrl.add(v.url);
        videos.push(v);
      }
    }
  }
  videos.sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));

  const dishes = [...new Set(records.flatMap((r) => r.signatureDishes ?? []))];

  const comments = [];
  const seenComment = new Set();
  for (const r of records) {
    for (const c of r.comments ?? []) {
      const key = `${c.author ?? ""}|${c.content ?? ""}`;
      if (!seenComment.has(key)) {
        seenComment.add(key);
        comments.push(c);
      }
    }
  }

  return {
    ...primary,
    name: canonicalName,
    signatureDishes: dishes,
    sourceVideos: videos,
    sourceVideo: videos[0] ?? primary.sourceVideo, // 向后兼容旧字段
    visitCount: videos.length,
    comments,
  };
}

function clusterByName(records) {
  const clusters = [];
  for (const record of records) {
    const hit = clusters.find((cluster) => cluster.some((x) => nameSimilar(x.name, record.name)));
    if (hit) hit.push(record);
    else clusters.push([record]);
  }
  return clusters;
}

// ---- 主流程 ----
const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const ups = JSON.parse(await readFile(upsPath, "utf8"));

const realAddrGroups = new Map();
const pseudoGroups = new Map();
for (const item of restaurants) {
  const addr = item.address ?? "";
  if (addr && !addr.includes(PENDING_ADDRESS)) {
    if (!realAddrGroups.has(addr)) realAddrGroups.set(addr, []);
    realAddrGroups.get(addr).push(item);
  } else {
    const key = `${item.name}|${item.city}|${item.district}`;
    if (!pseudoGroups.has(key)) pseudoGroups.set(key, []);
    pseudoGroups.get(key).push(item);
  }
}

const merged = [];
let sharedAddressGroups = 0;

for (const records of realAddrGroups.values()) {
  const clusters = clusterByName(records);
  const mergedInGroup = clusters.map(mergeCluster);
  if (mergedInGroup.length > 1) {
    // 同一真实地址下有多个互不相似的店名 —— 互标提示人工核实，不自动合并
    sharedAddressGroups += 1;
    for (const one of mergedInGroup) {
      one.addressSharedWith = mergedInGroup.filter((x) => x !== one).map((x) => x.name);
      one.needsAddressReview = true;
    }
  }
  merged.push(...mergedInGroup);
}

for (const records of pseudoGroups.values()) {
  merged.push(mergeCluster(records));
}

// 脏店名降级标注（不删除）
let suspectCount = 0;
const cleaned = merged.map((item) => {
  const reason = suspectReason(item);
  if (!reason) {
    // 幂等：清掉可能残留的旧标注
    const { nameQuality, needsNameReview, nameReviewReason, ...rest } = item;
    return rest;
  }
  suspectCount += 1;
  return { ...item, nameQuality: "suspect", needsNameReview: true, nameReviewReason: reason };
});

await writeFile(restaurantsPath, `${JSON.stringify(cleaned, null, 2)}\n`);
await writeFile(dataJsPath, `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants: cleaned }, null, 2)};\n`);

console.log("数据清洗完成");
console.log(`原始记录：${restaurants.length}`);
console.log(`合并后餐厅：${cleaned.length}（去重省下 ${restaurants.length - cleaned.length} 条）`);
console.log(`多来源餐厅（visitCount>1）：${cleaned.filter((r) => (r.visitCount ?? 1) > 1).length}`);
console.log(`同址不同名待核实组：${sharedAddressGroups}`);
console.log(`脏店名降级标注：${suspectCount}`);
