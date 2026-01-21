import { useEffect, useMemo, useRef, useState } from "react";
import HeadersEditor from "./HeadersEditor";
import BodyEditor from "./BodyEditor";
import QueryParamsEditor from "./QueryParamsEditor";
import AuthEditor, { applyAuthToHeaders } from "./AuthEditor";
import TestsEditor from "./TestsEditor";
import DataEditor from "./DataEditor";

import { applyVarsToRequest } from "../utils/vars";
import { runAssertions } from "../utils/assertions";
import { pushConsoleEvent } from "../utils/consoleBus";

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

function suggestName(method, url) {
  try {
    const u = new URL(url);
    const path = u.pathname?.split("/").filter(Boolean).slice(0, 2).join("/") || "request";
    return `${method} ${u.hostname}/${path}`;
  } catch {
    return `${method} request`;
  }
}

export default function RequestBuilder({
  initial,
  onResponse,
  onSaveHistory,
  onSaveRequest,
  envName,
  envVars,
}) {
  const [method, setMethod] = useState(initial?.method || "GET");
  const [url, setUrl] = useState(initial?.url || "{{baseUrl}}/todos/1");

  const [params, setParams] = useState(initial?.params || [{ key: "", value: "" }]);
  const [headers, setHeaders] = useState(initial?.headers || [{ key: "", value: "" }]);

  const [body, setBody] = useState(initial?.body || "");
  const [bodyError, setBodyError] = useState("");

  const [auth, setAuth] = useState(
    initial?.auth || {
      type: "none",
      bearer: "",
      username: "",
      password: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
    }
  );

  const [tests, setTests] = useState(initial?.tests || []);
  const [dataRows, setDataRows] = useState(initial?.dataRows || []);

  const [requestName, setRequestName] = useState("");
  const [saveError, setSaveError] = useState("");

  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  const [tab, setTab] = useState("params"); // params | auth | headers | body | tests | data
  const [mode, setMode] = useState("direct"); // direct | proxy

  useEffect(() => {
    if (!initial) return;

    setMethod(initial.method || "GET");
    setUrl(initial.url || "");
    setParams(initial.params?.length ? initial.params : [{ key: "", value: "" }]);
    setHeaders(initial.headers?.length ? initial.headers : [{ key: "", value: "" }]);
    setBody(initial.body || "");
    setAuth(
      initial.auth || {
        type: "none",
        bearer: "",
        username: "",
        password: "",
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      }
    );
    setTests(Array.isArray(initial.tests) ? initial.tests : []);
    setDataRows(Array.isArray(initial.dataRows) ? initial.dataRows : []);

    setBodyError("");
    setSaveError("");

    const loadedName = (initial?.name || "").trim();
    setRequestName(loadedName);

    setTab("params");
    onResponse?.(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.savedAt]);

  useEffect(() => {
    if (requestName.trim()) return;
    const safeUrl = (url || "").replace(/\{\{\s*.*?\s*\}\}/g, "var");
    setRequestName(suggestName(method, safeUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, url]);

  const finalDraft = useMemo(() => {
    return applyVarsToRequest({ method, url, params, headers, body, auth }, envVars);
  }, [method, url, params, headers, body, auth, envVars]);

  const finalUrlPreview = useMemo(() => buildFinalUrl(finalDraft.url, finalDraft.params), [finalDraft]);

  const envBadge = useMemo(() => {
    const v = envVars || {};
    const baseUrl = (v.baseUrl || "").trim();
    return `Env: ${envName}${baseUrl ? ` • ${baseUrl}` : ""}`;
  }, [envName, envVars]);

  const validate = () => {
    const urlAfterVars = (finalDraft.url || "").trim();
    if (!urlAfterVars) {
      onResponse?.({ ok: false, timeMs: 0, errorName: "ValidationError", errorMessage: "URL is required" });
      return false;
    }

    if (!["GET", "HEAD"].includes(method)) {
      const b = (finalDraft.body || "").trim();
      if (b.length > 0) {
        try {
          JSON.parse(b);
          setBodyError("");
        } catch {
          setBodyError("Invalid JSON body");
          onResponse?.({
            ok: false,
            timeMs: 0,
            errorName: "ValidationError",
            errorMessage: "Fix invalid JSON before sending/saving",
          });
          return false;
        }
      }
    }
    return true;
  };

  const buildHeadersObject = (hdrs) => {
    const obj = {};
    for (const h of hdrs || []) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    return obj;
  };

  const cancelRequest = () => controllerRef.current?.abort();

  const sendRequest = async () => {
    if (!validate()) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const traceId = uuid("trace"); // ✅ NEW
    const start = performance.now();
    setLoading(true);

    const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

    try {
      let headerObj = buildHeadersObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      // ✅ Console: request (with traceId)
      pushConsoleEvent({
        level: "info",
        type: "request",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          mode,
          method,
          finalUrl,
          headers: headerObj,
          body: !["GET", "HEAD"].includes(method) ? (finalDraft.body || "") : "",
        },
      });

      let resStatus, resStatusText, resHeaders, rawText;

      if (mode === "direct") {
        const options = { method, headers: { ...headerObj }, signal: controller.signal };

        if (!["GET", "HEAD"].includes(method)) {
          const b = (finalDraft.body || "").trim();
          if (b.length > 0) {
            options.body = finalDraft.body;

            const hasContentType = Object.keys(options.headers).some((k) => k.toLowerCase() === "content-type");
            if (!hasContentType) options.headers["Content-Type"] = "application/json";
          }
        }

        const res = await fetch(finalUrl, options);
        resStatus = res.status;
        resStatusText = res.statusText;

        const rHeaders = {};
        res.headers.forEach((value, key) => (rHeaders[key] = value));
        resHeaders = rHeaders;

        rawText = await res.text();
      } else {
        const proxyRes = await fetch("http://localhost:3001/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            url: finalUrl,
            method,
            headers: headerObj,
            body: !["GET", "HEAD"].includes(method) ? (finalDraft.body || "") : "",
          }),
        });

        const data = await proxyRes.json();
        if (!proxyRes.ok) throw new Error(data?.error || "Proxy error");

        resStatus = data.status;
        resStatusText = data.statusText || "";
        resHeaders = data.headers || {};
        rawText = data.body || "";
      }

      const end = performance.now();
      const timeMs = Math.round(end - start);

      let parsedJson = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }

      const testReport = runAssertions({
        tests,
        response: { status: resStatus, timeMs, json: parsedJson },
      });

      onResponse?.({
        ok: true,
        status: resStatus,
        statusText: resStatusText,
        timeMs,
        headers: resHeaders,
        rawText,
        json: parsedJson,
        testReport,
      });

      // ✅ Console: response (with traceId)
      pushConsoleEvent({
        level: "info",
        type: "response",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          status: resStatus,
          timeMs,
          headers: resHeaders,
          body: rawText,
          tests: { passed: testReport.passed, total: testReport.total },
        },
      });

      onSaveHistory?.({
        id: initial?.id || uuid(),
        name: (requestName || "").trim(),
        method,
        url,
        params,
        headers,
        body,
        auth,
        tests,
        dataRows,
        savedAt: new Date().toISOString(),
        lastResult: { status: resStatus, timeMs, passed: testReport.passed, total: testReport.total },
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      onResponse?.({ ok: false, timeMs, errorName: err?.name || "Error", errorMessage: err?.message || "Request failed" });

      // ✅ Console: error (with traceId)
      pushConsoleEvent({
        level: err?.name === "AbortError" ? "warn" : "error",
        type: "error",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          message: err?.name === "AbortError" ? "Aborted" : (err?.message || "Request failed"),
        },
      });

      onSaveHistory?.({
        id: initial?.id || uuid(),
        name: (requestName || "").trim(),
        method,
        url,
        params,
        headers,
        body,
        auth,
        tests,
        dataRows,
        savedAt: new Date().toISOString(),
        lastResult: { status: "ERR", timeMs, passed: 0, total: tests?.length || 0 },
      });
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  };

  const saveRequest = () => {
    if (!validate()) return;

    const name = (requestName || "").trim();
    if (!name) {
      setSaveError("Please enter a request name.");
      return;
    }
    setSaveError("");

    onSaveRequest?.({
      id: initial?.id,
      name,
      method,
      url,
      params,
      headers,
      body,
      auth,
      tests,
      dataRows,
    });
  };

  return (
    <div className="stack">
      <div className="row">
        <input
          className="input"
          value={requestName}
          onChange={(e) => setRequestName(e.target.value)}
          placeholder="Request name (e.g. Get Books - Dev)"
        />
        <span className="badge">{envBadge}</span>
      </div>

      {saveError ? (
        <div className="smallMuted" style={{ color: "var(--danger)" }}>
          {saveError}
        </div>
      ) : null}

      <div className="row">
        <select className="select" style={{ maxWidth: 120 }} value={method} onChange={(e) => setMethod(e.target.value)}>
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="{{baseUrl}}/api/books/{{id}}" />

        <button className="btn btnPrimary" onClick={sendRequest} disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>

        <button className="btn btnSm" onClick={saveRequest} disabled={loading}>
          Save
        </button>

        <button className="btn btnDanger" onClick={cancelRequest} disabled={!loading}>
          Cancel
        </button>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="smallMuted">
          Final URL: <span style={{ fontFamily: "var(--mono)" }}>{finalUrlPreview}</span>
        </div>

        <div className="tabs">
          <button className={`tab ${mode === "direct" ? "tabActive" : ""}`} onClick={() => setMode("direct")}>
            Direct
          </button>
          <button className={`tab ${mode === "proxy" ? "tabActive" : ""}`} onClick={() => setMode("proxy")}>
            Proxy
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "params" ? "tabActive" : ""}`} onClick={() => setTab("params")}>
          Params
        </button>
        <button className={`tab ${tab === "auth" ? "tabActive" : ""}`} onClick={() => setTab("auth")}>
          Auth
        </button>
        <button className={`tab ${tab === "headers" ? "tabActive" : ""}`} onClick={() => setTab("headers")}>
          Headers
        </button>
        <button className={`tab ${tab === "body" ? "tabActive" : ""}`} onClick={() => setTab("body")}>
          Body
        </button>
        <button className={`tab ${tab === "tests" ? "tabActive" : ""}`} onClick={() => setTab("tests")}>
          Tests
        </button>
        <button className={`tab ${tab === "data" ? "tabActive" : ""}`} onClick={() => setTab("data")}>
          Data
        </button>
      </div>

      {tab === "params" && <QueryParamsEditor params={params} setParams={setParams} />}
      {tab === "auth" && <AuthEditor auth={auth} setAuth={setAuth} />}
      {tab === "headers" && <HeadersEditor headers={headers} setHeaders={setHeaders} />}
      {tab === "body" && <BodyEditor method={method} body={body} setBody={setBody} bodyError={bodyError} setBodyError={setBodyError} />}
      {tab === "tests" && <TestsEditor tests={tests} setTests={setTests} />}
      {tab === "data" && <DataEditor rows={dataRows} setRows={setDataRows} />}

      <div className="smallMuted">
        Tip: Env vars work on Send. Data rows run via Runner. Use{" "}
        <span style={{ fontFamily: "var(--mono)" }}>{"{{var}}"}</span> format.
      </div>
    </div>
  );
}
