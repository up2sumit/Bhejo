// src/components/RunnerPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { runBatch } from "../utils/runner";
import { addRun, clearRuns, deleteRun, loadRuns } from "../utils/runStorage";
import { flattenRequestsFromNode, loadCollectionTrees } from "../utils/storage";

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

function nodeOptionsFromTree(node, depth = 0, out = [], parentPath = []) {
  if (!node) return out;

  const indent = " ".repeat(depth * 2);
  const isRoot = node.id === "root";
  const path = isRoot ? parentPath : [...parentPath, node.name];

  if (node.type === "folder") {
    out.push({
      id: node.id,
      type: "folder",
      label: `${indent}📁 ${isRoot ? "Root" : node.name}`,
      path: path.join(" / "),
    });

    for (const child of node.children || []) {
      nodeOptionsFromTree(child, depth + 1, out, path);
    }
  } else if (node.type === "request") {
    out.push({
      id: node.id,
      type: "request",
      label: `${indent}🔗 ${node.name}`,
      path: parentPath.join(" / "),
    });
  }

  return out;
}

/**
 * Phase 3.4 RunnerPanel
 * - Primary: Run Collection Tree nodes (collection root / folder / request)
 * - Keeps legacy "saved + collections" runner as fallback (so nothing breaks)
 *
 * Props:
 * - envName, envVars
 * - runTarget?: { collectionId, nodeId, kind }  // coming from CollectionsPanel Run button
 * - onConsumeRunTarget?: () => void             // optional: parent can clear after auto-run
 * - saved, collections (legacy fallback)
 */
