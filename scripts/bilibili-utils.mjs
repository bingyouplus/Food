import { readFile } from "node:fs/promises";

let cachedCookie;

async function getBilibiliCookie() {
  if (cachedCookie !== undefined) return cachedCookie;
  if (process.env.BILIBILI_COOKIE) {
    cachedCookie = process.env.BILIBILI_COOKIE;
    return cachedCookie;
  }
  try {
    cachedCookie = (await readFile(new URL("../.bilibili-cookie", import.meta.url), "utf8")).trim();
  } catch {
    cachedCookie = "";
  }
  return cachedCookie;
}

export const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

export function extractCandidates(title = "") {
  const districts = [
    "越秀",
    "荔湾",
    "海珠",
    "天河",
    "白云",
    "黄埔",
    "番禺",
    "花都",
    "南沙",
    "从化",
    "增城",
    "禅城",
    "南海",
    "顺德",
    "三水",
    "高明",
  ];
  const district = districts.find((item) => title.includes(item));
  const hasFoodSignal = /店|餐厅|酒家|饭店|茶楼|大排档|烧腊|肠粉|粥|面|粉|煲|鸡|鹅|牛|鱼|甜品|糖水|早茶|宵夜/.test(
    title,
  );
  return {
    district: district ? `${district}区` : "",
    foodSignal: hasFoodSignal,
  };
}

export async function requestBilibili(url, uid) {
  const cookie = await getBilibiliCookie();
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      Referer: `https://space.bilibili.com/${uid}/`,
      Accept: "application/json,text/plain,*/*",
      Cookie: cookie,
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, text, json };
}

export function getMixinKey(rawKey) {
  return mixinKeyEncTab
    .map((index) => rawKey[index])
    .join("")
    .slice(0, 32);
}

export function sanitize(value) {
  return String(value).replace(/[!'()*]/g, "");
}

export async function md5(text) {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(text).digest("hex");
}

export async function getWbiKeys(uid) {
  const current = await requestBilibili("https://api.bilibili.com/x/web-interface/nav", uid);
  const wbi = current.json?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) {
    throw new Error(`无法获取 WBI key：${current.text.slice(0, 180)}`);
  }
  const imgKey = wbi.img_url.slice(wbi.img_url.lastIndexOf("/") + 1, wbi.img_url.lastIndexOf("."));
  const subKey = wbi.sub_url.slice(wbi.sub_url.lastIndexOf("/") + 1, wbi.sub_url.lastIndexOf("."));
  return { imgKey, subKey };
}

export async function signedSpaceSearchUrl({ uid, pageNumber = 1, pageSize = 30 }) {
  const { imgKey, subKey } = await getWbiKeys(uid);
  const mixinKey = getMixinKey(imgKey + subKey);
  const params = {
    dm_cover_img_str: "QU5HTEUgKEludGVsLCBJbnRlbChSKSBJcmlzKFIpIFBsdXMgR3JhcGhpY3MgNjU1KQ",
    dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
    dm_img_list: "[]",
    dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
    mid: uid,
    order: "pubdate",
    order_avoided: true,
    platform: "web",
    pn: pageNumber,
    ps: pageSize,
    tid: 0,
    wts: Math.round(Date.now() / 1000),
    web_location: 1550101,
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(sanitize(params[key]))}`)
    .join("&");
  const wRid = await md5(query + mixinKey);
  return `https://api.bilibili.com/x/space/wbi/arc/search?${query}&w_rid=${wRid}`;
}

export function toVideoRow(video) {
  const parsed = extractCandidates(video.title);
  return {
    bv: video.bvid,
    aid: video.aid,
    title: video.title,
    description: video.description ?? "",
    created: video.created ? new Date(video.created * 1000).toISOString().slice(0, 10) : "",
    district: parsed.district,
    foodSignal: parsed.foodSignal,
    url: `https://www.bilibili.com/video/${video.bvid}`,
  };
}
