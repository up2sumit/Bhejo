// src/utils/settings.js

const SETTINGS_KEY = "bhejo_settings_v1";

export function getDefaultSettings() {
  const envProxy = import.meta?.env?.VITE_PROXY_URL || "http://localhost:3001/proxy";

  return {
    proxy: {
      // off | manual | system
      mode: "manual",
      manualUrl: envProxy,
      // default request mode for new requests (direct|proxy)
      defaultRequestMode: "direct",
    },
    runtime: {
      requestTimeoutMs: 30000,
      testTimeoutMs: 1200,

      // if true, run JS tests in Web Worker
      safeTests: true,

      // Phase 4.5 / 4.6 (used by SettingsPanel)
      allowScriptEnvWrites: true,
      showEnvToast: true,
      logEnvChanges: true,
      envToastMs: 3500,
    },
    ui: {
      // future
      autoScrollConsole: true,
      palette: "default",
    },
  };
}

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function pickBool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeSettings(input) {
  const def = getDefaultSettings();
  const s = isPlainObject(input) ? input : {};

  const out = {
    proxy: {
      mode: ["off", "manual", "system"].includes(s?.proxy?.mode) ? s.proxy.mode : def.proxy.mode,
      manualUrl: String(s?.proxy?.manualUrl || def.proxy.manualUrl),
      defaultRequestMode: ["direct", "proxy"].includes(s?.proxy?.defaultRequestMode)
        ? s.proxy.defaultRequestMode
        : def.proxy.defaultRequestMode,
    },
    runtime: {
      requestTimeoutMs: clampInt(s?.runtime?.requestTimeoutMs, def.runtime.requestTimeoutMs, 1000, 300000),
      testTimeoutMs: clampInt(s?.runtime?.testTimeoutMs, def.runtime.testTimeoutMs, 100, 30000),
      safeTests: pickBool(s?.runtime?.safeTests, def.runtime.safeTests),

      allowScriptEnvWrites: pickBool(s?.runtime?.allowScriptEnvWrites, def.runtime.allowScriptEnvWrites),
      showEnvToast: pickBool(s?.runtime?.showEnvToast, def.runtime.showEnvToast),
      logEnvChanges: pickBool(s?.runtime?.logEnvChanges, def.runtime.logEnvChanges),
      envToastMs: clampInt(s?.runtime?.envToastMs, def.runtime.envToastMs, 1200, 15000),
    },
    ui: {
      autoScrollConsole: pickBool(s?.ui?.autoScrollConsole, def.ui.autoScrollConsole),
      palette: String(s?.ui?.palette || def.ui.palette),
    },
  };

  // If proxy is off, make sure defaultRequestMode doesn't point to proxy.
  if (out.proxy.mode === "off") out.proxy.defaultRequestMode = "direct";

  return out;
}

export function loadSettings() {
  const def = getDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return def;
  }
}

export function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));

  // same-tab update
  window.dispatchEvent(new CustomEvent("bhejo_settings_changed", { detail: normalized }));

  return normalized;
}

export function resetSettings() {
  const def = getDefaultSettings();
  return saveSettings(def);
}

export function onSettingsChange(cb) {
  const handler = (e) => cb?.(e.detail);

  window.addEventListener("bhejo_settings_changed", handler);

  // multi-tab support
  const onStorage = (e) => {
    if (e.key === SETTINGS_KEY) cb?.(loadSettings());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("bhejo_settings_changed", handler);
    window.removeEventListener("storage", onStorage);
  };
}
