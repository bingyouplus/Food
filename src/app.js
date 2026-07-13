const state = {
  ups: [],
  restaurants: [],
  selectedId: null,
  city: "全部",
  query: "",
  mapZoom: 1,
  mapPan: { x: 0, y: 0 },
  zoomed: false,
  amap: null,
  markers: [],
};

const locationPattern = /地址|位置|坐标|定位|导航|路|街|巷|号|铺|层|楼|旁|附近|对面|门口|市场|村|城|广场|公园|地铁|公交|停车场|幼儿园|登峰|出地铁|在哪里|在哪|求地址/;

const districtPalette = {
  广州: ["#4eb7a8", "#73c6b6", "#2f9c91", "#8fcfbe", "#5aa897", "#9bd8ca"],
  佛山: ["#5ba8d6", "#7dbbe0", "#408ec4", "#9acbe8", "#6c9ed0", "#4f83bd"],
  中山: ["#e39d5c", "#d98945", "#efb676", "#c87839"],
  珠海: ["#6aa6df", "#88bee8", "#4b8dcc", "#a4cdec"],
  深圳: ["#58b88f", "#7bcaa8", "#3e9d77", "#96d8bb"],
  东莞: ["#c695d8", "#b77bcd", "#d3b0e0", "#9f65b9"],
  江门: ["#d7aa5d", "#c99642", "#e5bf7b", "#b48034"],
  惠州: ["#68b7c4", "#83c7d1", "#4ca1b0", "#9bd5dd"],
  肇庆: ["#93ad62", "#a8be7c", "#7f9b4f", "#bbcb96"],
  清远: ["#d98680", "#e49c96", "#c96f68", "#edb4af"],
  香港: ["#d46f9f", "#e18ab1", "#bf5b8a", "#eca9c5"],
  澳门: ["#b7a05f", "#c9b77a", "#9f8948", "#d8ca98"],
  上海: ["#6f98d4", "#8aaee1", "#587fbd", "#abc5ec"],
  昆山: ["#79b178", "#91c58e", "#5f9b5e", "#acd6a8"],
  东京: ["#b889d7", "#c7a0e1", "#9e6bc4", "#d8b8ec"],
  日本: ["#b889d7", "#c7a0e1", "#9e6bc4", "#d8b8ec"],
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value) {
  const url = String(value ?? "").trim();
  return /^(https?:|mailto:|\/|\.\/|#)/i.test(url) ? esc(url) : "#";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantile(sortedValues, p) {
  if (!sortedValues.length) return undefined;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function mostCommonCity(restaurants) {
  const counts = new Map();
  for (const item of restaurants) {
    counts.set(item.city, (counts.get(item.city) ?? 0) + 1);
  }
  let best = "全部";
  let max = 0;
  for (const [city, count] of counts) {
    if (count > max) {
      max = count;
      best = city;
    }
  }
  return best;
}

const els = {
  upTabs: document.querySelector("#upTabs"),
  cityFilters: document.querySelector("#cityFilters"),
  searchInput: document.querySelector("#searchInput"),
  fallbackMap: document.querySelector("#fallbackMap"),
  legend: document.querySelector("#legend"),
  statsStrip: document.querySelector("#statsStrip"),
  list: document.querySelector("#restaurantList"),
  detail: document.querySelector("#detailCard"),
  resultCount: document.querySelector("#resultCount"),
  modeLabel: document.querySelector("#mapModeLabel"),
};

async function boot() {
  const { restaurants, ups } = window.FOOD_MAP_DATA;
  state.ups = ups;
  state.restaurants = restaurants;
  state.city = mostCommonCity(restaurants);
  state.selectedId = restaurants[0]?.id ?? null;

  renderUpTabs();
  renderFilters();
  renderAll();
  tryLoadAmap();

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderAll();
  });

  // "添加 UP"目前是占位功能，给它一个明确反馈，避免用户以为页面坏了。
  const addUpButton = document.querySelector(".ghost-button");
  if (addUpButton) {
    const originalHtml = addUpButton.innerHTML;
    addUpButton.title = "多 UP 主支持开发中";
    addUpButton.addEventListener("click", () => {
      addUpButton.textContent = "开发中，敬请期待";
      setTimeout(() => {
        addUpButton.innerHTML = originalHtml;
      }, 1500);
    });
  }
}

