import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const uid = process.argv[2] ?? "700270361";
const pageSize = process.argv[3] ?? "10";
const targetTotal = Number(process.env.BILIBILI_TARGET_TOTAL ?? 504);
const intervalMs = Number(process.env.BILIBILI_LOOP_INTERVAL_MS ?? 30 * 60 * 1000);
const projectRoot = new URL("../", import.meta.url);
const videosPath = new URL(`work/bilibili-${uid}-videos.json`, projectRoot);

async function savedCount() {
  try {
    const rows = JSON.parse(await readFile(videosPath, "utf8"));
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

function runExportOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      ["run", "export:bilibili", "--", uid, pageSize],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          BILIBILI_EXPORT_DELAY_MS: process.env.BILIBILI_EXPORT_DELAY_MS ?? "1000",
          BILIBILI_MAX_PAGES_PER_RUN: process.env.BILIBILI_MAX_PAGES_PER_RUN ?? "1",
        },
        stdio: "inherit",
      },
    );
    child.on("close", (code) => resolve(code));
  });
}

async function main() {
  console.log(`慢速导出启动：UID ${uid}，每轮最多 1 个新增分页，间隔 ${Math.round(intervalMs / 60000)} 分钟。`);
  while (true) {
    const before = await savedCount();
    if (before >= targetTotal) {
      console.log(`已保存 ${before}/${targetTotal}，导出完成。`);
      break;
    }

    console.log(`\n当前已保存 ${before}/${targetTotal}，开始本轮导出。`);
    const code = await runExportOnce();
    const after = await savedCount();
    console.log(`本轮结束：退出码 ${code}，已保存 ${after}/${targetTotal}。`);

    if (after >= targetTotal) {
      console.log("视频导出已完成。");
      break;
    }

    console.log(`等待 ${Math.round(intervalMs / 60000)} 分钟后继续。`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

await main();
