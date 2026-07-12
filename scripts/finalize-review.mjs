import { mkdir, readFile, writeFile } from "node:fs/promises";

const uid = process.argv[2] ?? "700270361";
const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const upsPath = new URL("../data/ups.json", import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);
const workDir = new URL("../work/", import.meta.url);
const commentReviewPath = new URL(`comment-review-${uid}.json`, workDir);
const reviewCsvPath = new URL(`final-geocode-review-${uid}.csv`, workDir);
const summaryJsonPath = new URL(`final-geocode-summary-${uid}.json`, workDir);

const placeTokens = new Set(["大良", "伦教", "盐步", "斗门", "乾务", "南海", "顺德", "禅城", "天河", "越秀", "海珠", "荔湾", "白云", "番禺"]);

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function usefulComments(restaurant) {
  return (restaurant.comments ?? []).filter((comment) => comment.author !== "系统标记" && comment.content);
}

function locationEvidence(restaurant, commentReviews) {
  return (
    commentReviews.get(restaurant.id)?.evidence?.filter((item) => {
      if (item.isUploader && item.locationScore >= 32) return true;
      return item.locationScore >= 38 && item.identityScore >= 16;
    }) ?? []
  );
}

function reviewStatus(restaurant, commentReviews) {
  if (restaurant.status === "geocoded") return "高德已核实";
  return locationEvidence(restaurant, commentReviews).length ? "评论有位置线索" : "仍需人工确认";
}

function extractSuggestedClue(restaurant, commentReviews) {
  const evidence = commentReviews.get(restaurant.id)?.evidence ?? [];
  const comment = evidence.find((item) => item.isUploader)?.content ?? evidence[0]?.content ?? usefulComments(restaurant)[0]?.content ?? "";
  if (!comment) return "";
  const firstLine = comment.split(/\n/).find(Boolean) ?? comment;
  const normalized = firstLine.replaceAll("|", "｜").trim();
  const parts = normalized
    .split("｜")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const lastPart = parts.at(-1);
    const tailParts = lastPart.split(/[，,；;]/).map((part) => part.trim()).filter(Boolean);
    const tail = placeTokens.has(tailParts[0]) && tailParts[1] ? tailParts[1] : tailParts[0];
    if (tail && tail !== restaurant.name) return tail;
  }

  const afterDistrict = firstLine.match(/(?:广州|佛山|中山|珠海|深圳|东莞|江门|惠州|肇庆|清远|香港|澳门|上海|昆山|日本|东京|天河|越秀|荔湾|海珠|白云|番禺|增城|顺德|南海|禅城|斗门|大良|伦教|盐步)[｜|，,]\s*([^｜|，,；;\n]+)/);
  if (afterDistrict?.[1] && afterDistrict[1].trim() !== restaurant.name) return afterDistrict[1].trim();

  const nameLabel = firstLine.match(/(?:店名|店铺名称|全名)[:：]\s*([^，,；;\n]+)/);
  return nameLabel?.[1]?.trim() ?? "";
}

const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const ups = JSON.parse(await readFile(upsPath, "utf8"));
const commentReview = JSON.parse(await readFile(commentReviewPath, "utf8"));
const commentReviews = new Map(commentReview.map((item) => [item.id, item]));

const updated = restaurants.map((restaurant) => {
  if (restaurant.status === "geocoded") return restaurant;
  const comments = usefulComments(restaurant);
  const locations = locationEvidence(restaurant, commentReviews);
  return {
    ...restaurant,
    commentReview: {
      status: comments.length ? "has_evidence" : "no_useful_comment",
      usefulCount: comments.length,
      locationCount: locations.length,
      checkedAt: restaurant.commentReview?.checkedAt ?? new Date().toISOString().slice(0, 10),
    },
  };
});

const summary = {
  total: updated.length,
  geocoded: updated.filter((restaurant) => restaurant.status === "geocoded").length,
  commentLocation: updated.filter((restaurant) => reviewStatus(restaurant, commentReviews) === "评论有位置线索").length,
  manualReview: updated.filter((restaurant) => reviewStatus(restaurant, commentReviews) === "仍需人工确认").length,
  byCity: {},
};

for (const restaurant of updated) {
  const city = restaurant.city || "未知";
  summary.byCity[city] ??= { total: 0, geocoded: 0, commentLocation: 0, manualReview: 0 };
  summary.byCity[city].total += 1;
  if (restaurant.status === "geocoded") summary.byCity[city].geocoded += 1;
  else if (reviewStatus(restaurant, commentReviews) === "评论有位置线索") summary.byCity[city].commentLocation += 1;
  else summary.byCity[city].manualReview += 1;
}

const headers = [
  "status",
  "name",
  "suggestedClue",
  "city",
  "district",
  "address",
  "locationClueCount",
  "usefulCommentCount",
  "topComment",
  "sourceTitle",
  "sourceUrl",
];
const reviewRows = updated
  .filter((restaurant) => restaurant.status !== "geocoded")
  .map((restaurant) => {
    const locations = locationEvidence(restaurant, commentReviews);
    const comments = usefulComments(restaurant);
    return {
      status: reviewStatus(restaurant, commentReviews),
      name: restaurant.name,
      suggestedClue: extractSuggestedClue(restaurant, commentReviews),
      city: restaurant.city,
      district: restaurant.district,
      address: restaurant.address,
      locationClueCount: locations.length,
      usefulCommentCount: comments.length,
      topComment: locations[0]?.content ?? comments[0]?.content ?? "",
      sourceTitle: restaurant.sourceVideo?.title ?? "",
      sourceUrl: restaurant.sourceVideo?.url ?? "",
    };
  });

const csv = [
  headers.join(","),
  ...reviewRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
].join("\n");

await mkdir(workDir, { recursive: true });
await writeFile(restaurantsPath, `${JSON.stringify(updated, null, 2)}\n`);
await writeFile(dataJsPath, `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants: updated }, null, 2)};\n`);
await writeFile(reviewCsvPath, `${csv}\n`);
await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log("最终核对整理完成");
console.log(`总数：${summary.total}`);
console.log(`高德已核实：${summary.geocoded}`);
console.log(`评论有位置线索：${summary.commentLocation}`);
console.log(`仍需人工确认：${summary.manualReview}`);
console.log(`核对 CSV：${reviewCsvPath.pathname}`);
console.log(`汇总 JSON：${summaryJsonPath.pathname}`);
