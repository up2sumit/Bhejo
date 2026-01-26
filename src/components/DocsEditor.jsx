// src/components/DocsEditor.jsx
import { useEffect, useMemo, useState } from "react";

function safeJson(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return "";
  }
}

function truncate(s, n = 180) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function uuid(prefix = "ex") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function suggestExampleName(exchange) {
  const method = exchange?.request?.method || "GET";
  const status = exchange?.response?.status ? String(exchange.response.status) : "";
  const url = exchange?.request?.finalUrl || exchange?.request?.url || "";

  let path = "";
  try {
    const u = new URL(url);
    path = u.pathname || "";
  } catch {
    path = String(url || "");
  }

  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  const base = tail ? `${method} /${tail}` : `${method} Example`;
  return status ? `${base} (${status})` : base;
}

function groupExamplesByStatus(examples = []) {
  const g = new Map();
  for (const ex of examples || []) {
    const st = ex?.response?.status;
    const key = st ? String(st) : "No response";
    if (!g.has(key)) g.set(key, []);
    g.get(key).push(ex);
  }

  const keys = Array.from(g.keys()).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    const aNum = !Number.isNaN(na) && /^\d+$/.test(a);
    const bNum = !Number.isNaN(nb) && /^\d+$/.test(b);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    if (a === "No response") return 1;
    if (b === "No response") return -1;
    return a.localeCompare(b);
  });

  return keys.map((k) => ({ key: k, items: g.get(k) || [] }));
}

