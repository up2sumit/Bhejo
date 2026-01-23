// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import RequestBuilder from "./components/RequestBuilder";
import ResponseViewer from "./components/ResponseViewer";
import HistoryPanel from "./components/HistoryPanel";
import SavedPanel from "./components/SavedPanel";
import EnvPanel from "./components/EnvPanel";
import RunnerPanel from "./components/RunnerPanel";
import ToolsPanel from "./components/ToolsPanel";
import CollectionsPanel from "./components/CollectionsPanel";

import {
  // history
  loadHistory,
  addHistory,
  deleteHistory,
  clearHistory,

  // legacy saved (kept for now)
  loadSaved,
  upsertSavedByName,
  deleteSaved,

  // env
  loadCurrentEnv,
  saveCurrentEnv,
  loadEnvVars,
  saveEnvVars,

  // legacy collections (kept for now)
  loadCollections,

  // Phase 3: tree collections
  loadCollectionTrees,
} from "./utils/storage";

import "./App.css";

const THEME_KEY = "bhejo_theme_v1";

function tabTitle(tab) {
  if (tab === "history") return "History";
  if (tab === "saved") return "Saved";
  if (tab === "env") return "Environments";
  if (tab === "collections") return "Collections";
  if (tab === "runner") return "Runner";
  return "Tools";
}

