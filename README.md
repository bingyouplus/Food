# 湾区探店地图

一个轻量静态网页原型，用来把 B 站探店 UP 的视频整理成广州、佛山餐厅地图。

## 本地预览

```bash
npm run dev
```

打开 `http://localhost:5173`。

## 数据结构

- `data/ups.json`：探店 UP 列表。
- `data/restaurants.json`：餐厅点位、来源视频、评论精选。
- `scripts/update-bilibili.mjs`：后续每周自动扫描视频的脚本入口。

## API Key

不要把高德 Web 服务 key 写进前端。建议放在 GitHub Secrets：

- `AMAP_WEB_SERVICE_KEY`：用于 GitHub Actions 每周地理编码。
- `BILIBILI_UIDS`：逗号分隔的 UP 主 UID，例如 `700270361`。

前端地图如果要接入高德 JS API，需要另行配置浏览器端可用的 JS API key。
