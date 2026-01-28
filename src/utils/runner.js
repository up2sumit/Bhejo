// src/utils/runner.js
// Phase 4 (Option B): Wire JS Tests (Safe mode = Web Worker + timeout)
// - Runs builder tests (runAssertions)
// - Runs Postman-like JS tests (req.testScript) via runTestScriptSafe
// - Applies env changes from BOTH pre-request script and JS test script across the run
// - Logs request/response/test logs to consoleBus with traceId

import { applyVarsToRequest } from "./vars";
import { runAssertions } from "./assertions";
import { applyAuthToHeaders } from "../components/AuthEditor";
import { pushConsoleEvent } from "./consoleBus";
import { runPreRequestScript } from "./scriptRuntime";

// ✅ Safe mode runtime
import { runTestScriptSafe as runTestScript } from "./testRuntimeSafe";

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "http://localhost:3001/proxy";
const AGENT_DEFAULT_BASE_URL = "http://127.0.0.1:3131";

function getAgentConfig() {
  try {
    const baseUrl = (localStorage.getItem("bhejo_agent_baseUrl") || AGENT_DEFAULT_BASE_URL).trim();
    const token = (localStorage.getItem("bhejo_agent_token") || "").trim();
    return { baseUrl: baseUrl || AGENT_DEFAULT_BASE_URL, token };
  } catch {
    return { baseUrl: AGENT_DEFAULT_BASE_URL, token: "" };
  }
}

function uuid(prefix = "id") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function buildFinalUrl(baseUrl, params) {
  try {
    const urlObj = new URL(baseUrl);
    for (const p of params || []) {
      const k = (p.key || "").trim();
      if (!k) continue;
      urlObj.searchParams.set(k, p.value ?? "");
    }
    return urlObj.toString();
  } catch {
    return baseUrl;
  }
}

function headersArrayToObject(hdrs) {
  const obj = {};
  for (const h of hdrs || []) {
    const k = (h.key || "").trim();
    if (!k) continue;
    obj[k] = h.value ?? "";
  }
  return obj;
}

async function readResponseHeaders(res) {
  const out = {};
  try {
    res.headers?.forEach?.((value, key) => {
      out[key] = value;
    });
  } catch {}
  return out;
}

function getRowVars(row) {
  if (!row) return {};
  if (row.vars && typeof row.vars === "object" && !Array.isArray(row.vars)) return row.vars;
  if (typeof row === "object" && !Array.isArray(row)) return row;
  return {};
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function shorten(str, n = 8000) {
  const s = String(str || "");
  return s.length > n ? s.slice(0, n) + "...(truncated)" : s;
}

function applyEnvDelta(baseVars, envDelta) {
  const out = { ...(baseVars || {}) };
  const delta = envDelta && typeof envDelta === "object" ? envDelta : {};
  for (const [k, v] of Object.entries(delta)) {
    if (v === null) delete out[k];
    else out[k] = String(v);
  }
  return out;
}

function applyEnvDeltaInPlace(targetObj, envDelta) {
  const delta = envDelta && typeof envDelta === "object" ? envDelta : {};
  for (const [k, v] of Object.entries(delta)) {
    if (v === null) delete targetObj[k];
    else targetObj[k] = String(v);
  }
}

async function runViaProxy({ finalUrl, method, headersObj, bodyText, signal }) {
  const proxyRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      url: finalUrl,
      method,
      headers: headersObj,
      body: bodyText || "",
    }),
  });

  const data = await proxyRes.json();
  if (!proxyRes.ok) throw new Error(data?.error || "Proxy error");

  return {
    status: data.status,
    statusText: data.statusText || "",
    headers: data.headers || {},
    rawText: data.body || "",
  };
}

