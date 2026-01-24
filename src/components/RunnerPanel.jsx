import { useEffect, useMemo, useRef, useState } from "react";
import { runBatch } from "../utils/runner";
import { addRun, clearRuns, deleteRun, loadRuns } from "../utils/runStorage";
import { flattenRequestsFromNode, loadCollectionTrees } from "../utils/storage";

/* ----------------------------- Helpers ----------------------------- */

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

/* ----------------------------- Download Helpers ----------------------------- */

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ----------------------------- CSV Helpers (4.5.3) ----------------------------- */

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function makeCsv(headers, rows) {
  const headerLine = headers.map(csvEscape).join(",");
  const lines = rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","));
  return [headerLine, ...lines].join("\n");
}

/* ----------------------------- Tree helpers ----------------------------- */

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

/* ----------------------------- Result helpers ----------------------------- */

// "pass" | "fail" | "err"
function classifyResult(r) {
  if (!r?.ok) return "err";
  if (typeof r.total === "number" && r.total > 0) {
    return r.passed === r.total ? "pass" : "fail";
  }
  return "pass";
}

function resultBadgeLabel(r) {
  const type = classifyResult(r);
  if (type === "err") return "ERR";
  if (typeof r.total === "number" && r.total > 0) {
    return r.passed === r.total ? "PASS" : "FAIL";
  }
  return "OK";
}

function resultBadgeClass(r) {
  const type = classifyResult(r);
  if (type === "pass") return "badge badgeOk";
  return "badge badgeErr";
}

function summarizeResults(list) {
  const results = Array.isArray(list) ? list : [];
  const total = results.length;
  const ok = results.filter((r) => r.ok).length;
  const passedAll = results.filter((r) => r.total > 0 && r.passed === r.total).length;
  const failedAny = results.filter((r) => r.total > 0 && r.passed !== r.total).length;
  const err = results.filter((r) => !r.ok).length;
  return { total, ok, passedAll, failedAny, err };
}

/**
 * Compare runs uses a key per request:
 * baseId if present (for data-driven rows), else id, else name.
 * If multiple rows exist for same key, keep the WORST: err > fail > pass.
 */
function indexByKey(results) {
  const map = new Map();
  for (const r of results || []) {
    const key = r.baseId || r.id || r.name;
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, r);
    } else {
      const prev = map.get(key);
      const prevType = classifyResult(prev);
      const nextType = classifyResult(r);
      const rank = (t) => (t === "err" ? 3 : t === "fail" ? 2 : 1);
      if (rank(nextType) > rank(prevType)) map.set(key, r);
    }
  }
  return map;
}

function diffRuns(runA, runB) {
  const aResults = runA?.results || [];
  const bResults = runB?.results || [];
  const aIdx = indexByKey(aResults);
  const bIdx = indexByKey(bResults);

  const keys = Array.from(new Set([...aIdx.keys(), ...bIdx.keys()]));

  const changes = [];
  const unchanged = [];

  for (const key of keys) {
    const a = aIdx.get(key) || null;
    const b = bIdx.get(key) || null;

    const aType = a ? classifyResult(a) : "missing";
    const bType = b ? classifyResult(b) : "missing";

    const aStatus = a?.status ?? "—";
    const bStatus = b?.status ?? "—";
    const aTime = a?.timeMs ?? null;
    const bTime = b?.timeMs ?? null;
    const aTests = a && typeof a.total === "number" ? `${a.passed}/${a.total}` : "—";
    const bTests = b && typeof b.total === "number" ? `${b.passed}/${b.total}` : "—";

    const name = (b?.name || a?.name || String(key)).toString();

    const changed =
      aType !== bType ||
      String(aStatus) !== String(bStatus) ||
      aTests !== bTests ||
      (typeof aTime === "number" && typeof bTime === "number" && aTime !== bTime) ||
      (!a && !!b) ||
      (!!a && !b);

    const row = {
      key,
      name,
      a,
      b,
      aType,
      bType,
      aStatus,
      bStatus,
      aTime,
      bTime,
      aTests,
      bTests,
      changeFlags: {
        type: aType !== bType,
        status: String(aStatus) !== String(bStatus),
        tests: aTests !== bTests,
        time:
          typeof aTime === "number" &&
          typeof bTime === "number" &&
          aTime !== bTime,
        added: !a && !!b,
        removed: !!a && !b,
      },
    };

    if (changed) changes.push(row);
    else unchanged.push(row);
  }

  const score = (r) => {
    if (r.changeFlags.added || r.changeFlags.removed) return 1000;
    if (r.changeFlags.type) return 800;
    if (r.changeFlags.status) return 600;
    if (r.changeFlags.tests) return 400;
    if (r.changeFlags.time) return 200;
    return 0;
  };

  changes.sort((x, y) => score(y) - score(x) || x.name.localeCompare(y.name));

  return { changes, unchanged, totalKeys: keys.length };
}