function renderAll() {
  syncSelectedRestaurant();
  renderStats();
  renderFallbackMap();
  renderLegend();
  renderList();
  renderDetail();
  syncAmapMarkers();
}

function filteredRestaurants() {
  return state.restaurants.filter((item) => {
    const cityMatch = state.city === "全部" || item.city === state.city;
    const query = state.query.toLowerCase();
    const haystack = [
      item.name,
      item.city,
      item.district,
      item.address,
      item.signatureDishes.join(" "),
      item.sourceVideo.title,
    ]
      .join(" ")
      .toLowerCase();
    return cityMatch && (!query || haystack.includes(query));
  });
}

function syncSelectedRestaurant() {
  const items = filteredRestaurants();
  if (!items.length) {
    state.selectedId = null;
    return;
  }
  if (!items.some((item) => item.id === state.selectedId)) {
    state.selectedId = items[0].id;
  }
}

function districtColor(item) {
  const districts = [...new Set(state.restaurants.filter((r) => r.city === item.city).map((r) => r.district))];
  const index = Math.max(0, districts.indexOf(item.district));
  const palette = districtPalette[item.city] ?? ["#79b8a9"];
  return palette[index % palette.length];
}

function locationEvidence(item) {
  return (item.comments ?? []).filter(
    (comment) => comment.author !== "系统标记" && locationPattern.test(comment.content),
  );
}

function mapStatus(item) {
  if (item.status === "geocoded") {
    return {
      key: "verified",
      label: "位置已核实",
      summary: item.geocode?.poiName ? `已核对到店铺：${item.geocode.poiName}` : "位置已核对，可放心导航",
    };
  }
  const evidenceCount = item.commentReview?.locationCount ?? locationEvidence(item).length;
  if (evidenceCount) {
    return {
      key: "commented",
      label: "大致位置",
      summary: `有 ${evidenceCount} 条网友评论线索，导航前建议再确认门店`,
    };
  }
  return {
    key: "pending",
    label: "位置未确认",
    summary: "暂缺可确认的详细地址，导航前请先自行核实",
  };
}

function amapMarkerUrl(item) {
  if (typeof item.lng !== "number" || typeof item.lat !== "number") return "";
  return `https://uri.amap.com/marker?position=${item.lng},${item.lat}&name=${encodeURIComponent(item.name)}`;
}

function amapSearchUrl(item) {
  return `https://www.amap.com/search?query=${encodeURIComponent([item.city, item.district, item.name].filter(Boolean).join(""))}`;
}

function renderUpTabs() {
  els.upTabs.innerHTML = state.ups
    .map((up) => {
      const initials = up.name.replace(/^探店\s*/, "").slice(0, 2);
      return `
        <a class="up-tab ${up.active ? "active" : ""}" href="${safeUrl(up.spaceUrl)}" target="_blank" rel="noreferrer">
          <span class="avatar" style="--accent:${esc(up.accent)}">
            ${up.avatar ? `<img src="${safeUrl(up.avatar)}" alt="${esc(up.name)}" />` : esc(initials)}
          </span>
          <span>${esc(up.name)}</span>
        </a>
      `;
    })
    .join("");
}

function renderFilters() {
  const cities = ["全部", ...new Set(state.restaurants.map((item) => item.city))];
  els.cityFilters.innerHTML = cities
    .map((city) => `<button class="${city === state.city ? "active" : ""}" type="button" data-city="${esc(city)}">${esc(city)}</button>`)
    .join("");
  els.cityFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.city = button.dataset.city;
      renderFilters();
      renderAll();
    });
  });
}

