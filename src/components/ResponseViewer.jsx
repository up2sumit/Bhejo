import { useEffect, useMemo, useRef, useState } from "react";

function safePrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function tryParseJson(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  // Already array of pairs
  if (Array.isArray(headers)) {
    return headers.map(([k, v]) => [String(k), String(v)]);
  }
  // Headers instance
  if (typeof headers?.forEach === "function") {
    const out = [];
    try {
      headers.forEach((v, k) => out.push([String(k), String(v)]));
      return out;
    } catch {
      // fallthrough
    }
  }
  // Plain object
  return Object.entries(headers).map(([k, v]) => [String(k), String(v)]);
}

function computeRawText(res) {
  if (!res) return "";
  if (res.isBase64) return "";
  if (typeof res.rawText === "string") return res.rawText;

  if (typeof res.body === "string") return res.body;

  if (res.body && typeof res.body === "object") {
    const pretty = safePrettyJson(res.body);
    if (pretty) return pretty;
  }

  if (res.json !== null && res.json !== undefined) {
    const pretty = safePrettyJson(res.json);
    if (pretty) return pretty;
  }

  return "";
}

function guessIsOk(res) {
  if (!res) return false;
  if (res.ok === true) return true;
  if (res.ok === false) return false;
  if (typeof res.status === "number") return res.status >= 200 && res.status < 300;
  return false;
}

function findMatches(text, query) {
  const q = String(query || "");
  const t = String(text || "");
  if (!q.trim() || !t) return [];
  const needle = q.toLowerCase();
  const hay = t.toLowerCase();

  const out = [];
  let idx = 0;
  while (idx < hay.length) {
    const at = hay.indexOf(needle, idx);
    if (at === -1) break;
    out.push([at, at + needle.length]);
    idx = at + Math.max(1, needle.length);
    if (out.length > 2000) break; // safety
  }
  return out;
}

function copyText(text) {
  const t = String(text || "");
  if (!t) return Promise.resolve(false);

  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(t)
      .then(() => true)
      .catch(() => false);
  }

  // Fallback
  try {
    const el = document.createElement("textarea");
    el.value = t;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

function isImageContentType(ct) {
  const t = String(ct || "").toLowerCase();
  return t.startsWith("image/");
}

function base64ToBlob(base64, mime = "application/octet-stream") {
  const b64 = String(base64 || "");
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function guessFilename({ filename, contentType } = {}) {
  const fn = String(filename || "").trim();
  if (fn) return fn;

  const ct = String(contentType || "").toLowerCase();
  if (ct.startsWith("image/")) {
    const ext = ct.split("/")[1] || "png";
    return `response.${ext.replace(/[^a-z0-9]+/g, "") || "png"}`;
  }
  if (ct.includes("pdf")) return "response.pdf";
  if (ct.includes("zip")) return "response.zip";
  return "response.bin";
}

function triggerDownloadFromBase64({ base64, contentType, filename }) {
  const blob = base64ToBlob(base64, contentType || "application/octet-stream");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = guessFilename({ filename, contentType });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}


function HighlightedPre({ text, matches, activeIndex, onActiveRef }) {
  const markRefs = useRef([]);

  // reset refs each render
  markRefs.current = [];

  useEffect(() => {
    if (typeof onActiveRef === "function") {
      onActiveRef(markRefs.current[activeIndex] || null);
    }
  }, [matches, activeIndex, onActiveRef]);

  if (!matches || matches.length === 0) {
    return <pre className="responseBody">{text || "(empty)"}</pre>;
  }

  const chunks = [];
  let cur = 0;

  for (let i = 0; i < matches.length; i++) {
    const [s, e] = matches[i];
    if (s > cur) chunks.push({ t: text.slice(cur, s), m: false });
    chunks.push({ t: text.slice(s, e), m: true, i });
    cur = e;
  }
  if (cur < text.length) chunks.push({ t: text.slice(cur), m: false });

  

  async function addAllCookiesToJar() {
    if (!setCookiesArr.length) return;
    if (!requestUrlForSave) {
      setToast({ msg: "Cannot save cookies: missing request URL." });
      return;
    }
    try {
      for (const sc of setCookiesArr) {
        await fetch(`${proxyBase}/cookiejar/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jarId: jarIdForSave, setCookie: String(sc), url: requestUrlForSave }),
        });
      }
      setToast({ msg: `Saved ${setCookiesArr.length} cookie(s) to jar "${jarIdForSave}".` });
    } catch (e) {
      setToast({ msg: e?.message || "Failed to save cookies" });
    }
  }

  async function addCookieToJar(sc) {
    if (!sc) return;
    if (!requestUrlForSave) {
      setToast({ msg: "Cannot save cookie: missing request URL." });
      return;
    }
    try {
      await fetch(`${proxyBase}/cookiejar/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jarId: jarIdForSave, setCookie: String(sc), url: requestUrlForSave }),
      });
      setToast({ msg: `Saved cookie to jar "${jarIdForSave}".` });
    } catch (e) {
      setToast({ msg: e?.message || "Failed to save cookie" });
    }
  }
return (
    <pre className="responseBody">
      {chunks.map((c, idx) => {
        if (!c.m) return <span key={idx}>{c.t}</span>;
        const isActive = c.i === activeIndex;
        return (
          <mark
            key={idx}
            className={`respMark ${isActive ? "active" : ""}`}
            ref={(el) => {
              markRefs.current[c.i] = el;
            }}
          >
            {c.t}
          </mark>
        );
      })}
    </pre>
  );
}

