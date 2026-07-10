import { mkdir, readFile, writeFile } from "node:fs/promises";
import { requestBilibili } from "./bilibili-utils.mjs";

const uid = process.argv[2] ?? "700270361";
const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);
const upsPath = new URL("../data/ups.json", import.meta.url);
const videosPath = new URL(`../work/bilibili-${uid}-videos.json`, import.meta.url);
const outputDir = new URL("../work/", import.meta.url);
const resultPath = new URL(`comment-review-${uid}.json`, outputDir);
const reviewPath = new URL(`comment-review-${uid}.csv`, outputDir);
const delayMs = Number(process.env.BILIBILI_COMMENT_DELAY_MS ?? 9000);
const maxPages = Number(process.env.BILIBILI_COMMENT_PAGES ?? 3);
const maxCommentsPerRestaurant = Number(process.env.BILIBILI_COMMENT_LIMIT ?? 8);

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function bvFromUrl(url = "") {
  return url.match(/BV[a-zA-Z0-9]+/)?.[0] ?? "";
}

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[·\s｜|,，。！!～~\-_/]/g, "")
    .replace(/餐厅|饭店|酒楼|菜馆|私厨|大排档|农家乐|食府|食肆|档口|小馆子/g, "");
}

function analyzeComment(restaurant, comment) {
  const message = comment.content;
  const compact = normalize(message);
  const name = normalize(restaurant.name);
  let score = 0;
  let locationScore = 0;
  let identityScore = 0;
  let menuScore = 0;

  if (/地址|位置|坐标|定位|导航|在哪里|在哪|求店|求地址/.test(message)) locationScore += 36;
  if (/路|街|巷|号|铺|层|楼|旁|附近|对面|门口|市场|村|城|广场|公园|地铁|公交|停车场|幼儿园/.test(message)) {
    locationScore += 24;
  }
  if (/番禺|顺德|越秀|白云|禅城|荔湾|海珠|天河|南海|广州|佛山/.test(message)) locationScore += 14;
  if (restaurant.district && message.includes(restaurant.district.replace(/区$/, ""))) locationScore += 18;
  if (/店名|全名|分店|哪家/.test(message)) identityScore += 26;
  if (/¥|￥|\d+\s*元|\d+\s*块|\d+，|分；|鸡|鱼|饭|汤|菜|粉|面|粥|煲|鹅|牛|笋|酒/.test(message)) menuScore += 18;

  const sharedNameChars = [...new Set(name)].filter((char) => compact.includes(char)).length;
  if (name && compact.includes(name)) identityScore += 34;
  else if (sharedNameChars >= Math.min(3, name.length)) identityScore += 16;

  score = locationScore + identityScore + menuScore;
  if (/up|UP|作者|老板|店主|回复|置顶|评论区/.test(message)) score += 8;
  if (comment.isUploader) score += 28;
  if (comment.likes >= 10) score += 8;
  if (comment.likes >= 50) score += 8;
  if (message.length < 6) score -= 16;
  if (/哈哈|好吃|想吃|看饿|收藏|打卡|流口水|第一|沙发/.test(message) && score < 44) score -= 18;

  const evidenceType =
    locationScore >= 38 ? "位置线索" : identityScore >= 34 ? "店名线索" : menuScore >= 18 ? "菜品/价格线索" : "弱线索";

  return { score, locationScore, identityScore, menuScore, evidenceType };
}

function flattenReplies(replies = [], parent = null) {
  const rows = [];
  for (const reply of replies) {
    const row = {
      rpid: reply.rpid,
      author: reply.member?.uname ?? "B站用户",
      mid: String(reply.member?.mid ?? ""),
      content: reply.content?.message?.trim() ?? "",
      likes: Number(reply.like ?? 0),
      createdAt: reply.ctime ? new Date(reply.ctime * 1000).toISOString().slice(0, 10) : "",
      parentAuthor: parent?.author ?? "",
      isUploader: false,
    };
    rows.push(row);
    if (reply.replies?.length) rows.push(...flattenReplies(reply.replies, row));
  }
  return rows;
}

async function fetchCommentPage(aid, pageNumber) {
  const url = new URL("https://api.bilibili.com/x/v2/reply");
  url.searchParams.set("type", "1");
  url.searchParams.set("oid", aid);
  url.searchParams.set("sort", "1");
  url.searchParams.set("pn", pageNumber);
  url.searchParams.set("ps", "20");

  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const current = await requestBilibili(url.toString(), uid);
      if (current.json?.code === 0) return current.json.data ?? {};
      lastError = current.text.slice(0, 180);
    } catch (error) {
      lastError = error.message;
    }
    const backoff = delayMs * attempt + Math.round(Math.random() * 1600);
    console.log(`评论第 ${pageNumber} 页第 ${attempt} 次失败，${backoff}ms 后重试`);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  throw new Error(`评论第 ${pageNumber} 页失败：${lastError}`);
}

