export const LINK_GROUPS = {
  blue: "#4aa8ff",
  green: "#4ccf7b",
  yellow: "#f5c94a",
  red: "#ff6b6b",
  purple: "#aa86ff"
};

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(eventType, handler) {
    const handlers = this.listeners.get(eventType) || new Set();
    handlers.add(handler);
    this.listeners.set(eventType, handlers);
    return () => this.off(eventType, handler);
  }

  off(eventType, handler) {
    const handlers = this.listeners.get(eventType);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) this.listeners.delete(eventType);
  }

  emit(eventType, payload = {}) {
    const event = { event_type: eventType, timestamp: Date.now(), ...payload };
    const targets = [...(this.listeners.get(eventType) || []), ...(this.listeners.get("*") || [])];
    for (const handler of targets) {
      try {
        handler(event);
      } catch (error) {
        if (eventType !== "event_handler_error") this.emit("event_handler_error", { source_event: eventType, error: error.message });
      }
    }
  }
}

export class ContextBus {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.state = new Map();
  }

  key(linkGroup) {
    return linkGroup || "none";
  }

  get(linkGroup) {
    return this.state.get(this.key(linkGroup)) || {
      symbol: "NVDA",
      watchlist: "Growth Leaders",
      portfolio: "Pilot",
      sector: "Technology",
      industry: "Semiconductors",
      theme: "AI Infrastructure",
      timeframe: "1D",
      strategy: "Stage 2 Breakout",
      agent: "Research Agent"
    };
  }

  update(linkGroup, patch, sourceWidgetId) {
    const key = this.key(linkGroup);
    const next = { ...this.get(linkGroup), ...patch };
    this.state.set(key, next);
    this.eventBus.emit("context_updated", { link_group: linkGroup, context: next, source_widget_id: sourceWidgetId });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestJson(method, url, payload) {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader("content-type", "application/json");
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText || "{}")); } catch { resolve({}); }
      };
      xhr.onerror = () => resolve({ error: "Request failed" });
      xhr.send(payload ? JSON.stringify(payload) : undefined);
    } catch (error) {
      resolve({ error: error.message });
    }
  });
}

export class MemoryDashboardRepository {
  constructor(userId = "pilot-local-user") {
    this.userId = userId;
    this.queue = Promise.resolve();
  }

  url(name) {
    return `/api/state/${encodeURIComponent(this.userId)}/${encodeURIComponent(name)}`;
  }

  async read(name) {
    const result = await requestJson("GET", this.url(name));
    return result.value || null;
  }

  async write(name, value) {
    this.queue = this.queue.then(() => requestJson("POST", this.url(name), { value }));
    await this.queue;
  }

  async saveDashboard(dashboard) {
    await this.write("dashboard", clone(dashboard));
    return clone(dashboard);
  }

  async loadDashboard() {
    const saved = await this.read("dashboard");
    return saved ? clone(saved) : null;
  }

  async saveLayout(layout) {
    await this.write("layout", clone(layout));
    return clone(layout);
  }

  async loadLayout() {
    const saved = await this.read("layout");
    return saved ? clone(saved) : null;
  }

  async saveProfile(profile) {
    const next = { ...profile, updatedAt: new Date().toISOString() };
    await this.write("profile", next);
    return clone(next);
  }

  async loadProfile() {
    const saved = await this.read("profile");
    return saved ? clone(saved) : null;
  }

  async saveWorkspaces(workspaces) {
    await this.write("workspaces", clone(workspaces));
    return clone(workspaces);
  }

  async loadWorkspaces() {
    const saved = await this.read("workspaces");
    return Array.isArray(saved) ? clone(saved) : null;
  }

  async saveTemplates(templates) {
    await this.write("workspace_templates", clone(templates));
    return clone(templates);
  }

  async loadTemplates() {
    const saved = await this.read("workspace_templates");
    return Array.isArray(saved) ? clone(saved) : [];
  }

  async savePreferences(preferences) {
    const next = { ...preferences, updatedAt: new Date().toISOString() };
    await this.write("user_preferences", next);
    return clone(next);
  }

  async loadPreferences() {
    const saved = await this.read("user_preferences");
    return saved ? clone(saved) : null;
  }
}