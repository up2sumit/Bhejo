// src/utils/testRuntime.js
// Phase 4.3.3 - Postman-like iteration + variables (baseline)
// Adds:
// - pm.iterationData.get/set/unset/toObject  (read-only by default; set/unset affect local iteration view only)
// - pm.variables.get/toObject (merged: iteration overrides env)
// Keeps:
// - pm.expect.fail, pm.fail
// - pm.response.to.have.* sugar
// - per-test results list

import * as chai from "chai";

function nowIso() {
  return new Date().toISOString();
}
function uuidv4() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function stringifyAny(v) {
  try {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || v.message || String(v);
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function withTimeout(promise, ms, onTimeout) {
  if (!ms || ms <= 0) return promise;
  let t = null;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      reject(new Error(`Test script timeout after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise.finally(() => t && clearTimeout(t)), timeout]);
}
function makeHeadersApi(headersObj) {
  const map = headersObj && typeof headersObj === "object" ? headersObj : {};
  return {
    get(name) {
      const target = String(name || "").toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (String(k).toLowerCase() === target) return String(v ?? "");
      }
      return "";
    },
    has(name) {
      return !!this.get(name);
    },
    all() {
      return { ...map };
    },
  };
}
function getJsonPath(obj, path) {
  const p = String(path || "").trim();
  if (!p) return { ok: false, value: undefined };

  const parts = [];
  p.split(".").forEach((seg) => {
    const s = seg.trim();
    if (!s) return;
    const re = /([^\[\]]+)|\[(\d+)\]/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) parts.push(m[1]);
      if (m[2] !== undefined) parts.push(Number(m[2]));
    }
  });

  let cur = obj;
  for (const key of parts) {
    if (cur == null) return { ok: false, value: undefined };
    cur = cur[key];
  }
  return { ok: true, value: cur };
}
function makeResponseSugar({ response }) {
  const status = response?.status;
  const headersApi = makeHeadersApi(response?.headers || {});
  const rawText = String(response?.rawText ?? "");
  const json = response?.json;

  const to = {
    have: {
      status(expected) {
        chai.expect(status, "response status").to.equal(expected);
      },
      header(name, contains) {
        const v = headersApi.get(name);
        chai.expect(v, `header "${name}"`).to.not.equal("");
        if (contains !== undefined) {
          chai.expect(v, `header "${name}"`).to.include(String(contains));
        }
      },
      jsonBody() {
        chai.expect(json, "response json").to.not.equal(null);
      },
      jsonPath(path, expected) {
        chai.expect(json, "response json").to.not.equal(null);
        const got = getJsonPath(json, path);
        chai.expect(got.ok, `jsonPath "${path}" exists`).to.equal(true);
        if (arguments.length >= 2) {
          chai.expect(got.value, `jsonPath "${path}"`).to.deep.equal(expected);
        }
      },
    },
    be: {
      get json() {
        chai.expect(json, "response json").to.not.equal(null);
        return true;
      },
    },
  };

  return {
    code: status,
    status: response?.statusText || "",
    time: response?.timeMs ?? 0,
    headers: headersApi,
    text() {
      return rawText;
    },
    json() {
      return json ?? null;
    },
    getBody() {
      return json ?? rawText ?? "";
    },
    to,
  };
}
function extendExpectWithFail(expectFn) {
  if (!expectFn.fail) {
    expectFn.fail = (msg = "Forced failure") => {
      throw new Error(String(msg));
    };
  }
  return expectFn;
}

function makeKeyValueApi(objRef, { allowWrites = true } = {}) {
  return {
    get(key) {
      return objRef[String(key)] ?? undefined;
    },
    set(key, value) {
      if (!allowWrites) return;
      const k = String(key || "");
      if (!k) return;
      objRef[k] = value === null ? null : String(value);
    },
    unset(key) {
      if (!allowWrites) return;
      const k = String(key || "");
      if (!k) return;
      delete objRef[k];
    },
    toObject() {
      return { ...(objRef || {}) };
    },
  };
}

function makePm({
  response,
  request,
  env,
  setEnv,
  logs,
  allowEnvWrites,
  iterationData,
}) {
  const tests = [];
  const iteration = { ...(iterationData || {}) }; // local copy (read-only in spirit)

  const logPush = (type, args) => {
    logs.push({
      type,
      message: args.map(stringifyAny).join(" "),
      at: nowIso(),
    });
  };
  const consoleProxy = {
    log: (...a) => logPush("log", a),
    info: (...a) => logPush("info", a),
    warn: (...a) => logPush("warn", a),
    error: (...a) => logPush("error", a),
  };

  // env writes -> real env via setEnv callback
  const envApi = {
    get(key) {
      return env?.[String(key)] ?? undefined;
    },
    set(key, value) {
      if (!allowEnvWrites) return;
      if (key && typeof key === "object") {
        setEnv?.(key);
        return;
      }
      const k = String(key || "");
      if (!k) return;
      setEnv?.(k, value);
    },
    unset(key) {
      if (!allowEnvWrites) return;
      const k = String(key || "");
      if (!k) return;
      setEnv?.(k, null);
    },
    toObject() {
      return { ...(env || {}) };
    },
  };

  // iterationData is read-only by default (but we allow local set for convenience)
  const iterationApi = makeKeyValueApi(iteration, { allowWrites: true });

  const variablesApi = {
    get(key) {
      const k = String(key || "");
      if (!k) return undefined;
      if (iteration[k] !== undefined) return iteration[k];
      return env?.[k] ?? undefined;
    },
    toObject() {
      return { ...(env || {}), ...(iteration || {}) };
    },
  };

  const pm = {
    fail(message = "Forced failure") {
      throw new Error(String(message));
    },

    test(name, fn) {
      const testName = String(name || "unnamed");
      const startedAt = performance.now();

      const record = {
        name: testName,
        pass: false,
        message: "",
        timeMs: 0,
      };

      const runOne = async () => {
        if (typeof fn === "function" && fn.length > 0) {
          return await new Promise((resolve, reject) => {
            let doneCalled = false;
            const done = (err) => {
              if (doneCalled) return;
              doneCalled = true;
              if (err) reject(err);
              else resolve(true);
            };
            try {
              fn(done);
            } catch (e) {
              reject(e);
            }
          });
        }

        const out = typeof fn === "function" ? fn() : undefined;
        if (out && typeof out.then === "function") await out;
        return true;
      };

      const promise = (async () => {
        try {
          await runOne();
          record.pass = true;
          record.message = "";
        } catch (e) {
          record.pass = false;
          record.message = e?.message || String(e);
        } finally {
          record.timeMs = Math.round(performance.now() - startedAt);
        }
      })();

      tests.push({ record, promise });
    },

    expect: extendExpectWithFail(chai.expect),
    assert: chai.assert,

    response: makeResponseSugar({ response }),

    request: {
      method: request?.method || "GET",
      url: request?.finalUrl || request?.url || "",
      headers: makeHeadersApi(request?.headersObj || request?.headers || {}),
      body: request?.body ?? "",
    },

    environment: envApi,
    env: envApi,
    globals: envApi,

    iterationData: iterationApi,
    variables: variablesApi,

    utils: {
      nowIso,
      uuid: uuidv4,
    },
  };

  return { pm, tests, consoleProxy };
}

export async function runTestScript({
  script,
  response,
  request,
  env,
  setEnv,
  timeoutMs = 1200,
  allowEnvWrites = true,
  iterationData = {},
}) {
  const startedAt = performance.now();
  const logs = [];
  const safeScript = String(script || "");

  let error = null;
  let timedOut = false;

  const { pm, tests, consoleProxy } = makePm({
    response,
    request,
    env,
    setEnv,
    logs,
    allowEnvWrites,
    iterationData,
  });

  const exec = async () => {
    const fn = new Function("pm", "console", `"use strict";\n${safeScript}\n`);
    const maybe = fn(pm, consoleProxy);
    if (maybe && typeof maybe.then === "function") await maybe;
    await Promise.allSettled(tests.map((t) => t.promise));
  };

  try {
    await withTimeout(exec(), timeoutMs, () => {
      timedOut = true;
    });
  } catch (e) {
    error = e?.message || String(e);
  }

  const results = tests.map((t) => t.record);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  return {
    ok: !error && !timedOut,
    passed,
    failed,
    total,
    results,
    logs,
    error,
    timedOut,
    timeMs: Math.round(performance.now() - startedAt),
  };
}
