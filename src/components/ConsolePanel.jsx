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

  // CONNECTED: group request + response/error into a transaction
  const grouped = useMemo(() => {
    // events are newest first
    // We'll build groups scanning from oldest -> newest to pair properly.
    const chronological = [...filteredEvents].reverse();

    const open = new Map(); // key -> last request event awaiting response
    const groups = []; // { key, request, response, error }

    for (const e of chronological) {
      const key = getKeyFromEvent(e);

      if (e.type === "request") {
        // start a new transaction
        const g = { key, request: e, response: null, error: null };
        open.set(key + "::" + e.id, g);
        groups.push(g);
      } else if (e.type === "response" || e.type === "error") {
        // attach to the latest unmatched request for same key (best effort)
        // find last open group with same base key and no response/error.
        for (let i = groups.length - 1; i >= 0; i--) {
          const g = groups[i];
          if (g.key === key && g.request && !g.response && !g.error) {
            if (e.type === "response") g.response = e;
            else g.error = e;
            break;
          }
        }

        // If we didn’t find a request, show it as standalone group.
        const attached = groups.some(
          (g) => g.key === key && (g.response === e || g.error === e)
        );
        if (!attached) {
          groups.push({ key, request: null, response: e.type === "response" ? e : null, error: e.type === "error" ? e : null });
        }
      } else {
        // unknown type -> standalone
        groups.push({ key, request: e, response: null, error: null });
      }
    }

    // show newest first
    return groups.reverse();
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
    const title =
      d.name || d.finalUrl || d.url || d.message || "(event)";

    return (
      <div className="consoleEventBlock">
        <div className="consoleEventTop">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className={pillClass(e.level)}>{(e.level || "info").toUpperCase()}</span>
            <span className={typePillClass(e.type)}>{label}</span>
            <div className="consoleHeadline" title={title}>{title}</div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div className="consoleTime">{formatTs(e.ts)}</div>
            <button className="btn btnSm" onClick={() => copy(e.data)}>Copy data</button>
            <button className="btn btnSm" onClick={() => copy(e)}>Copy event</button>
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
          <div className="consoleSub">Live stream • Request ↔ Response connected</div>
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
          <button className={`tab ${filter === "request" ? "tabActive" : ""}`} onClick={() => setFilter("request")}>
            Requests
          </button>
          <button className={`tab ${filter === "response" ? "tabActive" : ""}`} onClick={() => setFilter("response")}>
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
          <div className="smallMuted">
            No logs found{query.trim() ? " for this search." : "."}
          </div>
        </div>
      ) : (
        <div className="consoleList consoleListScroll" ref={listRef}>
          {grouped.map((g, idx) => {
            const req = g.request;
            const res = g.response;
            const err = g.error;

            // transaction badge
            const statusPill =
              err ? (
                <span className="pill pillErr">FAILED</span>
              ) : res ? (
                <span className="pill pillRes">DONE</span>
              ) : (
                <span className="pill pillWarn">PENDING</span>
              );

            const method = req?.data?.method || res?.data?.method || "";
            const url = req?.data?.finalUrl || res?.data?.finalUrl || "";
            const name = req?.data?.name || res?.data?.name || err?.data?.name || `Transaction ${idx + 1}`;

            return (
              <div key={`${g.key}_${idx}`} className="consoleTxn">
                <div className="consoleTxnHeader">
                  <div className="consoleTxnLeft">
                    {statusPill}
                    <span className="badge">{method || "—"}</span>
                    <div className="consoleTxnTitle" title={url || name}>
                      {name}
                    </div>
                  </div>

                  <div className="consoleTxnRight">
                    {url ? <span className="smallMuted" style={{ fontFamily: "var(--mono)" }}>{url}</span> : null}
                  </div>
                </div>

                <div className="consoleTxnBody">
                  {renderEventBlock(req, "request")}
                  <div className="consoleLinkLine" />
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
