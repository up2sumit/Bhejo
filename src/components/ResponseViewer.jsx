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

export default function ResponseViewer({ response }) {
  const [tab, setTab] = useState("body");
  const [bodyMode, setBodyMode] = useState("pretty"); // pretty | raw | preview

  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeHit, setActiveHit] = useState(0);

  const [toast, setToast] = useState(null); // {msg}

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

  const rawText = useMemo(() => computeRawText(response), [response]);

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
    const t = rawText || "";
    if (!t) return 0;
    try {
      return new Blob([t]).size;
    } catch {
      return 0;
    }
  }, [rawText]);

  const sizeLabel = useMemo(() => {
    const n = sizeBytes;
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }, [sizeBytes]);

  const contentTypePill =
    jsonValue !== null && jsonValue !== undefined ? "JSON" : "Text";

  const showBodySubTabs = tab === "body";

  const showPreview = jsonValue !== null && jsonValue !== undefined;

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
          <button className="btn btnSm" type="button" onClick={openSearch} title="Find in body (Ctrl+F)">
            Find
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="responseTabs">
        <TabBtn id="body" label="Body" />
        <TabBtn id="headers" label={`Headers (${headersArr.length})`} />
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
            {bodyMode === "preview" && showPreview ? (
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

            {!showPreview && bodyMode === "preview" ? (
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
