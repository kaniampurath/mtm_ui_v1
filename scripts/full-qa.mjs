import { performance } from "node:perf_hooks";

const base = process.env.MTM_QA_BASE || "http://127.0.0.1:4173";
const adminUser = process.env.MTM_QA_ADMIN_USER || "admin";
const adminPassword = process.env.MTM_QA_ADMIN_PASSWORD || "admin123";
const runId = Date.now().toString(36);
const results = [];
let adminCookie = "";
let guestCookie = "";
let powerCookie = "";
let createdUsers = [];

function record(area, test, status, detail = "", ms = 0) {
  results.push({ area, test, status, detail, ms: Math.round(ms) });
}

async function timed(area, test, fn) {
  const start = performance.now();
  try {
    const detail = await fn();
    record(area, test, "PASS", detail || "ok", performance.now() - start);
  } catch (error) {
    record(area, test, "FAIL", error.message, performance.now() - start);
  }
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

async function request(path, { method = "GET", body, cookie = adminCookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = {};
  try { json = await response.json(); } catch {}
  return { response, json };
}

async function login(username, password) {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const json = await response.json();
  return { response, json, cookie: cookieFrom(response) };
}

async function main() {
  await timed("Health", "GET /", async () => {
    const response = await fetch(`${base}/`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes("app")) throw new Error("index did not include app root");
    return `HTTP ${response.status}`;
  });

  await timed("Health", "served module cache bust", async () => {
    const response = await fetch(`${base}/src/main.js`);
    const text = await response.text();
    if (!text.includes("workspace.js?v=20260626b")) throw new Error("main.js not serving latest workspace module");
    return "workspace.js?v=20260626b";
  });

  await timed("Auth", "admin login", async () => {
    const loginResult = await login(adminUser, adminPassword);
    if (!loginResult.response.ok) throw new Error(loginResult.json.error || `HTTP ${loginResult.response.status}`);
    if (loginResult.json.mustChangePassword) throw new Error("admin still forced to change password; cannot continue full authenticated QA");
    adminCookie = loginResult.cookie;
    return `role=${loginResult.json.user?.role}`;
  });

  if (!adminCookie) {
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(2);
  }

  await timed("Auth", "session me", async () => {
    const { response, json } = await request("/api/auth/me");
    if (!response.ok || !json.authenticated) throw new Error(json.error || `HTTP ${response.status}`);
    return json.username;
  });

  await timed("Users/RBAC", "admin users list and active sessions", async () => {
    const { response, json } = await request("/api/users");
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    if (!Array.isArray(json.users)) throw new Error("users missing");
    if (!Array.isArray(json.activeSessions)) throw new Error("activeSessions missing");
    return `${json.users.length} users, ${json.activeSessions.length} sessions`;
  });

  const guestName = `QaGuest${runId}`;
  const powerName = `QaPower${runId}`;
  const guestPassword = `GuestQa${runId}!123`;
  const powerPassword = `PowerQa${runId}!123`;

  await timed("Users/RBAC", "create guest default role", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: guestName, displayName: "QA Guest", password: guestPassword, role: "guest" } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    createdUsers.push(guestName);
    if (json.user.role !== "guest") throw new Error(`role=${json.user.role}`);
    if (!(json.user.appSubscriptions || []).includes("screener")) throw new Error("guest basic app subscriptions missing");
    return "guest + basic apps";
  });

  await timed("Users/RBAC", "create power user with app subscription", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: powerName, displayName: "QA Power", password: powerPassword, role: "power_user", subscriptionStatus: "active", appSubscriptions: ["screener", "heat-map"] } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    createdUsers.push(powerName);
    if (json.user.role !== "power_user") throw new Error(`role=${json.user.role}`);
    if (!(json.user.appSubscriptions || []).includes("heat-map")) throw new Error("power app grant missing");
    return "power_user + heat-map";
  });

  await timed("Users/RBAC", "guest cannot manage users", async () => {
    const g = await login(guestName, guestPassword);
    if (!g.response.ok) throw new Error(g.json.error || `guest login HTTP ${g.response.status}`);
    guestCookie = g.cookie;
    const { response } = await request("/api/users", { cookie: guestCookie });
    if (response.status !== 403) throw new Error(`expected 403, got ${response.status}`);
    return "403 as expected";
  });

  await timed("Users/RBAC", "power user cannot manage users", async () => {
    const p = await login(powerName, powerPassword);
    if (!p.response.ok) throw new Error(p.json.error || `power login HTTP ${p.response.status}`);
    powerCookie = p.cookie;
    const { response } = await request("/api/users", { cookie: powerCookie });
    if (response.status !== 403) throw new Error(`expected 403, got ${response.status}`);
    return "403 as expected";
  });

  await timed("Users/RBAC", "default admin modification blocked", async () => {
    const { response, json } = await request(`/api/users/${encodeURIComponent(adminUser)}`, { method: "PATCH", body: { displayName: "Should Not Change" } });
    if (response.status !== 403) throw new Error(json.error || `expected 403, got ${response.status}`);
    return "403 protected";
  });

  await timed("Users/RBAC", "modify power subscription", async () => {
    const { response, json } = await request(`/api/users/${encodeURIComponent(powerName)}`, { method: "PATCH", body: { displayName: "QA Power Updated", role: "power_user", subscriptionStatus: "active", status: "active", appSubscriptions: ["screener"] } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    if ((json.user.appSubscriptions || []).includes("heat-map")) throw new Error("revoked app still present");
    return "heat-map revoked";
  });

  await timed("Persistence", "admin workspace state round trip", async () => {
    const name = `qa_workspace_${runId}`;
    const value = { id: name, name: "QA Workspace", widgets: [{ id: "w1", pluginId: "screener", x: 0, y: 0, w: 8, h: 12, minimized: false, config: { symbol: "NVDA" }, appState: { selected: true }, refreshPolicy: { mode: "manual", allowUserOverride: true } }], updatedAt: new Date().toISOString() };
    let result = await request(`/api/state/${encodeURIComponent(adminUser)}/${encodeURIComponent(name)}`, { method: "POST", body: { value } });
    if (!result.response.ok) throw new Error(result.json.error || `POST HTTP ${result.response.status}`);
    result = await request(`/api/state/${encodeURIComponent(adminUser)}/${encodeURIComponent(name)}`);
    if (!result.response.ok) throw new Error(result.json.error || `GET HTTP ${result.response.status}`);
    if (result.json.value?.widgets?.[0]?.config?.symbol !== "NVDA") throw new Error("state did not round trip");
    return "layout/config/state persisted";
  });

  await timed("Persistence", "guest write blocked", async () => {
    const { response, json } = await request(`/api/state/${encodeURIComponent(guestName)}/blocked_write`, { method: "POST", cookie: guestCookie, body: { value: { no: true } } });
    if (response.status !== 403) throw new Error(json.error || `expected 403, got ${response.status}`);
    return "403 as expected";
  });

  await timed("Persistence", "power write allowed while active", async () => {
    const { response, json } = await request(`/api/state/${encodeURIComponent(powerName)}/power_write`, { method: "POST", cookie: powerCookie, body: { value: { ok: true, runId } } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return "write ok";
  });

  await timed("Boundary", "invalid role rejected", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: `bad_${runId}`, password: "BadPassword123!", role: "super_admin" } });
    if (response.status !== 400) throw new Error(json.error || `expected 400, got ${response.status}`);
    return "400 as expected";
  });

  await timed("Boundary", "short password rejected", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: `short_${runId}`, password: "short", role: "guest" } });
    if (response.status !== 400) throw new Error(json.error || `expected 400, got ${response.status}`);
    return "400 as expected";
  });
  await timed("Boundary", "alphabetic username accepted", async () => {
    const username = `Alpha${runId.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
    const { response, json } = await request("/api/users", { method: "POST", body: { username, displayName: "Alpha User", password: "AlphaPassword123!", role: "guest" } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    createdUsers.push(username);
    return username;
  });

  await timed("Boundary", "non alphanumeric username rejected", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: `bad_user_${runId}`, password: "BadPassword123!", role: "guest" } });
    if (response.status !== 400) throw new Error(json.error || `expected 400, got ${response.status}`);
    return "400 as expected";
  });

  await timed("Boundary", "numeric-only username rejected", async () => {
    const { response, json } = await request("/api/users", { method: "POST", body: { username: "123456", password: "BadPassword123!", role: "guest" } });
    if (response.status !== 400) throw new Error(json.error || `expected 400, got ${response.status}`);
    return "400 as expected";
  });

  await timed("Performance", "50 auth/me requests", async () => {
    const start = performance.now();
    const responses = await Promise.all(Array.from({ length: 50 }, () => request("/api/auth/me")));
    const elapsed = performance.now() - start;
    const failures = responses.filter((r) => !r.response.ok || !r.json.authenticated).length;
    if (failures) throw new Error(`${failures} failures`);
    return `avg ${(elapsed / 50).toFixed(1)} ms/request`;
  });

  await timed("Stress", "25 concurrent state writes", async () => {
    const writes = await Promise.all(Array.from({ length: 25 }, (_, i) => request(`/api/state/${encodeURIComponent(adminUser)}/stress_${runId}_${i}`, { method: "POST", body: { value: { i, runId, payload: "x".repeat(1024) } } })));
    const failures = writes.filter((r) => !r.response.ok);
    if (failures.length) throw new Error(`${failures.length} writes failed`);
    return "25/25 writes ok";
  });

  await timed("Stress", "large state payload", async () => {
    const payload = { runId, rows: Array.from({ length: 500 }, (_, i) => ({ i, symbol: `SYM${i}`, value: Math.random(), text: "payload".repeat(20) })) };
    const { response, json } = await request(`/api/state/${encodeURIComponent(adminUser)}/large_${runId}`, { method: "POST", body: { value: payload } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return `${JSON.stringify(payload).length} bytes`;
  });

  await timed("Recovery", "server still responsive after stress", async () => {
    const { response, json } = await request("/api/auth/me");
    if (!response.ok || !json.authenticated) throw new Error(json.error || `HTTP ${response.status}`);
    return "responsive";
  });

  await timed("Users/RBAC", "remove guest user", async () => {
    const { response, json } = await request(`/api/users/${encodeURIComponent(guestName)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    createdUsers = createdUsers.filter((u) => u !== guestName);
    return "removed";
  });

  await timed("Users/RBAC", "disable power user cleanup", async () => {
    const { response, json } = await request(`/api/users/${encodeURIComponent(powerName)}`, { method: "PATCH", body: { status: "disabled", role: "power_user", subscriptionStatus: "inactive", appSubscriptions: [] } });
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return "disabled";
  });
  await timed("Users/RBAC", "cleanup remaining QA users", async () => {
    const remaining = createdUsers.filter((name) => name !== powerName);
    for (const username of remaining) {
      const { response } = await request(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(`cleanup ${username} HTTP ${response.status}`);
    }
    return `${remaining.length} removed`;
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(JSON.stringify({ summary: { passed, failed, total: results.length, runId }, results }, null, 2));
  if (failed) process.exit(1);
}

main().catch((error) => {
  record("Runner", "uncaught", "FAIL", error.stack || error.message);
  console.log(JSON.stringify({ summary: { passed: results.filter((r) => r.status === "PASS").length, failed: results.filter((r) => r.status === "FAIL").length, total: results.length, runId }, results }, null, 2));
  process.exit(1);
});
