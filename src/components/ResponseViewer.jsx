import { useMemo, useState } from "react";

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export default function ResponseViewer({ response }) {
  const [showHeaders, setShowHeaders] = useState(false);

  const statusBadgeClass = useMemo(() => {
    if (!response) return "badge";
    if (response.ok === false) return "badge badgeErr";
    if (typeof response.status === "number" && response.status >= 200 && response.status < 300)
      return "badge badgeOk";
    return "badge badgeErr";
  }, [response]);

  const headerEntries = useMemo(() => {
    const h = response?.headers || {};
    return Object.entries(h);
  }, [response]);

  const bodyText = useMemo(() => {
    if (!response) return "";
    if (response.ok === false) return "";

    // Prefer parsed JSON if available
    if (response.json !== null && response.json !== undefined) {
      const pretty = prettyJson(response.json);
      if (pretty) return pretty;
    }

    return response.rawText || "";
  }, [response]);

  if (!response) {
    return <div className="smallMuted">No response yet. Send a request.</div>;
  }

  if (response.ok === false) {
    return (
      <div className="stack" style={{ gap: 12 }}>
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
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* Summary */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Response</div>
          <div className="row" style={{ gap: 8 }}>
            <span className={statusBadgeClass}>
              {response.status} {response.statusText || ""}
            </span>
            <span className="badge">{response.timeMs} ms</span>
          </div>
        </div>

        {/* Tests report (Phase 1.9) */}
        {response?.testReport && response.testReport.total > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 800 }}>Tests</div>
              <span className="badge">
                {response.testReport.passed}/{response.testReport.total} passed
              </span>
            </div>

            <div className="stack" style={{ marginTop: 10, gap: 8 }}>
              {response.testReport.results.map((r, i) => (
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
          </div>
        ) : null}
      </div>

      {/* Headers */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Headers</div>
          <button className="btn btnSm" onClick={() => setShowHeaders((s) => !s)}>
            {showHeaders ? "Hide" : "Show"} ({headerEntries.length})
          </button>
        </div>

        {showHeaders ? (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            {headerEntries.length === 0 ? (
              <div className="smallMuted">No headers.</div>
            ) : (
              headerEntries.map(([k, v]) => (
                <div
                  key={k}
                  className="row"
                  style={{ justifyContent: "space-between", gap: 10 }}
                >
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{k}</div>
                  <div
                    className="smallMuted"
                    style={{
                      textAlign: "right",
                      overflowWrap: "anywhere",
                      flex: 1,
                    }}
                  >
                    {String(v)}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="smallMuted" style={{ marginTop: 8 }}>
            Click “Show” to view headers.
          </div>
        )}
      </div>

      {/* Body */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Body</div>
          <span className="badge">
            {response.json !== null && response.json !== undefined ? "JSON" : "Text"}
          </span>
        </div>

        <pre
          className="codeBlock"
          style={{
            marginTop: 10,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {bodyText || "(empty body)"}
        </pre>
      </div>
    </div>
  );
}
