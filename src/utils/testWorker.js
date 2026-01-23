// src/utils/testWorker.js
import { expect, assert } from "chai";

self.onmessage = async (e) => {
  const { id, script, response, request, env } = e.data || {};

  const results = [];
  const logs = [];
  const envDelta = {};
  const headerMap = normalizeHeaders(response?.headers);

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
        envDelta[key] = String(v);
      },
      unset: (k) => {
        const key = String(k || "").trim();
        if (!key) return;
        envDelta[key] = null;
      },
    },

    console: {
      log: (...a) => log("log", ...a),
      warn: (...a) => log("warn", ...a),
      error: (...a) => log("error", ...a),
    },
  };

  try {
    const wrapped = `"use strict";\n${String(script || "")}\n`;
    const fn = new Function("pm", "console", wrapped);
    fn(pm, pm.console);

    const settled = await Promise.all(
      results.map((r) =>
        Promise.resolve(r).catch((err) => ({
          name: "Unknown",
          ok: false,
          error: err?.message || String(err),
          ms: 0,
        }))
      )
    );

    const passed = settled.filter((t) => t.ok).length;
    const total = settled.length;

    self.postMessage({
      id,
      ok: true,
      report: { passed, total, tests: settled, logs, envDelta },
    });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      report: {
        passed: 0,
        total: 0,
        tests: [],
        logs: [
          ...logs,
          { type: "error", message: `Test script error: ${err?.message || err}` },
        ],
        envDelta,
      },
    });
  }

  function log(type, ...args) {
    logs.push({ type, message: args.map(String).join(" ") });
  }

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
};
