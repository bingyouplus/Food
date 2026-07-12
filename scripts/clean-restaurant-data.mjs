import { mkdir, readFile, writeFile } from "node:fs/promises";

const restaurantsPath = new URL("../data/restaurants.json", import.meta.url);
const upsPath = new URL("../data/ups.json", import.meta.url);
const dataJsPath = new URL("../src/data.js", import.meta.url);
const workDir = new URL("../work/", import.meta.url);
const reportPath = new URL("restaurant-cleanup-report.json", workDir);

const corrections = {
  "zh-乾务-BV1NJsgzmET2": {
    name: "胜记美食",
    district: "斗门区",
    address: "珠海市斗门区乾务镇胜记美食（待确认）",
  },
  "fs-伦教-BV1q1eMzWErQ": {
    name: "香江饭店",
    district: "顺德区",
    address: "佛山市顺德区伦教香江饭店（待确认）",
  },
  "fs-一个非常经典的街坊饭堂-BV1X7bazwEAx": {
    name: "顺年居",
    district: "顺德区",
    address: "佛山市顺德区大良顺年居（待确认）",
  },
  "fs-盐步-BV16qhgzdEzQ": {
    name: "长润餐厅",
    district: "南海区",
    address: "佛山市南海区盐步长润餐厅（待确认）",
  },
  "fs-南海-BV1EhGuzTEwX": {
    name: "饭巢肚",
    district: "南海区",
    address: "佛山市南海区饭巢肚（待确认）",
  },
  "fs-鲮鱼仔-BV1TE7Gz6Eov": {
    name: "鲮渔仔",
    district: "南海区",
    address: "佛山市南海区鲮渔仔（待确认）",
  },
  "jp-京都-BV1Gt421876S": {
    name: "京都勝牛",
    district: "京都",
    address: "日本京都河原町店（604-8041，待确认）",
  },
  "gz-把烟熏火燎玩的相当到位的地道法餐-BV1Qk4y1579H": {
    name: "LE HACHOIR 亚莎",
    address: "广州市天河区广粤天地清风街9号60-62铺",
  },
  "gz-永楷饭店-BV1Nw411B7Li": {
    name: "永楷饭店",
    address: "广州市海珠区新港西路164号永楷饭店（待确认）",
  },
  "gz-近二十年的老牌粤菜-BV1XN41127CU": {
    name: "新文记",
    address: "广州市越秀区盘福路新文记（待确认）",
  },
  "gz-惊喜的粤菜馆子-BV1NX4y1v7Kb": {
    name: "永楷饭店",
    address: "广州市海珠区新港西路164号永楷饭店（待确认）",
  },
  "gz-一个低调-但相当靠谱的江浙菜馆儿-BV16p4y1P7mt": {
    name: "三秋桂子",
    address: "广州市天河区三秋桂子（待确认）",
  },
  "gz-终于又有动力更新宝藏面家的系列了-BV1ou4y1q71D": {
    name: "勇记手工竹升面",
    address: "广州市荔湾区东漖街道花地大道南18号荔塱农副产品综合批发市场",
  },
  "gz-龙美三家神店收尾-BV1f94y1i7SX": {
    name: "奉座泥炉烤肉·活鳗",
    address: "广州市番禺区龙美奉座泥炉烤肉·活鳗（待确认）",
  },
  "gz-天河性价比非常不错的宵夜大排档-BV15F411Q7ui": {
    name: "煮米天河大排档",
    address: "广州市天河区天河路99号煮米天河大排档（待确认）",
  },
  "fs-千灯湖-BV1J94y177Wa": {
    name: "邱家庄鸡煲蟹",
    district: "南海区",
    address: "佛山市南海区千灯湖致越优城A座二层邱家庄鸡煲蟹（待确认）",
  },
  "gz-广州三十年原始桑拿菜-BV1W14y1C79i": {
    name: "矿泉大可以",
    address: "广州越秀区矿泉大可以（待确认）",
  },
  "gz-快一年没发现可以称为-宝藏-的煲仔饭了-BV1qH4y1Q7Jx": {
    name: "煲掌柜老广煲仔饭",
    address: "广州市荔湾区宝华路133号恒宝广场L2层001号",
  },
  "gz-妥妥的宝藏小馆儿-BV1wV411K7qQ": {
    name: "御灶四季",
    address: "广州市越秀区北京路天河城8层御灶四季（待确认）",
  },
};

