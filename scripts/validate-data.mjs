import { readFile } from "node:fs/promises";

const restaurants = JSON.parse(
  await readFile(new URL("../data/restaurants.json", import.meta.url), "utf8"),
);
const ups = JSON.parse(await readFile(new URL("../data/ups.json", import.meta.url), "utf8"));
const upIds = new Set(ups.map((up) => up.id));

const required = ["id", "upId", "name", "city", "district", "address", "lng", "lat"];
const errors = [];

for (const item of restaurants) {
  for (const field of required) {
    if (item[field] === undefined || item[field] === "") {
      errors.push(`${item.id ?? "unknown"} 缺少字段 ${field}`);
    }
  }
  if (!upIds.has(item.upId)) {
    errors.push(`${item.id} 引用了不存在的 UP：${item.upId}`);
  }
  if (typeof item.lng !== "number" || typeof item.lat !== "number") {
    errors.push(`${item.id} 经纬度必须是数字`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`数据检查通过：${restaurants.length} 家餐厅，${ups.length} 个 UP。`);
