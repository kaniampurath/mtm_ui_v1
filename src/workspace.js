import { ContextBus, EventBus, LINK_GROUPS, MemoryDashboardRepository } from "./framework.js?v=20260531e";
import { capabilityPlugins, categories } from "./plugins.js?v=20260626a";

const GRID_COLUMNS = 24, ROW_HEIGHT = 24, MAX_WIDGETS = 20;
const SCREENER_PAGE_SIZE = 240;
const WORKSPACE_NAV = ["Dashboard", "Market", "Scanner", "Signal", "Trading", "Risk", "Portfolio", "Agents"];
const navItems = ["Home", ...WORKSPACE_NAV, "Marketplace", "Profile", "Settings", "Help"];
const pluginById = new Map(capabilityPlugins.map((plugin) => [plugin.id, plugin]));
const guestAppIds = ["screener", "watchlist", "market-brief", "market-cockpit", "market-monitor", "market-cycle-tracker", "sector-cockpit", "industry-cockpit", "leaders-cockpit"];
const userRoles = ["admin", "power_user", "guest"];
const subscriptionStatuses = ["active", "inactive", "trial", "expired"];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const workspaceSeeds = {
  dashboard: ["screener"],
  market: ["market-monitor", "market-cycle-tracker", "market-cockpit", "sector-cockpit", "industry-cockpit", "leaders-cockpit", "market-brief", "heat-map", "market-breadth", "chart"],
  scanner: ["screener"],
  signal: ["signals-cockpit"],
  trading: ["trading-system-monitor"],
  risk: ["risk-cockpit", "market-cycle-tracker", "exposure-monitor", "drawdown-monitor", "market-breadth"],
  portfolio: ["watchlist", "performance-chart", "position-monitor", "market-brief"],
  agents: ["rs-daily-agent", "rs-data-monitor-agent", "pipeline-monitor-agent", "rs-ranking-agent", "bots-lab", "live-cache-monitor", "candle-cache"]
};
const defaultPreferences = { theme: "dark", density: "comfortable", defaultWorkspaceId: "dashboard-default", defaultDashboardWorkspaceId: "dashboard-default", autoSave: true, autoRestore: true, sidebarExpanded: false, defaultRefreshInterval: 60, liveRefresh: false, confirmWorkspaceDelete: true, confirmAppRemove: true, notifications: true, widgetStyle: "standard" };
const preferredWidgetSizes = {
  "screener": { w: 24, h: 30 },
  "market-monitor": { w: 24, h: 30 },
  "market-cycle-tracker": { w: 14, h: 18 },
  "market-cockpit": { w: 12, h: 16 },
  "signals-cockpit": { w: 24, h: 30 },
  "sector-cockpit": { w: 10, h: 15 },
  "industry-cockpit": { w: 10, h: 15 },
  "leaders-cockpit": { w: 12, h: 16 }
  , "trading-system-monitor": { w: 24, h: 30 }
  , "mark-minervini-screen": { w: 24, h: 30 }
  , "risk-cockpit": { w: 14, h: 18 }
  , "rs-daily-agent": { w: 14, h: 18 }
  , "pipeline-monitor-agent": { w: 12, h: 16 }
  , "rs-data-monitor-agent": { w: 14, h: 18 }
  , "rs-ranking-agent": { w: 12, h: 16 }
  , "bots-lab": { w: 12, h: 16 }
  , "live-cache-monitor": { w: 10, h: 12 }
  , "candle-cache": { w: 12, h: 16 }
};

const screenerColumnCatalog = [
  { key: "symbol", label: "Symbol", category: "General", width: "70px", type: "text", pinned: "left", description: "Ticker symbol from rs_daily cache." },
  { key: "close", label: "Last", category: "Price & Volume", width: "68px", type: "price", digits: 2, description: "Latest cached daily close." },
  { key: "perf_1d_pct", label: "% Today", category: "Price & Volume", width: "72px", type: "percent", digits: 2, description: "Daily percent change when present in rs_daily." },
  { key: "dcr", label: "DCR", category: "Technicals", width: "58px", type: "number", digits: 0, description: "Daily closing range: close position inside today's high-low range." },
  { key: "wcr", label: "WCR", category: "Technicals", width: "58px", type: "number", digits: 0, description: "Weekly closing range approximation from last five daily bars." },
  { key: "volume", label: "Volume", category: "Price & Volume", width: "78px", type: "volume", description: "Latest daily volume." },
  { key: "industry", label: "Industry", category: "Sector & Industry", width: "150px", type: "text", description: "Industry from rs_daily/stock master cache." },
  { key: "rv20", label: "RV20", category: "Price & Volume", width: "58px", type: "number", digits: 2, description: "Relative volume versus 20-day average volume." },
  { key: "ud_50d", label: "U/D 50D", category: "Technicals", width: "68px", type: "number", digits: 2, description: "50-day up-volume to down-volume ratio." },
  { key: "c20", label: "C20", category: "StockBee", width: "62px", type: "percent", digits: 1, description: "StockBee 20-trading-day price change." },
  { key: "rs_score", label: "RS Score", category: "Relative Strength", width: "70px", type: "score", digits: 1, description: "Relative strength score from cached rs_daily fields." },
  { key: "rs_rank", label: "RS Rank", category: "Relative Strength", width: "70px", type: "number", digits: 0, description: "Rank by RS Score across the latest cached universe." },
  { key: "trend_score", label: "Trend", category: "Technicals", width: "64px", type: "score", digits: 1, description: "Price and moving-average trend composite." },
  { key: "tqs_score", label: "TQS", category: "Technicals", width: "56px", type: "score", digits: 0, description: "Trend Quality Score from the decision-support cache." },
  { key: "es_score", label: "ES", category: "Technicals", width: "52px", type: "score", digits: 0, description: "Extension Score from the decision-support cache. Lower is better." },
  { key: "brs_score", label: "BRS", category: "Technicals", width: "56px", type: "score", digits: 0, description: "Breakout Readiness Score from the decision-support cache." },
  { key: "cs_score", label: "CS", category: "Technicals", width: "52px", type: "score", digits: 0, description: "Conviction Score from the decision-support cache." },
  { key: "rmv", label: "RMV", category: "Technicals", width: "58px", type: "score", digits: 1, description: "Relative measured volatility from ATR 3/5/8 compression range." },
  { key: "rmv_zone", label: "RMV Zone", category: "Technicals", width: "118px", type: "text", description: "Compression/expansion interpretation for RMV." },
  { key: "vcp_score", label: "VCP", category: "VCP", width: "58px", type: "score", digits: 1, description: "VCP setup score from compression, momentum, and relative volume." },
  { key: "cheat_entry_score", label: "Cheat", category: "Cheat Entry", width: "64px", type: "score", digits: 1, description: "Cheat-entry setup score." },
  { key: "breakout_score", label: "Breakout", category: "Technicals", width: "72px", type: "score", digits: 1, description: "Breakout readiness score." },
  { key: "momentum_burst_score", label: "Burst", category: "Momentum Burst", width: "62px", type: "score", digits: 1, description: "Momentum burst score." },
  { key: "accumulation_score", label: "Accum", category: "Institutions & Insiders", width: "64px", type: "score", digits: 1, description: "Accumulation score from U/D volume, RV20, and DCR." },
  { key: "high_52w_today", label: "52W High", category: "Technicals", width: "70px", type: "boolean", description: "True when today's high reaches the cached 52-week high." },
  { key: "pct_off_52w_high", label: "% Off 52W", category: "Technicals", width: "76px", type: "percent", digits: 1, description: "Percent distance from 52-week high." },
  { key: "price_vs_50sma", label: "vs 50SMA", category: "Technicals", width: "76px", type: "percent", digits: 1, description: "Percent distance from 50-day SMA." },
  { key: "price_vs_200sma", label: "vs 200SMA", category: "Technicals", width: "84px", type: "percent", digits: 1, description: "Percent distance from 200-day SMA." },
  { key: "dollar_volume", label: "$ Volume", category: "Price & Volume", width: "96px", type: "money", description: "Close multiplied by volume." },
  { key: "industry_rs", label: "Industry RS", category: "Sector & Industry", width: "84px", type: "score", digits: 1, description: "Reserved for industry relative strength cache." },
  { key: "sector", label: "Sector", category: "Sector & Industry", width: "120px", type: "text", description: "Sector from rs_daily/stock master cache." },
  { key: "ti65_mom", label: "TI65", category: "StockBee", width: "58px", type: "number", digits: 2, description: "StockBee TI65 momentum ratio." },
  { key: "mdt_mom", label: "MDT", category: "StockBee", width: "58px", type: "number", digits: 2, description: "Medium-term momentum ratio." },
  { key: "dt_mom", label: "DT", category: "StockBee", width: "58px", type: "number", digits: 2, description: "Distance from 252-day low ratio." }
];
const screenerPresetColumns = {
  Recommended: ["symbol", "close", "perf_1d_pct", "tqs_score", "es_score", "brs_score", "cs_score", "dcr", "wcr", "volume", "industry", "rv20", "ud_50d", "c20", "rs_rank", "rs_score", "trend_score", "rmv", "rmv_zone", "vcp_score", "cheat_entry_score", "breakout_score", "momentum_burst_score", "accumulation_score", "high_52w_today", "pct_off_52w_high", "price_vs_50sma", "price_vs_200sma", "dollar_volume", "industry_rs"],
  "Price & Volume": ["symbol", "close", "perf_1d_pct", "volume", "rv20", "dollar_volume", "dcr", "wcr"],
  Technicals: ["symbol", "close", "tqs_score", "es_score", "brs_score", "cs_score", "dcr", "wcr", "rmv", "rmv_zone", "trend_score", "price_vs_50sma", "price_vs_200sma", "pct_off_52w_high"],
  StockBee: ["symbol", "close", "c20", "rmv", "rv20", "ti65_mom", "mdt_mom", "dt_mom", "breakout_score"],
  "Momentum Burst": ["symbol", "close", "perf_1d_pct", "c20", "rv20", "momentum_burst_score", "rs_score", "dollar_volume"],
  VCP: ["symbol", "close", "rmv", "rmv_zone", "vcp_score", "rv20", "dcr", "pct_off_52w_high"],
  "Cheat Entry": ["symbol", "close", "cheat_entry_score", "dcr", "rmv", "c20", "rv20"],
  "Relative Strength": ["symbol", "close", "rs_score", "trend_score", "c20", "industry", "sector"],
  "AI Leaders": ["symbol", "close", "rs_score", "trend_score", "breakout_score", "momentum_burst_score", "accumulation_score"]
};
const defaultScreenerView = { preset: "Recommended", columns: screenerPresetColumns.Recommended, sort: { key: "rs_rank", dir: "asc" }, filters: [], rs250: true, autoRefresh: false, scoreColorMode: "badge" };
const screenerChartIndicatorCatalog = [
  { key: "sma20", label: "SMA 20", type: "overlay", description: "20-day simple moving average on price." },
  { key: "sma50", label: "SMA 50", type: "overlay", description: "50-day simple moving average on price." },
  { key: "ti65_mom", label: "TI65", type: "pane", description: "StockBee TI65 momentum ratio." },
  { key: "mdt_mom", label: "MDT", type: "pane", description: "Medium-term momentum ratio." },
  { key: "c20", label: "C20", type: "pane", description: "20-day price change percent." },
  { key: "rmv", label: "RMV", type: "pane", description: "Relative measured volatility." },
  { key: "m21_mom", label: "21", type: "pane", description: "21-day momentum ratio." },
  { key: "m10_mom", label: "10", type: "pane", description: "10-day momentum ratio." },
  { key: "m5_mom", label: "5", type: "pane", description: "5-day momentum ratio." },
  { key: "dt_mom", label: "DT", type: "pane", description: "Distance from 252-day low ratio." },
  { key: "ti42_mom", label: "TI42", type: "pane", description: "TI42 momentum reading." }
];
const defaultChartIndicators = ["sma20", "sma50", "ti65_mom"];
const defaultDecisionOverlaySettings = { showScorePanel: true, showScoreTooltips: true, showSituation: true, showPersonality: true, showValidation: true, showCommentary: true, compactMode: false, position: "top-right" };