export default function DocsEditor({
  docText,
  setDocText,
  examples,
  setExamples,
  defaultExampleId,
  setDefaultExampleId,
  getLastExchange,
  onApplyExample,
  initialActiveExampleId, // <-- NEW: used when you click an example in the Collections tree
}) {
  const list = useMemo(() => (Array.isArray(examples) ? examples : []), [examples]);

  const [activeId, setActiveId] = useState(initialActiveExampleId || null);

  // If the parent changes the requested active example id (e.g., click different example from tree)
  useEffect(() => {
    if (initialActiveExampleId) setActiveId(initialActiveExampleId);
  }, [initialActiveExampleId]);

  // If examples list changes and activeId no longer exists, fallback
  useEffect(() => {
    if (!activeId) return;
    const exists = list.some((x) => x.id === activeId);
    if (!exists) setActiveId(list[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const active = useMemo(() => list.find((e) => e.id === activeId) || null, [list, activeId]);

  const last = useMemo(
    () => (typeof getLastExchange === "function" ? getLastExchange() : null),
    [getLastExchange]
  );

  const groups = useMemo(() => groupExamplesByStatus(list), [list]);

  const captureExample = () => {
    if (!last?.response) return;

    const suggested = suggestExampleName(last);
    const name = window.prompt("Example name", suggested);
    if (name === null) return;

    const ex = {
      id: uuid(),
      name: String(name || "").trim() || suggested,
      createdAt: new Date().toISOString(),
      request: last.request || null,
      response: last.response || null,
    };

    const next = [ex, ...list];
    setExamples?.(next);

    if (!defaultExampleId) setDefaultExampleId?.(ex.id);

    setActiveId(ex.id);
  };

  const deleteExample = (id) => {
    if (!id) return;
    const ex = list.find((x) => x.id === id);
    const ok = window.confirm(`Delete example "${ex?.name || ""}"?`);
    if (!ok) return;

    const next = list.filter((x) => x.id !== id);
    setExamples?.(next);

    if (defaultExampleId === id) setDefaultExampleId?.(next[0]?.id || null);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const setDefault = (id) => {
    if (!id) return;
    setDefaultExampleId?.(id);
  };

  const copy = async (text) => {
    const t = String(text || "");
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // ignore
    }
  };

  const activeReqText = useMemo(() => safeJson(active?.request || {}), [active]);
  const activeResText = useMemo(() => {
    const r = active?.response || {};
    return safeJson({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      timeMs: r.timeMs,
      headers: r.headers,
      rawText: r.rawText,
    });
  }, [active]);

  const canApply = !!active?.request && typeof onApplyExample === "function";

  return (
    <div className="panelSoft">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>Documentation</div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btnSm"
            type="button"
            onClick={captureExample}
            disabled={!last?.response?.status}
            title={!last?.response?.status ? "Send a request first" : "Save last response as an example"}
          >
            Save last response as example
          </button>
        </div>
      </div>

      <div className="smallMuted" style={{ marginTop: 6 }}>
        Add request notes + save response examples (Postman-style) for demos and future reference.
      </div>

      <div style={{ marginTop: 12, fontWeight: 700 }}>Description</div>
      <textarea
        className="textarea"
        style={{ minHeight: 120, marginTop: 8 }}
        value={docText || ""}
        onChange={(e) => setDocText?.(e.target.value)}
        placeholder={"Write usage notes, auth steps, edge cases, etc.\n\nTip: markdown-style text is fine."}
      />

      <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
        <div style={{ fontWeight: 700 }}>Examples</div>
        <div className="smallMuted">{list.length ? `${list.length} saved` : "No examples yet"}</div>
      </div>

      <div className="row" style={{ gap: 12, marginTop: 10, alignItems: "stretch" }}>
        {/* Left: grouped list */}
        <div style={{ flex: 1, minWidth: 240 }} className="card">
          <div style={{ padding: 10, borderBottom: "1px solid var(--border2)", fontWeight: 700 }}>
            Grouped by status
          </div>

          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {list.length ? (
              groups.map((grp) => (
                <div key={grp.key} style={{ borderBottom: "1px solid var(--border2)" }}>
                  <div
                    style={{
                      padding: "8px 10px",
                      fontWeight: 800,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{grp.key}</span>
                    <span className="smallMuted">{grp.items.length}</span>
                  </div>

                  {grp.items.map((ex) => {
                    const isActive = ex.id === activeId;
                    const isDefault = ex.id === defaultExampleId;

                    return (
                      <button
                        key={ex.id}
                        type="button"
                        className={`listRow ${isActive ? "active" : ""}`}
                        onClick={() => setActiveId(ex.id)}
                        style={{ textAlign: "left" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 700 }}>
                            {isDefault ? "★ " : ""}
                            {ex.name}
                          </div>
                          <span className="smallMuted" style={{ fontFamily: "var(--mono)" }}>
                            {ex?.response?.timeMs ? `${ex.response.timeMs}ms` : ""}
                          </span>
                        </div>

                        <div className="smallMuted" title={ex?.request?.finalUrl || ex?.request?.url || ""}>
                          {truncate(ex?.request?.finalUrl || ex?.request?.url || "", 56)}
                        </div>

                        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                          <span className="smallMuted">
                            {ex.createdAt ? new Date(ex.createdAt).toLocaleString() : ""}
                          </span>
                          <button
                            type="button"
                            className="btn btnXs"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteExample(ex.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="smallMuted" style={{ padding: 10 }}>
                Send a request, then click “Save last response as example”.
              </div>
            )}
          </div>
        </div>

        {/* Right: detail */}
        <div style={{ flex: 2, minWidth: 280 }} className="card">
          <div style={{ padding: 10, borderBottom: "1px solid var(--border2)", fontWeight: 700 }}>
            Example details
          </div>

          {!active ? (
            <div className="smallMuted" style={{ padding: 12 }}>
              Select an example to view its request/response snapshot.
            </div>
          ) : (
            <div style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>
                  {active.id === defaultExampleId ? "★ " : ""}
                  {active.name}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btnSm" type="button" onClick={() => copy(activeReqText)}>
                    Copy request JSON
                  </button>
                  <button className="btn btnSm" type="button" onClick={() => copy(activeResText)}>
                    Copy response JSON
                  </button>
                </div>
              </div>

              <div className="smallMuted" style={{ marginTop: 6 }}>
                {active?.request?.method || ""} {active?.request?.finalUrl || active?.request?.url || ""}
              </div>

              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button
                  className="btn btnSm"
                  type="button"
                  onClick={() => setDefault(active.id)}
                  disabled={active.id === defaultExampleId}
                >
                  Set as default
                </button>

                <button className="btn btnSm" type="button" onClick={() => onApplyExample?.(active)} disabled={!canApply}>
                  Apply to request
                </button>
              </div>

              <div style={{ marginTop: 12, fontWeight: 700 }}>Request snapshot</div>
              <pre className="monoBox" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
{activeReqText || "{}"}
              </pre>

              <div style={{ marginTop: 12, fontWeight: 700 }}>Response snapshot</div>
              <pre className="monoBox" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
{activeResText || "{}"}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="smallMuted" style={{ marginTop: 10 }}>
        Note: Examples are saved inside the request and exported via workspace backup.
      </div>
    </div>
  );
}
