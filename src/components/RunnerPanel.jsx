import { useMemo, useRef, useState, useEffect } from "react";
import { runBatch } from "../utils/runner";
import { addRun, clearRuns, deleteRun, loadRuns } from "../utils/runStorage";

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

function downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

export default function RunnerPanel({ saved, collections, envName, envVars }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const [activeId, setActiveId] = useState(null);

  // Phase 2.1: Run history
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);

  // Phase 2.2: Collections
  const [selectedCollectionId, setSelectedCollectionId] = useState("");

  const abortRef = useRef(null);

  useEffect(() => {
    setRuns(loadRuns());
  }, []);

  const savedList = saved || [];
  const collectionList = collections || [];

  const selectedRequests = useMemo(() => {
    const set = new Set(selectedIds);
    return savedList.filter((s) => set.has(s.id));
  }, [savedList, selectedIds]);

  const collectionRequests = useMemo(() => {
    if (!selectedCollectionId) return [];
    return savedList.filter((s) => (s.collectionId || "") === selectedCollectionId);
  }, [savedList, selectedCollectionId]);

  const activeResult = useMemo(() => {
    return results.find((r) => r.id === activeId) || null;
  }, [results, activeId]);

  const currentSummary = useMemo(() => {
    const total = results.length;
    const ok = results.filter((r) => r.ok).length;
    const passedAll = results.filter((r) => r.total > 0 && r.passed === r.total).length;
    const failedAny = results.filter((r) => r.total > 0 && r.passed !== r.total).length;
    return { total, ok, passedAll, failedAny };
  }, [results]);

  const viewingRun = useMemo(() => {
    if (!selectedRunId) return null;
    return runs.find((r) => r.id === selectedRunId) || null;
  }, [runs, selectedRunId]);

  const toggle = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedIds(savedList.map((s) => s.id));
  const clearSel = () => setSelectedIds([]);

  const selectCollection = () => {
    const ids = collectionRequests.map((r) => r.id);
    setSelectedIds(ids);
  };

  const stop = () => abortRef.current?.abort();

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text || "";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const exportCurrentRun = () => {
    const payload = {
      version: "bhejo-run-v1",
      exportedAt: new Date().toISOString(),
      envName,
      summary: currentSummary,
      results,
    };
    downloadJson(
      `bhejo-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`,
      payload
    );
  };

  const executeRun = async (requestsToRun) => {
    if (!requestsToRun || requestsToRun.length === 0) return;

    setRunning(true);
    setResults([]);
    setActiveId(null);
    setSelectedRunId(null); // switch to live mode

    setProgress({
      index: 0,
      total: requestsToRun.length,
      current: requestsToRun[0],
    });

    const controller = new AbortController();
    abortRef.current = controller;

    const createdAt = new Date().toISOString();

    try {
      const out = await runBatch({
        requests: requestsToRun,
        envVars,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      setResults(out);
      if (out.length) setActiveId(out[0].id);

      const summary = {
        total: out.length,
        ok: out.filter((r) => r.ok).length,
        passedAll: out.filter((r) => r.total > 0 && r.passed === r.total).length,
        failedAny: out.filter((r) => r.total > 0 && r.passed !== r.total).length,
      };

      const updatedRuns = addRun({
        createdAt,
        envName,
        summary,
        results: out,
      });
      setRuns(updatedRuns);
    } catch {
      // ignore abort
    } finally {
      setRunning(false);
      abortRef.current = null;
      setProgress(null);
    }
  };

  const runSelected = async () => executeRun(selectedRequests);

  const runCollection = async () => executeRun(collectionRequests);

  const openRun = (run) => {
    setSelectedRunId(run.id);
    setResults(run.results || []);
    setActiveId(run.results?.[0]?.id || null);
  };

  const backToLive = () => {
    setSelectedRunId(null);
  };

  const removeRun = (id) => {
    const updated = deleteRun(id);
    setRuns(updated);
    if (selectedRunId === id) {
      setSelectedRunId(null);
      setResults([]);
      setActiveId(null);
    }
  };

  const wipeRuns = () => {
    const updated = clearRuns();
    setRuns(updated);
    setSelectedRunId(null);
    setResults([]);
    setActiveId(null);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>Runner</div>
        <span className="badge">Env: {envName}</span>
      </div>

      {/* Phase 2.2: Collections */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Collections</div>
          <span className="badge">{collectionList.length} total</span>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <span className="badge">Collection</span>
          <select
            className="select"
            value={selectedCollectionId}
            onChange={(e) => setSelectedCollectionId(e.target.value)}
            disabled={running}
          >
            <option value="">(none)</option>
            {collectionList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            className="btn btnSm"
            onClick={selectCollection}
            disabled={!selectedCollectionId || collectionRequests.length === 0 || running}
          >
            Select collection ({collectionRequests.length})
          </button>

          <button
            className="btn btnPrimary btnSm"
            onClick={runCollection}
            disabled={!selectedCollectionId || collectionRequests.length === 0 || running}
          >
            Run collection
          </button>
        </div>

        {selectedCollectionId && collectionRequests.length === 0 ? (
          <div className="smallMuted" style={{ marginTop: 8 }}>
            This collection has no saved requests assigned.
          </div>
        ) : null}
      </div>

      {/* Phase 2.1: Run History */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Run history</div>
          <button className="btn btnSm" onClick={wipeRuns} disabled={runs.length === 0}>
            Clear runs
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="smallMuted" style={{ marginTop: 8 }}>
            No runs yet. Run something and it will appear here.
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            {runs.map((r) => (
              <div
                key={r.id}
                className="runHistoryRow"
                style={{
                  borderColor: selectedRunId === r.id ? "rgba(255,255,255,0.16)" : "var(--border)",
                }}
              >
                <div
                  className="runHistoryMain"
                  onClick={() => openRun(r)}
                  style={{ cursor: "pointer" }}
                  title="Click to open"
                >
                  <div style={{ fontWeight: 800 }}>
                    {new Date(r.createdAt).toLocaleString()}{" "}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {r.envName}
                    </span>
                  </div>
                  <div className="smallMuted">
                    total {r.summary?.total || 0} • ok {r.summary?.ok || 0} • all-pass{" "}
                    {r.summary?.passedAll || 0} • failed-tests {r.summary?.failedAny || 0}
                  </div>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btnSm"
                    onClick={() =>
                      downloadJson(
                        `bhejo-run-${String(r.createdAt).slice(0, 19).replace(/[:T]/g, "-")}.json`,
                        {
                          version: "bhejo-run-v1",
                          exportedAt: new Date().toISOString(),
                          envName: r.envName,
                          summary: r.summary,
                          results: r.results,
                        }
                      )
                    }
                  >
                    Export
                  </button>
                  <button className="btn btnDanger btnSm" onClick={() => removeRun(r.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main controls */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btnSm" onClick={selectAll} disabled={running || savedList.length === 0}>
          Select all
        </button>
        <button className="btn btnSm" onClick={clearSel} disabled={running || selectedIds.length === 0}>
          Clear
        </button>
        <button className="btn btnPrimary btnSm" onClick={runSelected} disabled={running || selectedRequests.length === 0}>
          Run selected ({selectedRequests.length})
        </button>
        <button className="btn btnDanger btnSm" onClick={stop} disabled={!running}>
          Stop
        </button>

        <button className="btn btnSm" onClick={exportCurrentRun} disabled={results.length === 0}>
          Export current
        </button>

        {viewingRun ? (
          <button className="btn btnSm" onClick={backToLive}>
            Back to live
          </button>
        ) : null}
      </div>

      {progress && running ? (
        <div className="smallMuted">
          Running {progress.index + 1}/{progress.total}: <b>{progress.current?.name}</b>
        </div>
      ) : null}

      {viewingRun ? (
        <div className="smallMuted">
          Viewing past run: <b>{new Date(viewingRun.createdAt).toLocaleString()}</b> • {viewingRun.envName}
        </div>
      ) : null}

      {/* Select requests */}
      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
          Select requests
        </div>

        {savedList.length === 0 ? (
          <div className="smallMuted">No saved requests. Save some first.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {savedList.map((s) => (
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
                    {s.collectionId ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        {collectionList.find((c) => c.id === s.collectionId)?.name || "Collection"}
                      </span>
                    ) : null}
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

      {/* Report */}
      {results.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>Run report</div>
            <span className="badge">
              {currentSummary.ok}/{currentSummary.total} ok • {currentSummary.passedAll} all-pass •{" "}
              {currentSummary.failedAny} failed-tests
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

                  const preview = r.ok
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

          {/* Details */}
          {activeResult ? (
            <div className="card" style={{ padding: 12, marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800 }}>Details: {activeResult.name}</div>
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

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800 }}>Headers</div>
                <pre className="codeBlock" style={{ marginTop: 8 }}>
                  {prettyJson(activeResult.headers) || "{}"}
                </pre>
              </div>

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
