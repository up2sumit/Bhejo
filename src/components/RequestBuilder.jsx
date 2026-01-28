// src/components/RequestBuilder.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HeadersEditor from "./HeadersEditor";
import BodyEditor from "./BodyEditor";
import QueryParamsEditor from "./QueryParamsEditor";
import AuthEditor, { applyAuthToHeaders } from "./AuthEditor";
import TestsEditor from "./TestsEditor";
import DataEditor from "./DataEditor";
import DocsEditor from "./DocsEditor";
import AgentConfigPanel from "./AgentConfigPanel.jsx";

import { applyVarsToRequest, createVarMeta, metaToPlain, resolveTemplateSegments } from "../utils/vars";
import { runAssertions } from "../utils/assertions";
import { pushConsoleEvent } from "../utils/consoleBus";
import { toCurl, toFetch, toAxios } from "../utils/codegen";
import { runPreRequestScript } from "../utils/scriptRuntime";
import { importSnippet } from "../utils/snippetImport";
import { getFile, fileToBase64 } from "../utils/fileCache";
import {
  loadCollectionTrees,
  upsertCollectionTreeRequestUnderFolder,
} from "../utils/storage";

// ✅ Phase 4 (Option B): Safe mode JS tests in Web Worker
import { runTestScriptSafe as runTestScript } from "../utils/testRuntimeSafe";

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "http://localhost:3001/proxy";
const AGENT_DEFAULT_BASE_URL = "http://127.0.0.1:3131";

