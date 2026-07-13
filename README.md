# 觅食记

一个轻量静态网页原型，用来把 B 站美食 UP 的视频整理成广州、佛山餐厅地图。

## 本地预览

```bash
npm run dev
```

打开 `http://localhost:5173`。

## 数据结构

- `data/ups.json`：美食 UP 列表。
- `data/restaurants.json`：餐厅点位、来源视频、评论精选。以"餐厅为实体、
  视频为证据"组织：`sourceVideos[]` 为该店全部来源视频、`visitCount` 为到访
  次数；`nameQuality: "suspect"` 标注疑似店名（地名/整句标题解析残留），
  前端不上图、列表标"名称待核实"，坐标与来源视频保留待人工修正；
  `addressSharedWith` 提示同一高德地址下的其他店名，需人工区分。
- `scripts/update-bilibili.mjs`：后续每周自动扫描视频的脚本入口。

## 数据维护

```bash
npm run clean:data   # 幂等：合并重复店、聚合来源视频、标注疑似脏店名
npm run build        # 校验：同名同区重复、坐标越界、必填字段
```

## API Key

不要把高德 Web 服务 key 写进前端。建议放在 GitHub Secrets：

- `AMAP_WEB_SERVICE_KEY`：用于 GitHub Actions 每周地理编码。
- `BILIBILI_UIDS`：逗号分隔的 UP 主 UID，例如 `700270361`。

前端地图如果要接入高德 JS API，需要另行配置浏览器端可用的 JS API key。