export default function App() {
  const [response, setResponse] = useState(null);

  const [history, setHistory] = useState([]);
  const [saved, setSaved] = useState([]);

  // legacy collections (SavedPanel still uses this today)
  const [collections, setCollections] = useState([]);

  // Phase 3 tree collections count (badge)
  const [treeCollectionsCount, setTreeCollectionsCount] = useState(0);

  const [selected, setSelected] = useState(null);
  const [sidebarTab, setSidebarTab] = useState("history"); // history | saved | env | collections | runner | tools

  // Phase 3.4: when CollectionsPanel says "Run folder/collection/request"
  const [runTarget, setRunTarget] = useState(null);

  // env
  const [envName, setEnvName] = useState(loadCurrentEnv());
  const [envVarsAll, setEnvVarsAll] = useState(loadEnvVars());
  const envVars = envVarsAll?.[envName] || {};

  // theme
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    return savedTheme === "light" ? "light" : "dark";
  });

  const refreshAllFromStorage = () => {
    setHistory(loadHistory());
    setSaved(loadSaved());
    setCollections(loadCollections());
    setEnvVarsAll(loadEnvVars());

    const trees = loadCollectionTrees();
    setTreeCollectionsCount(Array.isArray(trees) ? trees.length : 0);
  };

  // initial load
  useEffect(() => {
    refreshAllFromStorage();

    const onStorage = (e) => {
      if (!e?.key) return;
      if (e.key.startsWith("bhejo_") || e.key === THEME_KEY) {
        refreshAllFromStorage();
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme persist
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // env persist
  useEffect(() => {
    saveCurrentEnv(envName);
  }, [envName]);

  // env vars persist
  useEffect(() => {
    saveEnvVars(envVarsAll);
  }, [envVarsAll]);

  const subtitle = useMemo(() => "Minimal API client • Phase 3.8.4", []);

  // -----------------------
  // History handlers
  // -----------------------
  const handleSaveHistory = (item) => {
    const updated = addHistory(item);
    setHistory(updated);
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
    setSelected(null);
    setResponse(null);
  };

  const handleDeleteHistoryOne = (id) => {
    const updated = deleteHistory(id);
    setHistory(updated);
    if (selected?.id === id) {
      setSelected(null);
      setResponse(null);
    }
  };

  const handleCloneFromHistory = (item) => {
    setSelected({ ...item, savedAt: new Date().toISOString() });
  };

  // -----------------------
  // Legacy Saved handlers (kept for now)
  // -----------------------
  const handleSaveRequest = (draft) => {
    const updated = upsertSavedByName(draft);
    setSaved(updated);
    setSidebarTab("saved");
  };

  const handleLoadSaved = (item) => {
    setSelected({
      id: item.id,
      name: item.name,
      method: item.method,
      url: item.url,
      params: item.params,
      headers: item.headers,
      body: item.body,
      auth: item.auth,
      tests: item.tests || [],
      dataRows: item.dataRows || [],
      mode: item.mode || "direct",
      savedAt: new Date().toISOString(),
    });
  };

  const handleDeleteSavedOne = (id) => {
    const updated = deleteSaved(id);
    setSaved(updated);
  };

  // -----------------------
  // Collections (Tree) handlers
  // -----------------------
  const handleLoadFromTree = (payload) => {
    setSelected({
      ...payload,
      savedAt: new Date().toISOString(),
    });
  };

  const handleRunFromTree = ({ collectionId, nodeId, kind }) => {
    setRunTarget({ collectionId, nodeId, kind });
    setSidebarTab("runner");
  };

  // -----------------------
  // Top navigation (moved from sidebar)
  // -----------------------
  const goToTab = (tab) => {
    if (tab === "collections") {
      const trees = loadCollectionTrees();
      setTreeCollectionsCount(Array.isArray(trees) ? trees.length : 0);
    }
    setSidebarTab(tab);
  };

  // -----------------------
  // Right-side badge/actions (now used in sidebar header only)
  // -----------------------
  const sidebarHeaderRight = useMemo(() => {
    if (sidebarTab === "history") {
      return (
        <button className="btn btnDanger btnSm" onClick={handleClearHistory}>
          Clear
        </button>
      );
    }
    if (sidebarTab === "saved") return <span className="badge">{saved.length} saved</span>;
    if (sidebarTab === "env") return <span className="badge">{envName}</span>;
    if (sidebarTab === "collections") return <span className="badge">{treeCollectionsCount}</span>;
    if (sidebarTab === "runner") return <span className="badge">{envName}</span>;
    return <span className="badge">Tools</span>;
  }, [sidebarTab, saved.length, envName, treeCollectionsCount]);

  return (
    <div className="container">
      <div className="header headerWithNav">
        <div className="brand">
          <h1>Bhejo</h1>
          <p>{subtitle}</p>
        </div>

        {/* moved nav to top */}
        <div className="topNav" role="tablist" aria-label="Primary navigation">
          <button
            className={`topNavBtn ${sidebarTab === "history" ? "active" : ""}`}
            onClick={() => goToTab("history")}
            role="tab"
            aria-selected={sidebarTab === "history"}
          >
            History
          </button>
          <button
            className={`topNavBtn ${sidebarTab === "saved" ? "active" : ""}`}
            onClick={() => goToTab("saved")}
            role="tab"
            aria-selected={sidebarTab === "saved"}
          >
            Saved
          </button>
          <button
            className={`topNavBtn ${sidebarTab === "env" ? "active" : ""}`}
            onClick={() => goToTab("env")}
            role="tab"
            aria-selected={sidebarTab === "env"}
          >
            Env
          </button>
          <button
            className={`topNavBtn ${sidebarTab === "collections" ? "active" : ""}`}
            onClick={() => goToTab("collections")}
            role="tab"
            aria-selected={sidebarTab === "collections"}
          >
            Collections
          </button>
          <button
            className={`topNavBtn ${sidebarTab === "runner" ? "active" : ""}`}
            onClick={() => goToTab("runner")}
            role="tab"
            aria-selected={sidebarTab === "runner"}
          >
            Runner
          </button>
          <button
            className={`topNavBtn ${sidebarTab === "tools" ? "active" : ""}`}
            onClick={() => goToTab("tools")}
            role="tab"
            aria-selected={sidebarTab === "tools"}
          >
            Tools
          </button>
        </div>

        <div className="headerRight">
          <span className="badge">Local only</span>

          <button
            className="btn btnSm"
            onClick={() => window.open("/console.html", "bhejo_console", "width=980,height=720")}
            title="Open Console"
          >
            Open Console
          </button>

          <button
            className="themeToggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            <span className="themeText">{theme === "dark" ? "Dark" : "Light"}</span>
            <span className="themeKnob" />
          </button>
        </div>
      </div>

      <div className="layout">
        {/* LEFT */}
        <div className="panel">
          <div className="panelHeader">
            <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
              <div className="panelTitle">{tabTitle(sidebarTab)}</div>
              {sidebarHeaderRight}
            </div>
          </div>

          <div className="panelBody sidebarBody">
            {sidebarTab === "history" ? (
              <HistoryPanel
                history={history}
                onSelect={setSelected}
                onClone={handleCloneFromHistory}
                onDelete={handleDeleteHistoryOne}
              />
            ) : sidebarTab === "saved" ? (
              <SavedPanel
                saved={saved}
                collections={collections}
                onLoad={handleLoadSaved}
                onDelete={handleDeleteSavedOne}
                onUpdateCollection={(item, collectionId) => {
                  const updated = upsertSavedByName({ ...item, collectionId });
                  setSaved(updated);
                }}
              />
            ) : sidebarTab === "env" ? (
              <EnvPanel envName={envName} setEnvName={setEnvName} envVarsAll={envVarsAll} setEnvVarsAll={setEnvVarsAll} />
            ) : sidebarTab === "collections" ? (
              <CollectionsPanel onLoadRequest={handleLoadFromTree} onRunNode={handleRunFromTree} envVars={envVars} />
            ) : sidebarTab === "runner" ? (
              <RunnerPanel
                envName={envName}
                envVars={envVars}
                runTarget={runTarget}
                onConsumeRunTarget={() => setRunTarget(null)}
                saved={saved}
                collections={collections}
              />
            ) : (
              <ToolsPanel onImported={refreshAllFromStorage} />
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="stack mainStack">
          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Request</div>
              <span className="badge">Fetch</span>
            </div>

            <div className="panelBody">
              <RequestBuilder
                initial={selected}
                onResponse={setResponse}
                onSaveHistory={handleSaveHistory}
                onSaveRequest={handleSaveRequest}
                envName={envName}
                envVars={envVars}
              />
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Response</div>
              <span className="badge">Preview</span>
            </div>

            <div className="panelBody">
              <ResponseViewer response={response} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
