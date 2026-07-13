import { readFile } from "node:fs/promises";

const restaurants = JSON.parse(
  await readFile(new URL("../data/restaurants.json", import.meta.url), "utf8"),
);
const ups = JSON.parse(await readFile(new URL("../data/ups.json", import.meta.url), "utf8"));
const upIds = new Set(ups.map((up) => up.id));

const required = ["id", "upId", "name", "city", "district", "address", "lng", "lat"];

// 坐标合理范围（粤港澳为主，放宽到东亚，容纳 UP 主偶尔的外地/境外探店）
const LNG_MIN = 100;
const LNG_MAX = 145;
const LAT_MIN = 18;
const LAT_MAX = 46;

const errors = []; // 阻断构建
const warnings = []; // 仅提示，不阻断

const seenId = new Set();
const nameCityDistrictCount = new Map();

for (const item of restaurants) {
  for (const field of required) {
    if (item[field] === undefined || item[field] === "") {
      errors.push(`${item.id ?? "unknown"} 缺少字段 ${field}`);
    }
  }

  if (!upIds.has(item.upId)) {
    errors.push(`${item.id} 引用了不存在的 UP：${item.upId}`);
  }

  if (seenId.has(item.id)) {
    errors.push(`重复 id：${item.id}`);
  }
  seenId.add(item.id);

  if (typeof item.lng !== "number" || typeof item.lat !== "number") {
    errors.push(`${item.id} 经纬度必须是数字`);
  } else if (item.lng < LNG_MIN || item.lng > LNG_MAX || item.lat < LAT_MIN || item.lat > LAT_MAX) {
    warnings.push(`${item.id} 坐标超出东亚范围：${item.lng}, ${item.lat}`);
  }

  const key = `${item.name}|${item.city}|${item.district}`;
  nameCityDistrictCount.set(key, (nameCityDistrictCount.get(key) ?? 0) + 1);
}

// 同名同区疑似重复（清洗脚本跑过后应为 0；同址不同名的用 addressSharedWith 区分）
for (const [key, count] of nameCityDistrictCount) {
  if (count > 1) {
    warnings.push(`疑似重复餐厅（同名同区 ${count} 家）：${key.split("|")[0]}`);
  }
}

const suspectCount = restaurants.filter((item) => item.nameQuality === "suspect").length;
if (suspectCount) {
  warnings.push(`${suspectCount} 家店名待人工核实（nameQuality=suspect），已从地图过滤`);
}

if (warnings.length) {
  console.warn("警告（不阻断构建）：");
  console.warn(warnings.map((line) => `  - ${line}`).join("\n"));
}

if (errors.length) {
  console.error("错误：");
  console.error(errors.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}

console.log(
  `数据检查通过：${restaurants.length} 家餐厅，${ups.length} 个 UP，${suspectCount} 家店名待核实。`,
);
