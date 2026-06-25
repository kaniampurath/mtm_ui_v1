import { spawnSync } from "node:child_process";
const env = { ...process.env, MYSQL_PWD: "Scorpi0n99!" };
const base = "http://127.0.0.1:4173";
function mysql(sql) {
  const child = spawnSync("mysql", ["--ssl=0", "--batch", "--raw", "--skip-column-names", "-utradeuser", "myts"], { input: sql, env, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (child.status) throw new Error(child.stderr || `mysql ${child.status}`);
  return child.stdout.trim();
}
function pct(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback; }
function topGroupsProd(groups, limit, sort2) {
  return Object.entries(groups).map(([name, value]) => ({ name, structural: pct(value?.pct_structural), rs: pct(value?.avg_rs_6m), perf: pct(value?.avg_5d_perf), count: Number(value?.count || 0) }))
    .sort((a, b) => (b.structural - a.structural) || (b[sort2] - a[sort2])).slice(0, limit);
}
function cmp(name, actual, expected, tolerance = 0) {
  const ok = typeof actual === "number" && typeof expected === "number" ? Math.abs(actual - expected) <= tolerance : JSON.stringify(actual) === JSON.stringify(expected);
  return { name, actual, expected, status: ok ? "PASS" : "FAIL" };
}
function names(items) { return items.map((x) => x.name); }
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const tile = await fetch(`${base}/api/market/tile`, { headers: { cookie } }).then((r) => r.json());
const raw = mysql("SELECT regime_date, regime_score, regime_classification, quarterly_signal, daily_signal, extension_state, extension_score, market_metrics, sector_leadership, industry_leadership, leaders, actionable_trades FROM market_dashboard_daily ORDER BY regime_date DESC LIMIT 1");
const [regimeDate, regimeScore, regimeClassification, quarterlySignal, dailySignal, extensionState, extensionScore, marketMetricsRaw, sectorRaw, industryRaw, leadersRaw, tradesRaw] = raw.split("\t");
const metrics = JSON.parse(marketMetricsRaw);
const sectors = JSON.parse(sectorRaw);
const industries = JSON.parse(industryRaw);
const leaders = JSON.parse(leadersRaw);
const trades = JSON.parse(tradesRaw);
const expectedSectors = topGroupsProd(sectors, 5, "rs");
const expectedIndustries = topGroupsProd(industries, 5, "perf");
const checks = [
  cmp("regimeDate", tile.regimeDate, regimeDate),
  cmp("regimeScore", tile.regimeScore, Number(regimeScore)),
  cmp("extensionScore", tile.extensionScore, pct(extensionScore)),
  cmp("participation1d", tile.metrics.participation1d, pct(metrics.pct_positive_1d)),
  cmp("participation5d", tile.metrics.participation5d, pct(metrics.pct_positive_5d)),
  cmp("structuralLeaders", tile.metrics.structuralLeaders, pct(metrics.structural_leaders_pct)),
  cmp("momentumOnly", tile.metrics.momentumOnly, pct(metrics.momentum_only_pct)),
  cmp("medianRs6m", tile.metrics.medianRs6m, pct(metrics.median_rs_6m)),
  cmp("medianRs3m", tile.metrics.medianRs3m, pct(metrics.median_rs_3m)),
  cmp("topSectorNames", names(tile.topSectors), names(expectedSectors)),
  cmp("topIndustryNames", names(tile.topIndustries), names(expectedIndustries)),
  cmp("topSector1Structural", tile.topSectors[0]?.structural, expectedSectors[0]?.structural),
  cmp("topSector1Rs", tile.topSectors[0]?.rs, expectedSectors[0]?.rs),
  cmp("topSector1Perf", tile.topSectors[0]?.perf, expectedSectors[0]?.perf),
  cmp("topIndustry1Structural", tile.topIndustries[0]?.structural, expectedIndustries[0]?.structural),
  cmp("topIndustry1Rs", tile.topIndustries[0]?.rs, expectedIndustries[0]?.rs),
  cmp("topIndustry1Perf", tile.topIndustries[0]?.perf, expectedIndustries[0]?.perf),
  cmp("leaderCountRendered", tile.leaders.length, Math.min(8, (leaders.structural || []).length + (leaders.emerging || []).length)),
  cmp("leader1Symbol", tile.leaders[0]?.stock_symbol, leaders.structural?.[0]?.stock_symbol),
  cmp("leader1Rs", tile.leaders[0]?.rs_val, pct(leaders.structural?.[0]?.rs_val)),
  cmp("leader1Perf", tile.leaders[0]?.perf_5d_pct, pct(leaders.structural?.[0]?.perf_5d_pct)),
  cmp("actionableCountRendered", tile.actionableTrades.length, Math.min(5, trades.length)),
  cmp("actionable1Entry", tile.actionableTrades[0]?.entry_price, pct(trades[0]?.entry_price)),
  cmp("actionable1Mci", tile.actionableTrades[0]?.mci, trades[0]?.mci, 0.000001)
];
console.log(JSON.stringify({ summary: { pass: checks.filter(c => c.status === "PASS").length, fail: checks.filter(c => c.status === "FAIL").length }, checks }, null, 2));
process.exit(checks.some((c) => c.status === "FAIL") ? 1 : 0);