function renderStats() {
  const items = filteredRestaurants();
  const cityCount = new Set(items.map((item) => item.city)).size;
  const districtCount = new Set(items.map((item) => item.district)).size;
  const verifiedCount = items.filter((item) => mapStatus(item).key === "verified").length;
  els.statsStrip.innerHTML = `
    <article><strong>${items.length}</strong><span>家餐厅</span></article>
    <article><strong>${cityCount}</strong><span>个城市</span></article>
    <article><strong>${districtCount}</strong><span>个区</span></article>
    <article><strong>${verifiedCount}</strong><span>位置已核实</span></article>
  `;
  els.resultCount.textContent = `${items.length} 个结果`;
}

function clampPan(x, y) {
  if (state.mapZoom <= 1) return { x: 0, y: 0 };
  const width = els.fallbackMap.clientWidth || 1;
  const height = els.fallbackMap.clientHeight || 1;
  const maxX = Math.round((width * (state.mapZoom - 1)) / 2);
  const maxY = Math.round((height * (state.mapZoom - 1)) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

function renderFallbackMap() {
  const items = filteredRestaurants();
  const lngs = items.map((item) => item.lng).filter((value) => typeof value === "number");
  const lats = items.map((item) => item.lat).filter((value) => typeof value === "number");
  const lngSorted = [...lngs].sort((a, b) => a - b);
  const latSorted = [...lats].sort((a, b) => a - b);
  // 用 5%~95% 分位框定主聚集区，避免个别离群点位（如境外城市的视频）
  // 把坐标轴拉爆、导致 300+ 个广佛点被压扁成一坨。离群点稍后会 clamp 到边缘。
  const minLng = Math.min(quantile(lngSorted, 0.05) ?? 113.05, 113.05);
  const maxLng = Math.max(quantile(lngSorted, 0.95) ?? 113.35, 113.35);
  const minLat = Math.min(quantile(latSorted, 0.05) ?? 22.78, 22.78);
  const maxLat = Math.max(quantile(latSorted, 0.95) ?? 23.18, 23.18);
  const pad = 7;
  const showLabels = state.zoomed || state.mapZoom >= 1.45;

  els.fallbackMap.innerHTML = `
    <div class="map-controls" aria-label="地图缩放">
      <button class="zoom-in" type="button" aria-label="放大地图">+</button>
      <button class="zoom-out" type="button" aria-label="缩小地图">−</button>
      <button class="zoom-reset" type="button">重置</button>
      <button class="zoom-toggle" type="button">${showLabels ? "收起名称" : "显示名称"}</button>
      <span>${state.mapZoom.toFixed(1)}×</span>
    </div>
    <div class="fallback-stage ${state.mapZoom > 1 ? "draggable" : ""}" style="--map-scale:${state.mapZoom};--map-pan-x:${state.mapPan.x}px;--map-pan-y:${state.mapPan.y}px">
      <div class="waterline one"></div>
      <div class="waterline two"></div>
      <div class="city-label gz">广州</div>
      <div class="city-label fs">佛山</div>
      ${items
        .map((item) => {
          const x = clamp(pad + ((item.lng - minLng) / Math.max(maxLng - minLng, 0.001)) * (100 - pad * 2), pad, 100 - pad);
          const y = clamp(100 - pad - ((item.lat - minLat) / Math.max(maxLat - minLat, 0.001)) * (100 - pad * 2), pad, 100 - pad);
          const selected = item.id === state.selectedId ? "selected" : "";
          const name = showLabels ? `<span class="pin-label">${esc(item.name)}</span>` : "";
          return `
            <button class="map-pin ${selected}" data-id="${esc(item.id)}" style="--x:${x}%;--y:${y}%;--pin:${districtColor(item)}" type="button" aria-label="${esc(item.name)}">
              <span class="pin-dot"></span>
              ${name}
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  els.fallbackMap.querySelector(".zoom-toggle").addEventListener("click", () => {
    state.zoomed = !state.zoomed;
    renderAll();
  });
  els.fallbackMap.querySelector(".zoom-in").addEventListener("click", () => {
    state.mapZoom = Math.min(2.4, Number((state.mapZoom + 0.2).toFixed(1)));
    state.mapPan = clampPan(state.mapPan.x, state.mapPan.y);
    renderAll();
  });
  els.fallbackMap.querySelector(".zoom-out").addEventListener("click", () => {
    state.mapZoom = Math.max(1, Number((state.mapZoom - 0.2).toFixed(1)));
    state.mapPan = clampPan(state.mapPan.x, state.mapPan.y);
    renderAll();
  });
  els.fallbackMap.querySelector(".zoom-reset").addEventListener("click", () => {
    state.mapZoom = 1;
    state.mapPan = { x: 0, y: 0 };
    state.zoomed = false;
    renderAll();
  });

  setupMapDrag();

  els.fallbackMap.querySelectorAll(".map-pin").forEach((pin) => {
    pin.addEventListener("click", () => selectRestaurant(pin.dataset.id));
  });
}

function setupMapDrag() {
  const stage = els.fallbackMap.querySelector(".fallback-stage");
  if (!stage) return;
  let start = null;

  stage.addEventListener("pointerdown", (event) => {
    if (state.mapZoom <= 1 || event.target.closest(".map-pin")) return;
    start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: state.mapPan.x,
      panY: state.mapPan.y,
    };
    stage.classList.add("dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.pointerId) return;
    const next = clampPan(start.panX + event.clientX - start.x, start.panY + event.clientY - start.y);
    state.mapPan = next;
    stage.style.setProperty("--map-pan-x", `${next.x}px`);
    stage.style.setProperty("--map-pan-y", `${next.y}px`);
  });

  const endDrag = (event) => {
    if (!start || event.pointerId !== start.pointerId) return;
    stage.classList.remove("dragging");
    start = null;
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
}

function renderLegend() {
  const districts = [...new Map(filteredRestaurants().map((item) => [item.district, item])).values()];
  els.legend.innerHTML = districts
    .map(
      (item) => `
        <button class="legend-item" type="button" data-query="${esc(item.district)}">
          <span style="background:${districtColor(item)}"></span>
          ${esc(item.district)}
        </button>
      `,
    )
    .join("");

  els.legend.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      els.searchInput.value = button.dataset.query;
      state.query = button.dataset.query;
      renderAll();
    });
  });
}

