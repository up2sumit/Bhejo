import { useMemo, useRef, useState } from "react";
import { runBatch } from "../utils/runner";

function truncate(str, n = 120) {
  if (!str) return "";
  const s = String(str);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export default function RunnerPanel({ saved, envName, envVars }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const [activeId, setActiveId] = useState(null); // selected result row

  const abortRef = useRef(null);

  const selectedRequests = useMemo(() => {
    const set = new Set(selectedIds);
    return (saved || []).filter((s) => set.has(s.id));
  }, [saved, selectedIds]);

  const activeResult = useMemo(() => {
    return results.find((r) => r.id === activeId) || null;
  }, [results, activeId]);

  const toggle = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedIds((saved || []).map((s) => s.id));
  const clearSel = () => setSelectedIds([]);

  const runSelected = async () => {
    if (selectedRequests.length === 0) return;

    setRunning(true);
    setResults([]);
    setActiveId(null);
    setProgress({
      index: 0,
      total: selectedRequests.length,
      current: selectedRequests[0],
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const out = await runBatch({
        requests: selectedRequests,
        envVars,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setResults(out);
      if (out.length) setActiveId(out[0].id);
    } catch {
      // ignore abort
    } finally {
      setRunning(false);
      abortRef.current = null;
      setProgress(null);
    }
  };

  const stop = () => abortRef.current?.abort();

  const summary = useMemo(() => {
    const total = results.length;
    const ok = results.filter((r) => r.ok).length;
    const passedAll = results.filter((r) => r.total > 0 && r.passed === r.total).length;
    const failedAny = results.filter((r) => r.total > 0 && r.passed !== r.total).length;
    return { total, ok, passedAll, failedAny };
  }, [results]);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text || "";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>Runner</div>
        <span className="badge">Env: {envName}</span>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btnSm"
          onClick={selectAll}
          disabled={running || (saved || []).length === 0}
        >
          Select all
        </button>
        <button
          className="btn btnSm"
          onClick={clearSel}
          disabled={running || selectedIds.length === 0}
        >
          Clear
        </button>
        <button
          className="btn btnPrimary btnSm"
          onClick={runSelected}
          disabled={running || selectedRequests.length === 0}
        >
          Run selected ({selectedRequests.length})
        </button>
        <button className="btn btnDanger btnSm" onClick={stop} disabled={!running}>
          Stop
        </button>
      </div>

      {progress && running ? (
        <div className="smallMuted">
          Running {progress.index + 1}/{progress.total}: <b>{progress.current?.name}</b>
        </div>
      ) : null}

      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
          Select requests
        </div>

        {(saved || []).length === 0 ? (
          <div className="smallMuted">No saved requests. Save some first.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {(saved || []).map((s) => (
              <label key={s.id} className="runnerRow">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={running}
                />
                <div className="runnerRowMain">
                  <div style={{ fontWeight: 800 }}>
                    {s.name}{" "}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {s.method}
                    </span>
                  </div>
                  <div className="smallMuted" style={{ overflowWrap: "anywhere" }}>
                    {s.url}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {results.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>Run report</div>
            <span className="badge">
              {summary.ok}/{summary.total} ok • {summary.passedAll} all-pass •{" "}
              {summary.failedAny} failed-tests
            </span>
          </div>

          <div className="runnerTableWrap">
            <table className="runnerTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Tests</th>
                  <th>Result</th>
                  <th>Body (preview)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const testsLabel = r.total ? `${r.passed}/${r.total}` : "-";

                  const resultBadge =
                    r.ok && r.total === 0
                      ? "OK"
                      : r.ok && r.total > 0 && r.passed === r.total
                      ? "PASS"
                      : r.ok && r.total > 0
                      ? "FAIL"
                      : "ERR";

                  const badgeClass =
                    resultBadge === "PASS" || resultBadge === "OK"
                      ? "badge badgeOk"
                      : "badge badgeErr";

                  const preview =
                    r.ok
                      ? truncate(r.rawText || prettyJson(r.json) || "", 140)
                      : truncate(r.error || "", 140);

                  const isActive = r.id === activeId;

                  return (
                    <tr
                      key={r.id}
                      onClick={() => setActiveId(r.id)}
                      style={{
                        cursor: "pointer",
                        background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                      }}
                    >
                      <td style={{ fontWeight: 700 }}>{r.name}</td>
                      <td>{String(r.status)}</td>
                      <td>{r.timeMs} ms</td>
                      <td>{testsLabel}</td>
                      <td>
                        <span className={badgeClass}>{resultBadge}</span>
                      </td>
                      <td style={{ maxWidth: 380, overflowWrap: "anywhere" }}>
                        <span className="smallMuted">{preview}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Details Panel */}
          {activeResult ? (
            <div className="card" style={{ padding: 12, marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800 }}>
                  Details: {activeResult.name}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btnSm"
                    onClick={() =>
                      copyText(activeResult.rawText || prettyJson(activeResult.json) || "")
                    }
                    disabled={!activeResult.ok}
                  >
                    Copy body
                  </button>
                  <button className="btn btnSm" onClick={() => setActiveId(null)}>
                    Close
                  </button>
                </div>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <span className={`badge ${activeResult.ok ? "badgeOk" : "badgeErr"}`}>
                  {activeResult.ok ? "OK" : "ERR"}
                </span>
                <span className="badge">Status: {String(activeResult.status)}</span>
                <span className="badge">{activeResult.timeMs} ms</span>
                {typeof activeResult.total === "number" && activeResult.total > 0 ? (
                  <span className="badge">
                    Tests: {activeResult.passed}/{activeResult.total}
                  </span>
                ) : null}
              </div>

              {/* Tests list */}
              {activeResult.testReport && activeResult.testReport.total > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800 }}>Tests</div>
                    <span className="badge">
                      {activeResult.testReport.passed}/{activeResult.testReport.total} passed
                    </span>
                  </div>

                  <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                    {activeResult.testReport.results.map((t, i) => (
                      <div
                        key={i}
                        className="row"
                        style={{ justifyContent: "space-between", gap: 10 }}
                      >
                        <div className="smallMuted" style={{ flex: 1 }}>
                          {t.message}
                        </div>
                        <span className={`badge ${t.pass ? "badgeOk" : "badgeErr"}`}>
                          {t.pass ? "PASS" : "FAIL"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Headers */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800 }}>Headers</div>
                <pre className="codeBlock" style={{ marginTop: 8 }}>
                  {prettyJson(activeResult.headers) || "{}"}
                </pre>
              </div>

              {/* Body */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800 }}>Body</div>
                <pre className="codeBlock" style={{ marginTop: 8 }}>
                  {activeResult.ok
                    ? prettyJson(activeResult.json) || activeResult.rawText || "(empty)"
                    : activeResult.error || "Failed"}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
