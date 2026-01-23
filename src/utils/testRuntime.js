// src/utils/testRuntime.js
import { expect, assert } from "chai";

/**
 * Postman-like JS tests (same-tab execution).
 * Warning: infinite loops (while(true) {}) can freeze the UI tab.
 *
 * Returns:
 * { passed, total, tests:[{name, ok, ms, error?}], logs:[{type,message}], envDelta:{...} }
 */
export async function runTestScript({
  script,
  response,
  request,
  env = {},
  setEnv, // optional: (k, v) => void  (if you want live env updates)
  timeoutMs = 1200, // only protects async waits, not infinite loops
}) {
  const results = [];
  const logs = [];
  const envDelta = {}; // report back what script changed

  const headerMap = normalizeHeaders(response?.headers);

  function log(type, ...args) {
    logs.push({ type, message: args.map(String).join(" ") });
  }

  const pm = {
    test(name, fn) {
      results.push(runOneTest(name, fn));
    },
    expect,
    assert,

    response: {
      code: response?.status ?? 0,
      status: response?.statusText ?? "",
      responseTime: response?.timeMs ?? 0,
      headers: {
        get: (k) => headerMap.get(k),
        all: () => Object.fromEntries(headerMap.entries()),
      },
      text: () => response?.rawText ?? "",
      json: () => response?.json,
    },

    request: {
      url: request?.finalUrl || request?.url || "",
      method: request?.method || "GET",
      headers: request?.headers || {},
      body: request?.body || "",
      params: request?.params || [],
    },

    environment: {
      get: (k) => env?.[k],
      set: (k, v) => {
        const key = String(k || "").trim();
        if (!key) return;
        const val = String(v);
        envDelta[key] = val;
        setEnv?.(key, val);
      },
      unset: (k) => {
        const key = String(k || "").trim();
        if (!key) return;
        envDelta[key] = null;
        setEnv?.(key, undefined);
      },
    },

    console: {
      log: (...a) => log("log", ...a),
      warn: (...a) => log("warn", ...a),
      error: (...a) => log("error", ...a),
    },
  };

  const wrapped = `"use strict";\n${String(script || "")}\n`;

  const exec = async () => {
    const fn = new Function("pm", "console", wrapped);
    fn(pm, pm.console);
    await Promise.all(results.map((r) => Promise.resolve(r)));
  };

  await Promise.race([
    exec(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Test script timed out")), timeoutMs)
    ),
  ]).catch((e) => {
    logs.push({ type: "error", message: `Test script error: ${e.message}` });
  });

  const settled = await Promise.all(
    results.map((r) =>
      Promise.resolve(r).catch((e) => ({
        name: "Unknown",
        ok: false,
        error: e?.message || String(e),
        ms: 0,
      }))
    )
  );

  const passed = settled.filter((t) => t.ok).length;
  const total = settled.length;

  return { passed, total, tests: settled, logs, envDelta };

  function runOneTest(name, fn) {
    return (async () => {
      const started = performance.now();
      try {
        const maybe = fn();
        if (maybe && typeof maybe.then === "function") await maybe;
        return { name, ok: true, ms: Math.round(performance.now() - started) };
      } catch (err) {
        return {
          name,
          ok: false,
          error: err?.message || String(err),
          ms: Math.round(performance.now() - started),
        };
      }
    })();
  }

  function normalizeHeaders(h) {
    const map = new Map();
    if (!h) return makeCIMap(map);

    if (Array.isArray(h)) {
      for (const [k, v] of h) map.set(String(k).toLowerCase(), String(v));
    } else if (typeof h === "object") {
      for (const k of Object.keys(h)) map.set(k.toLowerCase(), String(h[k]));
    }
    return makeCIMap(map);
  }

  function makeCIMap(map) {
    return {
      get: (k) => map.get(String(k).toLowerCase()),
      entries: () => map.entries(),
    };
  }
}
