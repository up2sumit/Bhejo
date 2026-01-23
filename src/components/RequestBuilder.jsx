// src/components/RequestBuilder.jsx
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
import { toCurl, toFetch, toAxios } from "../utils/codegen";
import { runPreRequestScript } from "../utils/scriptRuntime";
import { importSnippet } from "../utils/snippetImport";
import {
  loadCollectionTrees,
  upsertCollectionTreeRequestUnderFolder,
} from "../utils/storage";

// ✅ Phase 4 (Option B): Safe mode JS tests in Web Worker
import { runTestScriptSafe as runTestScript } from "../utils/testRuntimeSafe";

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "http://localhost:3001/proxy";

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
    const path =
      u.pathname?.split("/").filter(Boolean).slice(0, 2).join("/") || "request";
    return `${method} ${u.hostname}/${path}`;
  } catch {
    return `${method} request`;
  }
}

async function copyToClipboard(text) {
  const t = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function ensureKvRows(arr) {
  const a = Array.isArray(arr) ? arr : [];
  if (!a.length) return [{ key: "", value: "" }];
  const hasBlank = a.some((x) => !String(x?.key || "") && !String(x?.value || ""));
  return hasBlank ? a : [...a, { key: "", value: "" }];
}

function previewHeaderRows(headers, max = 6) {
  const list = Array.isArray(headers) ? headers : [];
  const clean = list
    .map((h) => ({ key: String(h?.key || "").trim(), value: String(h?.value ?? "") }))
    .filter((h) => h.key);
  return clean.slice(0, max);
}

function getHeaderValue(headers, name) {
  const target = String(name || "").toLowerCase();
  for (const h of headers || []) {
    const k = String(h?.key || "").trim().toLowerCase();
    if (k === target) return String(h?.value ?? "");
  }
  return "";
}

function removeHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  const list = Array.isArray(headers) ? headers : [];
  return list.filter((h) => String(h?.key || "").trim().toLowerCase() !== target);
}

function isProbablyBase64(s) {
  const t = String(s || "").trim();
  if (!t || t.length < 12) return false;
  return /^[A-Za-z0-9+/=]+$/.test(t);
}

function detectAuthFromHeaders(headers) {
  const authLine = getHeaderValue(headers, "authorization").trim();
  if (!authLine) return { auth: { type: "none" }, cleanedHeaders: headers };

  const lower = authLine.toLowerCase();

  // Bearer
  if (lower.startsWith("bearer ")) {
    const token = authLine.slice(7).trim();
    const cleanedHeaders = removeHeader(headers, "authorization");
    return {
      auth: {
        type: "bearer",
        bearer: token,
        username: "",
        password: "",
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },
      cleanedHeaders,
    };
  }

  // Basic
  if (lower.startsWith("basic ")) {
    const b64 = authLine.slice(6).trim();
    let username = "";
    let password = "";

    try {
      if (isProbablyBase64(b64)) {
        const decoded = atob(b64);
        const idx = decoded.indexOf(":");
        if (idx !== -1) {
          username = decoded.slice(0, idx);
          password = decoded.slice(idx + 1);
        }
      }
    } catch {
      // ignore decode errors
    }

    const cleanedHeaders = removeHeader(headers, "authorization");
    return {
      auth: {
        type: "basic",
        bearer: "",
        username,
        password,
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },
      cleanedHeaders,
    };
  }

  // Unknown authorization scheme -> keep header (safe)
  return { auth: { type: "none" }, cleanedHeaders: headers };
}

function safeTreeLabel(node) {
  return String(node?.name || node?.title || node?.label || node?.id || "Unnamed");
}

function findFirstFolderInCollection(collection) {
  const children = Array.isArray(collection?.children) ? collection.children : [];
  const folder = children.find((c) => c?.kind === "folder");
  return folder || null;
}

function buildCollectionOptions(trees) {
  const list = Array.isArray(trees) ? trees : [];
  return list.map((c) => ({
    id: c.id,
    name: safeTreeLabel(c),
    firstFolderId: findFirstFolderInCollection(c)?.id || "",
  }));
}

