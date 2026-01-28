import { useEffect, useMemo, useRef, useState } from "react";
import { clearConsoleEvents, loadConsoleEvents } from "../utils/consoleBus";

function formatTs(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function pretty(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function containsText(obj, q) {
  const s = pretty(obj).toLowerCase();
  return s.includes(q);
}

function getKeyFromEvent(e) {
  const d = e?.data || {};
  const name = d.name || "";
  const method = d.method || "";
  const url = d.finalUrl || d.url || "";
  const source = d.source || "";
  return `${source}::${name}::${method}::${url}`.trim();
}

// ✅ Strict transaction id
// - Prefer traceId when present (correct pairing)
// - Fallback to old heuristic key for legacy events that don’t carry traceId

function typeWeight(type) {
  // Ensure stable ordering inside a transaction:
  // request -> response/error -> test logs (and other logs after)
  switch (type) {
    case "request":
      return 10;
    case "prerequest":
    case "prerequest_error":
      return 15;
    case "response":
    case "error":
      return 20;
    case "testscript_log":
    case "test_log":
      return 30;
    default:
      return 40;
  }
}

function eventOrderKey(e) {
  // Prefer seq if present (monotonic), else ts
  const seq = typeof e?.seq === "number" ? e.seq : null;
  const ts = e?.ts || "";
  return { seq, ts, w: typeWeight(e?.type) };
}

function compareEvents(a, b) {
  const ka = eventOrderKey(a);
  const kb = eventOrderKey(b);

  if (ka.seq !== null && kb.seq !== null && ka.seq !== kb.seq) return ka.seq - kb.seq;

  // fallback to ts
  if (ka.ts && kb.ts && ka.ts !== kb.ts) return ka.ts < kb.ts ? -1 : 1;

  // same time => use type weight
  if (ka.w !== kb.w) return ka.w - kb.w;

  // final fallback: id
  const ai = a?.id || "";
  const bi = b?.id || "";
  if (ai === bi) return 0;
  return ai < bi ? -1 : 1;
}
function getTxnId(e) {
  const tid = e?.data?.traceId;
  if (tid) return `trace:${tid}`;
  return `key:${getKeyFromEvent(e)}`;
}

function pillClass(level) {
  if (level === "error") return "pill pillErr";
  if (level === "warn") return "pill pillWarn";
  return "pill pillInfo";
}

function typePillClass(type) {
  if (type === "request") return "pill pillReq";
  if (type === "response") return "pill pillRes";
  if (type === "error") return "pill pillErr";
  return "pill";
}

function formatTypeLabel(type) {
  if (!type) return "event";
  return String(type).replace(/_/g, " ");
}

export default function ConsolePanel() {
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | request | response | error
  const [autoscroll, setAutoscroll] = useState(true);

  const listRef = useRef(null);
  const lastTopIdRef = useRef(null);

  // LIVE STREAM: pull latest every 800ms + also react to storage events
  useEffect(() => {
    const load = () => setEvents(loadConsoleEvents());
    load();

    const onStorage = (e) => {
      if (e.key === "bhejo_console_events_v1") load();
    };
    window.addEventListener("storage", onStorage);

    const t = setInterval(load, 800);

    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Auto scroll to top (newest on top) when new event arrives
  useEffect(() => {
    if (!autoscroll) return;
    const topId = events?.[0]?.id;
    if (!topId) return;
    if (topId === lastTopIdRef.current) return;

    lastTopIdRef.current = topId;
    // We render newest at top; keep viewport at top.
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [events, autoscroll]);

  const counts = useMemo(() => {
    const total = events.length;
    const errors = events.filter((x) => x.level === "error").length;
    const warns = events.filter((x) => x.level === "warn").length;
    const req = events.filter((x) => x.type === "request").length;
    const res = events.filter((x) => x.type === "response").length;
    return { total, errors, warns, req, res };
  }, [events]);

  const filteredEvents = useMemo(() => {
    let list = [...events];

    if (filter !== "all") list = list.filter((e) => e.type === filter);

    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) => containsText(e, q));

    return list;
  }, [events, query, filter]);

  // ✅ CONNECTED (correct): group by traceId
  const grouped = useMemo(() => {
    // events are newest first
    // build groups from oldest -> newest so group.events stays chronological
    const chronological = [...filteredEvents].reverse();

    const byId = new Map();
    const groups = [];

    for (const e of chronological) {
      const txnId = getTxnId(e);
      let g = byId.get(txnId);

      if (!g) {
        g = {
          id: txnId,
          traceId: e?.data?.traceId || null,
          key: getKeyFromEvent(e),
          request: null,
          response: null,
          error: null,
          events: [],
          lastTs: e?.ts || "",
        };
        byId.set(txnId, g);
        groups.push(g);
      }

      g.events.push(e);
      if (e?.ts) g.lastTs = e.ts;

      if (e.type === "request") g.request = e;
      else if (e.type === "response") g.response = e;
      else if (e.type === "error") g.error = e;
    }

    // sort events inside each group (stable ordering)
    for (const g of groups) {
      g.events.sort(compareEvents);
      // re-derive request/response/error pointers after sorting (last wins if multiple)
      g.request = null;
      g.response = null;
      g.error = null;
      for (const e of g.events) {
        if (e.type === "request") g.request = e;
        else if (e.type === "response") g.response = e;
        else if (e.type === "error") g.error = e;
      }
    }

    // show newest group first (by lastTs)
    groups.sort((a, b) => {
      const at = a.lastTs || "";
      const bt = b.lastTs || "";
      if (at === bt) return 0;
      return at < bt ? 1 : -1;
    });

    return groups;
  }, [filteredEvents]);

  const copy = async (obj) => {
    const text = pretty(obj);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const renderEventBlock = (e, label) => {
    if (!e) return null;
    const d = e.data || {};

    const title = d.name || d.finalUrl || d.url || d.message || "(event)";

    return (
      <div className="consoleEventBlock">
        <div className="consoleEventTop">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className={pillClass(e.level)}>{(e.level || "info").toUpperCase()}</span>
            <span className={typePillClass(e.type)}>{label}</span>
            <div className="consoleHeadline" title={title}>
              {title}
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="consoleTime">{formatTs(e.ts)}</div>
            <button className="btn btnSm" onClick={() => copy(e.data)}>
              Copy data
            </button>
            <button className="btn btnSm" onClick={() => copy(e)}>
              Copy event
            </button>
          </div>
        </div>

        <pre className="codeBlock consoleCode">{pretty(e.data)}</pre>
      </div>
    );
  };

  return (
    <div className="consoleWrap">
      {/* Top bar */}
      <div className="consoleTop">
        <div className="consoleTitle">
          <div className="consoleH1">Console</div>
          <div className="consoleSub">Live stream • Request ↔ Response connected (traceId)</div>
        </div>

        <div className="consoleStats">
          <span className="badge">{counts.total} total</span>
          <span className="badge">{counts.req} req</span>
          <span className="badge">{counts.res} res</span>
          <span className="badge badgeWarn">{counts.warns} warn</span>
          <span className="badge badgeErr">{counts.errors} error</span>
        </div>
      </div>

      {/* Controls */}
      <div className="consoleControls">
        <div className="consoleFilters">
          <button className={`tab ${filter === "all" ? "tabActive" : ""}`} onClick={() => setFilter("all")}>
            All
          </button>
          <button
            className={`tab ${filter === "request" ? "tabActive" : ""}`}
            onClick={() => setFilter("request")}
          >
            Requests
          </button>
          <button
            className={`tab ${filter === "response" ? "tabActive" : ""}`}
            onClick={() => setFilter("response")}
          >
            Responses
          </button>
          <button className={`tab ${filter === "error" ? "tabActive" : ""}`} onClick={() => setFilter("error")}>
            Errors
          </button>

          <button
            className={`tab ${autoscroll ? "tabActive" : ""}`}
            onClick={() => setAutoscroll((v) => !v)}
            title="Keep view pinned to newest logs"
          >
            Live pin
          </button>
        </div>

        <div className="consoleActions">
          <input
            className="input consoleSearch"
            placeholder="Search logs… (URL, status, message, body, etc.)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button className="btn btnSm" onClick={() => setEvents(loadConsoleEvents())}>
            Refresh
          </button>
          <button
            className="btn btnDanger btnSm"
            onClick={() => {
              clearConsoleEvents();
              setEvents([]);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Body */}
      {grouped.length === 0 ? (
        <div className="consoleEmpty">
          <div className="smallMuted">No logs found{query.trim() ? " for this search." : "."}</div>
        </div>
      ) : (
        <div className="consoleList consoleListScroll" ref={listRef}>
          {grouped.map((g, idx) => {
            const req = g.request;
            const res = g.response;
            const err = g.error;

            // transaction badge
            const statusPill = err ? (
              <span className="pill pillErr">FAILED</span>
            ) : res ? (
              <span className="pill pillRes">DONE</span>
            ) : (
              <span className="pill pillWarn">PENDING</span>
            );

            const method =
              req?.data?.method || res?.data?.method || err?.data?.method || "";
            const url =
              req?.data?.finalUrl ||
              req?.data?.url ||
              res?.data?.finalUrl ||
              res?.data?.url ||
              err?.data?.finalUrl ||
              err?.data?.url ||
              "";
            const name =
              req?.data?.name ||
              res?.data?.name ||
              err?.data?.name ||
              req?.data?.finalUrl ||
              res?.data?.finalUrl ||
              err?.data?.finalUrl ||
              `Transaction ${idx + 1}`;

            // middle events (prerequest/testscript logs, etc.)
            const middle = (g.events || []).filter(
              (e) => !["request", "response", "error"].includes(e.type)
            );

            return (
              <div key={`${g.id}_${idx}`} className="consoleTxn">
                <div className="consoleTxnHeader">
                  <div className="consoleTxnLeft">
                    {statusPill}
                    <span className="badge">{method || "—"}</span>
                    {g.traceId ? (
                      <span className="badge" title={g.traceId}>
                        trace:{String(g.traceId).slice(0, 8)}
                      </span>
                    ) : null}
                    <div className="consoleTxnTitle" title={url || name}>
                      {name}
                    </div>
                  </div>

                  <div className="consoleTxnRight">
                    {url ? (
                      <span className="smallMuted" style={{ fontFamily: "var(--mono)" }}>
                        {url}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="consoleTxnBody">
                  {renderEventBlock(req, "request")}

                  {middle.length ? <div className="consoleLinkLine" /> : null}

                  {middle.map((e, i) => (
                    <div key={`${g.id}_mid_${i}`}>
                      {renderEventBlock(e, formatTypeLabel(e.type))}
                      {i !== middle.length - 1 ? <div className="consoleLinkLine" /> : null}
                    </div>
                  ))}

                  {(res || err) ? <div className="consoleLinkLine" /> : null}

                  {renderEventBlock(res, "response")}
                  {renderEventBlock(err, "error")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