function renderList() {
  const items = filteredRestaurants();
  els.list.innerHTML = items
    .map((item) => {
      const selected = item.id === state.selectedId ? "active" : "";
      const status = mapStatus(item);
      return `
        <button class="restaurant-row ${selected}" type="button" data-id="${esc(item.id)}">
          <span class="district-chip" style="--chip:${districtColor(item)}">${esc(item.district)}</span>
          <span class="row-main">
            <strong>${esc(item.name)}</strong>
            <small>${esc(item.signatureDishes.slice(0, 3).join(" · "))}</small>
          </span>
          <span class="status-pill ${status.key}">${esc(status.label)}</span>
        </button>
      `;
    })
    .join("");

  els.list.querySelectorAll(".restaurant-row").forEach((row) => {
    row.addEventListener("click", () => selectRestaurant(row.dataset.id));
  });
}

function renderDetail() {
  const items = filteredRestaurants();
  const item = items.find((restaurant) => restaurant.id === state.selectedId) ?? items[0];
  if (!item) {
    els.detail.innerHTML = `<p class="empty">没有匹配的餐厅。</p>`;
    return;
  }

  // 过滤掉数据管线内部日志（"高德核实"POI 匹配记录、"系统标记"占位说明），
  // 这些是给维护者看的质检痕迹，不是给食客看的内容。
  const pipelineAuthors = new Set(["高德核实", "系统标记"]);
  const visibleComments = (item.comments ?? []).filter(
    (comment) => !pipelineAuthors.has(comment.author),
  );
  const comments = visibleComments
    .slice(0, 5)
    .map(
      (comment) => `
        <li>
          <p>${esc(comment.content)}</p>
          <span>${esc(comment.author)} · ${esc(comment.likes)} 赞</span>
        </li>
      `,
    )
    .join("");
  const status = mapStatus(item);
  const evidence = locationEvidence(item);
  const mapLink = status.key === "verified" ? amapMarkerUrl(item) : amapSearchUrl(item);
  const mapInfo = `
    <div class="map-info ${status.key}">
      <div class="section-heading compact">
        <h3>地图信息</h3>
        <span class="status-pill ${status.key}">${esc(status.label)}</span>
      </div>
      <p>${esc(status.summary)}</p>
      <dl>
        <div><dt>地址</dt><dd>${esc(item.address)}</dd></div>
        <div><dt>坐标</dt><dd>${typeof item.lng === "number" && typeof item.lat === "number" ? `${item.lng.toFixed(6)}, ${item.lat.toFixed(6)}` : "待补"}</dd></div>
      </dl>
      <a class="map-link" href="${safeUrl(mapLink)}" target="_blank" rel="noreferrer">${status.key === "verified" ? "打开高德位置" : "打开高德搜索"}</a>
    </div>
  `;
  const clueTitle = evidence.length ? "评论位置线索" : "评论线索";

  els.detail.innerHTML = `
    <div class="detail-top">
      <span class="district-chip" style="--chip:${districtColor(item)}">${esc(item.city)} · ${esc(item.district)}</span>
      <span class="status-pill ${status.key}">${esc(status.label)}</span>
    </div>
    <h2>${esc(item.name)}</h2>
    <p class="address">${esc(item.address)}</p>
    <div class="info-grid">
      <div><span>人均</span><strong>${typeof item.pricePerPerson === "number" ? `¥${esc(item.pricePerPerson)}` : "待补"}</strong></div>
      <div><span>菜式</span><strong>${item.signatureDishes.length ? esc(item.signatureDishes.join(" / ")) : "待补"}</strong></div>
    </div>
    ${mapInfo}
    <a class="video-link" href="${safeUrl(item.sourceVideo.url)}" target="_blank" rel="noreferrer">${esc(item.sourceVideo.title)}</a>
    ${visibleComments.length ? `<div class="comments">
      <div class="section-heading compact">
        <h3>${esc(clueTitle)}</h3>
        <span>${esc(visibleComments.length)} 条</span>
      </div>
      <ul>${comments}</ul>
    </div>` : ""}
  `;
}

