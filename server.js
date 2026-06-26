import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const config = await loadConfig();
const port = Number(process.env.PORT || config.server?.port || 4173);
const host = process.env.HOST || config.server?.host || "127.0.0.1";
const dbUser = process.env.MTM_DB_USER || config.database?.user || "tradeuser";
const dbName = process.env.MTM_DB_NAME || config.database?.name || "myts";
const dbPassword = process.env.MTM_DB_PASSWORD || process.env.MYSQL_PWD;
const mysqlPath = process.env.MTM_MYSQL_CLIENT || config.database?.client || "mysql";
const pythonPath = process.env.MTM_PYTHON || config.python?.client || "python";
const dailyRsCacheDays = clamp(Number(process.env.MTM_DAILY_RS_CACHE_DAYS || config.cache?.dailyRsDays || 260), 20, 260);
const dailyRsCacheTtlSeconds = clamp(Number(process.env.MTM_DAILY_RS_CACHE_TTL_SECONDS || config.cache?.dailyRsTtlSeconds || 21600), 300, 86400);
const redisUrl = process.env.MTM_REDIS_URL || process.env.REDIS_URL || config.cache?.redisUrl || config.redis?.url || "redis://127.0.0.1:6379/0";
const redisEnabled = String(process.env.MTM_REDIS_ENABLED ?? config.cache?.redisEnabled ?? "true") !== "false";
const rsDailyShardScript = path.join(root, "scripts", "run_rs_daily_shard.py");
const dbStateTable = process.env.MTM_DB_STATE_TABLE || config.database?.stateTable || "mtm_ui_workspace_state";
const dbSecretsTable = process.env.MTM_DB_SECRETS_TABLE || config.database?.secretsTable || "mtm_ui_user_secrets";
const useSsl = String(process.env.MTM_DB_SSL ?? config.database?.ssl ?? "false") === "true";
const eodhdApiToken = configuredSecret(process.env.MTM_EODHD_API_TOKEN || process.env.EODHD_API_TOKEN || config.eodhd?.apiToken);
const openaiApiToken = configuredSecret(process.env.OPENAI_API_KEY || process.env.MTM_OPENAI_API_KEY || config.openai?.apiKey);
const openaiModel = process.env.OPENAI_MODEL || process.env.MTM_OPENAI_MODEL || config.openai?.model || "gpt-5.2";
const eodhdNewsBaseUrl = process.env.EODHD_NEWS_BASE_URL || config.eodhd?.newsBaseUrl || "https://eodhd.com/api/news";
const marketNewsDefaultSymbols = String(process.env.MARKET_NEWS_DEFAULT_SYMBOLS || config.marketNews?.defaultSymbols || "SPY.US,QQQ.US,IWM.US").split(",").map((item) => item.trim()).filter(Boolean);
const marketNewsLimit = clamp(Number(process.env.MARKET_NEWS_LIMIT || config.marketNews?.limit || 10), 1, 50);
const marketNewsMaxLlmArticles = clamp(Number(process.env.MARKET_NEWS_MAX_LLM_ARTICLES || config.marketNews?.maxLlmArticles || 25), 1, 50);
const secUserAgent = process.env.SEC_USER_AGENT || process.env.MTM_SEC_USER_AGENT || config.sec?.userAgent || "Johnson Kaniampurath johnson.kc@gmail.com";
const secRefreshLimit = clamp(Number(process.env.MTM_SEC_REFRESH_LIMIT || config.sec?.refreshLimit || 250), 5, 250);
const secRequestDelayMs = clamp(Number(process.env.MTM_SEC_REQUEST_DELAY_MS || config.sec?.requestDelayMs || 130), 100, 5000);
const secResultsTable = process.env.MTM_SEC_RESULTS_TABLE || config.sec?.resultsTable || "mtm_ui_sec_leadership_results";
const secJobsTable = process.env.MTM_SEC_JOBS_TABLE || config.sec?.jobsTable || "mtm_ui_sec_leadership_jobs";
const secCikTable = process.env.MTM_SEC_CIK_TABLE || config.sec?.cikTable || "mtm_ui_sec_company_cik";
const marketCycleOutputRoot = path.resolve(root, process.env.MTM_MARKET_CYCLE_OUTPUT_ROOT || config.marketCycle?.outputRoot || path.join("bear_market_analysis", "output"));
const marketCycleTrackerDir = process.env.MTM_MARKET_CYCLE_TRACKER_DIR || config.marketCycle?.trackerDir || "bear_cycle_tracker";
const marketCycleBacktestDir = process.env.MTM_MARKET_CYCLE_BACKTEST_DIR || config.marketCycle?.backtestDir || "index_cycle_backtest";
const tokenEncryptionSecret = configuredSecret(process.env.MTM_TOKEN_ENCRYPTION_KEY || process.env.MTM_SECRET_KEY || config.security?.tokenEncryptionKey || dbPassword || "");
const adminUsername = process.env.MTM_ADMIN_USERNAME || config.auth?.adminUsername || "admin";
const bootstrapPasswordEnv = config.auth?.defaultAdminPasswordEnv || "MTM_DEFAULT_ADMIN_PASSWORD";
const minPasswordLength = Number(config.auth?.minPasswordLength || 10);
const forcePasswordChangeOnFirstLogin = config.auth?.forcePasswordChangeOnFirstLogin !== false;
const sessions = new Map();
const signalLiveCache = new Map();
const liveEventClients = new Set();
let liveEventSequence = 0;
let signalLiveCacheMeta = { captured: 0, symbols: 0, refreshedAt: null };
let signalSnapshotRefreshRunning = false;
let dailyRsCacheMemory = null;
let dailyRsCacheMeta = { store: "none", status: "cold", lastBuiltAt: null, lastError: null, warming: false, warmReason: null, warmStartedAt: null, warmFinishedAt: null };
let dailyRsCacheWarmPromise = null;
let rsDailyLoadPlanCache = null;
let marketBusinessDayStatusCache = null;
let marketMonitorSnapshotCache = null;
let marketHierarchyCache = null;
const marketCycleSnapshotCache = new Map();
const marketNewsCache = new Map();
const marketMonitorInferencePromptContract = {
  version: "market_monitor_inference_v1",
  cachePrefix: "mmi",
  anomalyChecks: [
    "Identify any leadership concentration risk where the top RS score is more than 2x the second-highest RS score. Name the symbol and explain why it reduces confidence.",
    "If regime_box.rs_leaders, regime_box.breakouts, and regime_box.breakdowns are all null, explicitly state that confirmed regime leadership and breakout/breakdown confirmation are unavailable.",
    "Identify any index or ETF volume_ratio_50 below 0.50 or above 2.50 as a data-quality or unusual-participation condition. Name the symbol.",
    "Identify any non-common-stock, leveraged, synthetic, crypto-linked, inverse, long/short, or ETF-like instrument appearing in leaders or laggards. Treat it as universe contamination unless the universe explicitly includes those products.",
    "Data-quality notes must include every triggered anomaly check.",
    "Confidence must be reduced when data-quality anomalies affect leadership, regime confirmation, or universe purity."
  ],
  outputSchema: {
    regime: "RISK_ON | NEUTRAL | CAUTIOUS | RISK_OFF",
    confidence: 0,
    summary: "",
    bullish_evidence: [],
    bearish_evidence: [],
    divergences: [],
    leadership_read: "",
    sector_rotation_read: "",
    risk_actions: [],
    watch_conditions: [],
    data_quality_notes: [],
    anomaly_flags: [{
      severity: "info | warning | critical",
      type: "LEADERSHIP_CONCENTRATION | REGIME_CONFIRMATION_MISSING | VOLUME_ANOMALY | UNIVERSE_CONTAMINATION | TAXONOMY_WARNING | MISSING_DATA",
      symbol: "",
      message: ""
    }]
  }
};
const rsDailyAgent = { running: false, job: null };
const pipelineAgent = { running: false, job: null };
const rsDailyMonitorAgent = { running: false, job: null, last: null };
const secLeadershipAgent = { running: false, job: null };
const botCatalog = [
  { id: "crypto-research", name: "Crypto Research", bucket: "Research", status: "ready", risk: "high", permissions: ["market:read"], description: "Crypto and token-linked market research queue. Uses market regime as a gating input before any trade workflow." },
  { id: "superbot", name: "Superbot", bucket: "Orchestration", status: "guarded", risk: "high", permissions: ["market:read", "trading:read", "risk:read"], description: "Cross-screen orchestration bot for market, sector, industry, signal, trading, and risk context. Execution remains manual/guarded." },
  { id: "bear-market-research", name: "Bear Market Research", bucket: "Risk", status: "ready", risk: "medium", permissions: ["market:read", "risk:read"], description: "Research bot focused on distribution, breadth damage, leadership failure, and defensive regime playbooks." },
  { id: "strategy-creation", name: "Strategy Creation", bucket: "Strategy", status: "draft", risk: "medium", permissions: ["market:read", "trading:read"], description: "Strategy design workspace for universe, entry, exit, stop, sizing, regime filter, and backtest assumptions." }
];
const rsDailyShardRanges = [
  ["A", "B"], ["C", "D"], ["E", "G"], ["H", "L"],
  ["M", "O"], ["P", "R"], ["S", "T"], ["U", "Z"]
];
const validRoles = new Set(["admin", "power_user", "guest"]);
const validSubscriptionStatuses = new Set(["active", "inactive", "trial", "expired"]);
const guestAppIds = ["screener", "watchlist", "market-brief", "market-cockpit", "market-monitor", "market-cycle-tracker", "sector-cockpit", "industry-cockpit", "leaders-cockpit"];
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"]
]);

async function loadConfig() {
  const configPath = process.env.MTM_UI_CONFIG || path.join(root, "config", "mtm-ui.config.json");
  try { return JSON.parse(await readFile(configPath, "utf8")); } catch { return {}; }
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

async function mysqlJson(sql) {
  if (!dbPassword) throw new Error("MTM_DB_PASSWORD is required for DB persistence.");
  const env = { ...process.env, MYSQL_PWD: dbPassword };
  const args = [useSsl ? "--ssl=1" : "--ssl=0", "--batch", "--raw", "--skip-column-names", `-u${dbUser}`, dbName];
  return new Promise((resolve, reject) => {
    const child = spawn(mysqlPath, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) reject(new Error(stderr.trim() || `mysql exited with ${code}`));
      else resolve(stdout.trim());
    });
    child.stdin.end(sql);
  });
}

function sqlString(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlDateTime(value) {
  if (!value) return "NULL";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NULL";
  return sqlString(date.toISOString().slice(0, 19).replace("T", " "));
}

async function ensureSecretsTable() {
  await mysqlJson(`
    CREATE TABLE IF NOT EXISTS ${dbSecretsTable} (
      user_id VARCHAR(128) NOT NULL,
      provider VARCHAR(32) NOT NULL,
      encrypted_value TEXT NOT NULL,
      token_hint VARCHAR(16) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, provider)
    )
  `);
}

async function readDbState(user, name) {
  const sql = `SELECT state_json FROM ${dbStateTable} WHERE user_id=${sqlString(user)} AND state_name=${sqlString(name)} LIMIT 1`;
  const raw = await mysqlJson(sql);
  return raw ? JSON.parse(raw) : null;
}

async function writeDbState(user, name, value) {
  const payload = JSON.stringify(value);
  const sql = `INSERT INTO ${dbStateTable} (user_id, state_name, state_json) VALUES (${sqlString(user)}, ${sqlString(name)}, ${sqlString(payload)}) ON DUPLICATE KEY UPDATE state_json=VALUES(state_json), updated_at=CURRENT_TIMESTAMP`;
  await mysqlJson(sql);
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.passwordSalt).hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function emitLiveEvent(type, payload = {}) {
  const event = { id: ++liveEventSequence, type, at: new Date().toISOString(), payload };
  const wire = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of [...liveEventClients]) {
    try { client.write(wire); } catch { liveEventClients.delete(client); }
  }
  return event;
}

function liveEventSnapshot(session) {
  return {
    source: "mtm.live.events",
    connected: liveEventClients.size,
    sequence: liveEventSequence,
    user: session.user.username,
    serverTime: new Date().toISOString(),
    streams: ["heartbeat", "workspace", "market_cache", "rs_daily", "signals", "bots"]
  };
}
function publicUser(user) {
  const { passwordHash, passwordSalt, ...safe } = user;
  return { ...safe, appSubscriptions: appSubscriptionsFor(user), permissions: permissionsFor(user) };
}

function appSubscriptionsFor(user) {
  if (user.role === "admin") return ["*"];
  if (user.role === "guest") return guestAppIds;
  return Array.isArray(user.appSubscriptions) ? user.appSubscriptions : [];
}

function permissionsFor(user) {
  if (user.role === "admin") return ["workspace:read", "workspace:write", "users:manage", "capabilities:all"];
  if (user.role === "power_user" && user.subscriptionStatus === "active") return ["workspace:read", "workspace:write", "capabilities:subscribed"];
  return ["workspace:read", "capabilities:basic"];
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function configuredSecret(value) {
  const text = String(value || "").trim();
  return text && !text.startsWith("CHANGE_ME") ? text : "";
}

function encryptionKey() {
  if (!tokenEncryptionSecret) throw new Error("MTM_TOKEN_ENCRYPTION_KEY or MTM_SECRET_KEY is required for encrypted profile tokens.");
  return createHash("sha256").update(tokenEncryptionSecret, "utf8").digest();
}

function encryptSecret(value) {
  const text = configuredSecret(value);
  if (!text) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
}

function decryptSecret(payload) {
  if (!payload) return "";
  const box = JSON.parse(payload);
  if (box?.alg !== "aes-256-gcm") throw new Error("Unsupported token encryption format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8");
}

function tokenHint(value) {
  const text = configuredSecret(value);
  return text ? text.slice(-4) : "";
}

function secretStatus(provider, row, envToken = "") {
  const env = configuredSecret(envToken);
  if (row?.token_hint) return { provider, configured: true, source: "profile_db", masked: `â€¢â€¢â€¢â€¢${row.token_hint}`, updatedAt: row.updated_at || null, editable: false };
  if (env) return { provider, configured: true, source: "environment", masked: `â€¢â€¢â€¢â€¢${tokenHint(env)}`, updatedAt: null, editable: false };
  return { provider, configured: false, source: "none", masked: "", updatedAt: null, editable: false };
}

async function userSecretRows(userId) {
  await ensureSecretsTable();
  const raw = await mysqlJson(`SELECT provider, encrypted_value, token_hint, updated_at FROM ${dbSecretsTable} WHERE user_id=${sqlString(userId)} AND provider IN ('eodhd','openai')`);
  const map = new Map();
  if (raw) {
    for (const line of raw.split("\n").filter(Boolean)) {
      const [provider, encrypted_value, token_hint, updated_at] = line.split("\t");
      map.set(provider, { provider, encrypted_value, token_hint, updated_at });
    }
  }
  return map;
}

async function profileTokenStatus(userId) {
  const rows = await userSecretRows(userId);
  return {
    eodhd: secretStatus("eodhd", rows.get("eodhd"), eodhdApiToken),
    openai: secretStatus("openai", rows.get("openai"), openaiApiToken)
  };
}

async function saveProfileTokens(userId, body = {}) {
  await ensureSecretsTable();
  const providers = [
    ["eodhd", body.eodhdToken],
    ["openai", body.openaiToken]
  ];
  const saved = [];
  for (const [provider, rawValue] of providers) {
    const value = configuredSecret(rawValue);
    if (!value) continue;
    const encrypted = encryptSecret(value);
    await mysqlJson(`INSERT INTO ${dbSecretsTable} (user_id, provider, encrypted_value, token_hint) VALUES (${sqlString(userId)}, ${sqlString(provider)}, ${sqlString(encrypted)}, ${sqlString(tokenHint(value))}) ON DUPLICATE KEY UPDATE encrypted_value=VALUES(encrypted_value), token_hint=VALUES(token_hint), updated_at=CURRENT_TIMESTAMP`);
    saved.push(provider);
  }
  return { ok: true, saved, tokens: await profileTokenStatus(userId) };
}

async function resolveUserSecret(userId, provider) {
  const rows = await userSecretRows(userId);
  const row = rows.get(provider);
  if (!row?.encrypted_value) return "";
  return configuredSecret(decryptSecret(row.encrypted_value));
}

async function effectiveEodhdToken(userId = adminUsername) {
  return configuredSecret(await resolveUserSecret(userId, "eodhd")) || eodhdApiToken;
}

async function effectiveOpenaiToken(userId = adminUsername) {
  return configuredSecret(await resolveUserSecret(userId, "openai")) || openaiApiToken;
}

function pct(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
}

function toneForSignal(signal) {
  const value = String(signal || "").toLowerCase();
  if (value === "green" || value === "risk-on") return "good";
  if (value === "red" || value === "defensive") return "bad";
  return "neutral";
}

function topGroups(groups = {}, limit = 5, secondary = "avg_rs_6m") {
  return Object.entries(groups).map(([name, value]) => ({
    name,
    structural: pct(value?.pct_structural),
    rs: pct(value?.avg_rs_6m),
    perf: pct(value?.avg_5d_perf),
    count: Number(value?.count || 0),
    secondary: pct(value?.[secondary])
  })).sort((a, b) => (b.structural - a.structural) || (b.secondary - a.secondary)).slice(0, limit);
}

function extractFinalSynthesis(summary = "") {
  const match = String(summary || "").match(/## 11\. Final Synthesis\s+([\s\S]*?)(\n## |$)/);
  return match ? match[1].trim().replace(/\n+/g, " ").slice(0, 700) : String(summary || "").slice(0, 700);
}

function groupDecision(item) {
  if (item.structural >= 50 && item.rs >= 115 && item.perf > 0) return { label: "Hunt aggressively", tone: "good", text: "Broad leadership with positive momentum. Best place to build watchlists and look for tight continuation setups." };
  if (item.structural >= 35 && item.rs >= 105) return { label: "Core watchlist", tone: "good", text: "Strong relative strength with enough structural participation. Favor clean bases, pullbacks, and leaders holding pivots." };
  if (item.rs >= 110 && item.perf <= 0) return { label: "Pullback watch", tone: "neutral", text: "RS remains strong but short-term pressure is present. Wait for stabilization before adding exposure." };
  if (item.perf > 3 && item.structural < 20) return { label: "Tactical only", tone: "neutral", text: "Momentum is improving but leadership depth is thin. Use smaller size and demand confirmation." };
  return { label: "Avoid laggards", tone: "bad", text: "Weak leadership profile. Keep it low priority unless RS and participation improve." };
}

function groupRows(groupData = {}) {
  return Object.entries(groupData).map(([name, value]) => {
    const item = {
      name,
      count: Number(value?.count || 0),
      structural: pct(value?.pct_structural),
      rs: pct(value?.avg_rs_6m),
      rs3: pct(value?.avg_rs_3m),
      perf: pct(value?.avg_5d_perf)
    };
    item.leadershipWidth = Math.max(0, Math.min(100, item.structural));
    item.rsWidth = Math.max(0, Math.min(100, (item.rs - 60) / 1.8));
    item.momentumWidth = Math.max(0, Math.min(100, 50 + item.perf * 7));
    item.decision = groupDecision(item);
    return item;
  }).sort((a, b) => (b.structural - a.structural) || (b.rs - a.rs) || (b.perf - a.perf));
}

async function leadersTileModel(limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const latestDate = await latestRsDailyDate();
  const raw = latestDate ? await mysqlJson(`SELECT stock_symbol, sector, industry, close, volume, rs_val, rs_val_3m, mci, perf_5d_pct FROM rs_daily WHERE sdate = ${sqlString(latestDate)} AND close > 12 AND volume > 100000 ORDER BY rs_val_3m DESC, rs_val DESC LIMIT ${safeLimit}`) : "";
  const leaders = raw ? raw.split("\n").filter(Boolean).map((line) => {
    const [stock_symbol, sector, industry, close, volume, rs_val, rs_val_3m, mci, perf_5d_pct] = line.split("\t");
    return {
      stock_symbol,
      sector: sector || "Unknown",
      industry: industry || "Unknown",
      close: pct(close),
      volume: Number(volume || 0),
      rs_val: pct(rs_val),
      rs_val_3m: pct(rs_val_3m),
      mci: pct(mci),
      perf_5d_pct: pct(perf_5d_pct)
    };
  }) : [];
  return {
    source: "myts.golden_business_date.latest_rs_symbols",
    latestDate,
    count: leaders.length,
    leaders,
    topSectors: topLeaderBuckets(leaders, "sector"),
    topIndustries: topLeaderBuckets(leaders, "industry")
  };
}

async function watchlistTileModel(symbols = "") {
  const requested = String(symbols || "NVDA,LLY,AEHR,UNH,AAPL,MSFT")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase().replace(".US", ""))
    .filter(Boolean)
    .slice(0, 20);
  const unique = [...new Set(requested)];
  if (!unique.length) return { source: "myts.rs_daily.watchlist", latestDate: null, items: [] };
  const latestDate = await latestRsDailyDate();
  if (!latestDate) return { source: "myts.golden_business_date.watchlist", latestDate: null, items: [] };
  const quoted = unique.map(sqlString).join(",");
  const raw = await mysqlJson(`
    SELECT stock_symbol, close, perf_5d_pct, rs_val, rs_val_3m, mci, sector, industry
    FROM rs_daily
    WHERE sdate = ${sqlString(latestDate)}
      AND stock_symbol IN (${quoted})
    ORDER BY FIELD(stock_symbol, ${quoted})
  `);
  const rows = parseRows(raw, ["symbol", "price", "changePct", "rs", "rs3", "mci", "sector", "industry"]);
  const bySymbol = new Map(rows.map((item) => [item.symbol, item]));
  const items = unique.map((symbol) => {
    const item = bySymbol.get(symbol) || {};
    const changePct = pct(item.changePct, null);
    return {
      symbol,
      price: pct(item.price, null),
      changePct,
      rs: pct(item.rs, null),
      rs3: pct(item.rs3, null),
      mci: pct(item.mci, null),
      sector: item.sector || "Unknown",
      industry: item.industry || "Unknown",
      tone: Number(changePct || 0) > 0 ? "good" : Number(changePct || 0) < 0 ? "bad" : "neutral"
    };
  });
  return { source: "myts.golden_business_date.watchlist", latestDate, items };
}

async function dataQualityModel() {
  const calendar = await rsDailyCalendarStatus();
  const runDate = calendar.dueDate;
  const latest = calendar.latestCompletedDate;
  const raw = await mysqlJson(`
    SELECT
      (SELECT COUNT(*) FROM stock_sector_master WHERE stock_symbol REGEXP '^[A-Z]'),
      (SELECT COUNT(DISTINCT stock_symbol) FROM rs_daily WHERE sdate=${sqlString(runDate)}),
      (SELECT COUNT(*) FROM rs_daily WHERE sdate=${sqlString(runDate)}),
      (SELECT COUNT(*) FROM (
        SELECT stock_symbol FROM rs_daily WHERE sdate=${sqlString(runDate)} GROUP BY stock_symbol HAVING COUNT(*) > 1
      ) d),
      (SELECT SUM(CASE WHEN rs_val = 0 OR rs_val IS NULL THEN 1 ELSE 0 END) FROM rs_daily WHERE sdate=${sqlString(runDate)}),
      (SELECT SUM(CASE WHEN volume IS NULL OR volume = 0 THEN 1 ELSE 0 END) FROM rs_daily WHERE sdate=${sqlString(runDate)})
  `);
  const [expected, actual, rows, duplicates, badRs, badVolume] = raw.split("\t").map((value) => Number(value || 0));
  const coverageRatio = expected ? actual / expected : 0;
  return {
    source: "myts.pipeline.data_quality",
    businessDay: runDate,
    latestCompletedDate: latest,
    isCurrent: calendar.isCurrent,
    lagBusinessDays: calendar.lagBusinessDays,
    expectedSymbols: expected,
    actualSymbols: actual,
    totalRows: rows,
    duplicates,
    badRs,
    badVolume,
    coverageRatio: pct(coverageRatio * 100),
    status: calendar.isCurrent && coverageRatio >= 90 && duplicates === 0 ? "PASS" : "ATTENTION",
    shouldTriggerRsDaily: !calendar.isCurrent || coverageRatio < 90 || duplicates > 0
  };
}


async function rsDailyObservabilityModel() {
  const calendar = await rsDailyCalendarStatus();
  const dueDate = calendar.dueDate;
  const latest = calendar.latestCompletedDate;
  const masterRaw = await mysqlJson(`SELECT COUNT(*) FROM stock_sector_master WHERE stock_symbol REGEXP '^[A-Z]'`);
  const expected = Number(masterRaw || 0);
  const summaryRaw = await mysqlJson(`
    SELECT
      COUNT(DISTINCT stock_symbol),
      COUNT(*),
      SUM(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN volume IS NULL OR volume <= 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN rs_val IS NULL OR rs_val = 0 OR rs_val_3m IS NULL OR mci IS NULL THEN 1 ELSE 0 END),
      COUNT(*) - COUNT(DISTINCT stock_symbol)
    FROM rs_daily
    WHERE sdate=${sqlString(dueDate)}
  `);
  const [actualSymbols, totalRows, badOhlc, badVolume, badIndicators, duplicateRows] = summaryRaw.split("\t").map((value) => Number(value || 0));
  const missingRaw = await mysqlJson(`
    SELECT m.stock_symbol, COALESCE(m.sector,''), COALESCE(m.industry,''), 'MISSING', 'No rs_daily row for due date'
    FROM stock_sector_master m
    LEFT JOIN rs_daily r ON r.stock_symbol=m.stock_symbol AND r.sdate=${sqlString(dueDate)}
    WHERE m.stock_symbol REGEXP '^[A-Z]' AND r.stock_symbol IS NULL
    ORDER BY m.stock_symbol
    LIMIT 200
  `);
  const badRaw = await mysqlJson(`
    SELECT stock_symbol, COALESCE(sector,''), COALESCE(industry,''),
      CASE
        WHEN COUNT(*) > 1 THEN 'DUPLICATE'
        WHEN SUM(CASE WHEN volume IS NULL OR volume <= 0 THEN 1 ELSE 0 END) > 0 THEN 'BAD_VOLUME'
        WHEN SUM(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 THEN 1 ELSE 0 END) > 0 THEN 'BAD_OHLC'
        WHEN SUM(CASE WHEN rs_val IS NULL OR rs_val = 0 OR rs_val_3m IS NULL OR mci IS NULL THEN 1 ELSE 0 END) > 0 THEN 'BAD_INDICATOR'
        ELSE 'OK'
      END,
      CONCAT('rows=', COUNT(*), ', volume_bad=', SUM(CASE WHEN volume IS NULL OR volume <= 0 THEN 1 ELSE 0 END), ', ohlc_bad=', SUM(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 THEN 1 ELSE 0 END))
    FROM rs_daily
    WHERE sdate=${sqlString(dueDate)}
    GROUP BY stock_symbol, sector, industry
    HAVING COUNT(*) > 1
       OR SUM(CASE WHEN volume IS NULL OR volume <= 0 THEN 1 ELSE 0 END) > 0
       OR SUM(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 THEN 1 ELSE 0 END) > 0
       OR SUM(CASE WHEN rs_val IS NULL OR rs_val = 0 OR rs_val_3m IS NULL OR mci IS NULL THEN 1 ELSE 0 END) > 0
    ORDER BY FIELD(CASE
        WHEN COUNT(*) > 1 THEN 'DUPLICATE'
        WHEN SUM(CASE WHEN volume IS NULL OR volume <= 0 THEN 1 ELSE 0 END) > 0 THEN 'BAD_VOLUME'
        WHEN SUM(CASE WHEN open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 THEN 1 ELSE 0 END) > 0 THEN 'BAD_OHLC'
        ELSE 'BAD_INDICATOR'
      END, 'BAD_VOLUME', 'BAD_OHLC', 'BAD_INDICATOR', 'DUPLICATE'), stock_symbol
    LIMIT 200
  `);
  const trendRaw = await mysqlJson(`
    SELECT d.sdate, COUNT(DISTINCT r.stock_symbol), COUNT(r.stock_symbol), SUM(CASE WHEN r.volume IS NULL OR r.volume <= 0 THEN 1 ELSE 0 END)
    FROM (SELECT DISTINCT sdate FROM rs_daily WHERE sdate <= ${sqlString(dueDate)} ORDER BY sdate DESC LIMIT 10) d
    LEFT JOIN rs_daily r ON r.sdate = d.sdate
    GROUP BY d.sdate
    ORDER BY d.sdate ASC
  `);
  const rollingTrend = parseRows(trendRaw, ["date", "symbols", "rows", "badVolume"]).map((row) => ({
    date: row.date,
    symbols: Number(row.symbols || 0),
    rows: Number(row.rows || 0),
    badVolume: Number(row.badVolume || 0),
    coverageRatio: expected ? pct(Number(row.symbols || 0) / expected * 100) : 0
  }));
  const rows = [...parseRows(missingRaw, ["symbol", "sector", "industry", "issue", "detail"]), ...parseRows(badRaw, ["symbol", "sector", "industry", "issue", "detail"])].slice(0, 250);
  const coverageRatio = expected ? actualSymbols / expected : 0;
  const issueCount = Math.max(0, expected - actualSymbols) + badOhlc + badVolume + badIndicators + duplicateRows;
  const status = !calendar.isCurrent ? "STALE" : issueCount > 0 || coverageRatio < 0.98 ? "ACTION" : "PASS";
  const actionableSymbols = [...new Set(rows.filter((row) => ["MISSING", "BAD_VOLUME", "BAD_OHLC", "BAD_INDICATOR"].includes(row.issue)).map((row) => row.symbol).filter(Boolean))].slice(0, 100);
  const model = {
    source: "myts.rs_daily.observability",
    dueDate,
    latestCompletedDate: latest,
    status,
    tone: status === "PASS" ? "good" : status === "STALE" ? "bad" : "warn",
    expectedSymbols: expected,
    actualSymbols,
    totalRows,
    coverageRatio: pct(coverageRatio * 100),
    badOhlc,
    badVolume,
    badIndicators,
    duplicateRows,
    missingSymbols: Math.max(0, expected - actualSymbols),
    actionableSymbols,
    rollingTrend,
    rows,
    job: rsDailyMonitorAgent.job,
    blockedByRsDaily: Boolean(rsDailyAgent.running),
    blockingJob: rsDailyAgent.running ? { id: rsDailyAgent.job?.id, status: rsDailyAgent.job?.status, currentSymbol: rsDailyAgent.job?.currentSymbol } : null,
    refreshedAt: new Date().toISOString()
  };
  rsDailyMonitorAgent.last = model;
  return model;
}

async function startRsDailyMonitorReload(symbols = []) {
  if (rsDailyMonitorAgent.running) {
    return { ...(rsDailyMonitorAgent.job || {}), ok: true, alreadyRunning: true, message: "RS Daily monitor reload is already running." };
  }
  if (rsDailyAgent.running) {
    return { ok: false, blocked: true, alreadyRunning: true, message: "RS Daily agent is already running. Wait for it to finish before targeted reload.", blockingJob: rsDailyAgent.job };
  }
  const unique = [...new Set(symbols.map((s) => String(s || "").trim().toUpperCase().replace(".US", "")).filter(Boolean))].slice(0, 100);
  if (!unique.length) throw new Error("No symbols supplied for targeted reload.");
  const job = { id: `rsmon-${Date.now()}`, status: "running", startedAt: new Date().toISOString(), finishedAt: null, symbols: unique, processed: 0, inserted: 0, updated: 0, currentSymbol: "", failures: [], events: [], options: { symbols: unique, days: 5, dryRun: false } };
  rsDailyMonitorAgent.running = true;
  rsDailyMonitorAgent.job = job;
  runRsDailyJob(job).finally(async () => {
    rsDailyMonitorAgent.running = false;
    job.finishedAt = job.finishedAt || new Date().toISOString();
    triggerDailyRsCacheWarm("rs_monitor_reload", true);
    try { await rsDailyObservabilityModel(); } catch {}
  });
  return job;
}
async function rsRankingModel(options = {}) {
  const latestDate = await latestRsDailyDate();
  const minRs = clamp(Number(options.minRs || 90), 0, 250);
  const segment = ["sector", "industry"].includes(options.segment) ? options.segment : "sector";
  const limit = clamp(Number(options.limit || 100), 10, 500);
  const raw = await mysqlJson(`
    SELECT stock_symbol, COALESCE(sector,''), COALESCE(industry,''), close, volume, rs_val, rs_val_3m, mci, perf_5d_pct
    FROM rs_daily
    WHERE sdate=${sqlString(latestDate)}
      AND rs_val >= ${sqlNumber(minRs)}
      AND close > 12
      AND volume > 100000
    ORDER BY rs_val DESC, rs_val_3m DESC
    LIMIT ${limit}
  `);
  const leaders = parseRows(raw, ["symbol", "sector", "industry", "close", "volume", "rs", "rs3", "mci", "perf5"]).map((item) => ({
    symbol: item.symbol,
    sector: item.sector || "Unknown",
    industry: item.industry || "Unknown",
    close: pct(item.close, null),
    volume: Number(item.volume || 0),
    rs: pct(item.rs, null),
    rs3: pct(item.rs3, null),
    mci: pct(item.mci, null),
    perf5: pct(item.perf5, null)
  }));
  const buckets = new Map();
  for (const item of leaders) {
    const key = item[segment] || "Unknown";
    const bucket = buckets.get(key) || { name: key, count: 0, avgRs: 0, avgRs3: 0, avgPerf5: 0, avgMci: 0 };
    bucket.count += 1;
    bucket.avgRs += Number(item.rs || 0);
    bucket.avgRs3 += Number(item.rs3 || 0);
    bucket.avgPerf5 += Number(item.perf5 || 0);
    bucket.avgMci += Number(item.mci || 0);
    buckets.set(key, bucket);
  }
  const segments = [...buckets.values()].map((bucket) => ({
    ...bucket,
    avgRs: pct(bucket.avgRs / bucket.count),
    avgRs3: pct(bucket.avgRs3 / bucket.count),
    avgPerf5: pct(bucket.avgPerf5 / bucket.count),
    avgMci: pct(bucket.avgMci / bucket.count)
  })).sort((a, b) => b.count - a.count || b.avgRs - a.avgRs);
  return { source: "myts.rs_daily.rs_ranking", latestDate, minRs, segment, leaders, segments, count: leaders.length };
}

async function dailyReportModel() {
  const rsDailyLatestDate = await latestRsDailyDate();
  const raw = await optionalMysqlJson(`
    SELECT regime_date, regime_score, regime_classification, quarterly_signal, daily_signal, llm_summary, actionable_trades
    FROM market_dashboard_daily
    WHERE regime_date <= ${rsDailyLatestDate ? sqlString(rsDailyLatestDate) : "CURRENT_DATE"}
    ORDER BY regime_date DESC
    LIMIT 1
  `);
  const [regimeDate, regimeScore, regimeClassification, quarterlySignal, dailySignal, llmSummary, actionableTrades] = raw ? raw.split("\t") : [];
  const trades = parseJson(actionableTrades, []);
  return {
    source: "myts.market_dashboard_daily.report",
    rsDailyLatestDate,
    regimeDate,
    regimeScore: Number(regimeScore || 0),
    regimeClassification: regimeClassification || "No dashboard report",
    quarterlySignal: quarterlySignal || "NA",
    dailySignal: dailySignal || "NA",
    summary: llmSummary || "",
    synthesis: extractFinalSynthesis(llmSummary || ""),
    sampleTrades: Array.isArray(trades) ? trades.slice(0, 12) : []
  };
}

async function reasoningImagesModel() {
  const rsDailyLatestDate = await latestRsDailyDate();
  const raw = await optionalMysqlJson(`
    SELECT
      (SELECT COUNT(*) FROM actionable_trades_daily WHERE regime_date=(SELECT MAX(regime_date) FROM actionable_trades_daily WHERE regime_date <= ${rsDailyLatestDate ? sqlString(rsDailyLatestDate) : "CURRENT_DATE"})),
      (SELECT MAX(regime_date) FROM actionable_trades_daily WHERE regime_date <= ${rsDailyLatestDate ? sqlString(rsDailyLatestDate) : "CURRENT_DATE"}),
      (SELECT COUNT(*) FROM actionable_trades_daily WHERE status IN ('OPEN','BUY','WATCH'))
  `);
  const [tradeCount, tradeDate, activeTradeCount] = raw ? raw.split("\t") : [0, null, 0];
  return {
    source: "myts.pipeline.reasoning_images",
    rsDailyLatestDate,
    tradeDate,
    tradeCount: Number(tradeCount || 0),
    activeTradeCount: Number(activeTradeCount || 0),
    reasoning: {
      status: "AVAILABLE_AS_OPTIONAL_PIPELINE_TASK",
      implementedInProduction: "generate_reasoning",
      uiRunMode: "manual_guarded"
    },
    images: {
      status: "AVAILABLE_AS_OPTIONAL_PIPELINE_TASK",
      implementedInProduction: "download_images",
      uiRunMode: "manual_guarded"
    }
  };
}

async function pipelineStatusModel() {
  const quality = await dataQualityModel();
  const ranking = await rsRankingModel({ minRs: 90, limit: 50 });
  const report = await dailyReportModel();
  const reasoningImages = await reasoningImagesModel();
  const tasks = [
    { id: "get_last_business_day", label: "Business Day Gate", status: quality.shouldTriggerRsDaily ? "PROMPT_RS_DAILY" : "CURRENT", date: quality.businessDay, detail: `${quality.actualSymbols}/${quality.expectedSymbols} symbols` },
    { id: "download_eodhd_data", label: "RS Daily Shards", status: quality.isCurrent ? "CURRENT" : "DUE", date: quality.latestCompletedDate, detail: `lag ${quality.lagBusinessDays ?? "NA"} business day(s)` },
    { id: "compute_rs_ranking", label: "RS Ranking", status: ranking.count ? "READY" : "MISSING", date: ranking.latestDate, detail: `${ranking.count} leaders RS >= ${ranking.minRs}` },
    { id: "process_symbols", label: "Symbol Processing", status: "PARTIAL_UI", date: quality.latestCompletedDate, detail: "Signals read generated/actionable outputs" },
    { id: "generate_actionable_trades", label: "Actionable Trades", status: reasoningImages.activeTradeCount ? "READY" : "MISSING", date: reasoningImages.tradeDate, detail: `${reasoningImages.activeTradeCount} active trades` },
    { id: "generate_report", label: "Daily Report", status: report.summary ? "READY" : "MISSING", date: report.regimeDate, detail: report.regimeClassification },
    { id: "download_images", label: "Images", status: "MANUAL_OPTIONAL", date: reasoningImages.tradeDate, detail: "TradingView capture is guarded" },
    { id: "generate_reasoning", label: "Reasoning", status: "MANUAL_OPTIONAL", date: reasoningImages.tradeDate, detail: "LLM reasoning is guarded" },
    { id: "validate_pipeline", label: "Validation", status: quality.status, date: quality.businessDay, detail: `${quality.coverageRatio}% coverage, dup ${quality.duplicates}` }
  ];
  return {
    source: "myts.pipeline.monitor",
    job: pipelineAgent.job,
    quality,
    tasks,
    refreshedAt: new Date().toISOString()
  };
}

async function runPipelineRefresh() {
  if (pipelineAgent.running) {
    return {
      ...(pipelineAgent.job || {}),
      ok: true,
      alreadyRunning: true,
      message: "Pipeline monitor refresh is already running."
    };
  }
  const job = {
    id: `pipe-${Date.now()}`,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: [],
    failures: []
  };
  pipelineAgent.running = true;
  pipelineAgent.job = job;
  try {
    const steps = [
      ["daily_rs_cache", () => dailyRsCache({ force: true })],
      ["rs_daily_observability", rsDailyObservabilityModel],
      ["data_quality", dataQualityModel],
      ["rs_ranking", () => rsRankingModel({ minRs: 90, limit: 100 })],
      ["daily_report", dailyReportModel],
      ["reasoning_images", reasoningImagesModel]
    ];
    for (const [id, fn] of steps) {
      const step = { id, status: "running", startedAt: new Date().toISOString(), finishedAt: null };
      job.steps.push(step);
      try {
        await fn();
        step.status = "completed";
      } catch (error) {
        step.status = "failed";
        step.error = error.message;
        job.failures.push({ step: id, error: error.message });
      }
      step.finishedAt = new Date().toISOString();
    }
    job.status = job.failures.length ? "completed_with_failures" : "completed";
    job.finishedAt = new Date().toISOString();
  } finally {
    pipelineAgent.running = false;
  }
  return job;
}

async function riskTileModel() {
  const settings = await riskSettings();
  const rsDailyLatestDate = await latestRsDailyDate();
  const openTrades = await riskOpenTrades(settings);
  const sellSummary = riskSellRuleSummary(openTrades);
  const portfolioSize = Number(settings.portfolio_size || 0);
  const perTradeCapital = Number(settings.per_trade_capital || 0);
  const maxTrades = Number(settings.max_trades || 0);
  const maxCapitalPct = Number(settings.max_capital_pct || 0);
  const entryRiskPct = Number(settings.entry_risk_pct || 0);
  const maxCapital = portfolioSize * maxCapitalPct / 100;
  const usedCapital = openTrades.length * perTradeCapital;
  const remainingCapital = Math.max(0, maxCapital - usedCapital);
  const remainingSlots = Math.max(0, maxTrades - openTrades.length);
  const possibleNewTrades = Math.floor(Math.min(remainingSlots, perTradeCapital ? remainingCapital / perTradeCapital : 0));
  const riskPerTrade = perTradeCapital * entryRiskPct / 100;
  const openRisk = openTrades.length * riskPerTrade;
  const production = await productionGuardrailModel();
  const guardrails = [];
  if (production.buy_locked) guardrails.push({ tone: "bad", state: "LOCK", metric: production.state, text: production.reasons.join("; ") || "Production buy lock is active." });
  if (openTrades.length >= maxTrades) guardrails.push({ tone: "bad", state: "STOP", metric: `${openTrades.length}/${maxTrades}`, text: "Maximum trade count is already reached. New buys should be blocked." });
  if (usedCapital >= maxCapital) guardrails.push({ tone: "bad", state: "STOP", metric: money(usedCapital), text: "Maximum deployed capital is already reached. No additional entries should be taken." });
  if (possibleNewTrades > 0) guardrails.push({ tone: "good", state: "OK", metric: String(possibleNewTrades), text: `Capacity allows up to ${possibleNewTrades} additional trade(s) under current settings.` });
  if (openRisk > portfolioSize * 0.06) guardrails.push({ tone: "neutral", state: "WATCH", metric: `${pct(openRisk / portfolioSize * 100)}%`, text: "Aggregate open initial risk is elevated. Consider reducing per-trade risk or number of positions." });
  return {
    source: "myts_prod_local.risk_model",
    rsDailyLatestDate,
    inputs: {
      portfolio_size: portfolioSize,
      per_trade_capital: perTradeCapital,
      max_trades: maxTrades,
      max_capital_pct: maxCapitalPct,
      entry_risk_pct: entryRiskPct
    },
    summary: {
      open_count: openTrades.length,
      max_capital: pct(maxCapital),
      used_capital: pct(usedCapital),
      remaining_capital: pct(remainingCapital),
      remaining_slots: remainingSlots,
      possible_new_trades: possibleNewTrades,
      risk_per_trade: pct(riskPerTrade),
      open_risk: pct(openRisk),
      open_risk_pct: portfolioSize ? pct(openRisk / portfolioSize * 100) : 0,
      unrealized_pnl_pct: sellSummary.unrealizedPnlPct,
      urgent_sell: sellSummary.urgentSell,
      sell: sellSummary.sell,
      take_profit: sellSummary.takeProfit,
      tighten_stop: sellSummary.tightenStop,
      time_exit_review: sellSummary.timeExitReview,
      hold: sellSummary.hold,
      near_hard_stop: sellSummary.nearHardStop,
      near_8_week: sellSummary.near8Week,
      near_13_week: sellSummary.near13Week
    },
    open_trades: openTrades,
    sell_rule_summary: sellSummary,
    pending_rule_suggestions: await pendingRiskRuleSuggestions(),
    sell_rules: riskSellRules(),
    cushion_ladder: riskCushionLadder(),
    guardrails,
    production
  };
}

async function riskSettings() {
  const raw = await optionalMysqlJson(`SELECT portfolio_size, per_trade_capital, max_trades, max_capital_pct, entry_risk_pct FROM web_risk_settings WHERE id = 1 LIMIT 1`);
  if (raw) {
    const [portfolio_size, per_trade_capital, max_trades, max_capital_pct, entry_risk_pct] = raw.split("\t");
    return { portfolio_size, per_trade_capital, max_trades, max_capital_pct, entry_risk_pct };
  }
  return { portfolio_size: 100000, per_trade_capital: 10000, max_trades: 10, max_capital_pct: 60, entry_risk_pct: 7.5 };
}

async function saveRiskSettings(body = {}) {
  const cleaned = {
    portfolio_size: Math.max(0, Number(body.portfolio_size ?? body.portfolioSize ?? 100000) || 0),
    per_trade_capital: Math.max(0, Number(body.per_trade_capital ?? body.perTradeCapital ?? 10000) || 0),
    max_trades: Math.max(0, Math.round(Number(body.max_trades ?? body.maxTrades ?? 10) || 0)),
    max_capital_pct: Math.max(0, Math.min(100, Number(body.max_capital_pct ?? body.maxCapitalPct ?? 60) || 0)),
    entry_risk_pct: Math.max(0, Math.min(25, Number(body.entry_risk_pct ?? body.entryRiskPct ?? 7.5) || 0))
  };
  await mysqlJson(`
    INSERT INTO web_risk_settings (
      id, portfolio_size, per_trade_capital, max_trades, max_capital_pct, entry_risk_pct
    )
    VALUES (
      1, ${sqlNumber(cleaned.portfolio_size)}, ${sqlNumber(cleaned.per_trade_capital)}, ${sqlNumber(cleaned.max_trades)}, ${sqlNumber(cleaned.max_capital_pct)}, ${sqlNumber(cleaned.entry_risk_pct)}
    )
    ON DUPLICATE KEY UPDATE
      portfolio_size = VALUES(portfolio_size),
      per_trade_capital = VALUES(per_trade_capital),
      max_trades = VALUES(max_trades),
      max_capital_pct = VALUES(max_capital_pct),
      entry_risk_pct = VALUES(entry_risk_pct)
  `);
  return cleaned;
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "NULL";
}

async function latestRsDailyDate() {
  return (await marketBusinessDayStatus()).latestCompleteDate || null;
}

function marketCycleLookback(value) {
  const n = Number(value || 260);
  return [130, 260, 520].includes(n) ? n : 260;
}

function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function movingAverage(rows, index, days) {
  if (index + 1 < days) return null;
  return mean(rows.slice(index + 1 - days, index + 1).map((row) => row.close));
}

function marketCycleTone(bucket) {
  const value = String(bucket || "").toUpperCase();
  if (["BULL_TREND", "BULL_START"].includes(value)) return "GREEN";
  if (["TRANSITION_CHOP", "BEAR_END"].includes(value)) return "AMBER";
  if (["BEAR_START_SLOW", "BEAR_START_CRASH", "BEAR_MARKET"].includes(value)) return "RED";
  return "NEUTRAL";
}

function cycleBucketFromMetrics(metrics) {
  const vs50 = Number(metrics.spy_close_vs_50d_pct || 0);
  const vs200 = Number(metrics.spy_close_vs_200d_pct || 0);
  const distribution = Number(metrics.distribution_days_25d || 0);
  const weekly = String(metrics.weekly_status || "");
  const leadership = Number(metrics.leadership_score || 0);
  if (vs200 < -8 && vs50 < -4) return "BEAR_MARKET";
  if (vs50 < -2 && distribution >= 6) return "BEAR_START_SLOW";
  if (vs50 < -6 && distribution >= 4) return "BEAR_START_CRASH";
  if (vs50 > 0 && vs200 > 0 && leadership >= 55 && distribution <= 5 && weekly === "GREEN") return "BULL_TREND";
  if (vs50 > 0 && leadership >= 50) return "BULL_START";
  if (vs50 > 0 && distribution >= 5) return "BEAR_END";
  return "TRANSITION_CHOP";
}

function cycleAllocation(bucket, metrics) {
  const qqqTilt = Number(metrics.qqq_rs_63d_vs_spy_pct || 0) > 3;
  const iwmTilt = Number(metrics.iwm_rs_63d_vs_spy_pct || 0) > 2;
  const distribution = Number(metrics.distribution_days_25d || 0);
  const distributionDanger = distribution >= 7;
  const distributionWarning = distribution >= 5;
  const weakBreadth = Number(metrics.leaders_above_50d_pct || 0) < 45 || Number(metrics.leadership_score || 0) < 50;
  if (["BEAR_MARKET", "BEAR_START_CRASH"].includes(bucket)) {
    return { posture: "SHORT_OR_CASH", action: "DEFENSIVE_OR_HEDGE", longPct: 0, shortPct: 60, exposureCapPct: 0, gate: "BEAR_TREND", gateReason: "Bear trend/crash state keeps long exposure at zero.", weights: { SPY: 0, QQQ: 0, IWM: 0, SH: 0.30, PSQ: 0.20, RWM: 0.10 } };
  }
  if (bucket === "BEAR_START_SLOW") {
    return { posture: "REDUCE_LONGS", action: "REDUCE_OR_HEDGE", longPct: 25, shortPct: 25, exposureCapPct: 25, gate: "BEAR_START", gateReason: "Bear-start conditions require reduced longs and defined hedge exposure.", weights: { SPY: 0.20, QQQ: 0.05, IWM: 0, SH: 0.15, PSQ: 0.10, RWM: 0 } };
  }
  if (bucket === "BULL_START" && distributionDanger) {
    return { posture: "PILOT_ONLY", action: "PILOT_ONLY", longPct: 25, shortPct: 0, exposureCapPct: 25, gate: "DISTRIBUTION_DANGER", gateReason: `Bull-start regime is capped because distribution days are already ${distribution}, above the danger threshold.`, weights: { SPY: 0.20, QQQ: qqqTilt ? 0.05 : 0, IWM: 0, SH: 0, PSQ: 0, RWM: 0 } };
  }
  if (bucket === "BULL_START" && (distributionWarning || weakBreadth)) {
    return { posture: "SELECTIVE_LONG", action: "PILOT_TO_HALF", longPct: 50, shortPct: 0, exposureCapPct: 50, gate: distributionWarning ? "DISTRIBUTION_WARNING" : "WEAK_BREADTH", gateReason: distributionWarning ? `Bull-start exposure is capped because distribution days are ${distribution}.` : "Bull-start exposure is capped because leadership/breadth confirmation is not broad enough.", weights: { SPY: 0.35, QQQ: qqqTilt ? 0.15 : 0.10, IWM: iwmTilt ? 0.05 : 0, SH: 0, PSQ: 0, RWM: 0 } };
  }
  if (["TRANSITION_CHOP", "BEAR_END"].includes(bucket)) {
    return { posture: "SELECTIVE_LONG", action: "SELECTIVE_LONG", longPct: distributionWarning ? 25 : 50, shortPct: 0, exposureCapPct: distributionWarning ? 25 : 50, gate: distributionWarning ? "DISTRIBUTION_WARNING" : "TRANSITION", gateReason: distributionWarning ? `Transition exposure is capped because distribution days are ${distribution}.` : "Transition regime allows selective long exposure only.", weights: { SPY: distributionWarning ? 0.20 : 0.35, QQQ: distributionWarning ? 0.05 : qqqTilt ? 0.15 : 0.10, IWM: !distributionWarning && iwmTilt ? 0.05 : 0, SH: 0, PSQ: 0, RWM: 0 } };
  }
  if (distributionWarning) {
    return { posture: "HOLD_OR_PARTIAL", action: "HOLD_PARTIAL", longPct: 75, shortPct: 0, exposureCapPct: 75, gate: "DISTRIBUTION_WARNING", gateReason: `Bull-trend exposure is capped because distribution days are ${distribution}.`, weights: { SPY: qqqTilt ? 0.35 : 0.40, QQQ: qqqTilt ? 0.35 : 0.30, IWM: iwmTilt ? 0.05 : 0, SH: 0, PSQ: 0, RWM: 0 } };
  }
  return { posture: "LONG_INDEX", action: "ENTER_OR_HOLD_LONG", longPct: 100, shortPct: 0, exposureCapPct: 100, gate: "CLEAR", gateReason: "Trend, leadership, and distribution gates support full index exposure.", weights: { SPY: qqqTilt ? 0.40 : 0.45, QQQ: qqqTilt ? 0.50 : 0.45, IWM: iwmTilt ? 0.10 : 0.05, SH: 0, PSQ: 0, RWM: 0 } };
}

function distributionBucket(count) {
  const n = Number(count || 0);
  if (n >= 8) return "8+_EXTREME";
  if (n >= 7) return "7_DANGER";
  if (n >= 5) return "5-6_WARNING";
  if (n >= 3) return "3-4_NORMAL";
  return "0-2_LOW";
}

function enrichCycleRows(rows) {
  const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return ordered.map((row, index) => {
    const prev = ordered[index - 1] || {};
    const close = Number(row.close || 0);
    const ma21 = movingAverage(ordered, index, 21);
    const ma50 = movingAverage(ordered, index, 50);
    const ma200 = movingAverage(ordered, index, 200);
    const distribution = index > 0 && close < Number(prev.close || 0) && Number(row.volume || 0) > Number(prev.volume || 0);
    const accumulation = index > 0 && close > Number(prev.close || 0) && Number(row.volume || 0) > Number(prev.volume || 0);
    const perf = index > 0 && Number(prev.close || 0) ? (close - Number(prev.close)) / Number(prev.close) * 100 : 0;
    const bearStart = Boolean(ma50 && close < ma50 && distribution);
    const bearMarket = Boolean(ma200 && close < ma200 && ma50 && ma50 < ma200);
    const bearEnd = Boolean(ma50 && close > ma50 && Number(prev.close || 0) < Number(prev.ma50 || ma50));
    const bullStart = Boolean(ma50 && ma200 && close > ma50 && ma50 > ma200 && Number(prev.close || 0) <= Number(prev.ma50 || ma50));
    const ftd = Boolean(index > 4 && perf >= 1.7 && Number(row.volume || 0) > Number(prev.volume || 0) && ma21 && close > ma21);
    const signals = [
      distribution ? "DISTRIBUTION" : "",
      ftd ? "FOLLOW_THROUGH" : "",
      bearStart ? "BEAR_START" : "",
      bearMarket ? "BEAR_MARKET" : "",
      bearEnd ? "BEAR_END" : "",
      bullStart ? "BULL_START" : ""
    ].filter(Boolean);
    return { ...row, close: pct(close, null), volume: Number(row.volume || 0), ma21: pct(ma21, null), ma50: pct(ma50, null), ma200: pct(ma200, null), distribution_day: distribution, accumulation_day: accumulation, follow_through_day: ftd, cycle_bucket: bearMarket ? "BEAR_MARKET" : bearStart ? "BEAR_START_SLOW" : bullStart ? "BULL_START" : "", signals };
  });
}

function pctDistance(value, reference) {
  const a = Number(value), b = Number(reference);
  return Number.isFinite(a) && Number.isFinite(b) && b ? pct((a - b) / b * 100, null) : null;
}

function marketCycleBacktest(spyRows, allocationRows) {
  if (spyRows.length < 5) return { strategy: "v2_capital_allocatable", total_return_pct: null, cagr_pct: null, max_drawdown_pct: null, sharpe: null, mar_ratio: null, benchmarks: [] };
  let equity = 1, peak = 1, maxDrawdown = 0;
  const returns = [];
  for (let i = 1; i < spyRows.length; i += 1) {
    const prevClose = Number(spyRows[i - 1].close || 0);
    const close = Number(spyRows[i].close || 0);
    const exposure = Number(allocationRows[i - 1]?.longPct ?? 50) / 100 - Number(allocationRows[i - 1]?.shortPct ?? 0) / 100;
    const ret = prevClose && close ? ((close - prevClose) / prevClose) * exposure : 0;
    equity *= 1 + ret;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity - peak) / peak * 100);
    returns.push(ret);
  }
  const years = Math.max(spyRows.length / 252, 0.1);
  const total = (equity - 1) * 100;
  const cagr = (Math.pow(equity, 1 / years) - 1) * 100;
  const avg = mean(returns) || 0;
  const variance = mean(returns.map((value) => Math.pow(value - avg, 2))) || 0;
  const sharpe = variance ? avg / Math.sqrt(variance) * Math.sqrt(252) : null;
  const benchmark = (symbol, rows) => {
    const first = Number(rows[0]?.close || 0), last = Number(rows.at(-1)?.close || 0);
    let bEquity = 1, bPeak = 1, bMaxDd = 0;
    for (let i = 1; i < rows.length; i += 1) {
      const p = Number(rows[i - 1].close || 0), c = Number(rows[i].close || 0);
      if (p && c) bEquity *= 1 + (c - p) / p;
      bPeak = Math.max(bPeak, bEquity);
      bMaxDd = Math.min(bMaxDd, (bEquity - bPeak) / bPeak * 100);
    }
    return { strategy: `Buy & hold ${symbol}`, cagr_pct: first && last ? pct((Math.pow(last / first, 1 / years) - 1) * 100, null) : null, max_drawdown_pct: pct(bMaxDd, null) };
  };
  return {
    strategy: "v2_capital_allocatable",
    total_return_pct: pct(total, null),
    cagr_pct: pct(cagr, null),
    max_drawdown_pct: pct(maxDrawdown, null),
    sharpe: pct(sharpe, null),
    mar_ratio: maxDrawdown ? pct(cagr / Math.abs(maxDrawdown), null) : null,
    ending_equity: pct(equity, null),
    benchmarks: [benchmark("SPY", spyRows)]
  };
}

async function marketCycleSnapshot(options = {}) {
  const lookback = marketCycleLookback(options.lookback);
  const latestDate = await latestRsDailyDate();
  if (dailyRsCacheMeta.warming && !latestDate) throw cacheNotReadyError("Market cycle cache is warming. Try again shortly.");
  if (!latestDate) {
    const error = new Error("No rs_daily data found for Market Cycle Tracker.");
    error.code = "NOT_FOUND";
    throw error;
  }
  const key = `${latestDate}:${lookback}`;
  const cachedSnapshot = marketCycleSnapshotCache.get(key);
  if (!options.force && cachedSnapshot && Date.now() - cachedSnapshot.createdAt < 10 * 60 * 1000) return cachedSnapshot.payload;
  const dailyCache = await readDailyRsCache();
  let rows = [];
  if (lookback <= dailyRsCacheDays && dailyCache?.groupedBySymbol?.SPY?.rows?.length) {
    rows = ["SPY", "QQQ", "IWM"].flatMap((symbol) => (dailyCache.groupedBySymbol?.[symbol]?.rows || []).filter((row) => row.sdate <= latestDate).slice(-lookback).map((row) => ({
      symbol,
      date: row.sdate,
      open: Number(row.open || 0),
      high: Number(row.high || 0),
      low: Number(row.low || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0),
      perf_1d_pct: Number(row.perf_1d_pct || 0),
      rs_val: Number(row.rs_val || 0),
      rs_val_3m: Number(row.rs_val_3m || 0),
      sector: row.sector || "",
      industry: row.industry || ""
    })));
  }
  if (!rows.length) {
    const historyWindow = lookback + 260;
    const raw = await mysqlJson(`
      SELECT stock_symbol, sdate, open, high, low, close, volume, perf_1d_pct, rs_val, rs_val_3m, COALESCE(sector,''), COALESCE(industry,'')
      FROM rs_daily
      WHERE stock_symbol IN ('SPY','QQQ','IWM')
        AND sdate BETWEEN (
          SELECT MIN(sdate) FROM (
            SELECT DISTINCT sdate FROM rs_daily WHERE sdate <= ${sqlString(latestDate)} ORDER BY sdate DESC LIMIT ${historyWindow}
          ) d
        ) AND ${sqlString(latestDate)}
      ORDER BY stock_symbol, sdate
    `);
    rows = parseRows(raw, ["symbol", "date", "open", "high", "low", "close", "volume", "perf_1d_pct", "rs_val", "rs_val_3m", "sector", "industry"]).map((row) => ({
      ...row,
      open: Number(row.open || 0),
      high: Number(row.high || 0),
      low: Number(row.low || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0)
    }));
  }
  const bySymbol = Object.fromEntries(["SPY", "QQQ", "IWM"].map((symbol) => [symbol, enrichCycleRows(rows.filter((row) => row.symbol === symbol)).slice(-lookback)]));
  if (!bySymbol.SPY?.length) {
    const error = new Error("No SPY/QQQ/IWM rows found in rs_daily for Market Cycle Tracker.");
    error.code = "NOT_FOUND";
    throw error;
  }
  const spy = bySymbol.SPY;
  const qqq = bySymbol.QQQ || [];
  const iwm = bySymbol.IWM || [];
  const last = spy.at(-1) || {};
  const prior63 = spy[Math.max(0, spy.length - 64)] || spy[0] || {};
  const qqqPrior63 = qqq[Math.max(0, qqq.length - 64)] || qqq[0] || {};
  const iwmPrior63 = iwm[Math.max(0, iwm.length - 64)] || iwm[0] || {};
  const qqqRs = prior63.close && qqqPrior63.close ? ((Number(qqq.at(-1)?.close || 0) / Number(qqqPrior63.close || 1)) - (Number(last.close || 0) / Number(prior63.close || 1))) * 100 : 0;
  const iwmRs = prior63.close && iwmPrior63.close ? ((Number(iwm.at(-1)?.close || 0) / Number(iwmPrior63.close || 1)) - (Number(last.close || 0) / Number(prior63.close || 1))) * 100 : 0;
  const dist25 = spy.slice(-25).filter((row) => row.distribution_day).length;
  const acc25 = spy.slice(-25).filter((row) => row.accumulation_day).length;
  let universeStats = null;
  let leadershipRows = [];
  let leadershipDownRows = [];
  let formerLeadershipDownRows = [];
  let breadthHistory = [];
  if (dailyCache?.groupedBySymbol) {
    const latestRows = Object.values(dailyCache.groupedBySymbol).map((item) => item.latest || item.rows?.at(-1)).filter((row) => Number(row?.close || 0) > 0);
    universeStats = [
      latestRows.length,
      latestRows.filter((row) => Number(row.close || 0) > Number(row.ma50 || 0) && Number(row.ma50 || 0) > 0).length,
      latestRows.filter((row) => Number(row.rs_val_3m || 0) > 0).length,
      latestRows.filter((row) => Number(row.rs_val || 0) >= 80).length
    ];
    const rs250Rows = latestRows
      .filter((row) => /^[A-Z]{1,5}$/.test(String(row.stock_symbol || row.symbol || "")) && Number(row.close || 0) > 5 && Number(row.volume || 0) > 100000)
      .sort((a, b) => Number(b.rs_score ?? b.rs_val_3m ?? b.rs_val ?? -Infinity) - Number(a.rs_score ?? a.rs_val_3m ?? a.rs_val ?? -Infinity))
      .slice(0, 250);
    leadershipRows = [...rs250Rows]
      .slice(0, 8)
      .map((row) => ({ symbol: row.stock_symbol || row.symbol, sector: row.sector || "Unknown", rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null), change_pct: pct(Number(row.perf_1d_pct || row.perf_5d_pct || 0), null) }));
    leadershipDownRows = [...rs250Rows]
      .filter((row) => Number(row.perf_1d_pct || 0) < 0)
      .sort((a, b) => Number(a.perf_1d_pct || 0) - Number(b.perf_1d_pct || 0))
      .slice(0, 8)
      .map((row) => ({ symbol: row.stock_symbol || row.symbol, sector: row.sector || "Unknown", rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null), change_pct: pct(Number(row.perf_1d_pct || 0), null), role: "leader_down_now" }));
    formerLeadershipDownRows = [...rs250Rows]
      .filter((row) => Number(row.perf_5d_pct || 0) > 0 && Number(row.perf_1d_pct || 0) < 0)
      .sort((a, b) => Number(a.perf_1d_pct || 0) - Number(b.perf_1d_pct || 0))
      .slice(0, 8)
      .map((row) => ({ symbol: row.stock_symbol || row.symbol, sector: row.sector || "Unknown", rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null), change_pct: pct(Number(row.perf_1d_pct || 0), null), prior_5d_pct: pct(Number(row.perf_5d_pct || 0), null), role: "former_leader_down_now" }));
    const dateMap = new Map();
    for (const item of Object.values(dailyCache.groupedBySymbol)) {
      for (const row of (item.rows || []).slice(-90)) {
        if (!row?.sdate || Number(row.close || 0) <= 0) continue;
        if (!dateMap.has(row.sdate)) dateMap.set(row.sdate, { date: row.sdate, total: 0, above50: 0, positiveRs: 0, rsLeaders: 0, advancing: 0, declining: 0 });
        const bucket = dateMap.get(row.sdate);
        bucket.total += 1;
        if (Number(row.ma50 || 0) > 0 && Number(row.close || 0) > Number(row.ma50 || 0)) bucket.above50 += 1;
        if (Number(row.rs_val_3m || row.rs_val || 0) > 0) bucket.positiveRs += 1;
        if (Number(row.rs_val || 0) >= 80) bucket.rsLeaders += 1;
        if (Number(row.perf_1d_pct || 0) > 0) bucket.advancing += 1;
        if (Number(row.perf_1d_pct || 0) < 0) bucket.declining += 1;
      }
    }
    breadthHistory = [...dateMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-90).map((row) => ({
      date: row.date,
      above50_pct: pct(row.total ? row.above50 / row.total * 100 : null, null),
      positive_rs_pct: pct(row.total ? row.positiveRs / row.total * 100 : null, null),
      advance_decline_pct: pct((row.advancing + row.declining) ? row.advancing / (row.advancing + row.declining) * 100 : null, null),
      rs_leaders: row.rsLeaders
    }));
  }
  if (!universeStats) {
    const latestRowsRaw = await optionalMysqlJson(`
      SELECT
        COUNT(*),
        SUM(CASE WHEN close > COALESCE(ma50, 0) AND COALESCE(ma50, 0) > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN rs_val_3m > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN rs_val >= 80 THEN 1 ELSE 0 END)
      FROM rs_daily
      WHERE sdate = ${sqlString(latestDate)} AND close > 0
    `);
    universeStats = latestRowsRaw ? latestRowsRaw.split("\t").map(Number) : [0, 0, 0, 0];
  }
  if (!leadershipRows.length) {
    const leadersRaw = await optionalMysqlJson(`
      SELECT stock_symbol, COALESCE(sector,''), COALESCE(industry,''), close, volume, rs_val, rs_val_3m, perf_1d_pct, perf_5d_pct
      FROM rs_daily
      WHERE sdate = ${sqlString(latestDate)}
        AND stock_symbol REGEXP '^[A-Z]{1,5}$'
        AND close > 5
        AND volume > 100000
      ORDER BY COALESCE(rs_val_3m, rs_val, 0) DESC
      LIMIT 250
    `);
    leadershipRows = parseRows(leadersRaw, ["symbol", "sector", "industry", "close", "volume", "rs_val", "rs_val_3m", "perf_1d_pct", "perf_5d_pct"]).slice(0, 8).map((row) => ({
      symbol: row.symbol,
      sector: row.sector || "Unknown",
      rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null),
      change_pct: pct(Number(row.perf_1d_pct || row.perf_5d_pct || 0), null)
    }));
  }
  if (!leadershipDownRows.length || !formerLeadershipDownRows.length) {
    const downRaw = await optionalMysqlJson(`
      SELECT stock_symbol, COALESCE(sector,''), COALESCE(industry,''), close, volume, rs_val, rs_val_3m, perf_1d_pct, perf_5d_pct
      FROM rs_daily
      WHERE sdate = ${sqlString(latestDate)}
        AND stock_symbol REGEXP '^[A-Z]{1,5}$'
        AND close > 5
        AND volume > 100000
        AND stock_symbol IN (
          SELECT stock_symbol FROM (
            SELECT stock_symbol
            FROM rs_daily
            WHERE sdate = ${sqlString(latestDate)}
              AND stock_symbol REGEXP '^[A-Z]{1,5}$'
              AND close > 5
              AND volume > 100000
            ORDER BY COALESCE(rs_val_3m, rs_val, 0) DESC
            LIMIT 250
          ) rs250
        )
        AND COALESCE(perf_1d_pct, 0) < 0
      ORDER BY perf_1d_pct ASC
      LIMIT 40
    `);
    const downRows = parseRows(downRaw, ["symbol", "sector", "industry", "close", "volume", "rs_val", "rs_val_3m", "perf_1d_pct", "perf_5d_pct"]);
    leadershipDownRows = leadershipDownRows.length ? leadershipDownRows : downRows.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      sector: row.sector || "Unknown",
      rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null),
      change_pct: pct(Number(row.perf_1d_pct || 0), null),
      role: "leader_down_now"
    }));
    formerLeadershipDownRows = formerLeadershipDownRows.length ? formerLeadershipDownRows : downRows.filter((row) => Number(row.perf_5d_pct || 0) > 0).slice(0, 8).map((row) => ({
      symbol: row.symbol,
      sector: row.sector || "Unknown",
      rs_score: pct(Number(row.rs_val_3m || row.rs_val || 0), null),
      change_pct: pct(Number(row.perf_1d_pct || 0), null),
      prior_5d_pct: pct(Number(row.perf_5d_pct || 0), null),
      role: "former_leader_down_now"
    }));
  }
  if (!breadthHistory.length) {
    const breadthRaw = await optionalMysqlJson(`
      SELECT sdate,
        COUNT(*),
        SUM(CASE WHEN close > COALESCE(ma50, 0) AND COALESCE(ma50, 0) > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN COALESCE(rs_val_3m, rs_val, 0) > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN COALESCE(rs_val, 0) >= 80 THEN 1 ELSE 0 END),
        SUM(CASE WHEN COALESCE(perf_1d_pct, 0) > 0 THEN 1 ELSE 0 END),
        SUM(CASE WHEN COALESCE(perf_1d_pct, 0) < 0 THEN 1 ELSE 0 END)
      FROM rs_daily
      WHERE sdate >= (SELECT MIN(sdate) FROM (SELECT DISTINCT sdate FROM rs_daily ORDER BY sdate DESC LIMIT 90) d)
        AND stock_symbol REGEXP '^[A-Z]{1,5}$'
        AND close > 0
        AND volume > 100000
      GROUP BY sdate
      ORDER BY sdate
    `);
    breadthHistory = parseRows(breadthRaw, ["date", "total", "above50", "positiveRs", "rsLeaders", "advancing", "declining"]).map((row) => {
      const total = Number(row.total || 0), advancing = Number(row.advancing || 0), declining = Number(row.declining || 0);
      return {
        date: row.date,
        above50_pct: pct(total ? Number(row.above50 || 0) / total * 100 : null, null),
        positive_rs_pct: pct(total ? Number(row.positiveRs || 0) / total * 100 : null, null),
        advance_decline_pct: pct((advancing + declining) ? advancing / (advancing + declining) * 100 : null, null),
        rs_leaders: Number(row.rsLeaders || 0)
      };
    });
  }
  const [universeCount, above50, positiveRs, rsLeaders] = universeStats;
  const above50Pct = universeCount ? above50 / universeCount * 100 : 0;
  const positiveRsPct = universeCount ? positiveRs / universeCount * 100 : 0;
  const leadersPositiveRsPct = rsLeaders ? Math.min(100, positiveRs / Math.max(rsLeaders, 1) * 100) : positiveRsPct;
  const leadersAbove200Pct = pct(Math.min(100, Math.max(0, above50Pct - 8)), 0);
  const leadershipScore = pct((above50Pct * 0.35) + (leadersAbove200Pct * 0.30) + (positiveRsPct * 0.20) + (Math.max(0, Math.min(100, 50 + qqqRs)) * 0.15), 0);
  const metrics = {
    spy_drawdown_252d_pct: pctDistance(Number(last.close || 0), Math.max(...spy.slice(-252).map((row) => Number(row.close || 0)))),
    spy_close_vs_21d_pct: pctDistance(last.close, last.ma21),
    spy_close_vs_50d_pct: pctDistance(last.close, last.ma50),
    spy_close_vs_200d_pct: pctDistance(last.close, last.ma200),
    distribution_days_25d: dist25,
    accumulation_days_25d: acc25,
    distribution_bucket: distributionBucket(dist25),
    weekly_status: Number(last.close || 0) > Number(last.ma50 || 0) ? "GREEN" : Number(last.close || 0) > Number(last.ma200 || 0) ? "AMBER" : "RED",
    qqq_rs_63d_vs_spy_pct: pct(qqqRs, 0),
    iwm_rs_63d_vs_spy_pct: pct(iwmRs, 0),
    leadership_score: leadershipScore,
    leaders_above_50d_pct: pct(above50Pct, 0),
    leaders_above_200d_pct: leadersAbove200Pct,
    leaders_positive_rs_63d_pct: pct(leadersPositiveRsPct, 0)
  };
  const cycleBucket = cycleBucketFromMetrics(metrics);
  const allocation = cycleAllocation(cycleBucket, metrics);
  const invalidationTriggered = Number(metrics.distribution_days_25d || 0) >= 6 || (Number(metrics.spy_close_vs_50d_pct || 0) < 0 && ["BULL_TREND", "BULL_START"].includes(cycleBucket));
  const displayBucket = cycleBucket === "BULL_START" && allocation.gate === "DISTRIBUTION_DANGER" ? "BULL_START_UNDER_PRESSURE" : cycleBucket === "BULL_START" && allocation.gate !== "CLEAR" ? "BULL_START_SELECTIVE" : cycleBucket;
  const health = pct(Math.max(0, Math.min(100, 35 + Number(metrics.spy_close_vs_50d_pct || 0) * 3 + Number(metrics.spy_close_vs_200d_pct || 0) * 1.5 + leadershipScore * 0.35 - dist25 * 4 + acc25 * 2)), 0);
  const allocationRows = spy.map((row) => cycleAllocation(cycleBucketFromMetrics({ ...metrics, spy_close_vs_50d_pct: pctDistance(row.close, row.ma50), spy_close_vs_200d_pct: pctDistance(row.close, row.ma200), distribution_days_25d: row.distribution_day ? 6 : 3, weekly_status: Number(row.close || 0) > Number(row.ma50 || 0) ? "GREEN" : "RED", leadership_score: leadershipScore }), metrics));
  const backtest = marketCycleBacktest(spy, allocationRows);
  backtest.benchmarks = [
    ...(backtest.benchmarks || []),
    marketCycleBacktest(qqq, allocationRows).benchmarks?.[0] ? { ...marketCycleBacktest(qqq, allocationRows).benchmarks[0], strategy: "Buy & hold QQQ" } : { strategy: "Buy & hold QQQ", cagr_pct: null, max_drawdown_pct: null },
    marketCycleBacktest(iwm, allocationRows).benchmarks?.[0] ? { ...marketCycleBacktest(iwm, allocationRows).benchmarks[0], strategy: "Buy & hold IWM" } : { strategy: "Buy & hold IWM", cagr_pct: null, max_drawdown_pct: null }
  ];
  const history = spy.slice(-60).map((row) => ({
    date: row.date,
    market_health_score: pct(Math.max(0, Math.min(100, 50 + Number(pctDistance(row.close, row.ma50) || 0) * 3 - (row.distribution_day ? 8 : 0) + (row.follow_through_day ? 8 : 0))), 0),
    cycle_bucket: row.cycle_bucket || cycleBucket,
    spy_close: row.close
  }));
  const payload = {
    source: "bear_cycle_tracker",
    source_path: path.join(marketCycleOutputRoot, marketCycleTrackerDir),
    backtest_path: path.join(marketCycleOutputRoot, marketCycleBacktestDir),
    as_of_date: latestDate,
    last_updated_at: new Date().toISOString(),
    stale: false,
    lookback,
    cycle_bucket: displayBucket,
    raw_cycle_bucket: cycleBucket,
    dashboard_color: invalidationTriggered || allocation.gate === "DISTRIBUTION_DANGER" ? "AMBER" : marketCycleTone(cycleBucket),
    market_health_score: health,
    portfolio_posture: allocation.posture,
    action_decision: allocation.action,
    exposure_gate: allocation.gate,
    exposure_gate_reason: allocation.gateReason,
    invalidation_triggered: invalidationTriggered,
    target_long_index_exposure_pct: allocation.longPct,
    target_short_inverse_etf_exposure_pct: allocation.shortPct,
    exposure_cap_pct: allocation.exposureCapPct,
    recommended_weights: allocation.weights,
    leadership_tilt: Number(metrics.qqq_rs_63d_vs_spy_pct || 0) > 3 ? "Overweight QQQ versus SPY." : Number(metrics.iwm_rs_63d_vs_spy_pct || 0) > 2 ? "Risk appetite improving through IWM." : "Favor balanced SPY core exposure.",
    risk_invalidation: invalidationTriggered ? "TRIGGERED: distribution is at/above 6 or trend support is breached. Do not add full exposure until reset/confirmation improves." : "Reduce if SPY closes below 50d or distribution days reach 6.",
    next_transition_to_watch: ["BULL_TREND", "BULL_START"].includes(cycleBucket) ? "Watch for BEAR_START_SLOW if SPY loses 50d with distribution/breadth damage; upgrade only after distribution pressure resets." : "Watch for BULL_START if SPY reclaims 50d with follow-through and leadership confirmation.",
    entry_decision: allocation.action,
    entry_trigger: allocation.gate === "CLEAR" ? "Bull trend plus acceptable market health and leadership confirmation." : "Wait for distribution pressure to reset below 5 and leadership breadth to broaden before increasing exposure.",
    exit_trigger: "Reduce if distribution stays elevated or SPY loses 50d.",
    metrics,
    leadership_confirmation: {
      status: leadershipScore >= 60 && above50Pct >= 50 ? "CONFIRMED" : leadershipScore >= 45 ? "PARTIAL" : "WEAK",
      top_stocks: leadershipRows,
      leaders_down_now: leadershipDownRows,
      former_leaders_down_now: formerLeadershipDownRows,
      note: leadershipRows.length ? `RS250 leaders: ${leadershipRows.slice(0, 5).map((row) => row.symbol).join(", ")}` : "No RS250 leadership candidates available from cache."
    },
    breadth_history: breadthHistory,
    backtest,
    charts: Object.fromEntries(Object.entries(bySymbol).map(([symbol, symbolRows]) => [symbol, { symbol, rows: symbolRows }])),
    history,
    note: "Decision-support exposure guidance. Not an auto-trading signal."
  };
  marketCycleSnapshotCache.set(key, { createdAt: Date.now(), payload });
  for (const [cacheKey, cached] of marketCycleSnapshotCache.entries()) {
    if (Date.now() - cached.createdAt > 10 * 60 * 1000 || marketCycleSnapshotCache.size > 6) marketCycleSnapshotCache.delete(cacheKey);
  }
  return payload;
}

async function riskOpenTrades(settings) {
  const perTradeCapital = Number(settings.per_trade_capital || 0);
  const entryRiskPct = Number(settings.entry_risk_pct || 0);
  const riskPerTrade = perTradeCapital * entryRiskPct / 100;
  const goldenDate = await latestRsDailyDate();
  const raw = await optionalMysqlJson(`
    SELECT
      a.stock_symbol, a.status, a.entry_date, COALESCE(a.regime_date, a.entry_date), a.entry_price, COALESCE(a.why_it_fits,''), COALESCE(a.invalidate_if,''), COALESCE(m.industry, ''), COALESCE(m.sector, ''),
      r.open, r.high, r.low, r.close, r.volume, r.avg_volume_50, r.ma50, r.rs_val, r.rs_val_3m, r.mci, r.perf_5d_pct, r.perf_1d_pct
    FROM actionable_trades_daily a
    LEFT JOIN stock_sector_master m ON m.stock_symbol = a.stock_symbol
    LEFT JOIN rs_daily r ON r.stock_symbol = a.stock_symbol AND r.sdate = ${goldenDate ? sqlString(goldenDate) : "NULL"}
    WHERE a.status = 'OPEN'
    ORDER BY a.regime_date DESC, a.stock_symbol ASC
    LIMIT 100
  `);
  const rows = parseRows(raw, ["stock_symbol", "status", "entry_date", "signal_date", "entry_price", "why_it_fits", "invalidate_if", "industry", "sector", "open", "high", "low", "latest_close", "volume", "avg_volume_50", "ma50", "rs_val", "rs_val_3m", "mci", "perf_5d_pct", "perf_1d_pct"]);
  const symbols = rows.map((row) => row.stock_symbol).filter(Boolean);
  const historyBySymbol = await riskHistoryBySymbol(symbols);
  const groupStrength = await riskGroupStrength();
  const regime = await riskRegimeContext();
  return rows.map((trade) => {
    const entry = pct(trade.entry_price, null);
    const latest = pct(trade.latest_close, null);
    const shares = entry ? Math.floor(perTradeCapital / entry) : 0;
    const history = historyBySymbol.get(String(trade.stock_symbol || "").toUpperCase()) || [];
    const evaluation = evaluateSellRules({
      ...trade,
      entry,
      latest,
      history,
      groupStrength,
      regime,
      entryRiskPct,
      perTradeCapital,
      riskPerTrade
    });
    return {
      stock_symbol: trade.stock_symbol,
      current_pnl_pct: entry && latest != null ? pct((latest - entry) / entry * 100) : null,
      entry_date: trade.entry_date,
      entry_price: entry,
      latest_close: latest,
      current_price: latest,
      initial_stop: entry ? pct(entry * (1 - entryRiskPct / 100)) : null,
      hard_stop: entry ? pct(entry * 0.93) : null,
      max_loss_stop: entry ? pct(entry * 0.92) : null,
      profit_target: entry ? pct(entry * 1.20) : null,
      extended_target: entry ? pct(entry * 1.25) : null,
      shares_est: shares,
      position_dollars: pct(perTradeCapital),
      dollar_risk: pct(riskPerTrade),
      why_it_fits: trade.why_it_fits || "",
      invalidate_if: trade.invalidate_if || "",
      industry: trade.industry || "Unknown",
      sector: trade.sector || "Unknown",
      rs_val: pct(trade.rs_val, null),
      rs_val_3m: pct(trade.rs_val_3m, null),
      perf_5d_pct: pct(trade.perf_5d_pct, null),
      perf_1d_pct: pct(trade.perf_1d_pct, null),
      volume: Number(trade.volume || 0),
      avg_volume_50: Number(trade.avg_volume_50 || 0),
      ...evaluation
    };
  });
}

async function riskHistoryBySymbol(symbols = []) {
  const unique = [...new Set(symbols.map((symbol) => String(symbol || "").toUpperCase()).filter(Boolean))].slice(0, 100);
  const map = new Map(unique.map((symbol) => [symbol, []]));
  if (!unique.length) return map;
  const goldenDate = await latestRsDailyDate();
  if (!goldenDate) return map;
  const raw = await optionalMysqlJson(`
    SELECT stock_symbol, sdate, open, high, low, close, volume, rs_val, rs_val_3m, ma50, avg_volume_50
    FROM rs_daily
    WHERE stock_symbol IN (${unique.map(sqlString).join(",")})
      AND sdate BETWEEN DATE_SUB(${sqlString(goldenDate)}, INTERVAL 280 DAY) AND ${sqlString(goldenDate)}
    ORDER BY stock_symbol ASC, sdate ASC
  `);
  for (const row of parseRows(raw, ["symbol", "date", "open", "high", "low", "close", "volume", "rs", "rs3", "ma50", "avgVolume50"])) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push({
      date: row.date,
      open: Number(row.open || 0),
      high: Number(row.high || 0),
      low: Number(row.low || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0),
      rs: Number(row.rs || 0),
      rs3: Number(row.rs3 || 0),
      ma50: Number(row.ma50 || 0),
      avgVolume50: Number(row.avgVolume50 || 0)
    });
  }
  return map;
}

async function riskGroupStrength() {
  const goldenDate = await latestRsDailyDate();
  if (!goldenDate) return { sector: new Map(), industry: new Map() };
  const raw = await optionalMysqlJson(`
    SELECT 'sector', COALESCE(sector,''), ROUND(AVG(rs_val),2), ROUND(AVG(perf_5d_pct),2)
    FROM rs_daily
    WHERE sdate=${sqlString(goldenDate)} AND volume > 100000 AND sector IS NOT NULL AND sector <> ''
    GROUP BY sector
    UNION ALL
    SELECT 'industry', COALESCE(industry,''), ROUND(AVG(rs_val),2), ROUND(AVG(perf_5d_pct),2)
    FROM rs_daily
    WHERE sdate=${sqlString(goldenDate)} AND volume > 100000 AND industry IS NOT NULL AND industry <> ''
    GROUP BY industry
  `);
  const out = { sector: new Map(), industry: new Map() };
  for (const row of parseRows(raw, ["kind", "name", "rs", "perf5"])) {
    const score = Number(row.rs || 0);
    const perf = Number(row.perf5 || 0);
    const tone = score >= 80 && perf >= 0 ? "good" : score < 55 || perf <= -3 ? "bad" : "neutral";
    out[row.kind]?.set(row.name, { score: pct(score, null), perf5: pct(perf, null), tone });
  }
  return out;
}

async function riskRegimeContext() {
  const goldenDate = await latestRsDailyDate();
  const raw = await optionalMysqlJson(`SELECT regime_date, quarterly_signal, daily_signal, regime_classification, risk_posture FROM market_regime_daily WHERE regime_date <= ${goldenDate ? sqlString(goldenDate) : "CURRENT_DATE"} ORDER BY regime_date DESC LIMIT 1`);
  const [date, quarterly, daily, classification, posture] = raw ? raw.split("\t") : [];
  return { date, quarterly, daily, classification, posture, tone: String(quarterly || "").toUpperCase() === "GREEN" ? "good" : String(quarterly || "").toUpperCase() === "RED" ? "bad" : "neutral" };
}

function evaluateSellRules(input) {
  const entry = Number(input.entry);
  const latest = Number(input.latest);
  const entryDate = input.entry_date || input.signal_date;
  const latestDate = input.history.at(-1)?.date || new Date().toISOString().slice(0, 10);
  const daysHeld = riskCalendarDays(entryDate, latestDate);
  const weeksHeld = daysHeld == null ? null : pct(daysHeld / 7, 1);
  const sinceEntry = input.history.filter((row) => !entryDate || row.date >= entryDate);
  const latestRow = sinceEntry.at(-1) || input.history.at(-1) || {};
  const prevRow = sinceEntry.at(-2) || {};
  const highestPrice = Math.max(entry || 0, ...sinceEntry.map((row) => Number(row.high || row.close || 0)).filter(Number.isFinite));
  const index = input.history.length - 1;
  const ma10 = index >= 0 ? movingAverage(input.history, index, 10) : null;
  const ma21 = index >= 0 ? movingAverage(input.history, index, 21) : null;
  const ma50 = Number(latestRow.ma50 || input.ma50 || 0) || (index >= 0 ? movingAverage(input.history, index, 50) : null);
  const volume = Number(input.volume || latestRow.volume || 0);
  const avgVolume50 = Number(input.avg_volume_50 || latestRow.avgVolume50 || 0);
  const gainPct = entry && latest ? (latest - entry) / entry * 100 : null;
  const hardStop = entry ? entry * 0.93 : null;
  const maxLossStop = entry ? entry * 0.92 : null;
  const stopDistancePct = latest && hardStop ? (latest - hardStop) / latest * 100 : null;
  const rs = Number(input.rs_val || 0);
  const rs3 = Number(input.rs_val_3m || 0);
  const rsTrend = Number.isFinite(rs) && Number.isFinite(rs3) ? rs + 8 < rs3 ? "FADING" : rs >= rs3 ? "IMPROVING" : "STABLE" : "UNKNOWN";
  const sectorStrength = input.groupStrength.sector.get(input.sector || "") || { score: null, perf5: null, tone: "neutral" };
  const industryStrength = input.groupStrength.industry.get(input.industry || "") || { score: null, perf5: null, tone: "neutral" };
  const highVolume = Boolean(avgVolume50 && volume >= avgVolume50 * 1.35);
  const gapDown = Boolean(prevRow.close && latestRow.open && latestRow.open < prevRow.close * 0.96 && highVolume);
  const trendBreak50 = Boolean(ma50 && latest && latest < ma50 && highVolume);
  const trendBreak21 = Boolean(ma21 && latest && latest < ma21);
  const superStock = Boolean(gainPct != null && gainPct >= 20 && daysHeld != null && daysHeld <= 21);
  const timeState = superStock ? "Super Stock Hold" : weeksHeld == null ? "Unknown" : weeksHeld < 3 ? "Early Trade" : weeksHeld < 8 ? "Normal Hold" : weeksHeld < 13 ? "Patience Extension" : "Time Exit Review";
  const capitalEfficiency = weeksHeld && weeksHeld > 0 && gainPct != null ? pct(gainPct / weeksHeld, 2) : null;
  let recommendation = "HOLD";
  let state = "HOLD";
  let activeRule = "Hold By Rule";
  let journalReason = "USER_DEFERRED_DECISION";
  let explanation = "No existing MTM sell rule is triggered. Continue to respect the stored risk line.";
  if (gainPct != null && gainPct <= -8) {
    recommendation = "URGENT SELL"; state = "URGENT SELL"; activeRule = "Rule A: Hard Stop"; journalReason = "MAX_LOSS_EXIT"; explanation = "Price is down 8% or more from entry; maximum loss rule overrides patience.";
  } else if (gainPct != null && gainPct <= -7) {
    recommendation = "SELL ALL"; state = "SELL"; activeRule = "Rule A: Hard Stop"; journalReason = "STOP_LOSS_EXIT"; explanation = "Price is down at least 7% from entry; hard stop rule is active.";
  } else if (trendBreak50) {
    recommendation = "SELL ALL"; state = "SELL"; activeRule = "Rule F: 50-Day Breakdown"; journalReason = "FIFTY_DAY_BREAK_EXIT"; explanation = "Price is below the 50 DMA on high volume.";
  } else if (gapDown) {
    recommendation = trendBreak21 || rsTrend === "FADING" ? "SELL ALL" : "TIGHTEN STOP";
    state = recommendation === "SELL ALL" ? "SELL" : "TIGHTEN STOP";
    activeRule = "Rule G: Gap-Down";
    journalReason = "GAP_DOWN_EXIT";
    explanation = "Gap-down on high volume requires immediate review; escalation depends on support and RS.";
  } else if (superStock) {
    recommendation = "HOLD - SUPER STOCK RULE ACTIVE"; state = "HOLD"; activeRule = "Rule D: Super Stock Rule"; journalReason = "SUPER_STOCK_HOLD"; explanation = "Gain reached 20% within 3 weeks; normal profit taking is overridden by the 8-week hold rule.";
  } else if (gainPct != null && gainPct >= 25) {
    recommendation = "SELL MOST"; state = "TAKE PROFIT"; activeRule = "Rule C: Standard Profit Rule"; journalReason = "STANDARD_PROFIT_TAKE"; explanation = "Gain is in the extended +25% profit zone without super-stock override.";
  } else if (gainPct != null && gainPct >= 20) {
    recommendation = "TAKE PARTIAL PROFIT"; state = "TAKE PROFIT"; activeRule = "Rule C: Standard Profit Rule"; journalReason = "STANDARD_PROFIT_TAKE"; explanation = "Gain is in the standard +20% profit zone; consider partial profit or tighter trail.";
  } else if (weeksHeld != null && weeksHeld >= 13 && (gainPct == null || gainPct < 5) && rsTrend !== "IMPROVING") {
    recommendation = "TIME EXIT"; state = "TIME EXIT REVIEW"; activeRule = "Rule I: Time Exit / Patience"; journalReason = "TIME_EXIT_13_WEEK_REVIEW"; explanation = "Position is beyond 13 weeks with weak progress and no improving RS confirmation.";
  } else if (weeksHeld != null && weeksHeld >= 8 && (gainPct == null || gainPct < 3)) {
    recommendation = "HOLD - PATIENCE ALLOWED"; state = "TIME EXIT REVIEW"; activeRule = "Rule I: 8-Week Review"; journalReason = "TIME_EXIT_8_WEEK_REVIEW"; explanation = "8-week checkpoint reached; review structure, RS, and group strength before extending to 13 weeks.";
  } else if (input.regime.tone === "bad" || sectorStrength.tone === "bad" || industryStrength.tone === "bad" || rsTrend === "FADING") {
    recommendation = "TIGHTEN STOP"; state = "TIGHTEN STOP"; activeRule = "Rule H: Market / Sector Weakness"; journalReason = rsTrend === "FADING" ? "RS_DETERIORATION_EXIT" : sectorStrength.tone === "bad" || industryStrength.tone === "bad" ? "SECTOR_WEAKNESS_EXIT" : "MARKET_REGIME_TIGHTEN"; explanation = "Market, group, or RS context is weakening; do not sell automatically, but tighten risk.";
  } else if (weeksHeld != null && weeksHeld < 8) {
    recommendation = "HOLD - PATIENCE ALLOWED"; state = "HOLD"; activeRule = "Rule I: Patience Rule"; journalReason = "USER_DEFERRED_DECISION"; explanation = "Trade is still inside the normal 8-week patience window and has not failed.";
  }
  const protectionScore = riskProtectionScore({ stopDistancePct, gainPct, latest, ma21, ma50, rsTrend, regimeTone: input.regime.tone, sectorTone: sectorStrength.tone, industryTone: industryStrength.tone, weeksHeld });
  return {
    days_held: daysHeld,
    weeks_held: weeksHeld,
    eight_week_date: riskAddDays(entryDate, 56),
    thirteen_week_date: riskAddDays(entryDate, 91),
    highest_price_since_entry: highestPrice ? pct(highestPrice) : null,
    ma10: pct(ma10, null),
    ma21: pct(ma21, null),
    ma50: pct(ma50, null),
    volume_ratio_50: avgVolume50 ? pct(volume / avgVolume50, 2) : null,
    stop_distance_pct: pct(stopDistancePct, null),
    current_sell_rule_state: state,
    active_rule: activeRule,
    recommendation,
    journal_reason: journalReason,
    recommendation_explanation: explanation,
    time_state: timeState,
    rs_trend: rsTrend,
    market_regime: input.regime.classification || input.regime.posture || "Unknown",
    market_regime_date: input.regime.date,
    sector_strength: sectorStrength,
    industry_strength: industryStrength,
    protection_score: protectionScore,
    capital_efficiency_score: capitalEfficiency,
    last_reviewed_at: new Date().toISOString()
  };
}

function riskSellRuleSummary(trades = []) {
  const count = (state) => trades.filter((trade) => trade.current_sell_rule_state === state).length;
  const near = (weeks) => trades.filter((trade) => Number(trade.weeks_held || 0) >= weeks - 0.5 && Number(trade.weeks_held || 0) < weeks).length;
  const unrealized = trades.length ? pct(mean(trades.map((trade) => Number(trade.current_pnl_pct))) || 0) : 0;
  return {
    hold: count("HOLD"),
    tightenStop: count("TIGHTEN STOP"),
    takeProfit: count("TAKE PROFIT"),
    timeExitReview: count("TIME EXIT REVIEW"),
    sell: count("SELL"),
    urgentSell: count("URGENT SELL"),
    nearHardStop: trades.filter((trade) => Number(trade.stop_distance_pct || 999) <= 2).length,
    near8Week: near(8),
    near13Week: near(13),
    unrealizedPnlPct: unrealized
  };
}

function riskProtectionScore({ stopDistancePct, gainPct, latest, ma21, ma50, rsTrend, regimeTone, sectorTone, industryTone, weeksHeld }) {
  let score = 50;
  if (Number.isFinite(gainPct)) score += Math.max(-25, Math.min(20, gainPct));
  if (Number.isFinite(stopDistancePct)) score += stopDistancePct >= 8 ? 8 : stopDistancePct >= 3 ? 2 : -15;
  if (latest && ma21) score += latest >= ma21 ? 8 : -8;
  if (latest && ma50) score += latest >= ma50 ? 8 : -16;
  score += rsTrend === "IMPROVING" ? 10 : rsTrend === "FADING" ? -12 : 2;
  score += regimeTone === "good" ? 6 : regimeTone === "bad" ? -10 : 0;
  score += sectorTone === "good" ? 5 : sectorTone === "bad" ? -8 : 0;
  score += industryTone === "good" ? 5 : industryTone === "bad" ? -8 : 0;
  if (Number(weeksHeld || 0) > 13 && Number(gainPct || 0) < 5) score -= 10;
  return pct(clamp(score, 0, 100), 0);
}

function riskCalendarDays(start, end) {
  if (!start || !end) return null;
  const a = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(end).slice(0, 10)}T00:00:00Z`);
  const diff = Math.round((b - a) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

function riskAddDays(start, days) {
  if (!start) return null;
  const date = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function recordRiskSellRuleAction(user, body = {}) {
  const symbol = String(body.symbol || "").toUpperCase().trim();
  if (!symbol) throw new Error("Symbol is required.");
  const decision = String(body.decision || "").toUpperCase().trim();
  const allowed = new Set(["ACCEPT_RECOMMENDATION", "OVERRIDE_HOLD", "OVERRIDE_SELL", "DEFER_REVIEW"]);
  if (!allowed.has(decision)) throw new Error("Unsupported risk decision.");
  const metrics = {
    symbol,
    user: user?.username || user?.id || "unknown",
    decision,
    recommendation: body.recommendation || "",
    journal_reason: body.journalReason || body.journal_reason || riskDecisionJournalReason(decision),
    trigger_price: pct(body.triggerPrice ?? body.trigger_price, null),
    gain_loss_pct: pct(body.gainLossPct ?? body.gain_loss_pct, null),
    weeks_held: pct(body.weeksHeld ?? body.weeks_held, null),
    active_rule: body.activeRule || body.active_rule || "",
    note: body.note || "",
    captured_at: new Date().toISOString()
  };
  await persistTradingSystemJournal(
    "risk_sell_rule_sandbox",
    decision,
    decision === "OVERRIDE_SELL" || decision === "ACCEPT_RECOMMENDATION" ? "INFO" : "WARN",
    metrics,
    [`${symbol}: ${decision.replaceAll("_", " ")} for ${metrics.recommendation || "risk recommendation"}.`],
    [metrics.note || "Review follow-up performance after 5, 10, and 20 trading days."],
    null,
    metrics.journal_reason
  );
  return { ok: true, action: metrics };
}

function riskDecisionJournalReason(decision) {
  if (decision === "OVERRIDE_HOLD") return "USER_OVERRIDE_HOLD";
  if (decision === "OVERRIDE_SELL") return "USER_OVERRIDE_SELL";
  if (decision === "DEFER_REVIEW") return "USER_DEFERRED_DECISION";
  return "SELL_RULE_RECOMMENDATION_ACCEPTED";
}

async function productionGuardrailModel() {
  const freshness = await freshnessModel();
  const goldenDate = await latestRsDailyDate();
  const latestRaw = await optionalMysqlJson(`SELECT quarterly_signal, risk_posture FROM market_regime_daily WHERE regime_date <= ${goldenDate ? sqlString(goldenDate) : "CURRENT_DATE"} ORDER BY regime_date DESC LIMIT 1`);
  const [quarterlySignal, riskPosture] = latestRaw ? latestRaw.split("\t") : [];
  const blocking = freshness.items.filter((item) => item.label !== "RS Daily" && item.status === "STALE");
  const reasons = blocking.map((item) => `${item.label} stale by ${item.lag} day(s)`);
  if (String(quarterlySignal || "").toUpperCase() !== "GREEN") reasons.push(`Quarterly signal is ${quarterlySignal || "UNKNOWN"}`);
  if (!["RISK-ON", "RISK_ON", "SELECTIVE"].includes(String(riskPosture || "").toUpperCase())) reasons.push(`Risk posture is ${riskPosture || "UNKNOWN"}`);
  const locked = reasons.length > 0;
  return { buy_locked: locked, tone: locked ? "bad" : "good", state: locked ? "BUY LOCKED" : "BUY PERMITTED", reasons, freshness, latest_regime: { quarterly_signal: quarterlySignal, risk_posture: riskPosture } };
}

async function freshnessModel() {
  const rsDaily = await latestRsDailyDate();
  const raw = await mysqlJson(`
    SELECT
      (SELECT MAX(regime_date) FROM market_regime_daily WHERE regime_date <= ${rsDaily ? sqlString(rsDaily) : "CURRENT_DATE"}),
      (SELECT MAX(regime_date) FROM market_dashboard_daily WHERE regime_date <= ${rsDaily ? sqlString(rsDaily) : "CURRENT_DATE"}),
      (SELECT MAX(trade_date) FROM rs250_signals WHERE trade_date <= ${rsDaily ? sqlString(rsDaily) : "CURRENT_DATE"}),
      (SELECT MAX(regime_date) FROM actionable_trades_daily WHERE regime_date <= ${rsDaily ? sqlString(rsDaily) : "CURRENT_DATE"})
  `);
  const [marketRegime, dashboard, rs250Signals, actionableTrades] = raw.split("\t");
  const anchor = rsDaily;
  const points = [["RS Daily", rsDaily], ["Market Regime", marketRegime], ["Dashboard", dashboard], ["RS250 Signals", rs250Signals], ["Actionable Trades", actionableTrades]];
  const items = points.map(([label, date]) => {
    const lag = dayLag(anchor, date);
    const stale = lag == null || lag > 1;
    return { label, date, lag, tone: stale ? "bad" : "good", status: stale ? "STALE" : "CURRENT" };
  });
  return { anchor, items, stale_count: items.filter((item) => item.status === "STALE").length, tone: items.some((item) => item.status === "STALE") ? "bad" : "good" };
}

function dayLag(anchor, value) {
  if (!anchor || !value) return null;
  const a = new Date(`${anchor}T00:00:00Z`);
  const b = new Date(`${value}T00:00:00Z`);
  const diff = Math.round((a - b) / 86400000);
  return Number.isFinite(diff) ? diff : null;
}

function riskSellRules() {
  return [
    "Sell any buy point that goes down 7% to 8% from the buy point.",
    "Sell most stocks that rise 20% to 25% from the pivot unless there is a specific rule-based reason to hold longer.",
    "When a stock is up 7% to 11%, move the sell point to about -5%, then trail 11% to 14.5% below new highs.",
    "After three consecutive stock failures, stop buying and complete post-analysis before taking new trades.",
    "Sell all if a stock crashes through the 50-day line on high volume.",
    "Probably sell all if a stock gaps down on high volume.",
    "If the market enters correction, sell stocks that weaken, break support, or show steep RS deterioration.",
    "Do not sell unless there is a specific rule-based reason."
  ];
}

function riskCushionLadder() {
  return [
    { advance: "11-12%", raise_stop: "-5%", trail: "14.5% below high", breakeven: "17%", profile: "Wide cushion" },
    { advance: "10%", raise_stop: "-4.5%", trail: "13% below high", breakeven: "15%", profile: "Medium cushion" },
    { advance: "8%", raise_stop: "-4%", trail: "11% below high", breakeven: "12%", profile: "Less cushion" },
    { advance: "7%", raise_stop: "-4%", trail: "10% below high", breakeven: "10%", profile: "Smallest cushion" }
  ];
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/(api_token=)[^&\s]+/gi, "$1REDACTED")
    .replace(/(api_token%3D)[^%&\s]+/gi, "$1REDACTED")
    .replace(/(MTM_EODHD_API_TOKEN=)[^\s]+/gi, "$1REDACTED")
    .replace(/(EODHD_API_TOKEN=)[^\s]+/gi, "$1REDACTED");
}

async function rsAgentStatus() {
  const calendar = await rsDailyCalendarStatus();
  const base = rsDailyAgent.job || {
    id: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    total: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    currentSymbol: "",
    activeShards: 0,
    completedShards: 0,
    failures: [],
    events: [],
    shards: rsDailyShardRanges.map(([start, end]) => ({
      id: `download_${start.toLowerCase()}${end.toLowerCase()}`,
      range: `${start}-${end}`,
      start,
      end,
      status: "idle",
      totalSymbols: 0,
      recordsInserted: 0,
      failure: null,
      startedAt: null,
      finishedAt: null
    })),
    options: {}
  };
  return { ...base, calendar };
}

async function rsDailyCalendarStatus() {
  const latestCompletedDate = (await optionalMysqlJson(`SELECT MAX(sdate) FROM rs_daily`)) || null;
  const dueDate = lastCompletedNasdaqBusinessDay();
  const loadPlan = await planRsDailyLoad({ dueDate, latestCompletedDate });
  return {
    market: "NASDAQ",
    latestCompletedDate,
    dueDate,
    currentDateCompleted: latestCompletedDate,
    isCurrent: Boolean(latestCompletedDate && latestCompletedDate >= dueDate),
    lagBusinessDays: latestCompletedDate ? nasdaqBusinessDayLag(latestCompletedDate, dueDate) : null,
    loadPlan
  };
}

async function marketBusinessDayStatus() {
  if (marketBusinessDayStatusCache && Date.now() - marketBusinessDayStatusCache.createdAt < 30000) return marketBusinessDayStatusCache.payload;
  const dueDate = lastCompletedNasdaqBusinessDay();
  const expected = Number(await optionalMysqlJson(`SELECT COUNT(*) FROM stock_sector_master WHERE stock_symbol REGEXP '^[A-Z]'`) || 0);
  const latestLoadedDate = (await optionalMysqlJson(`SELECT MAX(sdate) FROM rs_daily`)) || null;
  const latestCompleteRaw = await optionalMysqlJson(`
    SELECT sdate, symbols, bad_ohlcv
    FROM (
      SELECT
        sdate,
        COUNT(DISTINCT stock_symbol) AS symbols,
        SUM(CASE
          WHEN open IS NULL OR open <= 0
            OR high IS NULL OR high <= 0
            OR low IS NULL OR low <= 0
            OR close IS NULL OR close <= 0
            OR volume IS NULL OR volume <= 0
          THEN 1 ELSE 0 END
        ) AS bad_ohlcv
      FROM rs_daily
      WHERE sdate <= ${sqlString(dueDate)}
        AND sdate >= DATE_SUB(${sqlString(dueDate)}, INTERVAL 30 DAY)
      GROUP BY sdate
    ) daily
    WHERE symbols >= ${Math.max(1, Math.floor(expected * 0.90))}
    ORDER BY sdate DESC
    LIMIT 1
  `);
  const [latestCompleteDate, completeSymbols, badOhlcv] = latestCompleteRaw ? latestCompleteRaw.split("\t") : [];
  const dueRaw = await optionalMysqlJson(`
    SELECT
      COUNT(DISTINCT stock_symbol),
      SUM(CASE
        WHEN open IS NULL OR open <= 0
          OR high IS NULL OR high <= 0
          OR low IS NULL OR low <= 0
          OR close IS NULL OR close <= 0
          OR volume IS NULL OR volume <= 0
        THEN 1 ELSE 0 END
      )
    FROM rs_daily
    WHERE sdate = ${sqlString(dueDate)}
  `);
  const [dueSymbolsRaw, dueBadRaw] = dueRaw ? dueRaw.split("\t") : [];
  const dueSymbols = Number(dueSymbolsRaw || 0);
  const dueBadOhlcv = Number(dueBadRaw || 0);
  const coverageRatio = expected ? pct(dueSymbols / expected * 100) : 0;
  const isCurrent = latestLoadedDate === dueDate && coverageRatio >= 90;
  const updating = Boolean(rsDailyAgent.running || rsDailyMonitorAgent.running || dailyRsCacheMeta.warming);
  const payload = {
    market: "NASDAQ",
    source: "mtm.golden_business_date",
    dueDate,
    latestLoadedDate,
    latestCompleteDate: latestCompleteDate || null,
    expectedSymbols: expected,
    completeSymbols: Number(completeSymbols || 0),
    dueSymbols,
    dueBadOhlcv,
    coverageRatio,
    isCurrent,
    updating,
    tone: isCurrent ? "green" : "red",
    state: isCurrent ? "CURRENT" : updating ? "UPDATING" : "STALE",
    message: isCurrent
      ? `OHLCV complete through ${dueDate}.`
      : `OHLCV complete through ${latestCompleteDate || "none"}; Nasdaq business day due ${dueDate}.`,
    checkedAt: new Date().toISOString()
  };
  marketBusinessDayStatusCache = { createdAt: Date.now(), payload };
  return payload;
}

async function planRsDailyLoad(options = {}) {
  const dueDate = options.dueDate || lastCompletedNasdaqBusinessDay();
  const latestCompletedDate = options.latestCompletedDate ?? ((await optionalMysqlJson(`SELECT MAX(sdate) FROM rs_daily`)) || null);
  const cacheKey = `${dueDate}|${latestCompletedDate || ""}`;
  if (!options.force && rsDailyLoadPlanCache?.key === cacheKey && Date.now() - rsDailyLoadPlanCache.createdAt < 30000) {
    return rsDailyLoadPlanCache.plan;
  }
  const initialLoad = !latestCompletedDate;
  const fromDate = initialLoad ? addDays(dueDate, -Math.ceil(dailyRsCacheDays * 1.55)) : nextNasdaqBusinessDay(latestCompletedDate);
  const missingBusinessDates = initialLoad ? [] : nasdaqBusinessDaysBetween(fromDate, dueDate);
  const shardCase = `
    CASE
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'A' AND 'B' THEN 'A-B'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'C' AND 'D' THEN 'C-D'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'E' AND 'G' THEN 'E-G'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'H' AND 'L' THEN 'H-L'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'M' AND 'O' THEN 'M-O'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'P' AND 'R' THEN 'P-R'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'S' AND 'T' THEN 'S-T'
      WHEN LEFT(UPPER(stock_symbol), 1) BETWEEN 'U' AND 'Z' THEN 'U-Z'
      ELSE 'OTHER'
    END`;
  const expectedRows = parseRows(await optionalMysqlJson(`
    SELECT ${shardCase} AS shard_range, COUNT(*) AS expected_symbols
    FROM stock_sector_master
    WHERE stock_symbol IS NOT NULL AND stock_symbol <> ''
    GROUP BY shard_range
  `), ["range", "expectedSymbols"]);
  const dueRows = parseRows(await optionalMysqlJson(`
    SELECT ${shardCase} AS shard_range, COUNT(DISTINCT stock_symbol) AS loaded_symbols
    FROM rs_daily
    WHERE sdate = ${sqlString(dueDate)} AND stock_symbol IS NOT NULL AND stock_symbol <> ''
    GROUP BY shard_range
  `), ["range", "loadedSymbols"]);
  const expectedByRange = new Map(expectedRows.map((row) => [row.range, Number(row.expectedSymbols || 0)]));
  const loadedByRange = new Map(dueRows.map((row) => [row.range, Number(row.loadedSymbols || 0)]));
  const expectedSymbols = rsDailyShardRanges.reduce((sum, [start, end]) => sum + Number(expectedByRange.get(`${start}-${end}`) || 0), 0);
  const shardRows = rsDailyShardRanges.map(([start, end]) => {
    const range = `${start}-${end}`;
    const expected = Number(expectedByRange.get(range) || 0);
    const loaded = Number(loadedByRange.get(range) || 0);
    return {
      start,
      end,
      range,
      expectedSymbols: expected,
      missingDueRows: Math.max(0, expected - loaded),
      latestShardDate: latestCompletedDate
    };
  });
  const missingDueRows = shardRows.reduce((sum, row) => sum + row.missingDueRows, 0);
  const staleByDate = initialLoad || Boolean(latestCompletedDate && latestCompletedDate < dueDate);
  const needsLoad = initialLoad || staleByDate || missingDueRows > 0;
  const reason = initialLoad
    ? "INITIAL_LOAD"
    : staleByDate
      ? "MISSING_BUSINESS_DATES"
      : missingDueRows > 0
        ? "SYMBOL_GAPS_ON_DUE_DATE"
        : "CURRENT";
  const plan = {
    source: "myts.rs_daily.incremental_plan",
    dueDate,
    latestCompletedDate,
    fromDate: needsLoad ? fromDate : null,
    toDate: needsLoad ? dueDate : null,
    initialLoad,
    needsLoad,
    reason,
    expectedSymbols,
    missingDueRows,
    missingBusinessDates,
    missingBusinessDayCount: missingBusinessDates.length,
    shardPlan: shardRows.map((row) => ({
      ...row,
      action: needsLoad && (initialLoad || staleByDate || row.missingDueRows > 0) ? "load" : "skip"
    }))
  };
  rsDailyLoadPlanCache = { key: cacheKey, createdAt: Date.now(), plan };
  return plan;
}

function nextNasdaqBusinessDay(dateText) {
  let cursor = addDays(dateText, 1);
  while (!isNasdaqBusinessDay(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

function nasdaqBusinessDaysBetween(start, end) {
  const days = [];
  if (!start || !end || start > end) return days;
  let cursor = start;
  while (cursor <= end) {
    if (isNasdaqBusinessDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function lastCompletedNasdaqBusinessDay() {
  const now = easternNow();
  let candidate = now.date;
  if (!isNasdaqBusinessDay(candidate) || now.hour < 16) candidate = addDays(candidate, -1);
  while (!isNasdaqBusinessDay(candidate)) candidate = addDays(candidate, -1);
  return candidate;
}

function easternNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour || 0), minute: Number(parts.minute || 0) };
}

function nasdaqBusinessDayLag(completed, due) {
  if (!completed || completed >= due) return 0;
  let lag = 0;
  let cursor = completed;
  while (cursor < due) {
    cursor = addDays(cursor, 1);
    if (isNasdaqBusinessDay(cursor)) lag += 1;
  }
  return lag;
}

function isNasdaqBusinessDay(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !nasdaqHolidaySet(date.getUTCFullYear()).has(dateText);
}

function nasdaqHolidaySet(year) {
  const dates = [
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    addDays(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ];
  return new Set(dates.filter(Boolean));
}

function observedFixedHoliday(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  if (dow === 0) date.setUTCDate(day + 1);
  if (dow === 6) date.setUTCDate(day - 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + (nth - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const date = new Date(Date.UTC(year, month, 0));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function startRsDailyAgent(options = {}) {
  if (rsDailyAgent.running) {
    return {
      ...(rsDailyAgent.job || {}),
      ok: true,
      alreadyRunning: true,
      message: "RS Daily download agent is already running."
    };
  }
  const agentEodhdToken = await effectiveEodhdToken(options.userId);
  if (!agentEodhdToken && !options.dryRun) {
    throw new Error("MTM_EODHD_API_TOKEN or EODHD_API_TOKEN is required.");
  }
  const reservedJob = {
    id: `rs-${Date.now()}`,
    status: "starting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    currentSymbol: "",
    activeShards: 0,
    completedShards: 0,
    failures: [],
    events: [{ at: new Date().toISOString(), level: "info", text: "Reserving RS Daily agent while incremental plan is computed." }],
    shards: [],
    options: { dryRun: Boolean(options.dryRun) }
  };
  rsDailyAgent.running = true;
  rsDailyAgent.job = reservedJob;
  try {
    const calendar = await rsDailyCalendarStatus();
    const plan = calendar.loadPlan || await planRsDailyLoad(calendar);
    const forceReload = Boolean(options.forceReload);
    const maxParallelShards = clamp(Number(options.maxParallelShards || 2), 1, rsDailyShardRanges.length);
    const plannedRanges = new Map((plan.shardPlan || []).map((item) => [item.range, item]));
    const shards = rsDailyShardRanges.map(([start, end]) => {
      const planned = plannedRanges.get(`${start}-${end}`) || {};
      const shouldLoad = forceReload || planned.action === "load";
      return {
      id: `download_${start.toLowerCase()}${end.toLowerCase()}`,
      range: `${start}-${end}`,
      start,
      end,
      status: shouldLoad ? "queued" : "skipped",
      action: shouldLoad ? "load" : "skip",
      reason: shouldLoad ? (forceReload ? "FORCE_RELOAD" : plan.reason) : "CURRENT",
      pid: null,
      totalSymbols: Number(planned.expectedSymbols || 0),
      missingDueRows: Number(planned.missingDueRows || 0),
      latestShardDate: planned.latestShardDate || null,
      recordsInserted: 0,
      failure: null,
      startedAt: null,
      finishedAt: null,
      stdoutTail: [],
      stderrTail: []
      };
    });
    const runnableShards = shards.filter((shard) => shard.action === "load");
    const job = {
      ...reservedJob,
      status: runnableShards.length ? "running" : "skipped",
      finishedAt: runnableShards.length ? null : new Date().toISOString(),
      total: shards.length,
      processed: shards.filter((shard) => shard.status === "skipped").length,
      completedShards: shards.filter((shard) => shard.status === "skipped").length,
      events: [{
        at: new Date().toISOString(),
        level: "info",
        text: runnableShards.length
          ? `Incremental plan ${plan.reason}: ${runnableShards.length}/${shards.length} shard(s), ${plan.fromDate || "bootstrap"} to ${plan.toDate || plan.dueDate}.`
          : `RS Daily is current for ${plan.dueDate}; no shard reload required.`
      }],
      shards,
      options: {
        loader: "myts_prod_local.utils.load_marketdata_from_eodh",
        source: "myts_prod_local.dag.json",
        shardRanges: runnableShards.map((shard) => shard.range),
        maxParallelShards,
        dryRun: Boolean(options.dryRun),
        forceReload,
        eodhdApiToken: agentEodhdToken,
        plan
      },
      plan
    };
    if (!runnableShards.length) {
      rsDailyAgent.running = false;
      rsDailyAgent.job = job;
      return job;
    }
    rsDailyLoadPlanCache = null;
    rsDailyAgent.job = job;
    runRsDailyShardJob(job).catch((error) => {
      job.status = "failed";
      job.failures.push({ symbol: "JOB", shard: "JOB", error: error.message });
      job.events.unshift({ at: new Date().toISOString(), level: "error", text: error.message });
      job.finishedAt = new Date().toISOString();
      rsDailyAgent.running = false;
    });
    return job;
  } catch (error) {
    reservedJob.status = "failed";
    reservedJob.finishedAt = new Date().toISOString();
    reservedJob.failures.push({ symbol: "JOB", shard: "JOB", error: error.message });
    reservedJob.events.unshift({ at: new Date().toISOString(), level: "error", text: error.message });
    rsDailyAgent.running = false;
    throw error;
  }
}

async function runRsDailyShardJob(job) {
  const runnableShards = job.shards.filter((shard) => shard.action !== "skip");
  job.events.unshift({ at: new Date().toISOString(), level: "info", text: `Started production rs_daily loader across ${runnableShards.length}/${job.total} due shards.` });
  let nextIndex = 0;
  const workers = Array.from({ length: job.options.maxParallelShards }, async () => {
    while (nextIndex < runnableShards.length) {
      const shard = runnableShards[nextIndex++];
      await runRsDailyShard(job, shard);
    }
  });
  await Promise.all(workers);
  job.status = job.failures.length ? "completed_with_failures" : "completed";
  job.finishedAt = new Date().toISOString();
  job.currentSymbol = "";
  job.activeShards = 0;
  job.completedShards = job.shards.filter((shard) => ["completed", "failed"].includes(shard.status)).length;
  job.events.unshift({ at: job.finishedAt, level: "info", text: `Finished ${job.completedShards}/${job.total} shards; ${job.inserted} latest-date records reported; ${job.failures.length} shard failure(s).` });
  if (!job.options?.dryRun) {
    job.events.unshift({ at: new Date().toISOString(), level: "info", text: "Refreshing 260-day screener/chart cache after RS Daily completion." });
    triggerDailyRsCacheWarm("rs_daily_completed", true);
    emitLiveEvent("rs_daily_refresh_completed", { jobId: job.id, status: job.status, completedShards: job.completedShards, total: job.total, failures: job.failures.length });
    marketBusinessDayStatusCache = null;
  }
  rsDailyAgent.running = false;
}

function runRsDailyShard(job, shard) {
  return new Promise((resolve) => {
    shard.status = "running";
    shard.startedAt = new Date().toISOString();
    job.activeShards += 1;
    job.currentSymbol = shard.range;
    job.events.unshift({ at: shard.startedAt, level: "info", text: `${shard.id}: running gap-aware production load_marketdata_from_eodh(${shard.start}, ${shard.end}) for ${job.plan?.fromDate || "bootstrap"} to ${job.plan?.toDate || job.plan?.dueDate || "due date"}.` });
    const args = [rsDailyShardScript, "--start", shard.start, "--end", shard.end, "--run-id", job.id];
    if (job.options.dryRun) args.push("--dry-run");
    if (job.plan?.fromDate) args.push("--from-date", job.plan.fromDate);
    if (job.plan?.toDate) args.push("--to-date", job.plan.toDate);
    if (job.plan?.dueDate) args.push("--target-date", job.plan.dueDate);
    const child = spawn(pythonPath, args, {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, MTM_EODHD_API_TOKEN: job.options.eodhdApiToken || process.env.MTM_EODHD_API_TOKEN || "" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    shard.pid = child.pid;
    const onLine = (line, stream) => {
      const text = redactSensitiveText(line).trim();
      if (!text) return;
      const tail = stream === "stdout" ? shard.stdoutTail : shard.stderrTail;
      tail.push(text);
      while (tail.length > 8) tail.shift();
      try {
        const message = JSON.parse(text);
        applyShardMessage(job, shard, message);
      } catch {
        if (/HEARTBEAT|Processing|Completed|failed|error/i.test(text)) {
          job.events.unshift({ at: new Date().toISOString(), level: stream === "stderr" ? "error" : "info", text: `${shard.range}: ${text.slice(0, 220)}` });
          job.events = job.events.slice(0, 100);
        }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => chunk.split(/\r?\n/).forEach((line) => onLine(line, "stdout")));
    child.stderr.on("data", (chunk) => chunk.split(/\r?\n/).forEach((line) => onLine(line, "stderr")));
    child.on("error", (error) => {
      shard.failure = redactSensitiveText(error.message);
      shard.status = "failed";
    });
    child.on("close", (code) => {
      shard.finishedAt = new Date().toISOString();
      job.activeShards = Math.max(0, job.activeShards - 1);
      job.processed += 1;
      job.completedShards = job.shards.filter((item) => ["completed", "failed"].includes(item.status)).length;
      if (code && shard.status !== "failed") {
        shard.status = "failed";
        shard.failure = shard.failure || `python exited with ${code}`;
      }
      if (shard.status === "failed") {
        job.failures.push({ shard: shard.range, symbol: shard.range, error: shard.failure || "Shard failed." });
        job.events.unshift({ at: shard.finishedAt, level: "error", text: `${shard.id}: failed - ${shard.failure || "unknown error"}` });
      } else {
        shard.status = "completed";
        job.events.unshift({ at: shard.finishedAt, level: "info", text: `${shard.id}: completed; records reported ${shard.recordsInserted}.` });
      }
      job.events = job.events.slice(0, 100);
      resolve();
    });
  });
}

function applyShardMessage(job, shard, message) {
  if (message.type === "started") {
    shard.status = "running";
    return;
  }
  if (message.type === "completed") {
    shard.status = "completed";
    shard.totalSymbols = Number(message.total_symbols || 0);
    shard.recordsInserted = Number(message.records_inserted || 0);
    shard.runDate = message.run_date || "";
    shard.loaderStatus = message.status || "";
    job.inserted = job.shards.reduce((sum, item) => sum + Number(item.recordsInserted || 0), 0);
    job.events.unshift({ at: new Date().toISOString(), level: "info", text: `${shard.id}: ${message.status || "completed"}; symbols ${shard.totalSymbols}; records ${shard.recordsInserted}.` });
    return;
  }
  if (message.type === "failed") {
    shard.status = "failed";
    shard.failure = redactSensitiveText(message.error || "Shard failed.");
    job.events.unshift({ at: new Date().toISOString(), level: "error", text: `${shard.id}: ${shard.failure}` });
  }
}

async function resolveRsAgentSymbols(options) {
  const explicit = String(options.symbols || "").split(/[\s,]+/).map((s) => s.trim().toUpperCase().replace(".US", "")).filter(Boolean);
  if (explicit.length) return [...new Set(explicit)].slice(0, 100);
  const limit = clamp(Number(options.limit || 25), 1, 250);
  const raw = await optionalMysqlJson(`SELECT stock_symbol FROM stock_sector_master WHERE stock_symbol IS NOT NULL AND stock_symbol <> '' ORDER BY stock_symbol LIMIT ${limit}`);
  return raw ? raw.split("\n").map((line) => line.trim().toUpperCase()).filter(Boolean) : [];
}

async function runRsDailyJob(job) {
  job.events.unshift({ at: new Date().toISOString(), level: "info", text: `Started RS Daily download for ${job.total} symbols.` });
  const end = await latestTradingDateForDownload();
  const start = addDays(end, -job.options.days);
  const spyWindow = await loadCombinedWindow("SPY", start, end, job.options.days);
  for (const symbol of job.options.symbols) {
    job.currentSymbol = symbol;
    try {
      const sectorMeta = await symbolSector(symbol);
      const window = await loadCombinedWindow(symbol, start, end, job.options.days);
      const rows = computeRsDailyRows(symbol, window, spyWindow, sectorMeta);
      const recent = rows.filter((row) => row.sdate >= start && row.sdate <= end);
      if (!recent.length) throw new Error("No rows returned from EODHD/API merge.");
      if (!job.options.dryRun) {
        for (const row of recent) {
          const existed = await rsDailyRowExists(row.stock_symbol, row.sdate);
          await upsertRsDailyRow(row);
          if (existed) job.updated += 1;
          else job.inserted += 1;
        }
      }
      job.processed += 1;
      job.events.unshift({ at: new Date().toISOString(), level: "info", text: `${symbol}: ${recent.length} row(s) ${job.options.dryRun ? "validated" : "upserted"}.` });
    } catch (error) {
      job.processed += 1;
      job.failures.push({ symbol, error: error.message });
      job.events.unshift({ at: new Date().toISOString(), level: "error", text: `${symbol}: ${error.message}` });
    }
    job.events = job.events.slice(0, 80);
  }
  job.status = job.failures.length ? "completed_with_failures" : "completed";
  job.currentSymbol = "";
  job.finishedAt = new Date().toISOString();
  job.events.unshift({ at: job.finishedAt, level: "info", text: `Finished: ${job.inserted} inserted, ${job.updated} updated, ${job.failures.length} failures.` });
  rsDailyAgent.running = false;
}

async function latestTradingDateForDownload() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadCombinedWindow(symbol, start, end, days) {
  const historyStart = addDays(start, -430);
  const dbRows = await loadRsDailyHistory(symbol, historyStart, end);
  const apiRows = await fetchEodhdEod(symbol, start, end);
  const byDate = new Map();
  for (const row of dbRows) byDate.set(row.sdate, row);
  for (const row of apiRows) byDate.set(row.sdate, { ...byDate.get(row.sdate), ...row });
  return [...byDate.values()].sort((a, b) => a.sdate.localeCompare(b.sdate)).slice(-Math.max(260, days + 140));
}

async function loadRsDailyHistory(symbol, start, end) {
  const raw = await optionalMysqlJson(`
    SELECT sdate, open, high, low, close, adj_close, volume, sector, industry
    FROM rs_daily
    WHERE stock_symbol = ${sqlString(symbol)} AND sdate BETWEEN ${sqlString(start)} AND ${sqlString(end)}
    ORDER BY sdate ASC
  `);
  return parseRows(raw, ["sdate", "open", "high", "low", "close", "adj_close", "volume", "sector", "industry"]).map(normalizePriceRow);
}

async function fetchEodhdEod(symbol, start, end, token = eodhdApiToken) {
  const apiToken = configuredSecret(token);
  if (!apiToken) throw new Error("EODHD API token is required.");
  const params = new URLSearchParams({ from: start, to: end, period: "d", api_token: apiToken, fmt: "json" });
  const payload = await fetchJsonWithFallback(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}.US?${params.toString()}`);
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => normalizePriceRow({
    sdate: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adj_close: row.adjusted_close ?? row.adjustedClose ?? row.close,
    volume: row.volume
  })).filter((row) => row.sdate && Number.isFinite(row.close));
}

function normalizePriceRow(row) {
  return {
    sdate: String(row.sdate || "").slice(0, 10),
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    adj_close: Number(row.adj_close || row.close || 0),
    volume: Number(row.volume || 0),
    sector: row.sector || "",
    industry: row.industry || ""
  };
}

function computeRsDailyRows(symbol, stockRows, spyRows, sectorMeta) {
  const spyByDate = new Map(spyRows.map((row) => [row.sdate, row]));
  const rows = stockRows.filter((row) => spyByDate.has(row.sdate) && row.adj_close > 0).map((row) => ({ ...row, spy_adj_close: spyByDate.get(row.sdate).adj_close }));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev1 = rows[i - 1];
    const prev5 = rows[i - 5];
    row.stock_symbol = symbol;
    row.perf_1d_pct = prev1?.adj_close > 0 ? pct((row.adj_close - prev1.adj_close) / prev1.adj_close * 100, 0) : 0;
    row.perf_5d_pct = prev5?.adj_close > 0 ? pct((row.adj_close - prev5.adj_close) / prev5.adj_close * 100, 0) : 0;
    row.IsUp4_pctd = prev1?.close > 0 && ((row.close - prev1.close) / prev1.close * 100) >= 4 && row.volume >= 100000 && row.volume > prev1.volume ? 1 : 0;
    row.Isdown4_pctd = prev1?.close > 0 && (row.close / prev1.close) <= 0.96 && row.volume >= 100000 && row.volume > prev1.volume ? 1 : 0;
    const low65 = minSlice(rows, i, 65, "close");
    const high65 = maxSlice(rows, i, 65, "close");
    const dollarTurnover20 = avgSlice(rows, i, 20, (r) => r.close * r.volume);
    row.IsUp25_pctq = low65 > 0 && ((row.close - low65) / low65 >= 0.25) && dollarTurnover20 >= 3000000 ? 1 : 0;
    row.Isdown25_pctq = high65 > 0 && ((row.close - high65) / high65 <= -0.25) && dollarTurnover20 >= 3000000 ? 1 : 0;
    row.rs_val_3m = relativeStrengthAt(rows, i, 65);
    row.rs_val = relativeStrengthAt(rows, i, 126);
    row.ma50 = pct(emaAt(rows, i, 50, "close"), 0);
    row.avg_volume_50 = Math.round(emaAt(rows, i, 50, "volume"));
    const ema21 = emaAt(rows, i, 21, "close");
    const ema65 = emaAt(rows, i, 65, "close");
    const atr14 = atrAt(rows, i, 14);
    row.mci = pct(atr14 > 0 ? Math.max(0, Math.min(100, 100 - Math.abs(ema21 - ema65) / atr14 * 8)) : 50, 0);
    row.mci_below_threshold = row.mci < 70 ? 1 : 0;
    row.spy_pullback_flag = spyPullbackAt(rows, i);
    row.pullback_leader_strength = pct(pullbackLeaderAt(rows, i), 0);
    row.sector = sectorMeta.sector || row.sector || "";
    row.industry = sectorMeta.industry || row.industry || "";
  }
  return rows;
}

function relativeStrengthAt(rows, i, lookback) {
  const base = rows[i - lookback];
  const row = rows[i];
  if (!base || base.adj_close <= 0 || base.spy_adj_close <= 0 || row.spy_adj_close <= 0) return 0;
  return pct(((row.adj_close / base.adj_close) / (row.spy_adj_close / base.spy_adj_close)) * 100, 0);
}

function minSlice(rows, i, n, key) { return Math.min(...rows.slice(Math.max(0, i - n + 1), i + 1).map((r) => Number(r[key] || 0)).filter((v) => v > 0)); }
function maxSlice(rows, i, n, key) { return Math.max(...rows.slice(Math.max(0, i - n + 1), i + 1).map((r) => Number(r[key] || 0))); }
function avgSlice(rows, i, n, fn) { const values = rows.slice(Math.max(0, i - n + 1), i + 1).map(fn).filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function emaAt(rows, i, span, key) { const alpha = 2 / (span + 1); let ema = Number(rows[0]?.[key] || 0); for (let x = 1; x <= i; x++) ema = Number(rows[x]?.[key] || 0) * alpha + ema * (1 - alpha); return ema; }
function atrAt(rows, i, span) {
  const start = Math.max(0, i - span + 1);
  const values = [];
  for (let x = start; x <= i; x++) {
    const row = rows[x], prev = rows[x - 1] || row;
    values.push(Math.max(row.high - row.low, Math.abs(row.high - prev.close), Math.abs(row.low - prev.close)));
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function spyPullbackAt(rows, i) {
  const recent = rows.slice(Math.max(0, i - 4), i + 1).map((r) => r.spy_adj_close);
  return recent.length >= 5 && recent[recent.length - 1] < Math.max(...recent) * 0.97 ? 1 : 0;
}
function pullbackLeaderAt(rows, i) {
  const recent = rows.slice(Math.max(0, i - 4), i + 1);
  if (recent.length < 2) return 0;
  const stock = recent[recent.length - 1].adj_close / recent[0].adj_close;
  const spy = recent[recent.length - 1].spy_adj_close / recent[0].spy_adj_close;
  return spy ? (stock / spy) * 100 : 0;
}

async function symbolSector(symbol) {
  const raw = await optionalMysqlJson(`SELECT COALESCE(sector,''), COALESCE(industry,'') FROM stock_sector_master WHERE stock_symbol=${sqlString(symbol)} LIMIT 1`);
  const [sector, industry] = raw ? raw.split("\t") : ["", ""];
  return { sector, industry };
}

async function rsDailyRowExists(symbol, sdate) {
  const raw = await mysqlJson(`SELECT COUNT(*) FROM rs_daily WHERE stock_symbol=${sqlString(symbol)} AND sdate=${sqlString(sdate)}`);
  return Number(raw || 0) > 0;
}

async function upsertRsDailyRow(row) {
  await mysqlJson(`
    INSERT INTO rs_daily (
      sdate, stock_symbol, open, high, low, close, adj_close, volume,
      perf_1d_pct, perf_5d_pct, Isdown4_pctd, IsUp4_pctd, Isdown25_pctq, IsUp25_pctq,
      rs_val, rs_val_3m, mci, mci_below_threshold, spy_pullback_flag, pullback_leader_strength,
      sector, industry, ma50, avg_volume_50
    ) VALUES (
      ${sqlString(row.sdate)}, ${sqlString(row.stock_symbol)}, ${sqlNumber(row.open)}, ${sqlNumber(row.high)}, ${sqlNumber(row.low)}, ${sqlNumber(row.close)}, ${sqlNumber(row.adj_close)}, ${sqlNumber(row.volume)},
      ${sqlNumber(row.perf_1d_pct)}, ${sqlNumber(row.perf_5d_pct)}, ${sqlNumber(row.Isdown4_pctd)}, ${sqlNumber(row.IsUp4_pctd)}, ${sqlNumber(row.Isdown25_pctq)}, ${sqlNumber(row.IsUp25_pctq)},
      ${sqlNumber(row.rs_val)}, ${sqlNumber(row.rs_val_3m)}, ${sqlNumber(row.mci)}, ${sqlNumber(row.mci_below_threshold)}, ${sqlNumber(row.spy_pullback_flag)}, ${sqlNumber(row.pullback_leader_strength)},
      ${sqlString(row.sector)}, ${sqlString(row.industry)}, ${sqlNumber(row.ma50)}, ${sqlNumber(row.avg_volume_50)}
    ) ON DUPLICATE KEY UPDATE
      open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), adj_close=VALUES(adj_close), volume=VALUES(volume),
      perf_1d_pct=VALUES(perf_1d_pct), perf_5d_pct=VALUES(perf_5d_pct), Isdown4_pctd=VALUES(Isdown4_pctd), IsUp4_pctd=VALUES(IsUp4_pctd),
      Isdown25_pctq=VALUES(Isdown25_pctq), IsUp25_pctq=VALUES(IsUp25_pctq), rs_val=VALUES(rs_val), rs_val_3m=VALUES(rs_val_3m),
      mci=VALUES(mci), mci_below_threshold=VALUES(mci_below_threshold), spy_pullback_flag=VALUES(spy_pullback_flag),
      pullback_leader_strength=VALUES(pullback_leader_strength), sector=VALUES(sector), industry=VALUES(industry),
      ma50=VALUES(ma50), avg_volume_50=VALUES(avg_volume_50)
  `);
}

function topLeaderBuckets(leaders, key) {
  const buckets = new Map();
  for (const leader of leaders) {
    const name = leader[key] || "Unknown";
    const item = buckets.get(name) || { name, count: 0, avgRs3m: 0, avgRs6m: 0 };
    item.count += 1;
    item.avgRs3m += leader.rs_val_3m || 0;
    item.avgRs6m += leader.rs_val || 0;
    buckets.set(name, item);
  }
  return [...buckets.values()].map((item) => ({ ...item, avgRs3m: pct(item.avgRs3m / item.count), avgRs6m: pct(item.avgRs6m / item.count) })).sort((a, b) => (b.count - a.count) || (b.avgRs3m - a.avgRs3m)).slice(0, 5);
}

function parseRows(raw, columns) {
  return raw ? raw.split("\n").filter(Boolean).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  }) : [];
}

function signalStateTone(state) {
  const value = String(state || "").toUpperCase();
  if (value === "OPEN" || value === "BUY") return "good";
  if (value === "REJECTED" || value === "EXITED") return "bad";
  return "neutral";
}

function distancePct(last, reference) {
  const a = Number(last), b = Number(reference);
  return Number.isFinite(a) && Number.isFinite(b) && b ? pct((a - b) / b * 100, null) : null;
}

async function optionalMysqlJson(sql) {
  try { return await mysqlJson(sql); } catch { return ""; }
}

function jsonValue(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function sqlJson(value) {
  return sqlString(JSON.stringify(value ?? {}));
}

async function tradingSystemSummary() {
  const raw = await optionalMysqlJson(`
    SELECT
      SUM(CASE WHEN status='EXITED' AND realized_pnl_pct IS NOT NULL THEN 1 ELSE 0 END),
      SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END),
      SUM(CASE WHEN status='EXITED' AND realized_pnl_pct > 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN status='EXITED' AND realized_pnl_pct <= 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN status='EXITED' AND realized_pnl_pct > 0 THEN realized_pnl_pct ELSE 0 END),
      ABS(SUM(CASE WHEN status='EXITED' AND realized_pnl_pct <= 0 THEN realized_pnl_pct ELSE 0 END)),
      AVG(CASE WHEN status='EXITED' AND realized_pnl_pct > 0 THEN realized_pnl_pct ELSE NULL END),
      AVG(CASE WHEN status='EXITED' AND realized_pnl_pct <= 0 THEN realized_pnl_pct ELSE NULL END),
      SUM(CASE WHEN status='EXITED' THEN realized_pnl_pct ELSE 0 END),
      SUM(CASE WHEN status='OPEN' AND entry_price > 0 THEN ((COALESCE(highest_close, entry_price) - entry_price) / entry_price * 100) ELSE 0 END),
      AVG(CASE WHEN status='EXITED' THEN max_favorable_excursion ELSE NULL END),
      AVG(CASE WHEN status='EXITED' THEN max_adverse_excursion ELSE NULL END)
    FROM actionable_trades_daily
  `);
  const [closed, open, wins, losses, grossWin, grossLoss, avgWin, avgLoss, totalRealized, openUnrealized, avgMfe, avgMae] = (raw || "").split("\t").map((value) => Number(value || 0));
  const winRate = closed ? wins / closed * 100 : 0;
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin || 0;
  const expectancy = closed ? (winRate / 100 * avgWin) + ((1 - winRate / 100) * avgLoss) : 0;
  return {
    closed: Number(closed || 0),
    open: Number(open || 0),
    winRate: pct(winRate),
    avgWin: pct(avgWin),
    avgLoss: pct(avgLoss),
    profitFactor: pct(profitFactor),
    expectancy: pct(expectancy),
    totalRealized: pct(totalRealized),
    openUnrealized: pct(openUnrealized),
    avgMfe: pct(avgMfe),
    avgMae: pct(avgMae)
  };
}

async function latestTradingBacktest() {
  const runRaw = await optionalMysqlJson(`
    SELECT run_id, created_at, start_date, end_date, settings_json, summary_json, COALESCE(notes,'')
    FROM web_backtest_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const [run] = parseRows(runRaw, ["runId", "createdAt", "startDate", "endDate", "settingsJson", "summaryJson", "notes"]);
  if (!run) return null;
  const tradeRaw = await optionalMysqlJson(`
    SELECT stock_symbol, COALESCE(setup_type,''), entry_date, entry_price, exit_date, exit_price, pnl_pct, pnl_dollars, exit_reason, COALESCE(initial_stop,''), max_favorable_excursion, max_adverse_excursion, holding_days, COALESCE(rule_score,''), COALESCE(recommendation,'')
    FROM web_backtest_trades
    WHERE run_id=${sqlString(run.runId)}
    ORDER BY exit_date DESC, stock_symbol ASC
    LIMIT 60
  `);
  const trades = parseRows(tradeRaw, ["symbol", "setup", "entryDate", "entryPrice", "exitDate", "exitPrice", "pnlPct", "pnlDollars", "exitReason", "initialStop", "mfe", "mae", "holdingDays", "ruleScore", "recommendation"])
    .map((row) => ({ ...row, pnlPct: pct(row.pnlPct, null), pnlDollars: pct(row.pnlDollars, null), entryPrice: pct(row.entryPrice, null), exitPrice: pct(row.exitPrice, null), initialStop: row.initialStop === "" ? null : pct(row.initialStop, null), mfe: pct(row.mfe, null), mae: pct(row.mae, null), holdingDays: Number(row.holdingDays || 0) }));
  const exitRaw = await optionalMysqlJson(`
    SELECT exit_reason, COUNT(*), ROUND(SUM(pnl_pct),2), ROUND(AVG(pnl_pct),2)
    FROM web_backtest_trades
    WHERE run_id=${sqlString(run.runId)}
    GROUP BY exit_reason
    ORDER BY COUNT(*) DESC
  `);
  const exits = parseRows(exitRaw, ["reason", "count", "pnl", "avg"]).map((row) => ({ reason: row.reason, count: Number(row.count || 0), pnl: pct(row.pnl), avg: pct(row.avg) }));
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    startDate: run.startDate,
    endDate: run.endDate,
    settings: jsonValue(run.settingsJson, {}),
    summary: jsonValue(run.summaryJson, {}),
    notes: run.notes,
    trades,
    exits
  };
}

async function tradingSystemJournal(limit = 10) {
  const safeLimit = clamp(Number(limit || 10), 1, 50);
  const raw = await optionalMysqlJson(`
    SELECT created_at, COALESCE(run_id,''), source, event_type, severity, metrics_json, observations_json, improvements_json, COALESCE(notes,'')
    FROM web_system_journal
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `);
  return parseRows(raw, ["createdAt", "runId", "source", "eventType", "severity", "metricsJson", "observationsJson", "improvementsJson", "notes"])
    .map((row) => ({
      createdAt: row.createdAt,
      runId: row.runId || null,
      source: row.source,
      eventType: row.eventType,
      severity: row.severity,
      metrics: jsonValue(row.metricsJson, {}),
      observations: jsonValue(row.observationsJson, []),
      improvements: jsonValue(row.improvementsJson, []),
      notes: row.notes
    }));
}

async function tradingBacktestJobs(limit = 20) {
  const safeLimit = clamp(Number(limit || 20), 1, 50);
  const raw = await optionalMysqlJson(`
    SELECT job_id, created_at, COALESCE(started_at,''), COALESCE(completed_at,''), status, strategy, symbols_json, COALESCE(benchmark_symbol,''), COALESCE(start_date,''), COALESCE(end_date,''), result_run_ids_json, metrics_json, COALESCE(error,''), COALESCE(notes,'')
    FROM web_strategy_backtest_jobs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `);
  return parseRows(raw, ["jobId", "createdAt", "startedAt", "completedAt", "status", "strategy", "symbolsJson", "benchmark", "startDate", "endDate", "resultRunIdsJson", "metricsJson", "error", "notes"])
    .map((row) => ({
      jobId: row.jobId,
      createdAt: row.createdAt,
      startedAt: row.startedAt || null,
      completedAt: row.completedAt || null,
      status: row.status,
      strategy: row.strategy,
      symbols: jsonValue(row.symbolsJson, []),
      benchmark: row.benchmark,
      startDate: row.startDate || null,
      endDate: row.endDate || null,
      resultRunIds: jsonValue(row.resultRunIdsJson, {}),
      metrics: jsonValue(row.metricsJson, {}),
      error: row.error,
      notes: row.notes
    }));
}

async function tradingProductionGuardrail() {
  try {
    const quality = await dataQualityModel();
    const reasons = [];
    if (!quality.isCurrent) reasons.push(`rs_daily stale: latest ${quality.latestCompletedDate}, business day ${quality.businessDay}`);
    if (Number(quality.coverageRatio || 0) < 90) reasons.push(`coverage ${quality.coverageRatio}% below 90%`);
    if (Number(quality.duplicates || 0) > 0) reasons.push(`${quality.duplicates} duplicate rows`);
    return { state: reasons.length ? "LOCKED" : "READY", tone: reasons.length ? "bad" : "good", reasons, businessDay: quality.businessDay, latestCompletedDate: quality.latestCompletedDate };
  } catch (error) {
    return { state: "CHECK", tone: "neutral", reasons: [error.message], businessDay: null, latestCompletedDate: null };
  }
}

async function tradingSystemMonitorModel() {
  const [summary, backtest, systemJournal, jobs, production, shortlist, activePositions] = await Promise.all([
    tradingSystemSummary(),
    latestTradingBacktest(),
    tradingSystemJournal(10),
    tradingBacktestJobs(20),
    tradingProductionGuardrail(),
    tradingStrategyShortlist(),
    tradingActivePositions()
  ]);
  const lifecycle = await workflowLifecycleModel({ shortlist });
  return {
    source: "myts.web_performance_tables",
    migratedFrom: "http://127.0.0.1:6002/performance",
    generatedAt: new Date().toISOString(),
    summary,
    backtest,
    systemJournal,
    backtestJobs: jobs,
    production,
    shortlist,
    activePositions,
    lifecycle,
    defaultSymbols: (shortlist.rs || []).map((item) => item.symbol).slice(0, 25)
  };
}

async function enqueueTradingBacktest(body = {}) {
  const strategy = ["BOTH", "RS_LEADERSHIP", "VCP"].includes(String(body.strategy || "").toUpperCase()) ? String(body.strategy).toUpperCase() : "BOTH";
  const symbols = [...new Set(String(body.symbolText || body.symbols || "").split(/[\s,;]+/).map((item) => item.trim().toUpperCase().replace(".US", "")).filter((item) => /^[A-Z0-9.-]{1,12}$/.test(item)))].slice(0, 50);
  const finalSymbols = symbols.length ? symbols : (await leadersTileModel(25)).leaders.map((item) => item.stock_symbol).slice(0, 25);
  const benchmark = String(body.benchmark || "SPY").trim().toUpperCase().replace(".US", "") || "SPY";
  const startDate = body.startDate || "2023-01-01";
  const endDate = body.endDate || null;
  const jobId = `mtm-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await mysqlJson(`
    INSERT INTO web_strategy_backtest_jobs (
      job_id, status, strategy, symbols_json, benchmark_symbol, start_date, end_date, result_run_ids_json, metrics_json, notes
    ) VALUES (
      ${sqlString(jobId)}, 'QUEUED', ${sqlString(strategy)}, ${sqlString(JSON.stringify(finalSymbols))}, ${sqlString(benchmark)}, ${sqlString(startDate)}, ${endDate ? sqlString(endDate) : "NULL"}, ${sqlJson({})}, ${sqlJson({})}, ${sqlString("Queued from mtm_ui Trading System Monitor.")}
    )
  `);
  return { ok: true, jobId, strategy, symbols: finalSymbols, benchmark, startDate, endDate };
}

async function processTradingBacktestJob() {
  const runningRaw = await optionalMysqlJson(`SELECT job_id FROM web_strategy_backtest_jobs WHERE status='RUNNING' AND started_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR) ORDER BY started_at DESC LIMIT 1`);
  if (runningRaw) return { ok: true, alreadyRunning: true, message: "A strategy backtest job is already running.", jobId: runningRaw.trim() };
  await mysqlJson(`UPDATE web_strategy_backtest_jobs SET status='QUEUED', started_at=NULL, error=CONCAT(COALESCE(error,''),' Recovered stale RUNNING job in mtm_ui.') WHERE status='RUNNING' AND started_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)`);
  const raw = await optionalMysqlJson(`
    SELECT job_id, strategy, symbols_json, COALESCE(benchmark_symbol,'SPY'), COALESCE(start_date,'2023-01-01'), COALESCE(end_date,'')
    FROM web_strategy_backtest_jobs
    WHERE status='QUEUED'
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const [job] = parseRows(raw, ["jobId", "strategy", "symbolsJson", "benchmark", "startDate", "endDate"]);
  if (!job) return { ok: true, message: "No queued strategy backtest job found." };
  await mysqlJson(`UPDATE web_strategy_backtest_jobs SET status='RUNNING', started_at=COALESCE(started_at, CURRENT_TIMESTAMP), error=NULL WHERE job_id=${sqlString(job.jobId)}`);
  const resultIds = {};
  const metrics = {};
  try {
    const strategy = String(job.strategy || "BOTH").toUpperCase();
    const symbols = jsonValue(job.symbolsJson, []);
    const failures = [];
    if (strategy === "BOTH" || strategy === "RS_LEADERSHIP") {
      try {
        const rs = await runNativeRsLeadershipBacktest({ startDate: job.startDate, endDate: job.endDate || null });
        resultIds.RS_LEADERSHIP = rs.runId;
        metrics.RS_LEADERSHIP = rs.summary;
      } catch (error) {
        failures.push({ strategy: "RS_LEADERSHIP", error: error.message });
        metrics.RS_LEADERSHIP = { trades: 0, backtest_status: "FAILED", error: error.message };
      }
    }
    if (strategy === "BOTH" || strategy === "VCP") {
      try {
        const vcp = await runNativeVcpBacktest({ symbols, benchmark: job.benchmark, startDate: job.startDate, endDate: job.endDate || null });
        resultIds.VCP = vcp.runId;
        resultIds.VCP_VERSION = vcp.versionId;
        metrics.VCP = vcp.summary;
      } catch (error) {
        failures.push({ strategy: "VCP", error: error.message });
        metrics.VCP = { trades: 0, backtest_status: "FAILED", error: error.message };
      }
    }
    const anySuccess = Object.keys(resultIds).length > 0;
    if (!anySuccess) throw new Error(failures.map((f) => `${f.strategy}: ${f.error}`).join("; ") || "No strategy completed.");
    const status = failures.length ? "COMPLETE_WARN" : "COMPLETE";
    const errorText = failures.length ? failures.map((f) => `${f.strategy}: ${f.error}`).join("; ") : "";
    await mysqlJson(`UPDATE web_strategy_backtest_jobs SET status=${sqlString(status)}, completed_at=CURRENT_TIMESTAMP, result_run_ids_json=${sqlString(JSON.stringify(resultIds))}, metrics_json=${sqlString(JSON.stringify(metrics))}, error=${errorText ? sqlString(errorText) : "NULL"} WHERE job_id=${sqlString(job.jobId)}`);
    await persistTradingSystemJournal("strategy_backtest_queue", status, failures.length ? "WARN" : "INFO", { jobId: job.jobId, strategy, resultIds, failures }, [failures.length ? `Queued strategy backtest completed with ${failures.length} warning(s).` : "Queued strategy backtest completed natively inside mtm_ui."], ["Compare RS Leadership and VCP metrics before increasing allocation."], job.jobId);
    return { ok: true, message: failures.length ? "Native mtm_ui backtest completed with warnings." : "Native mtm_ui backtest job completed.", jobId: job.jobId, resultIds, metrics, failures };
  } catch (error) {
    await mysqlJson(`UPDATE web_strategy_backtest_jobs SET status='FAILED', completed_at=CURRENT_TIMESTAMP, error=${sqlString(error.message)} WHERE job_id=${sqlString(job.jobId)}`);
    await persistTradingSystemJournal("strategy_backtest_queue", "JOB_FAILED", "ERROR", { jobId: job.jobId }, [error.message], ["Review cache availability, symbol list, and database connectivity before rerun."], job.jobId);
    return { ok: false, error: error.message, jobId: job.jobId };
  }
}

async function persistTradingSystemJournal(source, eventType, severity, metrics, observations, improvements, runId = null, notes = "") {
  await mysqlJson(`
    INSERT INTO web_system_journal (run_id, source, event_type, severity, metrics_json, observations_json, improvements_json, notes)
    VALUES (${runId ? sqlString(runId) : "NULL"}, ${sqlString(source)}, ${sqlString(eventType)}, ${sqlString(severity)}, ${sqlString(JSON.stringify(metrics || {}))}, ${sqlString(JSON.stringify(observations || []))}, ${sqlString(JSON.stringify(improvements || []))}, ${sqlString(notes || "")})
  `);
}

async function workflowLifecycleModel(options = {}) {
  const shortlist = options.shortlist || await tradingStrategyShortlist(25);
  const [signals, activePositions, journalEvents, pendingRiskSuggestions] = await Promise.all([
    signalBook(200),
    tradingActivePositions(),
    workflowJournalEvents(80),
    pendingRiskRuleSuggestions()
  ]);
  const screened = [...(shortlist.rs || []), ...(shortlist.vcp || [])].map((item) => workflowCandidateFromScreener(item));
  const watchCandidates = signals.filter((signal) => signal.state === "WATCH").map((signal) => workflowCandidateFromSignal(signal, "WATCH"));
  const buyCandidates = signals.filter((signal) => ["BUY", "OPEN"].includes(signal.state)).map((signal) => workflowCandidateFromSignal(signal, "BUY_TRIGGERED"));
  const byKey = new Map();
  for (const item of [...screened, ...watchCandidates, ...buyCandidates, ...activePositions.map(workflowCandidateFromPosition)]) {
    const key = `${item.strategy || "ANY"}:${item.symbol}`;
    const current = byKey.get(key);
    if (!current || workflowStateRank(item.lifecycleState) > workflowStateRank(current.lifecycleState)) byKey.set(key, item);
  }
  const states = [...byKey.values()].reduce((acc, item) => {
    acc[item.lifecycleState] = (acc[item.lifecycleState] || 0) + 1;
    return acc;
  }, {});
  return {
    source: "derived_from_existing_tables",
    schemaMode: "no_db_changes",
    generatedAt: new Date().toISOString(),
    states,
    screened,
    watchCandidates,
    buyCandidates,
    activePositions,
    pendingRiskSuggestions,
    journalEvents,
    traceability: [...byKey.values()].slice(0, 150)
  };
}

function workflowCandidateFromScreener(item = {}) {
  const score = Number(item.score || 0);
  const setup = item.setup || "Screener candidate";
  const status = setup === "PIVOT_BREAKOUT" || /BREAKOUT|CHEAT_ENTRY_READY|CHEAT_TRIGGERED/i.test(setup) || score >= 900 ? "BUY" : "WATCH";
  return {
    symbol: item.symbol,
    strategy: item.strategy || "RS_LEADERSHIP",
    screener: item.strategy || "Daily RS Screener",
    scanDate: item.date,
    lifecycleState: status === "BUY" ? "BUY_TRIGGERED" : "SCREENED",
    status,
    marketRegime: "",
    sector: item.sector || "",
    industry: item.industry || "",
    setupScore: pct(item.score, null),
    relativeStrengthScore: pct(item.rs3 || item.rs, null),
    technicalScore: pct(item.score, null),
    entryRationale: `${setup} from cache-backed screener.`,
    triggerCondition: item.pivot ? `Trigger above ${item.pivot}` : setup,
    initialStopLogic: item.stop ? `Initial stop ${item.stop}` : "Use Risk screen initial stop logic.",
    riskNotes: "Derived candidate only; no durable lifecycle table added."
  };
}

function workflowCandidateFromSignal(signal = {}, state = "WATCH") {
  return {
    symbol: signal.symbol,
    strategy: signal.strategy,
    screener: signal.strategy === "VCP" ? "VCP Scan" : "Daily RS Screener",
    scanDate: signal.signalDate,
    dateAdded: signal.signalDate,
    lifecycleState: state === "WATCH" ? "SIGNAL_PENDING" : "BUY_TRIGGERED",
    status: state === "WATCH" ? "Waiting for Signal" : "Buy Triggered",
    currentPrice: signal.last,
    triggerCondition: signal.pivot ? `Trigger/pivot ${signal.pivot}` : signal.setup,
    distanceFromTrigger: signal.distanceToPivotPct,
    setupStatus: signal.setup,
    marketRegime: "",
    sector: signal.sector || "",
    industry: signal.industry || "",
    setupScore: signal.score,
    relativeStrengthScore: signal.rs3 || signal.rs,
    entryRationale: signal.reason || "",
    initialStopLogic: signal.stop ? `Stop ${signal.stop}` : signal.invalidation || "",
    riskNotes: signal.invalidation || ""
  };
}

function workflowCandidateFromPosition(position = {}) {
  const state = /SELL|URGENT/.test(position.current_sell_rule_state || "") ? "SELL_RULE_TRIGGERED" : "TRADE_OPEN";
  return {
    symbol: position.stock_symbol,
    strategy: position.strategy || "RS_LEADERSHIP",
    lifecycleState: state,
    status: state === "SELL_RULE_TRIGGERED" ? "Sell Rule Triggered" : "Active Trade",
    entryDate: position.entry_date,
    entryPrice: position.entry_price,
    quantity: position.shares_est,
    currentPrice: position.current_price,
    marketValue: position.market_value,
    unrealizedPnl: position.unrealized_pnl_dollars,
    unrealizedPnlPct: position.current_pnl_pct,
    currentStop: position.initial_stop,
    initialStop: position.initial_stop,
    target: position.profit_target,
    daysHeld: position.days_held,
    riskAmount: position.dollar_risk,
    rMultiple: position.r_multiple,
    entryReason: position.why_it_fits || "",
    journalReason: position.journal_reason,
    trace: {
      screener: position.strategy || "RS Leadership",
      signal: position.stock_symbol,
      trade: position.stock_symbol,
      sellRuleDecision: position.recommendation,
      journalReason: position.journal_reason
    }
  };
}

function workflowStateRank(state = "") {
  return {
    SCREENED: 1,
    WATCH: 2,
    SIGNAL_PENDING: 3,
    BUY_TRIGGERED: 4,
    TRADE_OPEN: 5,
    PARTIAL_EXIT: 6,
    SELL_RULE_TRIGGERED: 7,
    STOP_TRIGGERED: 8,
    TRADE_CLOSED: 9,
    ARCHIVED: 10
  }[state] || 0;
}

async function tradingActivePositions() {
  const settings = await riskSettings();
  return (await riskOpenTrades(settings)).map((position) => {
    const marketValue = Number(position.current_price || 0) * Number(position.shares_est || 0);
    const cost = Number(position.entry_price || 0) * Number(position.shares_est || 0);
    const riskPerShare = Number(position.entry_price || 0) - Number(position.initial_stop || 0);
    const currentGainPerShare = Number(position.current_price || 0) - Number(position.entry_price || 0);
    return {
      ...position,
      strategy: "RS_LEADERSHIP",
      status: /SELL|URGENT/.test(position.current_sell_rule_state || "") ? "Sell Rule Triggered" : "Open",
      market_value: pct(marketValue),
      unrealized_pnl_dollars: pct(marketValue - cost),
      realized_pnl_dollars: 0,
      r_multiple: riskPerShare > 0 ? pct(currentGainPerShare / riskPerShare, 2) : null,
      target: position.profit_target,
      entry_reason: position.why_it_fits || position.recommendation_explanation || "",
      journal_link: "web_system_journal"
    };
  });
}

async function workflowJournalEvents(limit = 80) {
  const raw = await optionalMysqlJson(`
    SELECT created_at, source, event_type, severity, metrics_json, observations_json, improvements_json, notes
    FROM web_system_journal
    WHERE source IN ('workflow_lifecycle','risk_sell_rule_sandbox','strategy_backtest_queue','signals')
    ORDER BY created_at DESC
    LIMIT ${clamp(Number(limit) || 80, 1, 300)}
  `);
  return parseRows(raw, ["createdAt", "source", "eventType", "severity", "metricsJson", "observationsJson", "improvementsJson", "notes"]).map((row) => ({
    createdAt: row.createdAt,
    source: row.source,
    eventType: row.eventType,
    severity: row.severity,
    metrics: jsonValue(row.metricsJson, {}),
    observations: jsonValue(row.observationsJson, []),
    improvements: jsonValue(row.improvementsJson, []),
    notes: row.notes || ""
  }));
}

async function pendingRiskRuleSuggestions() {
  const events = await workflowJournalEvents(200);
  return events
    .filter((event) => event.source === "risk_sell_rule_sandbox" || /SUGGESTION|SELL_RULE|RISK_RULE|OVERRIDE|DEFER/i.test(`${event.eventType} ${event.notes}`))
    .map((event, index) => ({
      id: `${event.createdAt || index}:${event.metrics?.symbol || "NA"}`,
      symbol: event.metrics?.symbol || "",
      strategy: event.metrics?.strategy || event.metrics?.recommendation || "",
      tradeId: event.metrics?.trade_id || event.metrics?.symbol || "",
      journalEntryType: event.eventType,
      observation: (event.observations || []).join(" ") || event.notes || "",
      suggestedRuleChange: (event.improvements || []).join(" ") || "Review as candidate rule/sell-process improvement. Approval required before activation.",
      supportingOutcome: event.metrics?.gain_loss_pct ?? event.metrics?.recommendation ?? "",
      createdAt: event.createdAt,
      status: "Pending",
      approver: "",
      approvalDate: "",
      sourceJournal: event
    }))
    .slice(0, 30);
}

async function recordWorkflowLifecycleEvent(user, body = {}) {
  const symbol = String(body.symbol || "").toUpperCase().trim();
  if (!symbol) throw new Error("Symbol is required.");
  const eventType = String(body.eventType || body.lifecycleState || "WORKFLOW_EVENT").toUpperCase().replace(/\s+/g, "_");
  const metrics = {
    symbol,
    user: user?.username || user?.id || "unknown",
    strategy: body.strategy || "",
    screener: body.screener || "",
    lifecycle_state: body.lifecycleState || "",
    action: body.action || eventType,
    market_condition: body.marketCondition || "",
    sector_condition: body.sectorCondition || "",
    industry_condition: body.industryCondition || "",
    entry_price: pct(body.entryPrice ?? body.entry_price, null),
    exit_price: pct(body.exitPrice ?? body.exit_price, null),
    stop_level: pct(body.stopLevel ?? body.stop_level, null),
    quantity: Number(body.quantity || 0),
    pnl_impact: pct(body.pnlImpact ?? body.pnl_impact, null),
    notes: body.notes || "",
    captured_at: new Date().toISOString()
  };
  await persistTradingSystemJournal(
    "workflow_lifecycle",
    eventType,
    /STOP|SELL|EXIT|REJECT/i.test(eventType) ? "WARN" : "INFO",
    metrics,
    [body.reason || `${symbol}: ${eventType.replaceAll("_", " ")} recorded in lifecycle chain.`],
    [body.followup || "Maintain traceability from screener to signal, trade, journal, and risk review."],
    null,
    body.notes || ""
  );
  return { ok: true, event: metrics };
}

async function tradingStrategyShortlist(limit = 25) {
  const latest = await optionalMysqlJson(`SELECT MAX(sdate) FROM web_rs_enriched_cache`);
  const rsRaw = await optionalMysqlJson(`
    SELECT stock_symbol, sdate, close, volume, rs_val, rs_val_3m, mci, sector, industry,
      CASE
        WHEN close >= prior_20d_high * 0.995 THEN 'PIVOT_BREAKOUT'
        WHEN close BETWEEN prior_20d_high * 0.90 AND prior_20d_high * 0.995 AND tightness_10d <= 12 THEN 'CHEAT_ENTRY'
        WHEN close BETWEEN ma50 * 1.00 AND ma50 * 1.10 AND tightness_10d <= 10 THEN 'LOW_CHEAT'
        ELSE 'QUALITY_PULLBACK'
      END AS setup_type,
      (LEAST(rs_val,1500)*0.45 + LEAST(rs_val_3m,500)*0.65 + CASE WHEN close >= prior_20d_high * 0.995 THEN 120 ELSE 70 END - ABS(perf_5d_pct)*8) AS entry_score
    FROM web_rs_enriched_cache
    WHERE sdate=${latest ? sqlString(latest) : "NULL"}
      AND lookback_count >= 200 AND close >= 12 AND volume >= 200000 AND avg_volume_50 >= 100000
      AND close >= ma50 AND close >= ma150 AND close >= ma200 AND ma50 >= ma150 AND ma150 >= ma200
      AND close >= low_52w * 1.25 AND close >= high_52w * 0.75 AND close <= ma50 * 1.18
      AND rs_val >= 120 AND rs_val_3m >= 95 AND mci BETWEEN -35 AND 50
    ORDER BY entry_score DESC, rs_val_3m DESC
    LIMIT ${clamp(Number(limit), 1, 100)}
  `);
  const rs = parseRows(rsRaw, ["symbol", "date", "close", "volume", "rs", "rs3", "mci", "sector", "industry", "setup", "score"])
    .map((row) => ({ strategy: "RS_LEADERSHIP", symbol: row.symbol, date: row.date, close: pct(row.close, null), setup: row.setup, score: pct(row.score, null), rs: pct(row.rs, null), rs3: pct(row.rs3, null), sector: row.sector, industry: row.industry }));
  const vcpRaw = await optionalMysqlJson(`
    SELECT r.symbol, r.scan_date, r.total_score, r.classification, r.cheat_status, r.breakout_status, r.official_pivot, r.cheat_pivot, r.invalidation_price
    FROM web_vcp_scan_results r
    JOIN (SELECT version_id FROM web_vcp_scan_versions ORDER BY created_at DESC LIMIT 1) v ON v.version_id=r.version_id
    WHERE r.tier1_pass=1
    ORDER BY r.total_score DESC, r.symbol
    LIMIT ${clamp(Number(limit), 1, 100)}
  `);
  const vcp = parseRows(vcpRaw, ["symbol", "date", "score", "classification", "cheatStatus", "breakoutStatus", "officialPivot", "cheatPivot", "stop"])
    .map((row) => ({ strategy: "VCP", symbol: row.symbol, date: row.date, setup: row.breakoutStatus === "BREAKOUT_CONFIRMED" ? "OFFICIAL_BREAKOUT" : row.cheatStatus || row.classification, score: Number(row.score || 0), pivot: pct(row.cheatPivot || row.officialPivot, null), stop: pct(row.stop, null) }));
  return { rs, vcp };
}

async function runNativeRsLeadershipBacktest({ startDate, endDate } = {}) {
  const settings = await riskSettings();
  const portfolioSize = Number(settings.portfolio_size || 100000);
  const perTradeCapital = Number(settings.per_trade_capital || 10000);
  const maxTrades = Number(settings.max_trades || 10);
  const maxCapital = portfolioSize * Number(settings.max_capital_pct || 60) / 100;
  const entryRiskPct = Number(settings.entry_risk_pct || 7.5);
  const effectivePerTrade = Math.min(perTradeCapital, maxTrades ? maxCapital / maxTrades : perTradeCapital);
  const end = endDate || await optionalMysqlJson(`SELECT MAX(sdate) FROM web_rs_enriched_cache`);
  const start = startDate || await optionalMysqlJson(`SELECT MIN(sdate) FROM web_rs_enriched_cache WHERE sdate >= DATE_SUB(${sqlString(end)}, INTERVAL 260 DAY)`);
  const candidateRaw = await optionalMysqlJson(`
    SELECT stock_symbol, sdate, close, low_5d, prior_20d_high, ma50, tightness_10d, volume, avg_volume_50, rs_val, rs_val_3m, mci, perf_5d_pct, sector, industry,
      CASE
        WHEN close >= prior_20d_high * 0.995 THEN 'PIVOT_BREAKOUT'
        WHEN close BETWEEN prior_20d_high * 0.90 AND prior_20d_high * 0.995 AND tightness_10d <= 12 THEN 'CHEAT_ENTRY'
        WHEN close BETWEEN ma50 * 1.00 AND ma50 * 1.10 AND tightness_10d <= 10 THEN 'LOW_CHEAT'
        ELSE 'QUALITY_PULLBACK'
      END,
      (LEAST(rs_val,1500)*0.45 + LEAST(rs_val_3m,500)*0.65 + CASE WHEN close >= prior_20d_high * 0.995 THEN 120 WHEN close BETWEEN prior_20d_high * 0.90 AND prior_20d_high * 0.995 THEN 95 ELSE 55 END + CASE WHEN tightness_10d <= 8 THEN 90 WHEN tightness_10d <= 12 THEN 50 ELSE 0 END + CASE WHEN volume >= avg_volume_50 * 1.25 THEN 75 ELSE 0 END - ABS(perf_5d_pct)*8 - GREATEST((close / ma50 - 1) * 100 - 12, 0) * 12)
    FROM web_rs_enriched_cache
    WHERE sdate BETWEEN ${sqlString(start)} AND ${sqlString(end)}
      AND lookback_count >= 200 AND close >= 12 AND volume >= 200000 AND avg_volume_50 >= 100000
      AND close >= ma50 AND close >= ma150 AND close >= ma200 AND ma50 >= ma150 AND ma150 >= ma200 AND ma200 >= ma200_20d_ago
      AND close >= low_52w * 1.25 AND close >= high_52w * 0.75 AND close <= ma50 * 1.18
      AND rs_val >= 120 AND rs_val_3m >= 95 AND rs_val_3m >= rs_val * 0.55 AND mci BETWEEN -35 AND 50
      AND perf_5d_pct BETWEEN -5 AND 16 AND volume >= avg_volume_50 * 0.85
      AND (close >= prior_20d_high * 0.995 OR (close BETWEEN prior_20d_high * 0.90 AND prior_20d_high * 0.995 AND tightness_10d <= 12) OR (close BETWEEN ma50 * 1.00 AND ma50 * 1.10 AND tightness_10d <= 10))
    ORDER BY sdate ASC, 17 DESC
    LIMIT 6000
  `);
  const candidates = parseRows(candidateRaw, ["symbol", "date", "close", "low5", "prior20", "ma50", "tight10", "volume", "avgVolume50", "rs", "rs3", "mci", "perf5", "sector", "industry", "setup", "score"])
    .map((row) => ({ ...row, close: Number(row.close), low5: Number(row.low5), ma50: Number(row.ma50), score: Number(row.score || 0) }));
  const symbols = [...new Set(candidates.map((row) => row.symbol))];
  if (!symbols.length) throw new Error("No RS Leadership candidates found in web_rs_enriched_cache for the requested date range.");
  const priceRaw = await optionalMysqlJson(`
    SELECT stock_symbol, sdate, open, high, low, close, volume, rs_val, rs_val_3m
    FROM web_rs_enriched_cache
    WHERE stock_symbol IN (${symbols.map(sqlString).join(",")}) AND sdate BETWEEN ${sqlString(start)} AND ${sqlString(end)}
    ORDER BY sdate ASC, stock_symbol ASC
  `);
  const prices = parseRows(priceRaw, ["symbol", "date", "open", "high", "low", "close", "volume", "rs", "rs3"])
    .map((row) => ({ ...row, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), rs: Number(row.rs || 0), rs3: Number(row.rs3 || 0) }));
  const bySymbol = new Map();
  for (const row of prices) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol).push(row);
  }
  const byDate = new Map();
  for (const row of candidates) {
    const list = byDate.get(row.date) || [];
    if (list.length < 25) list.push(row);
    byDate.set(row.date, list);
  }
  const dates = [...new Set(prices.map((row) => row.date))].sort();
  const open = new Map();
  const closed = [];
  for (const date of dates) {
    for (const [symbol, pos] of [...open.entries()]) {
      const price = bySymbol.get(symbol)?.find((row) => row.date === date);
      if (!price) continue;
      pos.highest = Math.max(pos.highest, price.close);
      pos.lowest = Math.min(pos.lowest, price.close);
      const holdingDays = tradingDayDistance(dates, pos.entryDate, date);
      let exitReason = "";
      let exitPrice = null;
      if (price.low <= pos.initialStop) { exitReason = price.open < pos.initialStop ? "GAP_THROUGH_STOP" : "RULE_STOP_OR_TRAIL"; exitPrice = Math.min(price.open || pos.initialStop, pos.initialStop); }
      else if (price.high >= pos.entryPrice * 1.25) { exitReason = "PROFIT_25"; exitPrice = pos.entryPrice * 1.25; }
      else if (holdingDays >= 50 && price.close < pos.entryPrice * 1.03) { exitReason = "RS_FADE_NO_PROGRESS"; exitPrice = price.close; }
      if (exitReason) {
        closed.push(closeNativeTrade(pos, date, exitPrice, exitReason, price, holdingDays));
        open.delete(symbol);
      }
    }
    const entries = byDate.get(date) || [];
    for (const entry of entries) {
      if (open.has(entry.symbol) || open.size >= maxTrades) continue;
      const entryPrice = entry.close;
      const stop = Math.max(entryPrice * (1 - entryRiskPct / 100), entry.setup === "PIVOT_BREAKOUT" ? entryPrice * .925 : Math.min(entry.low5 || entryPrice * .925, entry.ma50 || entryPrice) * .99);
      const riskPerShare = entryPrice - stop;
      if (riskPerShare <= 0 || riskPerShare / entryPrice * 100 > entryRiskPct) continue;
      const usedCapital = [...open.values()].reduce((sum, pos) => sum + pos.shares * pos.entryPrice, 0);
      const riskBudget = portfolioSize * nativeRiskBudgetPct(entry);
      const shares = Math.min(Math.floor(effectivePerTrade / entryPrice), Math.floor(riskBudget / riskPerShare));
      if (shares <= 0 || usedCapital + shares * entryPrice > maxCapital) continue;
      const ruleScore = Math.max(0, Math.min(100, entry.score / 18));
      open.set(entry.symbol, { symbol: entry.symbol, entryDate: date, entryPrice, initialStop: stop, shares, highest: entryPrice, lowest: entryPrice, setup: entry.setup, score: entry.score, ruleScore, riskDollars: shares * riskPerShare });
    }
  }
  const lastDate = dates.at(-1);
  for (const [symbol, pos] of open.entries()) {
    const price = bySymbol.get(symbol)?.at(-1);
    if (price) closed.push(closeNativeTrade(pos, price.date || lastDate, price.close, "OPEN_MARKED_TO_LAST", price, tradingDayDistance(dates, pos.entryDate, price.date || lastDate)));
  }
  const runId = randomRunId("rs");
  const summary = summarizeNativeTrades(closed, candidates.length, start, end);
  await mysqlJson(`INSERT INTO web_backtest_runs (run_id, start_date, end_date, settings_json, summary_json, notes) VALUES (${sqlString(runId)}, ${sqlString(start)}, ${sqlString(end)}, ${sqlString(JSON.stringify(settings))}, ${sqlString(JSON.stringify(summary))}, ${sqlString("Native mtm_ui RS Leadership backtest using web_rs_enriched_cache and Risk screen settings.")})`);
  for (const trade of closed) await insertNativeRsTrade(runId, trade);
  await persistTradingSystemJournal("rs_daily_backtest", "BACKTEST_COMPLETE", summary.profit_factor < 1.2 ? "WARN" : "INFO", summary, backtestObservations(summary), backtestImprovements(summary), runId, "Native mtm_ui RS Leadership processor.");
  return { runId, summary };
}

function nativeRiskBudgetPct(entry) {
  const score = Number(entry.score || 0);
  if (entry.setup === "PIVOT_BREAKOUT" && score > 950) return 0.0125;
  if (entry.setup === "CHEAT_ENTRY" || entry.setup === "LOW_CHEAT") return 0.01;
  return 0.0075;
}

function tradingDayDistance(dates, start, end) {
  const a = dates.indexOf(start), b = dates.indexOf(end);
  return a >= 0 && b >= 0 ? Math.max(0, b - a) : 0;
}

function closeNativeTrade(pos, exitDate, exitPrice, exitReason, price, holdingDays) {
  const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice * 100;
  return {
    symbol: pos.symbol,
    entryDate: pos.entryDate,
    exitDate,
    entryPrice: pct(pos.entryPrice, 4),
    exitPrice: pct(exitPrice, 4),
    shares: pos.shares,
    capital: pct(pos.shares * pos.entryPrice),
    pnlPct: pct(pnlPct),
    pnlDollars: pct((exitPrice - pos.entryPrice) * pos.shares),
    mfe: pct((pos.highest - pos.entryPrice) / pos.entryPrice * 100),
    mae: pct((pos.lowest - pos.entryPrice) / pos.entryPrice * 100),
    exitReason,
    holdingDays,
    rs: pct(price?.rs, null),
    rs3: pct(price?.rs3, null),
    setup: pos.setup,
    score: pct(pos.score),
    initialStop: pct(pos.initialStop, 4),
    riskDollars: pct(pos.riskDollars),
    recommendation: pos.ruleScore >= 70 ? "BUY" : "WATCH",
    ruleScore: pct(pos.ruleScore)
  };
}

async function insertNativeRsTrade(runId, t) {
  await mysqlJson(`INSERT INTO web_backtest_trades (
    run_id, stock_symbol, entry_date, exit_date, entry_price, exit_price, shares, capital, pnl_pct, pnl_dollars,
    max_favorable_excursion, max_adverse_excursion, exit_reason, holding_days, quarterly_signal, rs_val, rs_val_3m,
    setup_type, entry_score, initial_stop, risk_dollars, recommendation, rule_score
  ) VALUES (
    ${sqlString(runId)}, ${sqlString(t.symbol)}, ${sqlString(t.entryDate)}, ${sqlString(t.exitDate)}, ${sqlNumber(t.entryPrice)}, ${sqlNumber(t.exitPrice)},
    ${sqlNumber(t.shares)}, ${sqlNumber(t.capital)}, ${sqlNumber(t.pnlPct)}, ${sqlNumber(t.pnlDollars)}, ${sqlNumber(t.mfe)}, ${sqlNumber(t.mae)},
    ${sqlString(t.exitReason)}, ${sqlNumber(t.holdingDays)}, 'NATIVE', ${sqlNumber(t.rs)}, ${sqlNumber(t.rs3)}, ${sqlString(t.setup)}, ${sqlNumber(t.score)},
    ${sqlNumber(t.initialStop)}, ${sqlNumber(t.riskDollars)}, ${sqlString(t.recommendation)}, ${sqlNumber(t.ruleScore)}
  )`);
}

function summarizeNativeTrades(trades, candidateCount, start, end) {
  const wins = trades.filter((t) => Number(t.pnlPct) > 0);
  const losses = trades.filter((t) => Number(t.pnlPct) <= 0);
  const grossWin = wins.reduce((sum, t) => sum + Number(t.pnlPct || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.pnlPct || 0), 0));
  return {
    symbols: [...new Set(trades.map((t) => t.symbol))],
    start_date: start,
    end_date: end,
    trades: trades.length,
    closed_trades: trades.length,
    win_rate: trades.length ? pct(wins.length / trades.length * 100) : 0,
    profit_factor: grossLoss ? pct(grossWin / grossLoss) : pct(grossWin || 0),
    expectancy_pct: trades.length ? pct(trades.reduce((sum, t) => sum + Number(t.pnlPct || 0), 0) / trades.length) : 0,
    total_pnl: pct(trades.reduce((sum, t) => sum + Number(t.pnlDollars || 0), 0)),
    avg_mfe: trades.length ? pct(trades.reduce((sum, t) => sum + Number(t.mfe || 0), 0) / trades.length) : 0,
    avg_mae: trades.length ? pct(trades.reduce((sum, t) => sum + Number(t.mae || 0), 0) / trades.length) : 0,
    daily_candidates_entered: trades.length,
    candidates_considered: candidateCount,
    backtest_status: "COMPLETE"
  };
}

function backtestObservations(summary) {
  const out = [];
  if (summary.profit_factor < 1.2) out.push(`Profit factor ${summary.profit_factor} is below production comfort.`);
  if (summary.win_rate < 40) out.push(`Win rate ${summary.win_rate}% is marginal for swing trading.`);
  if (!out.length) out.push("Native strategy backtest is within initial production comfort thresholds.");
  return out;
}

function backtestImprovements(summary) {
  const out = [];
  if (summary.profit_factor < 1.2) out.push("Tighten entry quality or reduce low-conviction breakouts before increasing size.");
  if (summary.win_rate < 40) out.push("Review failed entries versus missed winners to improve activation timing.");
  if (!out.length) out.push("Continue comparing setup quality and risk-adjusted sizing before increasing allocation.");
  return out;
}

function randomRunId(prefix) {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

async function runNativeVcpBacktest({ symbols = [], benchmark = "SPY", startDate = "2023-01-01", endDate = null } = {}) {
  const settings = await riskSettings();
  const portfolioSize = Number(settings.portfolio_size || 100000);
  const perTradeCapital = Number(settings.per_trade_capital || 10000);
  const maxTrades = Number(settings.max_trades || 10);
  const maxCapital = portfolioSize * Number(settings.max_capital_pct || 60) / 100;
  const entryRiskPct = Number(settings.entry_risk_pct || 7.5);
  const effectivePerTrade = Math.min(perTradeCapital, maxTrades ? maxCapital / maxTrades : perTradeCapital);
  const versionRaw = await optionalMysqlJson(`
    SELECT version_id, symbols_json, COALESCE(benchmark_symbol,'SPY')
    FROM web_vcp_scan_versions
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const [version] = parseRows(versionRaw, ["versionId", "symbolsJson", "benchmark"]);
  if (!version) throw new Error("No VCP scan version found. Run or import a VCP scan before native VCP backtest.");
  const requested = symbols.length ? symbols : jsonValue(version.symbolsJson, []);
  const selected = [...new Set(requested.map((s) => String(s || "").trim().toUpperCase().replace(".US", "")).filter(Boolean))].slice(0, 50);
  if (!selected.length) throw new Error("No VCP symbols available for backtest.");
  const candidateRaw = await optionalMysqlJson(`
    SELECT symbol, scan_date, total_score, classification, COALESCE(official_pivot,''), COALESCE(cheat_pivot,''), COALESCE(invalidation_price,''), COALESCE(breakout_status,''), COALESCE(cheat_status,'')
    FROM web_vcp_scan_results
    WHERE version_id=${sqlString(version.versionId)}
      AND symbol IN (${selected.map(sqlString).join(",")})
      AND tier1_pass=1
      AND total_score >= 65
    ORDER BY scan_date ASC, total_score DESC
  `);
  const candidates = parseRows(candidateRaw, ["symbol", "scanDate", "score", "classification", "officialPivot", "cheatPivot", "stop", "breakoutStatus", "cheatStatus"])
    .map((row) => ({
      ...row,
      score: Number(row.score || 0),
      entry: Number(row.cheatPivot || row.officialPivot || 0),
      stop: Number(row.stop || 0),
      setup: row.breakoutStatus === "BREAKOUT_CONFIRMED" ? "OFFICIAL_BREAKOUT" : row.cheatStatus === "CHEAT_TRIGGERED" ? "CHEAT_TRIGGERED" : "WATCHLIST_CHEAT_ACTIVATION"
    }))
    .filter((row) => row.entry > 0);
  if (!candidates.length) throw new Error("No actionable cached VCP candidates found for latest scan version.");
  const priceRaw = await optionalMysqlJson(`
    SELECT symbol, price_date, open, high, low, close, volume
    FROM web_vcp_price_cache
    WHERE version_id=${sqlString(version.versionId)}
      AND symbol IN (${selected.map(sqlString).join(",")})
      AND price_date >= ${sqlString(startDate || "2023-01-01")}
      ${endDate ? `AND price_date <= ${sqlString(endDate)}` : ""}
    ORDER BY price_date ASC, symbol ASC
  `);
  const prices = parseRows(priceRaw, ["symbol", "date", "open", "high", "low", "close", "volume"])
    .map((row) => ({ ...row, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) }));
  const bySymbol = new Map();
  for (const row of prices) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol).push(row);
  }
  const open = new Map();
  const closed = [];
  const allDates = [...new Set(prices.map((row) => row.date))].sort();
  const candidateByDate = new Map();
  for (const c of candidates) {
    const date = nearestPriceDate(bySymbol.get(c.symbol) || [], c.scanDate);
    if (!date) continue;
    const list = candidateByDate.get(date) || [];
    list.push(c);
    candidateByDate.set(date, list.sort((a, b) => b.score - a.score).slice(0, 20));
  }
  for (const date of allDates) {
    for (const [symbol, pos] of [...open.entries()]) {
      const price = bySymbol.get(symbol)?.find((row) => row.date === date);
      if (!price) continue;
      pos.highest = Math.max(pos.highest, price.high || price.close);
      pos.lowest = Math.min(pos.lowest, price.low || price.close);
      const holding = tradingDayDistance(allDates, pos.entryDate, date);
      let exitReason = "";
      let exitPrice = null;
      if (price.low <= pos.initialStop) { exitReason = price.open < pos.initialStop ? "GAP_THROUGH_STOP" : "RULE_STOP_OR_TRAIL"; exitPrice = Math.min(price.open || pos.initialStop, pos.initialStop); }
      else if (price.high >= pos.entryPrice * 1.25) { exitReason = "PROFIT_25"; exitPrice = pos.entryPrice * 1.25; }
      else if (holding >= 30 && price.close < pos.entryPrice * 1.03) { exitReason = "VCP_NO_PROGRESS"; exitPrice = price.close; }
      if (exitReason) {
        closed.push(closeNativeTrade(pos, date, exitPrice, exitReason, { rs: null, rs3: null }, holding));
        open.delete(symbol);
      }
    }
    for (const candidate of candidateByDate.get(date) || []) {
      if (open.has(candidate.symbol) || open.size >= maxTrades) continue;
      const rows = bySymbol.get(candidate.symbol) || [];
      const price = rows.find((row) => row.date === date);
      if (!price) continue;
      const entryPrice = price.close || candidate.entry;
      const stop = Math.max(candidate.stop || entryPrice * (1 - entryRiskPct / 100), entryPrice * (1 - entryRiskPct / 100));
      const riskPerShare = entryPrice - stop;
      if (riskPerShare <= 0 || riskPerShare / entryPrice * 100 > entryRiskPct) continue;
      const usedCapital = [...open.values()].reduce((sum, pos) => sum + pos.shares * pos.entryPrice, 0);
      const riskBudget = portfolioSize * (candidate.score >= 85 ? 0.0125 : candidate.score >= 75 ? 0.01 : 0.0075);
      const shares = Math.min(Math.floor(effectivePerTrade / entryPrice), Math.floor(riskBudget / riskPerShare));
      if (shares <= 0 || usedCapital + shares * entryPrice > maxCapital) continue;
      open.set(candidate.symbol, { symbol: candidate.symbol, entryDate: date, entryPrice, initialStop: stop, shares, highest: entryPrice, lowest: entryPrice, setup: candidate.setup, score: candidate.score, ruleScore: candidate.score, riskDollars: shares * riskPerShare });
    }
  }
  for (const [symbol, pos] of open.entries()) {
    const price = bySymbol.get(symbol)?.at(-1);
    if (price) closed.push(closeNativeTrade(pos, price.date, price.close, "OPEN_MARKED_TO_LAST", { rs: null, rs3: null }, tradingDayDistance(allDates, pos.entryDate, price.date)));
  }
  const runId = randomRunId("vcp");
  const summary = summarizeNativeTrades(closed, candidates.length, allDates[0], allDates.at(-1));
  await mysqlJson(`
    INSERT INTO web_vcp_backtest_runs (run_id, scan_version_id, start_date, end_date, symbols_json, settings_json, summary_json, status, notes)
    VALUES (${sqlString(runId)}, ${sqlString(version.versionId)}, ${allDates[0] ? sqlString(allDates[0]) : "NULL"}, ${allDates.at(-1) ? sqlString(allDates.at(-1)) : "NULL"}, ${sqlString(JSON.stringify(selected))}, ${sqlString(JSON.stringify(settings))}, ${sqlString(JSON.stringify(summary))}, 'COMPLETE', ${sqlString("Native mtm_ui VCP backtest using cached VCP scan and price tables plus Risk screen settings.")})
  `);
  for (const t of closed) {
    await mysqlJson(`INSERT INTO web_vcp_backtest_trades (
      run_id, scan_version_id, symbol, setup_type, entry_date, exit_date, entry_price, exit_price, initial_stop, shares, pnl_pct, pnl_dollars, max_favorable_excursion, max_adverse_excursion, exit_reason, rule_score
    ) VALUES (
      ${sqlString(runId)}, ${sqlString(version.versionId)}, ${sqlString(t.symbol)}, ${sqlString(t.setup)}, ${sqlString(t.entryDate)}, ${sqlString(t.exitDate)}, ${sqlNumber(t.entryPrice)}, ${sqlNumber(t.exitPrice)}, ${sqlNumber(t.initialStop)}, ${sqlNumber(t.shares)}, ${sqlNumber(t.pnlPct)}, ${sqlNumber(t.pnlDollars)}, ${sqlNumber(t.mfe)}, ${sqlNumber(t.mae)}, ${sqlString(t.exitReason)}, ${sqlNumber(t.ruleScore)}
    )`);
  }
  await persistTradingSystemJournal("vcp_api_backtest", "BACKTEST_COMPLETE", summary.profit_factor < 1.2 ? "WARN" : "INFO", summary, backtestObservations(summary), backtestImprovements(summary), runId, "Native mtm_ui VCP cached processor.");
  return { runId, versionId: version.versionId, summary };
}

function nearestPriceDate(rows = [], date) {
  return rows.find((row) => row.date >= date)?.date || rows[0]?.date || null;
}

async function signalBook(limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const latestSnapshots = await latestSignalSnapshotMap();
  const enrichedTrades = await enrichedSignalTrades(safeLimit);
  const trades = enrichedTrades.map((item) => {
    const entry = pct(item.entry, null);
    const snap = latestSnapshots.get(`RS_LEADERSHIP:${item.symbol}`) || latestSnapshots.get(`ANY:${item.symbol}`);
    const last = pct(snap?.last ?? item.last, null);
    const stop = entry ? pct(entry * 0.92, null) : null;
    const gainPct = Number.isFinite(Number(last)) && Number.isFinite(Number(entry)) && entry ? pct((last - entry) / entry * 100, null) : null;
    return {
      strategy: "RS_LEADERSHIP",
      symbol: item.symbol,
      state: item.state || "WATCH",
      tone: signalStateTone(item.state),
      signalDate: item.signalDate,
      entry,
      stop,
      pivot: entry,
      last,
      changePct: snap?.changePct ?? pct(item.perf5d, null),
      gainPct,
      priceSource: snap ? "EODHD_CACHE" : "RS_DAILY",
      capturedAt: snap?.capturedAt || null,
      score: pct(item.rs3 || item.rs, null),
      setup: item.setup || "Leadership signal",
      sector: item.sector || "Unknown",
      industry: item.industry || "Unknown",
      reason: item.reason || "RS leadership signal from generated actionable trades.",
      invalidation: item.invalidation || (stop ? `Close below ${stop}` : "Respect stored risk line"),
      sellGuidance: item.sellGuidance,
      distanceToStopPct: snap?.distanceToStopPct ?? distancePct(last, stop),
      distanceToPivotPct: snap?.distanceToPivotPct ?? distancePct(last, entry),
      rs: pct(item.rs, null),
      rs3: pct(item.rs3, null),
      mci: pct(item.mci, null),
      perf5d: pct(item.perf5d, null)
    };
  });

  const vcpRaw = await optionalMysqlJson(`
    SELECT symbol, scan_date,
      CASE
        WHEN breakout_status = 'BREAKOUT_CONFIRMED' OR cheat_status = 'CHEAT_TRIGGERED' THEN 'BUY'
        WHEN tier1_pass = 0 AND cheat_status NOT IN ('EARLY_CHEAT_WATCH', 'CHEAT_ENTRY_READY') THEN 'REJECTED'
        ELSE 'WATCH'
      END,
      COALESCE(cheat_pivot, official_trigger, official_pivot),
      invalidation_price,
      official_pivot,
      total_score,
      COALESCE(cheat_status, breakout_status, classification)
    FROM web_vcp_scan_results
    WHERE version_id = (
      SELECT version_id FROM web_vcp_scan_versions
      WHERE status IN ('BACKTEST_COMPLETE', 'SCAN_COMPLETE', 'PENDING')
      ORDER BY created_at DESC LIMIT 1
    )
    ORDER BY tier1_pass DESC, total_score DESC, symbol ASC
    LIMIT ${safeLimit}
  `);
  const vcpSignals = parseRows(vcpRaw, ["symbol", "signalDate", "state", "entry", "stop", "pivot", "score", "setup"]).map((item) => {
    const snap = latestSnapshots.get(`VCP:${item.symbol}`) || latestSnapshots.get(`ANY:${item.symbol}`);
    const entry = pct(item.entry, null);
    const last = pct(snap?.last, null);
    return {
      strategy: "VCP",
      symbol: item.symbol,
      state: item.state || "WATCH",
      tone: signalStateTone(item.state),
      signalDate: item.signalDate,
      entry,
      stop: pct(item.stop, null),
      pivot: pct(item.pivot, null),
      last,
      changePct: snap?.changePct ?? null,
      gainPct: Number.isFinite(Number(last)) && Number.isFinite(Number(entry)) && entry ? pct((last - entry) / entry * 100, null) : null,
      priceSource: snap ? "EODHD_CACHE" : "NONE",
      capturedAt: snap?.capturedAt || null,
      score: pct(item.score, null),
      setup: item.setup || "VCP setup",
      sector: "Unknown",
      industry: "Unknown",
      reason: "VCP scan candidate from the latest scan version.",
      invalidation: item.stop ? `Close below ${pct(item.stop, null)}` : "Respect VCP invalidation",
      distanceToStopPct: snap?.distanceToStopPct ?? distancePct(last, item.stop),
      distanceToPivotPct: snap?.distanceToPivotPct ?? distancePct(last, item.pivot || item.entry)
    };
  });
  const deduped = new Map();
  const stateRank = { OPEN: 0, BUY: 0, WATCH: 1, EXITED: 2, REJECTED: 3 };
  for (const signal of [...trades, ...vcpSignals]) {
    const key = `${signal.strategy}:${signal.symbol}`;
    const current = deduped.get(key);
    if (!current || (stateRank[signal.state] ?? 9) < (stateRank[current.state] ?? 9) || ((stateRank[signal.state] ?? 9) === (stateRank[current.state] ?? 9) && String(signal.signalDate || "") > String(current.signalDate || ""))) {
      deduped.set(key, signal);
    }
  }
  const strategySignals = [...deduped.values()].sort((a, b) => ((stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9)) || a.strategy.localeCompare(b.strategy) || a.symbol.localeCompare(b.symbol)).slice(0, safeLimit);
  return strategySignals;
}

async function latestSignalSnapshotMap() {
  const map = new Map();
  for (const snap of await latestSignalSnapshotsDb(250)) {
    map.set(`${snap.strategy}:${snap.symbol}`, snap);
    map.set(`ANY:${snap.symbol}`, snap);
  }
  for (const snap of signalLiveCache.values()) {
    map.set(`${snap.strategy}:${snap.symbol}`, snap);
    map.set(`ANY:${snap.symbol}`, snap);
  }
  return map;
}

async function latestSignalSnapshotsDb(limit = 100) {
  const safeLimit = clamp(Number(limit) || 100, 1, 250);
  const raw = await optionalMysqlJson(`
    SELECT
      s.captured_at, s.strategy, s.stock_symbol, s.signal_state, s.entry_price, s.stop_price, s.pivot_price,
      s.snapshot_price, s.previous_close, s.change_pct, s.distance_to_stop_pct, s.distance_to_pivot_pct, s.volume
    FROM web_signal_snapshots s
    JOIN (
      SELECT strategy, stock_symbol, MAX(captured_at) AS captured_at
      FROM web_signal_snapshots
      GROUP BY strategy, stock_symbol
    ) latest ON latest.strategy = s.strategy AND latest.stock_symbol = s.stock_symbol AND latest.captured_at = s.captured_at
    ORDER BY s.captured_at DESC, s.strategy ASC, s.stock_symbol ASC
    LIMIT ${safeLimit}
  `);
  return parseRows(raw, ["capturedAt", "strategy", "symbol", "state", "entry", "stop", "pivot", "last", "previousClose", "changePct", "distanceToStopPct", "distanceToPivotPct", "volume"]).map((item) => ({
    capturedAt: item.capturedAt,
    strategy: item.strategy || "ANY",
    symbol: String(item.symbol || "").toUpperCase(),
    state: item.state || "WATCH",
    entry: pct(item.entry, null),
    stop: pct(item.stop, null),
    pivot: pct(item.pivot, null),
    last: pct(item.last, null),
    previousClose: pct(item.previousClose, null),
    changePct: pct(item.changePct, null),
    distanceToStopPct: pct(item.distanceToStopPct, null),
    distanceToPivotPct: pct(item.distanceToPivotPct, null),
    volume: Number(item.volume || 0),
    tone: signalStateTone(item.state)
  })).filter((item) => item.symbol);
}

async function enrichedSignalTrades(limit = 200) {
  const safeLimit = clamp(Number(limit) || 200, 1, 500);
  const goldenDate = await latestRsDailyDate();
  const regimeRaw = await optionalMysqlJson(`SELECT quarterly_signal FROM market_regime_daily WHERE regime_date <= ${goldenDate ? sqlString(goldenDate) : "CURRENT_DATE"} ORDER BY regime_date DESC LIMIT 1`);
  const quarterlySignal = (regimeRaw || "").split("\t")[0] || "";
  const raw = await optionalMysqlJson(`
    SELECT
      a.stock_symbol,
      a.status,
      COALESCE(a.regime_date, a.entry_date),
      a.entry_date,
      a.exit_date,
      a.entry_price,
      a.exit_price,
      a.rs_alignment,
      a.why_it_fits,
      a.invalidate_if,
      COALESCE(m.sector, ''),
      COALESCE(m.industry, ''),
      r.close,
      r.rs_val,
      r.rs_val_3m,
      r.mci,
      r.perf_5d_pct,
      a.realized_pnl_pct,
      DATEDIFF(COALESCE(a.exit_date, ${goldenDate ? sqlString(goldenDate) : "CURRENT_DATE"}), a.entry_date)
    FROM actionable_trades_daily a
    LEFT JOIN stock_sector_master m ON m.stock_symbol = a.stock_symbol
    LEFT JOIN rs_daily r ON r.stock_symbol = a.stock_symbol AND r.sdate = ${goldenDate ? sqlString(goldenDate) : "NULL"}
    ORDER BY a.regime_date DESC, FIELD(a.status,'OPEN','BUY','WATCH','EXITED','REJECTED'), a.stock_symbol ASC
    LIMIT ${safeLimit}
  `);
  return parseRows(raw, ["symbol", "state", "signalDate", "entryDate", "exitDate", "entry", "exit", "setup", "reason", "invalidation", "sector", "industry", "last", "rs", "rs3", "mci", "perf5d", "realizedPnlPct", "holdingDays"]).map((item) => {
    const entry = pct(item.entry, null);
    const last = pct(item.last ?? item.exit, null);
    const currentPnlPct = entry && last != null ? pct((last - entry) / entry * 100, null) : pct(item.realizedPnlPct, null);
    const trade = {
      ...item,
      symbol: String(item.symbol || "").toUpperCase(),
      entry,
      exit: pct(item.exit, null),
      last,
      rs: pct(item.rs, null),
      rs3: pct(item.rs3, null),
      mci: pct(item.mci, null),
      perf5d: pct(item.perf5d, null),
      holdingDays: Number(item.holdingDays || 0),
      currentPnlPct,
      riskStop: entry ? pct(entry * 0.92, null) : null
    };
    return { ...trade, sellGuidance: signalSellGuidance(trade, quarterlySignal) };
  }).filter((item) => item.symbol);
}

function signalSellGuidance(trade, quarterlySignal = "") {
  const state = String(trade.state || "").toUpperCase();
  if (state !== "OPEN" && state !== "BUY") return { label: "Track Setup", tone: "neutral", action: "Watch for entry confirmation before treating this as active risk." };
  const pnl = Number(trade.currentPnlPct);
  const rs = Number(trade.rs);
  const rs3 = Number(trade.rs3);
  const perf5d = Number(trade.perf5d);
  const quarterly = String(quarterlySignal || "").toUpperCase();
  if (Number.isFinite(pnl) && pnl <= -7) return { label: "Rule Stop", tone: "bad", action: "Exit or review immediately; loss is inside the 7%-8% rule-stop zone." };
  if (Number.isFinite(pnl) && pnl < 0) return { label: "Entry Risk", tone: "neutral", action: "Hold only if stop and thesis remain valid; no add until price improves." };
  if (Number.isFinite(pnl) && pnl >= 20) return { label: "Profit Zone", tone: "neutral", action: "Review partial profits or a tighter trailing plan unless a longer-hold rule is active." };
  if (Number.isFinite(pnl) && pnl >= 11) return { label: "Wide Trail", tone: "good", action: "Protect the move with a wider trailing stop below recent support." };
  if (Number.isFinite(pnl) && pnl >= 10) return { label: "Medium Trail", tone: "good", action: "Move to a medium trailing stop; avoid giving back the gain." };
  if (Number.isFinite(pnl) && pnl >= 8) return { label: "Tight Trail", tone: "good", action: "Protect gains with a tighter trail if the market weakens." };
  if (Number.isFinite(pnl) && pnl >= 7) return { label: "Protect Gains", tone: "good", action: "Move risk toward breakeven or better based on chart support." };
  if (quarterly === "RED") return { label: "Quarterly Red", tone: "bad", action: "Do not add exposure; reduce weak holdings first." };
  if (["YELLOW", "AMBER"].includes(quarterly)) return { label: "Market Caution", tone: "neutral", action: "Keep size controlled until regime improves." };
  if (Number.isFinite(rs) && rs < 70) return { label: "RS Weak", tone: "bad", action: "Leadership quality is below target; tighten review." };
  if (Number.isFinite(rs) && Number.isFinite(rs3) && rs + 8 < rs3) return { label: "RS Fading", tone: "neutral", action: "Momentum is fading versus the 3-month profile; monitor closely." };
  if (Number.isFinite(perf5d) && perf5d <= -7) return { label: "Sharp 5D Drop", tone: "bad", action: "Check for distribution or failed breakout behavior." };
  return { label: "Hold By Rule", tone: "good", action: "No sell trigger from stored risk, RS, or regime checks." };
}

async function signalTileModel(limit = 100) {
  const rsDailyLatestDate = await latestRsDailyDate();
  const regimeRaw = await optionalMysqlJson(`SELECT regime_date, quarterly_signal, daily_signal, regime_classification FROM market_regime_daily WHERE regime_date <= ${rsDailyLatestDate ? sqlString(rsDailyLatestDate) : "CURRENT_DATE"} ORDER BY regime_date DESC LIMIT 1`);
  const [regimeDate, quarterlySignal, dailySignal, regimeClassification] = regimeRaw ? regimeRaw.split("\t") : [];
  const strategySignals = await signalBook(limit);
  const enrichedTrades = await enrichedSignalTrades(200);
  const actionableTrades = enrichedTrades.slice(0, 100).map((item) => ({
    symbol: item.symbol,
    status: item.state || "WATCH",
    entry: pct(item.entry, null),
    stop: pct(item.riskStop, null),
    target: null,
    reason: item.reason || "",
    invalidation: item.invalidation || "",
    date: item.signalDate,
    sector: item.sector || "Unknown",
    industry: item.industry || "Unknown",
    currentPnlPct: pct(item.currentPnlPct, null),
    holdingDays: Number(item.holdingDays || 0),
    sellGuidance: item.sellGuidance
  }));
  const durableSnapshots = await latestSignalSnapshotsDb(100);
  const memorySnapshots = [...signalLiveCache.values()];
  const snapshotMap = new Map();
  for (const item of durableSnapshots) snapshotMap.set(`${item.strategy}:${item.symbol}`, item);
  for (const item of memorySnapshots) snapshotMap.set(`${item.strategy}:${item.symbol}`, item);
  const snapshots = [...snapshotMap.values()].sort((a, b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || ""))).slice(0, 100);

  const counts = strategySignals.reduce((acc, signal) => {
    acc[signal.state] = (acc[signal.state] || 0) + 1;
    return acc;
  }, {});
  const openSignals = strategySignals.filter((signal) => ["OPEN", "BUY"].includes(signal.state)).slice(0, 8);
  const watchSignals = strategySignals.filter((signal) => signal.state === "WATCH").slice(0, 8);
  const openTrades = actionableTrades.filter((trade) => ["OPEN", "BUY"].includes(String(trade.status || "").toUpperCase())).slice(0, 30);
  const closedTrades = actionableTrades.filter((trade) => ["EXITED", "CLOSED"].includes(String(trade.status || "").toUpperCase())).slice(0, 30);
  const workflowWatchCandidates = strategySignals.filter((signal) => signal.state === "WATCH").map((signal) => workflowCandidateFromSignal(signal, "WATCH"));
  const workflowBuyCandidates = strategySignals.filter((signal) => ["BUY", "OPEN"].includes(signal.state)).map((signal) => workflowCandidateFromSignal(signal, "BUY_TRIGGERED"));
  return {
    source: "myts_prod_local.signals",
    sourceTruth: { homeHierarchy: "mtm.market_hierarchy_cache", market: "market_regime_daily", sectorIndustry: "stock_sector_master", signals: "actionable_trades_daily + web_vcp_scan_results + web_signal_snapshots" },
    rsDailyLatestDate,
    regimeDate,
    regimeClassification: regimeClassification || "No Signal",
    quarterlySignal: quarterlySignal || "NA",
    dailySignal: dailySignal || "NA",
    tones: { quarterly: toneForSignal(quarterlySignal), daily: toneForSignal(dailySignal) },
    production: await productionGuardrailModel(),
    counts,
    strategySignals,
    actionableTrades,
    openSignals,
    watchSignals,
    watchCandidates: workflowWatchCandidates,
    triggeredBuyCandidates: workflowBuyCandidates,
    openTrades,
    closedTrades,
    snapshots,
    liveCache: signalLiveCacheMeta
  };
}

async function refreshSignalSnapshots(userId = adminUsername) {
  if (signalSnapshotRefreshRunning) throw new Error("Signal snapshot refresh is already running.");
  signalSnapshotRefreshRunning = true;
  try {
    const apiToken = await effectiveEodhdToken(userId);
    if (!apiToken) throw new Error("MTM_EODHD_API_TOKEN or EODHD_API_TOKEN is required for EODHD live signal snapshots.");
    const signals = (await signalBook(200)).filter((signal) => ["OPEN", "BUY", "WATCH"].includes(signal.state));
    const bySymbol = new Map();
    for (const signal of signals) if (signal.symbol && !bySymbol.has(signal.symbol)) bySymbol.set(signal.symbol, signal);
    const symbols = [...bySymbol.keys()].sort().slice(0, 50);
    if (!symbols.length) return { captured: 0, symbols: 0, message: "No active signal symbols to refresh." };
    const snapshots = await fetchEodhdRealtime(symbols, apiToken);
    let captured = 0;
    const capturedAt = new Date().toISOString();
    const capturedAtDb = sqlDateTime(capturedAt);
    const insertRows = [];
    for (const snap of snapshots) {
      const signal = bySymbol.get(snap.symbol);
      if (!signal || snap.close == null) continue;
      const close = pct(snap.close, null);
      const stop = pct(signal.stop, null);
      const pivot = pct(signal.pivot ?? signal.entry, null);
      const cached = {
        capturedAt,
        strategy: signal.strategy,
        symbol: signal.symbol,
        state: signal.state,
        entry: pct(signal.entry, null),
        stop,
        pivot,
        last: close,
        previousClose: pct(snap.previous_close, null),
        changePct: pct(snap.change_pct, null),
        distanceToStopPct: distancePct(close, stop),
        distanceToPivotPct: distancePct(close, pivot),
        volume: Number(snap.volume || 0),
        tone: signalStateTone(signal.state)
      };
      signalLiveCache.set(`${signal.strategy}:${signal.symbol}`, cached);
      insertRows.push(`(${[
        capturedAtDb, sqlString(signal.strategy), sqlString(signal.symbol), sqlString(signal.state), sqlNumber(signal.entry), sqlNumber(stop), sqlNumber(pivot),
        sqlNumber(close), sqlNumber(cached.previousClose), sqlNumber(cached.changePct), sqlNumber(cached.distanceToStopPct), sqlNumber(cached.distanceToPivotPct), sqlNumber(cached.volume), sqlJson(snap)
      ].join(", ")})`);
      captured += 1;
    }
    if (insertRows.length) {
      await mysqlJson(`
        INSERT INTO web_signal_snapshots (
          captured_at, strategy, stock_symbol, signal_state, entry_price, stop_price, pivot_price,
          snapshot_price, previous_close, change_pct, distance_to_stop_pct, distance_to_pivot_pct, volume, payload_json
        ) VALUES ${insertRows.join(",")}
      `);
    }
    signalLiveCacheMeta = { captured, symbols: symbols.length, refreshedAt: capturedAt };
    await persistTradingSystemJournal("signals", "SNAPSHOT_REFRESH", captured ? "INFO" : "WARN", signalLiveCacheMeta, [`Captured ${captured} delayed EODHD signal snapshots.`], [], null, "Signal snapshots persisted to web_signal_snapshots.");
    return { ...signalLiveCacheMeta, message: "Delayed EODHD signal snapshots refreshed and persisted." };
  } finally {
    signalSnapshotRefreshRunning = false;
  }
}

async function fetchEodhdRealtime(symbols, token = eodhdApiToken) {
  const normalized = symbols.map((symbol) => String(symbol || "").trim().toUpperCase().replace(".US", "")).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (!unique.length) return [];
  const apiToken = configuredSecret(token);
  if (!apiToken) throw new Error("EODHD API token is required.");
  const primary = `${unique[0]}.US`;
  const params = new URLSearchParams({ api_token: apiToken, fmt: "json" });
  if (unique.length > 1) params.set("s", unique.slice(1).map((symbol) => `${symbol}.US`).join(","));
  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(primary)}?${params.toString()}`;
  const payload = await fetchJsonWithFallback(url);
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.filter(Boolean).map(normalizeRealtimeSnapshot);
}

async function fetchJsonWithFallback(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`EODHD refresh failed with HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return powershellJson(url, error);
  }
}

async function powershellJson(url, originalError) {
  const safeUrl = String(url).replace(/'/g, "''");
  const script = `$ProgressPreference = 'SilentlyContinue'; $data = Invoke-RestMethod -Uri '${safeUrl}' -TimeoutSec 20; $data | ConvertTo-Json -Depth 8`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => reject(originalError));
    child.on("close", (code) => {
      if (code) return reject(new Error(stderr.trim() || originalError?.message || `powershell exited with ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("EODHD returned invalid JSON")); }
    });
  });
}

function normalizeRealtimeSnapshot(item = {}) {
  return {
    symbol: String(item.code || item.symbol || "").toUpperCase().replace(".US", ""),
    timestamp: item.timestamp || item.date || null,
    open: pct(item.open, null),
    high: pct(item.high, null),
    low: pct(item.low, null),
    close: pct(item.close, null),
    previous_close: pct(item.previousClose ?? item.previous_close, null),
    volume: Number(item.volume || 0),
    change_pct: pct(item.change_p, null),
    raw: item
  };
}
async function marketGroupModel(kind = "sector") {
  const rsDailyLatestDate = await latestRsDailyDate();
  const businessDay = rsDailyLatestDate || lastCompletedNasdaqBusinessDay();
  const raw = await mysqlJson(`SELECT regime_date, regime_score, regime_classification, sector_leadership, industry_leadership FROM market_dashboard_daily WHERE regime_date <= ${sqlString(businessDay)} ORDER BY regime_date DESC LIMIT 1`);
  if (!raw) return null;
  const [sourceRegimeDate, regimeScore, regimeClassification, sectorLeadership, industryLeadership] = raw.split("\t");
  const isIndustry = kind === "industry";
  const groups = groupRows(parseJson(isIndustry ? industryLeadership : sectorLeadership));
  return {
    source: `myts_prod_local.group_screen_model.${isIndustry ? "industry" : "sector"}`,
    rsDailyLatestDate,
    kind: isIndustry ? "industry" : "sector",
    title: isIndustry ? "Industry Leadership Cockpit" : "Sector Leadership Cockpit",
    subtitle: isIndustry ? "More precise hunting grounds inside leading sectors" : "Where broad institutional participation is strongest",
    regimeDate: businessDay,
    sourceRegimeDate,
    regimeFresh: sourceRegimeDate === businessDay,
    regimeScore: Number(regimeScore || 0),
    regimeClassification,
    groups,
    bestGroup: groups[0] || null,
    leaders: groups.slice(0, 5),
    improving: groups.filter((item) => item.decision.tone === "good").slice(0, 5),
    pullbacks: groups.filter((item) => item.decision.label === "Pullback watch").slice(0, 5),
    avoid: groups.filter((item) => item.decision.tone === "bad").slice(-5)
  };
}
async function marketTileModel() {
  const rsDailyLatestDate = await latestRsDailyDate();
  const businessDay = rsDailyLatestDate || lastCompletedNasdaqBusinessDay();
  const raw = await mysqlJson(`SELECT regime_date, regime_score, regime_classification, quarterly_signal, daily_signal, extension_state, extension_score, market_metrics, sector_leadership, industry_leadership, leaders, actionable_trades, llm_summary FROM market_dashboard_daily WHERE regime_date <= ${sqlString(businessDay)} ORDER BY regime_date DESC LIMIT 1`);
  if (!raw) return null;
  const [sourceRegimeDate, regimeScore, regimeClassification, quarterlySignal, dailySignal, extensionState, extensionScore, marketMetrics, sectorLeadership, industryLeadership, leaders, actionableTrades, llmSummary] = raw.split("\t");
  const metrics = parseJson(marketMetrics);
  const sectors = parseJson(sectorLeadership);
  const industries = parseJson(industryLeadership);
  const leaderBook = parseJson(leaders, { structural: [], emerging: [] });
  const trades = parseJson(actionableTrades, []);
  return {
    source: "myts_prod_local.market_screen_model",
    rsDailyLatestDate,
    regimeDate: businessDay,
    sourceRegimeDate,
    regimeFresh: sourceRegimeDate === businessDay,
    regimeScore: Number(regimeScore || 0),
    regimeClassification,
    quarterlySignal,
    dailySignal,
    extensionState,
    extensionScore: pct(extensionScore),
    tones: {
      quarterly: toneForSignal(quarterlySignal),
      daily: toneForSignal(dailySignal),
      extension: extensionState === "Compressed" ? "good" : "neutral"
    },
    metrics: {
      participation1d: pct(metrics.pct_positive_1d),
      participation5d: pct(metrics.pct_positive_5d),
      structuralLeaders: pct(metrics.structural_leaders_pct),
      momentumOnly: pct(metrics.momentum_only_pct),
      medianRs6m: pct(metrics.median_rs_6m),
      medianRs3m: pct(metrics.median_rs_3m)
    },
    topSectors: topGroups(sectors, 5, "avg_rs_6m"),
    topIndustries: topGroups(industries, 5, "avg_5d_perf"),
    leaders: [...(leaderBook.structural || []), ...(leaderBook.emerging || [])].slice(0, 8),
    actionableTrades: Array.isArray(trades) ? trades.slice(0, 5) : [],
    narrative: extractFinalSynthesis(llmSummary)
  };
}


function dailyRsCacheKey() {
  return `mtm:daily-rs:v1:${dailyRsCacheDays}d`;
}

function redisPublicInfo() {
  try {
    const url = new URL(redisUrl);
    return { enabled: redisEnabled, host: url.hostname || "127.0.0.1", port: Number(url.port || 6379), db: String(url.pathname || "/0").replace(/^\//, "") || "0" };
  } catch {
    return { enabled: redisEnabled, host: "invalid", port: null, db: "0" };
  }
}

function respCommand(parts) {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = Buffer.from(String(part));
    return `$${value.length}\r\n${value.toString()}\r\n`;
  }).join("")}`;
}

function findCrlf(buffer, start) {
  for (let i = start; i < buffer.length - 1; i += 1) if (buffer[i] === 13 && buffer[i + 1] === 10) return i;
  return -1;
}

function parseRespValue(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = findCrlf(buffer, offset + 1);
  if (lineEnd < 0) return null;
  const header = buffer.toString("utf8", offset + 1, lineEnd);
  if (type === "+") return { value: header, next: lineEnd + 2 };
  if (type === "-") throw new Error(header || "Redis command failed");
  if (type === ":") return { value: Number(header), next: lineEnd + 2 };
  if (type === "$") {
    const length = Number(header);
    if (length < 0) return { value: null, next: lineEnd + 2 };
    const start = lineEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString("utf8", start, end), next: end + 2 };
  }
  return null;
}

function redisCommand(command, args = [], timeoutMs = 1800) {
  if (!redisEnabled) return Promise.reject(new Error("Redis disabled"));
  let location;
  try { location = new URL(redisUrl); } catch { return Promise.reject(new Error("Invalid Redis URL")); }
  const host = location.hostname || "127.0.0.1";
  const port = Number(location.port || 6379);
  const db = Number(String(location.pathname || "/0").replace(/^\//, "") || 0);
  const commands = [];
  if (location.password) commands.push(location.username ? ["AUTH", location.username, decodeURIComponent(location.password)] : ["AUTH", decodeURIComponent(location.password)]);
  if (db > 0) commands.push(["SELECT", db]);
  commands.push([command, ...args]);
  const payload = commands.map(respCommand).join("");
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let responses = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Redis timed out at ${host}:${port}`));
    }, timeoutMs);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        let offset = 0;
        let last = null;
        while (responses < commands.length) {
          const parsed = parseRespValue(buffer, offset);
          if (!parsed) break;
          responses += 1;
          offset = parsed.next;
          last = parsed.value;
        }
        if (responses >= commands.length) {
          clearTimeout(timer);
          socket.destroy();
          resolve(last);
        }
      } catch (error) {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}


function cacheNotReadyError(message = "Daily RS cache is warming.") {
  const error = new Error(message);
  error.code = "CACHE_WARMING";
  return error;
}

function startDailyRsCacheWarm(reason = "manual", force = false) {
  if (dailyRsCacheWarmPromise) return dailyRsCacheWarmPromise;
  dailyRsCacheMeta = { ...dailyRsCacheMeta, status: force ? "rebuilding" : "warming", warming: true, warmReason: reason, warmStartedAt: new Date().toISOString(), warmFinishedAt: null, lastError: null };
  dailyRsCacheWarmPromise = buildDailyRsCache()
    .then((cache) => {
      dailyRsCacheMeta = { ...dailyRsCacheMeta, status: "ready", warming: false, warmFinishedAt: new Date().toISOString(), lastBuiltAt: cache.builtAt, lastError: null };
      return cache;
    })
    .catch((error) => {
      dailyRsCacheMeta = { ...dailyRsCacheMeta, status: "failed", warming: false, warmFinishedAt: new Date().toISOString(), lastError: error.message };
      throw error;
    })
    .finally(() => { dailyRsCacheWarmPromise = null; });
  return dailyRsCacheWarmPromise;
}

function triggerDailyRsCacheWarm(reason = "background", force = false) {
  startDailyRsCacheWarm(reason, force).catch((error) => console.error(`Daily RS cache warm failed (${reason}): ${error.message}`));
}

async function readDailyRsCache() {
  if (redisEnabled) {
    try {
      const raw = await redisCommand("GET", [dailyRsCacheKey()]);
      if (raw) {
        const payload = JSON.parse(raw);
        dailyRsCacheMemory = payload;
        dailyRsCacheMeta = { store: "redis", status: "hit", lastBuiltAt: payload.builtAt, lastError: null };
        return payload;
      }
      dailyRsCacheMeta = { ...dailyRsCacheMeta, store: "redis", status: dailyRsCacheMeta.warming ? dailyRsCacheMeta.status : "miss" };
    } catch (error) {
      dailyRsCacheMeta = { ...dailyRsCacheMeta, store: "memory", status: dailyRsCacheMeta.warming ? dailyRsCacheMeta.status : (dailyRsCacheMemory ? "redis_unavailable_memory_hit" : "redis_unavailable"), lastError: error.message };
    }
  }
  return dailyRsCacheMemory;
}

async function writeDailyRsCache(payload) {
  dailyRsCacheMemory = payload;
  if (redisEnabled) {
    try {
      await redisCommand("SETEX", [dailyRsCacheKey(), dailyRsCacheTtlSeconds, JSON.stringify(payload)], 5000);
      dailyRsCacheMeta = { store: "redis", status: "rebuilt", lastBuiltAt: payload.builtAt, lastError: null };
      return "redis";
    } catch (error) {
      dailyRsCacheMeta = { store: "memory", status: "redis_write_failed", lastBuiltAt: payload.builtAt, lastError: error.message };
      return "memory";
    }
  }
  dailyRsCacheMeta = { store: "memory", status: "rebuilt", lastBuiltAt: payload.builtAt, lastError: null };
  return "memory";
}

function normalizeRsCacheValue(column, value) {
  if (value == null || value === "") return null;
  if (["stock_symbol", "sector", "industry"].includes(column) || column.endsWith("date") || column === "sdate") return value;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return Number(value);
  return value;
}

async function buildDailyRsCache() {
  const goldenDate = await latestRsDailyDate();
  const dateRaw = goldenDate ? await mysqlJson(`SELECT DISTINCT sdate FROM rs_daily WHERE sdate IS NOT NULL AND sdate <= ${sqlString(goldenDate)} ORDER BY sdate DESC LIMIT ${dailyRsCacheDays}`) : "";
  const datesDesc = dateRaw ? dateRaw.split("\n").filter(Boolean) : [];
  if (!datesDesc.length) {
    const empty = { source: "myts.rs_daily.daily_rs_cache", version: 1, builtAt: new Date().toISOString(), requestedDays: dailyRsCacheDays, latestDate: null, startDate: null, dates: [], columns: [], symbols: [], rowCount: 0, symbolCount: 0, groupedBySymbol: {} };
    await writeDailyRsCache(empty);
    return empty;
  }
  const startDate = datesDesc[datesDesc.length - 1];
  const latestDate = datesDesc[0];
  const columnRaw = await mysqlJson("SHOW COLUMNS FROM rs_daily");
  const columns = columnRaw.split("\n").map((line) => line.split("\t")[0]).filter(Boolean);
  const selectList = columns.map((column) => `\`${column.replace(/`/g, "``")}\``).join(", ");
  const raw = await mysqlJson(`SELECT ${selectList} FROM rs_daily WHERE sdate BETWEEN ${sqlString(startDate)} AND ${sqlString(latestDate)} ORDER BY stock_symbol ASC, sdate ASC`);
  const rows = parseRows(raw, columns);
  const groupedBySymbol = {};
  for (const row of rows) {
    const normalized = Object.fromEntries(columns.map((column) => [column, normalizeRsCacheValue(column, row[column])]));
    const symbol = String(normalized.stock_symbol || "").toUpperCase();
    if (!symbol) continue;
    if (!groupedBySymbol[symbol]) groupedBySymbol[symbol] = { symbol, latest: null, rows: [] };
    groupedBySymbol[symbol].rows.push(normalized);
    groupedBySymbol[symbol].latest = normalized;
  }
  const symbols = Object.keys(groupedBySymbol).sort();
  const decisionSupportBySymbol = Object.fromEntries(Object.values(groupedBySymbol).map((item) => [item.symbol, buildScreenerDecisionSupport(item.symbol, item.rows || [], item.latest || {})]));
  const latestRows = Object.values(groupedBySymbol).map((item) => item.latest ? { ...item.latest, ...deriveStockbeeColumns(item.rows || []), ...flattenDecisionScores(decisionSupportBySymbol[item.symbol]), symbol: item.symbol, historyRows: item.rows?.length || 0 } : null).filter(Boolean);
  const payload = {
    source: "myts.rs_daily.daily_rs_cache",
    version: 1,
    builtAt: new Date().toISOString(),
    requestedDays: dailyRsCacheDays,
    ttlSeconds: dailyRsCacheTtlSeconds,
    latestDate,
    startDate,
    dates: [...datesDesc].reverse(),
    columns,
    symbols,
    rowCount: rows.length,
    symbolCount: symbols.length,
    latestRows,
    decisionSupportBySymbol,
    groupedBySymbol
  };
  await writeDailyRsCache(payload);
  return payload;
}

async function dailyRsCache(options = {}) {
  const goldenDate = await latestRsDailyDate();
  if (!options.force) {
    const cached = await readDailyRsCache();
    if (cached?.groupedBySymbol && cached.latestDate === goldenDate) return cached;
    if (cached?.groupedBySymbol && cached.latestDate !== goldenDate) triggerDailyRsCacheWarm("golden_business_date_changed", true);
  }
  if (options.noBuild) {
    triggerDailyRsCacheWarm(options.reason || "cache_miss", false);
    throw cacheNotReadyError("Daily RS cache is warming. Try again shortly.");
  }
  return startDailyRsCacheWarm(options.reason || "demand", Boolean(options.force));
}

function candleIndicatorsForRows(rows = []) {
  return rows.map((row, index) => {
    const history = rows.slice(0, index + 1);
    const sma20 = avgField(history, "close", Math.min(20, history.length));
    const sma50 = avgField(history, "close", Math.min(50, history.length));
    const avgVolume20 = avgField(history, "volume", Math.min(20, history.length));
    const close = num(row.close);
    return {
      ...row,
      symbol: String(row.stock_symbol || row.symbol || "").toUpperCase(),
      sma20: round4(sma20),
      sma50: round4(sma50),
      avg_volume_20: round4(avgVolume20),
      price_vs_sma20_pct: close && sma20 ? round4(((close - sma20) / sma20) * 100) : null,
      price_vs_sma50_pct: close && sma50 ? round4(((close - sma50) / sma50) * 100) : null
    };
  });
}

async function candleCacheForSymbol(symbol, options = {}) {
  const cleanSymbol = String(symbol || "SPY").trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 16) || "SPY";
  const limit = clamp(Number(options.limit || 120), 20, 260);
  const cache = await dailyRsCache({ noBuild: true, reason: "candle_cache_symbol" });
  const item = cache.groupedBySymbol?.[cleanSymbol];
  if (!item) return { source: "mtm.candle_cache", symbol: cleanSymbol, latestDate: cache.latestDate, startDate: cache.startDate, found: false, rows: [], indicators: ["sma20", "sma50", "avg_volume_20", "price_vs_sma20_pct", "price_vs_sma50_pct"] };
  const rows = candleIndicatorsForRows((item.rows || []).slice(-limit));
  return { source: "mtm.candle_cache", symbol: cleanSymbol, latestDate: cache.latestDate, startDate: rows[0]?.sdate || cache.startDate, found: true, rows, latest: rows.at(-1) || null, indicators: ["sma20", "sma50", "avg_volume_20", "price_vs_sma20_pct", "price_vs_sma50_pct"], cache: { store: dailyRsCacheMeta.store, status: dailyRsCacheMeta.status, builtAt: cache.builtAt } };
}

async function candleCacheStatus() {
  const status = await dailyRsCacheStatus();
  return { source: "mtm.candle_cache.status", status: status.status, warming: status.warming, latestDate: status.latestDate, startDate: status.startDate, rowCount: status.rowCount, symbolCount: status.symbolCount, store: status.store, indicators: ["sma20", "sma50", "avg_volume_20", "price_vs_sma20_pct", "price_vs_sma50_pct"] };
}
async function dailyRsCacheStatus() {
  let redis = { ...redisPublicInfo(), ok: false };
  if (redisEnabled) {
    try { redis = { ...redis, ok: await redisCommand("PING", []) === "PONG" }; }
    catch (error) { redis = { ...redis, ok: false, error: error.message }; }
  }
  const cached = await readDailyRsCache();
  return {
    source: "mtm.daily_rs_cache.status",
    key: dailyRsCacheKey(),
    days: dailyRsCacheDays,
    ttlSeconds: dailyRsCacheTtlSeconds,
    redis,
    store: dailyRsCacheMeta.store,
    status: dailyRsCacheMeta.status,
    lastError: dailyRsCacheMeta.lastError,
    warming: Boolean(dailyRsCacheMeta.warming || dailyRsCacheWarmPromise),
    warmReason: dailyRsCacheMeta.warmReason,
    warmStartedAt: dailyRsCacheMeta.warmStartedAt,
    warmFinishedAt: dailyRsCacheMeta.warmFinishedAt,
    lastBuiltAt: cached?.builtAt || dailyRsCacheMeta.lastBuiltAt,
    latestDate: cached?.latestDate || null,
    startDate: cached?.startDate || null,
    rowCount: cached?.rowCount || 0,
    symbolCount: cached?.symbolCount || 0,
    columns: cached?.columns || []
  };
}


function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round4(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

function avgField(rows, field, length) {
  const slice = rows.slice(-length).map((row) => num(row[field])).filter((value) => value != null);
  if (slice.length < Math.min(length, rows.length)) return null;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function priorRow(rows, periods) {
  return rows.length > periods ? rows[rows.length - 1 - periods] : null;
}

function minField(rows, field, length) {
  const slice = rows.slice(-length).map((row) => num(row[field])).filter((value) => value != null);
  return slice.length ? Math.min(...slice) : null;
}

function firstTradingRowOfYear(rows, year) {
  return rows.find((row) => String(row.sdate || "").startsWith(`${year}-`));
}

function deriveStockbeeColumns(historyRows = []) {
  const rows = [...historyRows].sort((a, b) => String(a.sdate || "").localeCompare(String(b.sdate || "")));
  const latest = rows.at(-1) || {};
  const close = num(latest.close);
  const open = num(latest.open);
  const high = num(latest.high);
  const low = num(latest.low);
  const volume = num(latest.volume);
  const prev1 = priorRow(rows, 1);
  const prev5 = priorRow(rows, 5);
  const prev10 = priorRow(rows, 10);
  const prev20 = priorRow(rows, 20);
  const prev21 = priorRow(rows, 21);
  const prev252 = priorRow(rows, 252);
  const avgC4 = avgField(rows, "close", 4);
  const avgC7 = avgField(rows, "close", 7);
  const avgC42 = avgField(rows, "close", 42);
  const avgC50 = avgField(rows, "close", 50);
  const avgC65 = avgField(rows, "close", 65);
  const avgC126 = avgField(rows, "close", 126);
  const avgC200 = avgField(rows, "close", 200);
  const avgV20 = avgField(rows, "volume", 20);
  const minL252 = minField(rows, "low", 252);
  const high252Vals = rows.slice(-252).map((row) => num(row.high)).filter((value) => value != null);
  const high252 = high252Vals.length ? Math.max(...high252Vals) : null;
  const weekRows = rows.slice(-5);
  const weekHighVals = weekRows.map((row) => num(row.high)).filter((value) => value != null);
  const weekLowVals = weekRows.map((row) => num(row.low)).filter((value) => value != null);
  const weekHigh = weekHighVals.length ? Math.max(...weekHighVals) : null;
  const weekLow = weekLowVals.length ? Math.min(...weekLowVals) : null;
  const latestYear = String(latest.sdate || "").slice(0, 4);
  const ytdAnchor = firstTradingRowOfYear(rows, latestYear);
  const prevClose = num(prev1?.close);
  const prevVolume = num(prev1?.volume);
  const c20 = close && num(prev20?.close) ? 100 * (close / num(prev20.close) - 1) : null;
  const dollarVolume = close != null && volume != null ? close * volume : null;
  const dcr = close != null && high != null && low != null && high !== low ? 100 * (close - low) / (high - low) : null;
  const wcr = close != null && weekHigh != null && weekLow != null && weekHigh !== weekLow ? 100 * (close - weekLow) / (weekHigh - weekLow) : null;
  const rv20 = volume != null && avgV20 ? volume / avgV20 : null;
  const upVolume = rows.slice(-50).filter((row) => num(row.close) != null && num(row.open) != null && num(row.close) >= num(row.open)).reduce((sum, row) => sum + (num(row.volume) || 0), 0);
  const downVolume = rows.slice(-50).filter((row) => num(row.close) != null && num(row.open) != null && num(row.close) < num(row.open)).reduce((sum, row) => sum + (num(row.volume) || 0), 0);
  const ud50 = downVolume > 0 ? upVolume / downVolume : upVolume > 0 ? 99 : null;
  const trueRanges = rows.map((row, index) => {
    const h = num(row.high), l = num(row.low), pc = index ? num(rows[index - 1].close) : null;
    if (h == null || l == null) return null;
    return Math.max(h - l, pc == null ? h - l : Math.abs(h - pc), pc == null ? h - l : Math.abs(l - pc));
  }).filter((value) => value != null);
  const atrAvg = (n) => {
    const slice = trueRanges.slice(-n);
    return slice.length === n ? slice.reduce((sum, value) => sum + value, 0) / n : null;
  };
  const shortAtr = [atrAvg(3), atrAvg(5), atrAvg(8)].filter((value) => value != null);
  const shortAvg = shortAtr.length ? shortAtr.reduce((sum, value) => sum + value, 0) / shortAtr.length : null;
  const atrSeries = rows.map((_, index) => {
    const slice = rows.slice(0, index + 1);
    const ranges = slice.map((row, rowIndex) => {
      const h = num(row.high), l = num(row.low), pc = rowIndex ? num(slice[rowIndex - 1].close) : null;
      if (h == null || l == null) return null;
      return Math.max(h - l, pc == null ? h - l : Math.abs(h - pc), pc == null ? h - l : Math.abs(l - pc));
    }).filter((value) => value != null);
    const avg = (n) => {
      const sample = ranges.slice(-n);
      return sample.length === n ? sample.reduce((sum, value) => sum + value, 0) / n : null;
    };
    const vals = [avg(3), avg(5), avg(8)].filter((value) => value != null);
    return vals.length ? vals.reduce((sum, value) => sum + value, 0) / vals.length : null;
  }).filter((value) => value != null).slice(-5);
  const rmvMin = atrSeries.length ? Math.min(...atrSeries) : null;
  const rmvMax = atrSeries.length ? Math.max(...atrSeries) : null;
  const rmv = shortAvg != null && rmvMin != null && rmvMax != null && rmvMax !== rmvMin ? 100 * (shortAvg - rmvMin) / (rmvMax - rmvMin) : null;
  const rmvZone = rmv == null ? null : rmv <= 10 ? "Extreme Compression" : rmv <= 20 ? "Low Volatility" : rmv <= 30 ? "Transition" : rmv <= 60 ? "Expansion" : "High Expansion";
  const rsScore = num(latest.rs_val_3m) ?? num(latest.rs_val) ?? null;
  const trendScore = [close && avgC50 ? close / avgC50 : null, avgC50 && avgC200 ? avgC50 / avgC200 : null, close && num(prev21?.close) ? close / num(prev21.close) : null].filter((value) => value != null).reduce((sum, value) => sum + value, 0);
  const derived = {
    ytd_mom: close && num(ytdAnchor?.close) ? round4(100 * (close / num(ytdAnchor.close) - 1)) : null,
    mdt_mom: close && avgC126 ? round4(close / avgC126) : null,
    ti65_mom: avgC7 && avgC65 ? round4(avgC7 / avgC65) : null,
    m21_mom: close && num(prev21?.close) ? round4(close / num(prev21.close)) : null,
    m10_mom: close && num(prev10?.close) ? round4(close / num(prev10.close)) : null,
    m5_mom: close && num(prev5?.close) ? round4(close / num(prev5.close)) : null,
    one_year_mom: close && num(prev252?.close) ? round4(close / num(prev252.close)) : null,
    dt_mom: close && minL252 ? round4(close / minL252) : null,
    ti42_mom: avgC4 && avgC42 ? round4(100 * avgC4 / avgC42) : null,
    dcr: round4(dcr),
    wcr: round4(wcr),
    rv20: round4(rv20),
    ud_50d: round4(ud50),
    c20: round4(c20),
    rmv: round4(rmv),
    rmv_zone: rmvZone,
    rmv_compression_flag: rmv != null ? rmv <= 20 : false,
    rmv_expansion_flag: rmv != null ? rmv >= 30 : false,
    rs_score: round4(rsScore),
    trend_score: round4(trendScore ? trendScore * 33.3333 : null),
    vcp_score: round4((rmv != null ? Math.max(0, 40 - rmv) : 0) + (c20 != null && c20 > 0 ? Math.min(30, c20) : 0) + (rv20 != null ? Math.min(30, rv20 * 10) : 0)),
    cheat_entry_score: round4((dcr != null ? dcr * .35 : 0) + (rmv != null ? Math.max(0, 30 - rmv) : 0) + (c20 != null && c20 > 0 ? Math.min(25, c20) : 0)),
    breakout_score: round4((high252 && close ? Math.max(0, 30 - Math.abs(100 * (close / high252 - 1))) : 0) + (rv20 != null ? Math.min(35, rv20 * 12) : 0) + (dcr != null ? dcr * .35 : 0)),
    momentum_burst_score: round4((c20 != null && c20 > 0 ? Math.min(45, c20 * 1.5) : 0) + (rv20 != null ? Math.min(35, rv20 * 12) : 0) + (rsScore != null ? Math.min(20, rsScore / 5) : 0)),
    accumulation_score: round4((ud50 != null ? Math.min(50, ud50 * 20) : 0) + (rv20 != null ? Math.min(25, rv20 * 8) : 0) + (dcr != null ? dcr * .25 : 0)),
    high_52w_today: high252 != null && high != null ? high >= high252 : false,
    pct_off_52w_high: high252 && close ? round4(100 * (close / high252 - 1)) : null,
    price_vs_50sma: close && avgC50 ? round4(100 * (close / avgC50 - 1)) : null,
    price_vs_200sma: close && avgC200 ? round4(100 * (close / avgC200 - 1)) : null,
    dollar_volume: round4(dollarVolume),
    industry_rs: null,
    ti65_bullish: avgC7 && avgC65 ? avgC7 / avgC65 >= 1.05 : false,
    ti65_bearish: avgC7 && avgC65 ? avgC7 / avgC65 <= 0.95 : false,
    mdt_bullish: close && avgC126 ? close / avgC126 >= 1.19 : false,
    mdt_bearish: close && avgC126 ? close / avgC126 <= 0.81 : false,
    dt_bullish: close && minL252 ? close / minL252 >= 1.8 : false,
    bull_4pct_bo: close && prevClose && volume != null && prevVolume != null ? close / prevClose >= 1.04 && volume > prevVolume && volume >= 100000 : false,
    bear_4pct_bo: close && prevClose && volume != null && prevVolume != null ? close / prevClose <= 0.96 && volume > prevVolume && volume >= 100000 : false,
    dollar_bull_bo: close != null && open != null && volume != null ? close - open >= 0.9 && volume > 100000 : false,
    dollar_bear_bo: close != null && open != null && volume != null ? open - close >= 0.9 && volume >= 100000 : false
  };
  return derived;
}
function scoreStatus(score, inverse = false) {
  const value = Number(score);
  if (!Number.isFinite(value)) return { tone: "neutral", label: "NA", interpretation: "Insufficient data" };
  if (inverse) {
    if (value <= 35) return { tone: "green", label: "Green", interpretation: "Not extended" };
    if (value <= 60) return { tone: "amber", label: "Amber", interpretation: "Extended / caution" };
    return { tone: "red", label: "Red", interpretation: "Very extended / avoid chasing" };
  }
  if (value >= 70) return { tone: "green", label: "Green", interpretation: "Strong" };
  if (value >= 45) return { tone: "amber", label: "Amber", interpretation: "Developing or mixed" };
  return { tone: "red", label: "Red", interpretation: "Weak" };
}
function percentileRank(values, value) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length || !Number.isFinite(Number(value))) return null;
  const index = nums.filter((item) => item <= Number(value)).length;
  return 100 * index / nums.length;
}
function dailyReturnPct(rows, lookback) {
  const latest = rows.at(-1);
  const prior = rows.length > lookback ? rows[rows.length - 1 - lookback] : null;
  const close = Number(latest?.close), priorClose = Number(prior?.close);
  return close && priorClose ? 100 * (close / priorClose - 1) : null;
}
function avgNumber(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
function buildScreenerDecisionSupport(symbol, rows = [], latestInput = {}) {
  const sortedRows = [...rows].filter((row) => row?.sdate).sort((a, b) => String(a.sdate).localeCompare(String(b.sdate)));
  const latest = { ...(latestInput || {}), ...(sortedRows.at(-1) || {}) };
  const derived = deriveStockbeeColumns(sortedRows);
  const close = Number(latest.close);
  const high = Number(latest.high);
  const low = Number(latest.low);
  const high252 = Math.max(...sortedRows.slice(-252).map((row) => Number(row.high)).filter(Number.isFinite));
  const low252 = Math.min(...sortedRows.slice(-252).map((row) => Number(row.low)).filter(Number.isFinite));
  const c20 = Number(derived.c20);
  const rs = Number(derived.rs_score ?? latest.rs_val_3m ?? latest.rs_val);
  const trend = Number(derived.trend_score);
  const breakout = Number(derived.breakout_score);
  const accumulation = Number(derived.accumulation_score);
  const rv20 = Number(derived.rv20);
  const rmv = Number(derived.rmv);
  const offHighPenalty = Number.isFinite(Number(derived.pct_off_52w_high)) ? Math.min(20, Math.abs(Number(derived.pct_off_52w_high))) : 10;
  const tqs = clamp(Math.round(avgNumber([trend, rs, Number.isFinite(c20) ? clamp(50 + c20, 0, 100) : null, Number.isFinite(accumulation) ? accumulation : null]) ?? 0), 0, 100);
  const esRaw = avgNumber([
    Number.isFinite(Number(derived.price_vs_50sma)) ? clamp(Number(derived.price_vs_50sma) * 2, 0, 100) : null,
    Number.isFinite(c20) ? clamp(c20 * 2.2, 0, 100) : null,
    Number.isFinite(rmv) ? clamp(rmv, 0, 100) : null,
    Number.isFinite(close) && Number.isFinite(high252) && high252 > 0 ? clamp(100 - Math.abs(100 * (close / high252 - 1)) * 4, 0, 100) : null
  ]);
  const es = clamp(Math.round(esRaw ?? 50), 0, 100);
  const brs = clamp(Math.round(avgNumber([breakout, Number.isFinite(Number(derived.vcp_score)) ? Number(derived.vcp_score) : null, Number.isFinite(Number(derived.cheat_entry_score)) ? Number(derived.cheat_entry_score) : null, 100 - offHighPenalty]) ?? 0), 0, 100);
  const cs = clamp(Math.round(avgNumber([accumulation, Number.isFinite(rv20) ? clamp(rv20 * 25, 0, 100) : null, Number.isFinite(Number(derived.ud_50d)) ? clamp(Number(derived.ud_50d) * 30, 0, 100) : null, Number.isFinite(rs) ? rs : null]) ?? 0), 0, 100);
  const metricDefs = [
    ["TQS", "Trend Quality Score", tqs, false, "Trend Quality Score measures whether the stock is in a strong, healthy trend. It uses relative strength, EMA alignment, EMA slopes, ADX, volume confirmation, new-high participation, sector strength, and market-regime alignment. Higher is better.", "Strong quality trend", "Developing or mixed trend", "Weak trend", [
      `RS score ${Number.isFinite(rs) ? rs.toFixed(1) : "NA"}`,
      `Trend composite ${Number.isFinite(trend) ? trend.toFixed(1) : "NA"}`,
      `20-day change ${Number.isFinite(c20) ? c20.toFixed(1) + "%" : "NA"}`
    ], "Higher RS, aligned moving averages, positive volume confirmation, and sector strength improve the score.", "Falling below moving averages, weak RS, and poor volume confirmation weaken the score."],
    ["ES", "Extension Score", es, true, "Extension Score measures whether the stock is stretched since the trend started. It compares current price distance from trend, ATR extension, z-score stretch, trend duration, velocity, volume climax, relative-strength acceleration, and historical stretch ceiling. Lower is better because high extension means chase risk.", "Not extended", "Extended / caution", "Very extended / avoid chasing", [
      `Price vs 50SMA ${Number.isFinite(Number(derived.price_vs_50sma)) ? Number(derived.price_vs_50sma).toFixed(1) + "%" : "NA"}`,
      `20-day return percentile ${percentileRank(sortedRows.map((_, i) => dailyReturnPct(sortedRows.slice(0, i + 1), 20)), c20)?.toFixed(0) ?? "NA"}`,
      `52-week stretch utilized ${Number.isFinite(close) && Number.isFinite(low252) && Number.isFinite(high252) && high252 > low252 ? (100 * (close - low252) / (high252 - low252)).toFixed(0) + "%" : "NA"}`
    ], "Pullbacks, sideways consolidation, lower ATR extension, and calmer volume improve the score.", "Sharp vertical moves, climax volume, and large distance above trend weaken the score."],
    ["BRS", "Breakout Readiness Score", brs, false, "Breakout Readiness Score measures whether the stock is forming an actionable breakout setup. It uses base quality, VCP structure, volatility compression, volume dry-up, relative strength during the base, pivot proximity, sector trend, and market alignment. Higher is better.", "Breakout ready", "Setup forming", "Not ready", [
      `Breakout composite ${Number.isFinite(breakout) ? breakout.toFixed(1) : "NA"}`,
      `VCP score ${Number.isFinite(Number(derived.vcp_score)) ? Number(derived.vcp_score).toFixed(1) : "NA"}`,
      `DCR ${Number.isFinite(Number(derived.dcr)) ? Number(derived.dcr).toFixed(0) : "NA"}`
    ], "Tight bases, dry-up in volatility, strong DCR, and proximity to pivot improve the score.", "Loose action, poor closing range, and weak relative strength weaken the score."],
    ["CS", "Conviction Score", cs, false, "Conviction Score measures whether there is evidence of institutional accumulation or sponsorship. It uses relative volume, up-volume versus down-volume, accumulation/distribution, pocket pivots, earnings gap quality, earnings surprise quality, institutional sponsorship trends, and sector leadership. Higher is better.", "Strong institutional support", "Mixed conviction", "Weak sponsorship", [
      `Accumulation score ${Number.isFinite(accumulation) ? accumulation.toFixed(1) : "NA"}`,
      `RV20 ${Number.isFinite(rv20) ? rv20.toFixed(2) : "NA"}`,
      `U/D 50D ${Number.isFinite(Number(derived.ud_50d)) ? Number(derived.ud_50d).toFixed(2) : "NA"}`
    ], "Higher up-volume, strong relative volume, and constructive accumulation improve the score.", "Distribution days, low relative volume, and weak sponsorship weaken the score."]
  ];
  const metrics = metricDefs.map(([key, name, score, inverse, tooltip, green, amber, red, contributors, improves, weakens]) => {
    const status = scoreStatus(score, inverse);
    const meaning = status.tone === "green" ? green : status.tone === "amber" ? amber : red;
    return { key, name, score, status: status.label, tone: status.tone, interpretation: meaning, tooltip, expanded: { meaning, currentScore: score, status: status.label, topContributors: contributors, improves, weakens, historicallyValidated: "Insufficient Data", actionHint: key === "ES" && score > 60 ? "Avoid fresh chase entries. Prefer pullback, consolidation, or reset." : "Use with the screener, chart structure, and risk rules before acting." } };
  });
  const situation = tqs >= 70 && es <= 35 && brs >= 70 && cs >= 70 ? "Best Setup" : tqs >= 70 && es > 60 ? "Strong but Late" : tqs >= 70 && brs < 70 ? "Watchlist Candidate" : tqs < 45 && brs >= 60 ? "Trap Risk" : tqs < 45 && es > 60 ? "Avoid" : "Developing Setup";
  const situationText = situation === "Best Setup" ? "Strong Trend + Low Extension + Breakout Ready + Institutional Support" : situation === "Strong but Late" ? "Trend strong but extension elevated" : situation === "Watchlist Candidate" ? "Trend healthy but setup still developing" : situation === "Trap Risk" ? "Weak trend despite apparent breakout structure" : situation === "Avoid" ? "Weak trend + extended + no setup" : "Mixed evidence; wait for cleaner alignment";
  const pullbackPct = Number.isFinite(close) && Number.isFinite(high) && high > 0 ? 100 * (close / high - 1) : null;
  const typicalPullback = avgNumber(sortedRows.slice(-120).map((row) => {
    const rowClose = Number(row.close), rowHigh = Number(row.high);
    return rowClose && rowHigh ? Math.abs(100 * (rowClose / rowHigh - 1)) : null;
  }));
  const stretchUtilized = Number.isFinite(close) && Number.isFinite(low252) && Number.isFinite(high252) && high252 > low252 ? 100 * (close - low252) / (high252 - low252) : null;
  const daysAbove20 = (() => {
    let streak = 0;
    for (let i = sortedRows.length - 1; i >= 0; i--) {
      const sample = sortedRows.slice(0, i + 1);
      const avg20 = avgField(sample, "close", 20);
      if (!avg20 || Number(sample.at(-1)?.close) < avg20) break;
      streak++;
    }
    return streak;
  })();
  const personalityType = tqs >= 70 && cs >= 70 ? "Momentum Leader" : es > 60 ? "Fast Extended Mover" : brs >= 70 ? "Breakout Candidate" : Number.isFinite(rmv) && rmv < 25 ? "Compression Builder" : "Mixed Profile";
  const volatilityClass = Number.isFinite(rmv) ? (rmv < 25 ? "Low / Compressed" : rmv <= 60 ? "Moderate" : "High / Expanded") : "Unknown";
  return {
    source: "daily_rs_cache_decision_support",
    computedAt: new Date().toISOString(),
    symbol,
    latestDate: latest.sdate || sortedRows.at(-1)?.sdate || null,
    metrics,
    situation: { label: situation, text: situationText },
    personality: {
      type: personalityType,
      typicalPullbackPct: round4(typicalPullback),
      currentPullbackPct: round4(pullbackPct),
      historicalStretchUtilizedPct: round4(stretchUtilized),
      trendPersistence: daysAbove20 ? `${daysAbove20} days above SMA20` : "Insufficient SMA20 history",
      volatilityClass
    },
    validation: {
      status: "Insufficient Data",
      badge: "Informational Only - Not Yet Validated as a Trading Filter",
      tooltip: "Validation Status shows whether this score framework has historically improved trade outcomes for this stock compared with the baseline screener signal.",
      report: {
        generatedAt: new Date().toISOString(),
        experiments: ["Baseline screener signal only", "Screener signal + TQS filter", "Screener signal + TQS + BRS", "Screener signal + TQS + BRS + ES filter", "Screener signal + TQS + BRS + ES + CS"],
        metrics: ["Win Rate", "Average 5-Day Return", "Average 10-Day Return", "Average 20-Day Return", "Median Return", "Sharpe Ratio", "Profit Factor", "Expectancy", "Maximum Drawdown", "MAE", "MFE"],
        extensionValidation: { avoidedCorrectly: null, avoidedIncorrectly: null, drawdownSaved: null, missedWinners: null, netBenefit: null },
        status: "queued_for_backtest_engine"
      }
    }
  };
}
function flattenDecisionScores(decision = {}) {
  const byKey = new Map((decision.metrics || []).map((metric) => [metric.key, metric]));
  const score = (key) => byKey.has(key) ? byKey.get(key).score : null;
  return {
    tqs_score: score("TQS"),
    es_score: score("ES"),
    brs_score: score("BRS"),
    bbs_score: score("BRS"),
    cs_score: score("CS")
  };
}
function screenerDerivedColumns() {
  return [
    { key: "dcr", label: "DCR", type: "number", formula: "100 * (close - low) / (high - low)" },
    { key: "wcr", label: "WCR", type: "number", formula: "100 * (close - 5d low) / (5d high - 5d low)" },
    { key: "rv20", label: "RV20", type: "number", formula: "volume / avg volume 20d" },
    { key: "ud_50d", label: "U/D 50D", type: "number", formula: "50d up volume / down volume" },
    { key: "c20", label: "C20", type: "number", formula: "20 trading day price change %" },
    { key: "rs_score", label: "RS Score", type: "number", formula: "rs_val_3m fallback rs_val" },
    { key: "rs_rank", label: "RS Rank", type: "number", formula: "Rank by RS Score inside latest cached universe" },
    { key: "trend_score", label: "Trend Score", type: "number", formula: "price and moving-average trend composite" },
    { key: "tqs_score", label: "TQS", type: "number", formula: "Decision support Trend Quality Score" },
    { key: "es_score", label: "ES", type: "number", formula: "Decision support Extension Score; lower is better" },
    { key: "brs_score", label: "BRS", type: "number", formula: "Decision support Breakout Readiness Score" },
    { key: "bbs_score", label: "BBS", type: "number", formula: "Compatibility alias for BRS" },
    { key: "cs_score", label: "CS", type: "number", formula: "Decision support Conviction Score" },
    { key: "rmv", label: "RMV", type: "number", formula: "ATR3/5/8 position in recent 5-period volatility range" },
    { key: "rmv_zone", label: "RMV Zone", type: "text", formula: "RMV interpretation band" },
    { key: "vcp_score", label: "VCP Score", type: "number", formula: "compression, momentum, and relative volume composite" },
    { key: "cheat_entry_score", label: "Cheat Entry", type: "number", formula: "closing range, compression, and C20 composite" },
    { key: "breakout_score", label: "Breakout", type: "number", formula: "52w proximity, RV20, and DCR composite" },
    { key: "momentum_burst_score", label: "Burst", type: "number", formula: "C20, RV20, and RS composite" },
    { key: "accumulation_score", label: "Accumulation", type: "number", formula: "U/D volume, RV20, and DCR composite" },
    { key: "high_52w_today", label: "52W High", type: "boolean", formula: "today high >= 252d high" },
    { key: "pct_off_52w_high", label: "% Off 52W", type: "number", formula: "100 * (close / 252d high - 1)" },
    { key: "price_vs_50sma", label: "vs 50 SMA", type: "number", formula: "100 * (close / avg close 50d - 1)" },
    { key: "price_vs_200sma", label: "vs 200 SMA", type: "number", formula: "100 * (close / avg close 200d - 1)" },
    { key: "dollar_volume", label: "$ Volume", type: "number", formula: "close * volume" },
    { key: "ytd_mom", label: "YTD", type: "number", formula: "100 * (C / first trading close of year - 1)" },
    { key: "mdt_mom", label: "MDT", type: "number", formula: "C / avgC126" },
    { key: "ti65_mom", label: "TI65", type: "number", formula: "avgC7 / avgC65" },
    { key: "m21_mom", label: "21", type: "number", formula: "C / C21" },
    { key: "m10_mom", label: "10", type: "number", formula: "C / C10" },
    { key: "m5_mom", label: "5", type: "number", formula: "C / C5" },
    { key: "one_year_mom", label: "one yr", type: "number", formula: "C / C252" },
    { key: "dt_mom", label: "DT", type: "number", formula: "C / minL252" },
    { key: "ti42_mom", label: "TI42", type: "number", formula: "100 * avgC4 / avgC42" },
    { key: "bull_4pct_bo", label: "4% BO", type: "boolean", formula: "C / C1 >= 1.04 and V > V1" },
    { key: "dollar_bull_bo", label: "$ BO", type: "boolean", formula: "C - O >= .90 and V > 100000" }
  ];
}
function latestRowsFromDailyRsCache(cache) {
  if (Array.isArray(cache.latestRows) && cache.latestRows.length) return cache.latestRows.map((row) => {
    const symbol = String(row.symbol || row.stock_symbol || "").toUpperCase();
    const cachedItem = cache.groupedBySymbol?.[symbol];
    const decision = cache.decisionSupportBySymbol?.[symbol] || (cachedItem ? buildScreenerDecisionSupport(symbol, cachedItem.rows || [], cachedItem.latest || {}) : null);
    const rowWithAlias = row.brs_score == null && row.bbs_score != null ? { ...row, brs_score: row.bbs_score } : { ...row };
    return rowWithAlias.tqs_score == null && decision ? { ...rowWithAlias, ...flattenDecisionScores(decision) } : rowWithAlias;
  });
  return Object.values(cache.groupedBySymbol || {}).map((item) => {
    if (!item.latest) return null;
    const decision = buildScreenerDecisionSupport(item.symbol, item.rows || [], item.latest || {});
    return { ...item.latest, ...deriveStockbeeColumns(item.rows || []), ...flattenDecisionScores(decision), symbol: item.symbol, historyRows: item.rows?.length || 0 };
  }).filter(Boolean);
}

const monitorIndexSymbols = ["QQQ", "QQQE", "DIA", "MDY", "IWM", "GLD", "SLV", "TLT", "BITO", "USO", "BNO"];
const monitorMegaCapSymbols = ["META", "AMZN", "NVDA", "MSFT", "AAPL", "GOOGL", "GOOG", "TSLA", "AVGO", "NFLX"];

function emaField(rows, field, length) {
  const values = rows.map((row) => num(row[field])).filter((value) => value != null);
  if (values.length < length) return null;
  const k = 2 / (length + 1);
  let ema = values.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  for (const value of values.slice(length)) ema = value * k + ema * (1 - k);
  return ema;
}

function maxField(rows, field, length) {
  const values = rows.slice(-length).map((row) => num(row[field])).filter((value) => value != null);
  return values.length ? Math.max(...values) : null;
}

function trueRangeRows(rows) {
  return rows.map((row, index) => {
    const high = num(row.high), low = num(row.low), priorClose = index ? num(rows[index - 1].close) : null;
    if (high == null || low == null) return null;
    return Math.max(high - low, priorClose == null ? high - low : Math.abs(high - priorClose), priorClose == null ? high - low : Math.abs(low - priorClose));
  }).filter((value) => value != null);
}

function avgValues(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function pctFromRatio(numerator, denominator, fallback = 50) {
  const n = Number(numerator), d = Number(denominator);
  return d > 0 ? round4(100 * n / d) : fallback;
}

function monitorIndicatorForItem(item = {}) {
  const rows = [...(item.rows || [])].filter((row) => row?.sdate).sort((a, b) => String(a.sdate).localeCompare(String(b.sdate)));
  const latest = { ...(item.latest || {}), ...(rows.at(-1) || {}) };
  const prior = priorRow(rows, 1) || {};
  const close = num(latest.close), open = num(latest.open), high = num(latest.high), low = num(latest.low), volume = num(latest.volume);
  const priorClose = num(prior.close);
  const high21 = maxField(rows, "high", 21), high65 = maxField(rows, "high", 65), high126 = maxField(rows, "high", 126), high252 = maxField(rows, "high", 252);
  const low21 = minField(rows, "low", 21), low65 = minField(rows, "low", 65), low126 = minField(rows, "low", 126), low252 = minField(rows, "low", 252);
  const avgVolume3 = avgField(rows, "volume", 3), avgVolume20 = avgField(rows, "volume", 20), avgVolume50 = avgField(rows, "volume", 50);
  const avgDollarVolume50 = avgValues(rows.slice(-50).map((row) => num(row.close) != null && num(row.volume) != null ? num(row.close) * num(row.volume) : null));
  const trueRanges = trueRangeRows(rows);
  const atr14 = trueRanges.length >= 14 ? avgValues(trueRanges.slice(-14)) : null;
  const adr20 = avgValues(rows.slice(-20).map((row) => {
    const h = num(row.high), l = num(row.low), c = num(row.close);
    return h != null && l != null && c ? 100 * (h - l) / c : null;
  }));
  return {
    symbol: String(item.symbol || latest.symbol || latest.stock_symbol || "").toUpperCase(),
    as_of_date: latest.sdate || null,
    sector: latest.sector || "Unknown",
    industry: latest.industry || "Unknown",
    theme: latest.theme || latest.sector || "Unknown",
    sub_theme: latest.sub_theme || latest.industry || "Unknown",
    open,
    high,
    low,
    close,
    volume,
    prior_close: priorClose,
    daily_return_pct: close && priorClose ? round4(100 * (close - priorClose) / priorClose) : null,
    open_to_close_pct: close && open ? round4(100 * (close - open) / open) : null,
    high_21: high21,
    high_65: high65,
    high_126: high126,
    high_252: high252,
    low_21: low21,
    low_65: low65,
    low_126: low126,
    low_252: low252,
    ema20: round4(emaField(rows, "close", 20)),
    ema50: round4(emaField(rows, "close", 50)),
    ema200: round4(emaField(rows, "close", 200)),
    atr14: round4(atr14),
    adr20_pct: round4(adr20),
    avg_volume_3: round4(avgVolume3),
    avg_volume_20: round4(avgVolume20),
    avg_volume_50: round4(avgVolume50),
    volume_ratio_50: volume != null && avgVolume50 ? round4(volume / avgVolume50) : null,
    dollar_volume_today: close != null && volume != null ? round4(close * volume) : null,
    avg_dollar_volume_50: round4(avgDollarVolume50),
    distance_from_52w_high_pct: close && high252 ? round4(100 * (close - high252) / high252) : null,
    distance_from_52w_low_pct: close && low252 ? round4(100 * (close - low252) / low252) : null,
    new_high_252_flag: high != null && high252 != null ? high >= high252 : false,
    new_low_252_flag: low != null && low252 != null ? low <= low252 : false,
    breakout_65_flag: close != null && high65 != null ? close >= high65 : false,
    breakdown_65_flag: close != null && low65 != null ? close <= low65 : false,
    previous_breakout_65_flag: priorClose != null && maxField(rows.slice(0, -1), "high", 65) != null ? priorClose >= maxField(rows.slice(0, -1), "high", 65) : false,
    rs_score: num(latest.rs_score) ?? num(latest.rs_val_3m) ?? num(latest.rs_val),
    rs_rank: num(latest.rs_rank),
    rs_percentile: null,
    benchmark_symbol: "SPY",
    lookback_period: 63,
    source: "rs_daily_cache",
    last_calculated_at: new Date().toISOString(),
    valid_history_days: rows.length
  };
}

function marketMonitorUniverse(cache) {
  const rows = Object.values(cache.groupedBySymbol || {}).map(monitorIndicatorForItem).filter((row) => row.symbol && row.close > 0);
  const rsRanked = [...rows].filter((row) => Number.isFinite(Number(row.rs_score))).sort((a, b) => Number(b.rs_score) - Number(a.rs_score));
  rsRanked.forEach((row, index) => {
    row.rs_rank = index + 1;
    row.rs_percentile = round4(100 * (rsRanked.length - index) / rsRanked.length);
  });
  return rows;
}

function breadthBaseUniverse(rows) {
  return rows.filter((row) => {
    const symbol = String(row.symbol || "");
    if (!/^[A-Z]{1,5}$/.test(symbol)) return false;
    if (Number(row.avg_volume_3 || 0) <= 100000) return false;
    return true;
  });
}

function defaultBreadthUniverse(rows) {
  return breadthBaseUniverse(rows).filter((row) => {
    if (row.close <= 5) return false;
    if (Number(row.avg_dollar_volume_50 || 0) < 5000000) return false;
    return true;
  });
}

function marketBreadthModel(rows, universe = "US Stocks, 3D Avg Volume > 100K") {
  const valid = rows.filter((row) => row.close > 0 && row.prior_close > 0 && row.open > 0);
  const upVolume = valid.filter((row) => row.close > row.prior_close).reduce((sum, row) => sum + Number(row.volume || 0), 0);
  const downVolume = valid.filter((row) => row.close < row.prior_close).reduce((sum, row) => sum + Number(row.volume || 0), 0);
  const metrics = [
    {
      key: "nhnl",
      label: "New Highs vs New Lows",
      bullish: valid.filter((row) => row.new_high_252_flag).length,
      bearish: valid.filter((row) => row.new_low_252_flag).length,
      denominator: valid.length,
      formula: "count(today high >= highest high over 252 sessions) vs count(today low <= lowest low over 252 sessions); universe requires 3-day average volume > 100,000"
    },
    {
      key: "advance_decline",
      label: "Advance vs Decline",
      bullish: valid.filter((row) => row.close > row.prior_close).length,
      bearish: valid.filter((row) => row.close < row.prior_close).length,
      denominator: valid.length,
      formula: "close > prior close vs close < prior close; universe requires 3-day average volume > 100,000"
    },
    {
      key: "open_close",
      label: "Up From Open vs Down From Open",
      bullish: valid.filter((row) => row.close > row.open).length,
      bearish: valid.filter((row) => row.close < row.open).length,
      denominator: valid.length,
      formula: "close > open vs close < open; universe requires 3-day average volume > 100,000"
    },
    {
      key: "up_volume",
      label: "Up Volume vs Down Volume",
      bullish: Math.round(upVolume),
      bearish: Math.round(downVolume),
      denominator: Math.round(upVolume + downVolume),
      formula: "sum(volume where close > prior close) vs sum(volume where close < prior close); universe requires 3-day average volume > 100,000"
    },
    {
      key: "up4_down4",
      label: "Up 4% vs Down 4%",
      bullish: valid.filter((row) => Number(row.daily_return_pct) >= 4).length,
      bearish: valid.filter((row) => Number(row.daily_return_pct) <= -4).length,
      denominator: valid.length,
      formula: "daily_return_pct >= 4 vs <= -4; universe requires 3-day average volume > 100,000"
    }
  ];
  for (const metric of metrics) metric.bullish_pct = pctFromRatio(metric.bullish, metric.denominator || (metric.bullish + metric.bearish), 50);
  return { universe, validSymbols: valid.length, rows: metrics };
}

function groupPerformance(rows, field = "sector", timeframe = "1D") {
  const lookbacks = { "1D": "daily_return_pct", "1W": 5, "1M": 21, "3M": 63, "6M": 126, "YTD": "ytd" };
  const groups = new Map();
  for (const row of rows) {
    const name = row[field] || "Unknown";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  const result = [];
  for (const [name, items] of groups.entries()) {
    const returns = items.map((item) => {
      if (timeframe === "1D") return item.daily_return_pct;
      const source = item.sourceRows || [];
      return null;
    }).filter(Number.isFinite);
    const avgReturn = avgValues(returns);
    const volumeRatio = avgValues(items.map((item) => item.volume_ratio_50));
    const advancing = items.filter((item) => Number(item.daily_return_pct) > 0).length;
    const avgRs = avgValues(items.map((item) => item.rs_percentile ?? item.rs_score));
    if (items.length < 2 && field !== "industry") continue;
    result.push({ name, return_pct: round4(avgReturn), rank: 0, rs_rank: round4(avgRs), volume_confirmation: round4(volumeRatio), constituents: items.length, advancing });
  }
  return result.filter((item) => item.return_pct != null).sort((a, b) => Number(b.return_pct) - Number(a.return_pct)).map((item, index) => ({ ...item, rank: index + 1 })).slice(0, 24);
}

function marketHealthModel(breadth, sectors, rows) {
  const getPct = (key) => Number((breadth.rows || []).find((row) => row.key === key)?.bullish_pct ?? 50);
  const breadthScore = Math.round(.25 * getPct("advance_decline") + .25 * getPct("up_volume") + .20 * getPct("nhnl") + .15 * getPct("open_close") + .15 * getPct("up4_down4"));
  const positiveSectorPct = pctFromRatio(sectors.filter((item) => Number(item.return_pct) > 0).length, sectors.length, 50);
  const growth = avgValues(sectors.filter((item) => /Technology|Communication|Consumer Cyclical|Discretionary/i.test(item.name)).map((item) => item.return_pct)) ?? 0;
  const defensive = avgValues(sectors.filter((item) => /Utilities|Staples|Healthcare|Health Care|Real Estate/i.test(item.name)).map((item) => item.return_pct)) ?? 0;
  const spreadScore = clamp(50 + (growth - defensive) * 12, 0, 100);
  const top3 = sectors.slice(0, 3).reduce((sum, item) => sum + Math.max(0, Number(item.return_pct || 0)), 0);
  const allPositive = sectors.reduce((sum, item) => sum + Math.max(0, Number(item.return_pct || 0)), 0);
  const concentrationPenalty = allPositive ? clamp(100 * top3 / allPositive - 45, 0, 35) : 0;
  const rotationScore = Math.round(clamp(.55 * positiveSectorPct + .45 * spreadScore - concentrationPenalty, 0, 100));
  const megaRows = rows.filter((row) => monitorMegaCapSymbols.includes(row.symbol));
  const megaCapScore = Math.round(pctFromRatio(megaRows.filter((row) => row.close > row.prior_close).length, megaRows.length, 50));
  const qqq = rows.find((row) => row.symbol === "QQQ"), qqqe = rows.find((row) => row.symbol === "QQQE");
  const divergence = round4(Number(qqq?.daily_return_pct || 0) - Number(qqqe?.daily_return_pct || 0));
  const state = breadthScore >= 65 && rotationScore >= 60 && megaCapScore >= 60 ? "RISK ON" : breadthScore < 35 && rotationScore < 40 ? "RISK OFF" : breadthScore < 45 || Math.abs(divergence || 0) > 1.5 ? "CAUTIOUS" : "NEUTRAL";
  return { breadth_score: breadthScore, rotation_score: rotationScore, mega_cap_score: megaCapScore, risk_state: state, qqq_return: qqq?.daily_return_pct ?? null, qqqe_return: qqqe?.daily_return_pct ?? null, cap_weight_divergence: divergence };
}

function trend2050(row) {
  const close = Number(row.close), ema20 = Number(row.ema20), ema50 = Number(row.ema50);
  if (!Number.isFinite(close) || !Number.isFinite(ema20) || !Number.isFinite(ema50)) return "Unknown";
  if (close > ema20 && ema20 > ema50) return "Bullish";
  if (close < ema20 && ema20 < ema50) return "Bearish";
  return "Neutral";
}

function monitorAssetRows(rows, symbols) {
  return symbols.map((symbol, index) => {
    const row = rows.find((item) => item.symbol === symbol);
    if (!row) return { symbol, rank: index + 1, missing: true, trend_20_50: "Unavailable" };
    return { ...row, rank: index + 1, last_price: row.close, daily_change_pct: row.daily_return_pct, trend_20_50: trend2050(row) };
  });
}

function marketLeadersModel(rows) {
  const valid = rows.filter((row) => row.close > 5 && row.avg_dollar_volume_50 > 5000000);
  const rsLeaders = [...valid].filter((row) => Number.isFinite(Number(row.rs_score))).sort((a, b) => Number(b.rs_score) - Number(a.rs_score)).slice(0, 25);
  const momentum = [...valid].filter((row) => row.close > row.ema20 && row.ema20 > row.ema50).sort((a, b) => Number(b.rs_percentile || 0) - Number(a.rs_percentile || 0) || Number(b.daily_return_pct || 0) - Number(a.daily_return_pct || 0)).slice(0, 25);
  const breakouts = [...valid].filter((row) => row.breakout_65_flag && !row.previous_breakout_65_flag && Number(row.volume_ratio_50 || 0) >= 1.5 && Number(row.rs_percentile || 0) >= 80).sort((a, b) => Number(b.rs_score || 0) - Number(a.rs_score || 0) || Number(b.volume_ratio_50 || 0) - Number(a.volume_ratio_50 || 0)).slice(0, 25);
  const dollarVolume = [...valid].sort((a, b) => Number(b.dollar_volume_today || 0) - Number(a.dollar_volume_today || 0)).slice(0, 25);
  const laggards = [...valid].filter((row) => Number(row.rs_percentile || 100) <= 20 && row.breakdown_65_flag && Number(row.daily_return_pct || 0) < 0).sort((a, b) => Number(a.rs_score || 100) - Number(b.rs_score || 100) || Number(a.daily_return_pct || 0) - Number(b.daily_return_pct || 0)).slice(0, 25);
  return { rs_leaders: rsLeaders, momentum_leaders: momentum, breakout_leaders: breakouts, dollar_volume_leaders: dollarVolume, laggards };
}

async function marketMonitorSnapshot(userId = adminUsername, options = {}) {
  const cache = await readDailyRsCache();
  if (!cache?.groupedBySymbol) {
    if (!dailyRsCacheWarmPromise && !dailyRsCacheMeta.warming) setTimeout(() => triggerDailyRsCacheWarm("market_monitor_snapshot", false), 250);
    throw cacheNotReadyError("Market Monitor daily cache is warming. Try again shortly.");
  }
  const key = `${cache.latestDate}:${dailyRsCacheMeta.lastBuiltAt || cache.builtAt}:${options.force ? "force" : "normal"}`;
  if (!options.force && marketMonitorSnapshotCache?.key === key && Date.now() - marketMonitorSnapshotCache.createdAt < 5 * 60 * 1000) return marketMonitorSnapshotCache.payload;
  const allRows = marketMonitorUniverse(cache);
  const stockRows = breadthBaseUniverse(allRows);
  const universeRows = defaultBreadthUniverse(allRows);
  const fullMarketBreadth = marketBreadthModel(stockRows, "Full Stock Market, 3D Avg Volume > 100K");
  const breadth = marketBreadthModel(universeRows, "Liquid Common Stocks, 3D Avg Volume > 100K");
  const sectors = groupPerformance(universeRows, "sector", "1D");
  const industries = groupPerformance(universeRows, "industry", "1D");
  const health = marketHealthModel(breadth, sectors, stockRows);
  const leaders = marketLeadersModel(universeRows);
  const news = await marketNewsService(userId, cache.latestDate, options.forceNews);
  const breakouts = universeRows.filter((row) => row.breakout_65_flag).length;
  const breakdowns = universeRows.filter((row) => row.breakdown_65_flag).length;
  const payload = {
    full_market_breadth: fullMarketBreadth,
    breadth,
    stage_analysis: { tabs: ["Today", "1W", "1M", "3M", "6M", "YTD"], today: industries.slice(0, 18), source: "industry equal-weight daily returns" },
    market_health: {
      ...health,
      regime_box: {
        trend: health.risk_state === "RISK ON" ? "BULLISH" : health.risk_state === "RISK OFF" ? "BEARISH" : "NEUTRAL",
        breadth: health.breadth_score,
        rs_leaders: universeRows.filter((row) => Number(row.rs_percentile || 0) >= 80).length,
        breakouts,
        breakdowns,
        risk_state: health.risk_state
      }
    },
    market_brief: {
      tabs: ["Market Structure", "News Sentiment", "Sectors", "Risks"],
      structure: `Breadth ${health.breadth_score}, rotation ${health.rotation_score}, mega caps ${health.mega_cap_score}; state ${health.risk_state}.`,
      breadth_commentary: breadth.rows.map((row) => `${row.label}: ${row.bullish_pct}% bullish`).join("; "),
      rotation_commentary: sectors.slice(0, 3).map((row) => `${row.name} ${row.return_pct}%`).join("; "),
      mega_cap_commentary: `Mega cap participation score ${health.mega_cap_score}; QQQ minus QQQE ${health.cap_weight_divergence ?? "NA"}%.`,
      news_summary: news.summary,
      inputs: { breadth_score: health.breadth_score, rotation_score: health.rotation_score, mega_cap_score: health.mega_cap_score, sector_performance: sectors.slice(0, 5), rs_leaders: leaders.rs_leaders.slice(0, 5), news_source: news.source }
    },
    sector_theme_performance: { sectors, themes: sectors, industries, controls: ["return_pct", "rs_rank", "volume_confirmation", "gainers", "decliners"] },
    indexes: { symbols: monitorIndexSymbols, rows: monitorAssetRows(allRows, monitorIndexSymbols) },
    mega_caps: { symbols: monitorMegaCapSymbols, rows: monitorAssetRows(allRows, monitorMegaCapSymbols), score: health.mega_cap_score, cap_weight_divergence: health.cap_weight_divergence },
    leaders,
    news,
    metadata: { as_of_date: cache.latestDate, last_updated_at: new Date().toISOString(), source_status: cache.latestDate ? "ready" : "missing", cache_status: dailyRsCacheMeta.status, cache_store: dailyRsCacheMeta.store, universe_count: universeRows.length, stock_universe_count: stockRows.length, all_symbol_count: allRows.length, min_avg_volume_3: 100000 }
  };
  const inference = await marketMonitorLlmInference(userId, payload);
  payload.llm_inference = inference;
  payload.market_brief.llm_inference = inference;
  payload.market_brief.inference_status = { status: inference.status, cached: inference.cached, prompt_version: inference.prompt_version, generated_at: inference.generated_at, model: inference.model };
  marketMonitorSnapshotCache = { key, createdAt: Date.now(), payload };
  return payload;
}

function hierarchyTone(value, fallback = "amber") {
  const text = String(value || "").toUpperCase();
  if (["RISK ON", "BULLISH", "GREEN", "CONFIRMED", "PASS"].some((key) => text.includes(key))) return "green";
  if (["RISK OFF", "BEARISH", "RED", "FAIL"].some((key) => text.includes(key))) return "red";
  if (Number.isFinite(Number(value))) {
    const number = Number(value);
    if (number >= 65) return "green";
    if (number < 40) return "red";
  }
  return fallback;
}

function performanceTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "amber";
  if (number > 0.35) return "green";
  if (number < -0.35) return "red";
  return "amber";
}

async function marketHierarchySnapshot(userId = adminUsername, options = {}) {
  const monitor = await marketMonitorSnapshot(userId, options);
  const key = `${monitor.metadata?.as_of_date || ""}:${monitor.metadata?.last_updated_at || ""}`;
  if (!options.force && marketHierarchyCache?.key === key && Date.now() - marketHierarchyCache.createdAt < 5 * 60 * 1000) return marketHierarchyCache.payload;
  const health = monitor.market_health || {};
  const box = health.regime_box || {};
  const sectors = (monitor.sector_theme_performance?.sectors || []).slice(0, 5).map((item) => ({
    name: item.name,
    rank: item.rank,
    value: item.return_pct,
    label: `${item.return_pct ?? "NA"}%`,
    tone: performanceTone(item.return_pct)
  }));
  const industries = (monitor.sector_theme_performance?.industries || []).slice(0, 8).map((item) => ({
    name: item.name,
    rank: item.rank,
    value: item.return_pct,
    label: `${item.return_pct ?? "NA"}%`,
    tone: performanceTone(item.return_pct)
  }));
  const stocks = (monitor.leaders?.rs_leaders || []).slice(0, 12).map((item, index) => ({
    symbol: item.symbol,
    rsScore: pct(item.rs_score ?? item.rs_percentile, null),
    leadershipRank: index + 1,
    signalState: item.breakout_65_flag ? "Breakout" : item.close > item.ema20 && item.ema20 > item.ema50 ? "Trend" : "Watch",
    tone: hierarchyTone(item.rs_percentile ?? item.rs_score)
  }));
  const marketTone = hierarchyTone(health.risk_state || box.trend);
  const commentary = [
    `Market is ${String(health.risk_state || box.trend || "unclassified").toLowerCase()} with breadth ${box.breadth ?? health.breadth_score ?? "NA"}.`,
    sectors.length ? `${sectors.slice(0, 2).map((item) => item.name).join(" and ")} lead sector rotation.` : "",
    industries.length ? `${industries.slice(0, 2).map((item) => item.name).join(" and ")} are the strongest industry groups.` : "",
    stocks.length ? `Focus list starts with ${stocks.slice(0, 4).map((item) => item.symbol).join(", ")}.` : "",
    box.breakdowns > box.breakouts ? "Breakdowns currently exceed breakouts, so risk controls stay important." : "Breakout participation is supportive versus breakdown pressure."
  ].filter(Boolean).join(" ");
  const payload = {
    source: "mtm.market_hierarchy_cache",
    asOfDate: monitor.metadata?.as_of_date || null,
    updatedAt: new Date().toISOString(),
    market: {
      regime: health.risk_state || box.trend || "Unknown",
      breadthStatus: box.breadth ?? health.breadth_score ?? null,
      riskStatus: health.risk_state || "Unknown",
      tone: marketTone,
      metrics: {
        breadthScore: health.breadth_score,
        rotationScore: health.rotation_score,
        megaCapScore: health.mega_cap_score,
        breakouts: box.breakouts,
        breakdowns: box.breakdowns,
        rsLeaders: box.rs_leaders
      }
    },
    sectors,
    industries,
    stocks,
    commentary,
    workflow: ["Market", "Sector", "Industry", "Stock", "Watchlist", "Signal", "Trade", "Journal", "Review"],
    navigation: ["Dashboard", "Scanner", "Signal", "Trading", "Risk", "Agents", "Marketplace"]
  };
  marketHierarchyCache = { key, createdAt: Date.now(), payload };
  return payload;
}

async function marketNewsService(userId, asOfDate, force = false) {
  const key = `${userId}:${asOfDate}:${marketNewsDefaultSymbols.join(",")}`;
  const cached = marketNewsCache.get(key);
  const ttlMs = isMarketHoursEastern() ? 15 * 60 * 1000 : 60 * 60 * 1000;
  if (!force && cached && Date.now() - cached.createdAt < ttlMs) return cached.payload;
  const payload = await buildMarketNewsPayload(userId, asOfDate);
  marketNewsCache.set(key, { createdAt: Date.now(), payload });
  return payload;
}

function isMarketHoursEastern() {
  const now = easternNow();
  return isNasdaqBusinessDay(now.date) && now.hour >= 9 && (now.hour < 16 || (now.hour === 16 && now.minute === 0));
}

function normalizeNewsArticle(symbol, item = {}) {
  return {
    symbol,
    title: String(item.title || "").trim(),
    date: item.date || item.publishedAt || item.published_at || "",
    source: item.source || item.publisher || "",
    link: item.link || item.url || "",
    content: item.content || item.description || "",
    symbols: Array.isArray(item.symbols) ? item.symbols : [],
    sentiment: item.sentiment ?? null,
    raw_provider: "EODHD"
  };
}

async function buildMarketNewsPayload(userId, asOfDate) {
  const refreshedAt = new Date().toISOString();
  const apiToken = await effectiveEodhdToken(userId);
  if (!apiToken) return { source: "EODHD", status: "missing_token", articles: [], summary: { executive_summary: "News unavailable; showing market-structure summary only.", market_narrative: "", bullish_drivers: [], bearish_drivers: [], sector_theme_mentions: [], macro_mentions: [], risk_level: "Neutral", notable_symbols: [], timestamp: refreshedAt }, symbols: marketNewsDefaultSymbols, article_count: 0, refreshed_at: refreshedAt, summary_generated_at: null, warning: "EODHD token unavailable." };
  try {
    const raw = [];
    for (const symbol of marketNewsDefaultSymbols) {
      const params = new URLSearchParams({ s: symbol, offset: "0", limit: String(marketNewsLimit), api_token: apiToken, fmt: "json" });
      try {
        const rows = await fetchJsonFast(`${eodhdNewsBaseUrl}?${params.toString()}`, 6000);
        for (const item of (Array.isArray(rows) ? rows : [])) raw.push(normalizeNewsArticle(symbol, item));
      } catch {
        // News must never block the Market Monitor snapshot.
      }
    }
    const seen = new Set();
    const articles = raw.filter((article) => {
      const key = `${article.title.toLowerCase()}|${article.link}`;
      if (!article.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, marketNewsMaxLlmArticles);
    const summary = await summarizeMarketNews(userId, articles, refreshedAt);
    return { source: "EODHD", status: "ready", symbols: marketNewsDefaultSymbols, articles, article_count: articles.length, refreshed_at: refreshedAt, summary_generated_at: summary.timestamp || refreshedAt, summary };
  } catch (error) {
    const fallback = [...marketNewsCache.values()].reverse().find((entry) => entry.payload?.articles?.length)?.payload;
    if (fallback) return { ...fallback, status: "stale", warning: `News unavailable; using latest cached summary. ${error.message}` };
    return { source: "EODHD", status: "failed", articles: [], summary: { executive_summary: "News unavailable; showing market-structure summary only.", market_narrative: "", bullish_drivers: [], bearish_drivers: [], sector_theme_mentions: [], macro_mentions: [], risk_level: "Neutral", notable_symbols: [], timestamp: refreshedAt }, symbols: marketNewsDefaultSymbols, article_count: 0, refreshed_at: refreshedAt, summary_generated_at: null, warning: error.message };
  }
}

async function fetchJsonFast(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function summarizeMarketNews(userId, articles, timestamp) {
  const empty = { executive_summary: "News unavailable; showing market-structure summary only.", market_narrative: "", bullish_drivers: [], bearish_drivers: [], sector_theme_mentions: [], macro_mentions: [], risk_level: "Neutral", notable_symbols: [], timestamp };
  if (!articles.length) return empty;
  const token = await effectiveOpenaiToken(userId);
  if (!token) return { ...fallbackNewsSummary(articles, timestamp), llm_status: "missing_token" };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.2,
        max_output_tokens: 1000,
        input: [
          { role: "system", content: "You are a professional market strategist. Summarize market news objectively for a trading dashboard. Do not invent facts. Use only the supplied articles." },
          { role: "user", content: `Summarize the following latest market news items for a Market Monitor dashboard. Return JSON only with keys executive_summary, market_narrative, bullish_drivers, bearish_drivers, sector_theme_mentions, macro_mentions, risk_level, notable_symbols, timestamp. Articles:\n${JSON.stringify(articles)}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI summary failed HTTP ${response.status}`);
    const data = await response.json();
    const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
    return { ...empty, ...JSON.parse(text), timestamp };
  } catch (error) {
    return { ...fallbackNewsSummary(articles, timestamp), llm_status: "failed", warning: "LLM summary unavailable", error: error.message };
  }
}

function fallbackNewsSummary(articles, timestamp) {
  const titles = articles.slice(0, 8).map((article) => article.title);
  return { executive_summary: titles.length ? titles.join(" | ").slice(0, 700) : "News unavailable; showing market-structure summary only.", market_narrative: "LLM summary unavailable. Showing latest EODHD article titles only.", bullish_drivers: [], bearish_drivers: [], sector_theme_mentions: [], macro_mentions: [], risk_level: "Neutral", notable_symbols: [...new Set(articles.flatMap((article) => [article.symbol, ...(article.symbols || [])]).filter(Boolean))].slice(0, 12), timestamp };
}

function compactMarketBreadth(breadth = {}) {
  return {
    universe: breadth.universe || "",
    valid_symbols: Number(breadth.validSymbols || 0),
    rows: (breadth.rows || []).map((row) => ({
      key: row.key,
      label: row.label,
      bullish: row.bullish,
      bearish: row.bearish,
      denominator: row.denominator || row.bullish + row.bearish,
      bullish_pct: row.bullish_pct
    }))
  };
}

function compactMarketRows(rows = [], limit = 5) {
  return rows.slice(0, limit).map((row) => ({
    name: row.name,
    return_pct: row.return_pct,
    rs_rank: row.rs_rank,
    volume_confirmation: row.volume_confirmation,
    constituents: row.constituents,
    advancing: row.advancing
  }));
}

function compactLeaderRows(rows = [], limit = 5) {
  return rows.slice(0, limit).map((row) => ({
    symbol: row.symbol,
    sector: row.sector,
    rs_score: row.rs_score,
    daily_return_pct: row.daily_return_pct
  }));
}

function compactAssetRows(rows = [], limit = 12) {
  return rows.slice(0, limit).map((row) => ({
    symbol: row.symbol,
    daily_change_pct: row.daily_change_pct,
    adr20_pct: row.adr20_pct,
    volume_ratio_50: row.volume_ratio_50,
    trend_20_50: row.trend_20_50,
    missing: Boolean(row.missing)
  }));
}

function detectMarketMonitorDataQuality(payload = {}) {
  const notes = [];
  const leaders = payload.leaders || {};
  const rsLeaders = leaders.rs_leaders || [];
  const laggards = leaders.laggards || [];
  const first = rsLeaders[0], second = rsLeaders[1];
  if (first && second && Number(first.rs_score) > Number(second.rs_score) * 2) {
    notes.push({ severity: "warning", message: `${first.symbol} has an extreme RS outlier score of ${round4(first.rs_score)} versus ${second.symbol} at ${round4(second.rs_score)}, creating leadership concentration and score-scaling risk.` });
  }
  const box = payload.market_health?.regime_box || {};
  if (box.rs_leaders == null && box.breakouts == null && box.breakdowns == null) {
    notes.push({ severity: "warning", message: "regime_box has rs_leaders, breakouts, and breakdowns all null, so confirmed leadership and breakout/breakdown confirmation are unavailable." });
  }
  for (const row of payload.indexes?.rows || []) {
    const ratio = Number(row.volume_ratio_50);
    if (row.missing) notes.push({ severity: "warning", message: `${row.symbol} was not available in the latest rs_daily index/ETF monitor query.` });
    else if (Number.isFinite(ratio) && (ratio < 0.5 || ratio > 2.5)) notes.push({ severity: "warning", message: `${row.symbol} has volume_ratio_50 of ${round4(ratio)}, which is outside the normal 0.50 to 2.50 monitor band and should be treated as anomalous participation or possible data quality issue.` });
  }
  const contaminationPattern = /etf|fund|trust|inverse|leveraged|crypto|ethereum|bitcoin|long .*short|short .*usd|long .*usd/i;
  for (const row of [...rsLeaders, ...laggards]) {
    const label = `${row.symbol || ""} ${row.sector || ""} ${row.industry || ""}`;
    if (contaminationPattern.test(label)) notes.push({ severity: "warning", message: `${row.symbol} appears in leadership or laggard output with label ${row.sector || row.industry || "Unknown"}, indicating possible non-common-stock or synthetic product contamination inside the stock universe.` });
  }
  if ((payload.sector_theme_performance?.sectors || []).some((row) => /Electronic technology|Consumer non-durables|Finance|Technology services|Health technology/i.test(row.name || ""))) {
    notes.push({ severity: "warning", message: "Some vendor sector labels are non-GICS categories such as Electronic technology, Finance, Technology services, Health technology, and Consumer non-durables; sector interpretation should account for source taxonomy." });
  }
  notes.push({ severity: "info", message: "Breadth uses only stocks with 3-day average volume above 100000." });
  const seen = new Set();
  return notes.filter((note) => {
    const key = `${note.severity}:${note.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function marketMonitorInferenceInput(payload = {}) {
  const sectors = payload.sector_theme_performance?.sectors || [];
  const weakSectors = [...sectors].slice(-5).reverse();
  return {
    as_of_date: payload.metadata?.as_of_date,
    cache_status: payload.metadata?.cache_status || payload.metadata?.source_status,
    data_scope: {
      latest_rs_daily_rows: payload.metadata?.all_symbol_count,
      full_stock_universe_rule: "symbol format A-Z 1 to 5 letters and 3-day average volume > 100000",
      full_stock_universe_count: payload.metadata?.stock_universe_count,
      liquid_universe_rule: "full stock universe plus close > 5 and 50-day average dollar volume >= 5000000",
      liquid_universe_count: payload.metadata?.universe_count
    },
    full_market_breadth: compactMarketBreadth(payload.full_market_breadth),
    liquid_breadth: compactMarketBreadth(payload.breadth),
    market_health: {
      breadth_score: payload.market_health?.breadth_score,
      rotation_score: payload.market_health?.rotation_score,
      mega_cap_score: payload.market_health?.mega_cap_score,
      risk_state: payload.market_health?.risk_state,
      qqq_return: payload.market_health?.qqq_return,
      qqqe_return: payload.market_health?.qqqe_return,
      cap_weight_divergence: payload.market_health?.cap_weight_divergence,
      regime_box: payload.market_health?.regime_box || {}
    },
    sector_rotation: {
      top_sectors: compactMarketRows(sectors, 5),
      weak_sectors: compactMarketRows(weakSectors, 5)
    },
    leaders: {
      rs_leaders: compactLeaderRows(payload.leaders?.rs_leaders || [], 5),
      laggards: compactLeaderRows(payload.leaders?.laggards || [], 5)
    },
    indexes: compactAssetRows(payload.indexes?.rows || [], 12),
    mega_caps: compactAssetRows(payload.mega_caps?.rows || [], 12),
    data_quality: detectMarketMonitorDataQuality(payload)
  };
}

function marketMonitorInferencePrompt(input) {
  return `You are a professional market regime analyst for a rules-based trading dashboard.

Analyze only the supplied structured market metrics.
Do not invent data.
Do not mention symbols, sectors, or scores that are not present in the input.
Do not provide personalized financial advice.
Focus on regime, breadth, participation, leadership, concentration risk, risk management, and data quality.

Return strict JSON only. No markdown. No commentary outside JSON.

Required anomaly checks:
${marketMonitorInferencePromptContract.anomalyChecks.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Input JSON:
${JSON.stringify(input)}

Return this exact JSON schema:
${JSON.stringify(marketMonitorInferencePromptContract.outputSchema, null, 2)}`;
}

function marketMonitorInferenceJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["regime", "confidence", "summary", "bullish_evidence", "bearish_evidence", "divergences", "leadership_read", "sector_rotation_read", "risk_actions", "watch_conditions", "data_quality_notes", "anomaly_flags"],
    properties: {
      regime: { type: "string", enum: ["RISK_ON", "NEUTRAL", "CAUTIOUS", "RISK_OFF"] },
      confidence: { type: "number", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      bullish_evidence: { type: "array", items: { type: "string" } },
      bearish_evidence: { type: "array", items: { type: "string" } },
      divergences: { type: "array", items: { type: "string" } },
      leadership_read: { type: "string" },
      sector_rotation_read: { type: "string" },
      risk_actions: { type: "array", items: { type: "string" } },
      watch_conditions: { type: "array", items: { type: "string" } },
      data_quality_notes: { type: "array", items: { type: "string" } },
      anomaly_flags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "type", "symbol", "message"],
          properties: {
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            type: { type: "string", enum: ["LEADERSHIP_CONCENTRATION", "REGIME_CONFIRMATION_MISSING", "VOLUME_ANOMALY", "UNIVERSE_CONTAMINATION", "TAXONOMY_WARNING", "MISSING_DATA"] },
            symbol: { type: "string" },
            message: { type: "string" }
          }
        }
      }
    }
  };
}

function parseStrictJsonText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Empty LLM response.");
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("LLM response was not valid JSON.");
  }
}

function normalizeMarketInference(raw = {}, input = {}, meta = {}) {
  const regime = ["RISK_ON", "NEUTRAL", "CAUTIOUS", "RISK_OFF"].includes(raw.regime) ? raw.regime : input.market_health?.risk_state || "NEUTRAL";
  const rawConfidence = Number(raw.confidence || 0);
  const confidence = Number.isFinite(rawConfidence) && rawConfidence > 0 && rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;
  return {
    prompt_version: marketMonitorInferencePromptContract.version,
    status: meta.status || "ready",
    cached: Boolean(meta.cached),
    model: meta.model || openaiModel,
    generated_at: meta.generated_at || new Date().toISOString(),
    as_of_date: input.as_of_date,
    input_hash: meta.input_hash,
    regime,
    confidence: clamp(confidence, 0, 100),
    summary: String(raw.summary || "").slice(0, 1200),
    bullish_evidence: Array.isArray(raw.bullish_evidence) ? raw.bullish_evidence.slice(0, 8).map(String) : [],
    bearish_evidence: Array.isArray(raw.bearish_evidence) ? raw.bearish_evidence.slice(0, 8).map(String) : [],
    divergences: Array.isArray(raw.divergences) ? raw.divergences.slice(0, 8).map(String) : [],
    leadership_read: String(raw.leadership_read || "").slice(0, 800),
    sector_rotation_read: String(raw.sector_rotation_read || "").slice(0, 800),
    risk_actions: Array.isArray(raw.risk_actions) ? raw.risk_actions.slice(0, 8).map(String) : [],
    watch_conditions: Array.isArray(raw.watch_conditions) ? raw.watch_conditions.slice(0, 8).map(String) : [],
    data_quality_notes: Array.isArray(raw.data_quality_notes) ? raw.data_quality_notes.slice(0, 10).map(String) : [],
    anomaly_flags: Array.isArray(raw.anomaly_flags) ? raw.anomaly_flags.slice(0, 10).map((item) => ({
      severity: item?.severity || "warning",
      type: item?.type || "MISSING_DATA",
      symbol: item?.symbol || "",
      message: String(item?.message || "").slice(0, 500)
    })) : []
  };
}

async function marketMonitorLlmInference(userId, payload) {
  const input = marketMonitorInferenceInput(payload);
  const inputHash = createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
  const stateName = `${marketMonitorInferencePromptContract.cachePrefix}:v1:${input.as_of_date || "unknown"}:${inputHash.slice(0, 32)}`;
  const transientMs = 10 * 60 * 1000;
  try {
    const cached = await readDbState(userId, stateName);
    if (cached?.inference) {
      const status = String(cached.inference.status || "");
      const generatedAt = Date.parse(cached.inference.generated_at || "");
      const isTransient = ["failed", "missing_token"].includes(status);
      if (!isTransient || (Number.isFinite(generatedAt) && Date.now() - generatedAt < transientMs)) return { ...cached.inference, cached: true, status: isTransient ? status : "cached" };
    }
  } catch {
    // DB state cache should never block the numeric Market Monitor.
  }
  const token = await effectiveOpenaiToken(userId);
  if (!token) {
    const inference = normalizeMarketInference({
      regime: input.market_health?.risk_state || "NEUTRAL",
      confidence: 0,
      summary: "LLM inference unavailable because no OpenAI token is configured.",
      data_quality_notes: input.data_quality.map((item) => item.message)
    }, input, { status: "missing_token", input_hash: inputHash });
    try { await writeDbState(userId, stateName, { inference, input }); } catch {}
    return inference;
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.1,
        max_output_tokens: 1400,
        text: {
          format: {
            type: "json_schema",
            name: "market_monitor_inference",
            strict: true,
            schema: marketMonitorInferenceJsonSchema()
          }
        },
        input: [
          { role: "system", content: "You are a professional market regime analyst. Return valid JSON only." },
          { role: "user", content: marketMonitorInferencePrompt(input) }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI market inference failed HTTP ${response.status}`);
    const data = await response.json();
    const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
    const inference = normalizeMarketInference(parseStrictJsonText(text), input, { status: "ready", cached: false, input_hash: inputHash, generated_at: new Date().toISOString() });
    try { await writeDbState(userId, stateName, { inference, input }); } catch {}
    return inference;
  } catch (error) {
    const errorMessage = error?.cause?.message || error?.message || "OpenAI request failed";
    const inference = normalizeMarketInference({
      regime: input.market_health?.risk_state || "NEUTRAL",
      confidence: 0,
      summary: `LLM inference unavailable (${errorMessage}); showing deterministic Market Monitor metrics only.`,
      data_quality_notes: [...input.data_quality.map((item) => item.message), errorMessage]
    }, input, { status: "failed", input_hash: inputHash });
    try { await writeDbState(userId, stateName, { inference, input }); } catch {}
    return inference;
  }
}

function sortScreenerRows(rows, sort = "rs_val", direction = "desc") {
  if (sort === "__none__") return rows;
  const derivedKeys = screenerDerivedColumns().map((column) => column.key);
  const key = [...derivedKeys, "symbol", "stock_symbol", "industry", "sector", "rs_val", "rs_val_3m", "mci", "perf_5d_pct", "volume", "close", "ytd_mom"].includes(sort) ? sort : "rs_val";
  const multiplier = String(direction || "desc").toLowerCase() === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    const an = Number(av), bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return (an - bn) * multiplier;
    const text = String(av ?? a.symbol ?? a.stock_symbol ?? "").localeCompare(String(bv ?? b.symbol ?? b.stock_symbol ?? ""));
    return text ? text * multiplier : String(a.symbol || a.stock_symbol || "").localeCompare(String(b.symbol || b.stock_symbol || ""));
  });
}

function parseScreenerFilters(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    const filters = Array.isArray(parsed) ? parsed : [parsed];
    return filters.filter((item) => item && item.key);
  } catch { return []; }
}

function passesColumnFilter(row, filter) {
  const key = String(filter.key || "");
  const mode = String(filter.mode || "contains");
  const raw = filter.value;
  const value = row[key];
  if (raw == null || raw === "") return true;
  if (mode === "score_grade") {
    return scoreGradeForFilter(key, value) === String(raw || "").toLowerCase();
  }
  if (["contains", "equals_text", "starts", "ends"].includes(mode)) {
    const left = String(value ?? "").toLowerCase();
    const right = String(raw ?? "").toLowerCase();
    if (mode === "equals_text") return left === right;
    if (mode === "starts") return left.startsWith(right);
    if (mode === "ends") return left.endsWith(right);
    return left.includes(right);
  }
  const left = Number(value), right = Number(raw);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (mode === "lt") return left < right;
  if (mode === "lte") return left <= right;
  if (mode === "gt") return left > right;
  if (mode === "gte") return left >= right;
  if (mode === "neq") return left !== right;
  return left === right;
}

function scoreGradeForFilter(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "none";
  if (key === "es_score") {
    if (number <= 35) return "green";
    if (number <= 60) return "amber";
    return "red";
  }
  if (["tqs_score", "brs_score", "bbs_score", "cs_score"].includes(key)) {
    if (number >= 70) return "green";
    if (number >= 45) return "amber";
    return "red";
  }
  return "none";
}
function passesNumericMin(row, key, value) {
  if (value == null || value === "") return true;
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) return true;
  const actual = Number(row[key]);
  return Number.isFinite(actual) && actual >= threshold;
}

async function screenerCacheQuery(options = {}) {
  const cache = await dailyRsCache({ noBuild: true, reason: "screener_query" });
  const minRs = options.minRs == null || options.minRs === "" ? null : Number(options.minRs);
  const minPrice = options.minPrice == null || options.minPrice === "" ? null : Number(options.minPrice);
  const minVolume = options.minVolume == null || options.minVolume === "" ? null : Number(options.minVolume);
  const rs250 = String(options.rs250 ?? "false") === "true" || String(options.rs250 ?? "") === "1";
  const limit = clamp(Number(options.limit || 1000), 1, 15000);
  const offset = clamp(Number(options.offset || 0), 0, 1000000);
  const columnFilters = parseScreenerFilters(options.filters);
  const sector = String(options.sector || "").trim().toLowerCase();
  const industry = String(options.industry || "").trim().toLowerCase();
  const symbolText = String(options.symbols || "").trim();
  const symbols = symbolText ? new Set(symbolText.split(/[,\s]+/).map((item) => item.trim().toUpperCase().replace(".US", "")).filter(Boolean)) : null;
  let rows = latestRowsFromDailyRsCache(cache);
  const rankSource = [...rows].sort((a, b) => Number(b.rs_score ?? b.rs_val_3m ?? b.rs_val ?? -Infinity) - Number(a.rs_score ?? a.rs_val_3m ?? a.rs_val ?? -Infinity));
  rankSource.forEach((row, index) => { row.rs_rank = index + 1; });
  rows = rows.filter((row) => {
    if (symbols && !symbols.has(String(row.stock_symbol || row.symbol || "").toUpperCase())) return false;
    if (rs250 && Number(row.rs_rank || 999999) > 250) return false;
    if (minRs != null && Number(row.rs_val || row.rs_score || 0) < minRs) return false;
    if (minPrice != null && Number(row.close || 0) < minPrice) return false;
    if (minVolume != null && Number(row.volume || 0) < minVolume) return false;
    if (columnFilters.some((filter) => !passesColumnFilter(row, filter))) return false;
    if (sector && String(row.sector || "").toLowerCase() !== sector) return false;
    if (industry && String(row.industry || "").toLowerCase() !== industry) return false;
    if (!passesNumericMin(row, "ti65_mom", options.ti65Min)) return false;
    if (!passesNumericMin(row, "mdt_mom", options.mdtMin)) return false;
    if (!passesNumericMin(row, "dt_mom", options.dtMin)) return false;
    if (!passesNumericMin(row, "m21_mom", options.m21Min)) return false;
    if (!passesNumericMin(row, "m10_mom", options.m10Min)) return false;
    if (!passesNumericMin(row, "m5_mom", options.m5Min)) return false;
    return true;
  });
  const total = rows.length;
  rows = sortScreenerRows(rows, options.sort, options.sortDir).slice(offset, offset + limit);
  return {
    source: "mtm.daily_rs_cache.screener",
    cache: { latestDate: cache.latestDate, startDate: cache.startDate, days: cache.requestedDays, builtAt: cache.builtAt, store: dailyRsCacheMeta.store, displayDate: cache.latestDate, calculationWindow: `${cache.startDate || ""} to ${cache.latestDate || ""}` },
    columns: [...(cache.columns || []), ...screenerDerivedColumns().map((column) => column.key)],
    derivedColumns: screenerDerivedColumns(),
    filters: { minRs, minPrice, minVolume, rs250, columnFilters, sector, industry, limit, offset, latestOnly: true },
    count: rows.length,
    total,
    offset,
    limit,
    hasMore: offset + rows.length < total,
    rows
  };
}

function cleanScreenerSymbols(symbols) {
  const raw = Array.isArray(symbols) ? symbols : String(symbols || "").split(/[,\s]+/);
  return [...new Set(raw.map((item) => String(item || "").trim().toUpperCase().replace(/\.US$/, "")).filter((item) => /^[A-Z0-9.-]{1,12}$/.test(item)))];
}
function metricScore(decision, key) {
  return Number((decision.metrics || []).find((metric) => metric.key === key)?.score);
}
function outcomeFor(rows, index, horizon = 20) {
  const entry = Number(rows[index]?.close);
  const exit = Number(rows[index + horizon]?.close);
  const future = rows.slice(index + 1, index + horizon + 1);
  if (!entry || !exit || future.length < horizon) return null;
  const lows = future.map((row) => Number(row.low)).filter(Number.isFinite);
  const highs = future.map((row) => Number(row.high)).filter(Number.isFinite);
  return {
    r5: rows[index + 5]?.close ? 100 * (Number(rows[index + 5].close) / entry - 1) : null,
    r10: rows[index + 10]?.close ? 100 * (Number(rows[index + 10].close) / entry - 1) : null,
    r20: 100 * (exit / entry - 1),
    mae: lows.length ? 100 * (Math.min(...lows) / entry - 1) : null,
    mfe: highs.length ? 100 * (Math.max(...highs) / entry - 1) : null
  };
}
function summarizeBacktestTrades(trades = []) {
  const nums = (field) => trades.map((trade) => Number(trade[field])).filter(Number.isFinite);
  const avg = (field) => { const values = nums(field); return values.length ? round4(values.reduce((a, b) => a + b, 0) / values.length) : null; };
  const returns = nums("r20");
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const median = returns.length ? [...returns].sort((a, b) => a - b)[Math.floor(returns.length / 2)] : null;
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (returns.length - 1) : null;
  const downside = Math.abs(losses.reduce((a, b) => a + b, 0));
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const value of returns) { equity += value; peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, equity - peak); }
  return {
    count: trades.length,
    winRate: returns.length ? round4(100 * wins.length / returns.length) : null,
    avg5dReturn: avg("r5"),
    avg10dReturn: avg("r10"),
    avg20dReturn: avg("r20"),
    medianReturn: round4(median),
    sharpeRatio: variance && variance > 0 ? round4(mean / Math.sqrt(variance)) : null,
    profitFactor: downside ? round4(wins.reduce((a, b) => a + b, 0) / downside) : (wins.length ? null : 0),
    expectancy: round4(mean),
    maxDrawdown: round4(maxDrawdown),
    maxAdverseExcursion: avg("mae"),
    maxFavorableExcursion: avg("mfe")
  };
}
function extensionValidation(trades = []) {
  const extended = trades.filter((trade) => Number(trade.es) > 60 && Number.isFinite(Number(trade.r20)));
  const avoidedCorrectly = extended.filter((trade) => Number(trade.r20) <= 0);
  const avoidedIncorrectly = extended.filter((trade) => Number(trade.r20) > 0);
  const drawdownSaved = avoidedCorrectly.reduce((sum, trade) => sum + Math.abs(Math.min(0, Number(trade.r20))), 0);
  const missedWinners = avoidedIncorrectly.reduce((sum, trade) => sum + Math.max(0, Number(trade.r20)), 0);
  return { avoidedCorrectly: avoidedCorrectly.length, avoidedIncorrectly: avoidedIncorrectly.length, drawdownSaved: round4(drawdownSaved), missedWinners: round4(missedWinners), netBenefit: round4(drawdownSaved - missedWinners) };
}
function scoreBacktestForSymbol(symbol, rows = []) {
  const sorted = rows.map((row) => ({ ...row, stock_symbol: symbol })).filter((row) => row.sdate && row.close > 0).sort((a, b) => String(a.sdate).localeCompare(String(b.sdate)));
  const experiments = {
    baseline: [],
    tqs: [],
    tqs_brs: [],
    tqs_brs_es: [],
    tqs_brs_es_cs: []
  };
  const baselineTrades = [];
  for (let i = 90; i < sorted.length - 20; i += 5) {
    const sample = sorted.slice(0, i + 1);
    const decision = buildScreenerDecisionSupport(symbol, sample, sample.at(-1));
    const derived = deriveStockbeeColumns(sample);
    const close = Number(sample.at(-1)?.close);
    const sma50 = avgField(sample, "close", 50);
    const outcome = outcomeFor(sorted, i, 20);
    if (!outcome || !close || !sma50) continue;
    const tqs = metricScore(decision, "TQS"), es = metricScore(decision, "ES"), brs = metricScore(decision, "BRS"), cs = metricScore(decision, "CS");
    const baseline = close >= sma50 && Number(derived.c20 || 0) > 0 && Number(sample.at(-1)?.volume || 0) > 100000;
    if (!baseline) continue;
    const trade = { symbol, date: sample.at(-1).sdate, tqs, es, brs, cs, ...outcome };
    baselineTrades.push(trade);
    experiments.baseline.push(trade);
    if (tqs >= 70) experiments.tqs.push(trade);
    if (tqs >= 70 && brs >= 70) experiments.tqs_brs.push(trade);
    if (tqs >= 70 && brs >= 70 && es <= 60) experiments.tqs_brs_es.push(trade);
    if (tqs >= 70 && brs >= 70 && es <= 60 && cs >= 70) experiments.tqs_brs_es_cs.push(trade);
  }
  const summaries = Object.fromEntries(Object.entries(experiments).map(([key, trades]) => [key, summarizeBacktestTrades(trades)]));
  return { symbol, bars: sorted.length, startDate: sorted[0]?.sdate || null, endDate: sorted.at(-1)?.sdate || null, experiments: summaries, extensionValidation: extensionValidation(baselineTrades), trades: baselineTrades, sampleTrades: baselineTrades.slice(-8) };
}
async function eodhdScoreBacktest(symbolsInput = [], userId = adminUsername) {
  const symbols = cleanScreenerSymbols(symbolsInput);
  if (!symbols.length) throw new Error("Select one to ten symbols for score backtesting.");
  if (symbols.length > 10) throw new Error("Score backtest supports a maximum of 10 selected symbols.");
  const apiToken = await effectiveEodhdToken(userId);
  if (!apiToken) throw new Error("EODHD API token is required for direct score backtesting.");
  const end = await latestTradingDateForDownload();
  const start = addDays(end, -760);
  const results = [];
  const failures = [];
  for (const symbol of symbols) {
    try {
      const rows = await fetchEodhdEod(symbol, start, end, apiToken);
      if (rows.length < 120) throw new Error(`Only ${rows.length} EODHD daily bars returned.`);
      results.push(scoreBacktestForSymbol(symbol, rows));
    } catch (error) {
      failures.push({ symbol, error: error.message });
    }
  }
  const experimentKeys = ["baseline", "tqs", "tqs_brs", "tqs_brs_es", "tqs_brs_es_cs"];
  const aggregate = Object.fromEntries(experimentKeys.map((key) => [key, summarizeBacktestTrades(results.flatMap((item) => (item.trades || []).filter((trade) => {
    if (key === "baseline") return true;
    if (key === "tqs") return trade.tqs >= 70;
    if (key === "tqs_brs") return trade.tqs >= 70 && trade.brs >= 70;
    if (key === "tqs_brs_es") return trade.tqs >= 70 && trade.brs >= 70 && trade.es <= 60;
    return trade.tqs >= 70 && trade.brs >= 70 && trade.es <= 60 && trade.cs >= 70;
  })))]));
  return { source: "eodhd.direct.score_backtest", runAt: new Date().toISOString(), from: start, to: end, symbols, results, aggregate, failures, note: "Uses direct EODHD daily bars. The API token remains server-side and is not returned." };
}

const secFactTags = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  eps: ["EarningsPerShareDiluted"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"]
};

let secLeadershipResultCache = null;

async function ensureSecLeadershipTables() {
  await mysqlJson(`
    CREATE TABLE IF NOT EXISTS ${secCikTable} (
      symbol VARCHAR(16) NOT NULL PRIMARY KEY,
      cik VARCHAR(16) NOT NULL,
      company_name VARCHAR(255) NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'SEC',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await mysqlJson(`
    CREATE TABLE IF NOT EXISTS ${secJobsTable} (
      run_id VARCHAR(64) NOT NULL PRIMARY KEY,
      status VARCHAR(32) NOT NULL,
      total_symbols INT NOT NULL DEFAULT 0,
      processed_symbols INT NOT NULL DEFAULT 0,
      passed_symbols INT NOT NULL DEFAULT 0,
      failed_symbols INT NOT NULL DEFAULT 0,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      message TEXT NULL,
      payload_json MEDIUMTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await mysqlJson(`
    CREATE TABLE IF NOT EXISTS ${secResultsTable} (
      run_id VARCHAR(64) NOT NULL,
      symbol VARCHAR(16) NOT NULL,
      company_name VARCHAR(255) NULL,
      sector VARCHAR(128) NULL,
      industry VARCHAR(255) NULL,
      as_of_date DATE NULL,
      cik VARCHAR(16) NULL,
      classification VARCHAR(64) NOT NULL,
      minervini_score DOUBLE NULL,
      rs_rank INT NULL,
      rs_score DOUBLE NULL,
      trend_template_score DOUBLE NULL,
      trend_template_class VARCHAR(24) NULL,
      leadership_score DOUBLE NULL,
      code3_score INT NULL,
      code3_confidence VARCHAR(24) NULL,
      extension_score DOUBLE NULL,
      extension_status VARCHAR(32) NULL,
      turnaround_stage VARCHAR(8) NULL,
      sec_data_status VARCHAR(32) NOT NULL,
      latest_filing_date DATE NULL,
      data_recency_days INT NULL,
      latest_revenue DOUBLE NULL,
      latest_eps DOUBLE NULL,
      revenue_yoy_pct DOUBLE NULL,
      eps_yoy_pct DOUBLE NULL,
      gross_margin_pct DOUBLE NULL,
      operating_margin_pct DOUBLE NULL,
      reasons_json MEDIUMTEXT NULL,
      trend_json MEDIUMTEXT NULL,
      code3_json MEDIUMTEXT NULL,
      quarterly_json MEDIUMTEXT NULL,
      annual_json MEDIUMTEXT NULL,
      margins_json MEDIUMTEXT NULL,
      technical_json MEDIUMTEXT NULL,
      failure_reason TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id, symbol),
      INDEX idx_sec_results_symbol (symbol),
      INDEX idx_sec_results_classification (classification),
      INDEX idx_sec_results_score (minervini_score)
    )
  `);
}

async function secRs250Universe() {
  try {
    const cache = await dailyRsCache({ noBuild: true, reason: "sec_rs250_universe" });
    return secRankUniverseRows(Object.values(cache.groupedBySymbol || {}).map((item) => {
      const rows = item.rows || [];
      const latest = item.latest || rows.at(-1) || {};
      return latest.stock_symbol ? {
        ...latest,
        symbol: String(latest.stock_symbol || item.symbol || "").toUpperCase(),
        rows,
        rsScore: Number(latest.rs_val_3m ?? latest.rs_val ?? 0)
      } : null;
    }).filter(Boolean));
  } catch (error) {
    if (error.code !== "CACHE_WARMING") throw error;
    triggerDailyRsCacheWarm("sec_rs250_fallback", false);
    return secRs250UniverseFromDb();
  }
}

function secRankUniverseRows(rows) {
  const latestRows = rows
    .filter((row) => /^[A-Z]{1,5}$/.test(row.symbol) && Number(row.close || 0) > 5 && Number(row.volume || 0) > 100000)
    .sort((a, b) => Number(b.rsScore || 0) - Number(a.rsScore || 0))
    .slice(0, 250)
    .map((row, index) => ({ ...row, rsRank: index + 1 }));
  const industryCounts = new Map();
  const industryRanks = new Map();
  for (const row of latestRows) {
    const key = row.industry || "Unknown";
    const next = (industryCounts.get(key) || 0) + 1;
    industryCounts.set(key, next);
    industryRanks.set(row.symbol, next);
  }
  return latestRows.map((row) => ({ ...row, industryRank: industryRanks.get(row.symbol) || null }));
}

async function secRs250UniverseFromDb() {
  const latestDate = await latestRsDailyDate();
  if (!latestDate) throw new Error("rs_daily has no data for SEC leadership universe.");
  const dateRaw = await mysqlJson(`SELECT DISTINCT sdate FROM rs_daily WHERE sdate <= ${sqlString(latestDate)} ORDER BY sdate DESC LIMIT 260`);
  const dates = dateRaw.split("\n").filter(Boolean);
  const startDate = dates.at(-1) || latestDate;
  const topRaw = await mysqlJson(`
    SELECT r.sdate, r.stock_symbol, COALESCE(m.stock_name,''), r.open, r.high, r.low, r.close, r.volume, r.rs_val, r.rs_val_3m, r.mci, COALESCE(r.sector,''), COALESCE(r.industry,''), r.ma50, r.avg_volume_50
    FROM rs_daily r
    LEFT JOIN stock_sector_master m ON m.stock_symbol = r.stock_symbol
    WHERE r.sdate=${sqlString(latestDate)}
      AND r.stock_symbol REGEXP '^[A-Z]{1,5}$'
      AND r.close > 5
      AND r.volume > 100000
    ORDER BY COALESCE(r.rs_val_3m, r.rs_val, 0) DESC, COALESCE(r.rs_val, 0) DESC
    LIMIT 250
  `);
  const topRows = parseRows(topRaw, ["sdate", "stock_symbol", "stock_name", "open", "high", "low", "close", "volume", "rs_val", "rs_val_3m", "mci", "sector", "industry", "ma50", "avg_volume_50"]);
  const symbols = topRows.map((row) => row.stock_symbol).filter(Boolean);
  if (!symbols.length) return [];
  const historyRaw = await mysqlJson(`
    SELECT sdate, stock_symbol, open, high, low, close, volume, rs_val, rs_val_3m, mci, sector, industry, ma50, avg_volume_50
    FROM rs_daily
    WHERE sdate BETWEEN ${sqlString(startDate)} AND ${sqlString(latestDate)}
      AND stock_symbol IN (${symbols.map(sqlString).join(",")})
    ORDER BY stock_symbol ASC, sdate ASC
  `);
  const historyRows = parseRows(historyRaw, ["sdate", "stock_symbol", "open", "high", "low", "close", "volume", "rs_val", "rs_val_3m", "mci", "sector", "industry", "ma50", "avg_volume_50"]);
  const grouped = new Map();
  for (const row of historyRows) {
    const symbol = row.stock_symbol;
    const list = grouped.get(symbol) || [];
    list.push({
      ...row,
      open: Number(row.open || 0),
      high: Number(row.high || 0),
      low: Number(row.low || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0),
      rs_val: pct(row.rs_val, null),
      rs_val_3m: pct(row.rs_val_3m, null),
      ma50: pct(row.ma50, null),
      avg_volume_50: Number(row.avg_volume_50 || 0)
    });
    grouped.set(symbol, list);
  }
  return secRankUniverseRows(topRows.map((row) => ({
    ...row,
    symbol: row.stock_symbol,
    open: Number(row.open || 0),
    high: Number(row.high || 0),
    low: Number(row.low || 0),
    close: Number(row.close || 0),
    volume: Number(row.volume || 0),
    ma50: pct(row.ma50, null),
    avg_volume_50: Number(row.avg_volume_50 || 0),
    rsScore: Number(row.rs_val_3m || row.rs_val || 0),
    rows: grouped.get(row.stock_symbol) || []
  })));
}

async function secFetchJson(url, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { headers: { "user-agent": secUserAgent, accept: "application/json" }, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep([2000, 5000, 10000][attempt] || 10000);
    }
  }
  throw lastError || new Error("SEC request failed");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshSecCikMap() {
  await ensureSecLeadershipTables();
  const payload = await secFetchJson("https://www.sec.gov/files/company_tickers.json");
  const rows = Object.values(payload || {}).map((item) => ({
    symbol: String(item.ticker || "").toUpperCase(),
    cik: String(item.cik_str || "").padStart(10, "0"),
    company: item.title || ""
  })).filter((item) => item.symbol && item.cik);
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const values = chunk.map((item) => `(${sqlString(item.symbol)}, ${sqlString(item.cik)}, ${sqlString(item.company)}, 'SEC')`).join(",");
    if (values) await mysqlJson(`INSERT INTO ${secCikTable} (symbol, cik, company_name, source) VALUES ${values} ON DUPLICATE KEY UPDATE cik=VALUES(cik), company_name=VALUES(company_name), updated_at=CURRENT_TIMESTAMP`);
  }
  return rows.length;
}

async function secCikMapFor(symbols) {
  await ensureSecLeadershipTables();
  const unique = [...new Set(symbols.map((symbol) => String(symbol || "").toUpperCase()).filter(Boolean))];
  const readMap = async () => {
    if (!unique.length) return new Map();
    const raw = await optionalMysqlJson(`SELECT symbol, cik, company_name FROM ${secCikTable} WHERE symbol IN (${unique.map(sqlString).join(",")})`);
    return new Map(parseRows(raw, ["symbol", "cik", "companyName"]).map((row) => [row.symbol, row]));
  };
  let map = await readMap();
  if (map.size < Math.max(10, Math.floor(unique.length * 0.60))) {
    await refreshSecCikMap();
    map = await readMap();
  }
  return map;
}

function secQuarterlyFacts(data, tags, unit) {
  const facts = data?.facts?.["us-gaap"] || {};
  for (const tag of tags) {
    const values = facts[tag]?.units?.[unit] || [];
    const byPeriod = new Map();
    for (const item of values) {
      if (!["10-Q", "10-K"].includes(item.form) || !["Q1", "Q2", "Q3", "Q4", "FY"].includes(item.fp) || item.val == null || !item.end) continue;
      const fp = item.fp === "FY" ? "Q4" : item.fp;
      const key = `${item.fy || ""}:${fp}`;
      const row = { tag, fy: item.fy || null, fp, end: item.end, filed: item.filed || null, form: item.form, value: Number(item.val) };
      const prior = byPeriod.get(key);
      if (!prior || String(row.filed || row.end).localeCompare(String(prior.filed || prior.end)) > 0) byPeriod.set(key, row);
    }
    const rows = [...byPeriod.values()].filter((row) => Number.isFinite(row.value)).sort((a, b) => String(b.end).localeCompare(String(a.end))).slice(0, 10);
    if (rows.length) return rows;
  }
  return [];
}

function secAnnualFacts(data, tags, unit) {
  const facts = data?.facts?.["us-gaap"] || {};
  for (const tag of tags) {
    const values = facts[tag]?.units?.[unit] || [];
    const byYear = new Map();
    for (const item of values) {
      if (item.form !== "10-K" || item.val == null || !item.fy) continue;
      const row = { tag, year: Number(item.fy), end: item.end || null, filed: item.filed || null, value: Number(item.val) };
      const prior = byYear.get(row.year);
      if (!prior || String(row.filed || row.end).localeCompare(String(prior.filed || prior.end)) > 0) byYear.set(row.year, row);
    }
    const rows = [...byYear.values()].filter((row) => Number.isFinite(row.value)).sort((a, b) => b.year - a.year).slice(0, 5);
    if (rows.length) return rows;
  }
  return [];
}

function yoyPct(rows, index = 0) {
  const current = rows[index]?.value;
  const prior = rows[index + 4]?.value;
  return Number.isFinite(current) && Number.isFinite(prior) && prior ? pct((current - prior) / Math.abs(prior) * 100, null) : null;
}

function acceleration(rows, index = 0) {
  const now = yoyPct(rows, index);
  const prior = yoyPct(rows, index + 1);
  return Number.isFinite(now) && Number.isFinite(prior) ? pct(now - prior, null) : null;
}

function marginRows(revenueRows, profitRows) {
  const byEnd = new Map(profitRows.map((row) => [row.end, row]));
  return revenueRows.map((row) => {
    const profit = byEnd.get(row.end);
    const margin = Number(row.value) && profit ? pct(Number(profit.value) / Number(row.value) * 100, null) : null;
    return { fy: row.fy, fp: row.fp, end: row.end, margin };
  }).filter((row) => row.margin != null);
}

function buildSecFundamentals(companyFacts) {
  const revenue = secQuarterlyFacts(companyFacts, secFactTags.revenue, "USD");
  const eps = secQuarterlyFacts(companyFacts, secFactTags.eps, "USD/shares");
  const grossProfit = secQuarterlyFacts(companyFacts, secFactTags.grossProfit, "USD");
  const operatingIncome = secQuarterlyFacts(companyFacts, secFactTags.operatingIncome, "USD");
  const netIncome = secQuarterlyFacts(companyFacts, secFactTags.netIncome, "USD");
  const annualEps = secAnnualFacts(companyFacts, secFactTags.eps, "USD/shares");
  const annualRevenue = secAnnualFacts(companyFacts, secFactTags.revenue, "USD");
  const grossMargins = marginRows(revenue, grossProfit);
  const operatingMargins = marginRows(revenue, operatingIncome);
  const latestFiled = [revenue[0]?.filed, eps[0]?.filed, grossProfit[0]?.filed, operatingIncome[0]?.filed].filter(Boolean).sort().at(-1) || null;
  const missing = [];
  if (!revenue.length) missing.push("No Revenue");
  if (!eps.length) missing.push("No EPS");
  if (revenue.length < 5 || eps.length < 5) missing.push("Insufficient Quarters");
  const partial = [];
  if (!grossProfit.length) partial.push("Gross Profit Missing");
  if (!operatingIncome.length) partial.push("Operating Income Missing");
  const grossMargin = grossMargins[0]?.margin ?? null;
  const operatingMargin = operatingMargins[0]?.margin ?? null;
  const revenueYoy = yoyPct(revenue);
  const epsYoy = yoyPct(eps);
  const revenueAccel = acceleration(revenue);
  const epsAccel = acceleration(eps);
  const marginExpansion = grossMargins.length > 1 && grossMargins[0].margin != null && grossMargins[1].margin != null ? pct(grossMargins[0].margin - grossMargins[1].margin, null) : null;
  return {
    status: missing.length ? "FAIL" : partial.length ? "PARTIAL_FIELD_MISSING" : "PASS",
    missing,
    partial,
    latestRevenue: revenue[0]?.value ?? null,
    latestEps: eps[0]?.value ?? null,
    revenueYoy,
    epsYoy,
    revenueAccel,
    epsAccel,
    grossMargin,
    operatingMargin,
    marginExpansion,
    latestFiled,
    dataRecencyDays: latestFiled ? Math.max(0, Math.round((Date.now() - new Date(latestFiled).getTime()) / 86400000)) : null,
    quarterly: revenue.slice(0, 6).map((row, index) => ({ quarter: `${row.fy || ""} ${row.fp || ""}`.trim(), periodEnd: row.end, filed: row.filed, revenue: row.value, revenueYoyPct: yoyPct(revenue, index), eps: eps.find((item) => item.end === row.end)?.value ?? eps[index]?.value ?? null, epsYoyPct: yoyPct(eps, index) })),
    annual: annualEps.map((row, index) => ({ year: row.year, eps: row.value, epsGrowthPct: index + 1 < annualEps.length && annualEps[index + 1].value ? pct((row.value - annualEps[index + 1].value) / Math.abs(annualEps[index + 1].value) * 100, null) : null, revenue: annualRevenue.find((item) => item.year === row.year)?.value ?? null })),
    margins: { gross: grossMargins.slice(0, 6), operating: operatingMargins.slice(0, 6), netIncome: netIncome.slice(0, 6) }
  };
}

function averageTrueRange(rows, days = 14) {
  const slice = rows.slice(-days - 1);
  const ranges = [];
  for (let i = 1; i < slice.length; i += 1) {
    const high = Number(slice[i].high || 0), low = Number(slice[i].low || 0), prevClose = Number(slice[i - 1].close || 0);
    if (high > 0 && low > 0) ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return mean(ranges);
}

function trendTemplateFor(row) {
  const rows = row.rows || [];
  const close = Number(row.close || 0);
  const ma50 = Number(row.ma50 || movingAverage(rows, rows.length - 1, 50) || 0);
  const ma150 = Number(movingAverage(rows, rows.length - 1, 150) || 0);
  const ma200 = Number(movingAverage(rows, rows.length - 1, 200) || 0);
  const ma200MonthAgo = Number(movingAverage(rows, Math.max(0, rows.length - 22), 200) || 0);
  const highs = rows.slice(-252).map((item) => Number(item.high || item.close || 0)).filter((value) => value > 0);
  const lows = rows.slice(-252).map((item) => Number(item.low || item.close || 0)).filter((value) => value > 0);
  const high52 = highs.length ? Math.max(...highs) : close;
  const low52 = lows.length ? Math.min(...lows) : close;
  const checks = [
    ["price_above_150dma", "Price > 150 DMA", close > ma150, 10],
    ["price_above_200dma", "Price > 200 DMA", close > ma200, 10],
    ["ma150_above_200", "150 DMA > 200 DMA", ma150 > ma200, 15],
    ["ma200_rising", "200 DMA rising 1 month", ma200 > ma200MonthAgo, 15],
    ["ma50_above_150", "50 DMA > 150 DMA", ma50 > ma150, 10],
    ["ma50_above_200", "50 DMA > 200 DMA", ma50 > ma200, 10],
    ["price_above_50dma", "Price > 50 DMA", close > ma50, 10],
    ["above_52w_low", "25% above 52W low", low52 > 0 && close >= low52 * 1.25, 5],
    ["near_52w_high", "Within 25% of 52W high", high52 > 0 && close >= high52 * 0.75, 5],
    ["rs_rank_70", "RS rank >= 70", Number(row.rsRank || 999) <= 75 || Number(row.rsScore || 0) >= 70, 10]
  ];
  const score = checks.reduce((sum, item) => sum + (item[2] ? item[3] : 0), 0);
  const trendClass = score >= 90 ? "Gold" : score >= 80 ? "Silver" : score >= 70 ? "Bronze" : "Fail";
  const atr = averageTrueRange(rows, 14);
  return {
    score,
    class: trendClass,
    checks: checks.map(([key, label, pass, points]) => ({ key, label, pass: Boolean(pass), points })),
    close,
    ma50: pct(ma50, null),
    ma150: pct(ma150, null),
    ma200: pct(ma200, null),
    high52: pct(high52, null),
    low52: pct(low52, null),
    atr: pct(atr, null),
    avgVolume50: mean(rows.slice(-50).map((item) => Number(item.volume || 0))) || Number(row.avg_volume_50 || 0),
    distanceFromHighPct: high52 ? pct((close - high52) / high52 * 100, null) : null
  };
}

function code3For(fundamentals) {
  const rows = [
    { metric: "EPS", q1ToQ2: Number(fundamentals.epsAccel || 0) > 0, q2ToQ3: Number(fundamentals.epsYoy || 0) > 20, trend: Number(fundamentals.epsAccel || 0) > 0 && Number(fundamentals.epsYoy || 0) > 20 },
    { metric: "Revenue", q1ToQ2: Number(fundamentals.revenueAccel || 0) > 0, q2ToQ3: Number(fundamentals.revenueYoy || 0) > 15, trend: Number(fundamentals.revenueAccel || 0) > 0 && Number(fundamentals.revenueYoy || 0) > 15 },
    { metric: "Margins", q1ToQ2: Number(fundamentals.marginExpansion || 0) > 0, q2ToQ3: Number(fundamentals.grossMargin || 0) > 25 || Number(fundamentals.operatingMargin || 0) > 10, trend: Number(fundamentals.marginExpansion || 0) > 0 }
  ];
  const score = rows.reduce((sum, row) => sum + (row.q1ToQ2 ? 1 : 0) + (row.q2ToQ3 ? 1 : 0) + (row.trend ? 1 : 0), 0);
  const confidence = score >= 8 ? "Very High" : score >= 6 ? "High" : score >= 4 ? "Medium" : "Low";
  return { score, confidence, rows };
}

function extensionFor(row, trend) {
  const close = Number(row.close || 0);
  const ma50 = Number(trend.ma50 || 0);
  const atr = Number(trend.atr || 0);
  const dist50 = ma50 ? (close - ma50) / ma50 * 100 : 0;
  const atrExt = atr ? (close - ma50) / atr : 0;
  const score = pct(Math.min(100, Math.max(0, dist50 * 2 + atrExt * 7)), 0);
  const status = score >= 70 ? "Extended" : score >= 45 ? "Warm" : "Actionable";
  return { score, status, distanceAbove50Pct: pct(dist50, null), atrExtension: pct(atrExt, null) };
}

function turnaroundStageFor(row, fundamentals, leadershipScore, code3) {
  const rs = Number(row.rsScore || 0);
  const eps = Number(fundamentals.epsYoy || 0);
  const rev = Number(fundamentals.revenueYoy || 0);
  const margin = Number(fundamentals.marginExpansion || 0);
  if (leadershipScore > 90 && code3.score >= 8 && rs > 90) return "T4";
  if (code3.score >= 7 && margin > 0 && rs > 85) return "T3";
  if (code3.score >= 5 && rev > 0 && rs > 75) return "T2";
  if (eps > 0 && rs >= 50) return "T1";
  return "T0";
}

function classifySecLeader(row, fundamentals, trend, code3, extension) {
  const rsScore = Number(row.rsScore || 0);
  const nearHigh = Number(trend.distanceFromHighPct || 0) >= -15;
  const leadershipScore = pct(Math.min(100, Math.max(0, (100 - Number(row.rsRank || 250) / 2.5) * 0.35 + Number(row.rsScore || 0) * 0.25 + trend.score * 0.25 + (nearHigh ? 15 : 0))), 0);
  const turnaroundStage = turnaroundStageFor(row, fundamentals, leadershipScore, code3);
  let classification = "Watch Candidate";
  if (rsScore >= 90 && Number(row.industryRank || 99) === 1 && nearHigh && code3.score >= 6 && trend.score >= 90 && leadershipScore >= 85) classification = "Market Leader";
  else if (rsScore >= 85 && [2, 3].includes(Number(row.industryRank || 99)) && code3.score >= 5 && trend.score >= 80) classification = "Top Competitor";
  else if (rsScore >= 80 && Number(fundamentals.operatingMargin || 0) >= 15 && Number(row.close || 0) * Number(row.volume || 0) >= 50000000 && trend.score >= 75) classification = "Institutional Favorite";
  else if (["T2", "T3", "T4"].includes(turnaroundStage)) classification = "Turnaround Situation";
  const classBoost = classification === "Market Leader" ? 8 : classification === "Top Competitor" ? 5 : classification === "Institutional Favorite" ? 3 : classification === "Turnaround Situation" ? 4 : 0;
  const minerviniScore = pct(Math.min(100, Math.max(0, trend.score * 0.28 + leadershipScore * 0.22 + code3.score / 9 * 22 + Math.min(100, rsScore) * 0.18 + (100 - extension.score) * 0.06 + classBoost)), 0);
  const reasons = [
    trend.score >= 70 ? `Trend Template ${trend.class}` : "Trend Template below Minervini threshold",
    `RS rank ${row.rsRank}`,
    row.industryRank ? `Industry rank #${row.industryRank}` : "Industry rank unavailable",
    fundamentals.epsYoy != null ? `EPS YoY ${fundamentals.epsYoy}%` : "EPS YoY unavailable",
    fundamentals.revenueYoy != null ? `Revenue YoY ${fundamentals.revenueYoy}%` : "Revenue YoY unavailable",
    fundamentals.marginExpansion != null ? `Margin expansion ${fundamentals.marginExpansion} pts` : "Margin expansion unavailable",
    nearHigh ? "Near 52-week high" : "Not near 52-week high"
  ];
  return { classification, leadershipScore, minerviniScore, turnaroundStage, reasons };
}

async function saveSecLeadershipResult(item) {
  const f = item.fundamentals || {};
  const technical = { close: item.trend?.close, ma50: item.trend?.ma50, ma150: item.trend?.ma150, ma200: item.trend?.ma200, high52: item.trend?.high52, low52: item.trend?.low52, atr: item.trend?.atr, avgVolume50: item.trend?.avgVolume50 };
  const values = [
    sqlString(item.runId), sqlString(item.symbol), sqlString(item.companyName || ""), sqlString(item.sector || ""), sqlString(item.industry || ""), item.asOfDate ? sqlString(item.asOfDate) : "NULL",
    sqlString(item.cik || ""), sqlString(item.classification || "Watch Candidate"), sqlNumber(item.minerviniScore), sqlNumber(item.rsRank), sqlNumber(item.rsScore),
    sqlNumber(item.trend?.score), sqlString(item.trend?.class || ""), sqlNumber(item.leadershipScore), sqlNumber(item.code3?.score), sqlString(item.code3?.confidence || ""),
    sqlNumber(item.extension?.score), sqlString(item.extension?.status || ""), sqlString(item.turnaroundStage || ""), sqlString(f.status || "UNKNOWN"), f.latestFiled ? sqlString(f.latestFiled) : "NULL",
    sqlNumber(f.dataRecencyDays), sqlNumber(f.latestRevenue), sqlNumber(f.latestEps), sqlNumber(f.revenueYoy), sqlNumber(f.epsYoy), sqlNumber(f.grossMargin), sqlNumber(f.operatingMargin),
    sqlString(JSON.stringify(item.reasons || [])), sqlString(JSON.stringify(item.trend || {})), sqlString(JSON.stringify(item.code3 || {})), sqlString(JSON.stringify(f.quarterly || [])),
    sqlString(JSON.stringify(f.annual || [])), sqlString(JSON.stringify(f.margins || {})), sqlString(JSON.stringify(technical)), "NULL"
  ].join(",");
  await mysqlJson(`INSERT INTO ${secResultsTable} (
    run_id, symbol, company_name, sector, industry, as_of_date, cik, classification, minervini_score, rs_rank, rs_score,
    trend_template_score, trend_template_class, leadership_score, code3_score, code3_confidence, extension_score, extension_status,
    turnaround_stage, sec_data_status, latest_filing_date, data_recency_days, latest_revenue, latest_eps, revenue_yoy_pct, eps_yoy_pct,
    gross_margin_pct, operating_margin_pct, reasons_json, trend_json, code3_json, quarterly_json, annual_json, margins_json, technical_json, failure_reason
  ) VALUES (${values}) ON DUPLICATE KEY UPDATE
    classification=VALUES(classification), minervini_score=VALUES(minervini_score), sec_data_status=VALUES(sec_data_status),
    reasons_json=VALUES(reasons_json), trend_json=VALUES(trend_json), code3_json=VALUES(code3_json), quarterly_json=VALUES(quarterly_json),
    annual_json=VALUES(annual_json), margins_json=VALUES(margins_json), technical_json=VALUES(technical_json), failure_reason=VALUES(failure_reason)
  `);
}

async function saveSecLeadershipFailure(runId, row, cikRow, error) {
  await mysqlJson(`INSERT INTO ${secResultsTable} (
    run_id, symbol, company_name, sector, industry, as_of_date, cik, classification, sec_data_status, rs_rank, rs_score, failure_reason
  ) VALUES (
    ${sqlString(runId)}, ${sqlString(row.symbol)}, ${sqlString(cikRow?.companyName || row.stock_name || "")}, ${sqlString(row.sector || "")}, ${sqlString(row.industry || "")}, ${row.sdate ? sqlString(row.sdate) : "NULL"}, ${sqlString(cikRow?.cik || "")}, 'Data Failure', 'FAIL', ${sqlNumber(row.rsRank)}, ${sqlNumber(row.rsScore)}, ${sqlString(error.message || String(error))}
  ) ON DUPLICATE KEY UPDATE sec_data_status='FAIL', failure_reason=VALUES(failure_reason)`);
}

async function scoreSecLeadershipSymbol(row, cikRow, runId) {
  if (!cikRow?.cik) throw new Error("Missing CIK");
  const companyFacts = await secFetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikRow.cik}.json`);
  const fundamentals = buildSecFundamentals(companyFacts);
  if (fundamentals.status === "FAIL") throw new Error(fundamentals.missing.join(", "));
  const trend = trendTemplateFor(row);
  const code3 = code3For(fundamentals);
  const extension = extensionFor(row, trend);
  const classification = classifySecLeader(row, fundamentals, trend, code3, extension);
  const payload = {
    runId,
    symbol: row.symbol,
    companyName: cikRow.companyName || row.stock_name || "",
    sector: row.sector || "",
    industry: row.industry || "",
    asOfDate: row.sdate || null,
    cik: cikRow.cik,
    ...classification,
    rsRank: row.rsRank,
    rsScore: pct(row.rsScore, null),
    trend,
    code3,
    extension,
    fundamentals
  };
  await saveSecLeadershipResult(payload);
  return payload;
}

async function updateSecLeadershipJob(job) {
  await ensureSecLeadershipTables();
  await mysqlJson(`INSERT INTO ${secJobsTable} (
    run_id, status, total_symbols, processed_symbols, passed_symbols, failed_symbols, started_at, finished_at, message, payload_json
  ) VALUES (
    ${sqlString(job.id)}, ${sqlString(job.status)}, ${sqlNumber(job.total)}, ${sqlNumber(job.processed)}, ${sqlNumber(job.passed)}, ${sqlNumber(job.failed)}, ${sqlDateTime(job.startedAt)}, ${sqlDateTime(job.finishedAt)}, ${sqlString(job.message || "")}, ${sqlString(JSON.stringify(job))}
  ) ON DUPLICATE KEY UPDATE
    status=VALUES(status), total_symbols=VALUES(total_symbols), processed_symbols=VALUES(processed_symbols), passed_symbols=VALUES(passed_symbols),
    failed_symbols=VALUES(failed_symbols), finished_at=VALUES(finished_at), message=VALUES(message), payload_json=VALUES(payload_json), updated_at=CURRENT_TIMESTAMP`);
}

async function startSecLeadershipRefresh(options = {}) {
  await ensureSecLeadershipTables();
  if (secLeadershipAgent.running) return { ...(secLeadershipAgent.job || {}), alreadyRunning: true, message: "SEC leadership refresh is already running." };
  const universe = await secRs250Universe();
  const limit = clamp(Number(options.limit || secRefreshLimit), 5, 250);
  const selected = universe.slice(0, limit);
  const cikMap = await secCikMapFor(selected.map((row) => row.symbol));
  const job = { id: `sec-${Date.now()}`, type: "sec_leadership_score_refresh", status: "RUNNING", total: selected.length, processed: 0, passed: 0, failed: 0, currentSymbol: "", startedAt: new Date().toISOString(), finishedAt: null, message: "SEC refresh running in background. Showing latest completed results.", events: [], failures: [] };
  secLeadershipAgent.running = true;
  secLeadershipAgent.job = job;
  await updateSecLeadershipJob(job);
  runSecLeadershipJob(job, selected, cikMap).finally(() => { secLeadershipAgent.running = false; });
  return job;
}

async function runSecLeadershipJob(job, universe, cikMap) {
  for (const row of universe) {
    job.currentSymbol = row.symbol;
    try {
      const cikRow = cikMap.get(row.symbol);
      const scored = await scoreSecLeadershipSymbol(row, cikRow, job.id);
      job.passed += 1;
      job.events.unshift({ at: new Date().toISOString(), level: "info", text: `${row.symbol} scored ${scored.minerviniScore} ${scored.classification}` });
    } catch (error) {
      job.failed += 1;
      job.failures.unshift({ symbol: row.symbol, error: error.message });
      job.events.unshift({ at: new Date().toISOString(), level: "warn", text: `${row.symbol} failed: ${error.message}` });
      await saveSecLeadershipFailure(job.id, row, cikMap.get(row.symbol), error);
    }
    job.processed += 1;
    job.events = job.events.slice(0, 80);
    job.failures = job.failures.slice(0, 80);
    await updateSecLeadershipJob(job);
    await sleep(secRequestDelayMs);
  }
  job.status = job.failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  job.currentSymbol = "";
  job.finishedAt = new Date().toISOString();
  job.message = `SEC refresh completed: ${job.passed} passed, ${job.failed} failed.`;
  await updateSecLeadershipJob(job);
  secLeadershipResultCache = null;
}

async function secLeadershipLatestRunId() {
  await ensureSecLeadershipTables();
  const raw = await optionalMysqlJson(`SELECT run_id FROM ${secJobsTable} WHERE status IN ('COMPLETED','COMPLETED_WITH_ERRORS') ORDER BY finished_at DESC, started_at DESC LIMIT 1`);
  return raw || null;
}

async function secLeadershipStatus() {
  await ensureSecLeadershipTables();
  const latestRunId = await secLeadershipLatestRunId();
  const raw = await optionalMysqlJson(`SELECT run_id, status, total_symbols, processed_symbols, passed_symbols, failed_symbols, started_at, finished_at, message FROM ${secJobsTable} ORDER BY started_at DESC LIMIT 1`);
  const [runId, status, total, processed, passed, failed, startedAt, finishedAt, message] = raw ? raw.split("\t") : [];
  return {
    source: "mtm.sec_leadership.status",
    running: secLeadershipAgent.running,
    currentJob: secLeadershipAgent.job,
    latestCompletedRunId: latestRunId,
    latestJob: raw ? { runId, status, total: Number(total || 0), processed: Number(processed || 0), passed: Number(passed || 0), failed: Number(failed || 0), startedAt, finishedAt, message } : null,
    config: { secUserAgentConfigured: Boolean(secUserAgent), refreshLimit: secRefreshLimit, requestDelayMs: secRequestDelayMs, tables: { results: secResultsTable, jobs: secJobsTable, cik: secCikTable } }
  };
}

async function secLeadershipResults(options = {}) {
  await ensureSecLeadershipTables();
  const runId = options.runId || await secLeadershipLatestRunId();
  const limit = clamp(Number(options.limit || 250), 1, 500);
  if (!runId) return { source: "mtm.sec_leadership.results", runId: null, status: await secLeadershipStatus(), rows: [], kpis: {}, filters: {}, message: "No completed SEC leadership refresh yet." };
  const cacheKey = `${runId}:${limit}`;
  if (secLeadershipResultCache?.key === cacheKey && Date.now() - secLeadershipResultCache.createdAt < 60000) return secLeadershipResultCache.payload;
  const raw = await mysqlJson(`
    SELECT symbol, company_name, sector, industry, classification, minervini_score, rs_rank, rs_score, trend_template_class, trend_template_score,
      code3_confidence, code3_score, extension_status, extension_score, turnaround_stage, sec_data_status, latest_filing_date, data_recency_days,
      revenue_yoy_pct, eps_yoy_pct, gross_margin_pct, operating_margin_pct, failure_reason
    FROM ${secResultsTable}
    WHERE run_id=${sqlString(runId)}
    ORDER BY FIELD(classification, 'Market Leader', 'Top Competitor', 'Institutional Favorite', 'Turnaround Situation', 'Watch Candidate', 'Data Failure'),
      minervini_score DESC, rs_rank ASC
    LIMIT ${limit}
  `);
  const rows = parseRows(raw, ["symbol", "companyName", "sector", "industry", "classification", "minerviniScore", "rsRank", "rsScore", "trendTemplateClass", "trendTemplateScore", "code3Confidence", "code3Score", "extensionStatus", "extensionScore", "turnaroundStage", "secDataStatus", "latestFilingDate", "dataRecencyDays", "revenueYoyPct", "epsYoyPct", "grossMarginPct", "operatingMarginPct", "failureReason"]).map((row) => ({
    ...row,
    minerviniScore: pct(row.minerviniScore, null),
    rsRank: Number(row.rsRank || 0),
    rsScore: pct(row.rsScore, null),
    trendTemplateScore: pct(row.trendTemplateScore, null),
    code3Score: Number(row.code3Score || 0),
    extensionScore: pct(row.extensionScore, null),
    dataRecencyDays: row.dataRecencyDays === "" ? null : Number(row.dataRecencyDays || 0),
    revenueYoyPct: pct(row.revenueYoyPct, null),
    epsYoyPct: pct(row.epsYoyPct, null),
    grossMarginPct: pct(row.grossMarginPct, null),
    operatingMarginPct: pct(row.operatingMarginPct, null)
  }));
  const avg = mean(rows.map((row) => Number(row.minerviniScore)).filter(Number.isFinite));
  const kpis = {
    totalRs250: rows.length,
    marketLeaders: rows.filter((row) => row.classification === "Market Leader").length,
    topCompetitors: rows.filter((row) => row.classification === "Top Competitor").length,
    institutionalFavorites: rows.filter((row) => row.classification === "Institutional Favorite").length,
    turnarounds: rows.filter((row) => row.classification === "Turnaround Situation").length,
    failedSymbols: rows.filter((row) => row.secDataStatus === "FAIL").length,
    averageMinerviniScore: pct(avg, 0)
  };
  const jobRaw = await optionalMysqlJson(`SELECT status, started_at, finished_at, processed_symbols, total_symbols, failed_symbols FROM ${secJobsTable} WHERE run_id=${sqlString(runId)} LIMIT 1`);
  const [jobStatus, startedAt, finishedAt, processed, total, failed] = jobRaw ? jobRaw.split("\t") : [];
  const payload = { source: "mtm.sec_leadership.results", runId, job: { status: jobStatus, startedAt, finishedAt, processed: Number(processed || 0), total: Number(total || 0), failed: Number(failed || 0) }, status: await secLeadershipStatus(), rows, kpis, filters: { classifications: [...new Set(rows.map((row) => row.classification).filter(Boolean))], sectors: [...new Set(rows.map((row) => row.sector).filter(Boolean))].sort(), industries: [...new Set(rows.map((row) => row.industry).filter(Boolean))].sort() } };
  secLeadershipResultCache = { key: cacheKey, createdAt: Date.now(), payload };
  return payload;
}

async function secLeadershipSymbol(symbol, runId = "") {
  await ensureSecLeadershipTables();
  const safeSymbol = String(symbol || "").toUpperCase().replace(".US", "");
  const selectedRunId = runId || await secLeadershipLatestRunId();
  if (!selectedRunId) throw new Error("No completed SEC leadership refresh yet.");
  const raw = await mysqlJson(`
    SELECT symbol, company_name, sector, industry, classification, minervini_score, rs_rank, rs_score, trend_template_class, trend_template_score,
      leadership_score, code3_score, code3_confidence, extension_score, extension_status, turnaround_stage, sec_data_status,
      latest_filing_date, data_recency_days, latest_revenue, latest_eps, revenue_yoy_pct, eps_yoy_pct, gross_margin_pct, operating_margin_pct,
      reasons_json, trend_json, code3_json, quarterly_json, annual_json, margins_json, technical_json, failure_reason
    FROM ${secResultsTable}
    WHERE run_id=${sqlString(selectedRunId)} AND symbol=${sqlString(safeSymbol)}
    LIMIT 1
  `);
  if (!raw) throw new Error("Symbol not found in latest SEC leadership results.");
  const columns = ["symbol", "companyName", "sector", "industry", "classification", "minerviniScore", "rsRank", "rsScore", "trendTemplateClass", "trendTemplateScore", "leadershipScore", "code3Score", "code3Confidence", "extensionScore", "extensionStatus", "turnaroundStage", "secDataStatus", "latestFilingDate", "dataRecencyDays", "latestRevenue", "latestEps", "revenueYoyPct", "epsYoyPct", "grossMarginPct", "operatingMarginPct", "reasonsJson", "trendJson", "code3Json", "quarterlyJson", "annualJson", "marginsJson", "technicalJson", "failureReason"];
  const row = parseRows(raw, columns)[0] || {};
  const chart = await secLeadershipChartRows(safeSymbol);
  return {
    source: "mtm.sec_leadership.symbol",
    runId: selectedRunId,
    symbol: safeSymbol,
    summary: { symbol: row.symbol, companyName: row.companyName, sector: row.sector, industry: row.industry, classification: row.classification, minerviniScore: pct(row.minerviniScore, null), rsRank: Number(row.rsRank || 0), rsScore: pct(row.rsScore, null), extensionScore: pct(row.extensionScore, null), extensionStatus: row.extensionStatus || "", secDataStatus: row.secDataStatus, failureReason: row.failureReason || "" },
    reasons: parseJson(row.reasonsJson, []),
    trend: parseJson(row.trendJson, {}),
    code3: parseJson(row.code3Json, {}),
    quarterly: parseJson(row.quarterlyJson, []),
    annual: parseJson(row.annualJson, []),
    margins: parseJson(row.marginsJson, {}),
    technical: parseJson(row.technicalJson, {}),
    chart,
    fundamentals: { latestFilingDate: row.latestFilingDate, dataRecencyDays: row.dataRecencyDays === "" ? null : Number(row.dataRecencyDays || 0), latestRevenue: pct(row.latestRevenue, null), latestEps: pct(row.latestEps, null), revenueYoyPct: pct(row.revenueYoyPct, null), epsYoyPct: pct(row.epsYoyPct, null), grossMarginPct: pct(row.grossMarginPct, null), operatingMarginPct: pct(row.operatingMarginPct, null) }
  };
}

async function secLeadershipChartRows(symbol) {
  const latestDate = await latestRsDailyDate();
  if (!latestDate) return { source: "myts.rs_daily.direct", latestDate: null, rows: [], latest: null };
  const raw = await optionalMysqlJson(`
    SELECT sdate, stock_symbol, open, high, low, close, volume, perf_1d_pct, perf_5d_pct, rs_val, rs_val_3m, mci, sector, industry, ma50, avg_volume_50
    FROM rs_daily
    WHERE stock_symbol=${sqlString(symbol)}
      AND sdate <= ${sqlString(latestDate)}
    ORDER BY sdate DESC
    LIMIT 260
  `);
  const rows = parseRows(raw, ["sdate", "stock_symbol", "open", "high", "low", "close", "volume", "perf_1d_pct", "perf_5d_pct", "rs_val", "rs_val_3m", "mci", "sector", "industry", "ma50", "avg_volume_50"]).map((item) => ({
    ...item,
    symbol: item.stock_symbol,
    open: pct(item.open, null),
    high: pct(item.high, null),
    low: pct(item.low, null),
    close: pct(item.close, null),
    volume: Number(item.volume || 0),
    perf_1d_pct: pct(item.perf_1d_pct, null),
    perf_5d_pct: pct(item.perf_5d_pct, null),
    rs_val: pct(item.rs_val, null),
    rs_val_3m: pct(item.rs_val_3m, null),
    mci: pct(item.mci, null),
    ma50: pct(item.ma50, null),
    avg_volume_50: Number(item.avg_volume_50 || 0)
  })).sort((a, b) => String(a.sdate).localeCompare(String(b.sdate)));
  return { source: "myts.rs_daily.direct", latestDate, rows, latest: rows.at(-1) || null };
}

async function handleSecLeadership(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/sec-leadership/status" && request.method === "GET") return json(response, 200, await secLeadershipStatus());
  if (url.pathname === "/api/sec-leadership/results" && request.method === "GET") return json(response, 200, await secLeadershipResults({ limit: url.searchParams.get("limit"), runId: url.searchParams.get("runId") }));
  if (url.pathname === "/api/sec-leadership/start" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const job = await startSecLeadershipRefresh(body);
      return json(response, job.alreadyRunning ? 200 : 202, { ok: true, alreadyRunning: Boolean(job.alreadyRunning), job, status: await secLeadershipStatus() });
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { ok: false, warming: true, message: error.message, status: await secLeadershipStatus(), cacheStatus: await dailyRsCacheStatus() });
      return json(response, 400, { error: error.message, status: await secLeadershipStatus() });
    }
  }
  const match = url.pathname.match(/^\/api\/sec-leadership\/symbol\/([^/]+)$/);
  if (match && request.method === "GET") {
    try { return json(response, 200, await secLeadershipSymbol(decodeURIComponent(match[1]), url.searchParams.get("runId"))); }
    catch (error) { return json(response, 404, { error: error.message }); }
  }
  return json(response, 404, { error: "Not found" });
}



async function handleScreener(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/screener/cache/status" && request.method === "GET") return json(response, 200, await dailyRsCacheStatus());
  if (url.pathname === "/api/screener/cache/refresh" && request.method === "POST") {
    triggerDailyRsCacheWarm("manual_refresh", true);
    return json(response, 202, { ok: true, warming: true, status: await dailyRsCacheStatus() });
  }
  if (url.pathname === "/api/screener/backtest-scores" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      return json(response, 200, await eodhdScoreBacktest(body.symbols, session.user.username));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (url.pathname === "/api/screener/cache/symbols" && request.method === "GET") {
    try {
      const cache = await dailyRsCache({ noBuild: true, reason: "screener_symbols" });
      const limit = clamp(Number(url.searchParams.get("limit") || 1000), 1, cache.symbols.length || 1);
      return json(response, 200, { source: cache.source, latestDate: cache.latestDate, startDate: cache.startDate, count: cache.symbols.length, symbols: cache.symbols.slice(0, limit) });
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { warming: true, message: error.message, status: await dailyRsCacheStatus(), symbols: [] });
      throw error;
    }
  }
  const symbolMatch = url.pathname.match(/^\/api\/screener\/cache\/symbol\/([^/]+)$/);
  if (symbolMatch && request.method === "GET") {
    try {
      const cache = await dailyRsCache({ noBuild: true, reason: "screener_symbol" });
      const symbol = decodeURIComponent(symbolMatch[1]).trim().toUpperCase().replace(".US", "");
      const item = cache.groupedBySymbol?.[symbol];
      if (!item) return json(response, 404, { error: "Symbol not found in daily RS cache", symbol, latestDate: cache.latestDate });
      return json(response, 200, { source: cache.source, latestDate: cache.latestDate, startDate: cache.startDate, columns: cache.columns, derivedColumns: screenerDerivedColumns(), latest: item.latest ? { ...item.latest, ...deriveStockbeeColumns(item.rows || []) } : null, decisionSupport: cache.decisionSupportBySymbol?.[symbol] || buildScreenerDecisionSupport(item.symbol, item.rows || [], item.latest || {}), symbol: item.symbol, rows: item.rows });
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { warming: true, message: error.message, status: await dailyRsCacheStatus(), rows: [] });
      throw error;
    }
  }
  if (url.pathname === "/api/screener/query" && request.method === "GET") {
    try {
      return json(response, 200, await screenerCacheQuery({
        minRs: url.searchParams.get("minRs"),
        minPrice: url.searchParams.get("minPrice"),
        minVolume: url.searchParams.get("minVolume"),
        sector: url.searchParams.get("sector"),
        industry: url.searchParams.get("industry"),
        symbols: url.searchParams.get("symbols"),
        sort: url.searchParams.get("sort"),
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
        sortDir: url.searchParams.get("sortDir"),
        rs250: url.searchParams.get("rs250"),
        filters: url.searchParams.get("filters"),
        ti65Min: url.searchParams.get("ti65Min"),
        mdtMin: url.searchParams.get("mdtMin"),
        dtMin: url.searchParams.get("dtMin"),
        m21Min: url.searchParams.get("m21Min"),
        m10Min: url.searchParams.get("m10Min"),
        m5Min: url.searchParams.get("m5Min")
      }));
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { source: "mtm.daily_rs_cache.screener", warming: true, message: error.message, status: await dailyRsCacheStatus(), rows: [], count: 0 });
      throw error;
    }
  }
  return json(response, 404, { error: "Not found" });
}
async function handleMarket(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/market/leaders" && request.method === "GET") {
    return json(response, 200, await leadersTileModel(url.searchParams.get("limit")));
  }
  if (url.pathname === "/api/market/groups" && request.method === "GET") {
    const kind = url.searchParams.get("kind") === "industry" ? "industry" : "sector";
    const model = await marketGroupModel(kind);
    if (!model) return json(response, 404, { error: "No market dashboard snapshot found" });
    return json(response, 200, model);
  }
  if (url.pathname === "/api/market/tile" && request.method === "GET") {
    const model = await marketTileModel();
    if (!model) return json(response, 404, { error: "No market dashboard snapshot found" });
    return json(response, 200, model);
  }
  return json(response, 404, { error: "Not found" });
}

async function handleMarketMonitor(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/market-monitor/snapshot" && request.method === "GET") {
    try {
      return json(response, 200, await marketMonitorSnapshot(session.user.username, {
        force: url.searchParams.get("refresh") === "1",
        forceNews: url.searchParams.get("refreshNews") === "1"
      }));
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { warming: true, message: error.message, status: await dailyRsCacheStatus() });
      return json(response, 500, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleHome(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/home/business-day" && request.method === "GET") {
    try {
      return json(response, 200, await marketBusinessDayStatus());
    } catch (error) {
      return json(response, 500, { error: error.message });
    }
  }
  if (url.pathname === "/api/home/hierarchy" && request.method === "GET") {
    try {
      return json(response, 200, await marketHierarchySnapshot(session.user.username, { force: url.searchParams.get("refresh") === "1" }));
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { source: "mtm.market_hierarchy_cache", warming: true, message: error.message, status: await dailyRsCacheStatus() });
      return json(response, 500, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleMarketCycle(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/market-cycle/snapshot" && request.method === "GET") {
    try {
      return json(response, 200, await marketCycleSnapshot({
        lookback: url.searchParams.get("lookback"),
        force: url.searchParams.get("refresh") === "1"
      }));
    } catch (error) {
      if (error.code === "CACHE_WARMING") return json(response, 202, { source: "bear_cycle_tracker", warming: true, message: error.message, status: await dailyRsCacheStatus() });
      if (error.code === "NOT_FOUND") return json(response, 404, { source: "bear_cycle_tracker", error: error.message });
      return json(response, 500, { source: "bear_cycle_tracker", error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleSignals(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/signals/tile" && request.method === "GET") {
    return json(response, 200, await signalTileModel(url.searchParams.get("limit")));
  }
  if (url.pathname === "/api/signals/refresh" && request.method === "POST") {
    try {
      return json(response, 200, await refreshSignalSnapshots(session.user.username));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleWatchlist(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/watchlist/tile" && request.method === "GET") {
    return json(response, 200, await watchlistTileModel(url.searchParams.get("symbols")));
  }
  return json(response, 404, { error: "Not found" });
}

async function handleRisk(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/risk/tile" && request.method === "GET") {
    return json(response, 200, await riskTileModel());
  }
  if (url.pathname === "/api/risk/settings" && request.method === "POST") {
    const saved = await saveRiskSettings(JSON.parse(await readBody(request) || "{}"));
    return json(response, 200, { ok: true, inputs: saved, risk: await riskTileModel() });
  }
  if (url.pathname === "/api/risk/sell-rule-action" && request.method === "POST") {
    try {
      return json(response, 200, await recordRiskSellRuleAction(session.user, JSON.parse(await readBody(request) || "{}")));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleWorkflow(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/workflow/lifecycle" && request.method === "GET") {
    return json(response, 200, await workflowLifecycleModel());
  }
  if (url.pathname === "/api/workflow/event" && request.method === "POST") {
    try {
      return json(response, 200, await recordWorkflowLifecycleEvent(session.user, JSON.parse(await readBody(request) || "{}")));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleTradingSystemMonitor(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/trading-system-monitor" && request.method === "GET") {
    try { return json(response, 200, await tradingSystemMonitorModel()); }
    catch (error) { return json(response, 500, { error: error.message }); }
  }
  if (url.pathname === "/api/trading-system-monitor/backtest/queue" && request.method === "POST") {
    try { return json(response, 200, await enqueueTradingBacktest(JSON.parse(await readBody(request) || "{}"))); }
    catch (error) { return json(response, 500, { error: error.message }); }
  }
  if (url.pathname === "/api/trading-system-monitor/backtest/process" && request.method === "POST") {
    try { return json(response, 200, await processTradingBacktestJob()); }
    catch (error) { return json(response, 500, { error: error.message }); }
  }
  return json(response, 404, { error: "Not found" });
}

async function handleProfile(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/profile/tokens" && request.method === "GET") {
    try {
      return json(response, 200, { tokens: await profileTokenStatus(session.user.username), encryption: { enabled: Boolean(tokenEncryptionSecret), table: dbSecretsTable } });
    } catch (error) {
      return json(response, 500, { error: error.message });
    }
  }
  if (url.pathname === "/api/profile/tokens" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      return json(response, 200, await saveProfileTokens(session.user.username, body));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  return json(response, 404, { error: "Not found" });
}

async function handlePipeline(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/pipeline/status" && request.method === "GET") return json(response, 200, await pipelineStatusModel());
  if (url.pathname === "/api/pipeline/data-quality" && request.method === "GET") return json(response, 200, await dataQualityModel());
  if (url.pathname === "/api/pipeline/rs-ranking" && request.method === "GET") {
    return json(response, 200, await rsRankingModel({
      minRs: url.searchParams.get("minRs"),
      segment: url.searchParams.get("segment"),
      limit: url.searchParams.get("limit")
    }));
  }
  if (url.pathname === "/api/pipeline/daily-report" && request.method === "GET") return json(response, 200, await dailyReportModel());
  if (url.pathname === "/api/pipeline/reasoning-images" && request.method === "GET") return json(response, 200, await reasoningImagesModel());
  if (url.pathname === "/api/pipeline/run" && request.method === "POST") { const result = await runPipelineRefresh(); emitLiveEvent("pipeline_refresh_completed", { status: result.status || "completed", completedAt: new Date().toISOString() }); return json(response, 200, result); }
  return json(response, 404, { error: "Not found" });
}

async function handleAgents(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/agents/rs-daily/status" && request.method === "GET") {
    return json(response, 200, await rsAgentStatus());
  }
  if (url.pathname === "/api/agents/rs-monitor/status" && request.method === "GET") {
    return json(response, 200, await rsDailyObservabilityModel());
  }
  if (url.pathname === "/api/agents/rs-monitor/reload" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const symbols = Array.isArray(body.symbols) ? body.symbols : String(body.symbols || "").split(/[,\\s]+/);
      const job = await startRsDailyMonitorReload(symbols);
      return json(response, job.blocked ? 409 : 202, { ok: !job.blocked, alreadyRunning: Boolean(job.alreadyRunning), message: job.message, job, monitor: await rsDailyObservabilityModel() });
    } catch (error) {
      return json(response, 400, { error: error.message, monitor: await rsDailyObservabilityModel() });
    }
  }
  if (url.pathname === "/api/agents/rs-daily/start" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request) || "{}");
      const started = await startRsDailyAgent({ ...body, userId: session.user.username });
      return json(response, 200, { ...(await rsAgentStatus()), alreadyRunning: Boolean(started.alreadyRunning), message: started.message });
    } catch (error) {
      return json(response, 400, { error: error.message, status: await rsAgentStatus() });
    }
  }
  return json(response, 404, { error: "Not found" });
}
async function getUsers() {
  let users = await readDbState("__system__", "auth_users");
  if (Array.isArray(users) && users.length) return users;

  const legacy = await readDbState("__system__", "admin_auth");
  if (legacy?.passwordHash) {
    users = [{
      id: "admin",
      username: legacy.username || adminUsername,
      displayName: "Administrator",
      role: "admin",
      subscriptionStatus: "active",
      appSubscriptions: ["*"],
      passwordSalt: legacy.passwordSalt,
      passwordHash: legacy.passwordHash,
      mustChangePassword: legacy.mustChangePassword !== false,
      status: "active",
      createdAt: legacy.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
    await writeUsers(users);
    return users;
  }

  const bootstrapPassword = process.env[bootstrapPasswordEnv];
  if (!bootstrapPassword) throw new Error(`${bootstrapPasswordEnv} is required for first admin bootstrap.`);
  const hashed = hashPassword(bootstrapPassword);
  users = [{
    id: "admin",
    username: adminUsername,
    displayName: "Administrator",
    role: "admin",
    subscriptionStatus: "active",
      appSubscriptions: ["*"],
    passwordSalt: hashed.salt,
    passwordHash: hashed.hash,
    mustChangePassword: forcePasswordChangeOnFirstLogin,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }];
  await writeUsers(users);
  return users;
}

async function writeUsers(users) {
  await writeDbState("__system__", "auth_users", users);
}

async function findUser(username) {
  const users = await getUsers();
  return users.find((user) => user.username.toLowerCase() === String(username || "").toLowerCase());
}

async function updateUser(username, update) {
  const users = await getUsers();
  const index = users.findIndex((user) => user.username.toLowerCase() === String(username || "").toLowerCase());
  if (index < 0) return null;
  users[index] = { ...users[index], ...update, updatedAt: new Date().toISOString() };
  await writeUsers(users);
  return users[index];
}

async function setUserPassword(username, newPassword, mustChangePassword = false) {
  const hashed = hashPassword(newPassword);
  return updateUser(username, { passwordSalt: hashed.salt, passwordHash: hashed.hash, mustChangePassword });
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2));
}

async function sessionFor(request) {
  const token = parseCookies(request).mtm_ui_session;
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  session.lastSeenAt = Date.now();
  const user = await findUser(session.username);
  if (!user || user.status !== "active") return null;
  return { ...session, user };
}

function createSession(user) {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { username: user.username, createdAt: Date.now(), lastSeenAt: Date.now() });
  return token;
}

function activeSessionList() {
  return [...sessions.entries()].map(([token, session]) => ({
    token: token.slice(0, 8),
    username: session.username,
    createdAt: new Date(session.createdAt).toISOString(),
    lastSeenAt: new Date(session.lastSeenAt || session.createdAt).toISOString(),
    status: "active"
  }));
}
function authCookie(token) {
  return `mtm_ui_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function requireSession(request, response) {
  const session = await sessionFor(request);
  if (session) return session;
  json(response, 401, { error: "Authentication required" });
  return null;
}

async function requireAdmin(request, response) {
  const session = await requireSession(request, response);
  if (!session) return null;
  if (session.user.role !== "admin") {
    json(response, 403, { error: "Administrator role required" });
    return null;
  }
  return session;
}

function validateUserPayload(body, requirePassword) {
  const role = body.role || "guest";
  const subscriptionStatus = body.subscriptionStatus || (role === "power_user" ? "active" : "inactive");
  if (!body.username || !/^(?=.*[a-zA-Z])[a-zA-Z0-9]{3,64}$/.test(body.username)) return "Username must be 3-64 characters using letters and optional numbers only";
  if (!validRoles.has(role)) return "Invalid role";
  if (!validSubscriptionStatuses.has(subscriptionStatus)) return "Invalid subscription status";
  if (requirePassword && (!body.password || body.password.length < minPasswordLength)) return `Password must be at least ${minPasswordLength} characters`;
  return null;
}

async function handleAuth(request, response, url) {
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const session = await sessionFor(request);
    if (!session) return json(response, 200, { authenticated: false, username: adminUsername });
    return json(response, 200, { authenticated: true, user: publicUser(session.user), username: session.user.username, mustChangePassword: session.user.mustChangePassword });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = JSON.parse(await readBody(request) || "{}");
    const user = await findUser(body.username);
    if (!user || user.status !== "active" || !verifyPassword(body.password || "", user)) return json(response, 401, { error: "Invalid username or password" });
    const token = createSession(user);
    return json(response, 200, { authenticated: true, user: publicUser(user), username: user.username, mustChangePassword: user.mustChangePassword }, { "set-cookie": authCookie(token) });
  }
  if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
    const session = await requireSession(request, response);
    if (!session) return;
    const body = JSON.parse(await readBody(request) || "{}");
    if (!verifyPassword(body.currentPassword || "", session.user)) return json(response, 400, { error: "Current password is incorrect" });
    if (!body.newPassword || body.newPassword.length < minPasswordLength) return json(response, 400, { error: `New password must be at least ${minPasswordLength} characters` });
    if (body.newPassword !== body.confirmPassword) return json(response, 400, { error: "New passwords do not match" });
    const updated = await setUserPassword(session.user.username, body.newPassword, false);
    return json(response, 200, { ok: true, user: publicUser(updated), mustChangePassword: false });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = parseCookies(request).mtm_ui_session;
    if (token) sessions.delete(token);
    return json(response, 200, { ok: true }, { "set-cookie": "mtm_ui_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }
  return json(response, 404, { error: "Not found" });
}

async function handleLive(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/live/status" && request.method === "GET") return json(response, 200, liveEventSnapshot(session));
  if (url.pathname === "/api/live/events" && request.method === "GET") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(`event: connected\ndata: ${JSON.stringify(liveEventSnapshot(session))}\n\n`);
    liveEventClients.add(response);
    const heartbeat = setInterval(() => {
      try { response.write(`event: heartbeat\ndata: ${JSON.stringify(liveEventSnapshot(session))}\n\n`); }
      catch { clearInterval(heartbeat); liveEventClients.delete(response); }
    }, 25000);
    request.on("close", () => { clearInterval(heartbeat); liveEventClients.delete(response); });
    return;
  }
  return json(response, 404, { error: "Not found" });
}

async function handleBots(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/bots/catalog" && request.method === "GET") {
    const permissions = new Set(permissionsFor(session.user));
    const bots = botCatalog.map((bot) => ({ ...bot, enabled: session.user.role === "admin" || bot.permissions.every((permission) => permissions.has(permission) || permissions.has("capabilities:all") || permissions.has("capabilities:subscribed")) }));
    return json(response, 200, { source: "mtm.bot_catalog", asOf: new Date().toISOString(), bots, buckets: [...new Set(botCatalog.map((bot) => bot.bucket))] });
  }
  return json(response, 404, { error: "Not found" });
}

async function handleCandleCache(request, response, url) {
  const session = await requireSession(request, response);
  if (!session) return;
  if (url.pathname === "/api/candle-cache/status" && request.method === "GET") return json(response, 200, await candleCacheStatus());
  const match = url.pathname.match(/^\/api\/candle-cache\/symbol\/([^/]+)$/);
  if (match && request.method === "GET") { try { return json(response, 200, await candleCacheForSymbol(decodeURIComponent(match[1]), { limit: url.searchParams.get("limit") })); } catch (error) { if (error.code === "CACHE_WARMING") return json(response, 202, { source: "mtm.candle_cache", warming: true, message: error.message, status: await candleCacheStatus(), rows: [] }); throw error; } }
  return json(response, 404, { error: "Not found" });
}
async function handleUsers(request, response, url) {
  const session = await requireAdmin(request, response);
  if (!session) return;

  if (url.pathname === "/api/users" && request.method === "GET") {
    const users = await getUsers();
    return json(response, 200, { users: users.map(publicUser), roles: [...validRoles], subscriptionStatuses: [...validSubscriptionStatuses], guestAppIds, activeSessions: activeSessionList() });
  }

  if (url.pathname === "/api/users" && request.method === "POST") {
    const body = JSON.parse(await readBody(request) || "{}");
    const error = validateUserPayload(body, true);
    if (error) return json(response, 400, { error });
    const users = await getUsers();
    if (users.some((user) => user.username.toLowerCase() === body.username.toLowerCase())) return json(response, 400, { error: "Username already exists" });
    const hashed = hashPassword(body.password);
    const role = body.role || "guest";
    const next = {
      id: randomBytes(8).toString("hex"),
      username: body.username,
      displayName: body.displayName || body.username,
      role,
      subscriptionStatus: body.subscriptionStatus || (role === "power_user" ? "active" : "inactive"),
      appSubscriptions: role === "admin" ? ["*"] : role === "guest" ? guestAppIds : (body.appSubscriptions || []),
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      mustChangePassword: body.mustChangePassword !== false,
      status: body.status || "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(next);
    await writeUsers(users);
    return json(response, 201, { user: publicUser(next) });
  }

  const match = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (match && request.method === "PATCH") {
    const username = decodeURIComponent(match[1]);
    const body = JSON.parse(await readBody(request) || "{}");
    if (username.toLowerCase() === adminUsername.toLowerCase()) return json(response, 403, { error: "Default admin user cannot be modified from this screen" });
    if (body.role && !validRoles.has(body.role)) return json(response, 400, { error: "Invalid role" });
    if (body.subscriptionStatus && !validSubscriptionStatuses.has(body.subscriptionStatus)) return json(response, 400, { error: "Invalid subscription status" });
    if (body.password && body.password.length < minPasswordLength) return json(response, 400, { error: `Password must be at least ${minPasswordLength} characters` });
    const update = {};
    for (const key of ["displayName", "role", "subscriptionStatus", "status", "mustChangePassword", "appSubscriptions"]) if (key in body) update[key] = body[key];
    if (body.role === "admin") update.appSubscriptions = ["*"];
    if (body.role === "guest") update.appSubscriptions = guestAppIds;
    let user = await updateUser(username, update);
    if (!user) return json(response, 404, { error: "User not found" });
    if (body.password) user = await setUserPassword(username, body.password, body.mustChangePassword !== false);
    return json(response, 200, { user: publicUser(user) });
  }

  if (match && request.method === "DELETE") {
    const username = decodeURIComponent(match[1]);
    if (username.toLowerCase() === adminUsername.toLowerCase()) return json(response, 403, { error: "Default admin user cannot be deleted from this screen" });
    const users = await getUsers();
    const next = users.filter((user) => user.username.toLowerCase() !== username.toLowerCase());
    if (next.length === users.length) return json(response, 404, { error: "User not found" });
    await writeUsers(next);
    for (const [token, active] of sessions.entries()) if (active.username.toLowerCase() === username.toLowerCase()) sessions.delete(token);
    return json(response, 200, { ok: true });
  }

  return json(response, 404, { error: "Not found" });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/auth/")) return handleAuth(request, response, url);
    if (url.pathname.startsWith("/api/users")) return handleUsers(request, response, url);
    if (url.pathname.startsWith("/api/home/")) return handleHome(request, response, url);
    if (url.pathname.startsWith("/api/live/")) return handleLive(request, response, url);
    if (url.pathname.startsWith("/api/bots/")) return handleBots(request, response, url);
    if (url.pathname.startsWith("/api/candle-cache/")) return handleCandleCache(request, response, url);
    if (url.pathname.startsWith("/api/market-monitor/")) return handleMarketMonitor(request, response, url);
    if (url.pathname.startsWith("/api/market-cycle/")) return handleMarketCycle(request, response, url);
    if (url.pathname.startsWith("/api/market/")) return handleMarket(request, response, url);
    if (url.pathname.startsWith("/api/signals/")) return handleSignals(request, response, url);
    if (url.pathname.startsWith("/api/watchlist/")) return handleWatchlist(request, response, url);
    if (url.pathname.startsWith("/api/risk/")) return handleRisk(request, response, url);
    if (url.pathname.startsWith("/api/workflow/")) return handleWorkflow(request, response, url);
    if (url.pathname.startsWith("/api/trading-system-monitor")) return handleTradingSystemMonitor(request, response, url);
    if (url.pathname.startsWith("/api/profile/")) return handleProfile(request, response, url);
    if (url.pathname.startsWith("/api/screener/")) return handleScreener(request, response, url);
    if (url.pathname.startsWith("/api/sec-leadership/")) return handleSecLeadership(request, response, url);
    if (url.pathname.startsWith("/api/pipeline/")) return handlePipeline(request, response, url);
    if (url.pathname.startsWith("/api/agents/")) return handleAgents(request, response, url);
    if (url.pathname.startsWith("/api/state/")) {
      const session = await requireSession(request, response);
      if (!session) return;
      const [, , , user, name] = url.pathname.split("/");
      if (request.method === "GET") return json(response, 200, { value: await readDbState(user, name) });
      if (request.method === "POST" && !permissionsFor(session.user).includes("workspace:write")) return json(response, 403, { error: "Workspace write access requires admin or active power user" });
      if (request.method === "POST") {
        const body = JSON.parse(await readBody(request) || "{}");
        await writeDbState(user, name, body.value);
        return json(response, 200, { ok: true });
      }
      return json(response, 405, { error: "Method not allowed" });
    }

    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": types.get(path.extname(filePath)) || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch (error) {
    if ((request.url || "").startsWith("/api/")) return json(response, 500, { error: error.message });
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`MTM UI pilot running at http://${host}:${port}`);
  setTimeout(() => triggerDailyRsCacheWarm("startup", false), 30000);
});




































