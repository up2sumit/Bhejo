import { useEffect, useMemo, useRef, useState } from "react";
import HeadersEditor from "./HeadersEditor";
import BodyEditor from "./BodyEditor";
import QueryParamsEditor from "./QueryParamsEditor";
import AuthEditor, { applyAuthToHeaders } from "./AuthEditor";
import TestsEditor from "./TestsEditor";

import { applyVarsToRequest } from "../utils/vars";
import { runAssertions } from "../utils/assertions";

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function buildFinalUrl(baseUrl, params) {
  try {
    const urlObj = new URL(baseUrl);
    for (const p of params) {
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
    const path =
      u.pathname?.split("/").filter(Boolean).slice(0, 2).join("/") || "request";
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

  // Tests (Phase 1.9)
  const [tests, setTests] = useState(initial?.tests || []);

  // Request name (always visible)
  const [requestName, setRequestName] = useState("");
  const [saveError, setSaveError] = useState("");

  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  // Tabs
  const [tab, setTab] = useState("params"); // params | auth | headers | body | tests

  // Send mode
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
    setTests(initial.tests || []);

    const loadedName = (initial?.name || "").trim();
    setRequestName(loadedName);
    setSaveError("");

    setBodyError("");
    setTab("params");
    onResponse(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.savedAt]);

  // Auto-suggest a name if empty
  useEffect(() => {
    if (requestName.trim()) return;
    // Replace any {{var}} to make suggestion stable
    const safeUrl = (url || "").replace(/\{\{\s*.*?\s*\}\}/g, "var");
    setRequestName(suggestName(method, safeUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, url]);

  // Apply environment variables to request for runtime execution
  const finalDraft = useMemo(() => {
    return applyVarsToRequest(
      {
        method,
        url,
        params,
        headers,
        body,
        auth,
      },
      envVars
    );
  }, [method, url, params, headers, body, auth, envVars]);

  const finalUrlPreview = useMemo(() => {
    return buildFinalUrl(finalDraft.url, finalDraft.params);
  }, [finalDraft]);

  const envBadge = useMemo(() => {
    const v = envVars || {};
    const baseUrl = (v.baseUrl || "").trim();
    return `Env: ${envName}${baseUrl ? ` • ${baseUrl}` : ""}`;
  }, [envName, envVars]);

  const validate = () => {
    const urlAfterVars = (finalDraft.url || "").trim();
    if (!urlAfterVars) {
      onResponse?.({
        ok: false,
        timeMs: 0,
        errorName: "ValidationError",
        errorMessage: "URL is required",
      });
      return false;
    }

    if (!["GET", "HEAD"].includes(method)) {
      if ((finalDraft.body || "").trim().length > 0) {
        try {
          JSON.parse(finalDraft.body);
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
    for (const h of hdrs) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    return obj;
  };

  const sendRequest = async () => {
    if (!validate()) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const start = performance.now();
    setLoading(true);

    const finalUrl = buildFinalUrl(finalDraft.url, finalDraft.params);

    try {
      let headerObj = buildHeadersObject(finalDraft.headers);
      headerObj = applyAuthToHeaders(finalDraft.auth, headerObj);

      let resStatus, resStatusText, resHeaders, rawText;

      if (mode === "direct") {
        const options = {
          method,
          headers: { ...headerObj },
          signal: controller.signal,
        };

        if (
          !["GET", "HEAD"].includes(method) &&
          (finalDraft.body || "").trim().length > 0
        ) {
          options.body = finalDraft.body;

          const hasContentType = Object.keys(options.headers).some(
            (k) => k.toLowerCase() === "content-type"
          );
          if (!hasContentType) options.headers["Content-Type"] = "application/json";
        }

        const res = await fetch(finalUrl, options);
        resStatus = res.status;
        resStatusText = res.statusText;

        const rHeaders = {};
        res.headers.forEach((value, key) => (rHeaders[key] = value));
        resHeaders = rHeaders;

        rawText = await res.text();
      } else {
        // Proxy mode
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

      // Run assertions (Phase 1.9)
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

      // Save to history using TEMPLATE values (keep {{vars}})
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
        savedAt: new Date().toISOString(),
        lastResult: {
          status: resStatus,
          timeMs,
          passed: testReport.passed,
          total: testReport.total,
        },
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      onResponse?.({
        ok: false,
        timeMs,
        errorName: err?.name || "Error",
        errorMessage: err?.message || "Request failed",
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
        savedAt: new Date().toISOString(),
        lastResult: {
          status: "ERR",
          timeMs,
          passed: 0,
          total: tests?.length || 0,
        },
      });
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  };

  const cancelRequest = () => controllerRef.current?.abort();

  const saveRequest = () => {
    if (!validate()) return;

    const name = (requestName || "").trim();
    if (!name) {
      setSaveError("Please enter a request name.");
      return;
    }
    setSaveError("");

    // Save TEMPLATE values (keep {{vars}})
    onSaveRequest?.({
      name,
      method,
      url,
      params,
      headers,
      body,
      auth,
      tests,
    });
  };

  return (
    <div className="stack">
      {/* Name row */}
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

      {/* Request row */}
      <div className="row">
        <select
          className="select"
          style={{ maxWidth: 120 }}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="{{baseUrl}}/api/books"
        />

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

      {/* Final URL + Mode */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="smallMuted">
          Final URL:{" "}
          <span style={{ fontFamily: "var(--mono)" }}>{finalUrlPreview}</span>
        </div>

        <div className="tabs">
          <button
            className={`tab ${mode === "proxy" ? "tabActive" : ""}`}
            onClick={() => setMode("proxy")}
          >
            Proxy
          </button>
          <button
            className={`tab ${mode === "direct" ? "tabActive" : ""}`}
            onClick={() => setMode("direct")}
          >
            Direct
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${tab === "params" ? "tabActive" : ""}`}
          onClick={() => setTab("params")}
        >
          Params
        </button>
        <button
          className={`tab ${tab === "auth" ? "tabActive" : ""}`}
          onClick={() => setTab("auth")}
        >
          Auth
        </button>
        <button
          className={`tab ${tab === "headers" ? "tabActive" : ""}`}
          onClick={() => setTab("headers")}
        >
          Headers
        </button>
        <button
          className={`tab ${tab === "body" ? "tabActive" : ""}`}
          onClick={() => setTab("body")}
        >
          Body
        </button>
        <button
          className={`tab ${tab === "tests" ? "tabActive" : ""}`}
          onClick={() => setTab("tests")}
        >
          Tests
        </button>
      </div>

      {/* Tab content */}
      {tab === "params" && <QueryParamsEditor params={params} setParams={setParams} />}
      {tab === "auth" && <AuthEditor auth={auth} setAuth={setAuth} />}
      {tab === "headers" && <HeadersEditor headers={headers} setHeaders={setHeaders} />}
      {tab === "body" && (
        <BodyEditor
          method={method}
          body={body}
          setBody={setBody}
          bodyError={bodyError}
          setBodyError={setBodyError}
        />
      )}
      {tab === "tests" && <TestsEditor tests={tests} setTests={setTests} />}

      <div className="smallMuted">
        Tip: Use <span style={{ fontFamily: "var(--mono)" }}>{"{{baseUrl}}"}</span> in the URL and set it in Env → Variables.
      </div>
    </div>
  );
}
