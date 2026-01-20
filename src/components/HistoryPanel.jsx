function statusBadgeClass(status) {
  if (status === "ERR") return "badge badgeErr";
  if (typeof status === "number" && status >= 200 && status < 300) return "badge badgeOk";
  return "badge badgeErr";
}

export default function HistoryPanel({ history, onSelect }) {
  if (history.length === 0) return <div className="smallMuted">No history yet.</div>;

  return (
    <div className="list">
      {history.map((item, idx) => (
        <button key={idx} className="listItem" onClick={() => onSelect(item)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>
              {item.method}{" "}
              <span style={{ fontWeight: 500, color: "var(--muted)" }}>
                {item.url}
              </span>
            </div>

            {item.lastResult ? (
              <div className="row" style={{ gap: 8 }}>
                <span className={statusBadgeClass(item.lastResult.status)}>
                  {item.lastResult.status}
                </span>
                <span className="badge">{item.lastResult.timeMs} ms</span>
              </div>
            ) : null}
          </div>

          <div className="smallMuted">{new Date(item.savedAt).toLocaleString()}</div>
        </button>
      ))}
    </div>
  );
}
