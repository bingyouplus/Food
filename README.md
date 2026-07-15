# 觅食记

一个轻量静态网页原型，用来把 B 站美食 UP 的视频整理成广州、佛山餐厅地图。

## 本地预览

```bash
npm run dev
```

打开 `http://localhost:5173`。

## 数据结构

- `data/ups.json`：美食 UP 列表。
- `data/restaurants.json`：餐厅点位、来源视频、评论精选。
- `scripts/update-bilibili.mjs`：后续每周自动扫描视频的脚本入口。

## API Key

不要把高德 Web 服务 key 写进前端。建议放在 GitHub Secrets：

- `AMAP_WEB_SERVICE_KEY`：用于 GitHub Actions 每周地理编码。
- `BILIBILI_UIDS`：逗号分隔的 UP 主 UID，例如 `700270361`。
- `AMAP_JS_KEY`：用于 GitHub Pages 前端加载高德 JS API。
- `AMAP_SECURITY_JS_CODE`：用于 GitHub Pages 前端加载高德 JS API 的安全密钥。

前端地图如果要接入高德 JS API，需要配置浏览器端可用的 JS API key 和安全密钥。它们会在浏览器里被使用，请务必在高德控制台限制安全域名。

本地预览可新建 `src/runtime-config.local.js`，这个文件已被 `.gitignore` 忽略：

```js
window.FOOD_MAP_CONFIG = {
  ...(window.FOOD_MAP_CONFIG ?? {}),
  amapJsKey: "你的 Web端(JS API) Key",
  amapSecurityJsCode: "你的 Web端(JS API) 安全密钥",
};
```

建议在高德控制台的 JS API Key 安全域名里加入：

- `localhost`
- `127.0.0.1`
- `bingyouplus.github.io`

## GitHub Pages 发布

线上真实地图通过 `.github/workflows/deploy-pages.yml` 发布。这个工作流会在部署时生成 `src/runtime-config.local.js`，文件只进入 Pages artifact，不会提交回仓库。

GitHub 仓库需要这样配置：

1. 进入 `Settings` → `Secrets and variables` → `Actions`。
2. 在 `Repository secrets` 添加：
   - `AMAP_JS_KEY`
   - `AMAP_SECURITY_JS_CODE`
   - `AMAP_WEB_SERVICE_KEY`
3. 如需自动更新 B 站 UID，在 `Repository variables` 添加：
   - `BILIBILI_UIDS`
4. 进入 `Settings` → `Pages`。
5. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。

注意：高德 JS API key 和安全密钥会被浏览器加载，部署后用户可以在网页请求里看到它们。安全性主要依赖高德控制台的安全域名限制。