const exclusions = {
  "gz-龙津西路92号-BV1pfBKBDEaX": "标题是地址，不是餐厅名，暂不入图。",
  "gz-一家小小的夫妻店里-找到了广州相当难得的泉州味道-BV1aJq3YJEMu": "标题是描述，不是餐厅名；当前高德结果疑似错配，暂不入图。",
  "jp-东京都-BV1cTevzNEH1": "视频是东京/成田/横滨 8 家餐厅合集，不应作为单个餐厅点位。",
  "jp-大阪-和歌山-BV1er5cz5Exb": "视频是大阪/和歌山多家餐厅合集，不应作为单个餐厅点位。",
};

function videoOf(item) {
  return item.sourceVideo
    ? {
        title: item.sourceVideo.title,
        url: item.sourceVideo.url,
        publishedAt: item.sourceVideo.publishedAt || "",
      }
    : null;
}

function uniqueByUrl(videos) {
  const seen = new Set();
  return videos
    .filter(Boolean)
    .filter((video) => {
      if (seen.has(video.url)) return false;
      seen.add(video.url);
      return true;
    })
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

function mergeGroup(items) {
  const sorted = [...items].sort((a, b) => (b.sourceVideo?.publishedAt || "").localeCompare(a.sourceVideo?.publishedAt || ""));
  const primary = structuredClone(sorted[0]);
  const videos = uniqueByUrl(sorted.flatMap((item) => item.sourceVideos ?? [videoOf(item)]));
  primary.sourceVideos = videos;
  primary.sourceVideo = videos[0] ?? primary.sourceVideo;
  primary.comments = [
    {
      author: "系统合并",
      content: `同一家店出现 ${items.length} 次探店视频，已合并为一个餐厅条目，并保留全部探店记录。`,
      likes: 0,
    },
    ...(primary.comments ?? []),
  ];
  return primary;
}

const restaurants = JSON.parse(await readFile(restaurantsPath, "utf8"));
const ups = JSON.parse(await readFile(upsPath, "utf8"));
const report = {
  originalTotal: restaurants.length,
  corrected: [],
  excluded: [],
  merged: [],
};

const cleaned = [];
for (const restaurant of restaurants) {
  if (exclusions[restaurant.id]) {
    report.excluded.push({
      id: restaurant.id,
      name: restaurant.name,
      reason: exclusions[restaurant.id],
      sourceVideo: restaurant.sourceVideo,
    });
    continue;
  }

  const patch = corrections[restaurant.id];
  if (patch) {
    report.corrected.push({
      id: restaurant.id,
      from: restaurant.name,
      to: patch.name,
    });
    Object.assign(restaurant, patch);
    restaurant.comments = [
      {
        author: "系统修正",
        content: `原解析名“${report.corrected.at(-1).from}”不是准确店名，已按标题/UP主评论线索修正为“${patch.name}”。`,
        likes: 0,
      },
      ...(restaurant.comments ?? []).filter((comment) => comment.author !== "系统修正"),
    ];
  }
  cleaned.push(restaurant);
}

const groups = new Map();
for (const restaurant of cleaned) {
  const key = `${restaurant.name}|||${restaurant.address}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(restaurant);
}

const merged = [];
for (const group of groups.values()) {
  if (group.length === 1) {
    merged.push(group[0]);
    continue;
  }
  report.merged.push({
    name: group[0].name,
    address: group[0].address,
    count: group.length,
    ids: group.map((item) => item.id),
  });
  merged.push(mergeGroup(group));
}

merged.sort((a, b) => (b.sourceVideo?.publishedAt || "").localeCompare(a.sourceVideo?.publishedAt || ""));
report.finalTotal = merged.length;

await mkdir(workDir, { recursive: true });
await writeFile(restaurantsPath, `${JSON.stringify(merged, null, 2)}\n`);
await writeFile(dataJsPath, `window.FOOD_MAP_DATA = ${JSON.stringify({ ups, restaurants: merged }, null, 2)};\n`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("餐厅数据清理完成");
console.log(`原始总数：${report.originalTotal}`);
console.log(`修正店名：${report.corrected.length}`);
console.log(`剔除非单店：${report.excluded.length}`);
console.log(`合并重复组：${report.merged.length}`);
console.log(`最终总数：${report.finalTotal}`);
console.log(`报告：${reportPath.pathname}`);