async function runViaAgent({ finalUrl, method, headersObj, bodyText, signal }) {
  const { baseUrl, token } = getAgentConfig();
  if (!token) throw new Error("Agent token missing. Pair the agent from UI first.");

  const headersArr = Object.entries(headersObj || {}).map(([key, value]) => ({ key, value }));
  const payload = {
    method,
    url: finalUrl,
    headers: headersArr,
    body: !["GET", "HEAD"].includes(method)
      ? {
          mode: "raw",
          raw: bodyText || "",
          contentType: headersObj?.["Content-Type"] || headersObj?.["content-type"] || "",
        }
      : { mode: "none" },
  };

  const agentRes = await fetch(`${baseUrl.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bhejo-token": token },
    signal,
    body: JSON.stringify(payload),
  });

  const data = await agentRes.json().catch(() => null);
  if (!agentRes.ok || !data?.ok) {
    const msg = data?.error?.message || data?.message || "Agent error";
    throw new Error(msg);
  }

  const r = data.result || {};
  return {
    status: r.status,
    statusText: r.statusText || "",
    headers: r.headers || {},
    rawText: r.body || "",
    isBase64: !!r.isBase64,
    contentType: r.contentType || r.headers?.["content-type"] || "",
    sizeBytes: r.sizeBytes || 0,
    redirectChain: Array.isArray(r.redirectChain) ? r.redirectChain : [],
    finalUrl: r.finalUrl || finalUrl,
    proxySource: r.proxySource || "agent",
  };
}

/**
 * Runs pre-request script if any.
 * Returns:
 *  - requestOverride: possible request mutation
 *  - envDelta: changes to env
 *  - mergedVarsOut: the vars you should use for THIS request after envDelta applied
 */
async function runPreRequestIfAny({ traceId, req, mergedVars, rowVars }) {
  const script = String(req.preRequestScript || "").trim();
  if (!script) {
    return { ok: true, requestOverride: null, envDelta: {}, mergedVarsOut: mergedVars };
  }

  const ctx = {
    request: {
      method: req.method,
      url: req.url,
      params: req.params || [{ key: "", value: "" }],
      headers: req.headers || [{ key: "", value: "" }],
      body: req.body || "",
      auth: req.auth || { type: "none" },
      mode: req.mode || "direct",
    },
    env: { ...(mergedVars || {}) },
    data: { ...(rowVars || {}) },
  };

  const res = await runPreRequestScript(script, ctx);

  for (const l of res.logs || []) {
    pushConsoleEvent({
      level: l.level || "info",
      type: "prerequest",
      data: {
        traceId,
        source: "runner",
        at: l.at,
        args: l.args,
      },
    });
  }

  if (!res.ok) {
    pushConsoleEvent({
      level: "error",
      type: "prerequest_error",
      data: {
        traceId,
        source: "runner",
        name: req.name || "(unnamed)",
        errorName: res.error?.name || "ScriptError",
        errorMessage: res.error?.message || "Pre-request script failed",
      },
    });

    return {
      ok: false,
      error: res.error || { name: "ScriptError", message: "Pre-request script failed" },
    };
  }

  const envDelta = res.envDelta || {};
  const mergedVarsOut = applyEnvDelta(mergedVars, envDelta);
  const requestOverride = res.request || null;

  return { ok: true, requestOverride, envDelta, mergedVarsOut };
}

/**
 * Runner batch execution
 * - requests: array of saved request objects
 * - envVars: base environment object
 * - onProgress: callback
 * - signal: AbortSignal
 */
export async function runBatch({ requests, envVars, onProgress, signal }) {
  const results = [];

  // Persisted env across the whole run (Postman-like)
  const globalVars = { ...(envVars || {}) };

  // Expand data rows (iterations)
  const expanded = [];
  for (const req of requests || []) {
    const rows = Array.isArray(req.dataRows) ? req.dataRows : [];
    if (rows.length === 0) {
      expanded.push({ base: req, idx: null, total: 0, rowVars: {} });
    } else {
      rows.forEach((row, i) => {
        expanded.push({
          base: req,
          idx: i,
          total: rows.length,
          rowVars: getRowVars(row),
        });
      });
    }
  }

  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    const req = item.base;

    const displayName =
      item.idx === null
        ? req.name || "(unnamed)"
        : `${req.name || "(unnamed)"} [${item.idx + 1}/${item.total}]`;

    onProgress?.({
      index: i,
      total: expanded.length,
      current: { ...req, name: displayName },
    });

    const traceId = uuid("trace");
    const start = performance.now();

    let metaMethod = String(req.method || "GET").toUpperCase();
    let metaFinalUrl = String(req.url || "");

    try {
      // mergedVarsBase = global env + row vars (row vars only for this iteration)
      const mergedVarsBase = { ...globalVars, ...(item.rowVars || {}) };

      // 1) Pre-request script (can mutate request + env vars)
      const pre = await runPreRequestIfAny({
        traceId,
        req,
        mergedVars: mergedVarsBase,
        rowVars: item.rowVars || {},
      });

      if (!pre.ok) {
        const timeMs0 = Math.round(performance.now() - start);

        const structuredTotal = (req.tests || []).length;
        const scriptTotal = String(req.testScript || "").trim() ? 1 : 0;

        results.push({
          id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
          baseId: req.id,
          name: displayName,
          ok: false,
          status: "ERR",
          timeMs: timeMs0,
          passed: 0,
          total: structuredTotal + scriptTotal,
          error: pre.error?.message || "Pre-request script failed",
          iteration: item.idx === null ? null : item.idx + 1,
          iterationTotal: item.total || 0,
          rowVars: item.rowVars || {},
        });

        pushConsoleEvent({
          level: "error",
          type: "error",
          data: {
            traceId,
            source: "runner",
            name: displayName,
            message: pre.error?.message || "Pre-request script failed",
          },
        });

        continue;
      }

      // Apply pre-request envDelta to globalVars (persist across run)
      applyEnvDeltaInPlace(globalVars, pre.envDelta || {});

      // Vars to use for THIS request execution (after pre delta applied)
      const mergedVars = pre.mergedVarsOut;

      // Build draft (apply any request overrides from pre-request)
      const baseDraft = {
        method: req.method,
        url: req.url,
        params: req.params || [{ key: "", value: "" }],
        headers: req.headers || [{ key: "", value: "" }],
        body: req.body || "",
        auth: req.auth || { type: "none" },
        mode: req.mode || "direct",
      };

      const override = pre.requestOverride;
      const draftForVars = override
        ? {
            ...baseDraft,
            method: override.method || baseDraft.method,
            url: override.url ?? baseDraft.url,
            params: Array.isArray(override.params) ? override.params : baseDraft.params,
            headers: Array.isArray(override.headers) ? override.headers : baseDraft.headers,
            body: override.body ?? baseDraft.body,
            auth: override.auth ?? baseDraft.auth,
            mode: override.mode ?? baseDraft.mode,
          }
        : baseDraft;

      // Apply {{vars}} AFTER pre-request modifications
      const finalDraft = applyVarsToRequest(draftForVars, mergedVars);

      const resolvedTests = Array.isArray(finalDraft?.tests) ? finalDraft.tests : tests;

      const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

      metaMethod = String(finalDraft.method || metaMethod).toUpperCase();
      metaFinalUrl = finalUrl;

      let headerObj = headersArrayToObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      const method = String(finalDraft.method || "GET").toUpperCase();
      const hasBody = !["GET", "HEAD"].includes(method);
      const bodyText = hasBody ? String(finalDraft.body || "") : "";

      // Default Content-Type if body exists and not provided
      if (hasBody && bodyText.trim().length > 0) {
        const hasContentType = Object.keys(headerObj).some(
          (k) => k.toLowerCase() === "content-type"
        );
        if (!hasContentType) headerObj["Content-Type"] = "application/json";
      }

      pushConsoleEvent({
        level: "info",
        type: "request",
        data: {
          traceId,
          source: "runner",
          name: displayName,
          mode: finalDraft.mode || "direct",
          method,
          finalUrl,
          headers: headerObj,
          rowVars: item.rowVars || {},
          body: hasBody ? bodyText : "",
        },
      });

      // 2) Execute request (direct | proxy | agent)
      let status, statusText, headers, rawText;
      let isBase64 = false;
      let contentType = "";
      let sizeBytes = 0;
      let redirectChain = [];
      let finalResolvedUrl = finalUrl;
      let proxySource = "";

      const execMode = (finalDraft.mode || "direct").toLowerCase();

      if (execMode === "proxy") {
        const out = await runViaProxy({
          finalUrl,
          method,
          headersObj: headerObj,
          bodyText: hasBody ? bodyText : "",
          signal,
        });
        status = out.status;
        statusText = out.statusText;
        headers = out.headers;
        rawText = out.rawText;
      } else if (execMode === "agent") {
        const out = await runViaAgent({
          finalUrl,
          method,
          headersObj: headerObj,
          bodyText: hasBody ? bodyText : "",
          signal,
        });
        status = out.status;
        statusText = out.statusText;
        headers = out.headers;
        rawText = out.rawText;
        isBase64 = !!out.isBase64;
        contentType = out.contentType || "";
        sizeBytes = out.sizeBytes || 0;
        redirectChain = out.redirectChain || [];
        finalResolvedUrl = out.finalUrl || finalUrl;
        proxySource = out.proxySource || "agent";
      } else {
        const options = { method, headers: { ...headerObj }, signal };
        if (hasBody && bodyText.trim().length > 0) options.body = bodyText;

        const res = await fetch(finalUrl, options);
        status = res.status;
        statusText = res.statusText || "";
        headers = await readResponseHeaders(res);
        rawText = await res.text();
      }

      const timeMs = Math.round(performance.now() - start);
      const json = isBase64 ? null : safeJsonParse(rawText);

      // 3) Builder tests
      const tests = Array.isArray(req.tests) ? req.tests : [];
      const testReport = runAssertions({
              tests: resolvedTests,
        response: { status, timeMs, json, headers }, // ✅ include headers
      });

      // 4) JS test script (Safe mode)
      let scriptTestReport = null;
      const script = String(req.testScript || "").trim();

      if (script) {
        scriptTestReport = await runTestScript({
          script,
          response: { status, statusText, headers, rawText, json, timeMs },
          request: {
            ...finalDraft,
            finalUrl,
            headers: headerObj, // resolved headers used in call
            body: hasBody ? bodyText : "",
            params: finalDraft.params || [],
          },
          env: globalVars, // snapshot is sent to worker
          timeoutMs: 1500,
        });

        // log script console output
        for (const l of scriptTestReport.logs || []) {
          pushConsoleEvent({
            level: l.type === "error" ? "error" : l.type === "warn" ? "warn" : "info",
            type: "testscript_log",
            data: { traceId, source: "runner", name: displayName, message: l.message },
          });
        }

        // ✅ Apply envDelta from test script to global vars (persist across run)
        applyEnvDeltaInPlace(globalVars, scriptTestReport.envDelta || {});
      }

      const builderPassed = testReport.passed || 0;
      const builderTotal = testReport.total || 0;
      const scriptPassed = scriptTestReport?.passed || 0;
      const scriptTotal = scriptTestReport?.total || 0;

      const itemResult = {
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: true,
        status,
        statusText,
        timeMs,
        passed: builderPassed + scriptPassed,
        total: builderTotal + scriptTotal,
        testReport,
        scriptTestReport,
        headers,
        rawText,
        json,
        iteration: item.idx === null ? null : item.idx + 1,
        iterationTotal: item.total || 0,
        rowVars: item.rowVars || {},
        finalUrl: finalResolvedUrl,
        redirectChain,
        isBase64,
        contentType,
        sizeBytes,
        proxySource: execMode === "agent" ? proxySource || "agent" : execMode,
      };

      results.push(itemResult);

      pushConsoleEvent({
        level: "info",
        type: "response",
        data: {
          traceId,
          source: "runner",
          name: displayName,
          method: metaMethod,
          finalUrl: metaFinalUrl,
          status,
          timeMs,
          headers,
          body: shorten(rawText),
          tests: {
            builder: { passed: builderPassed, total: builderTotal },
            script: { passed: scriptPassed, total: scriptTotal },
            combined: { passed: builderPassed + scriptPassed, total: builderTotal + scriptTotal },
          },
        },
      });
    } catch (err) {
      const timeMs = Math.round(performance.now() - start);
      const errorMsg = err?.name === "AbortError" ? "Aborted" : err?.message || "Failed";

      const structuredTotal = (req.tests || []).length;
      const scriptTotal = String(req.testScript || "").trim() ? 1 : 0;

      results.push({
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: false,
        status: "ERR",
        timeMs,
        passed: 0,
        total: structuredTotal + scriptTotal,
        error: errorMsg,
        iteration: item.idx === null ? null : item.idx + 1,
        iterationTotal: item.total || 0,
        rowVars: item.rowVars || {},
      });

      pushConsoleEvent({
        level: errorMsg === "Aborted" ? "warn" : "error",
        type: "error",
        data: {
          traceId,
          source: "runner",
          name: displayName,
          method: metaMethod,
          finalUrl: metaFinalUrl,
          message: errorMsg,
          rowVars: item.rowVars || {},
        },
      });

      if (err?.name === "AbortError") break;
    }
  }

  return results;
}
