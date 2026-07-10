import { mkdir, readFile, writeFile } from "node:fs/promises";
import { requestBilibili, signedSpaceSearchUrl, toVideoRow } from "./bilibili-utils.mjs";

const uid = process.argv[2] ?? process.env.BILIBILI_UIDS?.split(",")[0] ?? "700270361";
const pageSize = Number(process.argv[3] ?? 30);
const outputDir = new URL("../work/", import.meta.url);
const delayMs = Number(process.env.BILIBILI_EXPORT_DELAY_MS ?? 30000);
const maxPagesPerRun = Number(process.env.BILIBILI_MAX_PAGES_PER_RUN ?? 2);
const jsonPath = new URL(`bilibili-${uid}-videos.json`, outputDir);
const csvPath = new URL(`bilibili-${uid}-videos.csv`, outputDir);

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function fetchPage(pageNumber) {
  let lastText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const url = await signedSpaceSearchUrl({ uid, pageNumber, pageSize });
    const current = await requestBilibili(url, uid);
    const videos = current.json?.data?.list?.vlist;
    if (videos) return current.json.data;
    lastText = current.text;
    const code = current.json?.code;
    const backoff = delayMs * attempt + Math.round(Math.random() * 2200);
    console.log(`第 ${pageNumber} 页第 ${attempt} 次失败：${code ?? current.status}，${backoff}ms 后重试`);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  throw new Error(`第 ${pageNumber} 页失败：${lastText.slice(0, 220)}`);
}

async function readExistingRows() {
  try {
    const text = await readFile(jsonPath, "utf8");
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeOutputs(rows) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);

  const headers = ["bv", "aid", "title", "description", "created", "district", "foodSignal", "url"];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  await writeFile(csvPath, `${csv}\n`);
}

await mkdir(outputDir, { recursive: true });
const existingRows = await readExistingRows();
const byBv = new Map(existingRows.map((row) => [row.bv, row]));
const first = await fetchPage(1);
const total = first.page?.count ?? first.list.vlist.length;
const pageCount = Math.ceil(total / pageSize);
for (const row of first.list.vlist.map(toVideoRow)) byBv.set(row.bv, row);
let rows = [...byBv.values()];
await writeOutputs(rows);

console.log(`UID：${uid}`);
console.log(`总视频数：${total}`);
console.log(`每页：${pageSize}`);
console.log(`页数：${pageCount}`);
console.log(`已保存：${rows.length}/${total}`);

for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
  if (rows.length >= pageNumber * pageSize) {
    console.log(`跳过第 ${pageNumber} 页：本地已有足够记录`);
    continue;
  }
  const completedPages = Math.floor(rows.length / pageSize);
  if (completedPages >= maxPagesPerRun) {
    console.log(`本轮达到上限：${maxPagesPerRun} 页。稍后再次运行会从已保存数据继续。`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs + Math.round(Math.random() * 2200)));
  const page = await fetchPage(pageNumber);
  for (const row of page.list.vlist.map(toVideoRow)) byBv.set(row.bv, row);
  rows = [...byBv.values()];
  await writeOutputs(rows);
  console.log(`已保存：${rows.length}/${total}`);
}

await writeOutputs(rows);

console.log("\n导出完成");
console.log(`JSON：${jsonPath.pathname}`);
console.log(`CSV：${csvPath.pathname}`);
console.log(`有区名线索：${rows.filter((row) => row.district).length}`);
console.log(`有美食关键词：${rows.filter((row) => row.foodSignal).length}`);