export async function createWorkspace(root, session = {}) {
  window.mtmUiSession = session;
  const userId = session.user?.username || "pilot-local-user";
  const repository = new MemoryDashboardRepository(userId);
  const eventBus = new EventBus();
  const contextBus = new ContextBus(eventBus);
  const timers = new Map();
  const inFlightHydrates = new Set();
  const savedProfile = await repository.loadProfile();
  const savedPreferences = await repository.loadPreferences();
  const savedDashboard = await repository.loadDashboard();
  let workspaces = await repository.loadWorkspaces();
  const savedScreenerView = await repository.read("screener_view");
  const savedScreenerResearch = await repository.read("screener_research_actions");
  if (!workspaces?.length) workspaces = bootstrapWorkspaces(savedDashboard);
  const state = {
    activeNav: "Home", activeView: "home", drawerOpen: false, eventLog: [],
    workspaces, templates: await repository.loadTemplates(),
    preferences: { ...defaultPreferences, ...(savedProfile || {}), ...(savedPreferences || {}) },
    profile: savedProfile || { userId, displayName: session.user?.displayName || userId }, profileTokens: null, tokenEditMode: false, tokenMessage: "", screenerView: normalizeScreenerView(savedScreenerView), screenerResearch: normalizeScreenerResearch(savedScreenerResearch), minerviniEsFilter: "all", lastUsersPayload: null, lastRsDailyRefreshJobId: null, liveEvents: [], liveStatus: null
  };
  state.activeWorkspaceId = resolveInitialWorkspace(state.workspaces, state.preferences).id;
  let liveEventSource = null;
  sanitizeWorkspaces();
  root.innerHTML = shellTemplate(); bindShell(); renderMain(); persistAll(); hydrateBusinessDayStatus();
  const businessDayTimer = setInterval(hydrateBusinessDayStatus, 30000);
  eventBus.on("*", (event) => { state.eventLog = [event, ...state.eventLog].slice(0, 6); renderEventLog(); });
  eventBus.on("context_updated", (event) => renderWidgets(event.link_group));
  eventBus.on("rs_daily_refresh_completed", hydrateBusinessDayStatus);
  initLiveEvents();

  function shellTemplate() {
    return `<div class="app-shell" data-theme="${e(state.preferences.theme)}" data-density="${e(state.preferences.density)}">
      <aside class="left-rail" data-expanded="${state.preferences.sidebarExpanded ? "true" : "false"}"><button class="rail-toggle" title="Expand navigation">=</button><nav>${navItems.map((item) => `<button class="rail-item ${item === state.activeNav ? "active" : ""}" title="${item}" data-nav="${item}"><span>${iconFor(item)}</span><em>${item}</em></button>`).join("")}</nav><div class="rail-bottom"><button title="Notifications">!</button><button title="Help" data-nav="Help">?</button><button class="avatar" title="Profile" data-nav="Profile">${avatarText()}</button></div></aside>
      <main class="workspace-shell"><header class="top-bar"><div class="search-wrap"><span>Search</span><input placeholder="Symbols, apps, workspaces" /></div><div class="dashboard-picker"><select data-workspace-select>${workspaceOptions()}</select><button data-dashboard-menu title="Workspace actions">...</button><div class="dashboard-menu" hidden data-actions-menu>${["Create", "Rename", "Duplicate", "Delete", "Save Template", "Load Template", "Set Default"].map((x) => `<button data-workspace-action="${x.toLowerCase().replaceAll(" ", "-")}">${x}</button>`).join("")}</div></div><button class="primary" data-add-apps>+ Add Apps</button>${session.user?.role === "admin" ? `<button class="secondary" data-user-management>Users</button>` : ""}<div class="business-day-status tone-loading" data-business-day title="Checking completed Nasdaq OHLCV business day"><span></span><div><small>Business Day</small><strong>Checking...</strong></div></div><div class="user-status"><span></span> ${userStatusLabel(session)}</div></header><section class="canvas-wrap" data-main></section></main>
      <aside class="apps-drawer" data-drawer><div class="drawer-head"><div><h2>Add Apps</h2><p>Shared app catalog</p></div><button data-close-drawer>x</button></div><div class="drawer-search"><input data-plugin-filter placeholder="Filter apps" /></div><div class="drawer-list" data-plugin-list>${catalogTemplate("drawer")}</div></aside></div>`;
  }
  async function hydrateBusinessDayStatus() {
    const host = root.querySelector("[data-business-day]");
    if (!host) return;
    try {
      const data = await api(`/api/home/business-day?ts=${Date.now()}`, null, "GET");
      if (data.error) throw new Error(data.error);
      const tone = data.isCurrent ? "green" : "red";
      host.className = `business-day-status tone-${tone}`;
      host.title = `${data.message || ""} Latest loaded ${data.latestLoadedDate || "none"}; coverage ${data.coverageRatio ?? 0}% (${data.dueSymbols || 0}/${data.expectedSymbols || 0}); invalid OHLCV ${data.dueBadOhlcv || 0}${data.updating ? "; update running" : ""}`;
      host.innerHTML = `<span></span><div><small>NASDAQ Business Day</small><strong>${e(data.latestCompleteDate || "No complete load")}</strong><em>Due ${e(data.dueDate || "NA")}${data.updating ? " | Updating" : ""}</em></div>`;
    } catch (error) {
      host.className = "business-day-status tone-red";
      host.title = error.message;
      host.innerHTML = `<span></span><div><small>NASDAQ Business Day</small><strong>Status unavailable</strong></div>`;
    }
  }
  function bindShell() {
    root.querySelector(".rail-toggle").addEventListener("click", () => { const rail = root.querySelector(".left-rail"); state.preferences.sidebarExpanded = rail.dataset.expanded !== "true"; rail.dataset.expanded = String(state.preferences.sidebarExpanded); persistPreferences(); });
    root.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
    root.querySelector("[data-workspace-select]").addEventListener("change", (ev) => { if (ev.target.value === "__create__") createWorkspaceAction(); else loadWorkspace(ev.target.value, "Dashboard"); });
    root.querySelector("[data-add-apps]").addEventListener("click", () => toggleDrawer(true)); root.querySelector("[data-close-drawer]").addEventListener("click", () => toggleDrawer(false));
    root.querySelector("[data-dashboard-menu]").addEventListener("click", () => { const menu = root.querySelector("[data-actions-menu]"); menu.hidden = !menu.hidden; });
    root.querySelectorAll("[data-workspace-action]").forEach((b) => b.addEventListener("click", () => runWorkspaceAction(b.dataset.workspaceAction)));
    root.querySelector("[data-plugin-filter]").addEventListener("input", (ev) => { root.querySelector("[data-plugin-list]").innerHTML = catalogTemplate("drawer", ev.target.value); bindCatalogButtons(root.querySelector("[data-plugin-list]")); });
    root.querySelector("[data-user-management]")?.addEventListener("click", openUserManagement); bindCatalogButtons(root.querySelector("[data-plugin-list]"));
  }
  function renderMain() {
    const main = root.querySelector("[data-main]");
    root.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === state.activeNav));
    root.querySelector("[data-workspace-select]").innerHTML = workspaceOptions(); root.querySelector("[data-workspace-select]").value = state.activeWorkspaceId;
    if (state.activeView === "workspace") { const w = currentWorkspace(); main.innerHTML = `<div class="canvas-head"><div><h1>${e(w.name)}</h1><p>${e(w.typeLabel || "Workspace")} workspace</p></div><div><span data-save-state>Saved</span><button data-theme-toggle>Theme</button></div></div><div class="workspace-canvas" data-canvas></div>`; main.querySelector("[data-theme-toggle]").addEventListener("click", () => { state.preferences.theme = state.preferences.theme === "dark" ? "light" : "dark"; root.querySelector(".app-shell").dataset.theme = state.preferences.theme; persistPreferences(); }); renderWidgets(); scheduleRefreshes(); return; }
    clearRefreshes();
    if (state.activeView === "home") main.innerHTML = homeTemplate();
    if (state.activeView === "marketplace") main.innerHTML = marketplaceTemplate();
    if (state.activeView === "profile") main.innerHTML = profileTemplate();
    if (state.activeView === "settings") main.innerHTML = settingsTemplate();
    if (state.activeView === "help") main.innerHTML = `<section class="module-page"><header><h1>Workspace OS</h1><p>Dashboard is your selected default workspace. Apps are isolated workspace instances with refresh/state contracts.</p></header></section>`;
    bindPageActions(main);
  }
  function navigate(item) { state.activeNav = item; if (item === "Home") state.activeView = "home"; else if (item === "Marketplace") state.activeView = "marketplace"; else if (item === "Profile") state.activeView = "profile"; else if (item === "Settings") state.activeView = "settings"; else if (item === "Help") state.activeView = "help"; else { state.activeView = "workspace"; const type = item === "Dashboard" ? "dashboard" : item.toLowerCase(); const w = item === "Dashboard" ? defaultDashboardWorkspace() : workspaceForType(type); state.activeWorkspaceId = w.id; } renderMain(); persistPreferences(); }
  function loadWorkspace(id, nav = "Dashboard") { state.activeWorkspaceId = id; state.activeNav = nav; state.activeView = "workspace"; renderMain(); persistPreferences(); }
  function bindPageActions(scope) { bindCatalogButtons(scope); scope.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav))); scope.querySelectorAll("[data-setting]").forEach((i) => i.addEventListener("change", () => updateSetting(i))); scope.querySelector("[data-change-password]")?.addEventListener("submit", changePassword); scope.querySelector("[data-profile-token-form]")?.addEventListener("submit", saveProfileTokens); scope.querySelector("[data-modify-profile-tokens]")?.addEventListener("click", () => { state.tokenEditMode = true; renderProfilePanel(); }); scope.querySelector("[data-cancel-profile-tokens]")?.addEventListener("click", () => { state.tokenEditMode = false; state.tokenMessage = ""; renderProfilePanel(); }); scope.querySelector("[data-logout]")?.addEventListener("click", logout); scope.querySelector("[data-refresh-home]")?.addEventListener("click", () => hydrateHomeCommandCenter(true)); if (state.activeView === "home") hydrateHomeCommandCenter(); if (state.activeView === "profile" && !state.profileTokens) loadProfileTokens(); }
  function homeTemplate() {
    return `<section class="home-command-page"><section class="home-hero"><div class="mtm-emblem">MTM</div><div><h1>MyTradingMind.ai</h1><h2>Market First. Leadership Next. Execution Last.</h2><p>MyTradingMind.ai is a market intelligence and trade execution platform designed to identify market regimes, track sector leadership, surface high-probability opportunities, manage risk, and support systematic trading decisions.</p></div><button data-refresh-home>Refresh</button></section><section data-home-command-center><div class="widget-loading">Loading market hierarchy cache...</div></section></section>`;
  }

  async function hydrateHomeCommandCenter(force = false) {
    const host = root.querySelector("[data-home-command-center]");
    if (!host) return;
    try {
      const [data, setup] = await Promise.all([
        api(`/api/home/hierarchy${force ? "?refresh=1" : ""}`, null, "GET"),
        api(`/api/home/setup-status?ts=${Date.now()}`, null, "GET")
      ]);
      if (data.warming) {
        host.innerHTML = `${homeCommandCenterTemplate({}, setup)}<div class="home-cache-loading"><strong>Market hierarchy cache is warming</strong><p>${e(data.message || "Preparing hierarchy data.")}</p><div class="cache-progress-track"><span style="--w:45%"></span></div></div>`;
        host.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
        setTimeout(() => hydrateHomeCommandCenter(false), 8000);
        return;
      }
      host.innerHTML = homeCommandCenterTemplate(data, setup);
      host.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
    } catch (error) {
      host.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-refresh-home>Retry</button></div>`;
      host.querySelector("[data-refresh-home]")?.addEventListener("click", () => hydrateHomeCommandCenter(true));
    }
  }

  function homeTone(value) {
    const tone = String(value || "amber").toLowerCase();
    return ["green", "amber", "red"].includes(tone) ? tone : "amber";
  }

  function setupStatusTemplate(setup = {}) {
    const status = (value) => ["green", "amber", "red"].includes(String(value)) ? String(value) : "amber";
    const mode = (item) => `<article class="setup-mode tone-${e(status(item.tone))}"><div><strong>${e(item.label)}</strong><span>${e(item.bestFor)}</span></div><p>${e(item.description)}</p><code>${e(item.command)}</code></article>`;
    const check = (item) => `<li class="tone-${e(status(item.status))}" title="${e(`${item.detail || ""} ${item.action || ""}`)}"><b>${e(item.name)}</b><span>${e(item.area)} | ${e(item.detail || "")}</span></li>`;
    const summary = setup.summary || {};
    return `<section class="home-setup-panel"><header><div><span>Setup Readiness</span><strong>Detect First, Then Run Incremental or Full Setup</strong><small>${e(setup.generatedAt || "")}</small></div><article class="tone-${e(status(setup.overall))}"><b>${e(String(setup.overall || "amber").toUpperCase())}</b><span>${e(summary.green || 0)} green / ${e(summary.amber || 0)} amber / ${e(summary.red || 0)} red</span></article></header><div class="setup-mode-grid">${(setup.setupModes || []).map(mode).join("")}</div><div class="setup-check-grid">${(setup.checks || []).map(check).join("")}</div></section>`;
  }

  function architectureDiagramTemplate(data = {}, setup = {}) {
    const status = homeTone(setup.overall);
    return `<section class="home-architecture-panel"><header><div><span>Application Architecture</span><strong>MTM UI Interaction Map</strong><small>Node/static workspace + MariaDB source truth + cache-backed analytics</small></div><b class="tone-${e(status)}">${e(String(setup.overall || "amber").toUpperCase())}</b></header><svg class="home-architecture-svg" viewBox="0 0 980 420" role="img" aria-label="MyTradingMind application architecture diagram"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"></path></marker></defs><rect class="arch-bg" x="10" y="10" width="960" height="400" rx="18"></rect><g class="arch-node node-ui"><rect x="55" y="58" width="180" height="88" rx="10"></rect><text x="145" y="92">Workspace UI</text><text x="145" y="118">Home, apps, widgets</text></g><g class="arch-node node-api"><rect x="395" y="52" width="190" height="96" rx="10"></rect><text x="490" y="88">Node API</text><text x="490" y="116">Auth, RBAC, routes</text></g><g class="arch-node node-db"><rect x="735" y="54" width="178" height="92" rx="10"></rect><text x="824" y="89">MariaDB myts</text><text x="824" y="116">rs_daily + state</text></g><g class="arch-node node-cache"><rect x="730" y="235" width="188" height="96" rx="10"></rect><text x="824" y="271">Daily Cache</text><text x="824" y="300">Redis or memory</text></g><g class="arch-node node-agents"><rect x="390" y="250" width="202" height="104" rx="10"></rect><text x="491" y="286">Agents</text><text x="491" y="315">RS Daily, pipeline</text></g><g class="arch-node node-market"><rect x="58" y="245" width="180" height="104" rx="10"></rect><text x="148" y="281">Market Intelligence</text><text x="148" y="310">Regime, sectors, signals</text></g><path class="arch-line" d="M235 102 C285 102,335 100,395 100"></path><path class="arch-line" d="M585 100 C640 100,685 100,735 100"></path><path class="arch-line" d="M824 146 C824 178,824 203,824 235"></path><path class="arch-line" d="M730 283 C680 283,640 287,592 298"></path><path class="arch-line" d="M390 301 C332 301,285 300,238 298"></path><path class="arch-line" d="M148 245 C148 205,148 180,148 146"></path><path class="arch-line muted" d="M491 250 C510 205,510 178,490 148"></path><text class="arch-caption" x="490" y="388">Golden business date: ${e(setup.businessDay?.latestCompleteDate || data.asOfDate || "NA")} | Cache: ${e(setup.cache?.status || "NA")} | DB: ${e(setup.db?.connected ? "connected" : "attention")}</text></svg></section>`;
  }

  function homeCommandCenterTemplate(data = {}, setup = {}) {
    const workflow = (data.workflow || []).map((item, index, arr) => `<span>${e(item)}</span>${index < arr.length - 1 ? "<b>&gt;</b>" : ""}`).join("");
    const triangleItem = (item, type) => `<li class="tone-${e(homeTone(item.tone))}"><strong>${e(item.symbol || item.name)}</strong><span>${type === "stock" ? `RS ${e(item.rsScore ?? "NA")} | #${e(item.leadershipRank)} | ${e(item.signalState || "Watch")}` : `${e(item.label || "")} | rank ${e(item.rank || "")}`}</span></li>`;
    const market = data.market || {};
    const navs = (data.navigation || ["Dashboard", "Scanner", "Signal", "Trading", "Risk", "Agents", "Marketplace"]).map((item) => `<button data-nav="${e(item)}"><strong>${e(item)}</strong><span>${e(workspaceNameForNav(item))}</span></button>`).join("");
    return `<div class="home-command-center">${architectureDiagramTemplate(data, setup)}${setupStatusTemplate(setup)}<section class="home-workflow"><h3>Trading System Workflow</h3><div>${workflow}</div></section><section class="hierarchy-triangle"><header><div><span>Market Hierarchy Cache</span><strong>Executive Market Command Center</strong><small>as of ${e(data.asOfDate || "")}</small></div><article class="tone-${e(homeTone(market.tone))}"><span>${e(market.regime || "Unknown")}</span><b>${e(market.riskStatus || "NA")}</b></article></header><div class="triangle-level market-level tone-${e(homeTone(market.tone))}"><strong>MARKET</strong><span>Regime ${e(market.regime || "NA")} | Breadth ${e(market.breadthStatus ?? "NA")} | Risk ${e(market.riskStatus || "NA")}</span></div><div class="triangle-level"><strong>SECTORS</strong><ul>${(data.sectors || []).map((item) => triangleItem(item, "sector")).join("")}</ul></div><div class="triangle-level"><strong>INDUSTRIES</strong><ul>${(data.industries || []).map((item) => triangleItem(item, "industry")).join("")}</ul></div><div class="triangle-level stocks-level"><strong>STOCKS</strong><ul>${(data.stocks || []).map((item) => triangleItem(item, "stock")).join("")}</ul></div></section><section class="home-commentary"><h3>Market Commentary</h3><p>${e(data.commentary || "Market hierarchy commentary unavailable.")}</p></section><section class="home-quick-nav"><h3>Navigate Next</h3><div>${navs}</div></section></div>`;
  }
  function marketplaceTemplate() { return `<section class="module-page"><header><h1>Marketplace</h1><p>Same app registry used by Add Apps. Access reflects your role and subscriptions.</p></header><div class="catalog-grid">${catalogTemplate("marketplace")}</div></section>`; }
  function profileTemplate(message = "") { const u = currentSessionUser(); return `<section class="module-page profile-page"><header><h1>Profile</h1><p>Logged-in account, password controls, and encrypted service tokens.</p></header><div class="profile-grid"><div class="info-panel"><h3>${e(u.displayName || u.username || "User")}</h3><p>${e(u.username || "")}</p><dl><dt>Role</dt><dd>${roleLabel(u.role)}</dd><dt>Status</dt><dd>${e(u.status || "active")}</dd><dt>Subscription</dt><dd>${e(u.subscriptionStatus || "inactive")}</dd></dl><button class="secondary" data-logout>Logout</button></div><form class="info-panel" data-change-password><h3>Change Password</h3>${message ? `<div class="auth-message">${e(message)}</div>` : ""}<label>Current Password<input name="currentPassword" type="password" required /></label><label>New Password<input name="newPassword" type="password" required minlength="10" /></label><label>Confirm Password<input name="confirmPassword" type="password" required minlength="10" /></label><button class="primary" type="submit">Save Password</button></form>${profileTokensTemplate()}</div></section>`; }
  function profileTokensTemplate() {
    const tokens = state.profileTokens || {};
    const row = (key, label) => { const item = tokens[key] || {}; return `<div class="token-status-row"><span>${e(label)}</span><strong>${item.configured ? e(item.masked || "Saved") : "Not saved"}</strong><small>${e(item.source || "loading")}${item.updatedAt ? ` | ${new Date(item.updatedAt).toLocaleString()}` : ""}</small></div>`; };
    const disabled = state.tokenEditMode ? "" : "disabled";
    const message = state.tokenMessage ? `<div class="auth-message">${e(state.tokenMessage)}</div>` : "";
    return `<form class="info-panel profile-token-panel" data-profile-token-form><header><div><h3>Service Tokens</h3><p>Encrypted in DB. Blank fields keep current saved values.</p></div>${state.tokenEditMode ? `<button type="button" class="secondary" data-cancel-profile-tokens>Cancel</button>` : `<button type="button" class="secondary" data-modify-profile-tokens>Modify</button>`}</header>${message}<div class="token-status-list">${row("eodhd", "EODHD API Token")}${row("openai", "OpenAI API Token")}</div><label>EODHD Token<input name="eodhdToken" type="password" autocomplete="off" placeholder="${tokens.eodhd?.configured ? "Saved - enter replacement only" : "Enter EODHD token"}" ${disabled} /></label><label>OpenAI Token<input name="openaiToken" type="password" autocomplete="off" placeholder="${tokens.openai?.configured ? "Saved - enter replacement only" : "Enter OpenAI token"}" ${disabled} /></label><button class="primary" type="submit" ${disabled}>Save Tokens</button></form>`;
  }
  function settingsTemplate() { return `<section class="module-page settings-page"><header><h1>Settings</h1><p>Per-user UI and workspace preferences.</p></header><div class="settings-grid">${selectSetting("theme", "Theme", [["dark", "Dark"], ["light", "Light"], ["system", "System"]])}${selectSetting("density", "Layout Density", [["comfortable", "Comfortable"], ["compact", "Compact"]])}${workspaceSetting("defaultWorkspaceId", "Default Landing Workspace")}${workspaceSetting("defaultDashboardWorkspaceId", "Default Dashboard Workspace")}${selectSetting("defaultRefreshInterval", "Default Refresh Interval", [["15", "15 seconds"], ["30", "30 seconds"], ["60", "60 seconds"], ["300", "5 minutes"]])}${selectSetting("widgetStyle", "Widget Style", [["standard", "Standard"], ["dense", "Dense"]])}${toggleSetting("autoSave", "Auto-save workspace changes")}${toggleSetting("autoRestore", "Auto-restore last workspace")}${toggleSetting("sidebarExpanded", "Keep sidebar expanded")}${toggleSetting("liveRefresh", "Enable live refresh")}${toggleSetting("confirmWorkspaceDelete", "Confirm before workspace delete")}${toggleSetting("confirmAppRemove", "Confirm before app remove")}${toggleSetting("notifications", "Notification preferences")}</div></section>`; }
  function catalogTemplate(surface, filter = "") { const lower = filter.toLowerCase(); return categories.map((cat) => { const plugins = capabilityPlugins.filter((p) => canSeeApp(p.id) && p.category === cat.id && `${p.name} ${p.description}`.toLowerCase().includes(lower)); if (!plugins.length) return ""; return `<section class="catalog-section"><h3>${cat.label}</h3>${plugins.map((p) => appOptionTemplate(p, surface)).join("")}</section>`; }).join(""); }
  function appOptionTemplate(p, surface) { const ok = canLaunchApp(p.id), reason = appAccessReason(p.id); return `<button class="app-option ${surface === "marketplace" ? "marketplace-card" : ""} ${ok ? "" : "locked"}" ${ok ? `data-add-plugin="${p.id}"` : "disabled"} title="${e(reason)}"><span>${e(p.icon)}</span><div><strong>${e(p.name)}</strong><small>${e(p.description)}</small><small>Permissions: ${p.permissions.join(", ")} | Refresh: ${p.refresh_mode}</small><small>${ok ? "Add to current workspace" : reason}</small></div></button>`; }
  function bindCatalogButtons(scope) { scope?.querySelectorAll("[data-add-plugin]").forEach((b) => b.addEventListener("click", () => addWidget(b.dataset.addPlugin))); }
  function currentWorkspace() { return state.workspaces.find((w) => w.id === state.activeWorkspaceId) || state.workspaces[0]; }
  function workspaceForType(type) { let w = state.workspaces.find((item) => item.type === type); if (!w) { w = createWorkspaceModel(`${titleCase(type)} Workspace`, type, seedWidgets(type)); state.workspaces.push(w); persistAll(); } return w; }
  function defaultDashboardWorkspace() { return state.workspaces.find((w) => w.id === state.preferences.defaultDashboardWorkspaceId) || workspaceForType("dashboard"); }
  function runWorkspaceAction(action) { root.querySelector("[data-actions-menu]").hidden = true; if (action === "create") return createWorkspaceAction(); if (action === "rename") return renameWorkspaceAction(); if (action === "duplicate") return duplicateWorkspaceAction(); if (action === "delete") return deleteWorkspaceAction(); if (action === "save-template") return saveTemplateAction(); if (action === "load-template") return loadTemplateAction(); if (action === "set-default") return setDefaultWorkspaceAction(); }
  function createWorkspaceAction() { const name = prompt("Workspace name", "New Workspace"); if (!name) return; const w = createWorkspaceModel(name, "custom", []); state.workspaces.push(w); state.activeWorkspaceId = w.id; state.activeNav = "Dashboard"; state.activeView = "workspace"; renderMain(); persistAll(); }
  function renameWorkspaceAction() { const w = currentWorkspace(); const name = prompt("Rename workspace", w.name); if (!name) return; w.name = name; w.updatedAt = now(); renderMain(); persistAll(); }
  function duplicateWorkspaceAction() { const s = currentWorkspace(); const c = { ...clone(s), id: uid(), name: `${s.name} Copy`, widgets: s.widgets.map((w) => ({ ...clone(w), id: uid() })), isDefaultDashboard: false, createdAt: now(), updatedAt: now() }; state.workspaces.push(c); state.activeWorkspaceId = c.id; renderMain(); persistAll(); }
  function deleteWorkspaceAction() { if (state.workspaces.length <= 1) return alert("At least one workspace is required."); const w = currentWorkspace(); if (state.preferences.confirmWorkspaceDelete && !confirm(`Delete workspace "${w.name}"?`)) return; state.workspaces = state.workspaces.filter((item) => item.id !== w.id); if (state.preferences.defaultDashboardWorkspaceId === w.id) state.preferences.defaultDashboardWorkspaceId = state.workspaces[0].id; state.activeWorkspaceId = state.preferences.defaultDashboardWorkspaceId; renderMain(); persistAll(); }
  function saveTemplateAction() { const s = currentWorkspace(); state.templates.push({ ...clone(s), id: uid(), templateName: s.name, savedAt: now() }); repository.saveTemplates(state.templates); alert("Workspace template saved."); }
  function loadTemplateAction() { if (!state.templates.length) return alert("No saved workspace templates yet."); const names = state.templates.map((t, i) => `${i + 1}. ${t.templateName || t.name}`).join("\n"); const t = state.templates[Number(prompt(`Load which template?\n${names}`, "1")) - 1]; if (!t) return; const w = { ...clone(t), id: uid(), name: `${t.templateName || t.name} Loaded`, widgets: t.widgets.map((x) => ({ ...clone(x), id: uid() })), createdAt: now(), updatedAt: now() }; state.workspaces.push(w); state.activeWorkspaceId = w.id; renderMain(); persistAll(); }
  function setDefaultWorkspaceAction() { const w = currentWorkspace(); state.preferences.defaultDashboardWorkspaceId = w.id; state.preferences.defaultWorkspaceId = w.id; state.workspaces.forEach((item) => item.isDefaultDashboard = item.id === w.id); persistAll(); alert(`${w.name} is now the Dashboard workspace.`); }
  function addWidget(pluginId) { if (!canLaunchApp(pluginId)) return alert(appAccessReason(pluginId)); const w = currentWorkspace(); if (w.widgets.length >= MAX_WIDGETS) return alert("Maximum 20 widgets per workspace."); const p = pluginById.get(pluginId), slot = findOpenSlot(p.default_size.w, p.default_size.h); w.widgets.push(createWidget(p, slot)); w.updatedAt = now(); state.activeView = "workspace"; renderMain(); persistAll(); }
  function renderWidgets(linkGroup) { const canvas = root.querySelector("[data-canvas]"); if (!canvas) return; canvas.innerHTML = currentWorkspace().widgets.map((w) => linkGroup && w.linkGroup !== linkGroup ? "" : widgetTemplate(w)).join(""); canvas.style.minHeight = `${Math.max(680, maxBottom() * ROW_HEIGHT + 80)}px`; bindWidgetEvents(); }
  function widgetTemplate(w) {
    const p = pluginById.get(w.pluginId);
    if (!p) return "";
    const color = LINK_GROUPS[w.linkGroup] || LINK_GROUPS.blue;
    const sizeAction = w.maximized ? "restore" : "maximize";
    const sizeTitle = w.maximized ? "Restore window size" : "Maximize window";
    const sizeLabel = w.maximized ? "[]" : "[]";
    const minAction = w.minimized ? "restore" : "minimize";
    const minTitle = w.minimized ? "Restore window" : "Minimize window";
    const menuItems = ["Configure", "Refresh", "Duplicate", w.minimized || w.maximized ? "Restore" : "Minimize", ...(w.maximized ? [] : ["Maximize"]), "Export", "Remove"];
    return `<article class="widget-card ${w.minimized ? "minimized" : ""} ${w.maximized ? "maximized" : ""} ${w.status === "error" ? "has-error" : ""}" data-widget-id="${w.id}" style="--x:${w.x};--y:${w.y};--w:${w.w};--h:${w.h};--group:${color}">
      <header class="widget-header">
        <button class="drag-handle" title="Drag">::</button>
        <span class="widget-icon">${e(p.icon)}</span>
        <strong>${e(p.name)}</strong>
        <select data-link-group title="Link group">${Object.keys(LINK_GROUPS).map((g) => `<option ${g === w.linkGroup ? "selected" : ""}>${g}</option>`).join("")}</select>
        <span class="link-dot"></span>
        <div class="widget-controls">
          <button class="widget-control" data-action="configure" title="Configure">cfg</button>
          <button class="widget-control" data-action="refresh" title="Refresh">r</button>
          <button class="widget-control" data-action="${minAction}" title="${minTitle}">${w.minimized ? "up" : "_"}</button>
          <button class="widget-control" data-action="${sizeAction}" title="${sizeTitle}">${sizeLabel}</button>
          <button class="widget-control" data-widget-menu title="Options">...</button>
          <button class="widget-control danger" data-action="remove" title="Close and remove">x</button>
        </div>
      </header>
      <div class="widget-menu" hidden>${menuItems.map((x) => `<button data-action="${x.toLowerCase()}">${x}</button>`).join("")}</div>
      <section class="widget-body">${w.minimized ? "" : renderWidgetBody(w, p)}</section>
      <button class="resize-handle" title="Resize"></button>
    </article>`;
  }
  function renderWidgetBody(w, p) { if (w.status === "error") return `<div class="widget-error"><strong>${e(w.error || "App failed")}</strong><button data-action="retry">Retry</button></div>`; if (w.status === "loading") return `<div class="widget-loading">Refreshing ${e(p.name)}...</div>`; try { const html = p.render_component({ context: contextBus.get(w.linkGroup), eventBus, widget: w, config: w.config || {}, state: w.appState || {} }); return `${html}<div class="widget-status">${w.lastRefreshedAt ? `Updated ${new Date(w.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Ready"}</div>`; } catch (error) { w.status = "error"; w.error = error.message; return `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`; } }
  async function hydrateMarketCockpitTiles() {
    const tiles = [...root.querySelectorAll("[data-market-cockpit]")].filter((tile) => !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const response = await fetch("/api/market/tile");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = marketCockpitTemplate(data);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    }
  }

  function marketCockpitTemplate(data) {
    const metric = (label, value, suffix = "") => `<div class="market-mini-metric"><span>${label}</span><strong>${e(value)}${suffix}</strong></div>`;
    const groupRows = (items) => items.map((item) => `<li><strong>${e(item.name)}</strong><span>Structural ${item.structural}% | RS ${item.rs} | 5D ${item.perf}%</span></li>`).join("");
    const tradeRows = (items) => items.map((item) => `<li><strong>${e(item.stock || item.stock_symbol || "NA")}</strong><span>${e(item.rs_alignment || item.status || "Candidate")}</span></li>`).join("");
    return `<div class="market-tile-shell">
      <section class="market-tile-hero tone-${e(data.tones?.quarterly || "neutral")}"><div><span>Market Regime Cockpit</span><strong>${e(data.regimeClassification)}</strong><small>business day ${e(data.regimeDate || data.rsDailyLatestDate || "")}${data.regimeFresh === false ? ` | source ${e(data.sourceRegimeDate || "stale")}` : ""}</small></div><b>${e(data.regimeScore)}</b></section>
      <div class="market-regime-grid"><article><span>Primary</span><strong>${e(data.quarterlySignal)}</strong></article><article><span>Daily</span><strong>${e(data.dailySignal)}</strong></article><article><span>Extension</span><strong>${e(data.extensionState)}</strong><small>${e(data.extensionScore)}</small></article></div>
      <div class="market-mini-grid">${metric("1D participation", data.metrics?.participation1d, "%")}${metric("5D participation", data.metrics?.participation5d, "%")}${metric("Structural leaders", data.metrics?.structuralLeaders, "%")}${metric("Median RS 6M", data.metrics?.medianRs6m)}</div>
      <div class="market-lists"><div><h4>Leadership Sectors</h4><ul>${groupRows(data.topSectors || [])}</ul></div><div><h4>Leadership Industries</h4><ul>${groupRows(data.topIndustries || [])}</ul></div></div>
      <div class="market-lists"><div><h4>Actionable</h4><ul>${tradeRows(data.actionableTrades || [])}</ul></div><div><h4>Read</h4><p>${e(data.narrative || "No narrative available")}</p></div></div>
    </div>`;
  }

  async function hydrateMarketMonitorTiles(force = false, refreshNews = false) {
    if (!beginHydrate("market-monitor")) return;
    const tiles = [...root.querySelectorAll("[data-market-monitor]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      const qs = new URLSearchParams();
      if (force) qs.set("refresh", "1");
      if (refreshNews) qs.set("refreshNews", "1");
      const data = await api(`/api/market-monitor/snapshot${qs.toString() ? `?${qs}` : ""}`, null, "GET");
      if (data.warming) {
        for (const tile of tiles) {
          tile.dataset.loaded = "true";
          tile.innerHTML = `<div class="widget-loading">Market Monitor cache warming: ${e(data.message || "Loading daily cache...")}</div>`;
        }
        window.setTimeout(() => { for (const tile of tiles) delete tile.dataset.loaded; hydrateMarketMonitorTiles(true); }, 5000);
        return;
      }
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = marketMonitorTemplate(data);
        bindMarketMonitorTile(tile);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-refresh-market-monitor>Retry</button></div>`;
    } finally {
      endHydrate("market-monitor");
    }
  }

  function bindMarketMonitorTile(tile) {
    tile.querySelector("[data-refresh-market-monitor]")?.addEventListener("click", () => { delete tile.dataset.loaded; hydrateMarketMonitorTiles(true); });
    tile.querySelector("[data-refresh-market-news]")?.addEventListener("click", () => { delete tile.dataset.loaded; hydrateMarketMonitorTiles(true, true); });
    tile.querySelectorAll("[data-symbol]").forEach((button) => button.addEventListener("click", () => {
      contextBus.update("blue", { symbol: button.dataset.symbol }, "market-monitor");
      eventBus.emit("symbol_selected", { symbol: button.dataset.symbol, link_group: "blue" });
    }));
    tile.querySelectorAll("[data-sector-filter]").forEach((button) => button.addEventListener("click", () => {
      state.screenerView.filters = [{ key: "sector", mode: "equals_text", value: button.dataset.sectorFilter }];
      state.activeNav = "Scanner";
      state.activeView = "workspace";
      state.activeWorkspaceId = workspaceForType("scanner").id;
      persistScreenerView();
      renderMain();
    }));
  }

  function monitorTip(text) {
    return `<button class="monitor-tip" type="button" title="${e(text)}" aria-label="${e(text)}">i</button>`;
  }

  function monitorCard(title, subtitle, body, actions = "", tip = "") {
    return `<section class="monitor-card"><header><div><h3>${e(title)}</h3><small>${e(subtitle || "")}</small></div><div>${actions}${tip ? monitorTip(tip) : ""}</div></header>${body || `<div class="widget-empty">No data available.</div>`}</section>`;
  }

  function marketMonitorTemplate(data = {}) {
    const meta = data.metadata || {}, health = data.market_health || {};
    const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "NA";
    const scoreTone = (value) => Number(value) >= 65 ? "good" : Number(value) >= 45 ? "warn" : "bad";
    const tips = {
      breadth: "Breadth uses only symbols with 3-day average volume above 100,000. Full breadth uses the broad stock universe; liquid breadth adds the price and dollar-volume filters.",
      stages: "Ranks industries by today's relative participation and daily return so leadership themes are visible before drilling into symbols.",
      health: "Composite market state from breadth, sector rotation, and mega-cap participation. Green supports risk-on exposure; amber calls for selectivity; red favors defense.",
      brief: "Narrative summary built from market structure plus cached EODHD news. Inputs show the numeric scores driving the risk interpretation.",
      performance: "Equal-weight sector or theme returns from the daily cache. RV is relative volume confirmation versus recent history.",
      indexes: "Index proxy health from cached daily indicators. ADR is average daily range percent; Vol is current volume versus 50-day average.",
      mega: "Mega-cap participation tracks whether large index weights confirm or diverge from broader market strength. QQQ-QQQE highlights cap-weight versus equal-weight divergence.",
      leaders: "Top leadership lists from RS, momentum, breakout, dollar-volume, and laggard scans. Click a symbol to send it to linked widgets."
    };
    const fieldTitle = {
      sym: "Ticker symbol. Click rows or symbols to broadcast to linked widgets.",
      last: "Latest cached daily close or last price from rs_daily.",
      pct: "Daily percent change for the latest business day.",
      adr: "20-day average daily range percentage. Higher ADR means larger normal price swings.",
      vol: "Volume ratio versus 50-day average. Above 1.0x means volume is above normal.",
      trend: "20-day versus 50-day trend classification from cached daily indicators."
    };
    const compactCount = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return "NA";
      if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return String(Math.round(n));
    };
    const bar = (row) => `<div class="monitor-bar-row" title="${e(row.formula || `${row.label}: bullish participation percentage for the current market universe.`)}"><div><strong title="${e(row.formula || row.label)}">${e(row.label)}</strong><small title="Bullish / bearish or non-confirming, with denominator where applicable">${compactCount(row.bullish)} / ${compactCount(row.bearish)}${row.denominator ? ` of ${compactCount(row.denominator)}` : ""}</small></div><div class="monitor-bar" title="Bullish participation bar"><span style="--w:${Math.max(0, Math.min(100, Number(row.bullish_pct || 0)))}%"></span></div><b title="Bullish participation percentage">${fmt(row.bullish_pct, 0)}%</b></div>`;
    const rankRows = (rows, opts = {}) => (rows || []).slice(0, opts.limit || 12).map((row) => {
      const change = row.return_pct ?? row.daily_return_pct ?? row.daily_change_pct;
      const label = row.symbol || row.name || "NA";
      const detail = opts.extra ? opts.extra(row) : row.sector || row.industry || `${row.constituents || 0} names`;
      const title = opts.sector
        ? `${label}: equal-weight daily return ${fmt(change, 2)}%. ${detail}. Click to filter linked views by this group.`
        : `${label}: daily return ${fmt(change, 2)}%. ${detail}.`;
      return `<button class="monitor-rank-row" title="${e(title)}" ${opts.sector ? `data-sector-filter="${e(row.name)}"` : row.symbol ? `data-symbol="${e(row.symbol)}"` : ""}><span>${e(label)}</span><strong class="${Number(change ?? 0) >= 0 ? "tone-good" : "tone-bad"}">${fmt(change, 2)}%</strong><small>${e(detail)}</small></button>`;
    }).join("");
    const assetTable = (rows) => `<table class="monitor-table"><thead><tr><th title="${e(fieldTitle.sym)}">Sym</th><th title="${e(fieldTitle.last)}">Last</th><th title="${e(fieldTitle.pct)}">%</th><th title="${e(fieldTitle.adr)}">ADR</th><th title="${e(fieldTitle.vol)}">Vol</th><th title="${e(fieldTitle.trend)}">Trend</th></tr></thead><tbody>${(rows || []).map((row) => `<tr title="${e(`${row.symbol}: ${fmt(row.daily_change_pct, 2)}% today, ADR ${fmt(row.adr20_pct, 1)}%, volume ${fmt(row.volume_ratio_50, 2)}x, trend ${row.trend_20_50 || "NA"}.`)}" ${row.symbol ? `data-symbol="${e(row.symbol)}"` : ""}><td>${e(row.symbol)}</td><td>${fmt(row.last_price ?? row.close, 2)}</td><td class="${Number(row.daily_change_pct || 0) >= 0 ? "tone-good" : "tone-bad"}">${fmt(row.daily_change_pct, 2)}</td><td>${fmt(row.adr20_pct, 1)}</td><td>${fmt(row.volume_ratio_50, 2)}x</td><td>${e(row.trend_20_50 || "NA")}</td></tr>`).join("")}</tbody></table>`;
    const leaderList = (rows) => `<div class="monitor-leader-list">${(rows || []).slice(0, 9).map((row) => `<button data-symbol="${e(row.symbol)}" title="${e(`${row.symbol}: relative strength score ${fmt(row.rs_score, 1)}. Sector ${row.sector || "Unknown"}. Click to send symbol to linked chart/watch widgets.`)}"><strong>${e(row.symbol)}</strong><span title="Relative strength score versus the cached universe">RS ${fmt(row.rs_score, 1)}</span><small>${e(row.sector || "Unknown")}</small></button>`).join("") || `<div class="widget-empty">No leaders.</div>`}</div>`;
    const briefList = (rows, empty = "No items.") => `<ul class="monitor-inference-list">${(rows || []).slice(0, 5).map((item) => `<li>${e(item)}</li>`).join("") || `<li>${e(empty)}</li>`}</ul>`;
    const regimeTone = (regime) => regime === "RISK_ON" ? "good" : regime === "RISK_OFF" ? "bad" : "warn";
    const flagTone = (severity) => severity === "critical" ? "bad" : severity === "warning" ? "warn" : "good";
    const fullBreadth = monitorCard("Full Market Breadth", `${meta.stock_universe_count || 0} stocks | 3D avg volume > ${compactCount(meta.min_avg_volume_3 || 100000)}`, (data.full_market_breadth?.rows || []).map(bar).join(""), "", tips.breadth);
    const breadth = monitorCard("Liquid Breadth", `${meta.universe_count || 0} liquid stocks | ${meta.all_symbol_count || 0} cached symbols`, (data.breadth?.rows || []).map(bar).join(""), "", tips.breadth);
    const stages = monitorCard("Stage / Theme Analysis", "Today ranked industries", `<div class="monitor-scroll">${rankRows(data.stage_analysis?.today || [], { limit: 16 })}</div>`, "", tips.stages);
    const healthBadges = `<div class="monitor-health-badges">${[["Breadth", health.breadth_score, "Breadth score summarizes broad participation across bullish market conditions."], ["Rotation", health.rotation_score, "Rotation score measures whether leading sectors/themes are improving versus the broader universe."], ["Mega Caps", health.mega_cap_score, "Mega-cap score checks whether large index weights confirm the move."]].map(([label, value, title]) => `<article class="${scoreTone(value)}" title="${e(title)}"><span>${label}</span><strong>${fmt(value, 0)}</strong></article>`).join("")}<article class="${health.risk_state === "RISK ON" ? "good" : health.risk_state === "RISK OFF" ? "bad" : "warn"}" title="Overall risk regime derived from breadth, rotation, and mega-cap confirmation."><span>State</span><strong>${e(health.risk_state || "NA")}</strong></article></div><div class="monitor-regime-box" title="Regime box summarizes trend, RS leadership count, and breakout/breakdown pressure."><b>${e(health.regime_box?.trend || "NEUTRAL")}</b><span title="Number of high relative-strength leaders in the current universe">RS leaders ${e(health.regime_box?.rs_leaders || 0)}</span><span title="Breakouts versus breakdowns. BO/BD expansion helps confirm or reject risk-on conditions.">BO ${e(health.regime_box?.breakouts || 0)} / BD ${e(health.regime_box?.breakdowns || 0)}</span></div>`;
    const healthCard = monitorCard("Market Health", `as of ${meta.as_of_date || ""}`, healthBadges, "", tips.health);
    const brief = data.market_brief || {}, news = data.news || {}, inference = brief.llm_inference || data.llm_inference || {};
    const inferenceSource = inference.cached ? "cached" : inference.status === "ready" ? "fresh" : "fallback";
    const inferenceBody = inference.summary ? `<div class="monitor-inference">
      <div class="monitor-inference-hero ${regimeTone(inference.regime)}" title="LLM inference generated from the structured Market Monitor metrics and cached by business date plus snapshot hash."><div><span>LLM Market Inference</span><strong>${e(inference.regime || "NA")}</strong></div><b>${fmt(inference.confidence, 0)}%</b></div>
      <p title="Structured LLM summary from the V1 prompt template.">${e(inference.summary)}</p>
      <div class="monitor-inference-columns"><section><b>Bullish</b>${briefList(inference.bullish_evidence, "No bullish evidence.")}</section><section><b>Bearish</b>${briefList(inference.bearish_evidence, "No bearish evidence.")}</section></div>
      <div class="monitor-inference-read"><b>Leadership</b><span>${e(inference.leadership_read || "NA")}</span></div>
      <div class="monitor-inference-read"><b>Rotation</b><span>${e(inference.sector_rotation_read || "NA")}</span></div>
      <div class="monitor-inference-flags">${(inference.anomaly_flags || []).slice(0, 5).map((flag) => `<span class="${flagTone(flag.severity)}" title="${e(flag.message || "")}">${e(flag.type || "FLAG")}${flag.symbol ? `: ${e(flag.symbol)}` : ""}</span>`).join("")}</div>
      <dl><dt title="LLM/cache status">Inference</dt><dd>${e(inference.status || "NA")} | ${e(inferenceSource)} | ${e(inference.prompt_version || "v1")} | ${e(inference.generated_at || "")}</dd><dt title="Core numeric scores">Inputs</dt><dd>Breadth ${e(health.breadth_score || 0)}, Rotation ${e(health.rotation_score || 0)}, Mega ${e(health.mega_cap_score || 0)}</dd></dl>
    </div>` : `<div class="widget-empty">LLM inference unavailable. Numeric Market Monitor metrics remain active.</div>`;
    const newsLine = `<p title="Cached EODHD news summary. News never blocks the monitor if the provider is unavailable.">${e(news.summary?.executive_summary || "News unavailable; showing market-structure summary only.")}</p>`;
    const briefBody = `${inferenceBody}${newsLine}`;
    const briefCard = monitorCard("Market Brief", `${inference.status || "inference"} | ${inferenceSource}`, briefBody, `<button data-refresh-market-news title="Refresh cached EODHD news only">News</button>`, tips.brief);
    const performance = monitorCard("Sector / Theme Performance", "Equal-weight daily returns", `<div class="monitor-scroll">${rankRows(data.sector_theme_performance?.sectors || [], { limit: 18, sector: true, extra: (row) => `${row.constituents} symbols | RV ${fmt(row.volume_confirmation, 2)}x` })}</div>`, "", tips.performance);
    const indexes = monitorCard("Indexes", "Daily cached indicators", assetTable(data.indexes?.rows || []), "", tips.indexes);
    const mega = monitorCard("Mega Caps", `Participation ${fmt(data.mega_caps?.score, 0)} | QQQ-QQQE ${fmt(data.mega_caps?.cap_weight_divergence, 2)}%`, assetTable(data.mega_caps?.rows || []), "", tips.mega);
    const leaders = monitorCard("Leadership Lists", "RS, momentum, breakouts, volume, laggards", `<div class="monitor-leader-tabs"><span title="Highest relative-strength scores">RS</span><span title="Best short-term and multi-period momentum">Momentum</span><span title="Symbols breaking above recent ranges or strength thresholds">Breakouts</span><span title="Highest dollar-volume participation">\$Vol</span><span title="Weakest relative and price performers">Laggards</span></div>${leaderList(data.leaders?.rs_leaders || [])}`, "", tips.leaders);
    return `<div class="market-monitor-shell"><header class="market-monitor-top"><div><span>Market Monitor</span><strong title="${e(tips.health)}">${e(health.risk_state || "Market State")}</strong><small title="All Market Monitor calculations use the latest completed business day from the daily cache.">Daily timeframe | latest ${e(meta.as_of_date || "")} | updated ${e(meta.last_updated_at || "")}</small></div><button data-refresh-market-monitor title="Refresh Market Monitor snapshot from cache">Refresh</button></header><div class="market-monitor-grid"><div>${fullBreadth}${breadth}${stages}</div><div>${healthCard}${briefCard}${performance}</div><div>${indexes}${mega}${leaders}</div></div></div>`;
  }

  async function hydrateMarketCycleTiles(force = false) {
    if (!beginHydrate("market-cycle")) return;
    const tiles = [...root.querySelectorAll("[data-market-cycle-tracker]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      for (const tile of tiles) {
        const lookback = [130, 260, 520].includes(Number(tile.dataset.lookback)) ? Number(tile.dataset.lookback) : 260;
        const data = await api(`/api/market-cycle/snapshot?lookback=${lookback}${force ? "&refresh=1" : ""}`, null, "GET");
        if (data.warming) {
          tile.dataset.loaded = "true";
          tile.innerHTML = `<div class="widget-loading">Market cycle cache warming: ${e(data.message || "Loading daily data...")}</div>`;
          window.setTimeout(() => { delete tile.dataset.loaded; hydrateMarketCycleTiles(true); }, 5000);
          continue;
        }
        if (data.error) throw new Error(data.error);
        tile.dataset.loaded = "true";
        tile.dataset.lookback = String(data.lookback || lookback);
        tile.innerHTML = marketCycleTemplate(data);
        bindMarketCycleTile(tile);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-refresh-market-cycle>Retry</button></div>`;
    } finally {
      endHydrate("market-cycle");
    }
  }

  function bindMarketCycleTile(tile) {
    tile.querySelector("[data-refresh-market-cycle]")?.addEventListener("click", () => { delete tile.dataset.loaded; hydrateMarketCycleTiles(true); });
    tile.querySelectorAll("[data-cycle-lookback]").forEach((button) => button.addEventListener("click", () => {
      tile.dataset.lookback = button.dataset.cycleLookback;
      delete tile.dataset.loaded;
      hydrateMarketCycleTiles(true);
    }));
    tile.querySelectorAll("[data-cycle-symbol-tab]").forEach((button) => button.addEventListener("click", () => {
      const symbol = button.dataset.cycleSymbolTab;
      tile.querySelectorAll("[data-cycle-symbol-tab]").forEach((item) => item.classList.toggle("active", item === button));
      tile.querySelectorAll("[data-cycle-chart-row]").forEach((row) => row.classList.toggle("active", row.dataset.cycleChartRow === symbol));
    }));
  }

  function marketCycleTemplate(data = {}) {
    const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "NA";
    const pctFmt = (value, digits = 0) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : "NA";
    const color = String(data.dashboard_color || "NEUTRAL").toLowerCase();
    const tone = color === "green" ? "good" : color === "red" ? "bad" : color === "amber" ? "warn" : "neutral";
    const gateTone = data.invalidation_triggered || /DANGER|BEAR/i.test(data.exposure_gate || "") ? "bad" : /WARNING|WEAK|TRANSITION/i.test(data.exposure_gate || "") ? "warn" : "good";
    const metricTips = {
      market_health_score: "Composite of index trend, leadership, breadth, distribution pressure, and risk appetite.",
      leadership_score: "Composite of leaders above 50d/200d, positive RS versus SPY, and 21-day high participation.",
      distribution_days_25d: "Count of recent higher-volume index declines. Elevated counts warn of institutional selling. It is not a standalone short signal.",
      accumulation_days_25d: "Count of recent higher-volume advancing days. Rising counts indicate institutional demand.",
      distribution_bucket: "Groups distribution pressure into low, normal, warning, danger, or extreme.",
      weekly_status: "10-week / 40-week trend filter used to avoid overreacting to daily noise.",
      qqq_rs_63d_vs_spy_pct: "Measures growth leadership versus the broad market.",
      iwm_rs_63d_vs_spy_pct: "Measures small-cap risk appetite versus the broad market.",
      target_long: "Suggested index ETF allocation from the model, not an automatic order.",
      target_short: "Suggested inverse ETF exposure. Use only with strict invalidation.",
      invalidation: "Condition that should reduce, exit, or reverse the current posture."
    };
    const weightTips = { SPY: "S&P 500 core exposure.", QQQ: "Nasdaq/growth leadership exposure.", IWM: "Small-cap/risk appetite exposure.", SH: "Inverse S&P 500 hedge.", PSQ: "Inverse Nasdaq hedge.", RWM: "Inverse Russell hedge." };
    const weightRows = Object.entries(data.recommended_weights || {}).map(([symbol, weight]) => {
      const pct = Math.round(Number(weight || 0) * 100);
      return `<div class="cycle-allocation-row" title="${e(weightTips[symbol] || "Model allocation weight.")}"><span>${e(symbol)}</span><div><i style="--w:${e(Math.max(0, Math.min(100, pct)))}%"></i></div><b>${e(pct)}%</b></div>`;
    }).join("");
    const metrics = data.metrics || {};
    const evidence = [
      ["SPY vs 21d", metrics.spy_close_vs_21d_pct, "spy_close_vs_21d_pct", "Distance of SPY close from its 21-day moving average."],
      ["SPY vs 50d", metrics.spy_close_vs_50d_pct, "spy_close_vs_50d_pct", "Distance of SPY close from its 50-day moving average."],
      ["SPY vs 200d", metrics.spy_close_vs_200d_pct, "spy_close_vs_200d_pct", "Distance of SPY close from its 200-day moving average."],
      ["Distribution", metrics.distribution_days_25d, "distribution_days_25d", metricTips.distribution_days_25d, "x"],
      ["Accumulation", metrics.accumulation_days_25d, "accumulation_days_25d", metricTips.accumulation_days_25d, "x"],
      ["Dist Bucket", metrics.distribution_bucket, "distribution_bucket", metricTips.distribution_bucket, "text"],
      ["Weekly", metrics.weekly_status, "weekly_status", metricTips.weekly_status, "text"],
      ["QQQ RS", metrics.qqq_rs_63d_vs_spy_pct, "qqq_rs_63d_vs_spy_pct", metricTips.qqq_rs_63d_vs_spy_pct],
      ["IWM RS", metrics.iwm_rs_63d_vs_spy_pct, "iwm_rs_63d_vs_spy_pct", metricTips.iwm_rs_63d_vs_spy_pct],
      ["Leadership", metrics.leadership_score, "leadership_score", metricTips.leadership_score, "score"],
      ["Leaders >50d", metrics.leaders_above_50d_pct, "leaders_above_50d_pct", "Percent of leadership universe above the 50-day average.", "score"],
      ["Leaders >200d", metrics.leaders_above_200d_pct, "leaders_above_200d_pct", "Percent of leadership universe above the 200-day average.", "score"],
      ["Leaders +RS", metrics.leaders_positive_rs_63d_pct, "leaders_positive_rs_63d_pct", "Percent of leaders with positive 63-day RS versus SPY.", "score"]
    ].map(([label, value, key, tip, kind]) => {
      const num = Number(value);
      const cls = kind === "text" ? "neutral" : num >= 65 || (String(key).includes("vs_") && num >= 0) ? "good" : num >= 40 || num >= -2 ? "warn" : "bad";
      const shown = kind === "text" ? value : kind === "x" ? value : kind === "score" ? fmt(value, 0) : pctFmt(value, 1);
      return `<article class="${cls}" title="${e(tip)}"><span>${e(label)}</span><strong>${e(shown ?? "NA")}</strong></article>`;
    }).join("");
    const bt = data.backtest || {};
    const btRows = [["Total", bt.total_return_pct, "%"], ["CAGR", bt.cagr_pct, "%"], ["Max DD", bt.max_drawdown_pct, "%"], ["Sharpe", bt.sharpe, ""], ["MAR", bt.mar_ratio, ""]].map(([label, value, suffix]) => `<article title="Backtest uses close-of-day signals and applies exposure to next close-to-close return to reduce lookahead bias."><span>${label}</span><strong>${fmt(value, suffix ? 1 : 2)}${suffix}</strong></article>`).join("");
    const benchmarkRows = (bt.benchmarks || []).map((row) => `<tr title="Buy-and-hold benchmark over the same available chart window."><td>${e(row.strategy)}</td><td>${pctFmt(row.cagr_pct, 1)}</td><td>${pctFmt(row.max_drawdown_pct, 1)}</td></tr>`).join("");
    return `<div class="market-cycle-shell">
      <header class="cycle-hero tone-${tone}"><div><span>Market Cycle Tracker</span><strong title="Cycle Bucket classifies the current market phase before exposure gates are applied.">${e(data.cycle_bucket || "UNKNOWN")}</strong><small>as of ${e(data.as_of_date || "")}${data.raw_cycle_bucket ? ` | raw ${e(data.raw_cycle_bucket)}` : ""}${data.stale ? " | stale" : ""}</small></div><div class="cycle-hero-metrics"><article title="${e(metricTips.market_health_score)}"><span>Health</span><b>${fmt(data.market_health_score, 0)}</b></article><article title="${e(metricTips.target_long)}"><span>Long Cap</span><b>${pctFmt(data.target_long_index_exposure_pct, 0)}</b></article><article title="${e(metricTips.target_short)}"><span>Short</span><b>${pctFmt(data.target_short_inverse_etf_exposure_pct, 0)}</b></article></div><button data-refresh-market-cycle title="Refresh market-cycle snapshot">Refresh</button></header>
      <section class="cycle-action-gate ${gateTone}" title="${e(data.exposure_gate_reason || "")}"><div><span>Action</span><strong>${e(data.action_decision || data.entry_decision || "NA")}</strong></div><div><span>Exposure Gate</span><strong>${e(data.exposure_gate || "NA")}</strong></div><div><span>Invalidation</span><strong>${data.invalidation_triggered ? "TRIGGERED" : "Clear"}</strong></div><p>${e(data.exposure_gate_reason || "Exposure guidance is derived from regime plus distribution, breadth, and leadership gates.")}</p></section>
      <section class="cycle-lookback-control" title="Chart date window. 6M=130 trading days, 1Y=260, 2Y=520.">${[[130, "6M"], [260, "1Y"], [520, "2Y"]].map(([value, label]) => `<button data-cycle-lookback="${value}" class="${Number(data.lookback || 260) === value ? "active" : ""}">${label}</button>`).join("")}</section>
      <section class="cycle-allocation-strip">${weightRows}</section>
      <section class="cycle-evidence-grid">${evidence}</section>
      <section class="cycle-transition-watch"><dl><dt>Posture</dt><dd title="Portfolio posture is exposure guidance only, not an order.">${e(data.portfolio_posture || "NA")}</dd><dt>Next</dt><dd title="Next market-cycle transition to monitor.">${e(data.next_transition_to_watch || "")}</dd><dt>Entry</dt><dd title="Entry decision and trigger require confirmation with risk rules.">${e(data.entry_decision || "")} | ${e(data.entry_trigger || "")}</dd><dt>Exit</dt><dd title="Exit trigger from distribution, trend, or leadership deterioration.">${e(data.exit_trigger || "")}</dd><dt>Invalidation</dt><dd class="${data.invalidation_triggered ? "tone-bad" : ""}" title="${e(metricTips.invalidation)}">${e(data.risk_invalidation || "")}</dd></dl></section>
      <section class="cycle-distribution-panel" title="High distribution often appears near panic lows. Use it with cycle bucket and leadership confirmation, not alone."><strong>Distribution ${e(metrics.distribution_days_25d ?? "NA")}</strong><span>${e(metrics.distribution_bucket || "NA")}</span><b>${e(data.entry_decision || "NA")}</b></section>
      <section class="cycle-backtest-panel"><header><strong>Backtest Evidence</strong><small title="This is decision support. It emphasizes drawdown control and transition awareness, not guaranteed alpha.">Decision support, not guaranteed alpha.</small></header><div>${btRows}</div><table><thead><tr><th>Benchmark</th><th>CAGR</th><th>Max DD</th></tr></thead><tbody>${benchmarkRows}</tbody></table></section>
      <section class="cycle-index-stack" data-cycle-index-stack><header><strong>Index Signal Stack</strong><div class="cycle-tabs">${["SPY", "QQQ", "IWM"].map((symbol, index) => `<button data-cycle-symbol-tab="${e(symbol)}" class="${index === 0 ? "active" : ""}">${e(symbol)}</button>`).join("")}</div></header><div class="cycle-legend">${cycleLegend()}</div><div class="cycle-chart-stage">${["SPY", "QQQ", "IWM"].map((symbol, index) => cycleChart(symbol, data.charts?.[symbol]?.rows || [], index === 0, data)).join("")}</div></section>
      <section class="cycle-history" title="Last 60 sessions of market-health score with bucket-colored background bands.">${cycleHistorySparkline(data.history || [])}</section>
      <footer>${e(data.note || "Decision-support exposure guidance. Not an auto-trading signal.")}</footer>
    </div>`;
  }

  function cycleLegend() {
    return `<span title="Green/red daily candle body with high-low wick."><i class="cycle-legend-candle"></i>Candle</span><span title="21-day moving average."><i class="cycle-legend-ma21"></i>21d</span><span title="50-day moving average."><i class="cycle-legend-ma50"></i>50d</span><span title="200-day moving average."><i class="cycle-legend-ma200"></i>200d</span><span title="Distribution day: higher-volume index decline."><i class="cycle-marker-distribution"></i>Distribution</span><span title="Follow-through day: strong advance on improving volume after pressure."><i class="cycle-marker-ftd"></i>FTD</span><span title="Bear start: price loses trend with distribution pressure."><i class="cycle-marker-bear-start"></i>Bear Start</span><span title="Bear end: early reclaim of intermediate trend. Wait for confirmation."><i class="cycle-marker-bear-end"></i>Bear End</span>`;
  }

  function cycleChart(symbol, rows = [], active = false, data = {}) {
    const width = 1200, height = 560, pad = 34;
    const source = rows.filter((row) => Number.isFinite(Number(row.close)) && Number.isFinite(Number(row.high)) && Number.isFinite(Number(row.low)));
    const clean = source.slice(-90);
    if (clean.length < 2) return `<div class="cycle-chart-row ${active ? "active" : ""}" data-cycle-chart-row="${e(symbol)}"><strong>${e(symbol)}</strong><div class="widget-empty">No chart data.</div></div>`;
    const prices = clean.flatMap((row) => [row.high, row.low, row.close, row.ma21, row.ma50, row.ma200].map(Number).filter((value) => Number.isFinite(value) && value > 0));
    const min = Math.min(...prices), max = Math.max(...prices);
    const logMin = Math.log(Math.max(min * .985, .01)), logMax = Math.log(Math.max(max * 1.015, min * 1.02, .02));
    const x = (index) => pad + (index / Math.max(1, clean.length - 1)) * (width - pad * 2);
    const y = (value) => {
      const number = Math.max(Number(value), .01);
      const ratio = (Math.log(number) - logMin) / (logMax - logMin || 1);
      return height - pad - ratio * (height - pad * 2);
    };
    const line = (key) => clean.map((row, index) => Number.isFinite(Number(row[key])) ? `${x(index)},${y(row[key])}` : "").filter(Boolean).join(" ");
    const ma21 = line("ma21"), ma50 = line("ma50"), ma200 = line("ma200");
    const candleGap = (width - pad * 2) / Math.max(1, clean.length - 1);
    const candleWidth = Math.max(4, Math.min(10, candleGap * .66));
    const candles = clean.map((row, index) => {
      const cx = x(index);
      const open = Number(row.open ?? row.close), high = Number(row.high), low = Number(row.low), close = Number(row.close);
      const top = y(Math.max(open, close)), bottom = y(Math.min(open, close));
      const bodyH = Math.max(1.5, bottom - top);
      const up = close >= open;
      const baseTitle = `${symbol} | ${row.date}\nOpen: ${open.toFixed(2)}\nHigh: ${high.toFixed(2)}\nLow: ${low.toFixed(2)}\nClose: ${close.toFixed(2)}\nVolume: ${Number(row.volume || 0).toLocaleString()}`;
      return `<g class="${up ? "cycle-candle-up" : "cycle-candle-down"}"><title>${e(baseTitle)}</title><line x1="${cx}" x2="${cx}" y1="${y(high)}" y2="${y(low)}" /><rect x="${cx - candleWidth / 2}" y="${top}" width="${candleWidth}" height="${bodyH}" rx="1" /></g>`;
    }).join("");
    const markers = clean.map((row, index) => {
      const cx = x(index), cy = y(row.close);
      const baseTitle = `${symbol} | ${row.date}\nClose: ${row.close}\nVolume: ${Number(row.volume || 0).toLocaleString()}`;
      const items = [];
      if (row.cycle_bucket === "BEAR_MARKET") items.push(`<rect class="cycle-marker-bear-market" x="${cx - candleWidth / 2 - 1}" y="8" width="${candleWidth + 2}" height="${height - 16}"><title>${e(`${baseTitle}\nSignal: Bear Market\nInterpretation: Sustained below long-term trend. Keep exposure defensive until confirmation improves.`)}</title></rect>`);
      if (row.distribution_day) items.push(`<path class="cycle-marker-distribution" d="M ${cx - 5} 17 L ${cx + 5} 17 L ${cx} 26 Z"><title>${e(`${baseTitle}\nSignal: Distribution Day\nInterpretation: Higher-volume decline warns of institutional selling pressure.`)}</title></path>`);
      if (row.follow_through_day) items.push(`<path class="cycle-marker-ftd" d="M ${cx} ${height - 26} L ${cx - 5} ${height - 16} L ${cx + 5} ${height - 16} Z"><title>${e(`${baseTitle}\nSignal: Follow-Through Day\nInterpretation: Rally attempt confirmed. Pilot long exposure allowed if risk is defined.`)}</title></path>`);
      if ((row.signals || []).includes("BEAR_START")) items.push(`<line class="cycle-marker-bear-start" x1="${cx}" x2="${cx}" y1="8" y2="${height - 8}"><title>${e(`${baseTitle}\nSignal: Bear Start\nInterpretation: Price below trend with distribution pressure. Reduce long exposure and prepare hedge.`)}</title></line>`);
      if ((row.signals || []).includes("BEAR_END")) items.push(`<circle class="cycle-marker-bear-end" cx="${cx}" cy="${cy}" r="4.5"><title>${e(`${baseTitle}\nSignal: Bear End\nInterpretation: Early reclaim of intermediate trend. Wait for leadership confirmation.`)}</title></circle>`);
      if ((row.signals || []).includes("BULL_START")) items.push(`<line class="cycle-marker-bull-start" x1="${cx}" x2="${cx}" y1="10" y2="${height - 10}"><title>${e(`${baseTitle}\nSignal: Bull Start\nInterpretation: Trend confirmation supports index exposure if invalidation is respected.`)}</title></line>`);
      if (index === clean.length - 1) items.push(`<circle class="cycle-marker-current" cx="${cx}" cy="${cy}" r="5"><title>${e(`${baseTitle}\nSignal: Current Day\nInterpretation: Latest completed daily bar used by the model.`)}</title></circle>`);
      return items.join("");
    }).join("");
    const leadership = data.leadership_confirmation || {};
    const leaders = (leadership.top_stocks || []).slice(0, 5);
    const leadersDown = (leadership.former_leaders_down_now?.length ? leadership.former_leaders_down_now : leadership.leaders_down_now || []).slice(0, 5);
    const annotation = leaders.length ? `${leadership.status || "Leadership"}: ${leaders.map((row) => row.symbol).join(", ")}` : `${leadership.status || "Leadership"} confirmation`;
    const downAnnotation = leadersDown.length ? `Down now: ${leadersDown.map((row) => row.symbol).join(", ")}` : "Down now: none flagged";
    const latestX = x(clean.length - 1);
    const boxX = Math.max(pad, Math.min(width - 382, latestX - 372));
    const latestAnnotation = `<g class="cycle-leadership-annotation"><line x1="${latestX}" x2="${latestX}" y1="${pad}" y2="${height - pad}" /><rect x="${boxX}" y="36" width="360" height="62" rx="7" /><text x="${boxX + 10}" y="55">${e(annotation)}</text><text x="${boxX + 10}" y="72">${e(downAnnotation)}</text><text x="${boxX + 10}" y="88">${e(leadership.note || "Latest leadership annotation")}</text></g>`;
    const latest = clean.at(-1) || {};
    const latestTone = Number(latest.close || 0) >= Number(latest.open ?? latest.close) ? "tone-good" : "tone-bad";
    return `<div class="cycle-chart-row ${active ? "active" : ""}" data-cycle-chart-row="${e(symbol)}"><div class="cycle-chart-title"><div><strong title="${e(`${symbol} daily candlestick chart. Showing latest ${clean.length} bars from the selected ${source.length}-bar model window. Y axis is logarithmic.`)}">${e(symbol)}</strong><span>${e(clean.at(0)?.date || "")} to ${e(latest.date || "")} | ${e(clean.length)} daily bars | log scale</span></div><b class="${latestTone}">${e(Number(latest.close || 0).toFixed(2))}</b></div><svg class="cycle-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><g class="cycle-candles">${candles}</g><polyline class="cycle-ma21" points="${ma21}" /><polyline class="cycle-ma50" points="${ma50}" /><polyline class="cycle-ma200" points="${ma200}" />${markers}${latestAnnotation}</svg>${cycleBreadthHistogram(data.breadth_history || [])}</div>`;
  }

  function cycleBreadthHistogram(rows = []) {
    const width = 1200, height = 128, pad = 28;
    const localFmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "NA";
    const clean = rows.filter((row) => Number.isFinite(Number(row.above50_pct))).slice(-90);
    if (!clean.length) return `<div class="widget-empty">No breadth history available.</div>`;
    const x = (index) => pad + (index / Math.max(1, clean.length - 1)) * (width - pad * 2);
    const barW = Math.max(3, Math.min(10, (width - pad * 2) / Math.max(1, clean.length) * .72));
    const y = (value) => height - pad - (Math.max(0, Math.min(100, Number(value))) / 100) * (height - pad * 2);
    const bars = clean.map((row, index) => {
      const value = Number(row.above50_pct || 0);
      const top = y(value), h = Math.max(1, height - pad - top);
      const cls = value >= 55 ? "good" : value >= 40 ? "warn" : "bad";
      return `<rect class="${cls}" x="${x(index) - barW / 2}" y="${top}" width="${barW}" height="${h}" rx="1"><title>${e(`${row.date}\nBreadth >50d: ${value.toFixed(1)}%\nAdvance share: ${localFmt(row.advance_decline_pct, 1)}%\nRS leaders: ${row.rs_leaders}`)}</title></rect>`;
    }).join("");
    const line = clean.map((row, index) => `${x(index)},${y(row.positive_rs_pct ?? row.above50_pct)}`).join(" ");
    return `<div class="cycle-breadth-pane"><header><span>Market Breadth Histogram</span><b title="Bars show % of cache universe above 50d. Line shows positive RS participation.">Above 50d / +RS</b></header><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><line class="mid" x1="${pad}" x2="${width - pad}" y1="${y(50)}" y2="${y(50)}" />${bars}<polyline class="rs-line" points="${line}" /></svg></div>`;
  }

  function cycleHistorySparkline(rows = []) {
    const width = 900, height = 56, pad = 8;
    const clean = rows.filter((row) => Number.isFinite(Number(row.market_health_score)));
    if (!clean.length) return `<div class="widget-empty">No market-health history.</div>`;
    const x = (index) => pad + (index / Math.max(1, clean.length - 1)) * (width - pad * 2);
    const y = (value) => height - pad - (Number(value) / 100) * (height - pad * 2);
    const bands = clean.map((row, index) => `<rect class="${String(row.cycle_bucket || "").includes("BEAR") ? "bad" : String(row.cycle_bucket || "").includes("BULL") ? "good" : "warn"}" x="${x(index)}" y="0" width="${Math.max(2, (width - pad * 2) / clean.length)}" height="${height}"><title>${e(`${row.date}: ${row.cycle_bucket}, health ${row.market_health_score}`)}</title></rect>`).join("");
    const points = clean.map((row, index) => `${x(index)},${y(row.market_health_score)}`).join(" ");
    return `<svg class="cycle-history-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${bands}<polyline points="${points}" /></svg>`;
  }

  async function hydrateGroupCockpitTiles() {
    const tiles = [...root.querySelectorAll("[data-group-cockpit]")].filter((tile) => !tile.dataset.loaded);
    for (const tile of tiles) {
      const kind = tile.dataset.groupCockpit === "industry" ? "industry" : "sector";
      try {
        const response = await fetch(`/api/market/groups?kind=${kind}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        tile.dataset.loaded = "true";
        tile.innerHTML = groupCockpitTemplate(data);
      } catch (error) {
        tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
      }
    }
  }

  function groupCockpitTemplate(data) {
    const row = (item) => `<li class="tone-${e(item.decision?.tone || "neutral")}"><div><strong>${e(item.name)}</strong><span>${e(item.decision?.label || "")}</span></div><b>${e(item.structural)}%</b><small>RS ${e(item.rs)} | 5D ${e(item.perf)}%</small></li>`;
    const best = data.bestGroup || {};
    return `<div class="group-tile-shell">
      <section class="group-tile-hero tone-${e(best.decision?.tone || "neutral")}"><span>${e(data.kind)} leadership | business day ${e(data.regimeDate || data.rsDailyLatestDate || "")}${data.regimeFresh === false ? ` | source ${e(data.sourceRegimeDate || "stale")}` : ""}</span><strong>${e(best.name || "No data")}</strong><p>${e(best.decision?.text || data.subtitle || "")}</p></section>
      <div class="group-stat-grid"><article><span>Structural</span><strong>${e(best.structural ?? "NA")}%</strong><small>${e(best.count ?? 0)} symbols</small></article><article><span>RS 6M</span><strong>${e(best.rs ?? "NA")}</strong></article><article><span>5D</span><strong>${e(best.perf ?? "NA")}%</strong></article></div>
      <div class="group-tile-columns"><div><h4>Best Hunting Grounds</h4><ul>${(data.improving || []).map(row).join("")}</ul></div><div><h4>Pullback Watch</h4><ul>${(data.pullbacks || []).map(row).join("") || `<li><div><strong>No major pullback watch</strong><span>Current leaders do not match this profile.</span></div></li>`}</ul></div></div>
      <div class="group-matrix"><h4>${e(data.kind)} Decision Matrix</h4><ul>${(data.groups || []).slice(0, 8).map(row).join("")}</ul></div>
    </div>`;
  }
  async function hydrateLeadersCockpitTiles() {
    const tiles = [...root.querySelectorAll("[data-leaders-cockpit]")].filter((tile) => !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const response = await fetch("/api/market/leaders?limit=100");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = leadersCockpitTemplate(data);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    }
  }

  function leadersCockpitTemplate(data) {
    const leaderRow = (item, index) => `<li><b>${index + 1}</b><strong>${e(item.stock_symbol)}</strong><span>${e(item.industry)}</span><em>RS3 ${e(item.rs_val_3m)} | RS6 ${e(item.rs_val)} | 5D ${e(item.perf_5d_pct)}%</em></li>`;
    const bucketRow = (item) => `<li><strong>${e(item.name)}</strong><span>${e(item.count)} names | RS3 ${e(item.avgRs3m)}</span></li>`;
    return `<div class="leaders-tile-shell">
      <section class="leaders-tile-hero"><div><span>Leading Stocks</span><strong>Top relative strength candidates</strong><small>latest rs_daily ${e(data.latestDate || "")}</small></div><b>${e(data.count)}</b></section>
      <div class="leaders-columns"><div><h4>Top Leaders</h4><ul class="leader-rank-list">${(data.leaders || []).slice(0, 12).map(leaderRow).join("")}</ul></div><div><h4>Sector Clusters</h4><ul>${(data.topSectors || []).map(bucketRow).join("")}</ul><h4>Industry Clusters</h4><ul>${(data.topIndustries || []).map(bucketRow).join("")}</ul></div></div>
    </div>`;
  }
  async function hydrateSignalsCockpitTiles() {
    const tiles = [...root.querySelectorAll("[data-signals-cockpit]")].filter((tile) => !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
        const response = await fetch("/api/signals/tile?limit=100");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = signalsCockpitTemplate(data);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    }
  }

  async function hydrateWatchlistTiles(force = false) {
    if (!beginHydrate("watchlist")) return;
    const tiles = [...root.querySelectorAll("[data-watchlist-tile]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      const response = await fetch(`/api/watchlist/tile?symbols=NVDA,LLY,AEHR,UNH,AAPL,MSFT&cacheOnly=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = watchlistTemplate(data);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    } finally {
      endHydrate("watchlist");
    }
  }


  function screenerQueryUrl(tile, overrides = {}) {
    const sort = overrides.sort ?? tile.dataset.sort ?? state.screenerView.sort?.key ?? "rs_score";
    const sortDir = overrides.sortDir ?? tile.dataset.sortDir ?? state.screenerView.sort?.dir ?? "desc";
    const filters = encodeURIComponent(JSON.stringify(state.screenerView.filters || []));
    const rs250 = state.screenerView.rs250 !== false ? "1" : "0";
    const limit = overrides.limit ?? SCREENER_PAGE_SIZE;
    const offset = overrides.offset ?? 0;
    return `/api/screener/query?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&rs250=${rs250}&filters=${filters}&sort=${encodeURIComponent(sort)}&sortDir=${encodeURIComponent(sortDir)}`;
  }

  async function hydrateScreenerTiles(force = false) {
    if (!beginHydrate("screener")) return;
    const tiles = [...root.querySelectorAll("[data-screener-tile]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      for (const tile of tiles) {
        const sort = tile.dataset.sort || state.screenerView.sort?.key || "rs_score";
        const sortDir = tile.dataset.sortDir || state.screenerView.sort?.dir || "desc";
        const selected = tile.dataset.selectedSymbol || "";
        try {
          const data = await api(screenerQueryUrl(tile, { sort, sortDir, offset: 0 }), null, "GET");
          if (data.warming) {
            tile.dataset.loaded = "true";
            tile.innerHTML = screenerWarmingTemplate(data.status || {}, data.message);
            bindScreenerTile(tile);
            window.setTimeout(() => { delete tile.dataset.loaded; hydrateScreenerTiles(true); }, 5000);
            continue;
          }
          const firstSymbol = selected || data.rows?.[0]?.symbol || data.rows?.[0]?.stock_symbol || "";
          tile.__screenerRows = data.rows || [];
          tile.__screenerMeta = { total: Number(data.total ?? data.count ?? tile.__screenerRows.length), offset: Number(data.offset || 0), limit: Number(data.limit || SCREENER_PAGE_SIZE), hasMore: Boolean(data.hasMore) };
          tile.dataset.loaded = "true";
          tile.dataset.selectedSymbol = firstSymbol;
          tile.innerHTML = screenerTemplate(data, { sort, sortDir, selectedSymbol: firstSymbol, selectedSymbols: selectedSymbolSet(tile) });
          bindScreenerTile(tile);
          if (firstSymbol) loadScreenerChart(tile, firstSymbol);
        } catch (error) {
          tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
        }
      }
    } finally {
      endHydrate("screener");
    }
  }

  function bindScreenerTile(tile) {
    tile.querySelector("[data-refresh-screener]")?.addEventListener("click", async () => {
      tile.innerHTML = `<div class="widget-loading">Refreshing daily RS cache...</div>`;
      await api("/api/screener/cache/refresh", {}, "POST");
      delete tile.dataset.loaded;
      hydrateScreenerTiles(true);
    });
    tile.querySelector("[data-screener-columns]")?.addEventListener("click", () => openScreenerColumnSettings(tile));
    tile.querySelector("[data-screener-export]")?.addEventListener("click", () => exportScreenerCsv(tile));
    tile.querySelector("[data-screener-load-more]")?.addEventListener("click", () => loadMoreScreenerRows(tile));
    tile.querySelector("[data-backtest-scores]")?.addEventListener("click", () => runScreenerScoreBacktest(tile));
    tile.querySelectorAll("[data-bulk-research]").forEach((button) => button.addEventListener("click", () => addScreenerResearch(tile, [...selectedSymbolSet(tile)], button.dataset.bulkResearch)));
    tile.querySelectorAll("[data-research-action]").forEach((button) => button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      addScreenerResearch(tile, [button.dataset.symbolAction], button.dataset.researchAction);
    }));
    tile.querySelector("[data-rs250-filter]")?.addEventListener("change", (ev) => {
      state.screenerView.rs250 = ev.target.checked;
      if (ev.target.checked && (!state.screenerView.sort || state.screenerView.sort.key === "__none__")) state.screenerView.sort = { key: "rs_rank", dir: "asc" };
      persistScreenerView();
      delete tile.dataset.loaded;
      hydrateScreenerTiles(true);
    });
    tile.querySelectorAll("[data-filter-toggle]").forEach((button) => button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const key = button.dataset.filterToggle;
      tile.querySelectorAll("[data-filter-menu]").forEach((menu) => { if (menu.dataset.filterMenu !== key) menu.hidden = true; });
      const menu = tile.querySelector(`[data-filter-menu="${CSS.escape(key)}"]`);
      if (menu) menu.hidden = !menu.hidden;
    }));
    tile.querySelectorAll("[data-filter-close]").forEach((button) => button.addEventListener("click", () => {
      const menu = tile.querySelector(`[data-filter-menu="${CSS.escape(button.dataset.filterClose)}"]`);
      if (menu) menu.hidden = true;
    }));
    tile.querySelectorAll("[data-filter-pick]").forEach((select) => select.addEventListener("change", () => {
      const input = tile.querySelector(`[data-filter-value="${CSS.escape(select.dataset.filterPick)}"]`);
      if (input) input.value = select.value;
    }));
    tile.querySelectorAll("[data-filter-apply]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.filterApply;
      const mode = tile.querySelector(`[data-filter-mode="${CSS.escape(key)}"]`)?.value || "contains";
      const value = tile.querySelector(`[data-filter-value="${CSS.escape(key)}"]`)?.value || "";
      setScreenerFilter({ key, mode, value });
      delete tile.dataset.loaded;
      hydrateScreenerTiles(true);
    }));
    tile.querySelectorAll("[data-filter-clear]").forEach((button) => button.addEventListener("click", () => {
      clearScreenerFilter(button.dataset.filterClear);
      delete tile.dataset.loaded;
      hydrateScreenerTiles(true);
    }));
    tile.querySelector("[data-screener-select-all]")?.addEventListener("change", (ev) => {
      const rows = [...tile.querySelectorAll("[data-screener-select]")];
      const selected = new Set(ev.target.checked ? rows.map((box) => box.value) : []);
      setSelectedSymbols(tile, selected);
      tile.querySelectorAll(".screener-grid-row").forEach((row) => row.classList.toggle("checked", selected.has(row.dataset.symbol)));
      rows.forEach((box) => { box.checked = selected.has(box.value); });
      updateScreenerFooter(tile);
    });
    tile.querySelectorAll("[data-screener-select]").forEach((box) => box.addEventListener("click", (ev) => ev.stopPropagation()));
    tile.querySelectorAll("[data-screener-select]").forEach((box) => box.addEventListener("change", () => {
      const selected = selectedSymbolSet(tile);
      if (box.checked) selected.add(box.value); else selected.delete(box.value);
      setSelectedSymbols(tile, selected);
      tile.querySelector(`[data-symbol="${CSS.escape(box.value)}"]`)?.classList.toggle("checked", box.checked);
      updateScreenerFooter(tile);
    }));
    tile.querySelectorAll("[data-screener-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.screenerSort;
      if (tile.dataset.sort !== key) { tile.dataset.sort = key; tile.dataset.sortDir = "asc"; }
      else if ((tile.dataset.sortDir || "asc") === "asc") tile.dataset.sortDir = "desc";
      else { tile.dataset.sort = "__none__"; tile.dataset.sortDir = "asc"; }
      state.screenerView.sort = { key: tile.dataset.sort, dir: tile.dataset.sortDir };
      persistScreenerView();
      delete tile.dataset.loaded;
      hydrateScreenerTiles(true);
    }));
    tile.querySelectorAll("[data-symbol]").forEach((row) => row.addEventListener("click", (ev) => {
      if (ev.target.closest("input") || ev.target.closest("button")) return;
      tile.dataset.selectedSymbol = row.dataset.symbol;
      tile.querySelectorAll(".screener-grid-row").forEach((item) => item.classList.toggle("selected", item.dataset.symbol === row.dataset.symbol));
      loadScreenerChart(tile, row.dataset.symbol);
    }));
    bindChartToolbar(tile);
  }

  async function loadMoreScreenerRows(tile) {
    const meta = tile.__screenerMeta || {};
    if (!meta.hasMore || tile.dataset.loadingMore === "true") return;
    const button = tile.querySelector("[data-screener-load-more]");
    tile.dataset.loadingMore = "true";
    if (button) { button.disabled = true; button.textContent = "Loading..."; }
    try {
      const sort = tile.dataset.sort || state.screenerView.sort?.key || "rs_score";
      const sortDir = tile.dataset.sortDir || state.screenerView.sort?.dir || "desc";
      const offset = tile.__screenerRows?.length || 0;
      const data = await api(screenerQueryUrl(tile, { sort, sortDir, offset }), null, "GET");
      const nextRows = [...(tile.__screenerRows || []), ...(data.rows || [])];
      tile.__screenerRows = nextRows;
      tile.__screenerMeta = { total: Number(data.total ?? nextRows.length), offset: Number(data.offset || offset), limit: Number(data.limit || SCREENER_PAGE_SIZE), hasMore: Boolean(data.hasMore) };
      const selectedSymbol = tile.dataset.selectedSymbol || nextRows[0]?.symbol || nextRows[0]?.stock_symbol || "";
      tile.innerHTML = screenerTemplate({ ...data, rows: nextRows, count: nextRows.length, total: tile.__screenerMeta.total, hasMore: tile.__screenerMeta.hasMore }, { sort, sortDir, selectedSymbol, selectedSymbols: selectedSymbolSet(tile) });
      bindScreenerTile(tile);
      if (selectedSymbol) loadScreenerChart(tile, selectedSymbol);
    } catch (error) {
      const status = tile.querySelector("[data-research-status]");
      if (status) status.textContent = `Load more failed: ${error.message}`;
    } finally {
      delete tile.dataset.loadingMore;
    }
  }

  function chartSettings(tile) {
    return { ...defaultDecisionOverlaySettings, ...(state.screenerView.chartSettings || {}), ...(tile.__chartSettings || {}) };
  }
  function saveChartSettings(tile, patch) {
    const next = { ...chartSettings(tile), ...patch };
    tile.__chartSettings = next;
    state.screenerView.chartSettings = next;
    persistScreenerView();
    renderChartToolbar(tile);
    loadScreenerChart(tile, tile.dataset.selectedSymbol);
  }
  function chartIndicatorSet(tile) {
    const raw = tile.dataset.chartIndicators || defaultChartIndicators.join(",");
    return raw.split(",").map((item) => item.trim()).filter(Boolean).filter((key) => screenerChartIndicatorCatalog.some((indicator) => indicator.key === key));
  }
  function setChartIndicators(tile, indicators) {
    const selected = [...indicators].filter((key) => screenerChartIndicatorCatalog.some((indicator) => indicator.key === key));
    tile.dataset.chartIndicators = selected.join(",");
  }
  function bindChartToolbar(tile) {
    tile.querySelector("[data-chart-indicators-toggle]")?.addEventListener("click", () => {
      const menu = tile.querySelector("[data-chart-indicators-menu]");
      if (menu) menu.hidden = !menu.hidden;
    });
    tile.querySelectorAll("[data-add-chart-indicator]").forEach((button) => button.addEventListener("click", () => {
      const next = new Set(chartIndicatorSet(tile));
      next.add(button.dataset.addChartIndicator);
      setChartIndicators(tile, next);
      const menu = tile.querySelector("[data-chart-indicators-menu]");
      if (menu) menu.hidden = true;
      renderChartToolbar(tile);
      loadScreenerChart(tile, tile.dataset.selectedSymbol);
    }));
    tile.querySelectorAll("[data-remove-chart-indicator]").forEach((button) => button.addEventListener("click", () => {
      const next = new Set(chartIndicatorSet(tile));
      next.delete(button.dataset.removeChartIndicator);
      setChartIndicators(tile, next);
      renderChartToolbar(tile);
      loadScreenerChart(tile, tile.dataset.selectedSymbol);
    }));
    tile.querySelector("[data-chart-score-panel-toggle]")?.addEventListener("click", () => saveChartSettings(tile, { showScorePanel: !chartSettings(tile).showScorePanel }));
    tile.querySelector("[data-chart-settings-toggle]")?.addEventListener("click", () => {
      const menu = tile.querySelector("[data-chart-settings-menu]");
      if (menu) menu.hidden = !menu.hidden;
    });
    tile.querySelector("[data-chart-setting-position]")?.addEventListener("change", (ev) => saveChartSettings(tile, { position: ev.target.value }));
    tile.querySelectorAll("[data-chart-setting]").forEach((box) => box.addEventListener("change", () => saveChartSettings(tile, { [box.dataset.chartSetting]: box.checked })));
  }
  function renderChartToolbar(tile) {
    const target = tile.querySelector("[data-chart-toolbar]");
    if (!target) return;
    const selected = new Set(chartIndicatorSet(tile));
    target.innerHTML = chartToolbarTemplate(selected, chartSettings(tile));
    bindChartToolbar(tile);
  }
  function chartToolbarTemplate(selected = new Set(defaultChartIndicators), settings = defaultDecisionOverlaySettings) {
    const active = [...selected].map((key) => screenerChartIndicatorCatalog.find((indicator) => indicator.key === key)).filter(Boolean);
    const available = screenerChartIndicatorCatalog.filter((indicator) => !selected.has(indicator.key));
    const toggles = [
      ["showScorePanel", "Score Panel"], ["showScoreTooltips", "Tooltips"], ["showSituation", "Situation"], ["showPersonality", "Personality"], ["showValidation", "Validation"], ["showCommentary", "Commentary"], ["compactMode", "Compact"]
    ];
    return `<div class="chart-toolbar-main"><button data-chart-indicators-toggle title="Add indicator">+ Indicators</button><button data-chart-score-panel-toggle title="Show or hide decision score panel">${settings.showScorePanel === false ? "Show Scores" : "Hide Scores"}</button><button data-chart-settings-toggle title="Decision overlay settings">Scores</button><div class="chart-indicator-pills">${active.map((indicator) => `<button class="chart-pill ${indicator.type}" data-remove-chart-indicator="${e(indicator.key)}" title="Remove ${e(indicator.label)}"><span>${e(indicator.label)}</span><b>x</b></button>`).join("") || `<span class="chart-empty-pill">No indicators</span>`}</div></div><div class="chart-indicator-menu" hidden data-chart-indicators-menu>${available.map((indicator) => `<button data-add-chart-indicator="${e(indicator.key)}"><strong>${e(indicator.label)}</strong><span>${e(indicator.type === "overlay" ? "Price overlay" : "Separate pane")}</span><small>${e(indicator.description)}</small></button>`).join("") || `<div class="widget-empty">All indicators added.</div>`}</div><div class="chart-settings-menu" hidden data-chart-settings-menu><label><span>Panel Location</span><select data-chart-setting-position>${["top-right", "top-left", "bottom-right", "bottom-left"].map((pos) => `<option value="${pos}" ${settings.position === pos ? "selected" : ""}>${pos.replace("-", " ")}</option>`).join("")}</select></label>${toggles.map(([key, label]) => `<label><input type="checkbox" data-chart-setting="${e(key)}" ${settings[key] ? "checked" : ""}>${e(label)}</label>`).join("")}</div>`;
  }
  async function loadScreenerChart(tile, symbol) {
    if (!symbol) return;
    const panel = tile.querySelector("[data-screener-chart]");
    if (!panel) return;
    panel.innerHTML = `<div class="widget-loading">Loading ${e(symbol)} chart...</div>`;
    try {
      const data = await api(`/api/screener/cache/symbol/${encodeURIComponent(symbol)}`, null, "GET");
      const indicators = chartIndicatorSet(tile);
      panel.innerHTML = screenerChartTemplate(data, indicators, chartSettings(tile));
      bindDecisionSupportTooltips(panel);
      panel.querySelector("[data-hide-score-panel]")?.addEventListener("click", () => saveChartSettings(tile, { showScorePanel: false }));
    } catch (error) {
      panel.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
    }
  }

  function selectedSymbolSet(tile) {
    return new Set(String(tile.dataset.selectedSymbols || "").split(",").map((item) => item.trim()).filter(Boolean));
  }
  function setSelectedSymbols(tile, selected) { tile.dataset.selectedSymbols = [...selected].join(","); }
  function updateScreenerFooter(tile) {
    const selected = selectedSymbolSet(tile).size;
    const footer = tile.querySelector("[data-screener-footer]");
    const shown = tile.querySelectorAll(".screener-grid-row").length || tile.__screenerRows?.length || 0;
    const total = Number(tile.__screenerMeta?.total ?? tile.__screenerRows?.length ?? 0);
    const text = footer?.querySelector("[data-screener-footer-text]");
    if (text) text.textContent = `Showing ${shown} of ${total} results (${selected} selected)`;
  }
  function screenerColumnByKey(key) { return screenerColumnCatalog.find((column) => column.key === key) || { key, label: key, width: "70px", type: "text" }; }
  function normalizeScreenerResearch(saved) {
    const items = Array.isArray(saved?.items) ? saved.items : [];
    return { items: items.filter((item) => item?.symbol && ["WATCH", "BUY"].includes(String(item.action || "").toUpperCase())).slice(0, 1000) };
  }
  function persistScreenerResearch() { repository.write("screener_research_actions", state.screenerResearch); }
  function researchItemsFor(symbol) {
    return (state.screenerResearch?.items || []).filter((item) => item.symbol === symbol);
  }
  function researchLabelFor(symbol) {
    const actions = new Set(researchItemsFor(symbol).map((item) => item.action));
    if (actions.has("BUY")) return "Buy";
    if (actions.has("WATCH")) return "Watch";
    return "";
  }
  function addScreenerResearch(tile, symbols, action) {
    const cleanAction = String(action || "").toUpperCase();
    const cleanSymbols = [...new Set((symbols || []).map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean))];
    if (!["WATCH", "BUY"].includes(cleanAction)) return;
    if (!cleanSymbols.length) {
      const status = tile.querySelector("[data-research-status]");
      if (status) status.textContent = "Select one or more symbols first";
      return;
    }
    const rowsBySymbol = new Map((tile.__screenerRows || []).map((row) => [String(row.symbol || row.stock_symbol || "").toUpperCase(), row]));
    const user = currentSessionUser();
    const stamp = now();
    const next = new Map((state.screenerResearch?.items || []).map((item) => [`${item.symbol}:${item.action}`, item]));
    for (const symbol of cleanSymbols) {
      const row = rowsBySymbol.get(symbol) || {};
      next.set(`${symbol}:${cleanAction}`, {
        symbol,
        action: cleanAction,
        source: "screener",
        reason: "Research queue",
        price: Number(row.close ?? row.last ?? 0) || null,
        rs: Number(row.rs_score ?? row.rs ?? 0) || null,
        rank: Number(row.rs_rank ?? 0) || null,
        addedAt: stamp,
        addedBy: user.username || "user"
      });
    }
    state.screenerResearch = { items: [...next.values()].sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || ""))).slice(0, 1000) };
    persistScreenerResearch();
    tile.querySelectorAll(".screener-grid-row").forEach((row) => applyResearchState(row));
    const status = tile.querySelector("[data-research-status]");
    if (status) status.textContent = `${cleanSymbols.length} ${cleanAction === "BUY" ? "buy" : "watch"} item(s) saved`;
  }
  function applyResearchState(row) {
    const symbol = row.dataset.symbol;
    const label = researchLabelFor(symbol);
    row.classList.toggle("research-watch", label === "Watch");
    row.classList.toggle("research-buy", label === "Buy");
    const badge = row.querySelector("[data-research-badge]");
    if (badge) badge.textContent = label;
  }
  function normalizeScreenerView(saved) {
    const known = new Set(screenerColumnCatalog.map((column) => column.key));
    const migrated = Array.isArray(saved?.columns) ? saved.columns.map((key) => key === "bbs_score" ? "brs_score" : key) : null;
    const columns = ensureDecisionScoreColumns(Array.isArray(migrated) ? migrated.filter((key) => known.has(key)) : defaultScreenerView.columns);
    const scoreColorMode = ["badge", "text", "none"].includes(saved?.scoreColorMode) ? saved.scoreColorMode : defaultScreenerView.scoreColorMode;
    return { ...defaultScreenerView, ...(saved || {}), columns: columns.length ? columns : defaultScreenerView.columns, sort: saved?.sort || defaultScreenerView.sort, scoreColorMode, chartSettings: { ...defaultDecisionOverlaySettings, ...(saved?.chartSettings || {}) } };
  }
  function ensureDecisionScoreColumns(columns = []) {
    const needed = ["tqs_score", "es_score", "brs_score", "cs_score"].filter((key) => !columns.includes(key));
    if (!needed.length) return columns;
    const insertAt = Math.max(0, Math.min(columns.length, (columns.indexOf("perf_1d_pct") >= 0 ? columns.indexOf("perf_1d_pct") + 1 : columns.indexOf("close") + 1) || 2));
    return [...columns.slice(0, insertAt), ...needed, ...columns.slice(insertAt)];
  }
  function persistScreenerView() { repository.write("screener_view", state.screenerView); }
  function beginHydrate(key) {
    if (inFlightHydrates.has(key)) return false;
    inFlightHydrates.add(key);
    return true;
  }
  function endHydrate(key) { inFlightHydrates.delete(key); }

  function openScreenerColumnSettings(tile) {
    const categories = [...new Set(screenerColumnCatalog.map((column) => column.category))];
    const selected = new Set(state.screenerView.columns);
    const presetButtons = Object.keys(screenerPresetColumns).map((name) => `<button type="button" data-screener-preset="${e(name)}" class="${state.screenerView.preset === name ? "active" : ""}">${e(name)}</button>`).join("");
    const categoryBlocks = categories.map((cat) => {
      const cols = screenerColumnCatalog.filter((column) => column.category === cat);
      const count = cols.filter((column) => selected.has(column.key)).length;
      return `<section><h3>${e(cat)} <span>${count}/${cols.length}</span></h3>${cols.map((column) => `<label title="${e(column.description)}"><input type="checkbox" data-screener-column-choice value="${e(column.key)}" ${selected.has(column.key) ? "checked" : ""}>${e(column.label)}<small>${e(column.description)}</small></label>`).join("")}</section>`;
    }).join("");
    const selectedList = state.screenerView.columns.map((key, index) => { const column = screenerColumnByKey(key); return `<li><span>${e(column.label)}</span><button type="button" data-column-up="${e(key)}" ${index === 0 ? "disabled" : ""}>Up</button><button type="button" data-column-down="${e(key)}" ${index === state.screenerView.columns.length - 1 ? "disabled" : ""}>Down</button><button type="button" data-column-remove="${e(key)}">Remove</button></li>`; }).join("");
    const scoreColorOptions = [["badge", "Badge colors"], ["text", "Text colors"], ["none", "No colors"]].map(([value, label]) => `<option value="${value}" ${state.screenerView.scoreColorMode === value ? "selected" : ""}>${label}</option>`).join("");
    root.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-screener-column-modal><div class="user-modal screener-column-modal"><header><div><h2>Column Settings</h2><p>Changes save automatically for this user.</p></div><button type="button" data-close-screener-columns>x</button></header><div class="screener-column-layout"><aside><div class="screener-preset-list">${presetButtons}</div><label class="score-color-option"><span>Score Colors</span><select data-score-color-mode>${scoreColorOptions}</select></label><input data-column-filter placeholder="Search columns" /> <div class="screener-column-cats">${categoryBlocks}</div></aside><main><h3>Selected Columns</h3><ol>${selectedList}</ol></main></div></div></div>`);
    const modal = root.querySelector("[data-screener-column-modal]");
    const close = () => { modal.remove(); delete tile.dataset.loaded; hydrateScreenerTiles(true); };
    modal.querySelector("[data-close-screener-columns]").addEventListener("click", close);
    modal.querySelectorAll("[data-screener-preset]").forEach((button) => button.addEventListener("click", () => { state.screenerView.preset = button.dataset.screenerPreset; state.screenerView.columns = [...screenerPresetColumns[state.screenerView.preset]]; persistScreenerView(); close(); }));
    modal.querySelectorAll("[data-screener-column-choice]").forEach((box) => box.addEventListener("change", () => {
      const next = new Set(state.screenerView.columns);
      if (box.checked) next.add(box.value); else next.delete(box.value);
      state.screenerView.preset = "Custom";
      state.screenerView.columns = [...next];
      persistScreenerView();
    }));
    modal.querySelectorAll("[data-column-remove]").forEach((button) => button.addEventListener("click", () => { state.screenerView.columns = state.screenerView.columns.filter((key) => key !== button.dataset.columnRemove); state.screenerView.preset = "Custom"; persistScreenerView(); close(); }));
    modal.querySelectorAll("[data-column-up],[data-column-down]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.columnUp || button.dataset.columnDown;
      const index = state.screenerView.columns.indexOf(key);
      const delta = button.dataset.columnUp ? -1 : 1;
      const swap = index + delta;
      if (index < 0 || swap < 0 || swap >= state.screenerView.columns.length) return;
      const next = [...state.screenerView.columns];
      [next[index], next[swap]] = [next[swap], next[index]];
      state.screenerView = { ...state.screenerView, preset: "Custom", columns: next };
      persistScreenerView();
      close();
    }));
    modal.querySelector("[data-score-color-mode]")?.addEventListener("change", (ev) => {
      state.screenerView.scoreColorMode = ev.target.value;
      persistScreenerView();
    });
    modal.querySelector("[data-column-filter]").addEventListener("input", (ev) => {
      const needle = ev.target.value.toLowerCase();
      modal.querySelectorAll("[data-screener-column-choice]").forEach((box) => { box.closest("label").hidden = !box.closest("label").textContent.toLowerCase().includes(needle); });
    });
  }

  async function runScreenerScoreBacktest(tile) {
    const selected = [...selectedSymbolSet(tile)];
    const fallback = tile.dataset.selectedSymbol ? [tile.dataset.selectedSymbol] : [];
    const symbols = (selected.length ? selected : fallback).slice(0, 10);
    if (!symbols.length) return alert("Select up to 10 screener symbols first.");
    openBacktestModal({ loading: true, symbols });
    try {
      const report = await api("/api/screener/backtest-scores", { symbols }, "POST");
      if (report.error) throw new Error(report.error);
      openBacktestModal(report);
    } catch (error) {
      openBacktestModal({ error: error.message, symbols });
    }
  }
  function openBacktestModal(report = {}) {
    root.querySelector("[data-score-backtest-modal]")?.remove();
    root.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-score-backtest-modal><div class="user-modal score-backtest-modal"><header><div><h2>Score Backtest</h2><p>${e(report.loading ? "Calling EODHD directly for selected symbols..." : report.error ? "Backtest failed" : `Direct EODHD daily bars | ${report.from || ""} to ${report.to || ""}`)}</p></div><button type="button" data-close-backtest>x</button></header>${backtestReportTemplate(report)}</div></div>`);
    root.querySelector("[data-close-backtest]")?.addEventListener("click", () => root.querySelector("[data-score-backtest-modal]")?.remove());
  }
  function backtestReportTemplate(report = {}) {
    if (report.loading) return `<div class="backtest-loading"><div class="cache-progress-track"><span style="--w:46%"></span></div><strong>Backtesting ${e((report.symbols || []).join(", "))}</strong><p>Fetching EODHD bars, computing score layers, and comparing outcomes.</p></div>`;
    if (report.error) return `<div class="widget-error"><strong>${e(report.error)}</strong><p>Check selected symbols and EODHD connectivity.</p></div>`;
    const labels = { baseline: "Baseline", tqs: "+ TQS", tqs_brs: "+ TQS+BRS", tqs_brs_es: "+ ES<=60", tqs_brs_es_cs: "+ CS" };
    const metricRow = ([key, item]) => `<tr><th>${e(labels[key] || key)}</th><td>${e(item?.count ?? 0)}</td><td>${e(item?.winRate ?? "NA")}%</td><td>${e(item?.avg5dReturn ?? "NA")}%</td><td>${e(item?.avg10dReturn ?? "NA")}%</td><td>${e(item?.avg20dReturn ?? "NA")}%</td><td>${e(item?.profitFactor ?? "NA")}</td><td>${e(item?.expectancy ?? "NA")}%</td><td>${e(item?.maxDrawdown ?? "NA")}%</td></tr>`;
    const symbolCard = (item) => `<article><header><strong>${e(item.symbol)}</strong><span>${e(item.bars)} bars</span></header><small>${e(item.startDate || "")} to ${e(item.endDate || "")}</small><table><tbody>${Object.entries(item.experiments || {}).map(metricRow).join("")}</tbody></table><footer>ES avoided correctly ${e(item.extensionValidation?.avoidedCorrectly ?? 0)} | missed winners ${e(item.extensionValidation?.missedWinners ?? 0)} | net ${e(item.extensionValidation?.netBenefit ?? "NA")}%</footer></article>`;
    return `<section class="score-backtest-report"><div class="backtest-summary"><span>${e((report.results || []).length)} symbols</span><span>${e((report.failures || []).length)} failure(s)</span><span>${e(report.source || "eodhd.direct")}</span></div><table class="backtest-aggregate"><thead><tr><th>Experiment</th><th>Trades</th><th>Win</th><th>5D</th><th>10D</th><th>20D</th><th>PF</th><th>Exp</th><th>DD</th></tr></thead><tbody>${Object.entries(report.aggregate || {}).map(metricRow).join("")}</tbody></table><div class="backtest-symbols">${(report.results || []).map(symbolCard).join("")}</div>${(report.failures || []).length ? `<div class="widget-error"><strong>Failures</strong>${report.failures.map((f) => `<p>${e(f.symbol)}: ${e(f.error)}</p>`).join("")}</div>` : ""}<p class="backtest-note">${e(report.note || "")}</p></section>`;
  }
  async function exportScreenerCsv(tile) {
    const columns = state.screenerView.columns.map(screenerColumnByKey);
    const selected = selectedSymbolSet(tile);
    let sourceRows = tile.__screenerRows || [];
    if (!selected.size && tile.__screenerMeta?.hasMore) {
      const sort = tile.dataset.sort || state.screenerView.sort?.key || "rs_score";
      const sortDir = tile.dataset.sortDir || state.screenerView.sort?.dir || "desc";
      const data = await api(screenerQueryUrl(tile, { sort, sortDir, offset: 0, limit: 15000 }), null, "GET");
      sourceRows = data.rows || sourceRows;
    }
    const rows = sourceRows.filter((row) => !selected.size || selected.has(row.symbol || row.stock_symbol));
    const csv = [columns.map((column) => `"${column.label.replaceAll('"', '""')}"`).join(","), ...rows.map((row) => columns.map((column) => `"${String(row[column.key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `mtm-screener-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  function screenerWarmingTemplate(status = {}, message = "Screener cache is loading.") {
    const startedAt = status.warmStartedAt ? new Date(status.warmStartedAt) : null;
    const elapsed = startedAt && Number.isFinite(startedAt.getTime()) ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) : 0;
    const targetSeconds = status.store === "redis" ? 55 : 110;
    const basePct = elapsed ? Math.min(94, Math.max(8, Math.round((elapsed / targetSeconds) * 100))) : 12;
    const hasPriorCache = Number(status.rowCount || 0) > 0 && Number(status.symbolCount || 0) > 0;
    const progress = status.warming === false ? 100 : Math.min(hasPriorCache ? 96 : 88, basePct);
    const started = startedAt ? startedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "starting";
    const stage = progress < 30 ? "Connecting to data cache" : progress < 60 ? "Loading RS Daily history" : progress < 90 ? "Preparing screener rows and chart scores" : "Rendering screener panel";
    return `<div class="screener-shell screener-grid-shell cache-loading-shell"><header><div><span>Latest Business Day Screener</span><strong>Loading screener data</strong></div><small>${e(status.warmReason || "startup")} | ${e(started)}</small><button data-refresh-screener title="Rebuild cache">Refresh</button></header><div class="screener-meta"><span>${e(status.days || 260)}d calculation window</span><span>${e(status.store || "cache")}</span><span>${e(status.status || "warming")}</span><span>${e(status.symbolCount || 0)} symbols</span></div><div class="cache-warming"><div class="cache-progress-head"><strong>${e(stage)}</strong><b>${e(progress)}%</b></div><div class="cache-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(progress)}"><span style="--w:${e(progress)}%"></span></div><div class="cache-progress-steps"><span class="${progress >= 20 ? "done" : "active"}">Connect</span><span class="${progress >= 45 ? "done" : progress >= 20 ? "active" : ""}">Load</span><span class="${progress >= 75 ? "done" : progress >= 45 ? "active" : ""}">Score</span><span class="${progress >= 92 ? "active" : ""}">Render</span></div><p>${e(message === "Daily RS cache is warming. Try again shortly." ? "The screener is loading cache data and will open automatically." : message)}</p><small>Latest ${e(status.latestDate || "pending")} | rows ${Number(status.rowCount || 0).toLocaleString()} | elapsed ${e(elapsed)}s</small></div></div>`;
  }

  function screenerFilterFor(key) { return (state.screenerView.filters || []).find((filter) => filter.key === key) || null; }
  function setScreenerFilter(filter) {
    const filters = (state.screenerView.filters || []).filter((item) => item.key !== filter.key);
    if (filter.value != null && filter.value !== "") filters.push(filter);
    state.screenerView.filters = filters;
    persistScreenerView();
  }
  function clearScreenerFilter(key) {
    state.screenerView.filters = (state.screenerView.filters || []).filter((item) => item.key !== key);
    persistScreenerView();
  }
  function columnFilterMenuTemplate(column, data) {
    const current = screenerFilterFor(column.key) || {};
    const scoreFilterColumns = new Set(["tqs_score", "es_score", "brs_score", "cs_score"]);
    if (scoreFilterColumns.has(column.key)) {
      const value = ["red", "amber", "green"].includes(String(current.value || "").toLowerCase()) ? String(current.value).toLowerCase() : "";
      return `<div class="excel-filter-menu" hidden data-filter-menu="${e(column.key)}"><header><strong>${e(column.label)}</strong><button data-filter-close="${e(column.key)}">x</button></header><input type="hidden" data-filter-mode="${e(column.key)}" value="score_grade" /><label><span>Grade</span><select data-filter-value="${e(column.key)}"><option value="">Any grade</option><option value="green" ${value === "green" ? "selected" : ""}>Green</option><option value="amber" ${value === "amber" ? "selected" : ""}>Amber</option><option value="red" ${value === "red" ? "selected" : ""}>Red</option></select></label><footer><button data-filter-apply="${e(column.key)}">Apply</button><button data-filter-clear="${e(column.key)}">Clear</button></footer></div>`;
    }
    const textValues = column.type === "text" ? [...new Set((data.rows || []).map((row) => row[column.key]).filter(Boolean).map(String))].sort().slice(0, 80) : [];
    const numeric = ["number", "score", "percent", "price", "volume", "money"].includes(column.type);
    const modeOptions = numeric
      ? [["gt", "Greater than"], ["gte", "Greater/equal"], ["lt", "Less than"], ["lte", "Less/equal"], ["eq", "Equal to"], ["neq", "Not equal"]]
      : [["contains", "Contains"], ["equals_text", "Equals"], ["starts", "Starts with"], ["ends", "Ends with"]];
    return `<div class="excel-filter-menu" hidden data-filter-menu="${e(column.key)}"><header><strong>${e(column.label)}</strong><button data-filter-close="${e(column.key)}">x</button></header><label><span>Condition</span><select data-filter-mode="${e(column.key)}">${modeOptions.map(([value, label]) => `<option value="${value}" ${current.mode === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label><span>Value</span><input data-filter-value="${e(column.key)}" value="${e(current.value ?? "")}" placeholder="Filter value" /></label>${textValues.length ? `<label><span>Pick value</span><select data-filter-pick="${e(column.key)}"><option value="">Select...</option>${textValues.map((value) => `<option>${e(value)}</option>`).join("")}</select></label>` : ""}<footer><button data-filter-apply="${e(column.key)}">Apply</button><button data-filter-clear="${e(column.key)}">Clear</button></footer></div>`;
  }
  function screenerTemplate(data, viewState = {}) {
    const visible = state.screenerView.columns.map(screenerColumnByKey);
    const gridCols = `28px 92px ${visible.map((column) => column.width || "70px").join(" ")}`;
    const fmt = (value, column) => {
      if (value == null || value === "") return "--";
      if (column.type === "boolean") return value ? "Y" : "";
      const number = Number(value);
      if (!Number.isFinite(number)) return String(value);
      if (column.type === "volume") return number >= 1000000 ? `${(number / 1000000).toFixed(1)}M` : number >= 1000 ? `${(number / 1000).toFixed(0)}K` : String(Math.round(number));
      if (column.type === "money") return number >= 1000000000 ? `$${(number / 1000000000).toFixed(1)}B` : number >= 1000000 ? `$${(number / 1000000).toFixed(1)}M` : `$${Math.round(number).toLocaleString()}`;
      return number.toFixed(column.digits ?? 2) + (column.type === "percent" ? "%" : "");
    };
    const tone = (value) => Number(value || 0) > 0 ? "good" : Number(value || 0) < 0 ? "bad" : "neutral";
    const scoreColumns = new Set(["tqs_score", "es_score", "brs_score", "cs_score"]);
    const scoreTone = (key, value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return "neutral";
      if (key === "es_score") return number <= 35 ? "green" : number <= 60 ? "amber" : "red";
      return number >= 70 ? "green" : number >= 45 ? "amber" : "red";
    };
    const cellClass = (column, item) => {
      if (scoreColumns.has(column.key)) {
        const mode = state.screenerView.scoreColorMode || "badge";
        if (mode === "none") return "score-cell score-none";
        return `score-cell score-mode-${mode} score-${scoreTone(column.key, item[column.key])}`;
      }
      return `${["percent", "score", "number"].includes(column.type) ? `tone-${tone(item[column.key])}` : ""} ${column.type === "text" ? "truncate" : ""}`;
    };
    const sortMark = (key) => viewState.sort === key ? (viewState.sortDir === "asc" ? " ^" : " v") : "";
    const head = `<span><input type="checkbox" data-screener-select-all title="Select all visible rows"></span><span class="screener-action-head">Research</span>` + visible.map((column) => `<div class="screener-head-cell ${screenerFilterFor(column.key) ? "filtered" : ""}"><button data-screener-sort="${e(column.key)}" class="${viewState.sort === column.key ? "active" : ""}" title="${e(column.description || column.label)}">${e(column.label)}${sortMark(column.key)}</button><button class="filter-trigger" data-filter-toggle="${e(column.key)}" title="Filter ${e(column.label)}">v</button>${columnFilterMenuTemplate(column, data)}</div>`).join("");
    const selected = viewState.selectedSymbols || new Set();
    const row = (item) => {
      const symbol = item.symbol || item.stock_symbol;
      const researchLabel = researchLabelFor(symbol);
      return `<div class="screener-grid-row ${viewState.selectedSymbol === symbol ? "selected" : ""} ${selected.has(symbol) ? "checked" : ""} ${researchLabel === "Watch" ? "research-watch" : ""} ${researchLabel === "Buy" ? "research-buy" : ""}" data-symbol="${e(symbol)}" style="--screener-cols:${e(gridCols)}"><span><input type="checkbox" data-screener-select value="${e(symbol)}" ${selected.has(symbol) ? "checked" : ""}></span><span class="screener-research-actions"><button data-research-action="WATCH" data-symbol-action="${e(symbol)}" title="Add ${e(symbol)} to research watch">Watch</button><button data-research-action="BUY" data-symbol-action="${e(symbol)}" title="Mark ${e(symbol)} as research buy">Buy</button><small data-research-badge>${e(researchLabel)}</small></span>${visible.map((column) => `<span class="${cellClass(column, item)}">${column.key === "symbol" ? `<strong>${e(symbol)}</strong>` : e(fmt(item[column.key], column))}</span>`).join("")}</div>`;
    };
    const loadedCount = (data.rows || []).length;
    const totalCount = Number(data.total ?? data.count ?? loadedCount);
    const hasMore = Boolean(data.hasMore || loadedCount < totalCount);
    const rows = (data.rows || []).map(row).join("");
    const indicatorToolbar = chartToolbarTemplate(new Set(defaultChartIndicators), state.screenerView.chartSettings || defaultDecisionOverlaySettings);
    return `<div class="screener-shell screener-grid-shell"><header><div><span>Latest Business Day Screener</span><strong>${e(state.screenerView.preset || "Custom")} view</strong></div><small>display ${e(data.cache?.displayDate || data.cache?.latestDate || "")} | calc ${e(data.cache?.days || 260)}d cache</small><div class="screener-actions"><button data-bulk-research="WATCH" title="Add selected rows to research watch">Watch Selected</button><button data-bulk-research="BUY" title="Mark selected rows as research buy">Buy Selected</button><button data-backtest-scores title="Backtest selected score framework with direct EODHD data">Backtest 10</button><button data-screener-columns title="Column settings">Columns</button><button data-screener-export title="Export selected or filtered rows">CSV</button><button data-refresh-screener title="Rebuild cache">Refresh</button></div></header><div class="screener-meta"><span>${e(totalCount)} matches</span><label class="rs250-toggle"><input type="checkbox" data-rs250-filter ${state.screenerView.rs250 !== false ? "checked" : ""}> RS250</label><span>${e((state.screenerView.filters || []).length)} column filter(s)</span><span>${e(data.cache?.calculationWindow || "")}</span><span class="research-status" data-research-status>${e((state.screenerResearch?.items || []).length)} research item(s)</span></div><div class="screener-split"><section class="screener-grid"><div class="screener-grid-head" style="--screener-cols:${e(gridCols)}">${head}</div><div class="screener-rows">${rows || `<div class="widget-empty">No rows match the cache filters.</div>`}</div><footer class="screener-footer" data-screener-footer><span data-screener-footer-text>Showing ${e(loadedCount)} of ${e(totalCount)} results (${selected.size} selected)</span>${hasMore ? `<button data-screener-load-more>Load More</button>` : ""}</footer></section><aside class="screener-chart-panel"><div class="screener-indicators" data-chart-toolbar>${indicatorToolbar}</div><div data-screener-chart><div class="widget-loading">Select a symbol</div></div></aside></div></div>`;
  }
  function chartScale(values, minPad = 0.08) {
    const nums = values.map(Number).filter(Number.isFinite);
    const min = Math.min(...nums), max = Math.max(...nums);
    const pad = Math.max((max - min) * minPad, max ? Math.abs(max) * 0.02 : 1);
    return { min: min - pad, max: max + pad || min + 1 };
  }

  function linePath(values, w, h, scale) {
    const points = values.map((value, i) => {
      const x = values.length <= 1 ? 0 : i * (w / (values.length - 1));
      const y = h - ((Number(value) - scale.min) / (scale.max - scale.min || 1)) * h;
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return points.join(" ");
  }

  function decisionSupportTemplate(model, settings = defaultDecisionOverlaySettings) {
    if (!model || settings.showScorePanel === false) return "";
    const fmtPct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "NA";
    const scoreRow = (metric) => `<tr class="score-${e(metric.tone || "neutral")}"><th>${e(metric.key)}</th><td>${e(metric.score ?? "NA")}</td><td><span class="score-badge ${e(metric.tone || "neutral")}">${e(metric.status || "NA")}</span></td><td>${settings.showScoreTooltips === false ? "" : scoreTooltipTemplate(metric)}</td></tr>`;
    const personality = model.personality || {};
    return `<section class="decision-overlay ${e(settings.position || "top-right")} ${settings.compactMode ? "compact" : ""}"><header><strong>Decision Scores</strong><small>${e(model.latestDate || "")}</small><button type="button" data-hide-score-panel title="Hide score panel">x</button></header><table><thead><tr><th>Metric</th><th>Score</th><th>Status</th><th>Info</th></tr></thead><tbody>${(model.metrics || []).map(scoreRow).join("")}</tbody></table>${settings.showSituation === false ? "" : `<div class="situation-label"><b>${e(model.situation?.label || "Situation")}</b><span>${e(model.situation?.text || "")}</span></div>`}${settings.showPersonality === false ? "" : `<dl class="personality-panel"><dt>Personality</dt><dd>${e(personality.type || "Unknown")}</dd><dt>Typical Pullback</dt><dd>${e(fmtPct(personality.typicalPullbackPct))}</dd><dt>Current Pullback</dt><dd>${e(fmtPct(personality.currentPullbackPct))}</dd><dt>Stretch Used</dt><dd>${e(fmtPct(personality.historicalStretchUtilizedPct))}</dd><dt>Persistence</dt><dd>${e(personality.trendPersistence || "NA")}</dd><dt>Volatility</dt><dd>${e(personality.volatilityClass || "NA")}</dd></dl>`}${settings.showValidation === false ? "" : `<div class="validation-badge" title="${e(model.validation?.tooltip || "")}">${e(model.validation?.badge || model.validation?.status || "Insufficient Data")}</div>`}${settings.showCommentary === false ? "" : `<p class="decision-commentary">${e(model.validation?.status === "Insufficient Data" ? "Scores are informational until the historical validation agent produces conclusive results." : "Validated score framework available for this symbol.")}</p>`}</section>`;
  }
  function scoreTooltipTemplate(metric) {
    const details = metric.expanded || {};
    return `<details class="score-info"><summary title="${e(metric.tooltip || "Score details")}">i</summary><div class="score-popover"><strong>${e(metric.name || metric.key)}</strong><p>${e(metric.tooltip || "")}</p><dl><dt>Current Score</dt><dd>${e(details.currentScore ?? metric.score ?? "NA")}</dd><dt>Status</dt><dd>${e(details.status || metric.status || "NA")}</dd><dt>Meaning</dt><dd>${e(details.meaning || metric.interpretation || "")}</dd><dt>Validated</dt><dd>${e(details.historicallyValidated || "Insufficient Data")}</dd></dl><b>Top Contributors</b><ol>${(details.topContributors || []).slice(0, 3).map((item) => `<li>${e(item)}</li>`).join("")}</ol><b>Improves</b><p>${e(details.improves || "")}</p><b>Weakens</b><p>${e(details.weakens || "")}</p><b>Action Hint</b><p>${e(details.actionHint || "Use with chart structure and risk rules.")}</p></div></details>`;
  }
  function bindDecisionSupportTooltips(panel) {
    panel.querySelectorAll(".score-info").forEach((details) => details.addEventListener("toggle", () => {
      if (!details.open) return;
      panel.querySelectorAll(".score-info").forEach((other) => { if (other !== details) other.open = false; });
    }));
    const close = (ev) => {
      if (ev.target.closest?.(".score-info")) return;
      panel.querySelectorAll(".score-info[open]").forEach((details) => { details.open = false; });
    };
    panel.addEventListener("click", close);
  }
  function screenerChartTemplate(data, indicators = [], settings = defaultDecisionOverlaySettings) {
    const rows = [...(data.rows || [])]
      .filter((row) => row.sdate && row.open != null && row.high != null && row.low != null && row.close != null)
      .sort((a, b) => String(a.sdate).localeCompare(String(b.sdate)))
      .slice(-120);
    if (!rows.length) return `<div class="widget-empty">No chart history.</div>`;
    const selected = new Set(indicators.length ? indicators : defaultChartIndicators);
    const activeIndicators = screenerChartIndicatorCatalog.filter((indicator) => selected.has(indicator.key));
    const overlayIndicators = activeIndicators.filter((indicator) => indicator.type === "overlay");
    const paneIndicators = activeIndicators.filter((indicator) => indicator.type !== "overlay");
    const latest = data.latest || rows.at(-1) || {};
    const w = 640, priceH = 270, volH = 72, laneH = 64;
    const derivedRows = rows.map((_, index) => deriveClientStockbee(rows.slice(0, index + 1)));
    const priceScale = chartScale(rows.flatMap((r) => [r.high, r.low, r.open, r.close]));
    const maxVol = Math.max(...rows.map((r) => Number(r.volume || 0)), 1);
    const minVolumeBarH = 3;
    const step = w / rows.length;
    const priceY = (v) => priceH - ((Number(v) - priceScale.min) / (priceScale.max - priceScale.min || 1)) * priceH;
    const candles = rows.map((r, i) => {
      const x = i * step + step / 2;
      const open = Number(r.open), close = Number(r.close), high = Number(r.high), low = Number(r.low);
      const up = close >= open;
      const bodyY = Math.min(priceY(open), priceY(close));
      const bodyH = Math.max(1, Math.abs(priceY(close) - priceY(open)));
      return `<g class="${up ? "up" : "down"}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${priceY(high).toFixed(1)}" y2="${priceY(low).toFixed(1)}"/><rect x="${(x - Math.max(2, step * .28)).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${Math.max(2, step * .56).toFixed(1)}" height="${bodyH.toFixed(1)}"/></g>`;
    }).join("");
    const overlays = overlayIndicators.map((indicator, index) => {
      const vals = derivedRows.map((row) => row[indicator.key]);
      const valid = vals.filter((value) => Number.isFinite(Number(value)));
      if (!valid.length) return "";
      const path = linePath(vals.map((value) => Number.isFinite(Number(value)) ? value : valid[0]), w, priceH, priceScale);
      return `<path class="overlay-line overlay-${index}" d="${path}"/>`;
    }).join("");
    const volumes = rows.map((r, i) => {
      const x = i * step;
      const rawVolume = Number(r.volume || 0);
      const h = rawVolume > 0 ? Math.max(minVolumeBarH, rawVolume / maxVol * volH) : 0;
      const up = Number(r.close || 0) >= Number(r.open || 0);
      return `<rect class="${up ? "up" : "down"}" x="${x.toFixed(1)}" y="${(volH - h).toFixed(1)}" width="${Math.max(2, step * .72).toFixed(1)}" height="${h.toFixed(1)}"/>`;
    }).join("");
    const panes = paneIndicators.map((indicator) => {
      const vals = derivedRows.map((row) => row[indicator.key]).map((v) => Number.isFinite(Number(v)) ? Number(v) : null);
      const valid = vals.filter((v) => v != null);
      if (!valid.length) return "";
      const scale = chartScale(valid);
      const path = linePath(vals.map((v) => v ?? valid[0]), w, laneH, scale);
      const latestValue = vals.at(-1);
      return `<div class="indicator-lane"><header><strong>${e(indicator.label)}</strong><span>${latestValue == null ? "--" : Number(latestValue).toFixed(2)}</span></header><svg viewBox="0 0 ${w} ${laneH}" preserveAspectRatio="none"><path d="${path}"/></svg></div>`;
    }).join("");
    const overlayLegend = overlayIndicators.length ? `<div class="overlay-legend">${overlayIndicators.map((indicator, index) => `<span class="overlay-${index}">${e(indicator.label)}</span>`).join("")}</div>` : "";
    const decisionOverlay = decisionSupportTemplate(data.decisionSupport, settings);
    return `<div class="screener-chart decision-chart"><header><div><strong>${e(data.symbol)}</strong><span>1D daily bars | ${e(latest.sdate || "")} ${e(latest.sector || "")} ${e(latest.industry || "")}</span>${overlayLegend}</div><b>${Number(latest.close || 0).toFixed(2)}</b></header><div class="chart-price-wrap"><svg class="candle-chart" viewBox="0 0 ${w} ${priceH}" preserveAspectRatio="none">${candles}${overlays}</svg>${decisionOverlay}</div><div class="volume-pane"><span>Vol</span><svg class="volume-chart" viewBox="0 0 ${w} ${volH}" preserveAspectRatio="none">${volumes}</svg></div>${panes}</div>`;
  }
  function deriveClientStockbee(rows = []) {
    const number = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
    const avg = (field, n) => { const vals = rows.slice(-n).map((r) => number(r[field])).filter((v) => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; };
    const prior = (n) => rows.length > n ? rows[rows.length - 1 - n] : null;
    const latest = rows.at(-1) || {}, close = number(latest.close);
    const minLow = rows.slice(-252).map((r) => number(r.low)).filter((v) => v != null);
    const avgC4 = avg("close", 4), avgC7 = avg("close", 7), avgC20 = avg("close", 20), avgC42 = avg("close", 42), avgC50 = avg("close", 50), avgC65 = avg("close", 65), avgC126 = avg("close", 126);
    const trueRanges = rows.map((row, index) => {
      const high = number(row.high), low = number(row.low), prevClose = index ? number(rows[index - 1].close) : null;
      if (high == null || low == null) return null;
      return Math.max(high - low, prevClose == null ? high - low : Math.abs(high - prevClose), prevClose == null ? high - low : Math.abs(low - prevClose));
    }).filter((value) => value != null);
    const atr = (n) => { const vals = trueRanges.slice(-n); return vals.length === n ? vals.reduce((a, b) => a + b, 0) / vals.length : null; };
    const shortAtr = [atr(3), atr(5), atr(8)].filter((value) => value != null);
    const shortAvg = shortAtr.length ? shortAtr.reduce((a, b) => a + b, 0) / shortAtr.length : null;
    const recentAtr = rows.slice(-5).map((_, index, sample) => {
      const sampleRows = rows.slice(0, rows.length - sample.length + index + 1);
      const ranges = sampleRows.map((row, rowIndex) => {
        const high = number(row.high), low = number(row.low), prevClose = rowIndex ? number(sampleRows[rowIndex - 1].close) : null;
        if (high == null || low == null) return null;
        return Math.max(high - low, prevClose == null ? high - low : Math.abs(high - prevClose), prevClose == null ? high - low : Math.abs(low - prevClose));
      }).filter((value) => value != null);
      const a = (n) => { const vals = ranges.slice(-n); return vals.length === n ? vals.reduce((x, y) => x + y, 0) / vals.length : null; };
      const vals = [a(3), a(5), a(8)].filter((value) => value != null);
      return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    }).filter((value) => value != null);
    const rmvMin = recentAtr.length ? Math.min(...recentAtr) : null, rmvMax = recentAtr.length ? Math.max(...recentAtr) : null;
    const rmv = shortAvg != null && rmvMin != null && rmvMax != null && rmvMax !== rmvMin ? 100 * (shortAvg - rmvMin) / (rmvMax - rmvMin) : null;
    return {
      sma20: avgC20,
      sma50: avgC50,
      ti65_mom: avgC7 && avgC65 ? avgC7 / avgC65 : null,
      mdt_mom: close && avgC126 ? close / avgC126 : null,
      m21_mom: close && number(prior(21)?.close) ? close / number(prior(21).close) : null,
      m10_mom: close && number(prior(10)?.close) ? close / number(prior(10).close) : null,
      m5_mom: close && number(prior(5)?.close) ? close / number(prior(5).close) : null,
      c20: close && number(prior(20)?.close) ? 100 * (close / number(prior(20).close) - 1) : null,
      rmv,
      dt_mom: close && minLow.length ? close / Math.min(...minLow) : null,
      ti42_mom: avgC4 && avgC42 ? 100 * avgC4 / avgC42 : null
    };
  }  function watchlistTemplate(data) {
    const row = (item) => `<button class="watchlist-row" data-symbol="${e(item.symbol)}"><div><strong>${e(item.symbol)}</strong><span>${e(item.industry || item.sector || "Unknown")}</span></div><b class="tone-${e(item.tone || "neutral")}">${e(item.changePct ?? "NA")}%</b><small><span class="ticker-value tone-${e(item.tone || "neutral")}">Price ${e(item.price ?? "NA")}</span><span>RS3 ${e(item.rs3 ?? "NA")}</span><span>MCI ${e(item.mci ?? "NA")}</span></small></button>`;
    return `<div class="watchlist-shell"><header><div><span>Watchlist Cache</span><strong>Growth Leaders</strong></div><small>${e(data.latestDate || "")}</small></header><div class="watchlist-rows">${(data.items || []).map(row).join("")}</div></div>`;
  }

  async function hydrateRiskCockpitTiles() {
    const tiles = [...root.querySelectorAll("[data-risk-cockpit]")].filter((tile) => !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const response = await fetch("/api/risk/tile");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.__riskData = data;
        tile.innerHTML = riskCockpitTemplate(data, tile.__riskSelected);
        tile.querySelector("[data-risk-settings]")?.addEventListener("submit", saveRiskSettings);
        bindRiskCockpit(tile);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    }
  }

  function riskCockpitTemplate(data, selectedSymbol = null) {
    const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString()}`;
    const metric = (label, value) => `<article><span>${label}</span><strong>${e(value)}</strong></article>`;
    const guardrail = (item) => `<li class="tone-${e(item.tone || "neutral")}"><b>${e(item.state)}</b><div><strong>${e(item.metric)}</strong><span>${e(item.text)}</span></div></li>`;
    const stateTone = (state = "") => /URGENT|SELL/.test(state) ? "bad" : /TAKE|TIGHTEN|TIME/.test(state) ? "neutral" : "good";
    const trade = (item) => {
      const tone = Number(item.current_pnl_pct || 0) >= 0 ? "good" : "bad";
      return `<li data-symbol="${e(item.stock_symbol)}"><strong>${e(item.stock_symbol)}</strong><b class="tone-${tone}">${e(item.current_pnl_pct ?? 0)}%</b><small>Entry ${e(item.entry_price ?? "NA")} | Last ${e(item.latest_close ?? "NA")} | Stop ${e(item.initial_stop ?? "NA")} | ${e(item.recommendation || "HOLD")}</small><span>${e(item.industry || "Unknown")}</span></li>`;
    };
    const sellRow = (item) => {
      const tone = stateTone(item.current_sell_rule_state || "");
      return `<tr data-risk-symbol="${e(item.stock_symbol)}"><td><strong>${e(item.stock_symbol)}</strong><small>${e(item.sector || "Unknown")} | ${e(item.industry || "Unknown")}</small></td><td>${e(item.entry_date || "NA")}</td><td>${e(item.weeks_held ?? "NA")}</td><td>${e(item.entry_price ?? "NA")}</td><td class="tone-${Number(item.current_pnl_pct || 0) >= 0 ? "good" : "bad"}">${e(item.current_pnl_pct ?? "NA")}%</td><td>${e(item.initial_stop ?? "NA")}</td><td>${e(item.highest_price_since_entry ?? "NA")}</td><td><span class="risk-state-pill tone-${e(tone)}">${e(item.current_sell_rule_state || "HOLD")}</span></td><td>${e(item.active_rule || "")}</td><td>${e(item.eight_week_date || "NA")}</td><td>${e(item.thirteen_week_date || "NA")}</td><td>${e(item.rs_trend || "NA")}</td><td>${e(item.market_regime || "NA")}</td><td><strong>${e(item.recommendation || "HOLD")}</strong><small>${e(item.journal_reason || "")}</small></td></tr>`;
    };
    const suggestionRow = (item) => `<tr><td><strong>${e(item.symbol || "NA")}</strong><small>${e(item.strategy || "")}</small></td><td>${e(item.journalEntryType || "")}</td><td>${e(item.observation || "")}</td><td>${e(item.suggestedRuleChange || "")}</td><td>${e(item.supportingOutcome || "")}</td><td>${e(item.createdAt || "")}</td><td><span class="workflow-pill tone-suggestion">${e(item.status || "Pending")}</span></td></tr>`;
    const selected = (data.open_trades || []).find((item) => item.stock_symbol === selectedSymbol) || (data.open_trades || [])[0] || {};
    const sandbox = selected.stock_symbol ? `<section class="risk-sandbox"><header><div><h4>Selected Sell Rule Sandbox</h4><span>${e(selected.stock_symbol)} | ${e(selected.time_state || "Unknown")} | last reviewed ${e(selected.last_reviewed_at || "")}</span></div><b class="risk-state-pill tone-${e(stateTone(selected.current_sell_rule_state || ""))}">${e(selected.recommendation || "HOLD")}</b></header><div class="risk-sandbox-grid"><div class="risk-levels"><span style="--x:7%">-8% Max</span><span style="--x:14%">-7% Stop</span><span style="--x:50%">Entry</span><span style="--x:78%">+20%</span><span style="--x:90%">+25%</span><b style="--x:${Math.max(3, Math.min(97, 50 + Number(selected.current_pnl_pct || 0) * 1.4))}%">Now</b></div><dl><dt>Hard Stop</dt><dd>${e(selected.hard_stop ?? "NA")}</dd><dt>Max Loss</dt><dd>${e(selected.max_loss_stop ?? "NA")}</dd><dt>21 EMA/SMA</dt><dd>${e(selected.ma21 ?? "NA")}</dd><dt>50 DMA</dt><dd>${e(selected.ma50 ?? "NA")}</dd><dt>Highest</dt><dd>${e(selected.highest_price_since_entry ?? "NA")}</dd><dt>Protection</dt><dd>${e(selected.protection_score ?? "NA")}</dd><dt>Capital Efficiency</dt><dd>${e(selected.capital_efficiency_score ?? "NA")}</dd><dt>Volume x50</dt><dd>${e(selected.volume_ratio_50 ?? "NA")}</dd></dl><p>${e(selected.recommendation_explanation || "No sell-rule explanation available.")}</p></div><div class="risk-action-row"><button data-risk-action="ACCEPT_RECOMMENDATION" data-risk-symbol-action="${e(selected.stock_symbol)}">Accept</button><button data-risk-action="OVERRIDE_HOLD" data-risk-symbol-action="${e(selected.stock_symbol)}">Override Hold</button><button data-risk-action="OVERRIDE_SELL" data-risk-symbol-action="${e(selected.stock_symbol)}">Override Sell</button><button data-risk-action="DEFER_REVIEW" data-risk-symbol-action="${e(selected.stock_symbol)}">Defer</button><input data-risk-note placeholder="Journal note" /></div></section>` : "";
    return `<div class="risk-tile-shell">
      <section class="risk-tile-hero tone-${e(data.production?.tone || "neutral")}"><div><span>Risk Management | latest rs_daily ${e(data.rsDailyLatestDate || "")}</span><strong>${e(data.production?.state || "Risk Model")}</strong><small>${e((data.production?.reasons || []).join("; ") || "Freshness, regime, and risk posture currently permit new buys.")}</small></div><b>${e(data.summary?.open_count ?? 0)}/${e(data.inputs?.max_trades ?? 0)}</b></section>
      <form class="risk-input-strip risk-settings-form" data-risk-settings><label><span>Portfolio</span><input name="portfolio_size" type="number" min="0" step="1000" value="${e(data.inputs?.portfolio_size ?? 100000)}" /></label><label><span>Trade</span><input name="per_trade_capital" type="number" min="0" step="500" value="${e(data.inputs?.per_trade_capital ?? 10000)}" /></label><label><span>Max Trades</span><input name="max_trades" type="number" min="0" step="1" value="${e(data.inputs?.max_trades ?? 10)}" /></label><label><span>Max Capital %</span><input name="max_capital_pct" type="number" min="0" max="100" step="1" value="${e(data.inputs?.max_capital_pct ?? 60)}" /></label><label><span>Entry Risk %</span><input name="entry_risk_pct" type="number" min="0" max="25" step="0.1" value="${e(data.inputs?.entry_risk_pct ?? 7.5)}" /></label><button type="submit">Save</button></form>
      <div class="risk-metric-grid">${metric("Open", data.summary?.open_count ?? 0)}${metric("Hold", data.summary?.hold ?? 0)}${metric("Tighten", data.summary?.tighten_stop ?? 0)}${metric("Take Profit", data.summary?.take_profit ?? 0)}${metric("Time Review", data.summary?.time_exit_review ?? 0)}${metric("Sell/Urgent", `${e(data.summary?.sell ?? 0)}/${e(data.summary?.urgent_sell ?? 0)}`)}${metric("Open Risk", `${money(data.summary?.open_risk)} (${e(data.summary?.open_risk_pct)}%)`)}${metric("Unreal. P&L", `${e(data.summary?.unrealized_pnl_pct ?? 0)}%`)}${metric("Near Stop", data.summary?.near_hard_stop ?? 0)}${metric("Near 8W", data.summary?.near_8_week ?? 0)}${metric("Near 13W", data.summary?.near_13_week ?? 0)}${metric("New Trades", data.summary?.possible_new_trades ?? 0)}</div>
      <div class="risk-columns"><section><h4>Buy Permission</h4><ul>${(data.guardrails || []).map(guardrail).join("")}</ul></section><section><h4>Trailing Stop Ladder</h4><ul>${(data.cushion_ladder || []).map((r) => `<li><b>${e(r.profile)}</b><span>At ${e(r.advance)}: raise stop to ${e(r.raise_stop)}, trail ${e(r.trail)}.</span></li>`).join("")}</ul></section></div>
      <section class="risk-rules"><h4>Sell Rule Stack</h4><ol>${(data.sell_rules || []).slice(0, 5).map((rule) => `<li>${e(rule)}</li>`).join("")}</ol></section>
      <section class="risk-sell-table"><h4>All Positions Sell-Rule Table</h4><div><table><thead><tr><th>Symbol</th><th>Entry</th><th>Weeks</th><th>Entry Px</th><th>Gain</th><th>Stop</th><th>High</th><th>State</th><th>Rule</th><th>8W</th><th>13W</th><th>RS</th><th>Market</th><th>Recommendation</th></tr></thead><tbody>${(data.open_trades || []).map(sellRow).join("") || `<tr><td colspan="14">No OPEN trades found.</td></tr>`}</tbody></table></div></section>
      ${sandbox}
      <section class="risk-sell-table risk-suggestions"><h4>New Risk / Sell Rule Suggestions Pending Approval</h4><div><table><thead><tr><th>Symbol</th><th>Journal Type</th><th>Observation</th><th>Suggested Rule Change</th><th>Outcome</th><th>Date</th><th>Status</th></tr></thead><tbody>${(data.pending_rule_suggestions || []).map(suggestionRow).join("") || `<tr><td colspan="7">No pending suggestions from journal observations.</td></tr>`}</tbody></table></div></section>
      <section class="risk-open"><h4>Open Position Risk</h4><ul>${(data.open_trades || []).slice(0, 8).map(trade).join("") || `<li><strong>No open positions</strong><span>No OPEN trades found.</span></li>`}</ul></section>
    </div>`;
  }

  function bindRiskCockpit(tile) {
    tile.querySelectorAll("[data-risk-symbol]").forEach((row) => row.addEventListener("click", () => {
      tile.__riskSelected = row.dataset.riskSymbol;
      if (tile.__riskData) {
        tile.innerHTML = riskCockpitTemplate(tile.__riskData, tile.__riskSelected);
        tile.querySelector("[data-risk-settings]")?.addEventListener("submit", saveRiskSettings);
        bindRiskCockpit(tile);
      }
    }));
    tile.querySelectorAll("[data-risk-action]").forEach((button) => button.addEventListener("click", async () => {
      const symbol = button.dataset.riskSymbolAction;
      const selectedRow = [...tile.querySelectorAll("[data-risk-symbol]")].find((row) => row.dataset.riskSymbol === symbol);
      const note = tile.querySelector("[data-risk-note]")?.value || "";
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        const response = await fetch("/api/risk/sell-rule-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, decision: button.dataset.riskAction, note, recommendation: selectedRow?.querySelector("td:last-child strong")?.textContent || "", journalReason: selectedRow?.querySelector("td:last-child small")?.textContent || "" }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        button.textContent = "Saved";
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry";
        tile.insertAdjacentHTML("beforeend", `<div class="signals-live-error">${e(error.message)}</div>`);
      }
    }));
  }

  async function hydrateTradingSystemMonitorTiles(force = false) {
    const tiles = [...root.querySelectorAll("[data-trading-system-monitor]")].filter((tile) => force || !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const data = await api("/api/trading-system-monitor", null, "GET");
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = tradingSystemMonitorTemplate(data);
        bindTradingSystemMonitorTile(tile);
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-trading-monitor-refresh>Retry</button></div>`;
    }
  }

  function bindTradingSystemMonitorTile(tile) {
    tile.querySelector("[data-trading-monitor-refresh]")?.addEventListener("click", () => { delete tile.dataset.loaded; hydrateTradingSystemMonitorTiles(true); });
    tile.querySelector("[data-process-trading-job]")?.addEventListener("click", async (ev) => {
      const button = ev.currentTarget;
      if (tile.dataset.processRunning === "true") return;
      tile.dataset.processRunning = "true";
      button.disabled = true;
      button.textContent = "Running...";
      try {
        const result = await api("/api/trading-system-monitor/backtest/process", {}, "POST");
        if (result.error) throw new Error(result.error);
        tile.insertAdjacentHTML("afterbegin", `<div class="rs-refresh-banner">${e(result.message || "Backtest process requested.")}</div>`);
        delete tile.dataset.loaded;
        await hydrateTradingSystemMonitorTiles(true);
      } catch (error) {
        tile.insertAdjacentHTML("afterbegin", `<div class="signals-live-error">${e(error.message)}</div>`);
      } finally {
        tile.dataset.processRunning = "false";
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = "Process Next Job";
        }
      }
    });
    tile.querySelector("[data-queue-trading-backtest]")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const button = form.querySelector("button");
      if (button) { button.disabled = true; button.textContent = "Queueing..."; }
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const result = await api("/api/trading-system-monitor/backtest/queue", payload, "POST");
        if (result.error) throw new Error(result.error);
        delete tile.dataset.loaded;
        await hydrateTradingSystemMonitorTiles(true);
      } catch (error) {
        tile.insertAdjacentHTML("afterbegin", `<div class="signals-live-error">${e(error.message)}</div>`);
      } finally {
        if (button?.isConnected) { button.disabled = false; button.textContent = "Queue Backtest"; }
      }
    });
  }

  function tradingSystemMonitorTemplate(data) {
    const summary = data.summary || {};
    const backtest = data.backtest || {};
    const production = data.production || {};
    const metric = (label, value, suffix = "") => `<article><span>${e(label)}</span><strong>${e(value ?? "NA")}${suffix}</strong></article>`;
    const money = (value) => Number.isFinite(Number(value)) ? `$${Math.round(Number(value)).toLocaleString()}` : "$0";
    const toneFor = (value) => Number(value || 0) >= 0 ? "good" : "bad";
    const backtestSummary = backtest.summary || {};
    const tradeRow = (trade) => `<tr data-symbol="${e(trade.symbol)}"><td><strong>${e(trade.symbol)}</strong></td><td>${e(trade.setup || "NA")}</td><td>${e(trade.entryDate)} @ ${e(trade.entryPrice)}</td><td>${e(trade.exitDate)} @ ${e(trade.exitPrice)}</td><td class="tone-${toneFor(trade.pnlPct)}">${e(trade.pnlPct)}%</td><td>${money(trade.pnlDollars)}</td><td>${e(trade.exitReason || "")}</td><td>${e(trade.initialStop ?? "NA")}</td></tr>`;
    const journalRow = (item) => `<tr><td>${e(item.createdAt)}</td><td>${e(item.source)}</td><td><span class="perf-severity ${e(String(item.severity || "").toLowerCase())}">${e(item.severity)}</span></td><td>${e((item.observations || []).join(" "))}</td><td>${e((item.improvements || []).join(" "))}</td></tr>`;
    const jobMetric = (job) => {
      const rs = job.metrics?.RS_LEADERSHIP || {};
      const vcp = job.metrics?.VCP || {};
      return `${rs.trades != null ? `RS: ${e(rs.trades)} trades, PF ${e(rs.profit_factor ?? "NA")}` : ""}${vcp.trades != null ? ` VCP: ${e(vcp.trades)} trades, PF ${e(vcp.profit_factor ?? "NA")}` : ""}`;
    };
    const jobRow = (job) => `<tr><td>${e(job.createdAt)}</td><td><strong>${e(job.status)}</strong></td><td>${e(job.strategy)}</td><td>${e((job.symbols || []).slice(0, 8).join(","))}${(job.symbols || []).length > 8 ? "..." : ""}</td><td>${jobMetric(job)}</td><td>${e(job.error || "")}</td></tr>`;
    const rsPick = (item) => `<li data-symbol="${e(item.symbol)}"><strong>${e(item.symbol)}</strong><span>${e(item.setup)} | score ${e(item.score)} | RS3 ${e(item.rs3)}</span><small>${e(item.sector || "")} / ${e(item.industry || "")}</small></li>`;
    const vcpPick = (item) => `<li data-symbol="${e(item.symbol)}"><strong>${e(item.symbol)}</strong><span>${e(item.setup)} | score ${e(item.score)} | pivot ${e(item.pivot ?? "NA")}</span><small>stop ${e(item.stop ?? "NA")}</small></li>`;
    const activePositionRow = (item) => `<tr data-symbol="${e(item.stock_symbol)}"><td><strong>${e(item.stock_symbol)}</strong><small>${e(item.strategy || "")}</small></td><td><span class="workflow-pill tone-${/SELL|STOP/i.test(item.status || "") ? "risk" : "active"}">${e(item.status || "Open")}</span></td><td>${e(item.entry_date || "NA")} @ ${e(item.entry_price ?? "NA")}</td><td>${e(item.shares_est ?? "NA")}</td><td>${e(item.current_price ?? "NA")}</td><td>${money(item.market_value)}</td><td class="tone-${toneFor(item.current_pnl_pct)}">${e(item.current_pnl_pct ?? "NA")}% / ${money(item.unrealized_pnl_dollars)}</td><td>${e(item.initial_stop ?? "NA")}</td><td>${e(item.profit_target ?? "NA")} / ${e(item.extended_target ?? "NA")}</td><td>${e(item.days_held ?? "NA")}</td><td>${money(item.dollar_risk)}</td><td>${e(item.r_multiple ?? "NA")}</td><td>${e(item.journal_reason || "")}</td></tr>`;
    return `<div class="trading-monitor-shell">
      <section class="trading-monitor-head">
        <div><span>System Feedback Loop</span><strong>Swing Trading Performance</strong><small>Backtests are queued and persisted so RS Leadership and VCP can be compared without losing state after restart.</small></div>
        <div><button data-process-trading-job>Process Next Job</button><button data-trading-monitor-refresh>Refresh</button><b>${e(summary.closed || 0)} closed / ${e(summary.open || 0)} open</b></div>
      </section>
      <section class="trading-monitor-panel">
        <header><div><h3>Latest RS Leadership Backtest</h3><span>${e(backtest.startDate || backtestSummary.start_date || "")} to ${e(backtest.endDate || backtestSummary.end_date || "")} | ${e(backtest.createdAt || "")}</span></div></header>
        <div class="trading-monitor-metrics">${metric("Trades", backtestSummary.trades ?? (backtest.trades || []).length)}${metric("Win Rate", backtestSummary.win_rate ?? 0, "%")}${metric("Expectancy", backtestSummary.expectancy_pct ?? 0, "%")}${metric("Profit Factor", backtestSummary.profit_factor ?? "NA")}${metric("Total P&L", money(backtestSummary.total_pnl), "")}${metric("Avg MFE / MAE", `${e(backtestSummary.avg_mfe ?? 0)} / ${e(backtestSummary.avg_mae ?? 0)}`)}</div>
        <div class="trading-monitor-table"><table><thead><tr><th>Symbol</th><th>Setup</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Dollars</th><th>Reason</th><th>Stop</th></tr></thead><tbody>${(backtest.trades || []).map(tradeRow).join("") || `<tr><td colspan="8">No trades stored for latest backtest.</td></tr>`}</tbody></table></div>
      </section>
      <section class="trading-monitor-grid">
        <article class="production-guardrail tone-${e(production.tone || "neutral")}"><span>Production Guardrail</span><strong>${e(production.state || "CHECK")}</strong><p>${e((production.reasons || []).join("; ") || "Current live data passes freshness and data quality checks.")}</p><small>business day ${e(production.businessDay || "")} | latest ${e(production.latestCompletedDate || "")}</small></article>
        <div class="trading-monitor-metrics live">${metric("Live Win Rate", summary.winRate, "%")}${metric("Expectancy", summary.expectancy, "%")}${metric("Profit Factor", summary.profitFactor)}${metric("Total Realized", summary.totalRealized, "%")}${metric("Open Unrealized", summary.openUnrealized, "%")}${metric("Avg MFE / MAE", `${e(summary.avgMfe)} / ${e(summary.avgMae)}`)}</div>
      </section>
      <section class="trading-monitor-panel">
        <header><div><h3>Active Positions From Buy Signals</h3><span>Derived from actionable trades and Risk settings; live lifecycle view without new DB schema.</span></div></header>
        <div class="trading-monitor-table"><table><thead><tr><th>Symbol</th><th>Status</th><th>Entry</th><th>Qty</th><th>Current</th><th>Value</th><th>Unrealized</th><th>Stop</th><th>Profit Zone</th><th>Days</th><th>Risk</th><th>R</th><th>Journal</th></tr></thead><tbody>${(data.activePositions || []).map(activePositionRow).join("") || `<tr><td colspan="13">No active positions found.</td></tr>`}</tbody></table></div>
      </section>
      <section class="trading-monitor-panel">
        <header><div><h3>Strategy Shortlist</h3><span>Native mtm_ui shortlist before trade entry. RS uses rs_daily enriched cache; VCP uses cached VCP scan results. Position sizing comes from Risk screen settings when entries are simulated.</span></div></header>
        <div class="trading-shortlist-grid"><section><h4>RS Leadership</h4><ul>${(data.shortlist?.rs || []).slice(0, 12).map(rsPick).join("") || `<li><strong>No RS candidates</strong><span>Cache has no qualifying candidates.</span></li>`}</ul></section><section><h4>VCP</h4><ul>${(data.shortlist?.vcp || []).slice(0, 12).map(vcpPick).join("") || `<li><strong>No VCP candidates</strong><span>Run/import VCP scan results first.</span></li>`}</ul></section></div>
      </section>
      <section class="trading-monitor-panel">
        <header><div><h3>System Journal</h3><span>Continuous improvement across backtests and production checks</span></div></header>
        <div class="trading-monitor-table"><table><thead><tr><th>Time</th><th>Source</th><th>Severity</th><th>Observations</th><th>Improvements</th></tr></thead><tbody>${(data.systemJournal || []).map(journalRow).join("") || `<tr><td colspan="5">No system journal entries yet.</td></tr>`}</tbody></table></div>
      </section>
      <section class="trading-monitor-panel">
        <header><div><h3>Backtest Queue</h3><span>Restart-safe strategy tests for RS Leadership and VCP</span></div></header>
        <form class="trading-backtest-form" data-queue-trading-backtest><label>Strategy<select name="strategy"><option value="BOTH">Both strategies</option><option value="RS_LEADERSHIP">RS Leadership</option><option value="VCP">VCP</option></select></label><label>Benchmark<input name="benchmark" value="SPY" /></label><label>Start<input type="date" name="startDate" value="2023-01-01" /></label><label>End<input type="date" name="endDate" /></label><label class="wide">Symbols<input name="symbolText" value="${e((data.defaultSymbols || []).join(","))}" /></label><button type="submit">Queue Backtest</button></form>
        <div class="trading-monitor-table"><table><thead><tr><th>Created</th><th>Status</th><th>Strategy</th><th>Symbols</th><th>Metrics</th><th>Error</th></tr></thead><tbody>${(data.backtestJobs || []).map(jobRow).join("") || `<tr><td colspan="6">No queued strategy backtests yet.</td></tr>`}</tbody></table></div>
      </section>
    </div>`;
  }

  async function hydrateRsAgentTiles(force = false) {
    if (!beginHydrate("rs-agent")) return;
    const tiles = [...root.querySelectorAll("[data-rs-agent]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      const response = await fetch(`/api/agents/rs-daily/status?ts=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = rsAgentTemplate(data);
        bindRsAgentTile(tile);
      }
      if (shouldRefreshAfterRsDailyJob(data)) await refreshRsDailyDependentTiles(data);
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-action="retry">Retry</button></div>`;
    } finally {
      endHydrate("rs-agent");
    }
  }


  async function hydrateRsDataMonitorTiles(force = false) {
    if (!beginHydrate("rs-monitor")) return;
    const tiles = [...root.querySelectorAll("[data-rs-data-monitor]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      const data = await api("/api/agents/rs-monitor/status", null, "GET");
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = rsDataMonitorTemplate(data);
        tile.querySelector("[data-rs-monitor-reload]")?.addEventListener("click", async (ev) => {
          const button = ev.currentTarget;
          if (tile.dataset.rsMonitorRunning === "true") return;
          const symbols = (data.actionableSymbols || []).slice(0, 100);
          if (!symbols.length) return alert("No reloadable symbols flagged.");
          if (!confirm(`Reload ${symbols.length} flagged rs_daily symbol(s) from EODHD?`)) return;
          tile.dataset.rsMonitorRunning = "true";
          button.disabled = true;
          button.textContent = "Running...";
          tile.querySelector(".rs-refresh-banner")?.remove();
          tile.insertAdjacentHTML("afterbegin", `<div class="widget-loading rs-refresh-banner">Reloading flagged symbols...</div>`);
          try {
            await api("/api/agents/rs-monitor/reload", { symbols }, "POST");
            delete tile.dataset.loaded;
            await hydrateRsDataMonitorTiles(true);
          } catch (error) {
            tile.insertAdjacentHTML("afterbegin", `<div class="signals-live-error">${e(error.message)}</div>`);
          } finally {
            delete tile.dataset.rsMonitorRunning;
            if (button?.isConnected) {
              button.disabled = false;
              button.textContent = "Reload Flagged";
            }
          }
        });
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
    } finally {
      endHydrate("rs-monitor");
    }
  }

  function rsDataMonitorTemplate(data) {
    const tone = data.tone || (data.status === "PASS" ? "good" : "bad");
    const metric = (label, value, cls = "") => `<article class="${cls}"><span>${label}</span><strong>${e(value)}</strong></article>`;
    const rowTone = (issue) => issue === "MISSING" || issue === "BAD_VOLUME" || issue === "BAD_OHLC" ? "failed" : issue === "DUPLICATE" ? "queued" : "completed";
    const row = (item) => `<li class="rs-shard-row status-${rowTone(item.issue)}"><strong>${e(item.symbol)}</strong><span>${e(item.issue)}</span><span>${e(item.sector || item.industry || "")}</span><span>${e(item.detail || "")}</span></li>`;
    const job = data.job || {};
    const running = job.status === "running" || data.blockedByRsDaily;
    const runLabel = data.blockedByRsDaily ? `RS Daily ${data.blockingJob?.status || "running"}` : job.status ? `Reload job ${job.status} ${job.processed || 0}/${(job.symbols || []).length}` : `${(data.actionableSymbols || []).length} reloadable symbol(s)`;
return `<div class="rs-agent-shell rs-monitor-shell"><section class="rs-agent-hero tone-${running ? "neutral" : e(tone)}"><div><span>RS Daily Observability</span><strong>${e(running ? "Reload running" : data.status)}</strong><small>Due ${e(data.dueDate || "")} | latest ${e(data.latestCompletedDate || "")}</small></div><b>${e(data.coverageRatio || 0)}%</b></section><div class="rs-agent-metrics">${metric("Expected", data.expectedSymbols || 0)}${metric("Actual", data.actualSymbols || 0)}${metric("Missing", data.missingSymbols || 0, data.missingSymbols ? "tone-bad" : "")}${metric("Bad Volume", data.badVolume || 0, data.badVolume ? "tone-bad" : "")}${metric("Bad OHLC", data.badOhlc || 0, data.badOhlc ? "tone-bad" : "")}${metric("Duplicates", data.duplicateRows || 0, data.duplicateRows ? "tone-warn" : "")}</div>${rsMonitorTrendTemplate(data.rollingTrend || [], data.expectedSymbols || 0)}<div class="signals-live-bar"><span>${e(runLabel)}</span><button data-rs-monitor-reload ${running || !data.actionableSymbols?.length ? "disabled" : ""}>${running ? "Running..." : "Reload Flagged"}</button></div><section class="rs-agent-shards"><h4>Actionable Data Gaps</h4><ul>${(data.rows || []).slice(0, 80).map(row).join("") || `<li class="rs-shard-row status-completed"><strong>OK</strong><span>PASS</span><span>${e(data.dueDate || "")}</span><span>No missing, volume, OHLC, indicator, or duplicate gaps found.</span></li>`}</ul></section></div>`;
  }
  async function hydratePipelineAgentTiles(force = false) {
    if (!beginHydrate("pipeline-agent")) return;
    const tiles = [...root.querySelectorAll("[data-pipeline-agent]")].filter((tile) => force || !tile.dataset.loaded);
    try {
      if (!tiles.length) return;
      const data = await api("/api/pipeline/status", null, "GET");
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = pipelineAgentTemplate(data);
        tile.querySelector("[data-run-pipeline]")?.addEventListener("click", (ev) => runPipelineRefresh(tile, ev.currentTarget));
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
    } finally {
      endHydrate("pipeline-agent");
    }
  }

  async function runPipelineRefresh(tile, button) {
    if (tile.dataset.pipelineRunning === "true") return;
    tile.dataset.pipelineRunning = "true";
    if (button) {
      button.disabled = true;
      button.textContent = "Running...";
    }
    tile.querySelector(".rs-refresh-banner")?.remove();
    tile.insertAdjacentHTML("afterbegin", `<div class="widget-loading rs-refresh-banner">Refreshing downstream pipeline agents...</div>`);
    try {
      await api("/api/pipeline/run", {}, "POST");
      delete tile.dataset.loaded;
      await hydratePipelineAgentTiles(true);
      await hydrateRsRankingTiles(true);
      await hydrateDailyReportTiles(true);
      await hydrateReasoningImagesTiles(true);
    } catch (error) {
      tile.insertAdjacentHTML("afterbegin", `<div class="signals-live-error">${e(error.message)}</div>`);
    } finally {
      delete tile.dataset.pipelineRunning;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Run Downstream Refresh";
      }
    }
  }

  function pipelineAgentTemplate(data) {
    const task = (item) => `<li class="rs-shard-row status-${item.status === "PASS" || item.status === "READY" || item.status === "CURRENT" ? "completed" : item.status === "MISSING" || item.status === "DUE" || item.status === "ATTENTION" ? "failed" : "queued"}"><strong>${e(item.id)}</strong><span>${e(item.status)}</span><span>${e(item.date || "")}</span><span>${e(item.detail || "")}</span></li>`;
    const q = data.quality || {};
    const running = data.job?.status === "running";
    return `<div class="rs-agent-shell"><section class="rs-agent-hero tone-${running ? "neutral" : q.shouldTriggerRsDaily ? "bad" : "good"}"><div><span>Pipeline Monitor</span><strong>${running ? "Refresh running" : q.shouldTriggerRsDaily ? "RS Daily prompt required" : "Business day current"}</strong><small>Business day ${e(q.businessDay || "")} | latest rs_daily ${e(q.latestCompletedDate || "")}</small></div><b>${e(q.coverageRatio || 0)}%</b></section><div class="rs-agent-metrics"><article><span>Expected</span><strong>${e(q.expectedSymbols || 0)}</strong></article><article><span>Actual</span><strong>${e(q.actualSymbols || 0)}</strong></article><article><span>Duplicates</span><strong>${e(q.duplicates || 0)}</strong></article><article><span>Lag</span><strong>${e(q.lagBusinessDays ?? "--")}</strong></article></div><button class="primary" data-run-pipeline ${running ? "disabled" : ""}>${running ? "Running..." : "Run Downstream Refresh"}</button><section class="rs-agent-shards"><h4>DAG Tasks</h4><ul>${(data.tasks || []).map(task).join("")}</ul></section></div>`;
  }


  function rsMonitorTrendTemplate(trend = [], expected = 0) {
    const values = trend.map((item) => Number(item.symbols || 0));
    const max = Math.max(expected || 0, ...values, 1);
    const points = trend.map((item, index) => {
      const x = trend.length <= 1 ? 0 : index * (100 / (trend.length - 1));
      const y = 100 - (Number(item.symbols || 0) / max * 100);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const bars = trend.map((item) => {
      const h = Math.max(2, Number(item.symbols || 0) / max * 100);
      const tone = Number(item.coverageRatio || 0) >= 98 ? "good" : Number(item.coverageRatio || 0) >= 90 ? "warn" : "bad";
      return `<span class="tone-${tone}" style="--h:${h}%" title="${e(item.date)} ${e(item.symbols)} symbols, ${e(item.coverageRatio)}%"></span>`;
    }).join("");
    return `<section class="rs-monitor-trend"><header><h4>Rolling 2-Week Load</h4><small>${e(trend.at(-1)?.symbols || 0)} / ${e(expected || 0)} symbols</small></header><div class="trend-chart"><div class="trend-bars">${bars}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" /></svg></div><div class="trend-labels">${trend.map((item) => `<span>${e(String(item.date || "").slice(5))}</span>`).join("")}</div></section>`;
  }
  async function hydrateRsRankingTiles(force = false) {
    const tiles = [...root.querySelectorAll("[data-rs-ranking-agent]")].filter((tile) => force || !tile.dataset.loaded);
    for (const tile of tiles) {
      try {
        const minRs = tile.querySelector("[name='minRs']")?.value || 90;
        const segment = tile.querySelector("[name='segment']")?.value || "sector";
        const data = await api(`/api/pipeline/rs-ranking?minRs=${encodeURIComponent(minRs)}&segment=${encodeURIComponent(segment)}&limit=150`, null, "GET");
        if (data.error) throw new Error(data.error);
        tile.dataset.loaded = "true";
        tile.innerHTML = rsRankingTemplate(data);
        tile.querySelector("[data-rs-rank-controls]")?.addEventListener("change", () => { delete tile.dataset.loaded; hydrateRsRankingTiles(true); });
      } catch (error) {
        tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
      }
    }
  }

  function rsRankingTemplate(data) {
    const seg = (item) => `<li><strong>${e(item.name)}</strong><span>${e(item.count)} names | RS ${e(item.avgRs)} | RS3 ${e(item.avgRs3)} | MCI ${e(item.avgMci)}</span></li>`;
    const row = (item) => `<li data-symbol="${e(item.symbol)}"><strong>${e(item.symbol)}</strong><span>${e(item[data.segment] || item.sector || item.industry)}</span><b>${e(item.rs)}</b><small>RS3 ${e(item.rs3)} | 5D ${e(item.perf5)}% | MCI ${e(item.mci)}</small></li>`;
    return `<div class="leaders-tile-shell"><section class="leaders-tile-hero"><div><span>RS Ranking Agent</span><strong>RS >= ${e(data.minRs)}</strong><small>latest rs_daily ${e(data.latestDate || "")}</small></div><b>${e(data.count)}</b></section><form class="rs-agent-controls" data-rs-rank-controls><label><span>Min RS</span><input name="minRs" type="number" min="0" max="250" value="${e(data.minRs)}" /></label><label><span>Segment</span><select name="segment"><option value="sector" ${data.segment === "sector" ? "selected" : ""}>sector</option><option value="industry" ${data.segment === "industry" ? "selected" : ""}>industry</option></select></label></form><div class="leaders-columns"><div><h4>Segments</h4><ul>${(data.segments || []).slice(0, 12).map(seg).join("")}</ul></div><div><h4>Leaders</h4><ul class="leader-rank-list">${(data.leaders || []).slice(0, 16).map(row).join("")}</ul></div></div></div>`;
  }

  async function hydrateDailyReportTiles(force = false) {
    const tiles = [...root.querySelectorAll("[data-daily-report-agent]")].filter((tile) => force || !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const data = await api("/api/pipeline/daily-report", null, "GET");
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = `<div class="brief"><h4>Daily Report | latest rs_daily ${e(data.rsDailyLatestDate || "")}</h4><p><strong>${e(data.regimeClassification || "")}</strong> Score ${e(data.regimeScore || 0)} | ${e(data.quarterlySignal || "NA")}/${e(data.dailySignal || "NA")}</p><p>${e(data.synthesis || data.summary || "No report generated yet.")}</p><div class="data-rows">${(data.sampleTrades || []).slice(0, 8).map((t) => `<button class="data-row"><span>${e(t.stock || t.stock_symbol || "NA")}</span><strong>${e(t.status || t.rs_alignment || "Candidate")}</strong></button>`).join("")}</div></div>`;
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
    }
  }

  async function hydrateReasoningImagesTiles(force = false) {
    const tiles = [...root.querySelectorAll("[data-reasoning-images-agent]")].filter((tile) => force || !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const data = await api("/api/pipeline/reasoning-images", null, "GET");
      if (data.error) throw new Error(data.error);
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.innerHTML = `<div class="rs-agent-shell"><section class="rs-agent-hero tone-neutral"><div><span>Reasoning + Images</span><strong>Manual guarded tasks</strong><small>latest rs_daily ${e(data.rsDailyLatestDate || "")} | trades ${e(data.tradeDate || "")}</small></div><b>${e(data.activeTradeCount || 0)}</b></section><div class="rs-agent-metrics"><article><span>Trades</span><strong>${e(data.tradeCount || 0)}</strong></article><article><span>Active</span><strong>${e(data.activeTradeCount || 0)}</strong></article></div><div class="data-rows"><button class="data-row"><span>Reasoning</span><strong>${e(data.reasoning?.status || "")}</strong></button><button class="data-row"><span>Images</span><strong>${e(data.images?.status || "")}</strong></button></div></div>`;
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
    }
  }

  function shouldRefreshAfterRsDailyJob(job) {
    if (!job?.id || !["completed", "completed_with_failures"].includes(job.status)) return false;
    if (job.options?.dryRun) return false;
    if (!job.inserted && !job.calendar?.isCurrent) return false;
    if (state.lastRsDailyRefreshJobId === job.id) return false;
    state.lastRsDailyRefreshJobId = job.id;
    return true;
  }

  async function refreshRsDailyDependentTiles(job) {
    const selectors = [
      "[data-screener-tile]",
      "[data-market-monitor]",
      "[data-market-cockpit]",
      "[data-group-cockpit]",
      "[data-leaders-cockpit]",
      "[data-minervini-screen]",
      "[data-signals-cockpit]",
      "[data-watchlist-tile]",
      "[data-risk-cockpit]",
      "[data-trading-system-monitor]",
      "[data-pipeline-agent]",
      "[data-rs-ranking-agent]",
      "[data-daily-report-agent]",
      "[data-reasoning-images-agent]"
    ];
    const tiles = selectors.flatMap((selector) => [...root.querySelectorAll(selector)]);
    if (!tiles.length) return;
    for (const tile of tiles) {
      delete tile.dataset.loaded;
      tile.insertAdjacentHTML("afterbegin", `<div class="widget-loading rs-refresh-banner">Refreshing rs_daily data...</div>`);
    }
    await Promise.allSettled([
      api("/api/pipeline/run", {}, "POST"),
      hydrateScreenerTiles(true),
      hydrateMarketMonitorTiles(true),
      hydrateMarketCycleTiles(true),
      hydrateMarketCockpitTiles(),
      hydrateGroupCockpitTiles(),
      hydrateLeadersCockpitTiles(),
      hydrateMinerviniScreenTiles(true),
      hydrateSignalsCockpitTiles(),
      hydrateWatchlistTiles(true),
      hydrateRiskCockpitTiles(),
      hydrateRsDataMonitorTiles(true),
      hydratePipelineAgentTiles(true),
      hydrateRsRankingTiles(true),
      hydrateDailyReportTiles(true),
      hydrateReasoningImagesTiles(true)
    ]);
    eventBus.emit("rs_daily_refresh_completed", {
      job_id: job.id,
      status: job.status,
      latest_completed_date: job.calendar?.latestCompletedDate,
      due_date: job.calendar?.dueDate
    });
  }

  function rsAgentTemplate(job) {
    const pctDone = job.total ? Math.round((job.processed / job.total) * 100) : 0;
    const calendar = job.calendar || {};
    const plan = job.plan || job.options?.plan || calendar.loadPlan || {};
    const currentLabel = calendar.latestCompletedDate || "None";
    const dueLabel = calendar.dueDate || "--";
    const currentState = calendar.isCurrent ? "Current" : "Due";
    const busy = ["starting", "running"].includes(job.status);
    const normalizeEventLevel = (item = {}) => {
      const text = String(item.text || "");
      if (/ ERROR:|\berror\b|failed|exception|traceback/i.test(text)) return "error";
      if (/ WARNING:|\bwarn/i.test(text)) return "warn";
      if (/ INFO:|Processing|Completed build_price_window|HEARTBEAT/i.test(text)) return "info";
      return item.level || "info";
    };
    const shardProgressLabel = (range) => {
      const shard = (job.shards || []).find((item) => String(item.range || "").toUpperCase() === String(range || "").toUpperCase());
      if (!shard) return "";
      const total = Number(shard.totalSymbols || 0);
      const loaded = shard.status === "skipped" ? total : Number(shard.recordsInserted || shard.recordsUpdated || 0);
      return total ? `${loaded.toLocaleString()} / ${total.toLocaleString()} symbols` : `${loaded.toLocaleString()} rows`;
    };
    const formatRsAgentMessage = (text = "") => {
      const raw = String(text || "");
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const prefix = raw.slice(0, jsonStart).replace(/[:\s-]+$/, "").trim();
          const message = JSON.parse(raw.slice(jsonStart));
          if (message.type === "completed") return `${prefix ? `${prefix}: ` : ""}${message.range || "Shard"} completed ${Number(message.records_inserted || 0).toLocaleString()} / ${Number(message.total_symbols || 0).toLocaleString()} symbols for ${message.run_date || "run date"}.`;
          if (message.type === "failed") return `${prefix ? `${prefix}: ` : ""}${message.range || "Shard"} failed: ${message.error || "unknown error"}`;
          if (message.type === "started") {
            const range = message.range || prefix || "Shard";
            const progress = shardProgressLabel(range);
            return `${prefix && prefix !== range ? `${prefix}: ` : ""}${range} running${progress ? ` ${progress}` : ""}.`;
          }
        } catch {}
      }
      const started = raw.match(/\b([A-Z]-[A-Z])\b.*\bstarted\b/i);
      if (started) {
        const range = started[1].toUpperCase();
        const progress = shardProgressLabel(range);
        return `${range} running${progress ? ` ${progress}` : ""}.`;
      }
      return raw;
    };
    const eventRow = (item) => `<li class="${e(normalizeEventLevel(item))}"><span>${e(new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</span><strong>${e(formatRsAgentMessage(item.text))}</strong></li>`;
    const failureRow = (item) => `<li><strong>${e(item.shard || item.symbol)}</strong><span>${e(item.error)}</span></li>`;
    const latestEvent = (job.events || [])[0] || null;
    const heartbeatAt = latestEvent?.at || (job.shards || []).filter((item) => item.startedAt || item.finishedAt).map((item) => item.finishedAt || item.startedAt).sort().at(-1) || job.startedAt;
    const heartbeatAge = heartbeatAt ? Math.max(0, Math.round((Date.now() - new Date(heartbeatAt).getTime()) / 1000)) : null;
    const activeShards = (job.shards || []).filter((item) => item.status === "running");
    const runningDetail = activeShards.map((item) => `${item.range}${item.pid ? ` pid ${item.pid}` : ""}`).join(" | ") || (job.currentSymbol ? `Active shard ${job.currentSymbol}` : "No active subprocess");
    const heartbeatTone = !busy ? "idle" : heartbeatAge == null ? "warn" : heartbeatAge <= 45 ? "good" : heartbeatAge <= 180 ? "warn" : "bad";
    const latestActivity = formatRsAgentMessage(latestEvent?.text || (busy ? "Waiting for shard output..." : "No active run."));
    const shardRow = (item) => {
      const tail = [...(item.stderrTail || []), ...(item.stdoutTail || [])].filter(Boolean).slice(-1)[0];
      const total = Number(item.totalSymbols || 0);
      const loaded = item.status === "skipped" ? total : Number(item.recordsInserted || item.recordsUpdated || 0);
      const done = total ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : item.status === "completed" ? 100 : 0;
      const label = total ? `${loaded.toLocaleString()} / ${total.toLocaleString()}` : `${loaded.toLocaleString()} rows`;
      return `<li class="rs-shard-row status-${e(item.status || "idle")}"><strong>${e(item.range)}</strong><span>${e(item.status || "idle")}</span><span title="Loaded rows reported by this shard versus total symbols planned for the shard.">${e(label)}</span><span>${e(item.missingDueRows || 0)} gaps</span>${item.pid ? `<span>pid ${e(item.pid)}</span>` : ""}<div class="rs-shard-progress" title="${e(item.range)} loaded ${e(label)} (${done}%)"><i style="--w:${done}%"></i><b>${done}%</b></div>${tail ? `<small class="${e(normalizeEventLevel({ text: tail }))}">${e(formatRsAgentMessage(tail))}</small>` : item.failure ? `<small class="error">${e(item.failure)}</small>` : item.reason ? `<small>${e(item.reason)}</small>` : ""}</li>`;
    };
    return `<div class="rs-agent-shell">
      <section class="rs-agent-hero tone-${busy ? "neutral" : job.status === "completed" ? "good" : job.status === "idle" && calendar.isCurrent ? "good" : job.status === "idle" ? "neutral" : "bad"}"><div><span>EODHD rs_daily Agent</span><strong>${e(job.status || "idle")} / ${e(currentState)}</strong><small>${e(job.currentSymbol ? `Active shard ${job.currentSymbol}` : job.finishedAt ? `Finished ${new Date(job.finishedAt).toLocaleString()}` : `Completed ${currentLabel}; NASDAQ due ${dueLabel}`)}</small></div><b>${pctDone}%</b></section>
      <form class="rs-agent-controls" data-rs-agent-start><label><span>Parallel Shards</span><input name="maxParallelShards" type="number" min="1" max="8" value="${e(job.options?.maxParallelShards || 2)}" ${busy ? "disabled" : ""} /></label><label class="check"><input name="dryRun" type="checkbox" ${busy ? "disabled" : ""} /> Dry run</label><button ${busy ? "disabled" : ""}>${busy ? "Running..." : "Start"}</button></form>
      <div class="rs-agent-progress"><div style="--w:${pctDone}%"></div></div>
      <section class="rs-agent-heartbeat tone-${e(heartbeatTone)}"><div><span class="pulse"></span><strong>${busy ? "Heartbeat active" : "Heartbeat idle"}</strong><small>${heartbeatAt ? `Last activity ${new Date(heartbeatAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${heartbeatAge != null ? ` (${heartbeatAge}s ago)` : ""}` : "No activity timestamp"}</small></div><div><span>Running</span><b>${e(runningDetail)}</b></div><p title="${e(latestActivity)}">${e(latestActivity)}</p></section>
      <div class="rs-agent-metrics"><article><span>Completed Date</span><strong>${e(currentLabel)}</strong></article><article><span>NASDAQ Due</span><strong>${e(dueLabel)}</strong></article><article><span>Load From</span><strong>${e(plan.fromDate || "--")}</strong></article><article><span>Missing Days</span><strong>${e(plan.missingBusinessDayCount ?? "--")}</strong></article><article><span>Due Gaps</span><strong>${e(plan.missingDueRows ?? "--")}</strong></article><article><span>Shards</span><strong>${e(job.total || 0)}</strong></article><article><span>Done</span><strong>${e(job.processed || 0)}</strong></article><article><span>Active</span><strong>${e(job.activeShards || 0)}</strong></article><article><span>Failures</span><strong>${e((job.failures || []).length)}</strong></article></div>
      <div class="signals-live-bar"><span>Plan: ${e(plan.reason || "CURRENT")} ${plan.toDate ? `| ${e(plan.fromDate || "")} to ${e(plan.toDate || "")}` : ""}</span><span>${e(plan.needsLoad ? "incremental load required" : "no reload needed")}</span></div>
      <section class="rs-agent-shards"><h4>Shard Jobs</h4><ul>${(job.shards || []).map(shardRow).join("")}</ul></section>
      <div class="rs-agent-columns"><section><h4>Progress Events</h4><ul>${(job.events || []).slice(0, 12).map(eventRow).join("") || `<li><span>--</span><strong>No events yet.</strong></li>`}</ul></section><section><h4>Failures</h4><ul>${(job.failures || []).slice(0, 12).map(failureRow).join("") || `<li><strong>None</strong><span>No failures reported.</span></li>`}</ul></section></div>
    </div>`;
  }

  function bindRsAgentTile(tile) {
    tile.querySelector("[data-rs-agent-start]")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const button = form.querySelector("button");
      button.disabled = true;
      button.textContent = "Starting...";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.dryRun = form.querySelector('[name="dryRun"]')?.checked || false;
        const status = await api("/api/agents/rs-daily/status", null, "GET");
        if (status?.calendar && !data.dryRun) {
          const q = await api("/api/pipeline/data-quality", null, "GET");
          const promptText = q.shouldTriggerRsDaily
            ? `Business day ${q.businessDay} needs RS Daily refresh. Coverage ${q.coverageRatio}% (${q.actualSymbols}/${q.expectedSymbols}). Start download?`
            : `RS Daily is current for ${status.calendar.latestCompletedDate}. Run again anyway?`;
          if (!confirm(promptText)) throw new Error("RS Daily run cancelled.");
        }
        const response = await fetch("/api/agents/rs-daily/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
        const job = await response.json();
        if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
        tile.innerHTML = rsAgentTemplate(job);
        bindRsAgentTile(tile);
      } catch (error) {
        button.disabled = false;
        button.textContent = "Start";
        tile.insertAdjacentHTML("beforeend", `<div class="signals-live-error">${e(error.message)}</div>`);
      }
    });
  }

  async function saveRiskSettings(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const button = form.querySelector("button");
    const tile = form.closest("[data-risk-cockpit]");
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const response = await fetch("/api/risk/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      tile.dataset.loaded = "true";
      tile.__riskData = data.risk;
      tile.innerHTML = riskCockpitTemplate(data.risk, tile.__riskSelected);
      tile.querySelector("[data-risk-settings]")?.addEventListener("submit", saveRiskSettings);
      bindRiskCockpit(tile);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Save";
      tile.insertAdjacentHTML("beforeend", `<div class="signals-live-error">${e(error.message)}</div>`);
    }
  }

  async function reloadSignalsCockpitTilesFromCache() {
    const tiles = [...root.querySelectorAll("[data-signals-cockpit][data-loaded='true']")];
    if (!tiles.length) return;
    try {
      const response = await fetch(`/api/signals/tile?limit=100&cacheOnly=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      for (const tile of tiles) tile.innerHTML = signalsCockpitTemplate(data);
      root.querySelectorAll("[data-refresh-signals-live]").forEach((button) => button.addEventListener("click", (ev) => refreshSignalsLive(ev.currentTarget)));
    } catch {
      // Keep the last good cached render on transient refresh failures.
    }
  }

  function signalsCockpitTemplate(data) {
    const count = (state) => Number(data.counts?.[state] || 0);
    const tone = (value) => Number(value || 0) > 0 ? "good" : Number(value || 0) < 0 ? "bad" : "neutral";
    const money = (value) => value == null ? "NA" : Number(value).toFixed(2);
    const pctText = (value) => value == null ? "NA" : `${Number(value).toFixed(2)}%`;
    const shortDate = (value) => value ? String(value).replace("T", " ").slice(0, 16) : "NA";
    const production = data.production || {};
    const signalRows = (data.strategySignals || []).slice(0, 120).map((item) => {
      const gainTone = tone(item.gainPct);
      const changeTone = tone(item.changePct);
      return `<tr class="tone-${e(item.tone || "neutral")}" data-symbol="${e(item.symbol)}">
        <td><b>${e(item.strategy)}</b></td><td><span class="state-pill tone-${e(item.tone || "neutral")}">${e(item.state)}</span></td><td><strong>${e(item.symbol)}</strong></td>
        <td>${e(item.setup || "Signal")}</td><td>${e(money(item.entry))}</td><td>${e(money(item.stop))}</td><td>${e(money(item.pivot))}</td>
        <td>${e(item.score ?? "NA")}</td><td class="tone-${e(changeTone)}">${e(pctText(item.changePct))}</td><td class="tone-${e(gainTone)}">${e(pctText(item.gainPct))}</td>
        <td>${e(item.reason || "")}<small>${e(item.invalidation || "")}</small></td>
      </tr>`;
    }).join("");
    const candidateRow = (item, toneName) => `<tr data-symbol="${e(item.symbol)}"><td><strong>${e(item.symbol)}</strong></td><td>${e(item.strategy || "NA")}</td><td><span class="workflow-pill tone-${e(toneName)}">${e(item.status || item.lifecycleState || "WATCH")}</span></td><td>${e(item.dateAdded || item.scanDate || "NA")}</td><td>${e(item.currentPrice ?? "NA")}</td><td>${e(item.triggerCondition || "")}</td><td>${e(item.distanceFromTrigger ?? "NA")}</td><td>${e(item.sector || "")} / ${e(item.industry || "")}</td></tr>`;
    const snapshotRows = (data.snapshots || []).slice(0, 100).map((item) => {
      const changeTone = Number(item.changePct || 0) > 0 ? "good" : Number(item.changePct || 0) < 0 ? "bad" : "neutral";
      return `<tr data-symbol="${e(item.symbol)}"><td>${e(shortDate(item.capturedAt))}</td><td>${e(item.strategy)}</td><td><strong>${e(item.symbol)}</strong></td><td>${e(money(item.last))}</td><td class="tone-${e(changeTone)}">${e(pctText(item.changePct))}</td><td>${e(item.volume || 0)}</td><td>${e(pctText(item.distanceToStopPct))}</td><td>${e(pctText(item.distanceToPivotPct))}</td><td>${e(item.state || "WATCH")}</td></tr>`;
    }).join("");
    const openCards = (data.openTrades || data.openSignals || []).slice(0, 18).map((item) => {
      const guide = item.sellGuidance || {};
      return `<article class="signal-open-card tone-${e(guide.tone || item.tone || "neutral")}" data-symbol="${e(item.symbol)}">
        <header><div><strong>${e(item.symbol)}</strong><span>${e(item.sector || item.strategy || "Signal")} | ${e(item.industry || item.setup || "")}</span></div><b>${e(item.status || item.state || "OPEN")}</b></header>
        <dl><div><dt>Entry</dt><dd>${e(money(item.entry))}</dd></div><div><dt>Last</dt><dd>${e(money(item.last))}</dd></div><div><dt>Stop</dt><dd>${e(money(item.stop))}</dd></div><div><dt>Days</dt><dd>${e(item.holdingDays ?? "NA")}</dd></div><div><dt>RS</dt><dd>${e(item.rs ?? "NA")}</dd></div><div><dt>5D</dt><dd>${e(pctText(item.perf5d))}</dd></div></dl>
        <p>${e(item.reason || item.why_it_fits || "Stored signal thesis unavailable.")}</p>
        <footer><span class="state-pill tone-${e(guide.tone || "neutral")}">${e(guide.label || "Rule Check")}</span><small>${e(guide.action || item.invalidation || "Use stored invalidation and risk screen settings.")}</small></footer>
      </article>`;
    }).join("");
    const closedRows = (data.closedTrades || []).slice(0, 80).map((item) => `<tr data-symbol="${e(item.symbol)}"><td>${e(item.date || "")}</td><td><strong>${e(item.symbol)}</strong></td><td class="tone-${e(tone(item.currentPnlPct))}">${e(pctText(item.currentPnlPct))}</td><td>${e(item.status || "EXITED")}</td><td>${e(item.sector || "Unknown")}</td><td>${e(item.industry || "Unknown")}</td><td>${e(item.invalidation || item.reason || "")}</td></tr>`).join("");
    const guardTone = production.tone === "good" ? "good" : "bad";
    return `<div class="signals-tile-shell">
      <section class="signals-tile-hero tone-${e(data.tones?.quarterly || "neutral")}"><div><span>Swing System</span><strong>Signal Book</strong><small>Latest business data ${e(data.rsDailyLatestDate || data.regimeDate || "")} | ${e((data.strategySignals || []).length)} strategy rows</small></div><b>${e(data.quarterlySignal || "NA")}/${e(data.dailySignal || "NA")}</b></section>
      <div class="signals-live-bar"><span>Source truth: ${e(data.sourceTruth?.signals || "signal tables")} | Home triangle: ${e(data.sourceTruth?.homeHierarchy || "market hierarchy cache")}</span><button data-refresh-signals-live>Refresh Snapshots</button></div>
      <section class="signals-permission tone-${e(guardTone)}"><div><span>Trade Permission</span><strong>${e(production.state || "UNKNOWN")}</strong><small>${e((production.reasons || []).join(" | ") || "Market, freshness, and risk posture allow rule-based action.")}</small></div><b>${e(data.regimeClassification || "No Signal")}</b></section>
      <div class="signals-stat-grid"><article><span>Open / Buy</span><strong>${count("OPEN") + count("BUY")}</strong></article><article><span>Watch</span><strong>${count("WATCH")}</strong></article><article><span>Exited</span><strong>${count("EXITED")}</strong></article><article><span>Rejected</span><strong>${count("REJECTED")}</strong></article></div>
      <section class="signals-table-panel"><header><h4>Strategy Signal Book</h4><span>RS Leadership + VCP</span></header><div class="signals-table-scroll"><table><thead><tr><th>Strategy</th><th>State</th><th>Symbol</th><th>Setup</th><th>Entry</th><th>Stop</th><th>Pivot</th><th>Score</th><th>Change</th><th>Gain</th><th>Risk Line</th></tr></thead><tbody>${signalRows || `<tr><td colspan="11">No strategy signal rows available.</td></tr>`}</tbody></table></div></section>
      <section class="signals-table-panel"><header><h4>Watch Candidates</h4><span>Waiting for Signal</span></header><div class="signals-table-scroll"><table><thead><tr><th>Symbol</th><th>Strategy</th><th>State</th><th>Date Added</th><th>Price</th><th>Trigger</th><th>Distance</th><th>Market / Group</th></tr></thead><tbody>${(data.watchCandidates || []).map((item) => candidateRow(item, "watch")).join("") || `<tr><td colspan="8">No watch candidates waiting for trigger.</td></tr>`}</tbody></table></div></section>
      <section class="signals-table-panel"><header><h4>Triggered Buy Candidates</h4><span>Ready for Trading workflow</span></header><div class="signals-table-scroll"><table><thead><tr><th>Symbol</th><th>Strategy</th><th>State</th><th>Date Added</th><th>Price</th><th>Trigger</th><th>Distance</th><th>Market / Group</th></tr></thead><tbody>${(data.triggeredBuyCandidates || []).map((item) => candidateRow(item, "active")).join("") || `<tr><td colspan="8">No triggered buy candidates.</td></tr>`}</tbody></table></div></section>
      <section class="signals-table-panel"><header><h4>Near-Live Signal Progress</h4><span>Durable delayed snapshots from web_signal_snapshots</span></header><div class="signals-table-scroll"><table><thead><tr><th>Captured</th><th>Strategy</th><th>Symbol</th><th>Last</th><th>Change</th><th>Volume</th><th>Distance To Stop</th><th>Distance To Pivot</th><th>State</th></tr></thead><tbody>${snapshotRows || `<tr><td colspan="9">No snapshots captured yet. Use Refresh Snapshots.</td></tr>`}</tbody></table></div></section>
      <section class="signals-open-grid">${openCards || `<article class="signal-open-card"><strong>No open signals</strong><p>No OPEN or BUY rows are currently available.</p></article>`}</section>
      <section class="signals-table-panel"><header><h4>Closed Signal Outcomes</h4><span>Journal feedback loop from actionable trade outcomes</span></header><div class="signals-table-scroll"><table><thead><tr><th>Date</th><th>Symbol</th><th>P&L</th><th>Reason</th><th>Sector</th><th>Industry</th><th>Comment</th></tr></thead><tbody>${closedRows || `<tr><td colspan="7">No closed outcomes returned from actionable trades.</td></tr>`}</tbody></table></div></section>
    </div>`;
  }
  async function refreshSignalsLive(button) {
    const tile = button.closest("[data-signals-cockpit]");
    button.disabled = true;
    button.textContent = "Refreshing...";
    try {
      const response = await fetch("/api/signals/refresh", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      tile.dataset.loaded = "";
      tile.innerHTML = `<div class="widget-loading">${e(data.message || "Snapshots refreshed.")}</div>`;
      delete tile.dataset.loaded;
      await hydrateSignalsCockpitTiles();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Refresh Snapshots";
      tile.insertAdjacentHTML("beforeend", `<div class="signals-live-error">${e(error.message)}</div>`);
    }
  }

  async function hydrateMinerviniScreenTiles(force = false) {
    const tiles = [...root.querySelectorAll("[data-minervini-screen]")].filter((tile) => force || !tile.dataset.loaded);
    if (!tiles.length) return;
    try {
      const data = await api("/api/sec-leadership/results?limit=250", null, "GET");
      for (const tile of tiles) {
        tile.dataset.loaded = "true";
        tile.__minerviniRows = data.rows || [];
        tile.__minerviniData = data;
        tile.innerHTML = minerviniScreenTemplate(data);
        bindMinerviniScreen(tile);
        const first = tile.querySelector("[data-minervini-symbol]");
        if (first && !tile.__minerviniSelected) first.click();
      }
    } catch (error) {
      for (const tile of tiles) tile.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong><button data-refresh-minervini>Retry</button></div>`;
    }
  }

  async function pollMinerviniScreenTiles() {
    const tiles = [...root.querySelectorAll("[data-minervini-screen]")];
    if (!tiles.length) return;
    try {
      const status = await api("/api/sec-leadership/status", null, "GET");
      if (status.running) {
        for (const tile of tiles) {
          const banner = tile.querySelector(".minervini-running");
          const job = status.currentJob || {};
          const pctDone = job.total ? Math.round(Number(job.processed || 0) / Number(job.total || 1) * 100) : 0;
          if (banner) {
            banner.innerHTML = `<div><strong>SEC refresh running in background</strong><span>${e(job.currentSymbol || "Preparing")} | ${e(job.processed || 0)} / ${e(job.total || 0)} processed</span></div><b>${e(pctDone)}%</b><div class="cache-progress-track"><span style="--w:${e(pctDone)}%"></span></div>`;
          }
          tile.querySelector("[data-run-minervini]")?.setAttribute("disabled", "disabled");
        }
      } else if (tiles.some((tile) => tile.querySelector(".minervini-running"))) {
        for (const tile of tiles) delete tile.dataset.loaded;
        await hydrateMinerviniScreenTiles(true);
      }
    } catch {}
  }

  function minerviniTone(classification = "") {
    if (classification === "Market Leader") return "good";
    if (classification === "Top Competitor") return "info";
    if (classification === "Institutional Favorite") return "warn";
    if (classification === "Turnaround Situation") return "turn";
    if (classification === "Data Failure") return "bad";
    return "neutral";
  }

  function minerviniEsGrade(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "neutral";
    if (value <= 45) return "green";
    if (value <= 70) return "amber";
    return "red";
  }

  function minerviniEsLabel(score) {
    const grade = minerviniEsGrade(score);
    if (grade === "green") return "Green";
    if (grade === "amber") return "Amber";
    if (grade === "red") return "Red";
    return "NA";
  }

  function minerviniScreenTemplate(data = {}) {
    const status = data.status || {};
    const job = status.currentJob || data.job || {};
    const running = Boolean(status.running || job.status === "RUNNING");
    const pctDone = job.total ? Math.round(Number(job.processed || 0) / Number(job.total || 1) * 100) : 0;
    const k = data.kpis || {};
    const esFilter = state.minerviniEsFilter || "all";
    const visibleRows = (data.rows || []).filter((row) => esFilter === "all" || minerviniEsGrade(row.extensionScore) === esFilter);
    const rows = visibleRows.map((row) => {
      const failureTitle = row.secDataStatus === "FAIL" && row.failureReason ? ` title="${e(row.failureReason)}"` : "";
      const esGrade = minerviniEsGrade(row.extensionScore);
      return `<button class="minervini-row tone-${e(minerviniTone(row.classification))}" data-minervini-symbol="${e(row.symbol)}"${failureTitle}><strong>${e(row.symbol)}</strong><span>${e(row.companyName || "")}</span><em>${e(row.classification || "")}</em><i class="es-badge es-${e(esGrade)}" title="Extension Score: lower is cleaner; Green <= 45, Amber <= 70, Red > 70.">${e(row.extensionScore ?? "NA")} ${e(minerviniEsLabel(row.extensionScore))}</i><b>${e(row.minerviniScore ?? "")}</b></button>`;
    }).join("");
    const kpi = (label, value) => `<article><span>${e(label)}</span><strong>${e(value ?? 0)}</strong></article>`;
    const banner = running ? `<section class="minervini-running"><div><strong>SEC refresh running in background</strong><span>${e(job.currentSymbol || "Preparing")} | ${e(job.processed || 0)} / ${e(job.total || 0)} processed</span></div><b>${e(pctDone)}%</b><div class="cache-progress-track"><span style="--w:${e(pctDone)}%"></span></div></section>` : "";
    return `<div class="minervini-screen">
      <header><div><span>RS250 + SEC CompanyFacts</span><strong>Mark Minervini Screen</strong><small>last run ${e(data.job?.finishedAt || data.job?.startedAt || "not run")} | ${e(data.runId || "no completed run")}</small></div><div class="minervini-actions"><label>ES <select data-minervini-es-filter><option value="all" ${esFilter === "all" ? "selected" : ""}>All</option><option value="green" ${esFilter === "green" ? "selected" : ""}>Green</option><option value="amber" ${esFilter === "amber" ? "selected" : ""}>Amber</option><option value="red" ${esFilter === "red" ? "selected" : ""}>Red</option></select></label><button data-run-minervini ${running ? "disabled" : ""}>${running ? "Running..." : "Run SEC Refresh"}</button><button data-refresh-minervini>Refresh</button></div></header>
      ${banner}
      <section class="minervini-kpis">${kpi("Total RS250", k.totalRs250 || (data.rows || []).length)}${kpi("Market Leaders", k.marketLeaders)}${kpi("Top Competitors", k.topCompetitors)}${kpi("Institutional Favorites", k.institutionalFavorites)}${kpi("Turnarounds", k.turnarounds)}${kpi("Failed", k.failedSymbols)}${kpi("Avg Score", k.averageMinerviniScore)}</section>
      <section class="minervini-grid"><div class="minervini-head"><span>Symbol</span><span>Company Name</span><span>Classification</span><span>ES</span><span>Minervini Score</span></div><div class="minervini-rows">${rows || `<div class="widget-empty">${e(data.message || "No rows match the ES filter.")}</div>`}</div><aside data-minervini-detail>${minerviniEmptyDetailTemplate()}</aside></section>
    </div>`;
  }

  function bindMinerviniScreen(tile) {
    tile.querySelector("[data-refresh-minervini]")?.addEventListener("click", () => { delete tile.dataset.loaded; hydrateMinerviniScreenTiles(true); });
    tile.querySelector("[data-minervini-es-filter]")?.addEventListener("change", (ev) => {
      state.minerviniEsFilter = ev.target.value;
      tile.__minerviniSelected = "";
      tile.innerHTML = minerviniScreenTemplate(tile.__minerviniData || { rows: tile.__minerviniRows || [] });
      bindMinerviniScreen(tile);
      tile.querySelector("[data-minervini-symbol]")?.click();
    });
    tile.querySelector("[data-run-minervini]")?.addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = "Starting...";
      try {
        await api("/api/sec-leadership/start", { limit: 250 }, "POST");
        delete tile.dataset.loaded;
        await hydrateMinerviniScreenTiles(true);
      } catch (error) {
        ev.currentTarget.disabled = false;
        ev.currentTarget.textContent = "Run SEC Refresh";
        alert(error.message);
      }
    });
    tile.querySelectorAll("[data-minervini-symbol]").forEach((button) => button.addEventListener("click", async () => {
      tile.__minerviniSelected = button.dataset.minerviniSymbol;
      tile.querySelectorAll("[data-minervini-symbol]").forEach((row) => row.classList.toggle("selected", row === button));
      const panel = tile.querySelector("[data-minervini-detail]");
      panel.innerHTML = `<div class="widget-loading">Loading ${e(button.dataset.minerviniSymbol)} detail...</div>`;
      try {
        const detail = await api(`/api/sec-leadership/symbol/${encodeURIComponent(button.dataset.minerviniSymbol)}`, null, "GET");
        panel.innerHTML = minerviniDetailTemplate(detail);
      } catch (error) {
        panel.innerHTML = `<div class="widget-error"><strong>${e(error.message)}</strong></div>`;
      }
    }));
  }

  function minerviniEmptyDetailTemplate() {
    return `<div class="minervini-empty-detail"><strong>Select a leader</strong><p>Click any RS250 row to validate the setup in one pass: classification, extension risk, SEC acceleration, Trend Template, and data quality.</p><dl><dt>Market Leader</dt><dd>Best blend of RS, trend, industry leadership, and Code 3 acceleration.</dd><dt>Top Competitor</dt><dd>Strong RS and fundamentals that may overtake an industry leader.</dd><dt>Institutional Favorite</dt><dd>Quality/liquidity profile with steadier sponsorship characteristics.</dd><dt>Turnaround</dt><dd>Improving revenue, EPS, or margins with strengthening RS.</dd></dl></div>`;
  }

  function minerviniDetailTemplate(data = {}) {
    const s = data.summary || {};
    const f = data.fundamentals || {};
    const latest = data.chart?.latest || {};
    const tableRows = [
      ["Index", s.rsRank ? `RS250 #${s.rsRank}` : "NA", "P/E", "NA", "EPS next Y", `${e(f.epsYoyPct ?? "")}%`, "Insider Own", "NA", "Perf Week", `${e(latest.perf_5d_pct ?? "")}%`],
      ["Market Cap", "NA", "Forward P/E", "NA", "Revenue YoY", `${e(f.revenueYoyPct ?? "")}%`, "Inst Own", "NA", "Perf Month", "NA"],
      ["Enterprise Value", "NA", "PEG", "NA", "Code 3", `${e(data.code3?.score ?? 0)}/9 ${e(data.code3?.confidence || "")}`, "ROA", "NA", "Perf Quarter", "NA"],
      ["Income", compactNumber(f.latestRevenue), "P/S", "NA", "Trend", `${e(data.trend?.class || "")} ${e(data.trend?.score ?? "")}`, "ROE", "NA", "Perf Half Y", "NA"],
      ["Sales", compactNumber(f.latestRevenue), "P/B", "NA", "ES", `${e(data.summary?.extensionScore ?? latest.es_score ?? "")}`, "Gross Margin", `${e(f.grossMarginPct ?? "")}%`, "Perf YTD", "NA"],
      ["Book/sh", "NA", "P/C", "NA", "EPS YoY", `${e(f.epsYoyPct ?? "")}%`, "Oper Margin", `${e(f.operatingMarginPct ?? "")}%`, "Perf Year", "NA"],
      ["Cash/sh", "NA", "P/FCF", "NA", "Latest Filing", e(f.latestFilingDate || ""), "Profit Margin", "NA", "Price", e(latest.close ?? data.technical?.close ?? "")],
      ["Dividend Est.", "NA", "EV/EBITDA", "NA", "Data Quality", e(s.secDataStatus || ""), "ATR", e(data.technical?.atr ?? ""), "Change", `${e(latest.perf_1d_pct ?? "")}%`],
      ["Dividend TTM", "NA", "EV/Sales", "NA", "Classification", e(s.classification || ""), "SMA50", e(data.technical?.ma50 ?? ""), "Volume", compactNumber(latest.volume)],
      ["IPO", "NA", "Option/Short", "NA", "Failure", e(s.secDataStatus === "FAIL" ? s.failureReason || "" : ""), "SMA200", e(data.technical?.ma200 ?? ""), "Avg Volume", compactNumber(data.technical?.avgVolume50)]
    ].map((cells) => `<tr>${cells.map((cell, index) => `<${index % 2 === 0 ? "th" : "td"}>${cell}</${index % 2 === 0 ? "th" : "td"}>`).join("")}</tr>`).join("");
    return `<div class="minervini-detail market-style"><section class="minervini-chart-block">${minerviniChartTemplate(data)}</section><section class="minervini-bottom-table"><table><tbody>${tableRows}</tbody></table></section></div>`;
  }

  function minerviniChartTemplate(data = {}) {
    const rows = [...(data.chart?.rows || [])].filter((row) => row.sdate && row.open != null && row.high != null && row.low != null && row.close != null).sort((a, b) => String(a.sdate).localeCompare(String(b.sdate))).slice(-160);
    const s = data.summary || {};
    if (!rows.length) return `<div class="minervini-chart-empty"><strong>${e(s.symbol || "")}</strong><span>No cached price history available for chart yet.</span></div>`;
    const w = 900, h = 330, volH = 72, pad = { top: 18, right: 48, bottom: 22, left: 16 };
    const derived = rows.map((_, index) => deriveClientStockbee(rows.slice(0, index + 1)));
    const ma20 = derived.map((row) => row.sma20);
    const ma50 = derived.map((row) => row.sma50);
    const scale = chartScale(rows.flatMap((row) => [row.high, row.low, ...[ma20[rows.indexOf(row)], ma50[rows.indexOf(row)]].filter(Number.isFinite)]));
    const innerH = h - pad.top - pad.bottom;
    const step = (w - pad.left - pad.right) / rows.length;
    const y = (value) => pad.top + innerH - ((Number(value) - scale.min) / (scale.max - scale.min || 1)) * innerH;
    const x = (index) => pad.left + index * step + step / 2;
    const grid = [0, .25, .5, .75, 1].map((p) => {
      const gy = pad.top + p * innerH;
      const price = scale.max - p * (scale.max - scale.min);
      return `<line class="grid" x1="${pad.left}" x2="${w - pad.right}" y1="${gy}" y2="${gy}"/><text class="axis" x="${w - pad.right + 6}" y="${gy + 4}">${price.toFixed(2)}</text>`;
    }).join("");
    const candles = rows.map((row, index) => {
      const open = Number(row.open), close = Number(row.close), high = Number(row.high), low = Number(row.low);
      const up = close >= open, cx = x(index), bodyY = Math.min(y(open), y(close)), bodyH = Math.max(1, Math.abs(y(close) - y(open)));
      return `<g class="${up ? "up" : "down"}"><line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(high).toFixed(1)}" y2="${y(low).toFixed(1)}"/><rect x="${(cx - Math.max(2, step * .32)).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${Math.max(2, step * .64).toFixed(1)}" height="${bodyH.toFixed(1)}"/></g>`;
    }).join("");
    const maPath = (values) => values.map((value, index) => Number.isFinite(Number(value)) ? `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}` : "").filter(Boolean).join(" ");
    const maxVol = Math.max(...rows.map((row) => Number(row.volume || 0)), 1);
    const volumes = rows.map((row, index) => {
      const up = Number(row.close || 0) >= Number(row.open || 0);
      const barH = Math.max(2, Number(row.volume || 0) / maxVol * volH);
      return `<rect class="${up ? "up" : "down"}" x="${(pad.left + index * step).toFixed(1)}" y="${(volH - barH).toFixed(1)}" width="${Math.max(2, step * .72).toFixed(1)}" height="${barH.toFixed(1)}"/>`;
    }).join("");
    const latest = rows.at(-1) || {};
    return `<div class="minervini-tv-chart"><header><div><strong>${e(s.symbol || data.symbol || "")}</strong><span>${e(s.companyName || "")} | ${e(s.sector || "")} ${e(s.industry || "")}</span></div><b>${Number(latest.close || 0).toFixed(2)}</b></header><svg class="minervini-price-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}<path class="ma ma20" d="${maPath(ma20)}"/><path class="ma ma50" d="${maPath(ma50)}"/>${candles}</svg><div class="minervini-volume"><span>Vol</span><svg viewBox="0 0 ${w} ${volH}" preserveAspectRatio="none">${volumes}</svg></div><footer><span>SMA20</span><span>SMA50</span><span>Daily candles</span></footer></div>`;
  }

  function initLiveEvents() {
    if (liveEventSource || typeof EventSource === "undefined") return;
    try {
      liveEventSource = new EventSource("/api/live/events");
      liveEventSource.addEventListener("connected", (ev) => updateLiveStatus(ev.data));
      liveEventSource.addEventListener("heartbeat", (ev) => updateLiveStatus(ev.data));
      ["rs_daily_refresh_completed", "pipeline_refresh_completed", "workspace", "market_cache", "signals", "bots"].forEach((type) => {
        liveEventSource.addEventListener(type, (ev) => pushLiveEvent(type, ev.data));
      });
      liveEventSource.onerror = () => {
        state.liveStatus = { ...(state.liveStatus || {}), source: "mtm.live.events", degraded: true, lastError: "SSE disconnected; polling fallback remains active.", serverTime: new Date().toISOString() };
        hydrateLiveCacheMonitorTiles(true);
      };
    } catch (error) {
      state.liveStatus = { source: "mtm.live.events", degraded: true, lastError: error.message, serverTime: new Date().toISOString() };
    }
  }

  function updateLiveStatus(raw) {
    try { state.liveStatus = JSON.parse(raw); } catch { state.liveStatus = { source: "mtm.live.events", serverTime: new Date().toISOString() }; }
    hydrateLiveCacheMonitorTiles(true);
  }

  function pushLiveEvent(type, raw) {
    let event;
    try { event = JSON.parse(raw); } catch { event = { type, at: new Date().toISOString(), payload: {} }; }
    state.liveEvents = [event, ...(state.liveEvents || [])].slice(0, 18);
    eventBus.emit(type, event.payload || {});
    hydrateLiveCacheMonitorTiles(true);
  }

  function botTone(bot) {
    if (!bot.enabled) return "bad";
    if (bot.status === "ready") return "good";
    if (bot.status === "guarded") return "warn";
    return "neutral";
  }

  function botsLabTemplate(data = {}) {
    const rows = (data.bots || []).map((bot) => `<article class="bot-row tone-${botTone(bot)}" title="${e(bot.description)}"><div><strong>${e(bot.name)}</strong><span>${e(bot.bucket)} | ${e(bot.status)} | ${e(bot.risk)} risk</span></div><b>${bot.enabled ? "Enabled" : "Locked"}</b></article>`).join("");
    return `<div class="bot-lab-shell"><header><div><span>Bot Catalog</span><strong>Guarded Research Buckets</strong><small>${e(data.asOf || "")}</small></div><b>${e((data.bots || []).length)}</b></header><div class="bot-grid">${rows || `<div class="widget-empty">No bots registered.</div>`}</div></div>`;
  }

  async function hydrateBotsLabTiles(silent = false) {
    const tiles = [...root.querySelectorAll("[data-bots-lab]")];
    if (!tiles.length) return;
    try {
      const data = await api("/api/bots/catalog", null, "GET");
      tiles.forEach((tile) => tile.innerHTML = botsLabTemplate(data));
    } catch (error) {
      if (!silent) tiles.forEach((tile) => tile.innerHTML = `<div class="widget-error">${e(error.message)}</div>`);
    }
  }

  async function hydrateLiveCacheMonitorTiles(silent = false) {
    const tiles = [...root.querySelectorAll("[data-live-cache-monitor]")];
    if (!tiles.length) return;
    try {
      if (!state.liveStatus) state.liveStatus = await api("/api/live/status", null, "GET");
      const events = (state.liveEvents || []).map((event) => `<li><span>${e(event.type || "event")}</span><strong>${e(new Date(event.at || Date.now()).toLocaleTimeString())}</strong></li>`).join("");
      const degraded = state.liveStatus?.degraded;
      tiles.forEach((tile) => tile.innerHTML = `<div class="live-cache-shell"><header class="tone-${degraded ? "warn" : "good"}"><div><span>Live Cache Monitor</span><strong>${degraded ? "Polling fallback" : "SSE connected"}</strong><small>${e(state.liveStatus?.serverTime || "")}</small></div><b>${e(state.liveStatus?.connected ?? 0)}</b></header><ul>${events || `<li><span>No live events yet</span><strong>Ready</strong></li>`}</ul>${state.liveStatus?.lastError ? `<p>${e(state.liveStatus.lastError)}</p>` : ""}</div>`);
    } catch (error) {
      if (!silent) tiles.forEach((tile) => tile.innerHTML = `<div class="widget-error">${e(error.message)}</div>`);
    }
  }

  function candleCacheTemplate(data = {}) {
    if (data.warming) return `<div class="widget-loading">Candle cache warming...</div>`;
    if (!data.found) return `<div class="widget-error">${e(data.symbol || "Symbol")} not found in candle cache.</div>`;
    const rows = data.rows || [];
    const latest = data.latest || rows.at(-1) || {};
    const w = 520, h = 190, pad = 18;
    const prices = rows.flatMap((row) => [Number(row.high), Number(row.low), Number(row.sma20), Number(row.sma50)]).filter(Number.isFinite);
    const min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
    const x = (i) => pad + (i / Math.max(1, rows.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((Number(v) - min) / span) * (h - pad * 2);
    const cw = Math.max(2, Math.min(7, (w - pad * 2) / Math.max(1, rows.length) * .7));
    const candles = rows.map((row, i) => { const open = Number(row.open), close = Number(row.close), high = Number(row.high), low = Number(row.low), up = close >= open, cx = x(i), top = y(Math.max(open, close)), bottom = y(Math.min(open, close)); return `<g class="${up ? "up" : "down"}"><line x1="${cx}" x2="${cx}" y1="${y(high)}" y2="${y(low)}"/><rect x="${cx - cw / 2}" y="${top}" width="${cw}" height="${Math.max(1, bottom - top)}"/></g>`; }).join("");
    const pathFor = (key) => rows.map((row, i) => Number.isFinite(Number(row[key])) ? `${i ? "L" : "M"}${x(i).toFixed(1)},${y(row[key]).toFixed(1)}` : "").filter(Boolean).join(" ");
    const maxVol = Math.max(...rows.map((row) => Number(row.volume || 0)), 1);
    const volumes = rows.slice(-40).map((row) => `<span style="--h:${Math.max(4, Number(row.volume || 0) / maxVol * 100).toFixed(1)}%"></span>`).join("");
    return `<div class="candle-cache-shell"><header><div><span>Candle Cache</span><strong>${e(data.symbol)}</strong><small>${e(data.startDate || "")} to ${e(data.latestDate || "")}</small></div><b>${Number(latest.close || 0).toFixed(2)}</b></header><svg class="cache-candle-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${candles}<path class="ma20" d="${pathFor("sma20")}"/><path class="ma50" d="${pathFor("sma50")}"/></svg><div class="cache-volume-bars">${volumes}</div><dl><dt>SMA20</dt><dd>${fmtNumber(latest.sma20, 2)}</dd><dt>SMA50</dt><dd>${fmtNumber(latest.sma50, 2)}</dd><dt>Vol20</dt><dd>${compactNumber(latest.avg_volume_20)}</dd></dl></div>`;
  }

  async function hydrateCandleCacheTiles(silent = false) {
    const tiles = [...root.querySelectorAll("[data-candle-cache]")];
    if (!tiles.length) return;
    for (const tile of tiles) {
      try {
        const card = tile.closest("[data-widget-id]");
        const widget = currentWorkspace().widgets.find((item) => item.id === card?.dataset.widgetId);
        const symbol = widget?.config?.symbol || contextBus.get(widget?.linkGroup).symbol || "SPY";
        const data = await api(`/api/candle-cache/symbol/${encodeURIComponent(symbol)}?limit=120`, null, "GET");
        tile.innerHTML = candleCacheTemplate(data);
      } catch (error) {
        if (!silent) tile.innerHTML = `<div class="widget-error">${e(error.message)}</div>`;
      }
    }
  }
  function compactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    return n.toLocaleString();
  }

  function fmtNumber(value, digits = 1) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "NA";
  }

  function bindWidgetEvents() {
    hydrateScreenerTiles(); hydrateMarketMonitorTiles(); hydrateMarketCycleTiles(); hydrateMarketCockpitTiles(); hydrateGroupCockpitTiles(); hydrateLeadersCockpitTiles(); hydrateMinerviniScreenTiles(); hydrateSignalsCockpitTiles(); hydrateWatchlistTiles(); hydrateRiskCockpitTiles(); hydrateTradingSystemMonitorTiles(); hydrateRsAgentTiles(); hydrateRsDataMonitorTiles(); hydratePipelineAgentTiles(); hydrateRsRankingTiles(); hydrateBotsLabTiles(); hydrateLiveCacheMonitorTiles(); hydrateCandleCacheTiles(); hydrateDailyReportTiles(); hydrateReasoningImagesTiles();
    root.querySelectorAll(".widget-card").forEach((card) => { const w = currentWorkspace().widgets.find((item) => item.id === card.dataset.widgetId); if (!w) return; card.querySelector(".drag-handle")?.addEventListener("pointerdown", (ev) => startDrag(ev, w)); card.querySelector(".resize-handle")?.addEventListener("pointerdown", (ev) => startResize(ev, w)); card.querySelector("[data-widget-menu]")?.addEventListener("click", () => { const m = card.querySelector(".widget-menu"); m.hidden = !m.hidden; }); card.querySelector("[data-refresh-signals-live]")?.addEventListener("click", (ev) => refreshSignalsLive(ev.currentTarget)); card.querySelector("[data-risk-settings]")?.addEventListener("submit", saveRiskSettings); card.querySelector("[data-link-group]")?.addEventListener("change", (ev) => { w.linkGroup = ev.target.value; renderWidgets(); persistAll(); }); card.querySelectorAll("[data-symbol]").forEach((b) => b.addEventListener("click", () => { contextBus.update(w.linkGroup, { symbol: b.dataset.symbol }, w.id); eventBus.emit("symbol_selected", { symbol: b.dataset.symbol, link_group: w.linkGroup }); })); card.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => runWidgetAction(b.dataset.action, w))); });
    if (!timers.has("__signals_cache__")) timers.set("__signals_cache__", window.setInterval(reloadSignalsCockpitTilesFromCache, 30000));
    if (!timers.has("__watchlist_cache__")) timers.set("__watchlist_cache__", window.setInterval(() => {
      hydrateWatchlistTiles(true);
      if (state.screenerView.autoRefresh) hydrateScreenerTiles(true);
    }, 30000));
    if (!timers.has("__rs_agent__")) timers.set("__rs_agent__", window.setInterval(() => { hydrateRsAgentTiles(true); hydrateRsDataMonitorTiles(true); hydratePipelineAgentTiles(true); pollMinerviniScreenTiles(); hydrateBotsLabTiles(true); hydrateLiveCacheMonitorTiles(true); hydrateCandleCacheTiles(true); }, 10000));
  }
  function runWidgetAction(action, w) {
    const ws = currentWorkspace(), p = pluginById.get(w.pluginId);
    if (["remove", "close"].includes(action)) {
      if (state.preferences.confirmAppRemove && !confirm(`Remove ${p.name} from this workspace?`)) return;
      ws.widgets = ws.widgets.filter((item) => item.id !== w.id);
      clearWidgetRefresh(w.id);
    }
    if (action === "duplicate" && ws.widgets.length < MAX_WIDGETS) {
      const copy = { ...clone(w), id: uid(), x: Math.min(GRID_COLUMNS - w.w, w.x + 1), y: w.y + 1, status: "ready", error: "", minimized: false, maximized: false, restoreBounds: null };
      ws.widgets.push(copy);
    }
    if (action === "minimize") {
      if (!w.minimized) w.restoreBounds = w.restoreBounds || { x: w.x, y: w.y, w: w.w, h: w.h };
      w.minimized = true;
      w.maximized = false;
    }
    if (action === "maximize") {
      if (!w.maximized) w.restoreBounds = { x: w.x, y: w.y, w: w.w, h: w.h };
      Object.assign(w, { x: 0, y: 0, w: 24, h: 28, minimized: false, maximized: true });
    }
    if (action === "restore") {
      const bounds = w.restoreBounds;
      if (bounds && Number.isFinite(Number(bounds.w)) && Number.isFinite(Number(bounds.h))) Object.assign(w, bounds);
      w.minimized = false;
      w.maximized = false;
      w.restoreBounds = null;
    }
    if (["refresh", "retry"].includes(action)) refreshWidget(w);
    if (action === "configure") return openWidgetConfig(w);
    if (action === "export") eventBus.emit("widget_export_requested", { widget_id: w.id, capability: p.id });
    ws.updatedAt = now();
    renderWidgets();
    persistAll();
  }
  function openWidgetConfig(w) { const policy = w.refreshPolicy || { mode: "manual", intervalMs: state.preferences.defaultRefreshInterval * 1000, allowUserOverride: true }; root.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-config-modal><form class="simple-modal" data-widget-config><header><h2>Configure Widget</h2><button type="button" data-close-config>x</button></header><label>Refresh Mode<select name="mode"><option value="manual" ${policy.mode === "manual" ? "selected" : ""}>manual</option><option value="interval" ${policy.mode === "interval" ? "selected" : ""}>interval</option><option value="event" ${policy.mode === "event" ? "selected" : ""}>event</option><option value="stream" ${policy.mode === "stream" ? "selected" : ""}>stream</option></select></label><label>Interval Seconds<input name="interval" type="number" min="5" value="${Math.round((policy.intervalMs || 60000) / 1000)}" /></label><label>Symbol Override<input name="symbol" value="${e(w.config?.symbol || "")}" placeholder="Optional" /></label><footer><button class="secondary" type="button" data-close-config>Cancel</button><button class="primary" type="submit">Save</button></footer></form></div>`); const modal = root.querySelector("[data-config-modal]"); modal.querySelectorAll("[data-close-config]").forEach((b) => b.addEventListener("click", () => modal.remove())); modal.querySelector("[data-widget-config]").addEventListener("submit", (ev) => { ev.preventDefault(); const data = Object.fromEntries(new FormData(ev.target).entries()); w.refreshPolicy = { mode: data.mode, intervalMs: Math.max(5, Number(data.interval || 60)) * 1000, allowUserOverride: true }; w.config = { ...(w.config || {}), symbol: data.symbol }; modal.remove(); scheduleRefreshes(); persistAll(); }); }
  function refreshWidget(w) { w.status = "loading"; renderWidgets(); setTimeout(() => { try { w.status = "ready"; w.error = ""; w.lastRefreshedAt = Date.now(); w.appState = { ...(w.appState || {}), refreshCount: (w.appState?.refreshCount || 0) + 1 }; eventBus.emit("widget_refreshed", { widget_id: w.id, capability: w.pluginId }); } catch (error) { w.status = "error"; w.error = error.message; } renderWidgets(); persistAll(); }, 250); }
  function scheduleRefreshes() { clearRefreshes(); if (!state.preferences.liveRefresh) return; for (const w of currentWorkspace().widgets) if (w.refreshPolicy?.mode === "interval") timers.set(w.id, window.setInterval(() => refreshWidget(w), Math.max(5000, w.refreshPolicy.intervalMs || 60000))); }
  function clearWidgetRefresh(id) { if (timers.has(id)) window.clearInterval(timers.get(id)); timers.delete(id); }
  function clearRefreshes() { for (const timer of timers.values()) window.clearInterval(timer); timers.clear(); }
  function startDrag(ev, w) { ev.preventDefault(); const canvas = root.querySelector("[data-canvas]"), start = pointerState(ev, canvas, w); const move = (nextEvent) => { const next = gridFromPointer(nextEvent, canvas, start, w.w, w.h); if (!collides({ ...w, ...next }, w.id)) Object.assign(w, next); renderWidgets(); }; const up = () => finishPointer(move, up); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); }
  function startResize(ev, w) { ev.preventDefault(); const canvas = root.querySelector("[data-canvas]"), p = pluginById.get(w.pluginId), start = pointerState(ev, canvas, w); const move = (nextEvent) => { const cellWidth = canvas.clientWidth / GRID_COLUMNS; const width = clamp(Math.round((start.pixelW + nextEvent.clientX - start.clientX) / cellWidth), p.min_size.w, GRID_COLUMNS - w.x); const height = clamp(Math.round((start.pixelH + nextEvent.clientY - start.clientY) / ROW_HEIGHT), p.min_size.h, 28); if (!collides({ ...w, w: width, h: height }, w.id)) Object.assign(w, { w: width, h: height }); renderWidgets(); }; const up = () => finishPointer(move, up); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); }
  function pointerState(ev, canvas, w) { const cellWidth = canvas.clientWidth / GRID_COLUMNS; return { clientX: ev.clientX, clientY: ev.clientY, startX: w.x, startY: w.y, pixelW: w.w * cellWidth, pixelH: w.h * ROW_HEIGHT }; }
  function gridFromPointer(ev, canvas, start, w, h) { const cellWidth = canvas.clientWidth / GRID_COLUMNS; return { x: clamp(start.startX + Math.round((ev.clientX - start.clientX) / cellWidth), 0, GRID_COLUMNS - w), y: Math.max(0, start.startY + Math.round((ev.clientY - start.clientY) / ROW_HEIGHT)) }; }
  function finishPointer(move, up) { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); currentWorkspace().updatedAt = now(); persistAll(); }
  function findOpenSlot(w, h) { for (let y = 0; y < 80; y++) for (let x = 0; x <= GRID_COLUMNS - w; x++) if (!collides({ x, y, w, h })) return { x, y }; return { x: 0, y: maxBottom() + 1 }; }
  function collides(c, ignoreId) { return currentWorkspace().widgets.some((w) => w.id !== ignoreId && c.x < w.x + w.w && c.x + c.w > w.x && c.y < w.y + w.h && c.y + c.h > w.y); }
  function maxBottom() { const widgets = currentWorkspace().widgets; return widgets.length ? Math.max(...widgets.map((w) => w.y + w.h), 20) : 20; }
  async function openUserManagement() { const res = await api("/api/users", null, "GET"); if (res.error) return alert(res.error); state.lastUsersPayload = res; root.insertAdjacentHTML("beforeend", userManagementTemplate(res)); bindUserManagement(); }
  function userManagementTemplate(payload, activeTab = "users") { const tabs = ["users", "add", "modify", "remove", "sessions"]; return `<div class="modal-backdrop" data-user-modal><section class="user-modal user-modal-tabs"><header><div><h2>User Management</h2><p>Admin-managed users, subscriptions, and active sessions</p></div><button data-close-users>x</button></header><nav class="modal-tabs">${tabs.map((tab) => `<button class="${tab === activeTab ? "active" : ""}" data-user-tab="${tab}">${titleCase(tab)}</button>`).join("")}</nav><div class="tab-body">${userTabTemplate(payload, activeTab)}</div></section></div>`; }
  function userTabTemplate(payload, tab) { const users = payload.users || []; if (tab === "users") return `<div class="user-table-lite">${users.map(userSummaryRow).join("")}</div>`; if (tab === "add") return userAddForm(); if (tab === "modify") return userModifyForm(users); if (tab === "remove") return userRemoveForm(users); return `<div class="user-table-lite">${(payload.activeSessions || []).map((s) => `<div class="user-summary"><strong>${e(s.username)}</strong><span>${e(s.status)}</span><span>Login ${new Date(s.createdAt).toLocaleString()}</span><span>Seen ${new Date(s.lastSeenAt).toLocaleString()}</span></div>`).join("") || `<p class="muted">No active sessions reported.</p>`}</div>`; }
  function userSummaryRow(u) { return `<div class="user-summary"><strong>${e(u.username)}</strong><span>${e(u.displayName || u.username)}</span><span class="role-badge ${u.role}">${roleLabel(u.role)}</span><span>${e(u.status || "active")}</span><span>${(u.appSubscriptions || []).join(", ")}</span></div>`; }
  function userAddForm() { return `<form class="admin-form" data-create-user><label>Name<input name="displayName" required /></label><label>Username<input name="username" placeholder="Letters and numbers only" required /></label><label>Password<input name="password" type="password" required minlength="10" /></label><label>Role<select name="role" data-role-control>${roleOptions("guest")}</select></label><label>Subscription<select name="subscriptionStatus">${subscriptionOptions("inactive")}</select></label><div class="app-subscription-picker" data-app-subscriptions>${appSubscriptionGroups([], "guest")}</div><button class="primary" type="submit">Add User</button></form>`; }
  function userModifyForm(users, selectedUsername = "") { const editable = users.filter((u) => u.username !== "admin"), u = editable.find((x) => x.username === selectedUsername) || editable[0]; if (!u) return `<p class="muted">No editable users. The default admin is protected.</p>`; return `<form class="admin-form" data-update-user><label>Select User<select name="username" data-modify-select>${editable.map((x) => `<option value="${e(x.username)}" ${x.username === u.username ? "selected" : ""}>${e(x.username)}</option>`).join("")}</select></label><label>Name<input name="displayName" value="${e(u.displayName || "")}" /></label><label>Role<select name="role" data-role-control>${roleOptions(u.role)}</select></label><label>Subscription<select name="subscriptionStatus">${subscriptionOptions(u.subscriptionStatus)}</select></label><label>Status<select name="status"><option value="active" ${u.status === "active" ? "selected" : ""}>active</option><option value="disabled" ${u.status === "disabled" ? "selected" : ""}>disabled</option></select></label><label>Reset Password<input name="password" type="password" placeholder="Optional" /></label><div class="app-subscription-picker" data-app-subscriptions>${appSubscriptionGroups(u.appSubscriptions || [], u.role)}</div><button class="primary" type="submit">Save User</button></form>`; }
  function userRemoveForm(users) { const removable = users.filter((u) => u.username !== "admin"); return `<form class="admin-form" data-remove-user><label>Select User<select name="username">${removable.map((u) => `<option value="${e(u.username)}">${e(u.username)} - ${e(u.displayName || "")}</option>`).join("")}</select></label><p class="muted">Default admin cannot be deleted from this screen.</p><button class="secondary danger-text" type="submit">Remove User</button></form>`; }
  function bindUserManagement() { const modal = root.querySelector("[data-user-modal]"), payload = state.lastUsersPayload || { users: [] }; const renderTab = (tab) => { modal.querySelector(".tab-body").innerHTML = userTabTemplate(payload, tab); modal.querySelectorAll("[data-user-tab]").forEach((b) => b.classList.toggle("active", b.dataset.userTab === tab)); bindUserTabForms(modal); }; modal.querySelectorAll("[data-close-users]").forEach((b) => b.addEventListener("click", () => modal.remove())); modal.querySelectorAll("[data-user-tab]").forEach((b) => b.addEventListener("click", () => renderTab(b.dataset.userTab))); bindUserTabForms(modal); }
  function bindUserTabForms(modal) { modal.querySelectorAll("[data-role-control]").forEach((select) => select.addEventListener("change", () => refreshAppSubscriptionPicker(select.closest("form")))); modal.querySelector("[data-create-user]")?.addEventListener("submit", async (ev) => { ev.preventDefault(); const r = await api("/api/users", userFormData(ev.target)); if (r.error) return alert(r.error); modal.remove(); openUserManagement(); }); modal.querySelector("[data-modify-select]")?.addEventListener("change", (ev) => { modal.querySelector(".tab-body").innerHTML = userModifyForm((state.lastUsersPayload || { users: [] }).users || [], ev.target.value); bindUserTabForms(modal); }); modal.querySelector("[data-update-user]")?.addEventListener("submit", async (ev) => { ev.preventDefault(); const data = userFormData(ev.target), username = data.username; delete data.username; if (!data.password) delete data.password; const r = await api(`/api/users/${encodeURIComponent(username)}`, data, "PATCH"); if (r.error) return alert(r.error); modal.remove(); openUserManagement(); }); modal.querySelector("[data-remove-user]")?.addEventListener("submit", async (ev) => { ev.preventDefault(); const username = new FormData(ev.target).get("username"); if (!username || !confirm(`Remove user ${username}?`)) return; const r = await api(`/api/users/${encodeURIComponent(username)}`, null, "DELETE"); if (r.error) return alert(r.error); modal.remove(); openUserManagement(); }); }
  function refreshAppSubscriptionPicker(form) { const target = form?.querySelector("[data-app-subscriptions]"); if (!target) return; const selected = [...form.querySelectorAll('[name="appSubscriptions"]:checked')].map((option) => option.value); const role = form.querySelector('[name="role"]')?.value || "guest"; target.innerHTML = appSubscriptionGroups(selected, role); }
  function appSubscriptionGroups(selected = [], role = "power_user") { const values = new Set(selected.includes("*") ? capabilityPlugins.map((p) => p.id) : selected); return categories.map((cat) => { const plugins = capabilityPlugins.filter((p) => p.category === cat.id); if (!plugins.length) return ""; return `<fieldset class="app-group"><legend>${cat.label}</legend>${plugins.map((p) => `<label class="app-check"><input type="checkbox" name="appSubscriptions" value="${p.id}" ${values.has(p.id) ? "checked" : ""} ${role === "guest" || role === "admin" ? "disabled" : ""} /><span>${e(p.icon)}</span><strong>${e(p.name)}</strong></label>`).join("")}</fieldset>`; }).join(""); }
  function userFormData(form) { const data = Object.fromEntries(new FormData(form).entries()); data.appSubscriptions = [...form.querySelectorAll('[name="appSubscriptions"]:checked')].map((option) => option.value); return data; }
  function renderProfilePanel(message = "") { const main = root.querySelector("[data-main]"); if (!main) return; main.innerHTML = profileTemplate(message); bindPageActions(main); }
  async function loadProfileTokens() {
    const r = await api("/api/profile/tokens", null, "GET");
    state.profileTokens = r.tokens || {};
    state.tokenMessage = r.error || "";
    if (state.activeView === "profile") renderProfilePanel();
  }
  async function saveProfileTokens(ev) {
    ev.preventDefault();
    const form = ev.target;
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = "Saving..."; }
    const payload = Object.fromEntries(new FormData(form).entries());
    const r = await api("/api/profile/tokens", payload);
    if (r.error) {
      state.tokenMessage = r.error;
      state.tokenEditMode = true;
    } else {
      state.profileTokens = r.tokens || {};
      state.tokenMessage = r.saved?.length ? `Saved ${r.saved.join(", ")} token(s).` : "No changes saved; blank fields keep existing tokens.";
      state.tokenEditMode = false;
    }
    renderProfilePanel();
  }
  async function changePassword(ev) { ev.preventDefault(); const r = await api("/api/auth/change-password", Object.fromEntries(new FormData(ev.target).entries())); const main = root.querySelector("[data-main]"); main.innerHTML = profileTemplate(r.error || "Password updated."); bindPageActions(main); }
  async function logout() { await api("/api/auth/logout", {}); location.reload(); }
  function updateSetting(input) { const key = input.dataset.setting; let value = input.type === "checkbox" ? input.checked : input.value; if (key === "defaultRefreshInterval") value = Number(value); state.preferences[key] = value; root.querySelector(".app-shell").dataset.theme = state.preferences.theme; root.querySelector(".app-shell").dataset.density = state.preferences.density; root.querySelector(".left-rail").dataset.expanded = String(state.preferences.sidebarExpanded); persistPreferences(); scheduleRefreshes(); }
  function selectSetting(key, label, options) { return `<label class="setting-row"><span>${label}</span><select data-setting="${key}">${options.map(([value, text]) => `<option value="${value}" ${String(state.preferences[key]) === String(value) ? "selected" : ""}>${text}</option>`).join("")}</select></label>`; }
  function workspaceSetting(key, label) { return `<label class="setting-row"><span>${label}</span><select data-setting="${key}">${state.workspaces.map((w) => `<option value="${w.id}" ${state.preferences[key] === w.id ? "selected" : ""}>${e(w.name)}</option>`).join("")}</select></label>`; }
  function toggleSetting(key, label) { return `<label class="setting-row switch-row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${state.preferences[key] ? "checked" : ""} /></label>`; }
  function roleOptions(selected = "guest") { return userRoles.map((r) => `<option value="${r}" ${selected === r ? "selected" : ""}>${r}</option>`).join(""); }
  function subscriptionOptions(selected = "inactive") { return subscriptionStatuses.map((s) => `<option value="${s}" ${selected === s ? "selected" : ""}>${s}</option>`).join(""); }
  function persistAll() { sanitizeWorkspaces(); if (!state.preferences.autoSave) return; repository.saveWorkspaces(state.workspaces); repository.saveDashboard(currentWorkspace()); repository.saveLayout(currentWorkspace().widgets.map(({ id, x, y, w, h, minimized }) => ({ id, x, y, w, h, minimized }))); persistPreferences(); const stamp = root.querySelector("[data-save-state]"); if (stamp) stamp.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
  function persistPreferences() { state.preferences.defaultWorkspaceId = state.activeWorkspaceId; repository.savePreferences(state.preferences); repository.saveProfile({ ...state.profile, ...state.preferences, lastWorkspaceId: state.activeWorkspaceId, lastWorkspaceCount: state.workspaces.length }); }
  function renderEventLog() { const target = root.querySelector(".event-feed"); if (target) target.innerHTML = state.eventLog.map((event) => `<p>${e(JSON.stringify(event))}</p>`).join(""); }
  function sanitizeWorkspaces() {
    for (const w of state.workspaces) {
      w.widgets = (w.widgets || []).filter((widget) => pluginById.has(widget.pluginId) && canLaunchApp(widget.pluginId));
      for (const widget of w.widgets) {
        const preferred = preferredWidgetSizes[widget.pluginId];
        if (preferred) Object.assign(widget, { w: Math.max(widget.w || 0, preferred.w), h: Math.max(widget.h || 0, preferred.h) });
      }
      if (["dashboard", "scanner"].includes(w.type) && canLaunchApp("screener")) alignScreenerOnlyWorkspace(w);
      if (w.type === "market" && canLaunchApp("market-monitor")) alignMarketWorkspace(w);
      if (w.type === "signal" && canLaunchApp("signals-cockpit")) alignSignalWorkspace(w);
      if (w.type === "trading" && canLaunchApp("trading-system-monitor")) alignTradingWorkspace(w);
      if (w.type === "risk" && canLaunchApp("risk-cockpit")) alignRiskWorkspace(w);
      if (w.type === "agents" && canLaunchApp("rs-daily-agent")) alignAgentsWorkspace(w);
    }
  }
  function alignScreenerOnlyWorkspace(w) {
    let screenerWidget = w.widgets.find((widget) => widget.pluginId === "screener");
    if (!screenerWidget) screenerWidget = createWidget(pluginById.get("screener"), { x: 0, y: 0 });
    Object.assign(screenerWidget, { x: 0, y: 0, w: 24, h: 30, minimized: false });
    w.widgets = [screenerWidget];
  }
  function alignMarketWorkspace(w) {
    let monitorWidget = w.widgets.find((widget) => widget.pluginId === "market-monitor");
    if (!monitorWidget) {
      monitorWidget = createWidget(pluginById.get("market-monitor"), { x: 0, y: 0 });
      w.widgets.unshift(monitorWidget);
    }
    let cycleWidget = w.widgets.find((widget) => widget.pluginId === "market-cycle-tracker");
    if (!cycleWidget && pluginById.has("market-cycle-tracker") && canLaunchApp("market-cycle-tracker")) {
      cycleWidget = createWidget(pluginById.get("market-cycle-tracker"), { x: 0, y: 31 });
      w.widgets.splice(1, 0, cycleWidget);
    }
    Object.assign(monitorWidget, { x: 0, y: 0, w: 24, h: 30, minimized: false });
    if (cycleWidget) Object.assign(cycleWidget, { x: 0, y: 31, w: 14, h: 18, minimized: false });
    let y = cycleWidget ? 50 : 31;
    for (const widget of w.widgets.filter((item) => item.id !== monitorWidget.id && item.id !== cycleWidget?.id)) {
      if (widget.y < y) widget.y = y;
      y = Math.max(y, widget.y + Math.max(widget.h || 7, 7) + 1);
    }
  }
  function alignSignalWorkspace(w) {
    let signalWidget = w.widgets.find((widget) => widget.pluginId === "signals-cockpit");
    if (!signalWidget) {
      signalWidget = createWidget(pluginById.get("signals-cockpit"), { x: 0, y: 0 });
      w.widgets.unshift(signalWidget);
    }
    Object.assign(signalWidget, { x: 0, y: 0, w: 24, h: 30, minimized: false, maximized: true, restoreBounds: { x: 0, y: 0, w: 24, h: 30 } });
    w.widgets = [signalWidget];
  }
  function alignTradingWorkspace(w) {
    let monitorWidget = w.widgets.find((widget) => widget.pluginId === "trading-system-monitor");
    if (!monitorWidget) {
      monitorWidget = createWidget(pluginById.get("trading-system-monitor"), { x: 0, y: 0 });
      w.widgets.unshift(monitorWidget);
    }
    Object.assign(monitorWidget, { x: 0, y: 0, w: 24, h: 30, minimized: false, maximized: true, restoreBounds: { x: 0, y: 0, w: 24, h: 30 } });
    w.widgets = [monitorWidget];
  }
  function alignRiskWorkspace(w) {
    let riskWidget = w.widgets.find((widget) => widget.pluginId === "risk-cockpit");
    if (!riskWidget) {
      riskWidget = createWidget(pluginById.get("risk-cockpit"), { x: 0, y: 0 });
      w.widgets.unshift(riskWidget);
    }
    Object.assign(riskWidget, { x: 0, y: 0, w: 14, h: 18 });
    let cycleWidget = w.widgets.find((widget) => widget.pluginId === "market-cycle-tracker");
    if (!cycleWidget && pluginById.has("market-cycle-tracker") && canLaunchApp("market-cycle-tracker")) {
      cycleWidget = createWidget(pluginById.get("market-cycle-tracker"), { x: 14, y: 0 });
      w.widgets.splice(1, 0, cycleWidget);
    }
    if (cycleWidget) Object.assign(cycleWidget, { x: 14, y: 0, w: 10, h: 18 });
    let y = cycleWidget ? 19 : 0;
    for (const widget of w.widgets.filter((item) => item.id !== riskWidget.id && item.id !== cycleWidget?.id)) {
      widget.x = 14;
      widget.y = y;
      widget.w = Math.min(Math.max(widget.w || 6, 5), 10);
      y += Math.max(widget.h || 7, 7) + 1;
    }
  }
  function alignAgentsWorkspace(w) {
    const removedAgents = new Set(["daily-report-agent", "reasoning-images-agent"]);
    w.widgets = w.widgets.filter((widget) => !removedAgents.has(widget.pluginId));
    const required = ["rs-daily-agent", "rs-data-monitor-agent", "pipeline-monitor-agent", "rs-ranking-agent"];
    for (const pluginId of required) {
      if (!w.widgets.some((widget) => widget.pluginId === pluginId) && pluginById.has(pluginId) && canLaunchApp(pluginId)) {
        w.widgets.push(createWidget(pluginById.get(pluginId), { x: 0, y: 0 }));
      }
    }
    const agentWidget = w.widgets.find((widget) => widget.pluginId === "rs-daily-agent");
    if (agentWidget) {
      Object.assign(agentWidget, { x: 0, y: 0, w: 14, h: 18 });
    }
    let y = 0;
    let x = 14;
    for (const widget of w.widgets.filter((item) => item.id !== agentWidget?.id)) {
      widget.x = x;
      widget.y = y;
      widget.w = Math.min(Math.max(widget.w || 6, 5), 10);
      y += Math.max(widget.h || 7, 7) + 1;
      if (y > 22) { x = 0; y = 19; }
    }
  }
  function workspaceNameForNav(item) {
    if (item === "Dashboard") return defaultDashboardWorkspace().name;
    if (item === "Marketplace") return "Capability catalog";
    if (["Profile", "Settings", "Help", "Home"].includes(item)) return item;
    return workspaceForType(item.toLowerCase()).name;
  }
  function workspaceOptions() { return `${state.workspaces.map((w) => `<option value="${w.id}" ${w.id === state.activeWorkspaceId ? "selected" : ""}>${e(w.name)}</option>`).join("")}<option value="__create__">+ Create New Workspace</option>`; }
  function toggleDrawer(open) { state.drawerOpen = open; root.querySelector("[data-drawer]").classList.toggle("open", open); }
}

function bootstrapWorkspaces(savedDashboard) { if (savedDashboard?.widgets?.length) return [{ ...normalizeWorkspace(savedDashboard, "dashboard"), id: savedDashboard.id || "dashboard-default", isDefaultDashboard: true }]; return Object.entries(workspaceSeeds).map(([type]) => createWorkspaceModel(`${titleCase(type)} Workspace`, type, seedWidgets(type), type === "dashboard" ? "dashboard-default" : `${type}-workspace`)); }
function createWorkspaceModel(name, type = "custom", widgets = [], id = uid()) { return { id, name, type, typeLabel: titleCase(type), isDefaultDashboard: type === "dashboard", widgets, owner: currentSessionUser().username || "pilot-local-user", access: "owner", createdAt: now(), updatedAt: now() }; }
function normalizeWorkspace(source, type = "dashboard") { return { ...createWorkspaceModel(source.name || "Dashboard Workspace", type, source.widgets || [], source.id || uid()), ...source }; }
function seedWidgets(type) { let x = 0, y = 0; return (workspaceSeeds[type] || ["screener", "watchlist", "market-brief"]).filter((id) => pluginById.has(id) && canLaunchApp(id)).map((pluginId) => { const p = pluginById.get(pluginId), w = createWidget(p, { x, y }); x += p.default_size.w; if (x > 18) { x = 0; y += 12; } return w; }); }
function createWidget(plugin, slot) { return { id: uid(), pluginId: plugin.id, x: slot.x, y: slot.y, w: plugin.default_size.w, h: plugin.default_size.h, linkGroup: "blue", minimized: false, config: {}, appState: {}, refreshPolicy: clone(plugin.default_refresh_policy || { mode: "manual", allowUserOverride: true }), status: "ready", lastRefreshedAt: null }; }
function resolveInitialWorkspace(workspaces, prefs) { return (prefs.autoRestore && workspaces.find((w) => w.id === prefs.defaultWorkspaceId)) || workspaces.find((w) => w.id === prefs.defaultDashboardWorkspaceId) || workspaces[0]; }
function canSeeApp(pluginId) { const u = currentSessionUser(); if (u.role === "admin") return true; if (u.role === "power_user") return (u.appSubscriptions || []).includes(pluginId); return guestAppIds.includes(pluginId); }
function canLaunchApp(pluginId) { const u = currentSessionUser(); if (u.role === "admin") return true; if (u.role === "guest") return guestAppIds.includes(pluginId); if (u.role === "power_user") return u.subscriptionStatus === "active" && (u.appSubscriptions || []).includes(pluginId); return false; }
function appAccessReason(pluginId) { const u = currentSessionUser(); if (u.role === "guest") return guestAppIds.includes(pluginId) ? "Basic guest app" : "Guest access is limited to basic services"; if (u.role === "power_user" && u.subscriptionStatus !== "active") return "Power user subscription is not active"; if (u.role === "power_user" && !(u.appSubscriptions || []).includes(pluginId)) return "Admin must enable this app subscription"; return "Available"; }
function currentSessionUser() { return window.mtmUiSession?.user || { username: "guest", role: "guest", appSubscriptions: guestAppIds }; }
async function api(url, body, method = "POST") { const options = method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }; const res = await fetch(url, options); return res.json(); }
function userStatusLabel(session) { const u = session.user || {}; return `${u.username || "User"} - ${roleLabel(u.role)}${u.role === "power_user" ? ` / ${u.subscriptionStatus || "inactive"}` : ""}`; }
function roleLabel(role) { return userRoles.includes(role) ? role : "guest"; }
function iconFor(item) { return ({ Home: "H", Dashboard: "D", Market: "M", Scanner: "S", Signal: "G", Trading: "T", Risk: "R", Portfolio: "P", Agents: "AI", Marketplace: "+", Profile: "MT", Settings: "*", Help: "?" })[item] || item[0]; }
function avatarText() { return (currentSessionUser().username || "MT").slice(0, 2).toUpperCase(); }
function titleCase(value) { return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function now() { return new Date().toISOString(); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function e(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

















