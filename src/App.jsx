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
import RequestTabs from "./components/RequestTabs";
import SettingsPanel from "./components/SettingsPanel";

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


import { loadSettings, saveSettings, onSettingsChange } from "./utils/settings";
import "./App.css";

const THEME_KEY = "bhejo_theme_v1";
const REQ_TABS_KEY = "bhejo_req_tabs_v1";

function tabTitle(tab) {
  if (tab === "history") return "History";
  if (tab === "saved") return "Saved";
  if (tab === "env") return "Environments";
  if (tab === "collections") return "Collections";
  if (tab === "runner") return "Runner";
  return "Tools";
}

function uuid(prefix = "id") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function blankDraft() {
  return {
    id: uuid("req"),
    name: "",
    method: "GET",
    url: "{{baseUrl}}/todos/1",
    params: [{ key: "", value: "" }],
    headers: [{ key: "", value: "" }],
    body: "",
    auth: {
      type: "none",
      bearer: "",
      username: "",
      password: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
    },
    tests: [],
    testScript: "",
    dataRows: [],
    mode: "direct",
    preRequestScript: "",
    savedAt: new Date().toISOString(),
  };
}

function loadReqTabs() {
  try {
    const raw = localStorage.getItem(REQ_TABS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    const activeId = String(parsed?.activeId || "");

    const normalizedTabs = tabs
      .map((t) => ({
        id: String(t?.id || uuid("tab")),
        draft: t?.draft ? { ...blankDraft(), ...t.draft } : blankDraft(),
        dirty: false,
        lastResponse: null, // do not persist responses
      }))
      .filter((t) => t.id);

    if (!normalizedTabs.length) return null;

    const safeActive =
      activeId && normalizedTabs.some((t) => t.id === activeId)
        ? activeId
        : normalizedTabs[0].id;

    return { tabs: normalizedTabs, activeId: safeActive };
  } catch {
    return null;
  }
}

function persistReqTabs(tabs, activeId) {
  try {
    const payload = {
      activeId,
      tabs: (tabs || []).map((t) => ({
        id: t.id,
        draft: t.draft,
      })),
    };
    localStorage.setItem(REQ_TABS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export default function App() {

  // Open the separate console window (dev + production base paths)
  const openConsoleWindow = () => {
    const base = (import.meta?.env?.BASE_URL || "/");
    const baseNorm = base.endsWith("/") ? base : base + "/";
    const url = new URL(`${baseNorm}console.html`, window.location.origin).toString();
    window.open(url, "bhejo_console", "width=980,height=720");
  };

  const [history, setHistory] = useState([]);
  const [saved, setSaved] = useState([]);

  // legacy collections (SavedPanel still uses this today)
  const [collections, setCollections] = useState([]);

  // Phase 3 tree collections count (badge)
  const [treeCollectionsCount, setTreeCollectionsCount] = useState(0);

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

  // Settings (drawer)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettingsState] = useState(() => loadSettings());

  const palette = settings?.ui?.palette || "default";

  // keep settings in sync (same tab + multi-tab)
  useEffect(() => onSettingsChange((next) => setSettingsState(next)), []);

  const setSettings = (next) => {
    const savedSettings = saveSettings(next);
    setSettingsState(savedSettings);
    return savedSettings;
  };


  // Request tabs (Postman-like)
  const [reqTabs, setReqTabs] = useState(() => {
    const loaded = loadReqTabs();
    return loaded?.tabs || [{ id: uuid("tab"), draft: blankDraft(), dirty: false, lastResponse: null }];
  });
  const [activeReqTabId, setActiveReqTabId] = useState(() => {
    const loaded = loadReqTabs();
    return loaded?.activeId || null;
  });

  // Ensure we always have a valid active tab id
  useEffect(() => {
    if (!reqTabs.length) return;
    if (activeReqTabId && reqTabs.some((t) => t.id === activeReqTabId)) return;
    setActiveReqTabId(reqTabs[0].id);
  }, [reqTabs, activeReqTabId]);

  const activeReqTab = useMemo(
    () => reqTabs.find((t) => t.id === activeReqTabId) || reqTabs[0],
    [reqTabs, activeReqTabId]
  );

  const activeResponse = activeReqTab?.lastResponse ?? null;

  // Persist tabs (draft only; responses are not persisted)
  useEffect(() => {
    if (!activeReqTabId) return;
    persistReqTabs(reqTabs, activeReqTabId);
  }, [reqTabs, activeReqTabId]);

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


  // palette (accent set)
  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
  }, [palette]);

  // env persist
  useEffect(() => {
    saveCurrentEnv(envName);
  }, [envName]);

  // env vars persist
  useEffect(() => {
    saveEnvVars(envVarsAll);
  }, [envVarsAll]);

  const subtitle = useMemo(() => "Minimal API client • Phase 3.9.0", []);

  // -----------------------
  // Request tab handlers
  // -----------------------
  const newTab = (draftOverride = null, { activate = true, dirty = false } = {}) => {
    const tabId = uuid("tab");
    const d = draftOverride ? { ...blankDraft(), ...draftOverride } : blankDraft();
    const tab = { id: tabId, draft: { ...d, savedAt: new Date().toISOString() }, dirty, lastResponse: null };

    setReqTabs((tabs) => [tab, ...tabs]);
    if (activate) setActiveReqTabId(tabId);
    return tabId;
  };

  const closeTab = (tabId) => {
    setReqTabs((tabs) => {
      const list = tabs.filter((t) => t.id !== tabId);

      // never allow zero tabs
      if (!list.length) {
        const fresh = { id: uuid("tab"), draft: blankDraft(), dirty: false, lastResponse: null };
        setActiveReqTabId(fresh.id);
        return [fresh];
      }

      // if closing active tab, switch to the next best
      if (tabId === activeReqTabId) {
        const idx = tabs.findIndex((t) => t.id === tabId);
        const next = list[Math.max(0, idx - 1)] || list[0];
        setActiveReqTabId(next.id);
      }

      return list;
    });
  };

  const switchTab = (tabId) => {
    if (!tabId) return;
    setActiveReqTabId(tabId);
  };

  const handleDraftChange = (draft, meta) => {
    if (!draft || !activeReqTabId) return;

    setReqTabs((tabs) =>
      tabs.map((t) => {
        if (t.id !== activeReqTabId) return t;

        const shouldDirty = meta?.reason === "edit";
        return {
          ...t,
          draft: { ...t.draft, ...draft },
          dirty: shouldDirty ? true : t.dirty,
        };
      })
    );
  };

  const handleTabResponse = (res) => {
    if (!activeReqTabId) return;
    setReqTabs((tabs) =>
      tabs.map((t) => (t.id === activeReqTabId ? { ...t, lastResponse: res } : t))
    );
  };

  const openFromPayload = (payload, { dirty = false } = {}) => {
    const draft = {
      id: payload.id || uuid("req"),
      name: payload.name || "",
      method: payload.method || "GET",
      url: payload.url || "",
      params: payload.params || [{ key: "", value: "" }],
      headers: payload.headers || [{ key: "", value: "" }],
      body: payload.body || "",
      auth: payload.auth || { type: "none" },
      tests: payload.tests || [],
      testScript: payload.testScript || "",
      dataRows: payload.dataRows || [],
      mode: payload.mode || "direct",
      preRequestScript: payload.preRequestScript || "",
      savedAt: new Date().toISOString(),
    };

    newTab(draft, { activate: true, dirty });
  };

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
  };

  const handleDeleteHistoryOne = (id) => {
    const updated = deleteHistory(id);
    setHistory(updated);
  };

  const handleOpenFromHistory = (item) => {
    openFromPayload(item, { dirty: false });
  };

  const handleCloneFromHistory = (item) => {
    openFromPayload({ ...item, id: uuid("req"), name: (item.name || "") + " (copy)" }, { dirty: true });
  };

  // -----------------------
  // Legacy Saved handlers (kept for now)
  // -----------------------
  const handleSaveRequest = (draft) => {
    const updated = upsertSavedByName(draft);
    setSaved(updated);
    setSidebarTab("saved");
    // mark current tab clean
    setReqTabs((tabs) => tabs.map((t) => (t.id === activeReqTabId ? { ...t, dirty: false } : t)));
  };

  const handleLoadSaved = (item) => {
    openFromPayload({
      id: item.id,
      name: item.name,
      method: item.method,
      url: item.url,
      params: item.params,
      headers: item.headers,
      body: item.body,
      auth: item.auth,
      tests: item.tests || [],
      testScript: item.testScript || "",
      dataRows: item.dataRows || [],
      mode: item.mode || "direct",
      preRequestScript: item.preRequestScript || "",
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
    openFromPayload(payload, { dirty: false });
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
            onClick={openConsoleWindow}
            title="Open Console"
          >
            Open Console
          </button>

          <button
            className="btn btnSm"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
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
                onSelect={handleOpenFromHistory}
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
              <span className="badge">Tabs</span>
            </div>

            <div className="panelBody">
              <RequestTabs
                tabs={reqTabs}
                activeId={activeReqTabId}
                onSwitch={switchTab}
                onNew={() => newTab()}
                onClose={closeTab}
              />

              <div style={{ height: 10 }} />

              <RequestBuilder
                key={activeReqTabId}
                initial={activeReqTab?.draft}
                onResponse={handleTabResponse}
                onSaveHistory={handleSaveHistory}
                onSaveRequest={handleSaveRequest}
                envName={envName}
                envVars={envVars}
                onDraftChange={handleDraftChange}
                clearResponseOnLoad={false}
              />
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div className="panelTitle">Response</div>
              <span className="badge">Preview</span>
            </div>

            <div className="panelBody">
              <ResponseViewer response={activeResponse} />
            </div>
          </div>
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        theme={theme}
        setTheme={setTheme}
      />
    </div>
  );
}
