function prettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export default function ResponseViewer({ response }) {
  if (!response) return <div className="smallMuted">No response yet.</div>;

  if (!response.ok) {
    return (
      <div className="stack">
        <span className="badge badgeErr">Error</span>
        <div className="monoBox">
          {`Name: ${response.errorName}\nMessage: ${response.errorMessage}\nTime: ${response.timeMs} ms`}
        </div>
        <div className="smallMuted">
          If this is a CORS issue, we’ll add a proxy soon.
        </div>
      </div>
    );
  }

  const ok = response.status >= 200 && response.status < 300;
  const badgeClass = ok ? "badge badgeOk" : "badge badgeErr";

  const bodyText =
    response.json !== null ? prettyJson(response.json) : response.rawText || "";

  const MAX_CHARS = 200000;
  const limited =
    bodyText.length > MAX_CHARS
      ? bodyText.slice(0, MAX_CHARS) + "\n\n...truncated"
      : bodyText;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className={badgeClass}>
          {response.status} {response.statusText}
        </span>
        <span className="badge">{response.timeMs} ms</span>
      </div>

      <details className="card" style={{ padding: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
          Headers
        </summary>
        <div className="monoBox" style={{ marginTop: 10 }}>
          {prettyJson(response.headers)}
        </div>
      </details>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
          Body
        </div>
        <div className="monoBox">{limited}</div>
      </div>
    </div>
  );
}
