// src/utils/storage.js

// -------------------- Keys --------------------
const HISTORY_KEY = "bhejo_history_v1";
const SAVED_KEY = "bhejo_saved_v1";

const CURRENT_ENV_KEY = "bhejo_current_env_v1";
const ENV_VARS_KEY = "bhejo_env_vars_v1";

const COLLECTIONS_KEY = "bhejo_collections_v1";

// -------------------- Helpers --------------------
function uuid(prefix = "id") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeSave(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// -------------------- History --------------------
export function loadHistory() {
  const parsed = safeParse(HISTORY_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveHistory(items) {
  safeSave(HISTORY_KEY, Array.isArray(items) ? items : []);
}

export function addToHistory(item) {
  const list = loadHistory();

  const normalized = {
    id: item.id || uuid("hist"),
    name: item.name || "",
    method: item.method || "GET",
    url: item.url || "",
    params: Array.isArray(item.params) ? item.params : [{ key: "", value: "" }],
    headers: Array.isArray(item.headers) ? item.headers : [{ key: "", value: "" }],
    body: item.body || "",
    auth: item.auth || { type: "none" },
    tests: Array.isArray(item.tests) ? item.tests : [],
    dataRows: Array.isArray(item.dataRows) ? item.dataRows : [],
    savedAt: item.savedAt || new Date().toISOString(),
    lastResult: item.lastResult || null,
  };

  // Put newest at top. Keep a reasonable cap (adjust if you want).
  const updated = [normalized, ...list].slice(0, 200);
  saveHistory(updated);
  return updated;
}

export function deleteHistoryItem(id) {
  const list = loadHistory();
  const updated = list.filter((x) => x.id !== id);
  saveHistory(updated);
  return updated;
}

// -------------------- Saved Requests --------------------
export function loadSaved() {
  const parsed = safeParse(SAVED_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveSaved(items) {
  safeSave(SAVED_KEY, Array.isArray(items) ? items : []);
}

export function deleteSaved(id) {
  const items = loadSaved();
  const updated = items.filter((x) => x.id !== id);
  saveSaved(updated);
  return updated;
}

/**
 * Upsert by NAME (case-insensitive uniqueness).
 * If you save again with same name, it replaces the old one.
 */
export function upsertSaved(newItem) {
  const items = loadSaved();

  const name = (newItem.name || "").trim();
  const nameKey = name.toLowerCase();
  const nowIso = new Date().toISOString();

  const normalized = {
    id: newItem.id || uuid("sav"),
    name: name || "Untitled",
    method: newItem.method || "GET",
    url: newItem.url || "",
    params: Array.isArray(newItem.params) ? newItem.params : [{ key: "", value: "" }],
    headers: Array.isArray(newItem.headers) ? newItem.headers : [{ key: "", value: "" }],
    body: newItem.body || "",
    auth:
      newItem.auth || {
        type: "none",
        bearer: "",
        username: "",
        password: "",
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },

    // Assertions (Phase 1.9)
    tests: Array.isArray(newItem.tests) ? newItem.tests : [],

    // Collections (Phase 2.2)
    collectionId: newItem.collectionId || "",

    // Data rows / Iterations (Phase 2.3)
    dataRows: Array.isArray(newItem.dataRows) ? newItem.dataRows : [],

    createdAt: newItem.createdAt || nowIso,
    updatedAt: nowIso,
  };

  // Remove any existing item with same name (case-insensitive)
  const filtered = items.filter(
    (it) => ((it.name || "").trim().toLowerCase() !== nameKey)
  );

  const updated = [normalized, ...filtered];
  saveSaved(updated);
  return updated;
}

// -------------------- Environments --------------------
export function getCurrentEnv() {
  const v = localStorage.getItem(CURRENT_ENV_KEY);
  return (v || "dev").trim() || "dev";
}

export function setCurrentEnv(envName) {
  const n = (envName || "").trim() || "dev";
  localStorage.setItem(CURRENT_ENV_KEY, n);
}

export function loadEnvVars() {
  const parsed = safeParse(ENV_VARS_KEY, {});
  // expected shape: { dev: {baseUrl:"..."}, qa: {...} }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

export function saveEnvVars(envVarsAll) {
  const obj =
    envVarsAll && typeof envVarsAll === "object" && !Array.isArray(envVarsAll)
      ? envVarsAll
      : {};
  safeSave(ENV_VARS_KEY, obj);
}

// -------------------- Collections (Phase 2.2) --------------------
export function loadCollections() {
  const parsed = safeParse(COLLECTIONS_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveCollections(collections) {
  safeSave(COLLECTIONS_KEY, Array.isArray(collections) ? collections : []);
}

export function addCollection(name) {
  const n = (name || "").trim();
  if (!n) return loadCollections();

  const list = loadCollections();
  if (list.some((c) => (c.name || "").toLowerCase() === n.toLowerCase())) {
    return list; // unique by name
  }

  const newItem = {
    id: uuid("col"),
    name: n,
    createdAt: new Date().toISOString(),
  };

  const updated = [newItem, ...list];
  saveCollections(updated);
  return updated;
}

export function deleteCollection(id) {
  const list = loadCollections();
  const updated = list.filter((c) => c.id !== id);
  saveCollections(updated);
  return updated;
}
