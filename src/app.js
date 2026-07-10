const state = {
  ups: [],
  restaurants: [],
  selectedId: null,
  city: "全部",
  query: "",
  zoomed: false,
  amap: null,
  markers: [],
};

const districtPalette = {
  广州: ["#4eb7a8", "#73c6b6", "#2f9c91", "#8fcfbe", "#5aa897", "#9bd8ca"],
  佛山: ["#5ba8d6", "#7dbbe0", "#408ec4", "#9acbe8", "#6c9ed0", "#4f83bd"],
};

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
  state.selectedId = restaurants[0]?.id ?? null;

  renderUpTabs();
  renderFilters();
  renderAll();
  tryLoadAmap();

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderAll();
  });
}

function renderAll() {
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

function districtColor(item) {
  const districts = [...new Set(state.restaurants.filter((r) => r.city === item.city).map((r) => r.district))];
  const index = Math.max(0, districts.indexOf(item.district));
  const palette = districtPalette[item.city] ?? ["#79b8a9"];
  return palette[index % palette.length];
}

function renderUpTabs() {
  els.upTabs.innerHTML = state.ups
    .map((up) => {
      const initials = up.name.replace(/^探店\s*/, "").slice(0, 2);
      return `
        <a class="up-tab ${up.active ? "active" : ""}" href="${up.spaceUrl}" target="_blank" rel="noreferrer">
          <span class="avatar" style="--accent:${up.accent}">
            ${up.avatar ? `<img src="${up.avatar}" alt="${up.name}" />` : initials}
          </span>
          <span>${up.name}</span>
        </a>
      `;
    })
    .join("");
}

function renderFilters() {
  const cities = ["全部", ...new Set(state.restaurants.map((item) => item.city))];
  els.cityFilters.innerHTML = cities
    .map((city) => `<button class="${city === state.city ? "active" : ""}" type="button">${city}</button>`)
    .join("");
  els.cityFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.city = button.textContent;
      renderFilters();
      renderAll();
    });
  });
}

function renderStats() {
  const items = filteredRestaurants();
  const cityCount = new Set(items.map((item) => item.city)).size;
  const districtCount = new Set(items.map((item) => item.district)).size;
  const avgPrice = Math.round(items.reduce((sum, item) => sum + item.pricePerPerson, 0) / Math.max(items.length, 1));

  els.statsStrip.innerHTML = `
    <article><strong>${items.length}</strong><span>家餐厅</span></article>
    <article><strong>${cityCount}</strong><span>个城市</span></article>
    <article><strong>${districtCount}</strong><span>个区</span></article>
    <article><strong>¥${avgPrice}</strong><span>平均人均</span></article>
  `;
  els.resultCount.textContent = `${items.length} 个结果`;
}

function renderFallbackMap() {
  const items = filteredRestaurants();
  const lngs = items.map((item) => item.lng);
  const lats = items.map((item) => item.lat);
  const minLng = Math.min(...lngs, 113.05);
  const maxLng = Math.max(...lngs, 113.35);
  const minLat = Math.min(...lats, 22.78);
  const maxLat = Math.max(...lats, 23.18);
  const pad = 7;

  els.fallbackMap.innerHTML = `
    <button class="zoom-toggle" type="button">${state.zoomed ? "收起名称" : "显示名称"}</button>
    <div class="waterline one"></div>
    <div class="waterline two"></div>
    <div class="city-label gz">广州</div>
    <div class="city-label fs">佛山</div>
    ${items
      .map((item) => {
        const x = pad + ((item.lng - minLng) / Math.max(maxLng - minLng, 0.001)) * (100 - pad * 2);
        const y = 100 - pad - ((item.lat - minLat) / Math.max(maxLat - minLat, 0.001)) * (100 - pad * 2);
        const selected = item.id === state.selectedId ? "selected" : "";
        const name = state.zoomed ? `<span class="pin-label">${item.name}</span>` : "";
        return `
          <button class="map-pin ${selected}" data-id="${item.id}" style="--x:${x}%;--y:${y}%;--pin:${districtColor(item)}" type="button" aria-label="${item.name}">
            <span class="pin-dot"></span>
            ${name}
          </button>
        `;
      })
      .join("")}
  `;

  els.fallbackMap.querySelector(".zoom-toggle").addEventListener("click", () => {
    state.zoomed = !state.zoomed;
    renderAll();
  });

  els.fallbackMap.querySelectorAll(".map-pin").forEach((pin) => {
    pin.addEventListener("click", () => selectRestaurant(pin.dataset.id));
  });
}

function renderLegend() {
  const districts = [...new Map(filteredRestaurants().map((item) => [item.district, item])).values()];
  els.legend.innerHTML = districts
    .map(
      (item) => `
        <button class="legend-item" type="button" data-query="${item.district}">
          <span style="background:${districtColor(item)}"></span>
          ${item.district}
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
      return `
        <button class="restaurant-row ${selected}" type="button" data-id="${item.id}">
          <span class="district-chip" style="--chip:${districtColor(item)}">${item.district}</span>
          <span class="row-main">
            <strong>${item.name}</strong>
            <small>${item.signatureDishes.slice(0, 3).join(" · ")}</small>
          </span>
          <span class="price">¥${item.pricePerPerson}</span>
        </button>
      `;
    })
    .join("");

  els.list.querySelectorAll(".restaurant-row").forEach((row) => {
    row.addEventListener("click", () => selectRestaurant(row.dataset.id));
  });
}

function renderDetail() {
  const item = state.restaurants.find((restaurant) => restaurant.id === state.selectedId) ?? filteredRestaurants()[0];
  if (!item) {
    els.detail.innerHTML = `<p class="empty">没有匹配的餐厅。</p>`;
    return;
  }

  const comments = item.comments
    .slice(0, 5)
    .map(
      (comment) => `
        <li>
          <p>${comment.content}</p>
          <span>${comment.author} · ${comment.likes} 赞</span>
        </li>
      `,
    )
    .join("");

  els.detail.innerHTML = `
    <div class="detail-top">
      <span class="district-chip" style="--chip:${districtColor(item)}">${item.city} · ${item.district}</span>
      <span class="score">${item.environmentScore.toFixed(1)} 环境</span>
    </div>
    <h2>${item.name}</h2>
    <p class="address">${item.address}</p>
    <div class="info-grid">
      <div><span>人均</span><strong>¥${item.pricePerPerson}</strong></div>
      <div><span>菜式</span><strong>${item.signatureDishes.join(" / ")}</strong></div>
    </div>
    <a class="video-link" href="${item.sourceVideo.url}" target="_blank" rel="noreferrer">${item.sourceVideo.title}</a>
    <div class="comments">
      <div class="section-heading compact">
        <h3>网友补充</h3>
        <span>${item.comments.length} 条</span>
      </div>
      <ul>${comments}</ul>
    </div>
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
        content: item.name,
        direction: "top",
      },
    });
    marker.on("click", () => selectRestaurant(item.id));
    state.amap.add(marker);
    return marker;
  });
}

boot();