function loadLS(key, fallback = "") {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function saveLS(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

function getCookieJarId() {
  // Stable id so the proxy can persist cookies per user session
  try {
    const k = "bhejo_cookieJarId";
    const existing = localStorage.getItem(k);
    if (existing) return existing;
    const id = `jar_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(k, id);
    return id;
  } catch {
    return "default";
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



function buildFinalUrlTemplate(baseUrl, params) {
  const base = String(baseUrl || "");
  const rows = (params || []).filter((p) => p && String(p.key || "").trim() !== "");
  if (!rows.length) return base;
  const qs = rows.map((p) => `${p.key}=${p.value ?? ""}`).join("&");
  const hasQ = base.includes("?");
  if (!hasQ) return `${base}?${qs}`;
  if (base.endsWith("?") || base.endsWith("&")) return `${base}${qs}`;
  return `${base}&${qs}`;
}

function truncateText(str, max = 8000) {
  const s = String(str ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n… (truncated)";
}

function VarSegments({ segments }) {
  return (
    <>
      {(segments || []).map((seg, idx) => {
        if (seg.t === "var") {
          const ok = !!seg.resolved;
          const bg = ok ? "rgba(46, 204, 113, 0.16)" : "rgba(255, 70, 70, 0.16)";
          const bd = ok ? "rgba(46, 204, 113, 0.38)" : "rgba(255, 70, 70, 0.38)";
          const fg = ok ? "var(--success)" : "var(--danger)";
          return (
            <span
              key={idx}
              title={ok ? `{{${seg.name}}}` : `Missing: ${seg.name}`}
              style={{
                background: bg,
                border: `1px solid ${bd}`,
                color: fg,
                borderRadius: 999,
                padding: "0 6px",
                margin: "0 1px",
                display: "inline-block",
              }}
            >
              {seg.display}
            </span>
          );
        }
        return <span key={idx}>{seg.text}</span>;
      })}
    </>
  );
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


function ensureKvRowsEnabled(arr, extra = {}) {
  const a = Array.isArray(arr) ? arr : [];
  const norm = a.map((r) => ({
    key: r?.key ?? "",
    value: r?.value ?? "",
    enabled: r?.enabled !== false,
    ...extra,
    ...(r || {}),
  }));

  if (!norm.length) return [{ key: "", value: "", enabled: true, ...extra }];

  const hasBlank = norm.some((x) => !String(x?.key || "") && !String(x?.value || ""));
  return hasBlank ? norm : [...norm, { key: "", value: "", enabled: true, ...extra }];
}

function ensureFormDataRows(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const norm = a.map((r) => {
    const kind = String(r?.kind || "text").toLowerCase();
    return {
      key: r?.key ?? "",
      value: r?.value ?? "",
      enabled: r?.enabled !== false,
      kind,
      fileRefId: r?.fileRefId || "",
      fileName: r?.fileName || "",
      fileType: r?.fileType || "",
      fileSize: r?.fileSize || 0,
      ...(r || {}),
    };
  });

  if (!norm.length) return [{ key: "", value: "", enabled: true, kind: "text" }];

  const hasBlank = norm.some((x) => !String(x?.key || "") && !String(x?.value || "") && !String(x?.fileName || ""));
  return hasBlank ? norm : [...norm, { key: "", value: "", enabled: true, kind: "text" }];
}

function encodeFormUrl(rows) {
  const sp = new URLSearchParams();
  for (const r of rows || []) {
    if (!r || r.enabled === false) continue;
    const k = String(r.key || "").trim();
    if (!k) continue;
    sp.append(k, r.value ?? "");
  }
  return sp.toString();
}

function deleteHeaderCI(obj, headerName) {
  const out = { ...(obj || {}) };
  const target = String(headerName || "").toLowerCase();
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === target) delete out[k];
  }
  return out;
}


function headersObjectToRows(obj) {
  const out = [];
  const o = obj && typeof obj === "object" ? obj : {};
  for (const [k, v] of Object.entries(o)) {
    out.push({ key: k, value: String(v ?? ""), enabled: true });
  }
  return out.length ? out : [{ key: "", value: "", enabled: true }];
}

function buildHeadersObject(hdrs) {
  const obj = {};
  for (const h of hdrs || []) {
    const k = (h.key || "").trim();
    if (!k) continue;
    obj[k] = h.value ?? "";
  }
  return obj;
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
  envNames = [],
  setEnvName = () => {},
  envVars,

  // Phase 6: open specific example (from Collections tree)
  initialActiveExampleId,

  // NEW: emit draft to parent (for Postman-like request tabs)
  onDraftChange,

  // NEW: for tabs, we don't want switching tabs to wipe the response pane
  clearResponseOnLoad = true,
}) {
  const [method, setMethod] = useState(initial?.method || "GET");
  const [url, setUrl] = useState(initial?.url || "{{baseUrl}}/todos/1");

  const [params, setParams] = useState(initial?.params || [{ key: "", value: "" }]);
  const [headers, setHeaders] = useState(initial?.headers || [{ key: "", value: "" }]);

  const [body, setBody] = useState(initial?.body || "");
  const [bodyError, setBodyError] = useState("");

  const [bodyMode, setBodyMode] = useState(initial?.bodyMode || "json");
  const [bodyFormUrl, setBodyFormUrl] = useState(ensureKvRowsEnabled(initial?.bodyFormUrl));
  const [bodyFormData, setBodyFormData] = useState(ensureFormDataRows(initial?.bodyFormData));


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

  // Phase 6: Documentation + Examples (Postman-like)
  const [docText, setDocText] = useState(initial?.docText || initial?.docs?.text || "");
  const [examples, setExamples] = useState(Array.isArray(initial?.examples) ? initial.examples : []);
  const [defaultExampleId, setDefaultExampleId] = useState(initial?.defaultExampleId || initial?.docs?.defaultExampleId || null);
  const lastExchangeRef = useRef(null);

  const [requestName, setRequestName] = useState("");

  // Breadcrumb (Postman-like) built from CollectionsPanel __path meta
  const breadcrumb = useMemo(() => {
    const p = initial?.__path || {};
    const cid = p.collectionId || null;

    const getCollectionLabel = () => {
      if (!cid) return null;
      try {
        const trees = loadCollectionTrees();
        const found = Array.isArray(trees) ? trees.find((t) => String(t?.id) === String(cid)) : null;
        const name = (found?.name || "").trim();
        return name || null;
      } catch {
        return null;
      }
    };

    const ensureCollectionPrefix = (items) => {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!list.length) return list;

      const colLabel = getCollectionLabel();
      if (!colLabel) return list;

      const first = list[0] || null;
      const firstType = String(first?.type || "").toLowerCase();
      const firstLabel = String(first?.label || "").trim();

      // If already starts with collection label (or explicitly typed), leave as-is
      if (firstType === "collection") return list;
      if (firstLabel && firstLabel === colLabel) {
        return [{ ...first, type: "collection", collectionId: cid }, ...list.slice(1)];
      }

      // Otherwise prefix with collection segment
      return [
        {
          type: "collection",
          label: colLabel,
          collectionId: cid,
          nodeId: "root",
        },
        ...list,
      ];
    };

    // Preferred: __path.meta emitted by CollectionsPanel (has nodeIds)
    const meta = Array.isArray(p.meta) ? p.meta : null;
    if (meta && meta.length) {
      const items = meta.map((x) => ({ ...x, collectionId: x?.collectionId || cid || null }));

      // Replace last segment with editable request name
      const last = items[items.length - 1] || null;
      if (last) {
        items[items.length - 1] = {
          ...last,
          type: "request",
          label: (requestName || last.label || "").trim() || "Request",
        };
      }

      return ensureCollectionPrefix(items);
    }

    // Fallback: __path.segments (labels only)
    const segs = Array.isArray(p.segments) ? p.segments.filter(Boolean).map((s) => String(s)) : [];
    if (segs.length) {
      const colLabel = getCollectionLabel();

      // If segments don't include collection name, prefix it
      const segsWithCol =
        colLabel && segs[0] !== colLabel ? [colLabel, ...segs] : segs;

      const items = segsWithCol.map((label, idx) => {
        const isLast = idx === segsWithCol.length - 1;
        const isFirst = idx === 0;
        return {
          type: isFirst ? "collection" : isLast ? "request" : "folder",
          label,
          collectionId: cid,
          nodeId: null,
        };
      });

      // Ensure last is editable request name
      const last = items[items.length - 1] || null;
      if (last) {
        items[items.length - 1] = {
          ...last,
          type: "request",
          label: (requestName || last.label || "").trim() || "Request",
        };
      }

      return items;
    }

    return [];
  }, [initial, requestName]);

  const crumbText = useMemo(() => breadcrumb.map((b) => b.label).filter(Boolean).join(" / "), [breadcrumb]);

  const navigateCrumb = (item) => {
    if (!item) return;
    const cid = item.collectionId || initial?.__path?.collectionId || null;
    if (!cid) return;
    const nodeId = item.type === "collection" ? null : item.nodeId || null;
    window.dispatchEvent(new CustomEvent("bhejo:navigate", { detail: { collectionId: cid, nodeId } }));
  };
      
  const [saveError, setSaveError] = useState("");

  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  const [tab, setTab] = useState("params");
  const [mode, setMode] = useState(initial?.mode || "direct");

  // Phase 3: Agent (local network bridge)
  const [agentBaseUrl, setAgentBaseUrl] = useState(
    () => (loadLS("bhejo_agent_baseUrl", AGENT_DEFAULT_BASE_URL) || AGENT_DEFAULT_BASE_URL).trim()
  );
  const [agentToken, setAgentToken] = useState(() => (loadLS("bhejo_agent_token", "") || "").trim());
  const [agentPairCode, setAgentPairCode] = useState("");
  const [agentMsg, setAgentMsg] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  useEffect(() => {
    saveLS("bhejo_agent_baseUrl", agentBaseUrl || "");
  }, [agentBaseUrl]);

  useEffect(() => {
    saveLS("bhejo_agent_token", agentToken || "");
  }, [agentToken]);

  // Phase 5: Resolve preview (missing vars + colored tokens)
  const [showResolvePreview, setShowResolvePreview] = useState(false);
  const [resolveTab, setResolveTab] = useState("url");

  // Copy as
  const [copyFormat, setCopyFormat] = useState("curl");
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copySplitRef = useRef(null);
  const copyMenuRef = useRef(null);
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
    // Body modes (Postman-like)
    const importedBody = String(initial.body || "");
    const hasBodyMode = !!initial.bodyMode;
    if (hasBodyMode) {
      setBodyMode(initial.bodyMode || "json");
    } else {
      // Best-effort: if body parses as JSON, keep json else raw text
      const t = importedBody.trim();
      if (!t) setBodyMode("json");
      else {
        try { JSON.parse(t); setBodyMode("json"); }
        catch { setBodyMode("text"); }
      }
    }
    setBodyFormUrl(ensureKvRowsEnabled(initial.bodyFormUrl));
    setBodyFormData(ensureFormDataRows(initial.bodyFormData));
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
    if (clearResponseOnLoad) onResponse?.(null);
    // Inform parent (tabs) that this draft has loaded
    onDraftChange?.(
      {
        id: initial?.id,
        name: loadedName,
        method: initial.method || "GET",
        url: initial.url || "",
        params: initial.params?.length ? initial.params : [{ key: "", value: "" }],
        headers: initial.headers?.length ? initial.headers : [{ key: "", value: "" }],
        body: initial.body || "",
        bodyMode: initial.bodyMode || (String(initial.body || "").trim() ? (() => { try { JSON.parse(String(initial.body || "")); return "json"; } catch { return "text"; } })() : "json"),
        bodyFormUrl: ensureKvRowsEnabled(initial.bodyFormUrl),
        bodyFormData: ensureFormDataRows(initial.bodyFormData),
        auth:
          initial.auth || {
            type: "none",
            bearer: "",
            username: "",
            password: "",
            apiKeyName: "x-api-key",
            apiKeyValue: "",
          },
        tests: Array.isArray(initial.tests) ? initial.tests : [],
        testScript: initial.testScript || "",
        dataRows: Array.isArray(initial.dataRows) ? initial.dataRows : [],
        mode: initial.mode || "direct",
        preRequestScript: initial.preRequestScript || "",
        docText: initial?.docText || initial?.docs?.text || "",
        examples: Array.isArray(initial?.examples) ? initial.examples : [],
        defaultExampleId: initial?.defaultExampleId || initial?.docs?.defaultExampleId || null,
        savedAt: initial.savedAt || new Date().toISOString(),
      },
      { reason: "init" }
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.savedAt]);

  useEffect(() => {
    if (requestName.trim()) return;
    const safeUrl = (url || "").replace(/\{\{\s*.*?\s*\}\}/g, "var");
    setRequestName(suggestName(method, safeUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, url]);

  // Emit draft changes to parent (tabs). This lets App keep per-tab state.
  useEffect(() => {
    if (!onDraftChange) return;

    onDraftChange(
      {
        id: initial?.id,
        name: (requestName || "").trim(),
        method,
        url,
        params,
        headers,
        body,
        bodyMode,
        bodyFormUrl,
        bodyFormData,
        auth,
        tests,
        testScript,
        dataRows,
        mode,
        preRequestScript,
        docText,
        examples,
        defaultExampleId,
        savedAt: initial?.savedAt || new Date().toISOString(),
      },
      { reason: "edit" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requestName,
    method,
    url,
    params,
    headers,
    body,
    bodyMode,
    bodyFormUrl,
    bodyFormData,
    auth,
    tests,
    testScript,
    dataRows,
    mode,
    preRequestScript,
    docText,
    examples,
    defaultExampleId,
  ]);

  const { finalDraft, varMeta } = useMemo(() => {
  const meta = createVarMeta();
  const resolved = applyVarsToRequest(
    { method, url, params, headers, body, bodyMode, bodyFormUrl, bodyFormData, auth, mode, preRequestScript, tests, testScript },
    envVars,

  // Phase 6: open specific example (from Collections tree)
  initialActiveExampleId,
    meta
  );
  return { finalDraft: resolved, varMeta: metaToPlain(meta) };
}, [method, url, params, headers, body, bodyMode, bodyFormUrl, bodyFormData, auth, mode, preRequestScript, tests, testScript, envVars]);

const finalUrlPreview = useMemo(
    () => buildFinalUrl(finalDraft.url, finalDraft.params),
    [finalDraft]
  );

  const envBadge = useMemo(() => {
    const v = envVars || {};
    const baseUrl = (v.baseUrl || "").trim();
    return { envName, baseUrl };
  }, [envName, envVars]);


  // Resolve preview helpers (missing vars + colored tokens)
  const missingKeys = varMeta?.missingKeys || [];
  const usedKeys = varMeta?.usedKeys || [];
  const resolvedKeys = varMeta?.resolvedKeys || [];
  const missingCount = missingKeys.length;

  const urlTemplate = useMemo(() => buildFinalUrlTemplate(url, params), [url, params]);
  const urlSegments = useMemo(() => resolveTemplateSegments(urlTemplate, envVars), [urlTemplate, envVars]);

  const headersPreview = useMemo(() => {
    const rows = [];
    for (const h of headers || []) {
      const k = String(h?.key || "");
      const v = String(h?.value || "");
      if (!k.trim() && !v.trim()) continue;
      rows.push({
        keySegments: resolveTemplateSegments(k, envVars),
        valueSegments: resolveTemplateSegments(v, envVars),
      });
    }
    return rows;
  }, [headers, envVars]);

  const bodyPreviewText = useMemo(() => {
    const m = String(bodyMode || "json").toLowerCase();

    if (m === "formurl") {
      const enc = encodeFormUrl(bodyFormUrl);
      return truncateText(enc || "", 8000);
    }

    if (m === "formdata") {
      const lines = [];
      for (const r of bodyFormData || []) {
        if (!r || r.enabled === false) continue;
        const k = String(r.key || "").trim();
        if (!k) continue;
        const kind = String(r.kind || "text").toLowerCase();
        if (kind === "file") {
          const fn = r.fileName || "file";
          lines.push(`${k} = <file: ${fn}>`);
        } else {
          lines.push(`${k} = ${String(r.value ?? "")}`);
        }
      }
      return truncateText(lines.join("\n"), 8000);
    }

    // json/text use `body` string (or object)
    if (body == null) return "";
    if (typeof body === "string") return truncateText(body, 8000);
    try {
      return truncateText(JSON.stringify(body, null, 2), 8000);
    } catch {
      return truncateText(String(body), 8000);
    }
  }, [bodyMode, body, bodyFormUrl, bodyFormData]);

  const bodySegments = useMemo(
    () => resolveTemplateSegments(bodyPreviewText, envVars),
    [bodyPreviewText, envVars]
  );

const validateForCopy = () => {
    const urlAfterVars = (finalDraft.url || "").trim();
    if (!urlAfterVars) {
      setCopyMessage("Cannot copy: URL is empty");
      return false;
    }
    const bm = String(bodyMode || "json").toLowerCase();
    if (bm === "formdata" && (bodyFormData || []).some((r) => r && r.enabled !== false && String(r.key || "").trim())) {
      setCopyMessage("Cannot copy: multipart form-data codegen not supported yet");
      return false;
    }
    return true;
  };

  const validate = () => {
    const u = String(url || "").trim();
    if (!u) {
      setSaveError("URL cannot be empty.");
      return false;
    }

    // Only validate JSON when JSON mode
    if (String(bodyMode || "json").toLowerCase() === "json") {
      const t = String(body || "").trim();
      if (t) {
        try {
          JSON.parse(t);
          setBodyError("");
        } catch {
          setBodyError("Invalid JSON body");
          return false;
        }
      }
    } else {
      setBodyError("");
    }

    setSaveError("");
    return true;
  };

  const cancelRequest = () => controllerRef.current?.abort();

  function applyExampleToEditor(example) {
    const req = example?.request || null;
    if (!req) return;
    try {
      if (req.name !== undefined) setRequestName(String(req.name || ""));
      if (req.mode) setMode(req.mode);
      if (req.method) setMethod(String(req.method).toUpperCase());
      if (req.url !== undefined) setUrl(String(req.url || ""));
      if (Array.isArray(req.params)) setParams(req.params);
      if (req.headers && typeof req.headers === "object") setHeaders(headersObjectToRows(req.headers));
      if (req.auth) setAuth(req.auth);

      const b = req.body;
      if (b && typeof b === "object" && "mode" in b) {
        const bm = String(b.mode || "json").toLowerCase();
        setBodyMode(bm);
        if (bm === "formurl" && Array.isArray(b.formUrl)) setBodyFormUrl(ensureKvRowsEnabled(b.formUrl));
        if (bm === "formdata" && Array.isArray(b.formData)) setBodyFormData(ensureFormDataRows(b.formData));
        if (bm === "json" || bm === "text") setBody(String(b.body || ""));
      } else {
        // legacy
        setBody(String(b ?? ""));
      }

      setBodyError("");
      setSaveError("");
      setTab("params");
    } catch {
      // ignore
    }
  }

  function buildCodegenInput(draft) {
    let headerObj = buildHeadersObject(draft.headers);
    headerObj = applyAuthToHeaders(draft.auth, headerObj);

    const m = (draft.method || "GET").toUpperCase();
    const allowBody = !["GET", "HEAD"].includes(m);

    const mode = String(draft.bodyMode || "json").toLowerCase();
    let bodyOut = "";

    if (allowBody) {
      if (mode === "formurl") {
        bodyOut = encodeFormUrl(draft.bodyFormUrl);
        const hasBody = String(bodyOut || "").trim().length > 0;
        if (hasBody) {
          const hasCT = Object.keys(headerObj).some((k) => k.toLowerCase() === "content-type");
          if (!hasCT) headerObj["Content-Type"] = "application/x-www-form-urlencoded";
        }
      } else if (mode === "text") {
        bodyOut = String(draft.body || "");
        const hasBody = String(bodyOut || "").trim().length > 0;
        if (hasBody) {
          const hasCT = Object.keys(headerObj).some((k) => k.toLowerCase() === "content-type");
          if (!hasCT) headerObj["Content-Type"] = "text/plain";
        }
      } else if (mode === "formdata") {
        // Codegen for multipart is not implemented in codegen helpers yet.
        bodyOut = "";
      } else {
        // json
        bodyOut = String(draft.body || "");
        const hasBody = String(bodyOut || "").trim().length > 0;
        if (hasBody) {
          const hasCT = Object.keys(headerObj).some((k) => k.toLowerCase() === "content-type");
          if (!hasCT) headerObj["Content-Type"] = "application/json";
        }
      }
    }

    return {
      method: m,
      finalUrl: buildFinalUrl(draft.url, draft.params),
      headersObj: headerObj,
      body: bodyOut,
    };
  }

  const copyAs = async (formatOverride) => {
    if (!validateForCopy()) return;
    const fmt = formatOverride || copyFormat;

    try {
      const input = buildCodegenInput(finalDraft);

      let snippet = "";
      if (fmt === "curl") snippet = toCurl(input);
      if (fmt === "fetch") snippet = toFetch(input);
      if (fmt === "axios") snippet = toAxios(input);

      await copyToClipboard(snippet);

      if (fmt === "curl") setCopyMessage("Copied as cURL");
      if (fmt === "fetch") setCopyMessage("Copied as Fetch");
      if (fmt === "axios") setCopyMessage("Copied as Axios");
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

  const pairAgent = async () => {
    const code = String(agentPairCode || "").trim();
    if (!code) {
      setAgentMsg("Enter the pair code shown in agent terminal.");
      return;
    }
    const base = (agentBaseUrl || AGENT_DEFAULT_BASE_URL).trim().replace(/\/$/, "");
    setAgentBusy(true);
    setAgentMsg("Pairing...");
    try {
      const res = await fetch(`${base}/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairCode: code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.token) {
        const msg = data?.error?.message || data?.message || "Pairing failed";
        throw new Error(msg);
      }
      setAgentToken(data.token);
      setAgentPairCode("");
      setAgentMsg("Paired ✔");
    } catch (e) {
      setAgentMsg(e?.message || "Pairing failed");
    } finally {
      setAgentBusy(false);
      setTimeout(() => setAgentMsg(""), 2000);
    }
  };

  const sendRequest = async () => {
    if (!validate()) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const traceId = uuid("trace");
    const start = performance.now();
    setLoading(true);

    let metaMethod = method;
    let metaFinalUrl = url;

    try {
      // 1) run pre-request script first (can mutate draft)
      const baseDraft = { method, url, params, headers, body, bodyMode, bodyFormUrl, bodyFormData, auth, mode, tests, testScript, preRequestScript };

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
      const draftAfterScript = { ...pre.draft, tests, testScript };
      const draftResolved = applyVarsToRequest(draftAfterScript, envVars);

      const finalUrl = buildFinalUrl(draftResolved.url, draftResolved.params);

      metaMethod = draftResolved.method;
      metaFinalUrl = finalUrl;

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
          bodyMode: draftResolved.bodyMode || "json",
          body:
            !["GET", "HEAD"].includes(draftResolved.method)
              ? (draftResolved.bodyMode === "formurl"
                  ? encodeFormUrl(draftResolved.bodyFormUrl)
                  : draftResolved.bodyMode === "formdata"
                    ? (draftResolved.bodyFormData || []).map((r) => {
                        const k = String(r?.key || "").trim();
                        if (!k) return null;
                        const kind = String(r?.kind || "text").toLowerCase();
                        return kind === "file"
                          ? `${k}=<file:${r?.fileName || "file"}>`
                          : `${k}=${String(r?.value ?? "")}`;
                      }).filter(Boolean).join("&")
                    : (draftResolved.body || ""))
              : "",
        },
      });

      let resStatus, resStatusText, resHeaders, rawText;
      let isBase64 = false;
      let contentType = "";
      let sizeBytes = 0;
      let redirectChain = [];
      let finalResolvedUrl = finalUrl;
      let proxySource = "";

      const execMode = String(draftResolved.mode || "direct").toLowerCase();

      if (execMode === "direct") {
        const options = {
          method: draftResolved.method,
          headers: { ...headerObj },
          signal: controller.signal,
        };

        if (!["GET", "HEAD"].includes(draftResolved.method)) {
          const bm = String(draftResolved.bodyMode || "json").toLowerCase();

          // helper: add header only if user hasn't set it
          const hasContentType = Object.keys(options.headers).some(
            (k) => k.toLowerCase() === "content-type"
          );

          if (bm === "formurl") {
            const enc = encodeFormUrl(draftResolved.bodyFormUrl);
            if (enc.trim().length > 0) {
              options.body = enc;
              if (!hasContentType) options.headers["Content-Type"] = "application/x-www-form-urlencoded";
            }
          } else if (bm === "formdata") {
            // Multipart: build FormData (text + file)
            const fd = new FormData();
            for (const r of draftResolved.bodyFormData || []) {
              if (!r || r.enabled === false) continue;
              const key = String(r.key || "").trim();
              if (!key) continue;

              const kind = String(r.kind || "text").toLowerCase();
              if (kind === "file") {
                const file = getFile(r.fileRefId);
                if (!file) throw new Error(`File not attached for form-data field: ${key}. Reattach in Body tab.`);
                fd.append(key, file, file.name);
              } else {
                fd.append(key, String(r.value ?? ""));
              }
            }
            // do not set content-type for FormData (browser sets boundary)
            options.headers = deleteHeaderCI(options.headers, "content-type");
            options.body = fd;
          } else if (bm === "text") {
            const b = String(draftResolved.body || "");
            if (b.trim().length > 0) {
              options.body = b;
              if (!hasContentType) options.headers["Content-Type"] = "text/plain";
            }
          } else {
            // json (default)
            const b = String(draftResolved.body || "");
            if (b.trim().length > 0) {
              options.body = b;
              if (!hasContentType) options.headers["Content-Type"] = "application/json";
            }
          }
        }

        const res = await fetch(finalUrl, options);
        resStatus = res.status;
        resStatusText = res.statusText;

        const rHeaders = {};
        res.headers.forEach((value, key) => (rHeaders[key] = value));
        resHeaders = rHeaders;

        rawText = await res.text();
      } else if (execMode === "agent") {
        const bm = String(draftResolved.bodyMode || "json").toLowerCase();
        if (bm === "formdata") {
          throw new Error("Agent mode does not support multipart form-data yet. Use Proxy mode for this request.");
        }

        const base = (agentBaseUrl || AGENT_DEFAULT_BASE_URL).trim().replace(/\/$/, "");
        const tok = String(agentToken || "").trim();
        if (!tok) throw new Error("Agent token missing. Pair the agent first.");

        // Build body in a transport-friendly format (raw / form-url)
        let bodyPayload = { mode: "none" };
        if (!["GET", "HEAD"].includes(draftResolved.method)) {
          if (bm === "formurl") {
            bodyPayload = {
              mode: "form-url",
              items: (draftResolved.bodyFormUrl || []).map((r) => ({
                key: String(r?.key || ""),
                value: String(r?.value ?? ""),
                enabled: r?.enabled !== false,
              })),
            };
          } else {
            bodyPayload = {
              mode: "raw",
              raw: String(draftResolved.body || ""),
              contentType: headerObj?.["Content-Type"] || headerObj?.["content-type"] || "",
            };
          }
        }

        const agentRes = await fetch(`${base}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-bhejo-token": tok },
          signal: controller.signal,
          body: JSON.stringify({
            method: draftResolved.method,
            url: finalUrl,
            headers: Object.entries(headerObj || {}).map(([key, value]) => ({ key, value })),
            body: bodyPayload,
          }),
        });

        const data = await agentRes.json().catch(() => null);
        if (!agentRes.ok || !data?.ok) {
          const msg = data?.error?.message || data?.message || "Agent error";
          throw new Error(msg);
        }

        const r = data.result || {};
        resStatus = r.status;
        resStatusText = r.statusText || "";
        resHeaders = r.headers || {};
        rawText = r.body || "";
        isBase64 = !!r.isBase64;
        contentType = r.contentType || r.headers?.["content-type"] || "";
        sizeBytes = r.sizeBytes || 0;
        redirectChain = Array.isArray(r.redirectChain) ? r.redirectChain : [];
        finalResolvedUrl = r.finalUrl || finalUrl;
        proxySource = r.proxySource || "agent";
      } else {
        const bm = String(draftResolved.bodyMode || "json").toLowerCase();

        // Proxy payload (supports multipart via base64 parts)
        let proxyHeaders = { ...headerObj };
        let isMultipart = false;
        let multipartParts = [];
        let proxyBodyText = "";

        if (!["GET", "HEAD"].includes(draftResolved.method)) {
          if (bm === "formurl") {
            proxyBodyText = encodeFormUrl(draftResolved.bodyFormUrl);
          } else if (bm === "formdata") {
            isMultipart = true;
            proxyHeaders = deleteHeaderCI(proxyHeaders, "content-type");

            for (const r of draftResolved.bodyFormData || []) {
              if (!r || r.enabled === false) continue;
              const name = String(r.key || "").trim();
              if (!name) continue;

              const kind = String(r.kind || "text").toLowerCase();
              if (kind === "file") {
                const file = getFile(r.fileRefId);
                if (!file) throw new Error(`File not attached for form-data field: ${name}. Reattach in Body tab.`);

                const base64 = await fileToBase64(file);
                multipartParts.push({
                  name,
                  kind: "file",
                  filename: file.name,
                  mime: file.type || r.fileType || "application/octet-stream",
                  base64,
                });
              } else {
                multipartParts.push({
                  name,
                  kind: "text",
                  value: String(r.value ?? ""),
                });
              }
            }
          } else {
            // json/text
            proxyBodyText = String(draftResolved.body || "");
          }
        }

        const proxyRes = await fetch(PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            url: finalUrl,
            method: draftResolved.method,
            headers: proxyHeaders,
            body: proxyBodyText,
            isMultipart,
            multipartParts,
            cookieJarEnabled: true,
            cookieJarId: getCookieJarId(),
          }),
        });

        const data = await proxyRes.json();
        if (!proxyRes.ok) throw new Error(data?.error || "Proxy error");

        resStatus = data.status;
        resStatusText = data.statusText || "";
        resHeaders = data.headers || {};
        rawText = data.body || "";
        isBase64 = !!data.isBase64;
        contentType = data.contentType || data.headers?.["content-type"] || "";
        sizeBytes = data.sizeBytes || 0;
        redirectChain = Array.isArray(data.redirectChain) ? data.redirectChain : [];
        finalResolvedUrl = data.finalUrl || finalUrl;
        proxySource = data.proxySource || "proxy";
      }

      const end = performance.now();
      const timeMs = Math.round(end - start);

      let parsedJson = null;
      if (!isBase64) {
        try {
          parsedJson = rawText ? JSON.parse(rawText) : null;
        } catch {
          parsedJson = null;
        }
      }

      const testReport = runAssertions({
        tests: draftResolved.tests || tests,
        response: { status: resStatus, timeMs, json: parsedJson, headers: resHeaders },
      });

      // ✅ Phase 4: JS test script (Safe mode via Web Worker)
      let scriptTestReport = null;
      const script = String(draftResolved.testScript ?? testScript ?? "").trim();
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
            bodyMode: draftResolved.bodyMode || "json",
          body:
            !["GET", "HEAD"].includes(draftResolved.method)
              ? (draftResolved.bodyMode === "formurl"
                  ? encodeFormUrl(draftResolved.bodyFormUrl)
                  : draftResolved.bodyMode === "formdata"
                    ? (draftResolved.bodyFormData || []).map((r) => {
                        const k = String(r?.key || "").trim();
                        if (!k) return null;
                        const kind = String(r?.kind || "text").toLowerCase();
                        return kind === "file"
                          ? `${k}=<file:${r?.fileName || "file"}>`
                          : `${k}=${String(r?.value ?? "")}`;
                      }).filter(Boolean).join("&")
                    : (draftResolved.body || ""))
              : "",
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

      // Phase 6: Keep the last successful exchange for "Save as Example"
      let exchangeObj = null;
      try {
        exchangeObj = {
          createdAt: new Date().toISOString(),
          request: {
            name: (requestName || "").trim(),
            mode: draftResolved.mode || "direct",
            method: draftResolved.method,
            url: draftResolved.url,
            finalUrl,
            headers: headerObj,
            body: !["GET", "HEAD"].includes(draftResolved.method)
              ? { mode: bodyMode, body: draftResolved.body || "", formUrl: bodyFormUrl, formData: bodyFormData }
              : { mode: "none" },
            params: draftResolved.params,
            auth: draftResolved.auth,
          },
          response: {
            ok: true,
            status: resStatus,
            statusText: resStatusText,
            timeMs,
            headers: resHeaders,
            rawText,
            json: parsedJson,
            isBase64,
            contentType,
            sizeBytes,
            redirectChain,
            finalUrl: finalResolvedUrl,
            proxySource: execMode === "direct" ? "off" : (proxySource || execMode),
          },
        };
        lastExchangeRef.current = exchangeObj;
      } catch {
        // ignore
      }

      onResponse?.({
        ok: true,
        status: resStatus,
        statusText: resStatusText,
        timeMs,
        headers: resHeaders,
        rawText,
        json: parsedJson,
        isBase64,
        contentType,
        sizeBytes,
        redirectChain,
        finalUrl: finalResolvedUrl,
        proxySource: execMode === "direct" ? "off" : (proxySource || execMode),
        testReport,
        scriptTestReport,
        exchange: exchangeObj,
      });


      pushConsoleEvent({
        level: "info",
        type: "response",
        data: {
          traceId,
          source: "requestBuilder",
          name: (requestName || "").trim(),
          method: metaMethod,
          finalUrl: metaFinalUrl,
          status: resStatus,
          timeMs,
          headers: resHeaders,
          body: isBase64 ? `<base64:${sizeBytes || 0} bytes>` : rawText,
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
        bodyMode: draftResolved.bodyMode || "json",
        bodyFormUrl: draftResolved.bodyFormUrl || [],
        bodyFormData: draftResolved.bodyFormData || [],
        auth: draftResolved.auth,
        tests,
        testScript,
        dataRows,
        mode: draftResolved.mode || "direct",
        preRequestScript,
        docText,
        examples,
        defaultExampleId,
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
          method: metaMethod,
          finalUrl: metaFinalUrl,
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
        bodyMode,
        bodyFormUrl,
        bodyFormData,
        auth,
        tests,
        testScript,
        dataRows,
        mode,
        preRequestScript,
        docText,
        examples,
        defaultExampleId,
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
      bodyMode,
      bodyFormUrl,
      bodyFormData,
      auth,
      tests,
      testScript,
      dataRows,
      mode,
      preRequestScript,
      docText,
      examples,
      defaultExampleId,
    });
  };

  // copyMenuOutsideClick: close Copy menu on outside click / ESC
  useEffect(() => {
    function onDown(e) {
      if (!copyMenuOpen) return;
      const menuEl = copyMenuRef.current;
      const splitEl = copySplitRef.current;
      if (menuEl && menuEl.contains(e.target)) return;
      if (splitEl && splitEl.contains(e.target)) return;
      setCopyMenuOpen(false);
    }
    function onKey(e) {
      if (!copyMenuOpen) return;
      if (e.key === "Escape") setCopyMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [copyMenuOpen]);

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
    // decide body mode based on body content
    const t = String(parsed.body || "").trim();
    if (!t) { setBodyMode("json"); setBodyError(""); }
    else {
      try { JSON.parse(t); setBodyMode("json"); setBodyError(""); }
      catch { setBodyMode("text"); setBodyError(""); }
    }
    setBodyFormUrl(ensureKvRowsEnabled([]));
    setBodyFormData(ensureFormDataRows([]));
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
      bodyMode: (() => { const t = String(parsed.body || "").trim(); if (!t) return "json"; try { JSON.parse(t); return "json"; } catch { return "text"; } })(),
      bodyFormUrl: ensureKvRowsEnabled([]),
      bodyFormData: ensureFormDataRows([]),
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
                    <button className="btn btnPrimary btnSendPrimary" onClick={applyImport}>
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={closeImport}>
                  Cancel
                </button>
                <button className="btn btnPrimary btnSendPrimary" onClick={applyImport}>
                  {importPreview ? "Apply" : "Parse"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="row rowHeader">
        <div className="headerLeft">
          {breadcrumb?.length ? (
            <div className="reqBreadcrumbBar" title={crumbText}>
              <span className="reqCrumbBadge">HTTP</span>
              <div className="reqCrumbTrail">
                {breadcrumb.map((b, i) => {
                  const isLast = i === breadcrumb.length - 1;
                  if (isLast) {
                    return (
                      <span key={`${b.type}-${b.nodeId || i}`} className="reqCrumbCurrent">
                        {b.label}
                      </span>
                    );
                  }
                  return (
                    <span key={`${b.type}-${b.nodeId || i}`} className="reqCrumbSeg">
                      <button
                        type="button"
                        className="reqCrumbLink"
                        onClick={() => navigateCrumb(b)}
                      >
                        {b.label}
                      </button>
                      <span className="reqCrumbSep">/</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="nameLine">
            <input
              className="input inputName"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              placeholder="Label (optional)"
            />
            {crumbText ? (
              <div className="reqCrumbInline" title={crumbText}>
                {crumbText}
              </div>
            ) : null}
          </div>
<div className="envBadgePro">
            <span className="envChip envChipLabel">Env</span>
            <span className="envChip envChipName envChipSelectWrap" title="Change environment">
              <select
                className="envChipSelect"
                value={envName}
                onChange={(e) => setEnvName(e.target.value)}
                aria-label="Select environment"
              >
                {(envNames && envNames.length ? envNames : [envName]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <svg className="envChipCaret" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            {envBadge.baseUrl ? (
              <span className="envChip envChipValue" title={envBadge.baseUrl}>
                {envBadge.baseUrl}
              </span>
            ) : null}
          </div>
        </div>

        <div className="headerActions">
                    <button className="btn btnSm" onClick={openImport} disabled={loading} title="Import a request snippet">
                      Import
                    </button>
          
                    <div className="btnSplit" ref={copySplitRef}>
                      <button
                        className="btn btnSm btnIconMain"
                        onClick={() => copyAs()}
                        disabled={loading}
                        title={`Copy (${copyFormat})`}
                        type="button"
                        aria-label={`Copy (${copyFormat})`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 9l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M16 9l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M13 7l-2 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
          
                      <button
                        className="btn btnSm btnIcon"
                        type="button"
                        onClick={() => setCopyMenuOpen((v) => !v)}
                        disabled={loading}
                        aria-label="Copy format"
                        title="Copy format"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
          
                      {copyMenuOpen && (
                        <div className="menu menuDown" ref={copyMenuRef} role="menu">
                          <button
                            type="button"
                            className="menuItem"
                            onClick={() => {
                              setCopyMenuOpen(false);
                              setCopyFormat("curl");
                              copyAs("curl");
                            }}
                          >
                            Copy as cURL
                          </button>
          
                          <button
                            type="button"
                            className="menuItem"
                            onClick={() => {
                              setCopyMenuOpen(false);
                              setCopyFormat("fetch");
                              copyAs("fetch");
                            }}
                          >
                            Copy as Fetch
                          </button>
          
                          <button
                            type="button"
                            className="menuItem"
                            onClick={() => {
                              setCopyMenuOpen(false);
                              setCopyFormat("axios");
                              copyAs("axios");
                            }}
                          >
                            Copy as Axios
                          </button>
                        </div>
                      )}
                    </div>
          
                    <button className="btn btnSm" onClick={saveRequest} disabled={loading} title="Save request">
                      Save
                    </button>
        </div>
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

      <div className="row rowUrl">
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

        <button className="btn btnPrimary btnSendPrimary" onClick={sendRequest} disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>

        <button
          className="btn btnCancelInline"
          onClick={cancelRequest}
          disabled={!loading}
          title="Cancel in-flight request"
        >
          Cancel
        </button>

        

      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="smallMuted" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ whiteSpace: "nowrap" }}>Final URL:</span>
          <span style={{ fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {finalUrlPreview}
          </span>

          <button
            type="button"
            className="btn btnSm btnIcon"
            onClick={() => {
              setResolveTab("url");
              setShowResolvePreview((v) => !v);
            }}
            title="Resolve preview (vars)"
            aria-label="Resolve preview"
            style={{ gap: 6 }}
          >
            <span aria-hidden="true">{"</>"}</span>
            <span>Resolve</span>
            {missingCount > 0 ? (
              <span
                className="badge"
                style={{
                  marginLeft: 6,
                  background: "rgba(255, 70, 70, 0.15)",
                  border: "1px solid rgba(255, 70, 70, 0.35)",
                  color: "var(--danger)",
                }}
                title={`Missing variables: ${missingKeys.join(", ")}`}
              >
                {missingCount}
              </span>
            ) : usedKeys.length ? (
              <span
                className="badge"
                style={{
                  marginLeft: 6,
                  background: "rgba(46, 204, 113, 0.14)",
                  border: "1px solid rgba(46, 204, 113, 0.35)",
                  color: "var(--success)",
                }}
                title={`Resolved variables: ${resolvedKeys.length}`}
              >
                ✓
              </span>
            ) : null}
          </button>
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
          <button
            className={`tab ${mode === "agent" ? "tabActive" : ""}`}
            onClick={() => setMode("agent")}
            title="Use Bhejo Agent to reach internal network APIs"
          >
            Agent
          </button>
        </div>
      </div>

      {mode === "agent" ? (
        <div className="card" style={{ padding: 12, marginTop: 10 }}>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Bhejo Agent</div>
            <span className="smallMuted">Local bridge for intranet-only APIs</span>
            {agentToken ? (
              <span className="badge" style={{ background: "rgba(46, 204, 113, 0.14)", border: "1px solid rgba(46, 204, 113, 0.35)", color: "var(--success)" }}>
                Paired
              </span>
            ) : (
              <span className="badge" style={{ background: "rgba(255, 70, 70, 0.15)", border: "1px solid rgba(255, 70, 70, 0.35)", color: "var(--danger)" }}>
                Not paired
              </span>
            )}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 260, flex: 1 }}>
              <div className="smallMuted" style={{ marginBottom: 6 }}>Agent base URL</div>
              <input
                className="input"
                value={agentBaseUrl}
                onChange={(e) => setAgentBaseUrl(e.target.value)}
                placeholder={AGENT_DEFAULT_BASE_URL}
              />
            </div>

            <div style={{ minWidth: 200 }}>
              <div className="smallMuted" style={{ marginBottom: 6 }}>Pair code</div>
              <input
                className="input"
                value={agentPairCode}
                onChange={(e) => setAgentPairCode(e.target.value)}
                placeholder="e.g. 56115c93"
              />
            </div>

            <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
              <button className="btn" type="button" onClick={pairAgent} disabled={agentBusy}>
                Pair
              </button>
              <button
                className="btn btnSm"
                type="button"
                onClick={() => {
                  setAgentToken("");
                  setAgentMsg("Unpaired");
                  setTimeout(() => setAgentMsg(""), 1500);
                }}
                disabled={agentBusy || !agentToken}
              >
                Unpair
              </button>
            </div>
          </div>

          {agentMsg ? <div className="smallMuted" style={{ marginTop: 8 }}>{agentMsg}</div> : null}

          <AgentConfigPanel
            baseUrl={agentBaseUrl}
            token={agentToken}
            onBaseUrl={setAgentBaseUrl}
            onToken={setAgentToken}
          />
        </div>
      ) : null}

{showResolvePreview ? (
  <div className="card" style={{ padding: 12, marginTop: 10 }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>Resolve preview</div>
        {missingCount > 0 ? (
          <span
            className="badge"
            style={{
              background: "rgba(255, 70, 70, 0.15)",
              border: "1px solid rgba(255, 70, 70, 0.35)",
              color: "var(--danger)",
            }}
          >
            Missing: {missingCount}
          </span>
        ) : usedKeys.length ? (
          <span
            className="badge"
            style={{
              background: "rgba(46, 204, 113, 0.14)",
              border: "1px solid rgba(46, 204, 113, 0.35)",
              color: "var(--success)",
            }}
          >
            All set
          </span>
        ) : (
          <span className="smallMuted">No variables used</span>
        )}
      </div>

      <button className="btn btnSm" type="button" onClick={() => setShowResolvePreview(false)}>
        Close
      </button>
    </div>

    <div className="tabs" style={{ marginTop: 10 }}>
      <button
        className={`tab ${resolveTab === "url" ? "tabActive" : ""}`}
        type="button"
        onClick={() => setResolveTab("url")}
      >
        URL
      </button>
      <button
        className={`tab ${resolveTab === "headers" ? "tabActive" : ""}`}
        type="button"
        onClick={() => setResolveTab("headers")}
      >
        Headers
      </button>
      <button
        className={`tab ${resolveTab === "body" ? "tabActive" : ""}`}
        type="button"
        onClick={() => setResolveTab("body")}
      >
        Body
      </button>
    </div>

    <div style={{ marginTop: 10 }}>
      {resolveTab === "url" ? (
        <div className="monoBox">
          <VarSegments segments={urlSegments} />
        </div>
      ) : resolveTab === "headers" ? (
        <div className="monoBox">
          {headersPreview.length ? (
            headersPreview.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ opacity: 0.9 }}>
                  <VarSegments segments={h.keySegments} />
                </span>
                <span style={{ opacity: 0.6 }}>:</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <VarSegments segments={h.valueSegments} />
                </span>
              </div>
            ))
          ) : (
            <span className="smallMuted">No headers</span>
          )}
        </div>
      ) : (
        <div className="monoBox">
          {bodyPreviewText ? <VarSegments segments={bodySegments} /> : <span className="smallMuted">No body</span>}
        </div>
      )}
    </div>

    {missingCount > 0 ? (
      <div style={{ marginTop: 10 }}>
        <div className="smallMuted">Missing variables</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {missingKeys.map((k) => (
            <span
              key={k}
              style={{
                fontFamily: "var(--mono)",
                background: "rgba(255, 70, 70, 0.15)",
                border: "1px solid rgba(255, 70, 70, 0.35)",
                color: "var(--danger)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {`{{${k}}}`}
            </span>
          ))}
        </div>
      </div>
    ) : null}
  </div>
) : null}

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
        <button className={`tab ${tab === "docs" ? "tabActive" : ""}`} onClick={() => setTab("docs")}>
          Docs
        </button>
      </div>

      {tab === "params" && <QueryParamsEditor params={params} setParams={setParams} />}
      {tab === "auth" && <AuthEditor auth={auth} setAuth={setAuth} />}
      {tab === "headers" && <HeadersEditor headers={headers} setHeaders={setHeaders} />}
      {tab === "body" && (
        <BodyEditor
          method={method}
          bodyMode={bodyMode}
          setBodyMode={setBodyMode}
          body={body}
          setBody={setBody}
          bodyError={bodyError}
          setBodyError={setBodyError}
          formUrlRows={bodyFormUrl}
          setFormUrlRows={setBodyFormUrl}
          formDataRows={bodyFormData}
          setFormDataRows={setBodyFormData}
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