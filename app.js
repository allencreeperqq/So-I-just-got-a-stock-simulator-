const STORAGE_KEY = "stocksim_session_v1";

const state = {
  cash: 1_000_000,
  holdings: {},
  favorites: [
    { symbol: "0050.TW", name: "元大台灣50", market: "台股", note: "ETF" },
    { symbol: "2330.TW", name: "台積電", market: "台股", note: "半導體" },
    { symbol: "2317.TW", name: "鴻海", market: "台股", note: "電子製造" },
    { symbol: "NVDA", name: "NVIDIA", market: "美股", note: "AI GPU" },
    { symbol: "AAPL", name: "APPLE", market: "美股", note: "消費電子" },
    { symbol: "MSFT", name: "Microsoft", market: "美股", note: "雲端軟體" },
    { symbol: "AMZN", name: "Amazon", market: "美股", note: "電商" },
    { symbol: "TSLA", name: "Tesla", market: "美股", note: "電動車" },
    { symbol: "META", name: "Meta", market: "美股", note: "社群" },
    { symbol: "GOOGL", name: "Alphabet", market: "美股", note: "搜尋" },
  ],
  marketSymbol: "AAPL",
  marketSeries: [],
  assetSeries: [],
  hasTrades: false,
};

const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll(".nav-btn");
const loginBtn = document.getElementById("loginBtn");
const loginPanel = document.getElementById("login");
const appPanel = document.getElementById("app");
const assetValue = document.getElementById("assetValue");
const assetChart = document.getElementById("assetChart");
const holdingsList = document.getElementById("holdingsList");
const favoritesList = document.getElementById("favoritesList");
const assetTable = document.getElementById("assetTable");
const hint = document.getElementById("hint");
const riskBadge = document.getElementById("riskBadge");

const marketInput = document.getElementById("marketInput");
const marketSearch = document.getElementById("marketSearch");
const marketSymbol = document.getElementById("marketSymbol");
const marketPrice = document.getElementById("marketPrice");
const marketVol = document.getElementById("marketVol");
const marketChart = document.getElementById("marketChart");
const marketMeta = document.getElementById("marketMeta");

const tradeSymbol = document.getElementById("tradeSymbol");
const tradeQty = document.getElementById("tradeQty");
const tradeBuy = document.getElementById("tradeBuy");
const tradeStatus = document.getElementById("tradeStatus");
const tradeMarketSymbol = document.getElementById("tradeMarketSymbol");
const tradeMarketPrice = document.getElementById("tradeMarketPrice");
const tradeMarketVol = document.getElementById("tradeMarketVol");
const tradeChart = document.getElementById("tradeChart");
const tradeMeta = document.getElementById("tradeMeta");

const formatMoney = (value) =>
  `$${Math.round(value).toLocaleString("en-US")}`;

const formatPrice = (value) => `$${Number(value).toFixed(2)}`;

const loadState = () => {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw);
    if (typeof saved.cash === "number") {
      state.cash = saved.cash;
    }
    if (saved.holdings && typeof saved.holdings === "object") {
      state.holdings = saved.holdings;
    }
    if (typeof saved.marketSymbol === "string") {
      state.marketSymbol = saved.marketSymbol;
    }
    if (typeof saved.hasTrades === "boolean") {
      state.hasTrades = saved.hasTrades;
    }
  } catch (error) {
    console.warn("Session state load failed", error);
  }
};