function formatKey(k) {
  if (typeof k === "number") return `[${k}]`;
  return k;
}

function makeChildPath(base, key) {
  if (base === "$") {
    if (typeof key === "number") return `$[${key}]`;
    return `$.${key}`;
  }
  if (typeof key === "number") return `${base}[${key}]`;
  return `${base}.${key}`;
}

function JsonTree({ value, onCopyPath }) {
  const [open, setOpen] = useState(() => new Set(["$"]));

  useEffect(() => {
    // reset expansion when value changes
    setOpen(new Set(["$"]));
  }, [value]);

  const toggle = (path) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const Row = ({ path, label, node, level }) => {
    const isObj = node && typeof node === "object";
    const isArr = Array.isArray(node);
    const isExpandable = isObj && (isArr ? node.length > 0 : Object.keys(node).length > 0);
    const isOpen = open.has(path);

    let valuePreview = "";
    if (!isObj) {
      if (typeof node === "string") valuePreview = `"${node}"`;
      else if (node === null) valuePreview = "null";
      else valuePreview = String(node);
    } else {
      if (isArr) valuePreview = `Array(${node.length})`;
      else valuePreview = `Object(${Object.keys(node).length})`;
    }

    return (
      <div
        className="jsonRow"
        style={{ paddingLeft: 10 + level * 14 }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCopyPath?.(path);
        }}
        title="Right click to copy JSON path"
      >
        <button
          className={`jsonTwisty ${isExpandable ? "" : "disabled"}`}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isExpandable) toggle(path);
          }}
          aria-label={isOpen ? "Collapse" : "Expand"}
          disabled={!isExpandable}
        >
          {isExpandable ? (isOpen ? "▾" : "▸") : "•"}
        </button>

        <div className="jsonKey mono">
          <span className="jsonKeyText">{label}</span>
        </div>

        <div className={`jsonValue mono ${!isObj ? "prim" : ""}`}>{valuePreview}</div>
      </div>
    );
  };

  const renderNode = (node, path, label, level) => {
    const rows = [<Row key={path} path={path} label={label} node={node} level={level} />];

    const isObj = node && typeof node === "object";
    if (!isObj) return rows;

    const isArr = Array.isArray(node);
    const isOpen = open.has(path);
    if (!isOpen) return rows;

    if (isArr) {
      node.forEach((child, i) => {
        rows.push(...renderNode(child, makeChildPath(path, i), formatKey(i), level + 1));
      });
    } else {
      Object.keys(node).forEach((k) => {
        rows.push(...renderNode(node[k], makeChildPath(path, k), k, level + 1));
      });
    }
    return rows;
  };

  return <div className="jsonTree">{renderNode(value, "$", "$", 0)}</div>;
}

