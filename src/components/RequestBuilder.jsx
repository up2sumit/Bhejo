import { useEffect, useRef, useState } from "react";
import HeadersEditor from "./HeadersEditor";
import BodyEditor from "./BodyEditor";
import QueryParamsEditor from "./QueryParamsEditor";
import AuthEditor, { applyAuthToHeaders } from "./AuthEditor";

function buildFinalUrl(baseUrl, params) {
  try {
    const urlObj = new URL(baseUrl);

    // Add/overwrite params
    for (const p of params) {
      const k = (p.key || "").trim();
      if (!k) continue;
      urlObj.searchParams.set(k, p.value ?? "");
    }

    return urlObj.toString();
  } catch {
    // If URL() fails (invalid), return base as-is
    return baseUrl;
  }
}

export default function RequestBuilder({ initial, onResponse, onSaveHistory }) {
  const [method, setMethod] = useState(initial?.method || "GET");
  const [url, setUrl] = useState(
    initial?.url || "https://jsonplaceholder.typicode.com/todos/1"
  );

  const [params, setParams] = useState(initial?.params || [{ key: "", value: "" }]);
  const [headers, setHeaders] = useState(initial?.headers || [{ key: "", value: "" }]);
  const [body, setBody] = useState(initial?.body || "");
  const [bodyError, setBodyError] = useState("");

  const [auth, setAuth] = useState(
    initial?.auth || { type: "none", bearer: "", username: "", password: "", apiKeyName: "x-api-key", apiKeyValue: "" }
  );

  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!initial) return;
    setMethod(initial.method || "GET");
    setUrl(initial.url || "");
    setParams(initial.params?.length ? initial.params : [{ key: "", value: "" }]);
    setHeaders(initial.headers?.length ? initial.headers : [{ key: "", value: "" }]);
    setBody(initial.body || "");
    setAuth(
      initial.auth || { type: "none", bearer: "", username: "", password: "", apiKeyName: "x-api-key", apiKeyValue: "" }
    );
    setBodyError("");
    onResponse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.savedAt]);

  const buildHeadersObject = () => {
    const obj = {};
    for (const h of headers) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    return obj;
  };

  const sendRequest = async () => {
    if (!url.trim()) {
      onResponse({ ok: false, timeMs: 0, errorName: "ValidationError", errorMessage: "URL is required" });
      return;
    }

    if (!["GET", "HEAD"].includes(method)) {
      if (body.trim().length > 0) {
        try {
          JSON.parse(body);
          setBodyError("");
        } catch {
          setBodyError("Invalid JSON body");
          onResponse({ ok: false, timeMs: 0, errorName: "ValidationError", errorMessage: "Fix invalid JSON before sending" });
          return;
        }
      }
    }

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const start = performance.now();
    setLoading(true);

    const finalUrl = buildFinalUrl(url, params);

    try {
      let headerObj = buildHeadersObject();
      headerObj = applyAuthToHeaders(auth, headerObj);

      const options = { method, headers: { ...headerObj }, signal: controller.signal };

      if (!["GET", "HEAD"].includes(method) && body.trim().length > 0) {
        options.body = body;

        const hasContentType = Object.keys(options.headers).some(
          (k) => k.toLowerCase() === "content-type"
        );
        if (!hasContentType) options.headers["Content-Type"] = "application/json";
      }

      const res = await fetch(finalUrl, options);
      const end = performance.now();
      const timeMs = Math.round(end - start);

      const rawText = await res.text();
      let parsedJson = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }

      const resHeaders = {};
      res.headers.forEach((value, key) => (resHeaders[key] = value));

      const responseObj = {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        timeMs,
        headers: resHeaders,
        rawText,
        json: parsedJson,
      };

      onResponse(responseObj);

      // Save history with last result meta
      onSaveHistory({
        method,
        url,
        params,
        headers,
        body,
        auth,
        savedAt: new Date().toISOString(),
        lastResult: { status: res.status, timeMs },
      });
    } catch (err) {
      const end = performance.now();
      const timeMs = Math.round(end - start);

      onResponse({ ok: false, timeMs, errorName: err?.name || "Error", errorMessage: err?.message || "Request failed" });

      onSaveHistory({
        method,
        url,
        params,
        headers,
        body,
        auth,
        savedAt: new Date().toISOString(),
        lastResult: { status: "ERR", timeMs },
      });
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  };

  const cancelRequest = () => controllerRef.current?.abort();

  const finalUrlPreview = buildFinalUrl(url, params);

  return (
    <div className="stack">
      <div className="row">
        <select
          className="select"
          style={{ maxWidth: 120 }}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/v1/users"
        />

        <button className="btn btnPrimary" onClick={sendRequest} disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>

        <button className="btn btnDanger" onClick={cancelRequest} disabled={!loading}>
          Cancel
        </button>
      </div>

      <div className="smallMuted">
        Final URL: <span style={{ fontFamily: "var(--mono)" }}>{finalUrlPreview}</span>
      </div>

      <QueryParamsEditor params={params} setParams={setParams} />
      <AuthEditor auth={auth} setAuth={setAuth} />
      <HeadersEditor headers={headers} setHeaders={setHeaders} />
      <BodyEditor method={method} body={body} setBody={setBody} bodyError={bodyError} setBodyError={setBodyError} />
    </div>
  );
}