const persistState = () => {
  const payload = {
    cash: state.cash,
    holdings: state.holdings,
    marketSymbol: state.marketSymbol,
    hasTrades: state.hasTrades,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const toStooqSymbol = (symbol) => {
  const upper = symbol.trim().toUpperCase();
  if (!upper) {
    return "aapl.us";
  }
  if (upper.endsWith(".TW")) {
    return upper.toLowerCase();
  }
  if (/^\d{4,5}$/.test(upper)) {
    return `${upper}.tw`.toLowerCase();
  }
  return `${upper}.us`.toLowerCase();
};

const fetchStooqSeries = async (symbol, points = 24) => {
  const stooqSymbol = toStooqSymbol(symbol);
  const sourceUrl = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
  const proxyUrl = `https://r.jina.ai/http://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
  const response = await fetch(proxyUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Crawler fetch failed");
  }
  const text = await response.text();
  const lines = text.trim().split("\n");
  const rows = lines
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  const closes = [];
  const volumes = [];
  rows.forEach((row) => {
    const parts = row.split(",");
    if (parts.length < 6) {
      return;
    }
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (!Number.isNaN(close)) {
      closes.push(close);
    }
    if (!Number.isNaN(volume)) {
      volumes.push(volume);
    }
  });
  if (!closes.length) {
    throw new Error("No crawler data");
  }
  const series = closes.slice(-points);
  const latest = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : latest;
  const latestVolume = volumes.length ? volumes[volumes.length - 1] : 0;
  return {
    series,
    latest,
    prev,
    volume: latestVolume,
    sourceName: "stooq.com",
    sourceUrl,
  };
};

const renderLineChart = (canvas, series, color, labels) => {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (!series.length) {
    return;
  }

  const padding = 32;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(1, max - min);
  const tickCount = 4;

  ctx.strokeStyle = "rgba(19, 33, 58, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  ctx.fillStyle = "rgba(19, 33, 58, 0.55)";
  ctx.font = "11px Space Grotesk";
  for (let i = 0; i <= tickCount; i += 1) {
    const ratio = i / tickCount;
    const value = max - range * ratio;
    const y = padding + ratio * (height - padding * 2);
    ctx.fillText(value.toFixed(2), 6, y + 4);
  }

  const xTicks = Math.min(series.length - 1, 4);
  for (let i = 0; i <= xTicks; i += 1) {
    const ratio = i / xTicks;
    const x = padding + ratio * (width - padding * 2);
    const label = `${Math.round(ratio * (series.length - 1))}`;
    ctx.fillText(label, x - 6, height - 8);
  }

  if (labels?.yLabel) {
    ctx.save();
    ctx.translate(14, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(labels.yLabel, 0, 0);
    ctx.restore();
  }
  if (labels?.xLabel) {
    ctx.fillText(labels.xLabel, width - padding - 48, height - 10);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  series.forEach((value, index) => {
    const x =
      padding + (index / (series.length - 1)) * (width - padding * 2);
    const y =
      padding + (1 - (value - min) / range) * (height - padding * 2);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = "rgba(248, 178, 77, 0.15)";
  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fill();
};

const updateMarket = async (symbol) => {
  const normalized = symbol.trim().toUpperCase() || "AAPL";
  state.marketSymbol = normalized;
  marketSymbol.textContent = normalized;
  marketPrice.textContent = "擷取中...";
  marketVol.textContent = "--";
  tradeMarketSymbol.textContent = normalized;
  tradeMarketPrice.textContent = "擷取中...";
  tradeMarketVol.textContent = "--";
  marketMeta.textContent = "來源：--｜更新時間：--";
  tradeMeta.textContent = "來源：--｜更新時間：--";

  try {
    const result = await fetchStooqSeries(normalized, 24);
    state.marketSeries = result.series;
    const latest = result.latest;
    const volatility =
      ((Math.max(...state.marketSeries) - Math.min(...state.marketSeries)) /
        latest) *
      100;
    const updatedAt = new Date().toLocaleString("zh-TW", { hour12: false });
    const metaText = `來源：${result.sourceName}｜更新時間：${updatedAt}`;

    marketPrice.textContent = formatPrice(latest);
    marketVol.textContent = `${volatility.toFixed(1)}%`;
    tradeMarketPrice.textContent = formatPrice(latest);
    tradeMarketVol.textContent = `${volatility.toFixed(1)}%`;
    marketMeta.textContent = metaText;
    tradeMeta.textContent = metaText;

    renderLineChart(marketChart, state.marketSeries, "#52c1b2", {
      xLabel: "時間(天)",
      yLabel: "價格",
    });
    renderLineChart(tradeChart, state.marketSeries.slice(-12), "#f28d28", {
      xLabel: "時間(天)",
      yLabel: "價格",
    });
    persistState();
  } catch (error) {
    marketPrice.textContent = "擷取失敗";
    tradeMarketPrice.textContent = "擷取失敗";
    console.warn("Crawler error", error);
  }
};

const updateAssetSeries = () => {
  const base = state.cash + getHoldingsValue();
  const points = 16;
  if (!state.hasTrades) {
    state.assetSeries = Array.from({ length: points }, () => base);
  } else {
    const range = Math.max(1, base * 0.008);
    state.assetSeries = Array.from({ length: points }, (_, index) => {
      const drift = Math.sin(index / 2) * range * 0.6;
      const slope = (index - points / 2) * (range * 0.05);
      return Math.max(0, base + drift + slope);
    });
  }
  renderLineChart(assetChart, state.assetSeries, "#13213a", {
    xLabel: "時間(天)",
    yLabel: "資產",
  });
};

const getHoldingsValue = () =>
  Object.values(state.holdings).reduce(
    (sum, item) => sum + item.qty * item.price,
    0
  );

const renderHoldings = () => {
  holdingsList.innerHTML = "";
  const entries = Object.entries(state.holdings);

  if (!entries.length) {
    holdingsList.innerHTML =
      "<div class=\"list-item\">尚未持有股票</div>";
    return;
  }

  entries.forEach(([symbol, item]) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<span>${symbol}</span><span>${item.qty} 股</span>`;
    holdingsList.appendChild(row);
  });
};