async function collectComments(aid) {
  const all = [];
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await fetchCommentPage(aid, pageNumber);
    all.push(...flattenReplies(page.replies ?? []));
    if (!page.replies?.length || page.cursor?.is_end) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs + Math.round(Math.random() * 1200)));
  }
  return all.map((comment) => ({
    ...comment,
    isUploader: comment.mid === String(uid),
  }));
}

function mergeCommentEvidence(restaurant, evidence) {
  const systemComments = (restaurant.comments ?? []).filter((comment) => comment.author !== "评论线索");
  const evidenceComments = evidence.slice(0, 5).map((item) => ({
    author: item.isUploader ? "UP主评论线索" : "评论线索",
    content: item.content,
    likes: item.likes,
  }));
  return {
    ...restaurant,
    comments: [...systemComments, ...evidenceComments],
    commentReview: {
      status: evidence.length ? "has_evidence" : "no_useful_comment",
      usefulCount: evidence.length,
      locationCount: evidence.filter((item) => item.locationScore >= 38).length,
      checkedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const videos = JSON.parse(await readFile(videosPath, "utf8"));
const ups = JSON.parse(await readFile(upsPath, "utf8"));
const videoByBv = new Map(videos.map((video) => [video.bv, video]));
const targets = restaurants.filter((restaurant) => restaurant.status !== "geocoded");
const results = [];
const updatedById = new Map();

console.log(`待评论核实：${targets.length} 家`);

for (const [index, restaurant] of targets.entries()) {
  const bv = bvFromUrl(restaurant.sourceVideo?.url);
  const video = videoByBv.get(bv);
  if (!video?.aid) {
    results.push({
      id: restaurant.id,
      name: restaurant.name,
      district: restaurant.district,
      bv,
      error: "未找到 aid，无法读取评论",
      evidence: [],
    });
    continue;
  }

  console.log(`核实评论 ${index + 1}/${targets.length}: ${restaurant.district} ${restaurant.name} ${bv}`);
  try {
    const comments = await collectComments(video.aid);
    const evidence = comments
      .map((comment) => ({ ...comment, ...analyzeComment(restaurant, comment) }))
      .filter((comment) => comment.score >= 34)
      .sort((a, b) => b.score - a.score || b.likes - a.likes)
      .slice(0, maxCommentsPerRestaurant);

    results.push({
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      district: restaurant.district,
      bv,
      sourceUrl: restaurant.sourceVideo?.url ?? "",
      evidence,
    });
    updatedById.set(restaurant.id, mergeCommentEvidence(restaurant, evidence));
  } catch (error) {
    results.push({
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      district: restaurant.district,
      bv,
      sourceUrl: restaurant.sourceVideo?.url ?? "",
      error: error.message,
      evidence: [],
    });
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs + Math.round(Math.random() * 1600)));
}

const updated = restaurants.map((restaurant) => updatedById.get(restaurant.id) ?? restaurant);
await mkdir(outputDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
await writeFile(restaurantsPath, `${JSON.stringify(updated, null, 2)}\n`);
await writeFile(dataJsPath, `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants: updated }, null, 2)};\n`);

const headers = ["name", "district", "bv", "type", "score", "locationScore", "author", "likes", "content", "sourceUrl", "error"];
const rows = results.flatMap((result) => {
  if (!result.evidence.length) {
    return [
      [
        result.name,
        result.district,
        result.bv,
        "",
        "",
        "",
        "",
        "",
        "",
        result.sourceUrl,
        result.error ?? "未筛到有效评论线索",
      ],
    ];
  }
  return result.evidence.map((item) => [
    result.name,
    result.district,
    result.bv,
    item.evidenceType,
    item.score,
    item.locationScore,
    item.author,
    item.likes,
    item.content,
    result.sourceUrl,
    result.error ?? "",
  ]);
});
const csv = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
await writeFile(reviewPath, `${csv}\n`);

const withEvidence = results.filter((result) => result.evidence.length).length;
const withLocationEvidence = results.filter((result) =>
  result.evidence.some((item) => item.locationScore >= 38),
).length;
const failed = results.filter((result) => result.error).length;
console.log("\n评论核实完成");
console.log(`待核实餐厅：${targets.length}`);
console.log(`筛到评论线索：${withEvidence}`);
console.log(`其中含位置线索：${withLocationEvidence}`);
console.log(`接口失败：${failed}`);
console.log(`仍需人工确认地址：${targets.length - withLocationEvidence}`);
console.log(`结果 JSON：${resultPath.pathname}`);
console.log(`核对 CSV：${reviewPath.pathname}`);