export default function ResponseViewer({ response, onSaveExample, canSaveExample }) {
  const [cookieSentFilter, setCookieSentFilter] = useState("");
  const [cookieShowExcluded, setCookieShowExcluded] = useState(false);

  const [tab, setTab] = useState("body");
  const [bodyMode, setBodyMode] = useState("pretty"); // pretty | raw | preview

  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeHit, setActiveHit] = useState(0);

  const [toast, setToast] = useState(null); // {msg}


  const buildSuggestedExampleName = (exchange) => {
    const method = String(exchange?.request?.method || "GET").toUpperCase();
    const url = exchange?.request?.finalUrl || exchange?.request?.url || "";
    let pathPart = "Example";
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean).slice(-1)[0] || "";
      pathPart = seg ? seg : u.hostname;
    } catch {
      const seg = String(url).split("?")[0].split("/").filter(Boolean).slice(-1)[0] || "";
      if (seg) pathPart = seg;
    }
    const status = exchange?.response?.status ? ` ${exchange.response.status}` : "";
    return `${method} ${pathPart}${status}`.trim();
  };

  const handleSaveExampleClick = () => {
    const exg = response?.exchange;
    if (!exg || typeof onSaveExample !== "function") return;

    const suggested = buildSuggestedExampleName(exg);
    const name = window.prompt("Example name", suggested);
    if (name === null) return;

    const example = {
      id: `ex_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: String(name || "").trim() || suggested,
      createdAt: new Date().toISOString(),
      request: exg.request || null,
      response: exg.response || null,
    };

    onSaveExample(example);
    setToast({ msg: "Saved example to Docs." });
    setTimeout(() => setToast(null), 1600);
  };

  // Reset to Body when a new response arrives (Postman-like)
  useEffect(() => {
    if (!response) return;
    setTab("body");
    const raw = computeRawText(response);
    const isJson = (response.json !== null && response.json !== undefined) || !!tryParseJson(raw);
    setBodyMode(isJson ? "pretty" : "raw");
    setSearchOpen(false);
    setQuery("");
    setActiveHit(0);
  }, [response?.traceId, response?.timeMs, response?.status, response?.ok]);

  const ok = useMemo(() => guessIsOk(response), [response]);

  const statusPillClass = useMemo(() => {
    if (!response) return "statusPill";
    if (ok) return "statusPill ok";
    return "statusPill bad";
  }, [response, ok]);

  const headersArr = useMemo(() => normalizeHeaders(response?.headers), [response?.headers]);

  const setCookiesArr = useMemo(() => {
    const sc = response?.setCookie || response?.exchange?.response?.setCookie || [];
    if (Array.isArray(sc)) return sc.filter(Boolean);
    const h = response?.headers?.["set-cookie"] || response?.headers?.["set-cookie".toLowerCase()];
    return h ? [String(h)] : [];
  }, [response]);



  const cookieSentCookies =
    response?.cookieSentCookies ||
    response?.exchange?.response?.cookieSentCookies ||
    [];

  const cookieExcludedCookies =
    response?.cookieExcludedCookies ||
    response?.exchange?.response?.cookieExcludedCookies ||
    [];


  const cookieSentHeader =
    response?.cookieSentHeader ||
    response?.exchange?.response?.cookieSentHeader ||
    "";

  const cookieSentFrom =
    response?.cookieSentFrom ||
    response?.exchange?.response?.cookieSentFrom ||
    "";

  const cookieSentCount =
    response?.cookieSentCount ||
    response?.exchange?.response?.cookieSentCount ||
    (cookieSentHeader ? cookieSentHeader.split(";").filter(Boolean).length : 0);


  const jarIdForSave =
    response?.jarId ||
    response?.cookieJar?.jarId ||
    response?.exchange?.response?.jarId ||
    response?.exchange?.response?.cookieJar?.jarId ||
    response?.exchange?.request?.cookieJarId ||
    "default";

  const requestUrlForSave =
    response?.exchange?.request?.finalUrl ||
    response?.exchange?.request?.url ||
    response?.request?.finalUrl ||
    response?.request?.url ||
    "";

  const proxyBase = useMemo(() => {
    const u = import.meta.env.VITE_PROXY_URL || "http://localhost:3001/proxy";
    return String(u).replace(/\/proxy\/?$/i, "");
  }, []);


  const rawText = useMemo(() => computeRawText(response), [response]);

  const contentType = useMemo(() => {
    if (!response) return "";
    const direct = response.contentType || response.mimeType || response.mime;
    if (direct) return String(direct);
    const pair = headersArr.find(([k]) => String(k).toLowerCase() === "content-type");
    return pair ? String(pair[1] || "") : "";
  }, [response, headersArr]);

  const isBinary = useMemo(() => {
    if (!response) return false;
    if (response.isBase64) return true;
    if (typeof response.bodyBase64 === "string" && response.bodyBase64.length > 0) return true;
    return false;
  }, [response]);

  const isImage = useMemo(() => {
    return isBinary && isImageContentType(contentType);
  }, [isBinary, contentType]);

  const jsonValue = useMemo(() => {
    if (!response) return null;
    if (response.json !== null && response.json !== undefined) return response.json;
    const parsed = tryParseJson(rawText);
    return parsed;
  }, [response, rawText]);

  const prettyText = useMemo(() => {
    if (!response) return "";
    if (jsonValue !== null && jsonValue !== undefined) {
      const pretty = safePrettyJson(jsonValue);
      if (pretty) return pretty;
    }
    return rawText || "";
  }, [response, rawText, jsonValue]);

  const rawBodyText = useMemo(() => {
    if (!response) return "";
    // Use rawText if present; else fallback
    return rawText || "";
  }, [response, rawText]);

  const activeText = useMemo(() => {
    if (tab !== "body") return "";
    if (bodyMode === "pretty") return prettyText;
    if (bodyMode === "raw") return rawBodyText;
    return "";
  }, [tab, bodyMode, prettyText, rawBodyText]);

  const matches = useMemo(() => findMatches(activeText, query), [activeText, query]);

  useEffect(() => {
    setActiveHit(0);
  }, [query, bodyMode, tab]);

  const sizeBytes = useMemo(() => {
    if (typeof response?.sizeBytes === "number" && response.sizeBytes > 0) return response.sizeBytes;

    if (response?.isBase64 && typeof response?.bodyBase64 === "string") {
      // base64 size ≈ 3/4 of length (minus padding). Good enough for UI.
      const b64 = response.bodyBase64;
      if (!b64) return 0;
      const pad = (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
      return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
    }

    const t = rawText || "";
    if (!t) return 0;
    try {
      return new Blob([t]).size;
    } catch {
      return 0;
    }
  }, [response, rawText]);

  const sizeLabel = useMemo(() => {
    const n = sizeBytes;
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }, [sizeBytes]);

  const contentTypePill = isImage ? "Image" : isBinary ? "Binary" : (jsonValue !== null && jsonValue !== undefined ? "JSON" : "Text");

  const showBodySubTabs = tab === "body";

  const showPreview = (jsonValue !== null && jsonValue !== undefined) || isImage;

  const scrollToActive = (el) => {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // ignore
    }
  };

  const openSearch = () => {
    if (tab !== "body") return;
    if (isBinary) return;
    // If in Preview, switch to Pretty for text searching (Postman-ish)
    if (bodyMode === "preview") setBodyMode("pretty");
    setSearchOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const nextHit = () => {
    if (!matches.length) return;
    setActiveHit((i) => (i + 1) % matches.length);
  };

  const prevHit = () => {
    if (!matches.length) return;
    setActiveHit((i) => (i - 1 + matches.length) % matches.length);
  };

  const handleKeyDown = (e) => {
    // Ctrl/Cmd+F to open local search when ResponseViewer has focus
    const k = String(e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "f") {
      if (tab === "body") {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      }
    }
    if (k === "escape" && searchOpen) {
      setSearchOpen(false);
      setQuery("");
      setActiveHit(0);
    }
    if (k === "enter" && searchOpen) {
      // enter cycles next match
      if (e.shiftKey) prevHit();
      else nextHit();
    }
  };

  const showToast = (msg) => {
    setToast({ msg });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 1400);
  };

  if (!response) {
    return <div className="smallMuted">No response yet. Send a request.</div>;
  }

  // Error view
  if (response.ok === false && !ok) {
    return (
      <div className="responseWrap" ref={wrapRef} tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>Error</div>
            <span className="badge badgeErr">{response.errorName || "Error"}</span>
          </div>

          <div className="smallMuted" style={{ marginTop: 10 }}>
            {response.errorMessage || "Request failed"}
          </div>

          {typeof response.timeMs === "number" ? (
            <div className="smallMuted" style={{ marginTop: 8 }}>
              Time: <span style={{ fontFamily: "var(--mono)" }}>{response.timeMs} ms</span>
            </div>
          ) : null}
        </div>

        {(response.rawText || response.errorStack) ? (
          <pre className="responseBody">{response.rawText || response.errorStack}</pre>
        ) : null}
      </div>
    );
  }

  const TabBtn = ({ id, label, hasDot }) => (
    <button
      className={`tabBtn ${tab === id ? "active" : ""} ${hasDot ? "tabDanger" : ""}`}
      onClick={() => setTab(id)}
      type="button"
      title={label}
    >
      {label}
      {hasDot ? <span className="tabDotDanger" aria-hidden="true" /> : null}
    </button>
  );

  const SubTabBtn = ({ id, label, disabled }) => (
    <button
      className={`subTabBtn ${bodyMode === id ? "active" : ""}`}
      onClick={() => !disabled && setBodyMode(id)}
      type="button"
      disabled={disabled}
      title={label}
    >
      {label}
    </button>
  );

  const builderTotal = response?.testReport?.total ?? 0;
  const builderPassed = response?.testReport?.passed ?? 0;

  const scriptTotal = response?.scriptTestReport?.total ?? 0;
  const scriptPassed = response?.scriptTestReport?.passed ?? 0;

  const anyTestFail =
    (builderTotal && builderPassed < builderTotal) ||
    (scriptTotal && scriptPassed < scriptTotal) ||
    response?.scriptTestReport?.scriptError;

  return (
    <div className="responseWrap" ref={wrapRef} tabIndex={0} onKeyDown={handleKeyDown}>
      {/* Summary row */}
      <div className="responseTop">
        <div className="responseMeta">
          <span className={statusPillClass}>
            {response.status} {response.statusText || ""}
          </span>
          {typeof response.timeMs === "number" ? (
            <span className="metaPill">{response.timeMs} ms</span>
          ) : null}
          {sizeLabel ? <span className="metaPill">{sizeLabel}</span> : null}
          <span className="metaPill">{contentTypePill}</span>
        </div>

        <div className="responseActions">
          {canSaveExample && response?.exchange ? (
            <button className="btn btnSm btnPrimary" type="button" onClick={handleSaveExampleClick} title="Save this response as an example (Docs)">
              Save example
            </button>
          ) : null}
{isBinary ? (
  <button
    className="btn btnSm"
    type="button"
    onClick={() =>
      triggerDownloadFromBase64({
        base64: response.bodyBase64,
        contentType,
        filename: response.filename,
      })
    }
    title="Download response body"
    disabled={!response?.bodyBase64}
  >
    Download
  </button>
) : null}
<button className="btn btnSm" type="button" onClick={openSearch} title="Find in body (Ctrl+F)" disabled={isBinary}>
  Find
</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="responseTabs">
        <TabBtn id="body" label="Body" />
        <TabBtn id="headers" label={`Headers (${headersArr.length})`} />
        <TabBtn id="cookies" label={`Cookies${(setCookiesArr.length ? ` (${setCookiesArr.length})` : "")}`} hasDot={false} />
        <TabBtn
          id="tests"
          label={`Tests${builderTotal + scriptTotal ? ` (${builderPassed + scriptPassed}/${builderTotal + scriptTotal})` : ""}`}
          hasDot={!!anyTestFail}
        />
      </div>

      {/* Body sub-tabs + search */}
      {showBodySubTabs ? (
        <div className="responseSubBar">
          <div className="responseSubTabs">
            <SubTabBtn id="pretty" label="Pretty" />
            <SubTabBtn id="raw" label="Raw" />
            <SubTabBtn id="preview" label="Preview" disabled={!showPreview} />
          </div>

          {searchOpen ? (
            <div className="respSearch">
              <input
                ref={searchRef}
                className="input respSearchInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search (Enter = next, Shift+Enter = prev)"
              />
              <div className="respSearchMeta smallMuted">
                {query.trim() ? (
                  <span className="mono">
                    {matches.length ? `${activeHit + 1}/${matches.length}` : "0/0"}
                  </span>
                ) : (
                  <span className="mono">0/0</span>
                )}
              </div>
              <button className="btn btnSm" type="button" onClick={prevHit} disabled={!matches.length}>
                ↑
              </button>
              <button className="btn btnSm" type="button" onClick={nextHit} disabled={!matches.length}>
                ↓
              </button>
              <button
                className="btn btnSm"
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                  setActiveHit(0);
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="respSearchHint smallMuted">Ctrl+F</div>
          )}
        </div>
      ) : null}

      {/* Panel */}
      <div className="responsePanel">
        {tab === "body" && (
          <>
            {isBinary ? (
              isImage && bodyMode === "preview" ? (
                <div style={{ padding: 10 }}>
                  <div className="smallMuted" style={{ marginBottom: 8 }}>
                    Image preview
                  </div>
                  <img
                    src={`data:${contentType || "image/*"};base64,${response.bodyBase64 || ""}`}
                    alt={guessFilename({ filename: response.filename, contentType })}
                    style={{ maxWidth: "100%", borderRadius: 12 }}
                  />
                </div>
              ) : (
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Binary response</div>
                  <div className="smallMuted">
                    Content-Type: <span className="mono">{contentType || "application/octet-stream"}</span>
                  </div>
                  {response.filename ? (
                    <div className="smallMuted">
                      Filename: <span className="mono">{response.filename}</span>
                    </div>
                  ) : null}
                  {sizeLabel ? (
                    <div className="smallMuted">
                      Size: <span className="mono">{sizeLabel}</span>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn btnSm btnPrimary"
                      type="button"
                      onClick={() =>
                        triggerDownloadFromBase64({
                          base64: response.bodyBase64,
                          contentType,
                          filename: response.filename,
                        })
                      }
                      disabled={!response?.bodyBase64}
                    >
                      Download
                    </button>

                    {isImage ? (
                      <button className="btn btnSm" type="button" onClick={() => setBodyMode("preview")}>
                        Preview image
                      </button>
                    ) : null}
                  </div>

                  <div className="smallMuted" style={{ marginTop: 10 }}>
                    Tip: Postman-style preview is supported for images. Other binary types are downloadable.
                  </div>
                </div>
              )
            ) : bodyMode === "preview" && showPreview ? (
              <JsonTree
                value={jsonValue}
                onCopyPath={async (path) => {
                  const ok = await copyText(path);
                  showToast(ok ? `Copied: ${path}` : "Copy failed");
                }}
              />
            ) : (
              <HighlightedPre
                text={activeText || "(empty body)"}
                matches={matches}
                activeIndex={activeHit}
                onActiveRef={scrollToActive}
              />
            )}

            {!showPreview && bodyMode === "preview" && !isBinary ? (
              <div className="smallMuted" style={{ marginTop: 8 }}>
                Preview is available only for JSON responses.
              </div>
            ) : null}
          </>
        )}

        {tab === "headers" && (
          <div className="headersTable">
            {headersArr.length === 0 ? (
              <div className="smallMuted" style={{ padding: 10 }}>
                No headers.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {headersArr.map(([k, v], idx) => (
                    <tr key={`${k}-${idx}`}>
                      <td className="mono">{k}</td>
                      <td className="mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "cookies" && (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Cookies</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Jar: <span style={{ fontFamily: "var(--mono)" }}>{jarIdForSave}</span>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Cookies sent (request): <span style={{ fontFamily: "var(--mono)" }}>{cookieSentCount}</span>
                {cookieSentFrom ? <span className="muted"> ({cookieSentFrom})</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btnSm btnPrimary" onClick={addAllCookiesToJar} disabled={!setCookiesArr.length}>
                Add all to jar
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {cookieSentHeader ? (
              <div className="card" style={{ padding: 10, marginBottom: 10 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Cookie header sent</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>{cookieSentHeader}</div>
              </div>
            ) : null}

            {Array.isArray(cookieSentCookies) && cookieSentCookies.length ? (
              <div className="card" style={{ padding: 10, marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="muted">Matched cookies (sent)</div>
                  <input
                    className="input"
                    style={{ maxWidth: 260 }}
                    placeholder="Filter by name/domain"
                    value={cookieSentFilter}
                    onChange={(e) => setCookieSentFilter(e.target.value)}
                  />
                </div>
                <div className="headersTable">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Value</th>
                        <th>Domain</th>
                        <th>Path</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookieSentCookies
                        .filter((c) => {
                          const q = cookieSentFilter.trim().toLowerCase();
                          if (!q) return true;
                          return String(c.name || "").toLowerCase().includes(q) || String(c.domain || "").toLowerCase().includes(q);
                        })
                        .map((c, idx) => (
                          <tr key={`${c.name || ""}-${idx}`}>
                            <td>{c.name}</td>
                            <td style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>{String(c.value ?? "")}</td>
                            <td>{c.domain || ""}</td>
                            <td>{c.path || "/"}</td>
                            <td className="muted">{Array.isArray(c.whyParts) ? c.whyParts.join(" • ") : (c.why || "")}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            
            <div className="card" style={{ padding: 10, marginBottom: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="muted">Cookies debug</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={cookieShowExcluded} onChange={(e) => setCookieShowExcluded(e.target.checked)} />
                    Show excluded
                  </label>
                  <input
                    className="input"
                    style={{ maxWidth: 260 }}
                    placeholder="Filter name/domain/reason"
                    value={cookieSentFilter}
                    onChange={(e) => setCookieSentFilter(e.target.value)}
                  />
                </div>
              </div>

              {Array.isArray(cookieSentCookies) && cookieSentCookies.length ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Matched cookies (sent)</div>
                  <div className="headersTable">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Value</th>
                          <th>Domain</th>
                          <th>Path</th>
                          <th>Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cookieSentCookies
                          .filter((c) => {
                            const q = cookieSentFilter.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              String(c.name || "").toLowerCase().includes(q) ||
                              String(c.domain || "").toLowerCase().includes(q) ||
                              String(c.why || "").toLowerCase().includes(q)
                            );
                          })
                          .map((c, idx) => (
                            <tr key={`sent-${c.name || ""}-${idx}`}>
                              <td>{c.name}</td>
                              <td style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>{String(c.value ?? "")}</td>
                              <td>{c.domain}</td>
                              <td>{c.path}</td>
                              <td className="muted">{Array.isArray(c.whyParts) ? c.whyParts.join(" • ") : (c.why || "")}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="muted">No cookies were sent (or manual Cookie header used).</div>
              )}

              {cookieShowExcluded ? (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Excluded cookies (not sent)</div>
                  {Array.isArray(cookieExcludedCookies) && cookieExcludedCookies.length ? (
                    <div className="headersTable">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Domain</th>
                            <th>Path</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cookieExcludedCookies
                            .filter((c) => {
                              const q = cookieSentFilter.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                String(c.name || "").toLowerCase().includes(q) ||
                                String(c.domain || "").toLowerCase().includes(q) ||
                                String(c.reason || "").toLowerCase().includes(q)
                              );
                            })
                            .map((c, idx) => (
                              <tr key={`ex-${c.name || ""}-${idx}`}>
                                <td>{c.name}</td>
                                <td>{c.domain}</td>
                                <td>{c.path}</td>
                                <td className="muted">{Array.isArray(c.reasons) ? c.reasons.join(" • ") : (c.reason || "")}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="muted">No excluded cookies.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ fontWeight: 600, marginBottom: 6 }}>Set-Cookie (received)</div>

            {setCookiesArr.length ? (
              <div className="headersTable">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "70%" }}>Set-Cookie</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {setCookiesArr.map((sc, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>
                          {String(sc)}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btnSm" onClick={() => addCookieToJar(sc)}>Add</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted">No Set-Cookie headers in this response.</div>
            )}
          </div>
        </div>
        )}

        {tab === "tests" && (
          <div className="testsWrap">
            {/* Builder tests */}
            <div className="testBlock">
              <div className="testBlockTitle">Builder Tests</div>

              {builderTotal > 0 ? (
                <>
                  <div className="smallMuted">
                    {builderPassed}/{builderTotal} passed
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {response.testReport.results?.map((r, i) => (
                      <div
                        key={i}
                        className="row"
                        style={{
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "flex-start",
                        }}
                      >
                        <div className="smallMuted" style={{ flex: 1 }}>
                          {r.message}
                        </div>
                        <span className={`badge ${r.pass ? "badgeOk" : "badgeErr"}`}>
                          {r.pass ? "PASS" : "FAIL"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="smallMuted">No builder tests.</div>
              )}
            </div>

            {/* Script tests */}
            <div className="testBlock">
              <div className="testBlockTitle">Script Tests</div>

              {scriptTotal > 0 ? (
                <>
                  <div className="smallMuted">
                    {scriptPassed}/{scriptTotal} passed
                  </div>

                  {response?.scriptTestReport?.scriptError ? (
                    <div className="scriptErrorCard">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div style={{ fontWeight: 800 }}>Script Error</div>
                        <span className="badge badgeErr">ERROR</span>
                      </div>
                      <div className="smallMuted" style={{ marginTop: 8 }}>
                        {response.scriptTestReport.scriptError}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(response.scriptTestReport.tests) ? (
                    <ul className="testList">
                      {response.scriptTestReport.tests.map((t, i) => (
                        <li key={i} className={t.pass ? "pass" : "fail"}>
                          {t.pass ? "✓" : "✗"} {t.name}
                          {!t.pass && t.error ? (
                            <div className="smallMuted" style={{ marginTop: 4 }}>
                              {t.error}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {Array.isArray(response.scriptTestReport.logs) &&
                  response.scriptTestReport.logs.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="testBlockTitle">Console Logs</div>
                      <pre className="responseBody">
                        {response.scriptTestReport.logs
                          .map((l) => `[${l.level}] ${l.message}`)
                          .join("\n")}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="smallMuted">No script tests.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {toast ? <div className="respToast">{toast.msg}</div> : null}
    </div>
  );
}
