const HISTORY_KEY = "bhejo_history_v1";
const SAVED_KEY = "bhejo_saved_v1";

const ENV_KEY = "bhejo_env_v1";           // current env name
const ENV_VARS_KEY = "bhejo_env_vars_v1"; // { dev:{}, staging:{}, prod:{} }

const HISTORY_LIMIT = 50;
const SAVED_LIMIT = 200;

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

/* -------------------------
   HISTORY
-------------------------- */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const fixed = parsed.map((it) => ({ id: it.id || uuid(), ...it }));
    if (fixed.some((x, i) => x.id !== parsed?.[i]?.id)) saveHistory(fixed);
    return fixed;
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

export function addToHistory(item) {
  const history = loadHistory();
  const normalized = { id: item.id || uuid(), ...item };

  const fingerprint = makeFingerprint(normalized);
  const filtered = history.filter((h) => makeFingerprint(h) !== fingerprint);

  const updated = [normalized, ...filtered].slice(0, HISTORY_LIMIT);
  saveHistory(updated);
  return updated;
}

export function deleteHistoryItem(id) {
  const history = loadHistory();
  const updated = history.filter((h) => h.id !== id);
  saveHistory(updated);
  return updated;
}

/* -------------------------
   SAVED REQUESTS
-------------------------- */
export function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const fixed = parsed.map((it) => ({ id: it.id || uuid(), ...it }));
    if (fixed.some((x, i) => x.id !== parsed?.[i]?.id)) saveSaved(fixed);
    return fixed;
  } catch {
    return [];
  }
}

export function saveSaved(items) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, SAVED_LIMIT)));
}

export function upsertSaved(newItem) {
  const items = loadSaved();

  const nameKey = (newItem.name || "").trim().toLowerCase();
  const nowIso = new Date().toISOString();

  const normalized = {
    id: newItem.id || uuid(),
    name: (newItem.name || "").trim() || "Untitled",
    method: newItem.method || "GET",
    url: newItem.url || "",
    params: newItem.params || [{ key: "", value: "" }],
    headers: newItem.headers || [{ key: "", value: "" }],
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
    createdAt: newItem.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const filtered = items.filter(
    (it) => (it.name || "").trim().toLowerCase() !== nameKey
  );

  const updated = [normalized, ...filtered];
  saveSaved(updated);
  return updated;
}

export function deleteSaved(id) {
  const items = loadSaved();
  const updated = items.filter((it) => it.id !== id);
  saveSaved(updated);
  return updated;
}

/* -------------------------
   ENVIRONMENTS
-------------------------- */

export function getCurrentEnv() {
  return localStorage.getItem(ENV_KEY) || "dev";
}

export function setCurrentEnv(envName) {
  localStorage.setItem(ENV_KEY, envName);
}

export function loadEnvVars() {
  try {
    const raw = localStorage.getItem(ENV_VARS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    // Ensure default structure exists
    const defaults = {
      dev: { baseUrl: "https://jsonplaceholder.typicode.com", token: "" },
      staging: { baseUrl: "", token: "" },
      prod: { baseUrl: "", token: "" },
    };

    const merged = { ...defaults, ...(parsed || {}) };
    // Ensure each env exists
    merged.dev = merged.dev || defaults.dev;
    merged.staging = merged.staging || defaults.staging;
    merged.prod = merged.prod || defaults.prod;

    localStorage.setItem(ENV_VARS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    const fallback = {
      dev: { baseUrl: "https://jsonplaceholder.typicode.com", token: "" },
      staging: { baseUrl: "", token: "" },
      prod: { baseUrl: "", token: "" },
    };
    localStorage.setItem(ENV_VARS_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

export function saveEnvVars(envVars) {
  localStorage.setItem(ENV_VARS_KEY, JSON.stringify(envVars || {}));
}

/* -------------------------
   Helpers
-------------------------- */
function makeFingerprint(item) {
  return JSON.stringify({
    method: item.method,
    url: item.url,
    params: item.params,
    headers: item.headers,
    body: item.body,
    auth: item.auth,
  });
}
