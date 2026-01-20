import { applyVarsToRequest } from "./vars";
import { runAssertions } from "./assertions";
import { applyAuthToHeaders } from "../components/AuthEditor";

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
  } catch {
    // ignore
  }
  return out;
}

// DIRECT runner (no proxy)
export async function runBatch({ requests, envVars, onProgress, signal }) {
  const results = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    onProgress?.({ index: i, total: requests.length, current: req });

    const start = performance.now();

    try {
      const finalDraft = applyVarsToRequest(
        {
          method: req.method,
          url: req.url,
          params: req.params || [{ key: "", value: "" }],
          headers: req.headers || [{ key: "", value: "" }],
          body: req.body || "",
          auth: req.auth || { type: "none" },
        },
        envVars
      );

      const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

      let headerObj = headersArrayToObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      const options = {
        method: finalDraft.method,
        headers: { ...headerObj },
        signal,
      };

      if (!["GET", "HEAD"].includes(finalDraft.method)) {
        const bodyText = (finalDraft.body || "").trim();
        if (bodyText.length > 0) {
          options.body = bodyText;

          const hasContentType = Object.keys(options.headers).some(
            (k) => k.toLowerCase() === "content-type"
          );
          if (!hasContentType) options.headers["Content-Type"] = "application/json";
        }
      }

      const res = await fetch(finalUrl, options);

      const status = res.status;
      const statusText = res.statusText || "";
      const headers = await readResponseHeaders(res);

      const rawText = await res.text();

      const end = performance.now();
      const timeMs = Math.round(end - start);

      let parsedJson = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }

      const tests = req.tests || [];
      const testReport = runAssertions({
        tests,
        response: { status, timeMs, json: parsedJson },
      });

      results.push({
        id: req.id,
        name: req.name || "(unnamed)",
        ok: true,
        status,
        statusText,
        timeMs,
        passed: testReport.passed,
        total: testReport.total,
        testReport,
        headers,
        rawText,
        json: parsedJson,
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      results.push({
        id: req.id,
        name: req.name || "(unnamed)",
        ok: false,
        status: "ERR",
        timeMs,
        passed: 0,
        total: (req.tests || []).length,
        error: err?.message || "Failed",
      });
    }
  }

  return results;
}
