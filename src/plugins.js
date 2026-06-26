export const categories = [
  { id: "core", label: "CORE" }, { id: "visualizations", label: "VISUALIZATIONS" }, { id: "research", label: "RESEARCH" },
  { id: "signals", label: "SIGNALS" }, { id: "trading", label: "TRADING" }, { id: "risk", label: "RISK" }, { id: "ai", label: "AI" }
];
const commonContexts = ["Symbol", "Watchlist", "Portfolio", "Sector", "Industry", "Theme", "Timeframe", "Strategy", "Agent"];
const metric = (label, value, tone = "") => `<div class="metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
const rows = (items) => `<div class="data-rows">${items.map((item) => `<button class="data-row" data-symbol="${item.symbol || "NVDA"}"><span>${item.name}</span><strong>${item.value}</strong></button>`).join("")}</div>`;
function spark(values) {
  const max = Math.max(...values), min = Math.min(...values);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / (max - min || 1)) * 88 - 6}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" /></svg>`;
}
function plugin(id, name, category, icon, render, size = { w: 6, h: 8 }, meta = {}) {
  return {
    id,
    name,
    category,
    version: meta.version || "0.1.0",
    icon,
    description: meta.description || `${name} workspace app for market workflow support.`,
    permissions: meta.permissions || ["pilot:read"],
    refresh_mode: meta.refresh_mode || "manual",
    default_refresh_policy: meta.default_refresh_policy || { mode: "manual", allowUserOverride: true },
    adapter_key: meta.adapter_key || `pilot.${id}`,
    required_role: meta.required_role || "guest",
    default_size: size,
    min_size: meta.min_size || { w: Math.min(5, size.w), h: Math.min(7, size.h) },
    supported_contexts: commonContexts,
    config_schema: meta.config_schema || {},
    render_component: render
  };
}
const basePlugins = [
  plugin("market-cockpit", "Market Cockpit", "core", "MC", () => `<div class="market-cockpit-tile" data-market-cockpit><div class="widget-loading">Loading market cockpit...</div></div>`, { w: 12, h: 16 }, { description: "Embeddable version of the production Market tab with regime, breadth, leadership, and playbook data.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.market_dashboard_daily" }),
  plugin("market-monitor", "Market Monitor", "core", "MM", () => `<div class="market-monitor-tile" data-market-monitor><div class="widget-loading">Loading market monitor...</div></div>`, { w: 24, h: 30 }, { description: "Dense institutional market monitor with breadth, health, sector rotation, indexes, mega caps, leadership, and cached EODHD news.", permissions: ["market:read"], refresh_mode: "cache", adapter_key: "myts.market_monitor.snapshot" }),
  plugin("market-cycle-tracker", "Market Cycle Tracker", "risk", "CY", () => `<div class="market-cycle-tile" data-market-cycle-tracker><div class="widget-loading">Loading market cycle...</div></div>`, { w: 14, h: 18 }, { description: "Bear/bull cycle tracker with index ETF allocation guidance, distribution pressure, leadership confirmation, follow-through days, signal charts, and backtest evidence.", permissions: ["market:read", "risk:read"], refresh_mode: "manual", adapter_key: "myts.market_cycle.tracker", min_size: { w: 10, h: 12 } }),
  plugin("signals-cockpit", "Signals Cockpit", "signals", "SG", () => `<div class="signals-cockpit-tile" data-signals-cockpit><div class="widget-loading">Loading signals...</div></div>`, { w: 24, h: 30 }, { description: "Production Signals tab with source-truth strategy rows, durable snapshots, open signals, regime permission, and closed outcomes.", permissions: ["signals:read"], refresh_mode: "manual", adapter_key: "myts.signals" }),
  plugin("sector-cockpit", "Sector Cockpit", "research", "SC", () => `<div class="group-cockpit-tile" data-group-cockpit="sector"><div class="widget-loading">Loading sectors...</div></div>`, { w: 10, h: 15 }, { description: "Embeddable production sector leadership cockpit with priority, RS, structural participation, and momentum.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.market_dashboard_daily.sectors" }),
  plugin("industry-cockpit", "Industry Cockpit", "research", "IC", () => `<div class="group-cockpit-tile" data-group-cockpit="industry"><div class="widget-loading">Loading industries...</div></div>`, { w: 10, h: 15 }, { description: "Embeddable production industry leadership cockpit with decision matrix and hunting-ground ranking.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.market_dashboard_daily.industries" }),
  plugin("leaders-cockpit", "Leaders Cockpit", "research", "LC", () => `<div class="leaders-cockpit-tile" data-leaders-cockpit><div class="widget-loading">Loading leaders...</div></div>`, { w: 12, h: 16 }, { description: "Embeddable production Leaders tab showing latest RS candidates ranked by 3M and 6M relative strength.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.rs_daily.leaders" }),
  plugin("mark-minervini-screen", "Mark Minervini Screen", "research", "MM", () => `<div class="minervini-screen-tile" data-minervini-screen><div class="widget-loading">Loading Mark Minervini Screen...</div></div>`, { w: 24, h: 30 }, { description: "Full-screen RS250 leadership classifier combining SEC fundamentals, trend template, Code 3 acceleration, extension, and turnaround context.", permissions: ["market:read", "fundamentals:read"], refresh_mode: "cache", adapter_key: "mtm.sec_leadership.screen", min_size: { w: 18, h: 22 } }),
  plugin("risk-cockpit", "Risk Cockpit", "risk", "RK", () => `<div class="risk-cockpit-tile" data-risk-cockpit><div class="widget-loading">Loading risk model...</div></div>`, { w: 14, h: 18 }, { description: "Production Risk screen with persisted sizing controls, portfolio capacity, buy permission, sell rules, stop ladder, and open position risk.", permissions: ["risk:read", "risk:write"], refresh_mode: "manual", adapter_key: "myts.risk_model" }),
  plugin("screener", "Screener", "core", "S", () => `<div class="screener-tile" data-screener-tile><div class="widget-loading">Loading cached screener...</div></div>`, { w: 24, h: 30 }, { description: "Redis-backed rs_daily screener using the last 260 business days grouped by symbol for flexible indicator filters.", permissions: ["market:read"], refresh_mode: "cache", adapter_key: "mtm.daily_rs_cache.screener" }),
  plugin("heat-map", "Heat Map", "visualizations", "H", ({ context }) => `<div class="heatmap">${["NVDA", "AVGO", "AMD", "MSFT", "META", "TSLA", "PANW", "NOW", "SNOW", "SHOP", "ANET", "ARM"].map((s, i) => `<button class="heat-tile ${s === context.symbol ? "selected" : ""}" data-symbol="${s}" style="--heat:${(i % 5) + 1}"><b>${s}</b><span>${i % 3 === 0 ? "+" : ""}${(2.7 - i * 0.28).toFixed(1)}%</span></button>`).join("")}</div>`, { w: 8, h: 12 }),
  plugin("industry-ranks", "Industry Ranks", "research", "R", ({ context }) => `${metric("Selected Industry", context.industry)}${rows([{ name: "Semiconductors", value: "98" }, { name: "Software Infra", value: "93" }, { name: "Cybersecurity", value: "88" }, { name: "Medical Systems", value: "81" }])}`, { w: 7, h: 10 }),
  plugin("market-breadth", "Market Breadth", "research", "B", () => `<div class="metric-grid">${metric("Advancers", "61%", "good")}${metric("New Highs", "142")}${metric("Above 50DMA", "54%")}${metric("Distribution", "2", "warn")}</div>${spark([21, 28, 24, 32, 35, 31, 39, 43, 40, 47, 52, 49])}`, { w: 7, h: 10 }),
  plugin("market-brief", "Market Brief", "research", "M", ({ context }) => `<div class="brief"><h4>${context.theme}</h4><p>Leadership remains concentrated in liquid growth names. ${context.symbol} is holding relative strength while breadth improves selectively.</p><p>Watch for continuation above prior pivot with volume confirmation.</p></div>`, { w: 8, h: 9 }),
  plugin("stage-analysis", "Stage Analysis", "research", "A", ({ context }) => `${metric(context.symbol, "Stage 2", "good")}<div class="stage-bars"><span style="--w:22%">Base</span><span style="--w:74%">Markup</span><span style="--w:36%">Risk</span></div>${spark([18, 22, 24, 30, 33, 37, 42, 45, 51, 58, 61, 68])}`, { w: 8, h: 10 }),
  plugin("chart", "Chart", "core", "C", ({ context }) => `<div class="placeholder">Chart surface for ${context.symbol}</div>${spark([12, 18, 15, 22, 25, 21, 33, 30, 41, 45, 43, 52])}`, { w: 10, h: 12 }),
  plugin("watchlist", "Watchlist", "core", "W", () => `<div class="watchlist-tile" data-watchlist-tile><div class="widget-loading">Loading watchlist...</div></div>`, { w: 8, h: 11 }, { description: "Cache-backed watchlist with latest DB price, change, RS, and ticker coloring.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.rs_daily.watchlist" }),
  plugin("trading-system-monitor", "Trading System Monitor", "trading", "TS", () => `<div class="trading-system-monitor-tile" data-trading-system-monitor><div class="widget-loading">Loading trading system monitor...</div></div>`, { w: 24, h: 30 }, { description: "Ported performance monitor with RS Leadership backtest, live trade KPIs, production guardrail, system journal, and restart-safe backtest queue.", permissions: ["market:read", "trading:read"], refresh_mode: "manual", adapter_key: "myts.web_performance_tables", min_size: { w: 18, h: 22 } }),
  plugin("rs-daily-agent", "RS Daily Agent", "ai", "RD", () => `<div class="rs-agent-tile" data-rs-agent><div class="widget-loading">Loading RS Daily agent...</div></div>`, { w: 14, h: 18 }, { description: "Controlled EODHD rs_daily download agent with start controls, progress monitor, events, and failures.", permissions: ["market:write"], refresh_mode: "manual", adapter_key: "myts.rs_daily.eodhd_agent" }),
  plugin("pipeline-monitor-agent", "Pipeline Monitor", "ai", "PM", () => `<div class="pipeline-agent-tile" data-pipeline-agent><div class="widget-loading">Loading pipeline monitor...</div></div>`, { w: 12, h: 16 }, { description: "Pipeline DAG monitor with business-day gate, data quality, task status, and downstream refresh controls.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.pipeline.monitor" }),
  plugin("rs-data-monitor-agent", "RS Data Monitor", "ai", "DQ", () => `<div class="rs-data-monitor-tile" data-rs-data-monitor><div class="widget-loading">Loading RS data monitor...</div></div>`, { w: 14, h: 18 }, { description: "Observability for rs_daily coverage, OHLC/volume gaps, duplicates, and targeted EODHD reload actions.", permissions: ["market:write"], refresh_mode: "manual", adapter_key: "myts.rs_daily.observability" }),
  plugin("rs-ranking-agent", "RS Ranking Agent", "ai", "RR", () => `<div class="rs-ranking-tile" data-rs-ranking-agent><div class="widget-loading">Loading RS ranking...</div></div>`, { w: 12, h: 16 }, { description: "Slice and dice RS leaders above configurable RS thresholds by sector or industry.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.rs_daily.rs_ranking" }),
  plugin("bots-lab", "Bots Lab", "ai", "BL", () => `<div class="bots-lab-tile" data-bots-lab><div class="widget-loading">Loading bot catalog...</div></div>`, { w: 12, h: 16 }, { description: "Scoped research and orchestration bot catalog using MTM workspace permissions and guarded execution states.", permissions: ["market:read"], refresh_mode: "cache", adapter_key: "mtm.bot_catalog" }),
  plugin("live-cache-monitor", "Live Cache Monitor", "ai", "LC", () => `<div class="live-cache-tile" data-live-cache-monitor><div class="widget-loading">Connecting live cache monitor...</div></div>`, { w: 10, h: 12 }, { description: "Server-Sent Events monitor for live workspace, cache, RS Daily, pipeline, and signal events with polling fallback.", permissions: ["market:read"], refresh_mode: "stream", adapter_key: "mtm.live.events" }),
  plugin("candle-cache", "Candle Cache", "core", "CC", () => `<div class="candle-cache-tile" data-candle-cache><div class="widget-loading">Loading candle cache...</div></div>`, { w: 12, h: 16 }, { description: "Reusable 1D rs_daily candle cache with SMA20, SMA50, average volume, and price-vs-average indicators.", permissions: ["market:read"], refresh_mode: "cache", adapter_key: "mtm.candle_cache" }),
  plugin("daily-report-agent", "Daily Report Agent", "ai", "DR", () => `<div class="daily-report-tile" data-daily-report-agent><div class="widget-loading">Loading daily report...</div></div>`, { w: 12, h: 15 }, { description: "Daily market report agent sourced from production dashboard/report output.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.market_report" }),
  plugin("reasoning-images-agent", "Reasoning + Images", "ai", "RI", () => `<div class="reasoning-images-tile" data-reasoning-images-agent><div class="widget-loading">Loading reasoning/image status...</div></div>`, { w: 10, h: 12 }, { description: "Optional downstream reasoning and TradingView image pipeline status.", permissions: ["market:read"], refresh_mode: "manual", adapter_key: "myts.pipeline.reasoning_images" }),
  plugin("alerts", "Alerts", "core", "!", () => rows([{ name: "Breakout volume", value: "Armed" }, { name: "RS new high", value: "On" }])),
  plugin("agent-console", "Agent Console", "ai", "AI", () => `<div class="event-feed"><p>{ "event_type": "pattern_detected", "pattern": "VCP", "confidence": 0.91 }</p><p>{ "event_type": "symbol_selected", "symbol": "NVDA" }</p></div>`, { w: 8, h: 10 })
];
const extraNames = [
  ["performance-chart", "Performance Chart", "visualizations"], ["bubble-chart", "Bubble Chart", "visualizations"], ["rrg-chart", "RRG Chart", "visualizations"], ["mini-chart", "Mini Chart", "visualizations"],
  ["data-panel", "Data Panel", "research"], ["theme-tracker", "Theme Tracker", "research"], ["reports", "Reports", "research"], ["mtm-terminal", "MTM Terminal", "research"],
  ["signal-flow", "Signal Flow", "signals"], ["pattern-detection", "Pattern Detection", "signals"], ["entry-confirmation", "Entry Confirmation", "signals"], ["alert-center", "Alert Center", "signals"],
  ["order-blotter", "Order Blotter", "trading"], ["live-trading", "Live Trading", "trading"], ["position-monitor", "Position Monitor", "trading"],
  ["exposure-monitor", "Exposure Monitor", "risk"], ["drawdown-monitor", "Drawdown Monitor", "risk"],
  ["pattern-agent", "Pattern Agent", "ai"], ["research-agent", "Research Agent", "ai"], ["signal-agent", "Signal Agent", "ai"], ["risk-agent", "Risk Agent", "ai"]
];
const extraPlugins = extraNames.map(([id, name, category]) => {
  const icon = name.split(" ").map((x) => x[0]).join("").slice(0, 2);
  return plugin(id, name, category, icon, ({ context }) => `<div class="placeholder">${name} listens to ${context.symbol} on the ${context.timeframe} context.</div>`);
});
export const capabilityPlugins = [...basePlugins, ...extraPlugins];