function computeDefaultImportTarget(trees) {
  const options = buildCollectionOptions(trees);
  if (!options.length) {
    return { collectionId: "", folderId: "" };
  }
  const first = options[0];
  return { collectionId: first.id, folderId: first.firstFolderId || "" };
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
  // ✅ Phase 4: JS test script (Postman-like)
  const [testScript, setTestScript] = useState(initial?.testScript || "");
  const [dataRows, setDataRows] = useState(initial?.dataRows || []);

  // Phase 4: pre-request script
  const [preRequestScript, setPreRequestScript] = useState(initial?.preRequestScript || "");

  const [requestName, setRequestName] = useState("");
  const [saveError, setSaveError] = useState("");

  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  const [tab, setTab] = useState("params");
  const [mode, setMode] = useState(initial?.mode || "direct");

  // Copy as
  const [copyFormat, setCopyFormat] = useState("curl");
  const [copyMsg, setCopyMsg] = useState("");
  const copyMsgTimerRef = useRef(null);

  // Phase 4.2: Import modal + preview + save to collections
  const [importOpen, setImportOpen] = useState(false);
  const [importHint, setImportHint] = useState("auto");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const importTextRef = useRef(null);

  // 4.2.5 target: save imported into collections
  const [importSaveToCollections, setImportSaveToCollections] = useState(true);
  const [importTrees, setImportTrees] = useState([]);
  const [importCollectionId, setImportCollectionId] = useState("");
  const [importFolderId, setImportFolderId] = useState("");
  const [importSaveMsg, setImportSaveMsg] = useState("");

  const setCopyMessage = (msg) => {
    setCopyMsg(msg);
    if (copyMsgTimerRef.current) clearTimeout(copyMsgTimerRef.current);
    copyMsgTimerRef.current = setTimeout(() => setCopyMsg(""), 1600);
  };

  useEffect(() => {
    return () => {
      if (copyMsgTimerRef.current) clearTimeout(copyMsgTimerRef.current);
    };
  }, []);

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
    setTestScript(initial.testScript || "");
    setDataRows(Array.isArray(initial.dataRows) ? initial.dataRows : []);
    setMode(initial.mode || "direct");
    setPreRequestScript(initial.preRequestScript || "");

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
    return applyVarsToRequest(
      { method, url, params, headers, body, auth, mode, preRequestScript },
      envVars
    );
  }, [method, url, params, headers, body, auth, mode, preRequestScript, envVars]);

  const finalUrlPreview = useMemo(
    () => buildFinalUrl(finalDraft.url, finalDraft.params),
    [finalDraft]
  );

  const envBadge = useMemo(() => {
    const v = envVars || {};
    const baseUrl = (v.baseUrl || "").trim();
    return `Env: ${envName}${baseUrl ? ` • ${baseUrl}` : ""}`;
  }, [envName, envVars]);

  const buildHeadersObject = (hdrs) => {
    const obj = {};
    for (const h of hdrs || []) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    return obj;
  };

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

  const validateForCopy = () => {
    const urlAfterVars = (finalDraft.url || "").trim();
    if (!urlAfterVars) {
      setCopyMessage("Cannot copy: URL is empty");
      return false;
    }
    return true;
  };

  const cancelRequest = () => controllerRef.current?.abort();

  function buildCodegenInput(draft) {
    let headerObj = buildHeadersObject(draft.headers);
    headerObj = applyAuthToHeaders(draft.auth, headerObj);

    const m = (draft.method || "GET").toUpperCase();
    const hasBody =
      !["GET", "HEAD"].includes(m) && String(draft.body || "").trim().length > 0;

    if (hasBody) {
      const hasContentType = Object.keys(headerObj).some(
        (k) => k.toLowerCase() === "content-type"
      );
      if (!hasContentType) headerObj["Content-Type"] = "application/json";
    }

    return {
      method: m,
      finalUrl: buildFinalUrl(draft.url, draft.params),
      headersObj: headerObj,
      body: hasBody ? draft.body : "",
    };
  }

  const copyAs = async () => {
    if (!validateForCopy()) return;

    try {
      const input = buildCodegenInput(finalDraft);

      let snippet = "";
      if (copyFormat === "curl") snippet = toCurl(input);
      if (copyFormat === "fetch") snippet = toFetch(input);
      if (copyFormat === "axios") snippet = toAxios(input);

      await copyToClipboard(snippet);

      if (copyFormat === "curl") setCopyMessage("Copied as cURL");
      if (copyFormat === "fetch") setCopyMessage("Copied as Fetch");
      if (copyFormat === "axios") setCopyMessage("Copied as Axios");
    } catch {
      setCopyMessage("Copy failed");
    }
  };

  const runPreRequest = async (traceId, baseDraft) => {
    const script = String(preRequestScript || "").trim();
    if (!script) return { ok: true, draft: baseDraft, envDelta: {}, logs: [] };

    const ctx = {
      request: {
        method: baseDraft.method,
        url: baseDraft.url,
        params: baseDraft.params,
        headers: baseDraft.headers,
        body: baseDraft.body,
        auth: baseDraft.auth,
        mode: baseDraft.mode,
      },
      env: { ...(envVars || {}) },
      data: {},
    };

    const res = await runPreRequestScript(script, ctx);

    for (const l of res.logs || []) {
      pushConsoleEvent({
        level: l.level || "info",
        type: "prerequest",
        data: {
          traceId,
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
          name: res.error?.name || "ScriptError",
          message: res.error?.message || "Pre-request script failed",
        },
      });
      return {
        ok: false,
        draft: baseDraft,
        envDelta: res.envDelta || {},
        logs: res.logs || [],
        error: res.error,
      };
    }

    const nextDraft = {
      ...baseDraft,
      method: res.request?.method || baseDraft.method,
      url: res.request?.url ?? baseDraft.url,
      params: Array.isArray(res.request?.params) ? res.request.params : baseDraft.params,
      headers: Array.isArray(res.request?.headers) ? res.request.headers : baseDraft.headers,
      body: res.request?.body ?? baseDraft.body,
      auth: res.request?.auth ?? baseDraft.auth,
      mode: res.request?.mode ?? baseDraft.mode,
    };

    return {
      ok: true,
      draft: nextDraft,
      envDelta: res.envDelta || {},
      logs: res.logs || [],
    };
  };

  const sendRequest = async () => {
    if (!validate()) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const traceId = uuid("trace");
    const start = performance.now();
    setLoading(true);

    try {
      // 1) run pre-request script first (can mutate draft)
      const baseDraft = { method, url, params, headers, body, auth, mode };

      const pre = await runPreRequest(traceId, baseDraft);
      if (!pre.ok) {
        const end = performance.now();
        const timeMs = Math.round(end - start);
        onResponse?.({
          ok: false,
          timeMs,
          errorName: pre.error?.name || "ScriptError",
          errorMessage: pre.error?.message || "Pre-request script failed",
        });
        return;
      }

      // 2) apply env vars to the (possibly modified) draft
      const draftAfterScript = pre.draft;
      const draftResolved = applyVarsToRequest(draftAfterScript, envVars);

      const finalUrl = buildFinalUrl(draftResolved.url, draftResolved.params);

      let headerObj = buildHeadersObject(draftResolved.headers);
      headerObj = applyAuthToHeaders(draftResolved.auth, headerObj);

      pushConsoleEvent({
        level: "info",
        type: "request",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          mode: draftResolved.mode || "direct",
          method: draftResolved.method,
          finalUrl,
          headers: headerObj,
          body: !["GET", "HEAD"].includes(draftResolved.method) ? draftResolved.body || "" : "",
        },
      });

      let resStatus, resStatusText, resHeaders, rawText;

      if ((draftResolved.mode || "direct") === "direct") {
        const options = {
          method: draftResolved.method,
          headers: { ...headerObj },
          signal: controller.signal,
        };

        if (!["GET", "HEAD"].includes(draftResolved.method)) {
          const b = (draftResolved.body || "").trim();
          if (b.length > 0) {
            options.body =
              typeof draftResolved.body === "string"
                ? draftResolved.body
                : JSON.stringify(draftResolved.body);

            const hasContentType = Object.keys(options.headers).some(
              (k) => k.toLowerCase() === "content-type"
            );
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
        const proxyRes = await fetch(PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            url: finalUrl,
            method: draftResolved.method,
            headers: headerObj,
            body: !["GET", "HEAD"].includes(draftResolved.method) ? draftResolved.body || "" : "",
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
        response: { status: resStatus, timeMs, json: parsedJson, headers: resHeaders },
      });

      // ✅ Phase 4: JS test script (Safe mode via Web Worker)
      let scriptTestReport = null;
      const script = String(testScript || "").trim();
      if (script) {
        scriptTestReport = await runTestScript({
          script,
          response: {
            status: resStatus,
            statusText: resStatusText,
            headers: resHeaders,
            rawText,
            json: parsedJson,
            timeMs,
          },
          request: {
            method: draftResolved.method,
            url: draftResolved.url,
            finalUrl,
            headers: headerObj,
            body: !["GET", "HEAD"].includes(draftResolved.method) ? draftResolved.body || "" : "",
            params: draftResolved.params,
          },
          env: envVars || {},
          timeoutMs: 1500,
        });

        for (const l of scriptTestReport.logs || []) {
          pushConsoleEvent({
            level: l.type === "error" ? "error" : l.type === "warn" ? "warn" : "info",
            type: "testscript_log",
            data: { traceId, source: "requestBuilder", message: l.message },
          });
        }
      }

      onResponse?.({
        ok: true,
        status: resStatus,
        statusText: resStatusText,
        timeMs,
        headers: resHeaders,
        rawText,
        json: parsedJson,
        testReport,
        scriptTestReport,
      });

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
          tests: {
            builder: { passed: testReport.passed, total: testReport.total },
            script: scriptTestReport
              ? { passed: scriptTestReport.passed, total: scriptTestReport.total }
              : { passed: 0, total: 0 },
          },
        },
      });

      onSaveHistory?.({
        id: initial?.id || uuid(),
        name: (requestName || "").trim(),
        method: draftResolved.method,
        url: draftResolved.url,
        params: draftResolved.params,
        headers: draftResolved.headers,
        body: draftResolved.body,
        auth: draftResolved.auth,
        tests,
        testScript,
        dataRows,
        mode: draftResolved.mode || "direct",
        preRequestScript,
        savedAt: new Date().toISOString(),
        lastResult: {
          status: resStatus,
          timeMs,
          passed: testReport.passed + (scriptTestReport?.passed || 0),
          total: testReport.total + (scriptTestReport?.total || 0),
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

      pushConsoleEvent({
        level: err?.name === "AbortError" ? "warn" : "error",
        type: "error",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          message: err?.name === "AbortError" ? "Aborted" : err?.message || "Request failed",
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
        testScript,
        dataRows,
        mode,
        preRequestScript,
        savedAt: new Date().toISOString(),
        lastResult: {
          status: "ERR",
          timeMs,
          passed: 0,
          total: (tests?.length || 0) + (String(testScript || "").trim() ? 1 : 0),
        },
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
      testScript,
      dataRows,
      mode,
      preRequestScript,
    });
  };

  // ----------------------------
  // Phase 4.2.5: Import + preview + Save to collections
  // ----------------------------
  const openImport = () => {
    setImportError("");
    setImportText("");
    setImportHint("auto");
    setImportPreview(null);

    const trees = loadCollectionTrees();
    const list = Array.isArray(trees) ? trees : [];
    setImportTrees(list);

    const def = computeDefaultImportTarget(list);
    setImportCollectionId(def.collectionId);
    setImportFolderId(def.folderId);

    setImportSaveToCollections(true);
    setImportSaveMsg("");
    setImportOpen(true);

    setTimeout(() => {
      importTextRef.current?.focus?.();
    }, 0);
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportError("");
    setImportPreview(null);
    setImportSaveMsg("");
  };

  const parseImport = () => {
    const text = String(importText || "").trim();
    if (!text) {
      setImportError("Paste a snippet to import.");
      setImportPreview(null);
      return;
    }

    const parsed = importSnippet(text, importHint);
    if (!parsed) {
      setImportError(
        "Could not parse this snippet. Try a different format in the dropdown."
      );
      setImportPreview(null);
      return;
    }

    setImportError("");
    setImportPreview(parsed);
  };

  const applyParsedToEditor = (parsed) => {
    setMethod(parsed.method || "GET");
    setUrl(parsed.url || "");
    setParams(ensureKvRows(parsed.params));

    const { auth: detectedAuth, cleanedHeaders } = detectAuthFromHeaders(
      ensureKvRows(parsed.headers)
    );

    setHeaders(ensureKvRows(cleanedHeaders));
    setBody(parsed.body || "");
    setAuth({
      type: detectedAuth.type || "none",
      bearer: detectedAuth.bearer || "",
      username: detectedAuth.username || "",
      password: detectedAuth.password || "",
      apiKeyName: detectedAuth.apiKeyName || "x-api-key",
      apiKeyValue: detectedAuth.apiKeyValue || "",
    });

    setMode("direct");

    if (!String(requestName || "").trim()) {
      setRequestName(suggestName(parsed.method || "GET", parsed.url || ""));
    }

    setTab("params");
    setBodyError("");
  };

  const saveImportedToCollections = (parsed) => {
    const trees = loadCollectionTrees();
    const list = Array.isArray(trees) ? trees : [];
    const collectionId = String(importCollectionId || "").trim();
    if (!collectionId) {
      setImportSaveMsg("Select a collection to save.");
      return false;
    }

    const folderId = String(importFolderId || "").trim() || null;

    const name =
      String(requestName || "").trim() ||
      suggestName(parsed.method || "GET", parsed.url || "");

    const payload = {
      id: uuid("req"),
      name,
      method: parsed.method || "GET",
      url: parsed.url || "",
      params: ensureKvRows(parsed.params),
      headers: ensureKvRows(parsed.headers),
      body: parsed.body || "",
      auth: parsed.auth || { type: "none" },
      tests: [],
      testScript: "",
      dataRows: [],
      mode: "direct",
      preRequestScript: "",
    };

    const updated = upsertCollectionTreeRequestUnderFolder(list, {
      collectionId,
      folderId,
      requestName: name,
      requestPayload: payload,
    });

    if (!updated) {
      setImportSaveMsg("Save failed. Check storage helpers for tree insert.");
      return false;
    }

    setImportSaveMsg("Saved into Collections.");
    return true;
  };

  const applyImport = () => {
    if (!importPreview) {
      parseImport();
      return;
    }

    applyParsedToEditor(importPreview);

    if (importSaveToCollections) {
      const { auth: detectedAuth, cleanedHeaders } = detectAuthFromHeaders(
        ensureKvRows(importPreview.headers)
      );

      const payloadToSave = {
        ...importPreview,
        headers: ensureKvRows(cleanedHeaders),
        auth: detectedAuth,
      };

      const ok = saveImportedToCollections(payloadToSave);
      if (!ok) return;
    }

    closeImport();
  };

  useEffect(() => {
    if (!importOpen) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") closeImport();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "enter") {
        if (importPreview) applyImport();
        else parseImport();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    importOpen,
    importPreview,
    importText,
    importHint,
    importSaveToCollections,
    importCollectionId,
    importFolderId,
  ]);

  const collectionOptions = useMemo(
    () => buildCollectionOptions(importTrees),
    [importTrees]
  );

  const selectedCollection = useMemo(() => {
    const id = String(importCollectionId || "").trim();
    if (!id) return null;
    return importTrees.find((c) => c?.id === id) || null;
  }, [importTrees, importCollectionId]);

  const folderOptions = useMemo(() => {
    const out = [{ id: "", name: "Root" }];
    const children = Array.isArray(selectedCollection?.children)
      ? selectedCollection.children
      : [];
    for (const n of children) {
      if (n?.kind === "folder") out.push({ id: n.id, name: safeTreeLabel(n) });
    }
    return out;
  }, [selectedCollection]);

  return (
    <div className="stack">
      {importOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeImport();
          }}
        >
          <div
            className="panel"
            style={{
              width: "min(1020px, 100%)",
              maxHeight: "85vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="panelHeader" style={{ justifyContent: "space-between" }}>
              <div className="panelTitle">Import Request</div>
              <button className="btn btnSm" onClick={closeImport}>
                Close
              </button>
            </div>

            <div className="panelBody" style={{ overflow: "auto" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                <div className="smallMuted">
                  Paste a snippet. Parse to preview, then apply. Ctrl/Cmd+Enter to
                  parse/apply.
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <select
                    className="select"
                    value={importHint}
                    onChange={(e) => {
                      setImportHint(e.target.value);
                      setImportPreview(null);
                      setImportError("");
                      setImportSaveMsg("");
                    }}
                    style={{ maxWidth: 220 }}
                    title="Format"
                  >
                    <option value="auto">Auto detect</option>
                    <option value="curl">cURL</option>
                    <option value="fetch">Fetch</option>
                    <option value="axios">Axios</option>
                    <option value="http">Raw HTTP</option>
                  </select>

                  <button className="btn btnSm" onClick={parseImport}>
                    Parse
                  </button>
                </div>
              </div>

              <textarea
                ref={importTextRef}
                className="textarea"
                style={{ minHeight: 220, marginTop: 10, fontFamily: "var(--mono)" }}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportPreview(null);
                  setImportError("");
                  setImportSaveMsg("");
                }}
                placeholder={`Example (Chrome cURL):
curl 'https://api.example.com/login' -H 'content-type: application/json' --data-raw '{"u":"a","p":"b"}'

Example (Fetch):
fetch("https://api.example.com/todos", { method: "GET", headers: { Accept: "application/json" } })
`}
              />

              {importError ? (
                <div style={{ marginTop: 10, color: "var(--danger)" }}>{importError}</div>
              ) : null}

              <div className="panelSoft" style={{ marginTop: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700 }}>Save options</div>
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={importSaveToCollections}
                      onChange={(e) => setImportSaveToCollections(e.target.checked)}
                    />
                    <span className="smallMuted">Save into Collections on Apply</span>
                  </label>
                </div>

                {!collectionOptions.length ? (
                  <div className="smallMuted" style={{ marginTop: 10 }}>
                    No collections found. Create one in Collections tab first.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginTop: 10,
                    }}
                  >
                    <div>
                      <div className="smallMuted" style={{ marginBottom: 6 }}>
                        Collection
                      </div>
                      <select
                        className="select"
                        value={importCollectionId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setImportCollectionId(id);
                          const c = importTrees.find((x) => x?.id === id);
                          const firstFolderId = findFirstFolderInCollection(c)?.id || "";
                          setImportFolderId(firstFolderId);
                          setImportSaveMsg("");
                        }}
                      >
                        {collectionOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="smallMuted" style={{ marginBottom: 6 }}>
                        Folder (top level)
                      </div>
                      <select
                        className="select"
                        value={importFolderId}
                        onChange={(e) => {
                          setImportFolderId(e.target.value);
                          setImportSaveMsg("");
                        }}
                      >
                        {folderOptions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {importSaveMsg ? (
                  <div style={{ marginTop: 10, color: "var(--muted)" }}>
                    {importSaveMsg}
                  </div>
                ) : null}
              </div>

              {importPreview ? (
                <div className="panelSoft" style={{ marginTop: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 700 }}>Preview</div>
                    <div className="smallMuted" style={{ fontFamily: "var(--mono)" }}>
                      {importPreview.method} {importPreview.url}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginTop: 10,
                    }}
                  >
                    <div>
                      <div className="smallMuted" style={{ marginBottom: 6 }}>
                        Headers (
                        {(importPreview.headers || []).filter((h) =>
                          String(h?.key || "").trim()
                        ).length}
                        )
                      </div>
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        {previewHeaderRows(importPreview.headers).length ? (
                          previewHeaderRows(importPreview.headers).map((h) => (
                            <div
                              key={h.key}
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: 12,
                                marginBottom: 6,
                              }}
                            >
                              <span style={{ opacity: 0.9 }}>{h.key}</span>
                              <span style={{ opacity: 0.6 }}>:</span>{" "}
                              <span style={{ opacity: 0.85 }}>{h.value}</span>
                            </div>
                          ))
                        ) : (
                          <div className="smallMuted">No headers</div>
                        )}
                      </div>
                      <div className="smallMuted" style={{ marginTop: 8 }}>
                        Auth mapping:{" "}
                        <span style={{ fontFamily: "var(--mono)" }}>
                          {detectAuthFromHeaders(importPreview.headers).auth?.type || "none"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="smallMuted" style={{ marginBottom: 6 }}>
                        Body ({String(importPreview.body || "").length} chars)
                      </div>
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        {String(importPreview.body || "").trim() ? (
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              fontFamily: "var(--mono)",
                              fontSize: 12,
                            }}
                          >
                            {String(importPreview.body || "").slice(0, 800)}
                            {String(importPreview.body || "").length > 800
                              ? "\n...(truncated)"
                              : ""}
                          </pre>
                        ) : (
                          <div className="smallMuted">No body</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="row"
                    style={{ justifyContent: "flex-end", marginTop: 12 }}
                  >
                    <button
                      className="btn"
                      onClick={() => {
                        setImportPreview(null);
                        setImportSaveMsg("");
                      }}
                    >
                      Clear Preview
                    </button>
                    <button className="btn btnPrimary" onClick={applyImport}>
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={closeImport}>
                  Cancel
                </button>
                <button className="btn btnPrimary" onClick={applyImport}>
                  {importPreview ? "Apply" : "Parse"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="row">
        <input
          className="input"
          value={requestName}
          onChange={(e) => setRequestName(e.target.value)}
          placeholder="Request name"
        />
        <span className="badge">{envBadge}</span>
      </div>

      {saveError ? (
        <div className="smallMuted" style={{ color: "var(--danger)" }}>
          {saveError}
        </div>
      ) : null}

      {copyMsg ? (
        <div className="smallMuted" style={{ color: "var(--muted)" }}>
          {copyMsg}
        </div>
      ) : null}

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
          placeholder="{{baseUrl}}/api/books/{{id}}"
        />

        <button className="btn btnPrimary" onClick={sendRequest} disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btnSm" onClick={openImport} disabled={loading}>
            Import
          </button>

          <select
            className="select"
            value={copyFormat}
            onChange={(e) => setCopyFormat(e.target.value)}
            style={{ maxWidth: 160 }}
            disabled={loading}
            title="Copy as"
          >
            <option value="curl">Copy as cURL</option>
            <option value="fetch">Copy as Fetch</option>
            <option value="axios">Copy as Axios</option>
          </select>

          <button className="btn btnSm" onClick={copyAs} disabled={loading}>
            Copy
          </button>
        </div>

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
          <button
            className={`tab ${mode === "direct" ? "tabActive" : ""}`}
            onClick={() => setMode("direct")}
          >
            Direct
          </button>
          <button
            className={`tab ${mode === "proxy" ? "tabActive" : ""}`}
            onClick={() => setMode("proxy")}
          >
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
        <button className={`tab ${tab === "prereq" ? "tabActive" : ""}`} onClick={() => setTab("prereq")}>
          Pre-Request
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
      {tab === "body" && (
        <BodyEditor
          method={method}
          body={body}
          setBody={setBody}
          bodyError={bodyError}
          setBodyError={setBodyError}
        />
      )}

      {tab === "prereq" && (
        <div className="panelSoft">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700 }}>Pre-request script</div>
            <div className="smallMuted" style={{ fontFamily: "var(--mono)" }}>
              pm.env.set("token","...") pm.request.setHeader("x","y")
            </div>
          </div>

          <textarea
            className="textarea"
            style={{ minHeight: 180, marginTop: 10, fontFamily: "var(--mono)" }}
            value={preRequestScript}
            onChange={(e) => setPreRequestScript(e.target.value)}
            placeholder={`// Runs before sending.\n// Example:\n// pm.env.set("ts", pm.utils.nowIso());\n// pm.request.setHeader("x-trace", pm.utils.uuid());\n`}
          />

          <div className="smallMuted" style={{ marginTop: 10 }}>
            Available: <span style={{ fontFamily: "var(--mono)" }}>pm.env</span>,{" "}
            <span style={{ fontFamily: "var(--mono)" }}>pm.request</span>,{" "}
            <span style={{ fontFamily: "var(--mono)" }}>pm.data</span>,{" "}
            <span style={{ fontFamily: "var(--mono)" }}>pm.utils</span>,{" "}
            <span style={{ fontFamily: "var(--mono)" }}>console.log</span>
          </div>
        </div>
      )}

      {tab === "tests" && (
        <TestsEditor
          tests={tests}
          setTests={setTests}
          testScript={testScript}
          setTestScript={setTestScript}
        />
      )}

      {tab === "data" && <DataEditor rows={dataRows} setRows={setDataRows} />}

      <div className="smallMuted">
        Tip: Env vars work on Send. Data rows run via Runner. Use{" "}
        <span style={{ fontFamily: "var(--mono)" }}>{"{{var}}"}</span> format.
      </div>
    </div>
  );
}