function selectRestaurant(id) {
  state.selectedId = id;
  renderAll();
}

function tryLoadAmap() {
  const key = window.FOOD_MAP_CONFIG?.amapJsKey;
  if (!key) {
    els.modeLabel.textContent = "原型地图";
    return;
  }

  const script = document.createElement("script");
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
  script.onload = initAmap;
  document.head.appendChild(script);
}

function initAmap() {
  if (!window.AMap) return;
  document.querySelector("#amap").classList.add("ready");
  els.fallbackMap.classList.add("hidden");
  els.modeLabel.textContent = "高德地图";
  state.amap = new window.AMap.Map("amap", {
    zoom: 10,
    center: [113.26, 23.05],
    mapStyle: "amap://styles/macaron",
  });
  syncAmapMarkers();
}

function syncAmapMarkers() {
  if (!state.amap || !window.AMap) return;
  state.markers.forEach((marker) => state.amap.remove(marker));
  state.markers = filteredRestaurants().map((item) => {
    const marker = new window.AMap.Marker({
      position: [item.lng, item.lat],
      title: item.name,
      label: {
        content: esc(item.name),
        direction: "top",
      },
    });
    marker.on("click", () => selectRestaurant(item.id));
    state.amap.add(marker);
    return marker;
  });
}

boot();
