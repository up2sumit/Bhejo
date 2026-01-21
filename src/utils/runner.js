import { applyVarsToRequest } from "./vars";
import { runAssertions } from "./assertions";
import { applyAuthToHeaders } from "../components/AuthEditor";
import { pushConsoleEvent } from "./consoleBus";

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
  return s.length > n ? s.slice(0, n) + "…(truncated)" : s;
}

export async function runBatch({ requests, envVars, onProgress, signal }) {
  const results = [];

  const expanded = [];
  for (const req of requests || []) {
    const rows = Array.isArray(req.dataRows) ? req.dataRows : [];
    if (rows.length === 0) {
      expanded.push({ base: req, idx: null, total: 0, rowVars: {} });
    } else {
      rows.forEach((row, i) => {
        expanded.push({ base: req, idx: i, total: rows.length, rowVars: getRowVars(row) });
      });
    }
  }

  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    const req = item.base;

    const displayName =
      item.idx === null ? (req.name || "(unnamed)") : `${req.name || "(unnamed)"} [${item.idx + 1}/${item.total}]`;

    onProgress?.({ index: i, total: expanded.length, current: { ...req, name: displayName } });

    const traceId = uuid("trace"); // ✅ NEW: per iteration
    const start = performance.now();

    try {
      const mergedVars = { ...(envVars || {}), ...(item.rowVars || {}) };

      const finalDraft = applyVarsToRequest(
        {
          method: req.method,
          url: req.url,
          params: req.params || [{ key: "", value: "" }],
          headers: req.headers || [{ key: "", value: "" }],
          body: req.body || "",
          auth: req.auth || { type: "none" },
        },
        mergedVars
      );

      const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

      let headerObj = headersArrayToObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      const options = { method: finalDraft.method, headers: { ...headerObj }, signal };

      const hasBody = !["GET", "HEAD"].includes(finalDraft.method);
      if (hasBody) {
        const bodyText = (finalDraft.body || "").trim();
        if (bodyText.length > 0) {
          options.body = bodyText;
          const hasContentType = Object.keys(options.headers).some((k) => k.toLowerCase() === "content-type");
          if (!hasContentType) options.headers["Content-Type"] = "application/json";
        }
      }

      // ✅ Console: request with traceId
      pushConsoleEvent({
        level: "info",
        type: "request",
        data: {
          traceId,
          source: "runner",
          name: displayName,
          method: finalDraft.method,
          finalUrl,
          headers: headerObj,
          rowVars: item.rowVars || {},
          body: hasBody ? (finalDraft.body || "") : "",
        },
      });

      const res = await fetch(finalUrl, options);

      const status = res.status;
      const statusText = res.statusText || "";
      const headers = await readResponseHeaders(res);
      const rawText = await res.text();

      const end = performance.now();
      const timeMs = Math.round(end - start);

      const json = safeJsonParse(rawText);

      const tests = Array.isArray(req.tests) ? req.tests : [];
      const testReport = runAssertions({ tests, response: { status, timeMs, json } });

      const itemResult = {
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: true,
        status,
        statusText,
        timeMs,
        passed: testReport.passed,
        total: testReport.total,
        testReport,
        headers,
        rawText,
        json,
        iteration: item.idx === null ? null : item.idx + 1,
        iterationTotal: item.total || 0,
        rowVars: item.rowVars || {},
        finalUrl,
      };

      results.push(itemResult);

      // ✅ Console: response with traceId
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
          tests: { passed: testReport.passed, total: testReport.total },
        },
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      const errorMsg = err?.name === "AbortError" ? "Aborted" : (err?.message || "Failed");

      results.push({
        id: item.idx === null ? req.id : `${req.id}__row_${item.idx}`,
        baseId: req.id,
        name: displayName,
        ok: false,
        status: "ERR",
        timeMs,
        passed: 0,
        total: (req.tests || []).length,
        error: errorMsg,
        iteration: item.idx === null ? null : item.idx + 1,
        iterationTotal: item.total || 0,
        rowVars: item.rowVars || {},
      });

      // ✅ Console: error with traceId
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
