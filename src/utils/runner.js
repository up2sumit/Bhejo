// src/utils/runner.js
import { applyVarsToRequest } from "./vars";
import { runAssertions } from "./assertions";
import { applyAuthToHeaders } from "../components/AuthEditor";
import { pushConsoleEvent } from "./consoleBus";
import { runPreRequestScript } from "./scriptRuntime";

// ✅ Phase 4 (Option B): Safe mode JS tests in Web Worker
import { runTestScriptSafe as runTestScript } from "./testRuntimeSafe";

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

async function runPreRequestIfAny({ traceId, req, mergedVars, rowVars }) {
  const script = String(req.preRequestScript || "").trim();
  if (!script) {
    return { ok: true, requestOverride: null, mergedVarsOut: mergedVars };
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

  const mergedVarsOut = applyEnvDelta(mergedVars, res.envDelta || {});
  const requestOverride = res.request || null;

  return { ok: true, requestOverride, mergedVarsOut };
}

async function runViaProxy({ finalUrl, method, headersObj, bodyText, signal }) {
  const proxyRes = await fetch("http://localhost:3001/proxy", {
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

export async function runBatch({ requests, envVars, onProgress, signal }) {
  const results = [];

  // Expand into (request x dataRows)
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

    onProgress?.({ index: i, total: expanded.length, current: { ...req, name: displayName } });

    const traceId = uuid("trace");
    const start = performance.now();

    try {
      const mergedVarsBase = { ...(envVars || {}), ...(item.rowVars || {}) };

      // 1) Pre-request
      const pre = await runPreRequestIfAny({
        traceId,
        req,
        mergedVars: mergedVarsBase,
        rowVars: item.rowVars || {},
      });

      if (!pre.ok) {
        const end0 = performance.now();
        const timeMs0 = Math.round(end0 - start);

        const builderTotal = Array.isArray(req.tests) ? req.tests.length : 0;
        const scriptTotal = String(req.testScript || "").trim() ? 1 : 0;

        const payload = {
          meta: { at: Date.now(), source: "runner", requestName: displayName },
          builderReport: null,
          scriptReport: {
            passed: 0,
            total: scriptTotal,
            failed: scriptTotal,
            failures: [
              {
                name: "Pre-request failed",
                message: pre.error?.message || "Pre-request script failed",
              },
            ],
            logs: [],
            error: pre.error || null,
          },
        };

        // ✅ Phase 4.4: Save last test results for Tests tab
        try {
          localStorage.setItem("bhejo:lastTestResults", JSON.stringify(payload));
          window.dispatchEvent(new CustomEvent("bhejo:lastTestResults", { detail: payload }));
        } catch {}

        results.push({
          id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
          baseId: req.id,
          name: displayName,
          ok: false,
          status: "ERR",
          timeMs: timeMs0,
          passed: 0,
          total: builderTotal + scriptTotal,
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

      const mergedVars = pre.mergedVarsOut;

      // 2) Draft + overrides (if pre-request changed request)
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

      // 3) Apply {{vars}} using mergedVars (env + rowVars + envDelta)
      const finalDraft = applyVarsToRequest(draftForVars, mergedVars);
      const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

      // 4) Headers object + auth
      let headerObj = headersArrayToObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      const method = String(finalDraft.method || "GET").toUpperCase();
      const hasBody = !["GET", "HEAD"].includes(method);
      const bodyText = hasBody ? String(finalDraft.body || "") : "";

      // Default content-type if body exists
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

      // 5) Execute request
      let status, statusText, headers, rawText;

      if ((finalDraft.mode || "direct") === "proxy") {
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
      } else {
        const options = { method, headers: { ...headerObj }, signal };
        if (hasBody && bodyText.trim().length > 0) options.body = bodyText;

        const res = await fetch(finalUrl, options);
        status = res.status;
        statusText = res.statusText || "";
        headers = await readResponseHeaders(res);
        rawText = await res.text();
      }

      const end = performance.now();
      const timeMs = Math.round(end - start);

      const json = safeJsonParse(rawText);

      // 6) Builder tests (existing assertions list)
      const tests = Array.isArray(req.tests) ? req.tests : [];
      const testReport = runAssertions({ tests, response: { status, timeMs, json } });

      // 7) JS script tests (Phase 4)
      let scriptTestReport = null;
      const script = String(req.testScript || "").trim();
      if (script) {
        scriptTestReport = await runTestScript({
          script,
          response: {
            status,
            statusText,
            headers: headers || {},
            rawText,
            json,
            timeMs,
          },
          request: {
            method,
            url: finalDraft.url,
            finalUrl,
            headers: headerObj,
            body: hasBody ? bodyText : "",
            params: finalDraft.params,
          },
          env: mergedVars || {},
          iterationData: item.rowVars || {}, // ✅ Phase 4.3.3 wiring
          timeoutMs: 1500,
        });

        for (const l of scriptTestReport.logs || []) {
          pushConsoleEvent({
            level: l.type === "error" ? "error" : l.type === "warn" ? "warn" : "info",
            type: "testscript_log",
            data: { traceId, source: "runner", message: l.message },
          });
        }
      }

      // ✅ Phase 4.4: Save last test results for Tests tab (split view)
      try {
        const payload = {
          meta: { at: Date.now(), source: "runner", requestName: displayName },
          builderReport: testReport || null,
          scriptReport: scriptTestReport || null,
        };
        localStorage.setItem("bhejo:lastTestResults", JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("bhejo:lastTestResults", { detail: payload }));
      } catch {}

      const passed = (testReport?.passed || 0) + (scriptTestReport?.passed || 0);
      const total = (testReport?.total || 0) + (scriptTestReport?.total || 0);

      // 8) Save result
      const itemResult = {
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: true,
        status,
        statusText,
        timeMs,
        passed,
        total,
        testReport,
        scriptTestReport,
        headers,
        rawText,
        json,
        iteration: item.idx === null ? null : item.idx + 1,
        iterationTotal: item.total || 0,
        rowVars: item.rowVars || {},
        finalUrl,
      };

      results.push(itemResult);

      pushConsoleEvent({
        level: "info",
        type: "response",
        data: {
          traceId,
          source: "runner",
          name: displayName,
          status,
          timeMs,
          headers,
          body: shorten(rawText),
          tests: {
            passed,
            total,
            builder: { passed: testReport.passed, total: testReport.total },
            script: scriptTestReport
              ? { passed: scriptTestReport.passed, total: scriptTestReport.total }
              : { passed: 0, total: 0 },
          },
        },
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      const errorMsg = err?.name === "AbortError" ? "Aborted" : err?.message || "Failed";

      const builderTotal = Array.isArray(req.tests) ? req.tests.length : 0;
      const scriptTotal = String(req.testScript || "").trim() ? 1 : 0;

      // ✅ Phase 4.4: Save last test results for Tests tab on failure too
      try {
        const payload = {
          meta: { at: Date.now(), source: "runner", requestName: displayName },
          builderReport: null,
          scriptReport: {
            passed: 0,
            total: scriptTotal,
            failed: scriptTotal,
            failures: scriptTotal
              ? [{ name: "Script not executed", message: "Request failed before tests ran" }]
              : [],
            logs: [],
            error: { message: errorMsg },
          },
        };
        localStorage.setItem("bhejo:lastTestResults", JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("bhejo:lastTestResults", { detail: payload }));
      } catch {}

      results.push({
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: false,
        status: "ERR",
        timeMs,
        passed: 0,
        total: builderTotal + scriptTotal,
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
          message: errorMsg,
          rowVars: item.rowVars || {},
        },
      });

      if (err?.name === "AbortError") break;
    }
  }

  return results;
}
