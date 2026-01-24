// src/utils/scriptRuntime.js

function nowIso() {
  return new Date().toISOString();
}

function uuidv4() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function b64encode(str) {
  const s = String(str ?? "");
  return btoa(unescape(encodeURIComponent(s)));
}

function b64decode(str) {
  const s = String(str ?? "");
  return decodeURIComponent(escape(atob(s)));
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return fallback;
  }
}

function clampMs(ms, max = 60_000) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, max));
}

function withTimeout(promise, timeoutMs) {
  const t = clampMs(timeoutMs, 60_000);
  if (!t) return promise;

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Pre-request timeout after ${t}ms`));
    }, t);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Pre-request script runtime (Postman-like subset)
 *
 * @param {string} script
 * @param {object} ctx { request, env, data }
 * @param {object} opts { allowEnvWrites=true, timeoutMs=1500 }
 *
 * @returns { ok, request, envDelta, logs, error }
 */
export async function runPreRequestScript(script, ctx, opts = {}) {
  const source = String(script ?? "").trim();
  const allowEnvWrites = opts?.allowEnvWrites !== false;
  const timeoutMs = opts?.timeoutMs ?? 1500;

  if (!source) {
    return { ok: true, request: ctx.request, envDelta: {}, logs: [], error: null };
  }

  const logs = [];
  const envDelta = {};

  const consoleApi = {
    log: (...args) => logs.push({ level: "log", at: nowIso(), args }),
    info: (...args) => logs.push({ level: "info", at: nowIso(), args }),
    warn: (...args) => logs.push({ level: "warn", at: nowIso(), args }),
    error: (...args) => logs.push({ level: "error", at: nowIso(), args }),
  };

  // clone request so scripts mutate safely
  const req = JSON.parse(JSON.stringify(ctx.request || {}));
  const env = { ...(ctx.env || {}) };
  const data = { ...(ctx.data || {}) };

  const pm = {
    info: { eventName: "prerequest" },

    env: {
      get: (k) => env[String(k)],
      set: (k, v) => {
        if (!allowEnvWrites) return;
        const key = String(k);
        env[key] = String(v);
        envDelta[key] = String(v);
      },
      unset: (k) => {
        if (!allowEnvWrites) return;
        const key = String(k);
        delete env[key];
        envDelta[key] = null;
      },
      all: () => ({ ...env }),
    },

    data: {
      get: (k) => data[String(k)],
      all: () => ({ ...data }),
    },

    request: {
      get: () => req,
      setMethod: (m) => (req.method = String(m || "GET").toUpperCase()),
      setUrl: (u) => (req.url = String(u || "")),
      setHeader: (k, v) => {
        const key = String(k || "").trim();
        if (!key) return;
        if (!Array.isArray(req.headers)) req.headers = [];
        const ex = req.headers.find((h) => String(h.key).toLowerCase() === key.toLowerCase());
        if (ex) ex.value = String(v ?? "");
        else req.headers.push({ key, value: String(v ?? "") });
      },
      removeHeader: (k) => {
        const key = String(k || "").trim();
        if (!key || !Array.isArray(req.headers)) return;
        req.headers = req.headers.filter((h) => String(h.key).toLowerCase() !== key.toLowerCase());
      },
      setQueryParam: (k, v) => {
        const key = String(k || "").trim();
        if (!key) return;
        if (!Array.isArray(req.params)) req.params = [];
        const ex = req.params.find((p) => String(p.key).toLowerCase() === key.toLowerCase());
        if (ex) ex.value = String(v ?? "");
        else req.params.push({ key, value: String(v ?? "") });
      },
      setBody: (b) => (req.body = String(b ?? "")),
      json: {
        get: () => safeJsonParse(req.body, null),
        set: (obj) => {
          req.body = JSON.stringify(obj ?? null, null, 2);
          pm.request.setHeader("Content-Type", "application/json");
        },
      },
    },

    utils: {
      uuid: uuidv4,
      nowIso,
      b64encode,
      b64decode,
      jsonParse: safeJsonParse,
      sleep: (ms) => new Promise((r) => setTimeout(r, clampMs(ms, 10_000))),
    },
  };

  const wrapped = `
"use strict";
return (async function(pm, console){
${source}
}).call(null, pm, console);
`;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("pm", "console", wrapped);
    const out = fn(pm, consoleApi);
    if (out && typeof out.then === "function") {
      await withTimeout(out, timeoutMs);
    }
    return { ok: true, request: req, envDelta, logs, error: null };
  } catch (err) {
    return {
      ok: false,
      request: req,
      envDelta,
      logs,
      error: { name: err?.name || "ScriptError", message: err?.message || "Pre-request failed" },
    };
  }
}