const renderAssetsTable = () => {
  assetTable.innerHTML = "";
  const entries = Object.entries(state.holdings);

  if (!entries.length) {
    assetTable.innerHTML =
      "<tr><td colspan=\"4\">目前沒有持倉</td></tr>";
    return;
  }

  entries.forEach(([symbol, item]) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${symbol}</td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.avgCost)}</td>
      <td>${formatMoney(item.qty * item.price)}</td>
    `;
    assetTable.appendChild(row);
  });
};

const renderFavorites = () => {
  favoritesList.innerHTML = "";
  state.favorites.forEach((favorite) => {
    const item = document.createElement("div");
    item.className = "favorite-item";
    item.innerHTML = `
      <div class="favorite-head">
        <div>
          <div class="favorite-name">${favorite.name}</div>
          <div class="favorite-note">${favorite.market}・${favorite.note}</div>
        </div>
        <strong>${favorite.symbol}</strong>
      </div>
      <div class="favorite-metrics">
        <span>價格：擷取中...</span>
        <span>漲跌：--</span>
        <span>成交量：--</span>
      </div>
    `;
    favoritesList.appendChild(item);

    fetchStooqSeries(favorite.symbol, 10)
      .then((result) => {
        const change = result.prev ?
          ((result.latest - result.prev) / result.prev) * 100 :
          0;
        const metrics = item.querySelector(".favorite-metrics");
        metrics.innerHTML = `
          <span>價格：${formatPrice(result.latest)}</span>
          <span>漲跌：${change.toFixed(2)}%</span>
          <span>成交量：${result.volume.toLocaleString("en-US")}</span>
        `;
      })
      .catch((error) => {
        const metrics = item.querySelector(".favorite-metrics");
        metrics.innerHTML = "<span>爬蟲資料擷取失敗</span>";
        console.warn("Favorite crawler error", error);
      });
  });
};

const updateTotals = () => {
  const total = state.cash + getHoldingsValue();
  assetValue.textContent = formatMoney(total);
  const riskLevel = total > 1_050_000 ? "低" : total < 980_000 ? "偏高" : "中性";
  riskBadge.textContent = `風險：${riskLevel}`;
};

const handleBuy = async () => {
  const symbol = tradeSymbol.value.trim().toUpperCase();
  const qty = Number(tradeQty.value);
  if (!symbol || Number.isNaN(qty) || qty <= 0) {
    tradeStatus.textContent = "請輸入有效的股票代號與股數。";
    return;
  }
  tradeStatus.textContent = "爬蟲擷取價格中...";

  let price = 0;
  try {
    const result = await fetchStooqSeries(symbol, 4);
    price = result.latest;
  } catch (error) {
    tradeStatus.textContent = "爬蟲擷取失敗，無法完成下單。";
    console.warn("Trade crawler error", error);
    return;
  }

  const cost = price * qty;
  if (cost > state.cash) {
    tradeStatus.textContent = "資金不足，請降低股數或更換股票。";
    return;
  }

  const holding = state.holdings[symbol] ?? { qty: 0, avgCost: 0, price };
  const newQty = holding.qty + qty;
  const newAvg = (holding.avgCost * holding.qty + cost) / newQty;
  state.holdings[symbol] = { qty: newQty, avgCost: newAvg, price };
  state.cash -= cost;
  state.hasTrades = true;

  persistState();

  tradeStatus.textContent = `已模擬買入 ${symbol} ${qty} 股，成交價 ${formatPrice(
    price
  )}`;

  updateTotals();
  renderHoldings();
  renderAssetsTable();
  updateAssetSeries();
};

const switchView = (view) => {
  views.forEach((section) => {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  });
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  const hints = {
    home: "在首頁檢視資產總覽與持倉。",
    market: "輸入股票代號即可模擬今日股市。",
    trade: "完成買入後可在資產頁查看。",
    assets: "此處整理你的持倉與市值。",
  };
  hint.textContent = hints[view] ?? "";
};

loginBtn.addEventListener("click", () => {
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  updateMarket(state.marketSymbol);
  renderFavorites();
  renderHoldings();
  renderAssetsTable();
  updateTotals();
  updateAssetSeries();
});

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

marketSearch.addEventListener("click", () => {
  updateMarket(marketInput.value);
});

tradeBuy.addEventListener("click", handleBuy);

loadState();
updateMarket(state.marketSymbol);
renderFavorites();
renderHoldings();
renderAssetsTable();
updateTotals();
updateAssetSeries();
