import { requestBilibili, signedSpaceSearchUrl, toVideoRow } from "./bilibili-utils.mjs";

const uid = process.argv[2] ?? process.env.BILIBILI_UIDS?.split(",")[0] ?? "700270361";
const pageSize = Number(process.argv[3] ?? 20);

let result = null;
let usedUrl = "";

const endpoints = [];

try {
  endpoints.push(await signedSpaceSearchUrl({ uid, pageNumber: 1, pageSize }));
} catch (error) {
  console.log("WBI 签名准备失败：");
  console.log(error.message);
}

endpoints.push(
  `https://api.bilibili.com/x/space/wbi/arc/search?mid=${uid}&pn=1&ps=${pageSize}&order=pubdate`,
  `https://api.bilibili.com/x/space/arc/search?mid=${uid}&pn=1&ps=${pageSize}&order=pubdate`,
);

for (const url of endpoints) {
  try {
    const current = await requestBilibili(url, uid);
    if (current.json?.data?.list?.vlist?.length) {
      result = current.json;
      usedUrl = url;
      break;
    }
    console.log(`接口无可用列表：${url}`);
    console.log(`状态：${current.status}，响应：${current.text.slice(0, 180)}`);
  } catch (error) {
    console.log(`接口请求失败：${url}`);
    console.log(error.message);
  }
}

if (!result) {
  console.log("\n预跑未成功。常见原因：B 站接口需要 WBI 签名、Cookie、或当前网络被风控。");
  console.log("可替代方案：导出 BV号/标题/简介/发布时间 表格给我，我可以离线批量解析。");
  process.exit(1);
}

const data = result.data;
const videos = data.list.vlist;
const rows = videos.map(toVideoRow);

console.log("\n预跑成功");
console.log(`UID：${uid}`);
console.log(`接口：${usedUrl}`);
console.log(`总视频数：${data.page?.count ?? "未知"}`);
console.log(`本次样本：${rows.length}`);
console.log(`有区名线索：${rows.filter((row) => row.district).length}`);
console.log(`有美食关键词：${rows.filter((row) => row.foodSignal).length}`);
console.table(rows.slice(0, 20));