/* ----------------------------- JUnit XML Helpers (4.5.4) ----------------------------- */

function xmlEscape(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toSeconds(ms) {
  const n = typeof ms === "number" && isFinite(ms) ? ms : 0;
  return (n / 1000).toFixed(3);
}

function resultsToJUnitXml({ suiteName, envName, results }) {
  const list = Array.isArray(results) ? results : [];

  // counts (JUnit expects failures + errors)
  let failures = 0;
  let errors = 0;
  let totalTime = 0;

  for (const r of list) {
    const t = classifyResult(r);
    if (t === "fail") failures += 1;
    if (t === "err") errors += 1;
    totalTime += typeof r.timeMs === "number" ? r.timeMs : 0;
  }

  const header = `<?xml version="1.0" encoding="UTF-8"?>`;

  const suiteAttrs = [
    `name="${xmlEscape(suiteName || "Bhejo Run")}"`,
    `tests="${list.length}"`,
    `failures="${failures}"`,
    `errors="${errors}"`,
    `time="${toSeconds(totalTime)}"`,
  ].join(" ");

  const props = [
    `<properties>`,
    `<property name="env" value="${xmlEscape(envName || "")}"/>`,
    `<property name="generatedAt" value="${xmlEscape(new Date().toISOString())}"/>`,
    `</properties>`,
  ].join("");

  const cases = list
    .map((r) => {
      const name = r.name || r.id || "request";
      const classname = envName ? `bhejo.${envName}` : "bhejo";
      const time = to.junitCaseTime = toSeconds(r.timeMs);

      const t = classifyResult(r);

      // put short body/error as system-out (optional)
      const outText =
        (r.ok
          ? (prettyJson(r.json) || r.rawText || "")
          : (r.error || "")) || "";

      const systemOut =
        outText.trim().length > 0
          ? `<system-out>${xmlEscape(truncate(outText, 2000))}</system-out>`
          : "";

      if (t === "pass") {
        return `<testcase classname="${xmlEscape(classname)}" name="${xmlEscape(
          name
        )}" time="${xmlEscape(time)}">${systemOut}</testcase>`;
      }

      if (t === "fail") {
        const msg = `Failed tests (${r.passed}/${r.total}) status=${r.status}`;
        return `<testcase classname="${xmlEscape(classname)}" name="${xmlEscape(
          name
        )}" time="${xmlEscape(time)}">${systemOut}<failure message="${xmlEscape(
          msg
        )}"/></testcase>`;
      }

      // err
      const msg = `Request error status=${r.status}`;
      const errBody = r.error || "Request failed";
      return `<testcase classname="${xmlEscape(classname)}" name="${xmlEscape(
        name
      )}" time="${xmlEscape(time)}">${systemOut}<error message="${xmlEscape(
        msg
      )}">${xmlEscape(truncate(errBody, 4000))}</error></testcase>`;
    })
    .join("");

  // Wrap in a single testsuite
  return `${header}<testsuite ${suiteAttrs}>${props}${cases}</testsuite>`;
}

export default function RunnerPanel({
  envName,
  envVars,
  runTarget,
  onConsumeRunTarget,
  saved,
  collections,
}) {
  /* ----------------------------- State ----------------------------- */

  // Tree collections state
  const [trees, setTrees] = useState([]);
  const [selectedTreeCollectionId, setSelectedTreeCollectionId] = useState("");
  const [selectedTreeNodeId, setSelectedTreeNodeId] = useState("root");
  const [treeSelectedRequestNodeIds, setTreeSelectedRequestNodeIds] = useState([]);

  // Execution + results state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // {index,total,current,label}
  const [results, setResults] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // Run history
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);

  // Legacy selection (fallback)
  const [legacySelectedIds, setLegacySelectedIds] = useState([]);
  const [legacySelectedCollectionId, setLegacySelectedCollectionId] = useState("");

  // Report search + filters
  const [reportQuery, setReportQuery] = useState("");
  const [reportFilter, setReportFilter] = useState("all"); // all|pass|fail|err

  // Compare runs (4.5.2)
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState("");
  const [compareBId, setCompareBId] = useState("");
  const [compareOnlyChanges, setCompareOnlyChanges] = useState(true);
  const [compareSelectedKey, setCompareSelectedKey] = useState("");
  const [compareQuery, setCompareQuery] = useState("");
  const compareSearchRef = useRef(null);

  const abortRef = useRef(null);

  /* ----------------------------- Init ----------------------------- */

  useEffect(() => {
    const list = loadRuns();
    setRuns(list);

    // default compare: last two runs
    if (list.length >= 2) {
      setCompareBId(list[0].id); // newest
      setCompareAId(list[1].id); // previous
    } else if (list.length === 1) {
      setCompareBId(list[0].id);
      setCompareAId(list[0].id);
    }

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

  /* ----------------------------- Derived ----------------------------- */

  const activeTreeCollection = useMemo(() => {
    return trees.find((t) => t.id === selectedTreeCollectionId) || null;
  }, [trees, selectedTreeCollectionId]);

  const nodeOptions = useMemo(() => {
    if (!activeTreeCollection)
      return [{ id: "root", type: "folder", label: "📁 Root", path: "" }];
    return nodeOptionsFromTree(activeTreeCollection.root, 0, [], []);
  }, [activeTreeCollection]);

  const flattenedForSelectedNode = useMemo(() => {
    if (!selectedTreeCollectionId) return [];
    return flattenRequestsFromNode(selectedTreeCollectionId, selectedTreeNodeId);
  }, [selectedTreeCollectionId, selectedTreeNodeId]);

  const flattenedAllInCollection = useMemo(() => {
    if (!selectedTreeCollectionId) return [];
    return flattenRequestsFromNode(selectedTreeCollectionId, "root");
  }, [selectedTreeCollectionId, trees]);

  const treeRequestMap = useMemo(() => {
    const map = new Map();
    for (const item of flattenedAllInCollection) {
      map.set(item.nodeId, item.request || {});
    }
    return map;
  }, [flattenedAllInCollection]);

  const activeResult = useMemo(() => {
    return results.find((r) => r.id === activeId) || null;
  }, [results, activeId]);

  const currentSummary = useMemo(() => summarizeResults(results), [results]);

  // Legacy derived (fallback)
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

  const savedRequestMap = useMemo(() => {
    const map = new Map();
    for (const s of savedList) map.set(s.id, s);
    return map;
  }, [savedList]);

  /* ----------------------------- Execution ----------------------------- */

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
    setSelectedRunId(null);

    setProgress({
      index: 0,
      total: requestsToRun.length,
      current: requestsToRun[0],
      label: metaLabel,
    });

    setReportQuery("");
    setReportFilter("all");

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

      const summary = summarizeResults(out);

      const updatedRuns = addRun({
        createdAt,
        envName,
        summary,
        results: out,
      });
      setRuns(updatedRuns);

      // update compare defaults: last two
      if (updatedRuns.length >= 2) {
        setCompareBId(updatedRuns[0].id);
        setCompareAId(updatedRuns[1].id);
      } else if (updatedRuns.length === 1) {
        setCompareBId(updatedRuns[0].id);
        setCompareAId(updatedRuns[0].id);
      }
    } catch {
      // ignore abort
    } finally {
      setRunning(false);
      abortRef.current = null;
      setProgress(null);
    }
  };

  /* ----------------------------- Tree runs ----------------------------- */

  const runTreeNode = async (collectionId, nodeId) => {
    const list = flattenRequestsFromNode(collectionId, nodeId);

    const requestsToRun = list.map((item) => {
      const payload = item.request || {};
      const displayName = item.path ? `${item.path} / ${item.name}` : item.name;
      return { ...payload, id: item.nodeId, name: displayName };
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

    await executeRun(
      requestsToRun,
      `Manual selection • ${activeTreeCollection?.name || "Collection"}`
    );
  };

  const treeSelectAll = () => setTreeSelectedRequestNodeIds(flattenedAllInCollection.map((x) => x.nodeId));
  const treeClearSelection = () => setTreeSelectedRequestNodeIds([]);

  /* ----------------------------- Auto-run from CollectionsPanel ----------------------------- */

  useEffect(() => {
    if (!runTarget) return;
    const { collectionId, nodeId } = runTarget || {};
    if (!collectionId || !nodeId) return;

    if (!trees.length) {
      const t = loadCollectionTrees();
      setTrees(t);
    }

    setSelectedTreeCollectionId(collectionId);
    setSelectedTreeNodeId(nodeId);

    runTreeNode(collectionId, nodeId).finally(() => onConsumeRunTarget?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTarget]);

  /* ----------------------------- Legacy fallback ----------------------------- */

  const legacyToggle = (id) => {
    setLegacySelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const runLegacySelected = async () => executeRun(legacySelectedRequests, "Legacy • Selected");
  const runLegacyCollection = async () => executeRun(legacyCollectionRequests, "Legacy • Collection");

  /* ----------------------------- Runs ----------------------------- */

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

  /* ----------------------------- Report filters ----------------------------- */

  const filteredResults = useMemo(() => {
    const q = String(reportQuery || "").trim().toLowerCase();

    return (results || []).filter((r) => {
      const type = classifyResult(r);
      if (reportFilter !== "all" && type !== reportFilter) return false;

      if (!q) return true;

      const hay = `${r.name || ""} ${r.finalUrl || ""} ${r.status || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [results, reportQuery, reportFilter]);

  const exportFiltered = () => {
    const payload = {
      version: "bhejo-run-v1",
      exportedAt: new Date().toISOString(),
      envName,
      filter: { reportFilter, reportQuery },
      summary: summarizeResults(filteredResults),
      results: filteredResults,
    };

    downloadJson(
      `bhejo-run-filtered-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`,
      payload
    );
  };

  /* ----------------------------- 4.5.3 CSV Export ----------------------------- */

  function resultsToCsvRows(list) {
    return (list || []).map((r) => {
      const type = classifyResult(r);
      return {
        name: r.name || "",
        method: r.method || "",
        finalUrl: r.finalUrl || "",
        status: r.status ?? "",
        timeMs: r.timeMs ?? "",
        resultType: type.toUpperCase(),
        passed: typeof r.passed === "number" ? r.passed : "",
        total: typeof r.total === "number" ? r.total : "",
        iteration: r.iteration ?? "",
        iterationTotal: r.iterationTotal ?? "",
        error: r.ok ? "" : (r.error || ""),
      };
    });
  }

  const exportCurrentCsv = () => {
    const headers = [
      "name",
      "method",
      "finalUrl",
      "status",
      "timeMs",
      "resultType",
      "passed",
      "total",
      "iteration",
      "iterationTotal",
      "error",
    ];
    const rows = resultsToCsvRows(results);
    const csv = makeCsv(headers, rows);
    downloadText(
      `bhejo-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  };

  const exportFilteredCsv = () => {
    const headers = [
      "name",
      "method",
      "finalUrl",
      "status",
      "timeMs",
      "resultType",
      "passed",
      "total",
      "iteration",
      "iterationTotal",
      "error",
    ];
    const rows = resultsToCsvRows(filteredResults);
    const csv = makeCsv(headers, rows);
    downloadText(
      `bhejo-run-filtered-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  };

  /* ----------------------------- 4.5.4 JUnit Export ----------------------------- */

  const exportCurrentJUnit = () => {
    const xml = resultsToJUnitXml({
      suiteName: "Bhejo Current Run",
      envName,
      results,
    });
    downloadText(
      `bhejo-run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xml`,
      xml,
      "application/xml;charset=utf-8"
    );
  };

  const exportFilteredJUnit = () => {
    const xml = resultsToJUnitXml({
      suiteName: "Bhejo Filtered Run",
      envName,
      results: filteredResults,
    });
    downloadText(
      `bhejo-run-filtered-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xml`,
      xml,
      "application/xml;charset=utf-8"
    );
  };

  /* ----------------------------- 4.5.1 Run only FAIL / rerun failed ----------------------------- */

  function collectBaseIds(mode) {
    const set = new Set();
    for (const r of results || []) {
      const t = classifyResult(r);
      if (mode === "failOnly") {
        if (t !== "fail") continue;
      } else {
        if (t === "pass") continue;
      }
      set.add(r.baseId || r.id);
    }
    return Array.from(set).filter(Boolean);
  }

  function resolveRequestsFromBaseIds(baseIds) {
    const requestsToRun = [];

    for (const id of baseIds) {
      if (treeRequestMap.has(id)) {
        const payload = treeRequestMap.get(id) || {};
        requestsToRun.push({ ...payload, id, name: payload.name || `(${id})` });
        continue;
      }

      if (savedRequestMap.has(id)) {
        const payload = savedRequestMap.get(id) || {};
        requestsToRun.push({
          ...payload,
          id: payload.id || id,
          name: payload.name || `(${id})`,
        });
      }
    }

    if (selectedTreeCollectionId && requestsToRun.length) {
      const pathMap = new Map(
        flattenedAllInCollection.map((x) => [
          x.nodeId,
          x.path ? `${x.path} / ${x.name}` : x.name,
        ])
      );
      for (let i = 0; i < requestsToRun.length; i++) {
        const rid = requestsToRun[i].id;
        const nice = pathMap.get(rid);
        if (nice) requestsToRun[i].name = nice;
      }
    }

    return requestsToRun;
  }

  const canResolveFailTests = useMemo(() => {
    const baseIds = collectBaseIds("failOnly");
    if (!baseIds.length) return false;
    return baseIds.some((id) => treeRequestMap.has(id) || savedRequestMap.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, treeRequestMap, savedRequestMap]);

  const canResolveFailedToRequests = useMemo(() => {
    const baseIds = collectBaseIds("failOrErr");
    if (!baseIds.length) return false;
    return baseIds.some((id) => treeRequestMap.has(id) || savedRequestMap.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, treeRequestMap, savedRequestMap]);

  const rerunFailTestsOnly = async () => {
    const baseIds = collectBaseIds("failOnly");
    const requestsToRun = resolveRequestsFromBaseIds(baseIds);
    if (!requestsToRun.length) return;
    await executeRun(requestsToRun, "Run only FAIL (tests)");
  };

  const rerunFailed = async () => {
    const baseIds = collectBaseIds("failOrErr");
    const requestsToRun = resolveRequestsFromBaseIds(baseIds);
    if (!requestsToRun.length) return;
    await executeRun(requestsToRun, "Rerun failed (FAIL+ERR)");
  };

  /* ----------------------------- 4.5.2 Compare Runs ----------------------------- */

  const runById = useMemo(() => {
    const map = new Map();
    for (const r of runs) map.set(r.id, r);
    return map;
  }, [runs]);

  const compareRunA = useMemo(() => runById.get(compareAId) || null, [runById, compareAId]);
  const compareRunB = useMemo(() => runById.get(compareBId) || null, [runById, compareBId]);

  const compareSummaryA = useMemo(() => summarizeResults(compareRunA?.results || []), [compareRunA]);
  const compareSummaryB = useMemo(() => summarizeResults(compareRunB?.results || []), [compareRunB]);

  const compareDiff = useMemo(() => {
    if (!compareRunA || !compareRunB) return { changes: [], unchanged: [], totalKeys: 0 };
    return diffRuns(compareRunA, compareRunB);
  }, [compareRunA, compareRunB]);

  const compareRows = useMemo(() => {
    return compareOnlyChanges
      ? compareDiff.changes
      : [...compareDiff.changes, ...compareDiff.unchanged];
  }, [compareDiff, compareOnlyChanges]);

  const compareRowsFiltered = useMemo(() => {
    const q = String(compareQuery || "").trim().toLowerCase();
    if (!q) return compareRows;
    return compareRows.filter((r) => `${r.name} ${r.key}`.toLowerCase().includes(q));
  }, [compareRows, compareQuery]);

  const compareSelected = useMemo(() => {
    if (!compareSelectedKey) return null;
    return compareRows.find((r) => r.key === compareSelectedKey) || null;
  }, [compareRows, compareSelectedKey]);

  const openCompare = () => {
    if (runs.length === 0) return;
    setCompareOpen(true);
    setTimeout(() => compareSearchRef.current?.focus?.(), 0);
  };

  const closeCompare = () => {
    setCompareOpen(false);
    setCompareSelectedKey("");
    setCompareQuery("");
  };

  const summaryDelta = (k) => (compareSummaryB?.[k] || 0) - (compareSummaryA?.[k] || 0);

  // 4.5.3: Export compare diff CSV
  const exportCompareDiffCsv = () => {
    const rows = (compareDiff?.changes || []).map((row) => ({
      name: row.name || "",
      key: row.key || "",
      aStatus: row.aStatus ?? "",
      bStatus: row.bStatus ?? "",
      aType: row.aType ?? "",
      bType: row.bType ?? "",
      aTests: row.aTests ?? "",
      bTests: row.bTests ?? "",
      aTime: row.aTime ?? "",
      bTime: row.bTime ?? "",
      changedType: row.changeFlags?.type ? "YES" : "",
      changedStatus: row.changeFlags?.status ? "YES" : "",
      changedTests: row.changeFlags?.tests ? "YES" : "",
      changedTime: row.changeFlags?.time ? "YES" : "",
      added: row.changeFlags?.added ? "YES" : "",
      removed: row.changeFlags?.removed ? "YES" : "",
    }));

    const headers = [
      "name",
      "key",
      "aStatus",
      "bStatus",
      "aType",
      "bType",
      "aTests",
      "bTests",
      "aTime",
      "bTime",
      "changedType",
      "changedStatus",
      "changedTests",
      "changedTime",
      "added",
      "removed",
    ];

    const csv = makeCsv(headers, rows);
    downloadText(
      `bhejo-compare-diff-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  };

  /* ----------------------------- Progress ----------------------------- */

  const progressPct = useMemo(() => {
    if (!progress || !progress.total) return 0;
    const idx = Math.max(0, Math.min(progress.index, progress.total - 1));
    return Math.round(((idx + 1) / progress.total) * 100);
  }, [progress]);

  const hasTree = trees.length > 0;

  /* ----------------------------- UI ----------------------------- */

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* Compare modal */}
      {compareOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCompare();
          }}
        >
          <div
            className="panel"
            style={{
              width: "min(1180px, 100%)",
              maxHeight: "88vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="panelHeader" style={{ justifyContent: "space-between" }}>
              <div className="panelTitle">Compare runs</div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btnSm"
                  onClick={exportCompareDiffCsv}
                  disabled={!compareDiff?.changes?.length}
                >
                  Export diff CSV
                </button>
                <button className="btn btnSm" onClick={closeCompare}>
                  Close
                </button>
              </div>
            </div>

            <div className="panelBody" style={{ overflow: "auto" }}>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className="badge">Run A</span>
                <select
                  className="select"
                  value={compareAId}
                  onChange={(e) => setCompareAId(e.target.value)}
                  style={{ minWidth: 320 }}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleString()} • {r.envName}
                    </option>
                  ))}
                </select>

                <span className="badge">Run B</span>
                <select
                  className="select"
                  value={compareBId}
                  onChange={(e) => setCompareBId(e.target.value)}
                  style={{ minWidth: 320 }}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleString()} • {r.envName}
                    </option>
                  ))}
                </select>

                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={compareOnlyChanges}
                    onChange={(e) => setCompareOnlyChanges(e.target.checked)}
                  />
                  <span className="smallMuted">Show only changed</span>
                </label>

                <input
                  ref={compareSearchRef}
                  className="input"
                  value={compareQuery}
                  onChange={(e) => setCompareQuery(e.target.value)}
                  placeholder="Search request…"
                  style={{ flex: 1, minWidth: 220 }}
                />
              </div>

              <div
                className="card"
                style={{
                  padding: 12,
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>Run A</div>
                  <div className="smallMuted" style={{ marginTop: 6 }}>
                    {compareRunA ? new Date(compareRunA.createdAt).toLocaleString() : "—"} •{" "}
                    {compareRunA?.envName || "—"}
                  </div>

                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {["total", "ok", "passedAll", "failedAny", "err"].map((k) => (
                      <span key={k} className="badge">
                        {k}: {compareSummaryA?.[k] ?? 0}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 800 }}>Run B</div>
                  <div className="smallMuted" style={{ marginTop: 6 }}>
                    {compareRunB ? new Date(compareRunB.createdAt).toLocaleString() : "—"} •{" "}
                    {compareRunB?.envName || "—"}
                  </div>

                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {["total", "ok", "passedAll", "failedAny", "err"].map((k) => {
                      const d = summaryDelta(k);
                      const sign = d > 0 ? "+" : "";
                      return (
                        <span
                          key={k}
                          className="badge"
                          title={`Δ ${k} = ${d}`}
                          style={{
                            borderColor:
                              d === 0
                                ? "var(--border)"
                                : d > 0
                                ? "rgba(34,197,94,0.55)"
                                : "rgba(239,68,68,0.55)",
                          }}
                        >
                          {k}: {compareSummaryB?.[k] ?? 0}{" "}
                          <span style={{ opacity: 0.8 }}>
                            ({sign}
                            {d})
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 0.9fr",
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <div className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800 }}>
                      Changes ({compareDiff.changes.length}) • Total keys ({compareDiff.totalKeys})
                    </div>
                    <span className="badge">Click a row to inspect</span>
                  </div>

                  <div className="runnerTableWrap" style={{ marginTop: 10 }}>
                    <table className="runnerTable">
                      <thead>
                        <tr>
                          <th>Request</th>
                          <th>A</th>
                          <th>B</th>
                          <th>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareRowsFiltered.map((row) => {
                          const isSelected = row.key === compareSelectedKey;

                          const deltaTime =
                            typeof row.aTime === "number" && typeof row.bTime === "number"
                              ? row.bTime - row.aTime
                              : null;

                          const deltaLabel =
                            row.changeFlags.added
                              ? "ADDED"
                              : row.changeFlags.removed
                              ? "REMOVED"
                              : row.changeFlags.type
                              ? "TYPE"
                              : row.changeFlags.status
                              ? "STATUS"
                              : row.changeFlags.tests
                              ? "TESTS"
                              : row.changeFlags.time
                              ? "TIME"
                              : "—";

                          return (
                            <tr
                              key={row.key}
                              onClick={() => setCompareSelectedKey(row.key)}
                              style={{
                                cursor: "pointer",
                                background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                              }}
                            >
                              <td style={{ fontWeight: 800 }}>
                                {row.name}
                                <div className="smallMuted" style={{ marginTop: 2 }}>
                                  {String(row.key)}
                                </div>
                              </td>

                              <td>
                                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                  <span className="badge">{String(row.aStatus)}</span>
                                  <span className="badge">{row.aTests}</span>
                                  <span className="badge">{row.aType}</span>
                                  {typeof row.aTime === "number" ? (
                                    <span className="badge">{row.aTime} ms</span>
                                  ) : null}
                                </div>
                              </td>

                              <td>
                                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                  <span className="badge">{String(row.bStatus)}</span>
                                  <span className="badge">{row.bTests}</span>
                                  <span className="badge">{row.bType}</span>
                                  {typeof row.bTime === "number" ? (
                                    <span className="badge">{row.bTime} ms</span>
                                  ) : null}
                                </div>
                              </td>

                              <td>
                                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                  <span className="badge">{deltaLabel}</span>
                                  {typeof deltaTime === "number" ? (
                                    <span className="badge" title="B - A">
                                      {deltaTime > 0 ? "+" : ""}
                                      {deltaTime} ms
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {compareRowsFiltered.length === 0 ? (
                      <div className="smallMuted" style={{ marginTop: 10 }}>
                        No rows match your compare filter/search.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800 }}>Inspect</div>
                    {compareSelected ? (
                      <span className="badge">
                        {compareSelected.aType} → {compareSelected.bType}
                      </span>
                    ) : (
                      <span className="badge">Pick a row</span>
                    )}
                  </div>

                  {!compareSelected ? (
                    <div className="smallMuted" style={{ marginTop: 10 }}>
                      Select a changed request from the table.
                    </div>
                  ) : (
                    <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                      <div className="panelSoft">
                        <div style={{ fontWeight: 800 }}>Run A</div>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          <span className="badge">Status: {String(compareSelected.aStatus)}</span>
                          <span className="badge">Tests: {compareSelected.aTests}</span>
                          <span className="badge">Type: {compareSelected.aType}</span>
                          {typeof compareSelected.aTime === "number" ? (
                            <span className="badge">{compareSelected.aTime} ms</span>
                          ) : null}
                        </div>

                        <pre className="codeBlock" style={{ marginTop: 10, maxHeight: 200, overflow: "auto" }}>
                          {compareSelected.a
                            ? prettyJson(compareSelected.a.json) ||
                              compareSelected.a.rawText ||
                              compareSelected.a.error ||
                              "(empty)"
                            : "(missing in A)"}
                        </pre>
                      </div>

                      <div className="panelSoft">
                        <div style={{ fontWeight: 800 }}>Run B</div>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          <span className="badge">Status: {String(compareSelected.bStatus)}</span>
                          <span className="badge">Tests: {compareSelected.bTests}</span>
                          <span className="badge">Type: {compareSelected.bType}</span>
                          {typeof compareSelected.bTime === "number" ? (
                            <span className="badge">{compareSelected.bTime} ms</span>
                          ) : null}
                        </div>

                        <pre className="codeBlock" style={{ marginTop: 10, maxHeight: 200, overflow: "auto" }}>
                          {compareSelected.b
                            ? prettyJson(compareSelected.b.json) ||
                              compareSelected.b.rawText ||
                              compareSelected.b.error ||
                              "(empty)"
                            : "(missing in B)"}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn btnSm" onClick={closeCompare}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top header */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>Runner</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge">Env: {envName}</span>
          <button className="btn btnSm" onClick={openCompare} disabled={runs.length < 1}>
            Compare runs
          </button>
        </div>
      </div>

      {/* Progress */}
      {progress && running ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div className="smallMuted">
              {progress.label ? (
                <>
                  Target: <b>{progress.label}</b> •{" "}
                </>
              ) : null}
              Running <b>{progress.index + 1}</b>/<b>{progress.total}</b>:{" "}
              <b>{progress.current?.name}</b>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <span className="badge">{progressPct}%</span>
              <button className="btn btnDanger btnSm" onClick={stop}>
                Stop
              </button>
            </div>
          </div>

          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "var(--card2)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              marginTop: 10,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "var(--accent)",
                transition: "width 120ms linear",
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Collections (Tree) */}
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
            No tree collections found yet. Create a Collection and save requests into it.
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
              >
                Run node ({flattenedForSelectedNode.length})
              </button>

              {/* JSON exports */}
              <button className="btn btnSm" onClick={exportCurrentRun} disabled={results.length === 0}>
                Export JSON (current)
              </button>
              <button className="btn btnSm" onClick={exportFiltered} disabled={filteredResults.length === 0}>
                Export JSON (filtered)
              </button>

              {/* CSV exports (4.5.3) */}
              <button className="btn btnSm" onClick={exportCurrentCsv} disabled={results.length === 0}>
                Export CSV (current)
              </button>
              <button className="btn btnSm" onClick={exportFilteredCsv} disabled={filteredResults.length === 0}>
                Export CSV (filtered)
              </button>

              {/* JUnit exports (4.5.4) */}
              <button className="btn btnSm" onClick={exportCurrentJUnit} disabled={results.length === 0}>
                Export JUnit (current)
              </button>
              <button className="btn btnSm" onClick={exportFilteredJUnit} disabled={filteredResults.length === 0}>
                Export JUnit (filtered)
              </button>

              {/* 4.5.1 buttons */}
              <button
                className="btn btnSm"
                onClick={rerunFailTestsOnly}
                disabled={running || !canResolveFailTests}
                title="Runs only requests that failed tests (PASS!=TOTAL). Does not include ERR."
              >
                Run only FAIL
              </button>

              <button
                className="btn btnSm"
                onClick={rerunFailed}
                disabled={running || !canResolveFailedToRequests}
                title="Rerun FAIL + ERR"
              >
                Rerun failed
              </button>
            </div>

            {/* Manual selection */}
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
              <div key={r.id} className="runHistoryRow">
                <div
                  className="runHistoryMain"
                  onClick={() => {
                    setSelectedRunId(r.id);
                    setResults(r.results || []);
                    setActiveId(r.results?.[0]?.id || null);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ fontWeight: 800 }}>
                    {new Date(r.createdAt).toLocaleString()}{" "}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {r.envName}
                    </span>
                  </div>
                  <div className="smallMuted">
                    total {r.summary?.total || 0} • ok {r.summary?.ok || 0} • all-pass{" "}
                    {r.summary?.passedAll || 0} • failed-tests {r.summary?.failedAny || 0} • err{" "}
                    {r.summary?.err || 0}
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
                    Export JSON
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

      {/* Report */}
      {results.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>Run report</div>
            <span className="badge">
              {currentSummary.ok}/{currentSummary.total} ok • {currentSummary.passedAll} all-pass •{" "}
              {currentSummary.failedAny} failed-tests • {currentSummary.err} err
            </span>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className={`btn btnSm ${reportFilter === "all" ? "btnPrimary" : ""}`}
                onClick={() => setReportFilter("all")}
              >
                All ({results.length})
              </button>
              <button
                className={`btn btnSm ${reportFilter === "pass" ? "btnPrimary" : ""}`}
                onClick={() => setReportFilter("pass")}
              >
                Pass ({results.filter((r) => classifyResult(r) === "pass").length})
              </button>
              <button
                className={`btn btnSm ${reportFilter === "fail" ? "btnPrimary" : ""}`}
                onClick={() => setReportFilter("fail")}
              >
                Fail ({results.filter((r) => classifyResult(r) === "fail").length})
              </button>
              <button
                className={`btn btnSm ${reportFilter === "err" ? "btnPrimary" : ""}`}
                onClick={() => setReportFilter("err")}
              >
                Error ({results.filter((r) => classifyResult(r) === "err").length})
              </button>
            </div>

            <input
              className="input"
              value={reportQuery}
              onChange={(e) => setReportQuery(e.target.value)}
              placeholder="Search name / url / status…"
              style={{ flex: 1, minWidth: 240 }}
            />

            <button className="btn btnSm" onClick={exportFiltered} disabled={filteredResults.length === 0}>
              Export JSON (filtered)
            </button>
            <button className="btn btnSm" onClick={exportFilteredCsv} disabled={filteredResults.length === 0}>
              Export CSV (filtered)
            </button>
            <button className="btn btnSm" onClick={exportFilteredJUnit} disabled={filteredResults.length === 0}>
              Export JUnit (filtered)
            </button>
          </div>

          <div className="runnerTableWrap" style={{ marginTop: 10 }}>
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
                {filteredResults.map((r) => {
                  const testsLabel = r.total ? `${r.passed}/${r.total}` : "-";
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
                        <span className={resultBadgeClass(r)}>{resultBadgeLabel(r)}</span>
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
                      copyText(activeResult.rawText || prettyJson(activeResult.json) || activeResult.error || "")
                    }
                  >
                    Copy body
                  </button>
                  <button className="btn btnSm" onClick={() => setActiveId(null)}>
                    Close
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <pre className="codeBlock">
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
