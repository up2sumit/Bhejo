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
  addToHistory,
  deleteHistoryItem,
  loadHistory,
  saveHistory,
  loadSaved,
  upsertSaved,
  deleteSaved,
  getCurrentEnv,
  setCurrentEnv,
  loadEnvVars,
  saveEnvVars,
  loadCollections,
  addCollection,
  deleteCollection,
} from "./utils/storage";

import "./App.css";

const THEME_KEY = "bhejo_theme_v1";

export default function App() {
  const [response, setResponse] = useState(null);

  const [history, setHistory] = useState([]);
  const [saved, setSaved] = useState([]);

  // collections
  const [collections, setCollections] = useState([]);

  const [selected, setSelected] = useState(null);
  const [sidebarTab, setSidebarTab] = useState("history"); // history | saved | env | collections | runner | tools

  // env
  const [envName, setEnvNameState] = useState(getCurrentEnv());
  const [envVarsAll, setEnvVarsAllState] = useState(loadEnvVars());
  const envVars = envVarsAll?.[envName] || {};

  // theme
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    return savedTheme === "light" ? "light" : "dark";
  });

  // initial load
  useEffect(() => {
    setHistory(loadHistory());
    setSaved(loadSaved());
    setCollections(loadCollections());
  }, []);

  // theme persist
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // env persist
  useEffect(() => {
    setCurrentEnv(envName);
  }, [envName]);

  // env vars persist
  useEffect(() => {
    saveEnvVars(envVarsAll);
  }, [envVarsAll]);

  const subtitle = useMemo(() => "Minimal API client • Phase 2.3", []);

  const handleSaveHistory = (item) => {
    const updated = addToHistory(item);
    setHistory(updated);
  };

  const handleClearHistory = () => {
    saveHistory([]);
    setHistory([]);
    setSelected(null);
    setResponse(null);
  };

  const handleDeleteHistoryOne = (id) => {
    const updated = deleteHistoryItem(id);
    setHistory(updated);
    if (selected?.id === id) {
      setSelected(null);
      setResponse(null);
    }
  };

  const handleCloneFromHistory = (item) => {
    setSelected({ ...item, savedAt: new Date().toISOString() });
  };

  // Save request (RequestBuilder already ensures it passes a name)
  const handleSaveRequest = (draft) => {
    const updated = upsertSaved(draft);
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
      savedAt: new Date().toISOString(),
    });
  };

  const handleDeleteSavedOne = (id) => {
    const updated = deleteSaved(id);
    setSaved(updated);
  };

  const refreshFromStorage = () => {
    setSaved(loadSaved());
    setEnvVarsAllState(loadEnvVars());
    setCollections(loadCollections());
  };

  const badgeRight = useMemo(() => {
    if (sidebarTab === "history")
      return (
        <button className="btn btnDanger btnSm" onClick={handleClearHistory}>
          Clear
        </button>
      );

    if (sidebarTab === "saved") return <span className="badge">{saved.length} saved</span>;
    if (sidebarTab === "env") return <span className="badge">{envName}</span>;
    if (sidebarTab === "collections") return <span className="badge">{collections.length} collections</span>;
    if (sidebarTab === "runner") return <span className="badge">{envName}</span>;
    return <span className="badge">Tools</span>;
  }, [sidebarTab, saved.length, envName, collections.length]);

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <h1>Bhejo</h1>
          <p>{subtitle}</p>
        </div>

        <div className="headerRight">
          <span className="badge">Local only</span>

          {/* ✅ Postman-like: open console window */}
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
            <span className="themeIcon">{theme === "dark" ? "🌙" : "☀️"}</span>
            <span className="themeText">{theme === "dark" ? "Dark" : "Light"}</span>
            <span className="themeKnob" />
          </button>
        </div>
      </div>

      <div className="layout">
        {/* LEFT */}
        <div className="panel">
          <div className="panelHeader panelHeaderStack">
            <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
              <div className="panelTitle">Sidebar</div>
              {badgeRight}
            </div>

            <div className="tabs">
              <button
                className={`tab ${sidebarTab === "history" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("history")}
              >
                History
              </button>
              <button
                className={`tab ${sidebarTab === "saved" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("saved")}
              >
                Saved
              </button>
              <button
                className={`tab ${sidebarTab === "env" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("env")}
              >
                Env
              </button>
              <button
                className={`tab ${sidebarTab === "collections" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("collections")}
              >
                Collections
              </button>
              <button
                className={`tab ${sidebarTab === "runner" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("runner")}
              >
                Runner
              </button>
              <button
                className={`tab ${sidebarTab === "tools" ? "tabActive" : ""}`}
                onClick={() => setSidebarTab("tools")}
              >
                Tools
              </button>
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
                  const updated = upsertSaved({ ...item, collectionId });
                  setSaved(updated);
                }}
              />
            ) : sidebarTab === "env" ? (
              <EnvPanel
                envName={envName}
                setEnvName={setEnvNameState}
                envVarsAll={envVarsAll}
                setEnvVarsAll={setEnvVarsAllState}
              />
            ) : sidebarTab === "collections" ? (
              <CollectionsPanel
                collections={collections}
                onAdd={(name) => setCollections(addCollection(name))}
                onDelete={(id) => setCollections(deleteCollection(id))}
              />
            ) : sidebarTab === "runner" ? (
              <RunnerPanel
                saved={saved}
                collections={collections}
                envName={envName}
                envVars={envVars}
              />
            ) : (
              <ToolsPanel onImported={refreshFromStorage} />
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