export default function RunnerPanel({
  envName,
  envVars,
  runTarget,
  onConsumeRunTarget,
  saved,
  collections,
}) {
  // -------------------------
  // Phase 3: Tree collections state
  // -------------------------
  const [trees, setTrees] = useState([]);
  const [selectedTreeCollectionId, setSelectedTreeCollectionId] = useState("");
  const [selectedTreeNodeId, setSelectedTreeNodeId] = useState("root");

  // Optional: manual multi-select (tree-based)
  const [treeSelectedRequestNodeIds, setTreeSelectedRequestNodeIds] = useState([]);

  // -------------------------
  // Execution + results state
  // -------------------------
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // Run history
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);

  // Legacy selection (fallback)
  const [legacySelectedIds, setLegacySelectedIds] = useState([]);
  const [legacySelectedCollectionId, setLegacySelectedCollectionId] = useState("");

  const abortRef = useRef(null);

  // -------------------------
  // Init
  // -------------------------
  useEffect(() => {
    setRuns(loadRuns());

    const t = loadCollectionTrees();
    setTrees(t);
    if (t.length) {
      setSelectedTreeCollectionId((prev) => prev || t[0].id);
      setSelectedTreeNodeId("root");
    }
  }, []);

  const refreshTrees = () => {
    const t = loadCollectionTrees();
    setTrees(t);
    if (t.length && !t.find((x) => x.id === selectedTreeCollectionId)) {
      setSelectedTreeCollectionId(t[0].id);
      setSelectedTreeNodeId("root");
      setTreeSelectedRequestNodeIds([]);
    }
  };

  // -------------------------
  // Derived: active tree collection + node options
  // -------------------------
  const activeTreeCollection = useMemo(() => {
    return trees.find((t) => t.id === selectedTreeCollectionId) || null;
  }, [trees, selectedTreeCollectionId]);

  const nodeOptions = useMemo(() => {
    if (!activeTreeCollection) return [{ id: "root", type: "folder", label: "📁 Root", path: "" }];
    return nodeOptionsFromTree(activeTreeCollection.root, 0, [], []);
  }, [activeTreeCollection]);

  // Flattened requests for:
  // - “Run Node” (selectedTreeNodeId)
  // - tree manual selection list (usually from root)
  const flattenedForSelectedNode = useMemo(() => {
    if (!selectedTreeCollectionId) return [];
    return flattenRequestsFromNode(selectedTreeCollectionId, selectedTreeNodeId);
  }, [selectedTreeCollectionId, selectedTreeNodeId]);

  const flattenedAllInCollection = useMemo(() => {
    if (!selectedTreeCollectionId) return [];
    return flattenRequestsFromNode(selectedTreeCollectionId, "root");
  }, [selectedTreeCollectionId, trees]);

  // -------------------------
  // Summary + active result
  // -------------------------
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

  // -------------------------
  // Legacy derived (fallback)
  // -------------------------
  const savedList = saved || [];
  const legacyCollections = collections || [];

  const legacySelectedRequests = useMemo(() => {
    const set = new Set(legacySelectedIds);
    return savedList.filter((s) => set.has(s.id));
  }, [savedList, legacySelectedIds]);

  const legacyCollectionRequests = useMemo(() => {
    if (!legacySelectedCollectionId) return [];
    return savedList.filter((s) => (s.collectionId || "") === legacySelectedCollectionId);
  }, [savedList, legacySelectedCollectionId]);

  // -------------------------
  // Execute run (shared)
  // -------------------------
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

  const executeRun = async (requestsToRun, metaLabel = "") => {
    if (!requestsToRun || requestsToRun.length === 0) return;

    setRunning(true);
    setResults([]);
    setActiveId(null);
    setSelectedRunId(null); // switch to live mode

    setProgress({
      index: 0,
      total: requestsToRun.length,
      current: requestsToRun[0],
      label: metaLabel,
    });

    const controller = new AbortController();
    abortRef.current = controller;

    const createdAt = new Date().toISOString();

    try {
      const out = await runBatch({
        requests: requestsToRun,
        envVars,
        signal: controller.signal,
        onProgress: (p) => setProgress({ ...p, label: metaLabel }),
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

  // -------------------------
  // Phase 3.4: Run from Tree
  // -------------------------
  const runTreeNode = async (collectionId, nodeId) => {
    const list = flattenRequestsFromNode(collectionId, nodeId);

    const requestsToRun = list.map((item) => {
      const payload = item.request || {};
      const displayName = item.path ? `${item.path} / ${item.name}` : item.name;

      return {
        ...payload,
        id: item.nodeId,
        name: displayName,
      };
    });

    const label = (() => {
      const col = trees.find((t) => t.id === collectionId);
      const colName = col?.name || "Collection";
      const nodeLabel =
        nodeId === "root"
          ? "Root"
          : nodeOptions.find((o) => o.id === nodeId)?.label?.replace(/^\s*[📁🔗]\s*/, "") ||
            "Node";
      return `${colName} • ${nodeLabel}`;
    })();

    await executeRun(requestsToRun, label);
  };

  const runTreeSelectedNode = async () => {
    if (!selectedTreeCollectionId) return;
    await runTreeNode(selectedTreeCollectionId, selectedTreeNodeId);
  };

  const toggleTreeSelected = (nodeId) => {
    setTreeSelectedRequestNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((x) => x !== nodeId) : [...prev, nodeId]
    );
  };

  const runTreeManualSelected = async () => {
    if (!selectedTreeCollectionId) return;
    const set = new Set(treeSelectedRequestNodeIds);

    const selected = flattenedAllInCollection.filter((x) => set.has(x.nodeId));

    const requestsToRun = selected.map((item) => {
      const payload = item.request || {};
      const displayName = item.path ? `${item.path} / ${item.name}` : item.name;
      return { ...payload, id: item.nodeId, name: displayName };
    });

    await executeRun(requestsToRun, `Manual selection • ${activeTreeCollection?.name || "Collection"}`);
  };

  const treeSelectAll = () => {
    setTreeSelectedRequestNodeIds(flattenedAllInCollection.map((x) => x.nodeId));
  };

  const treeClearSelection = () => setTreeSelectedRequestNodeIds([]);

  // -------------------------
  // Auto-run when coming from CollectionsPanel (Phase 3.4 integration)
  // -------------------------
  useEffect(() => {
    if (!runTarget) return;
    const { collectionId, nodeId } = runTarget || {};
    if (!collectionId || !nodeId) return;

    // Ensure trees are loaded (in case user ran immediately after app opened)
    if (!trees.length) {
      const t = loadCollectionTrees();
      setTrees(t);
    }

    // Align UI state to target
    setSelectedTreeCollectionId(collectionId);
    setSelectedTreeNodeId(nodeId);

    // Run
    runTreeNode(collectionId, nodeId).finally(() => {
      onConsumeRunTarget?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTarget]);

  // -------------------------
  // Legacy actions (fallback)
  // -------------------------
  const legacyToggle = (id) => {
    setLegacySelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const legacySelectAll = () => setLegacySelectedIds(savedList.map((s) => s.id));
  const legacyClear = () => setLegacySelectedIds([]);

  const legacySelectCollection = () => {
    const ids = legacyCollectionRequests.map((r) => r.id);
    setLegacySelectedIds(ids);
  };

  const runLegacySelected = async () => executeRun(legacySelectedRequests, "Legacy • Selected");
  const runLegacyCollection = async () => executeRun(legacyCollectionRequests, "Legacy • Collection");

  // -------------------------
  // Run history actions
  // -------------------------
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

  // -------------------------
  // UI
  // -------------------------
  const hasTree = trees.length > 0;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>Runner</div>
        <span className="badge">Env: {envName}</span>
      </div>

      {/* Phase 3.4: Tree runner */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>Collections (Tree)</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btnSm" onClick={refreshTrees} disabled={running}>
              Refresh
            </button>
            <span className="badge">{trees.length} total</span>
          </div>
        </div>

        {!hasTree ? (
          <div className="smallMuted" style={{ marginTop: 8 }}>
            No tree collections found yet. Create a Collection and save requests into it (Save to Collection).
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <span className="badge">Collection</span>
              <select
                className="select"
                value={selectedTreeCollectionId}
                onChange={(e) => {
                  setSelectedTreeCollectionId(e.target.value);
                  setSelectedTreeNodeId("root");
                  setTreeSelectedRequestNodeIds([]);
                }}
                disabled={running}
              >
                {trees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <span className="badge">Node</span>
              <select
                className="select"
                value={selectedTreeNodeId}
                onChange={(e) => setSelectedTreeNodeId(e.target.value)}
                disabled={running || !selectedTreeCollectionId}
                style={{ minWidth: 260 }}
              >
                {nodeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>

              <button
                className="btn btnPrimary btnSm"
                onClick={runTreeSelectedNode}
                disabled={running || !selectedTreeCollectionId || flattenedForSelectedNode.length === 0}
                title="Runs all requests inside the chosen folder/root/request"
              >
                Run node ({flattenedForSelectedNode.length})
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

            {selectedTreeCollectionId && flattenedAllInCollection.length === 0 ? (
              <div className="smallMuted" style={{ marginTop: 8 }}>
                This collection has no requests yet.
              </div>
            ) : null}

            {/* Tree manual selection */}
            {selectedTreeCollectionId && flattenedAllInCollection.length > 0 ? (
              <div className="card" style={{ padding: 12, marginTop: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Manual selection (this collection)</div>
                  <span className="badge">{flattenedAllInCollection.length} requests</span>
                </div>

                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button className="btn btnSm" onClick={treeSelectAll} disabled={running}>
                    Select all
                  </button>
                  <button
                    className="btn btnSm"
                    onClick={treeClearSelection}
                    disabled={running || treeSelectedRequestNodeIds.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    className="btn btnPrimary btnSm"
                    onClick={runTreeManualSelected}
                    disabled={running || treeSelectedRequestNodeIds.length === 0}
                    title="Runs only the checked requests"
                  >
                    Run selected ({treeSelectedRequestNodeIds.length})
                  </button>
                </div>

                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {flattenedAllInCollection.map((r) => {
                    const payload = r.request || {};
                    const displayName = r.path ? `${r.path} / ${r.name}` : r.name;
                    return (
                      <label key={r.nodeId} className="runnerRow">
                        <input
                          type="checkbox"
                          checked={treeSelectedRequestNodeIds.includes(r.nodeId)}
                          onChange={() => toggleTreeSelected(r.nodeId)}
                          disabled={running}
                        />
                        <div className="runnerRowMain">
                          <div style={{ fontWeight: 800 }}>
                            {displayName}
                            {payload.method ? (
                              <span className="badge" style={{ marginLeft: 8 }}>
                                {payload.method}
                              </span>
                            ) : null}
                          </div>
                          <div className="smallMuted" style={{ overflowWrap: "anywhere" }}>
                            {payload.url || "(no url)"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Run history */}
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

      {progress && running ? (
        <div className="smallMuted">
          {progress.label ? (
            <>
              Target: <b>{progress.label}</b> •{" "}
            </>
          ) : null}
          Running {progress.index + 1}/{progress.total}: <b>{progress.current?.name}</b>
        </div>
      ) : null}

      {viewingRun ? (
        <div className="smallMuted">
          Viewing past run: <b>{new Date(viewingRun.createdAt).toLocaleString()}</b> • {viewingRun.envName}
        </div>
      ) : null}

      {/* Legacy fallback (kept for now) */}
      {savedList.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>Legacy runner (Saved requests)</div>
            <span className="badge">{savedList.length} saved</span>
          </div>

          {/* Legacy collections */}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span className="badge">Collection</span>
            <select
              className="select"
              value={legacySelectedCollectionId}
              onChange={(e) => setLegacySelectedCollectionId(e.target.value)}
              disabled={running}
            >
              <option value="">(none)</option>
              {legacyCollections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <button
              className="btn btnSm"
              onClick={legacySelectCollection}
              disabled={!legacySelectedCollectionId || legacyCollectionRequests.length === 0 || running}
            >
              Select collection ({legacyCollectionRequests.length})
            </button>

            <button
              className="btn btnPrimary btnSm"
              onClick={runLegacyCollection}
              disabled={!legacySelectedCollectionId || legacyCollectionRequests.length === 0 || running}
            >
              Run collection
            </button>
          </div>

          {/* Legacy main controls */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn btnSm" onClick={legacySelectAll} disabled={running || savedList.length === 0}>
              Select all
            </button>
            <button className="btn btnSm" onClick={legacyClear} disabled={running || legacySelectedIds.length === 0}>
              Clear
            </button>
            <button
              className="btn btnPrimary btnSm"
              onClick={runLegacySelected}
              disabled={running || legacySelectedRequests.length === 0}
            >
              Run selected ({legacySelectedRequests.length})
            </button>
          </div>

          {/* Legacy selector list */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Select saved requests</div>
            <div className="stack" style={{ gap: 8 }}>
              {savedList.map((s) => (
                <label key={s.id} className="runnerRow">
                  <input
                    type="checkbox"
                    checked={legacySelectedIds.includes(s.id)}
                    onChange={() => legacyToggle(s.id)}
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
                          {legacyCollections.find((c) => c.id === s.collectionId)?.name || "Collection"}
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
          </div>
        </div>
      ) : null}

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
                    onClick={() => copyText(activeResult.rawText || prettyJson(activeResult.json) || "")}
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
                      <div key={i} className="row" style={{ justifyContent: "space-between", gap: 10 }}>
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
