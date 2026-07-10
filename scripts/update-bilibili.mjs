import { writeFile, readFile } from "node:fs/promises";

const uidList = (process.env.BILIBILI_UIDS ?? "700270361")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);
const amapKey = process.env.AMAP_WEB_SERVICE_KEY;

if (!amapKey) {
  console.warn("未设置 AMAP_WEB_SERVICE_KEY，本次只演示流程，不会写入真实地理编码。");
}

const restaurantsUrl = new URL("../data/restaurants.json", import.meta.url);
const current = JSON.parse(await readFile(restaurantsUrl, "utf8"));

async function fetchVideos(uid) {
  // B 站接口经常调整签名和风控。正式版建议优先使用稳定数据源或在本脚本中补齐 wbi 签名。
  // 这里保留脚本入口，避免把抓取逻辑写死在前端。
  console.log(`待扫描 UID：${uid}`);
  return [];
}

async function geocode(address, city) {
  if (!amapKey) return null;
  const url = new URL("https://restapi.amap.com/v3/geocode/geo");
  url.searchParams.set("key", amapKey);
  url.searchParams.set("address", address);
  url.searchParams.set("city", city);
  const response = await fetch(url);
  const json = await response.json();
  const location = json.geocodes?.[0]?.location;
  if (!location) return null;
  const [lng, lat] = location.split(",").map(Number);
  return { lng, lat };
}

for (const uid of uidList) {
  const videos = await fetchVideos(uid);
  for (const video of videos) {
    console.log("待解析视频：", video.title);
    await geocode(video.address, video.city);
  }
}

await writeFile(restaurantsUrl, `${JSON.stringify(current, null, 2)}\n`);
console.log("更新完成。当前版本仍保留示例数据，等真实抓取规则确认后再写入新增餐厅。");
