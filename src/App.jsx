// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
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
  updateRequestNodeRequest,
} from "./utils/storage";
import { normalizeEnvStore, envMerged, buildEnvNames } from "./utils/envs";


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
    // Phase 6
    docText: "",
    examples: [],
    defaultExampleId: null,
    origin: null,
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
  const prevSidebarTabRef = useRef("collections");
  const effectiveSidebarTab = sidebarTab === "runner" ? prevSidebarTabRef.current : sidebarTab;

  // Phase 3.4: when CollectionsPanel says "Run folder/collection/request"
  const [runTarget, setRunTarget] = useState(null);

  // env (Phase 5.5)
  const [envName, setEnvName] = useState(loadCurrentEnv());
  const [envVarsAll, setEnvVarsAll] = useState(() => normalizeEnvStore(loadEnvVars()));

  // migrate legacy env store shape if needed
  useEffect(() => {
    setEnvVarsAll((s) => normalizeEnvStore(s));
  }, []);

  const envVars = useMemo(() => envMerged(envVarsAll, envName), [envVarsAll, envName]);
  const envNames = useMemo(() => buildEnvNames(envVarsAll), [envVarsAll]);

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

  // --- Tabs overview menu (Postman-like "Tabs (N)" list)
  const tabsBtnRef = useRef(null);
  const tabsMenuRef = useRef(null);
  const [tabsMenu, setTabsMenu] = useState(null); // { top, left, width } | null

  const toggleTabsMenu = () => {
    if (tabsMenu) {
      setTabsMenu(null);
      return;
    }
    const el = tabsBtnRef.current;
    if (!el) {
      setTabsMenu({ top: 96, left: 24, width: 360 });
      return;
    }
    const r = el.getBoundingClientRect();
    const width = 360;
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, r.right - width));
    const top = Math.min(window.innerHeight - 12, r.bottom + 8);
    setTabsMenu({ top, left, width });
  };

  useEffect(() => {
    if (!tabsMenu) return;

    const onDown = (e) => {
      const menuEl = tabsMenuRef.current;
      const btnEl = tabsBtnRef.current;
      if (menuEl && menuEl.contains(e.target)) return;
      if (btnEl && btnEl.contains(e.target)) return;
      setTabsMenu(null);
    };

    const onKey = (e) => {
      if (e.key === "Escape") setTabsMenu(null);
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onDown);
    };
  }, [tabsMenu]);

  const openTabFromMenu = (id) => {
    switchTab(id);
    setTabsMenu(null);
  };



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
      const list = Array.isArray(tabs) ? tabs : [];
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx === -1) return tabs;

      const tab = list[idx];
      if (tab?.dirty) {
        const ok = window.confirm("You have unsaved changes in this tab. Close anyway?");
        if (!ok) return tabs;
      }

      const next = list.filter((t) => t.id !== tabId);

      // Never allow zero tabs
      if (next.length === 0) {
        const fresh = { id: uuid("tab"), draft: blankDraft(), dirty: false, lastResponse: null };
        setActiveReqTabId(fresh.id);
        return [fresh];
      }

      // If closing active tab, switch to nearest left, else keep active.
      if (activeReqTabId === tabId) {
        const newActive = next[Math.max(0, idx - 1)];
        setActiveReqTabId(newActive.id);
      }

      return next;
    });
  };
  const closeOthers = (tabId) => {
    setReqTabs((tabs) => {
      const list = Array.isArray(tabs) ? tabs : [];
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx === -1) return tabs;

      const toClose = list.filter((t) => t.id !== tabId);
      const dirtyCount = toClose.filter((t) => t.dirty).length;
      if (dirtyCount > 0) {
        const ok = window.confirm(`You have unsaved changes in ${dirtyCount} tab(s). Close them anyway?`);
        if (!ok) return tabs;
      }

      const keep = list[idx];
      setActiveReqTabId(keep.id);
      return [keep];
    });
  };
  const closeToRight = (tabId) => {
    setReqTabs((tabs) => {
      const list = Array.isArray(tabs) ? tabs : [];
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx === -1) return tabs;

      const toClose = list.slice(idx + 1);
      const dirtyCount = toClose.filter((t) => t.dirty).length;
      if (dirtyCount > 0) {
        const ok = window.confirm(`You have unsaved changes in ${dirtyCount} tab(s). Close them anyway?`);
        if (!ok) return tabs;
      }

      const kept = list.slice(0, idx + 1);

      const activeIdx = list.findIndex((t) => t.id === activeReqTabId);
      if (activeIdx > idx) setActiveReqTabId(tabId);

      if (!kept.length) {
        const fresh = { id: uuid("tab"), draft: blankDraft(), dirty: false, lastResponse: null };
        setActiveReqTabId(fresh.id);
        return [fresh];
      }
      return kept;
    });
  };

  const closeToLeft = (tabId) => {
    setReqTabs((tabs) => {
      const list = Array.isArray(tabs) ? tabs : [];
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx <= 0) return tabs;

      const toClose = list.slice(0, idx);
      const dirtyCount = toClose.filter((t) => t.dirty).length;
      if (dirtyCount > 0) {
        const ok = window.confirm(`You have unsaved changes in ${dirtyCount} tab(s). Close them anyway?`);
        if (!ok) return tabs;
      }

      const kept = list.slice(idx);
      // if active was in left part, move to clicked tab
      const activeIdx = list.findIndex((t) => t.id === activeReqTabId);
      if (activeIdx < idx) setActiveReqTabId(tabId);

      return kept.length ? kept : tabs;
    });
  };

  const closeAll = () => {
    setReqTabs((tabs) => {
      const list = Array.isArray(tabs) ? tabs : [];
      const dirtyCount = list.filter((t) => t.dirty).length;
      if (dirtyCount > 0) {
        const ok = window.confirm(`You have unsaved changes in ${dirtyCount} tab(s). Close all anyway?`);
        if (!ok) return tabs;
      }

      const fresh = { id: uuid("tab"), draft: blankDraft(), dirty: false, lastResponse: null };
      setActiveReqTabId(fresh.id);
      return [fresh];
    });
  };

  const duplicateTab = (tabId) => {
    setReqTabs((tabs) => {
      const list = Array.isArray(tabs) ? tabs : [];
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx === -1) return tabs;

      const src = list[idx];
      const draft = JSON.parse(JSON.stringify(src.draft || blankDraft()));
      if (draft.name) draft.name = `${draft.name} (copy)`;

      const clone = {
        ...src,
        id: uuid("tab"),
        draft,
        dirty: true,
        lastResponse: null,
      };

      const next = [...list.slice(0, idx + 1), clone, ...list.slice(idx + 1)];
      setActiveReqTabId(clone.id);
      return next;
    });
  };


  const renameTab = (tabId, nextName) => {
    const name = String(nextName || "").trim();
    setReqTabs((tabs) =>
      (tabs || []).map((t) => {
        if (t.id !== tabId) return t;

        const prev = String(t?.draft?.name || "").trim();
        const changed = prev !== name;

        return {
          ...t,
          draft: {
            ...t.draft,
            name,
            // bump savedAt so RequestBuilder syncs the name input for active tab
            savedAt: new Date().toISOString(),
          },
          dirty: changed ? true : t.dirty,
        };
      })
    );
  };


  const switchTab = (tabId) => {
    if (!tabId) return;
    setActiveReqTabId(tabId);
  };

  const handleDraftChange = (draft, meta) => {
    if (!draft || !activeReqTabId) return;

    // If this tab was opened from Collections tree, keep the node updated automatically
    if (draft?.origin?.kind === "tree" && draft.origin.collectionId && draft.origin.nodeId) {
      try {
        updateRequestNodeRequest(draft.origin.collectionId, draft.origin.nodeId, draft);
      } catch {
        // ignore
      }
    }

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
      // Phase 6
      docText: payload.docText || "",
      examples: Array.isArray(payload.examples) ? payload.examples : [],
      defaultExampleId: payload.defaultExampleId || null,
      origin: payload.__origin || null,
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
    setReqTabs((tabs) =>
      (tabs || []).map((t) =>
        t.id === activeReqTabId
          ? { ...t, dirty: false, draft: { ...t.draft, savedAt: new Date().toISOString() } }
          : t
      )
    );
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
  if (tab === "runner") {
    if (sidebarTab !== "runner") prevSidebarTabRef.current = sidebarTab;
    setSidebarTab("runner");
    return;
  }
  if (tab === "collections") {
    const trees = loadCollectionTrees();
    setTreeCollectionsCount(Array.isArray(trees) ? trees.length : 0);
  }
  setSidebarTab(tab);
};

useEffect(() => {
  if (sidebarTab !== "runner") return;

  const onKey = (e) => {
    if (e.key === "Escape") {
      setSidebarTab(prevSidebarTabRef.current || "collections");
    }
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [effectiveSidebarTab]);

  // -----------------------
  // Right-side badge/actions (now used in sidebar header only)
  // -----------------------
  const sidebarHeaderRight = useMemo(() => {
    if (effectiveSidebarTab === "history") {
      return (
        <button className="btn btnDanger btnSm" onClick={handleClearHistory}>
          Clear
        </button>
      );
    }
    if (effectiveSidebarTab === "saved") return <span className="badge">{saved.length} saved</span>;
    if (effectiveSidebarTab === "env") return <span className="badge">{envName}</span>;
    if (effectiveSidebarTab === "collections") return <span className="badge">{treeCollectionsCount}</span>;
    if (effectiveSidebarTab === "runner") return <span className="badge">{envName}</span>;
    return <span className="badge">Tools</span>;
  }, [effectiveSidebarTab, saved.length, envName, treeCollectionsCount]);

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
              <div className="panelTitle">{tabTitle(effectiveSidebarTab)}</div>
              {sidebarHeaderRight}
            </div>
          </div>

          <div className="panelBody sidebarBody">
            {effectiveSidebarTab === "history" ? (
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
                envNames={envNames}
                setEnvName={setEnvName}
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
              <div className="panelHeaderActions">
                <button
                  ref={tabsBtnRef}
                  type="button"
                  className="badge badgeBtn"
                  onClick={toggleTabsMenu}
                  title="Show open request tabs"
                >
                  Tabs <span className="badgeCount">{reqTabs.length}</span>
                </button>
              </div>
            </div>

            <div className="panelBody">
              <RequestTabs
                tabs={reqTabs}
                activeId={activeReqTabId}
                onSwitch={switchTab}
                onNew={() => newTab()}
                onClose={closeTab}
                onRename={renameTab}
                onCloseOthers={closeOthers}
                onCloseToRight={closeToRight}
                onCloseToLeft={closeToLeft}
                onCloseAll={closeAll}
                onDuplicate={duplicateTab}
              />

              {tabsMenu ? (
                <div
                  className="tabsOverviewMenu"
                  ref={tabsMenuRef}
                  style={{ top: tabsMenu.top, left: tabsMenu.left, width: tabsMenu.width }}
                >
                  <div className="tabsOverviewHeader">
                    <div className="tabsOverviewTitle">Open tabs</div>
                    <div className="tabsOverviewMeta">{reqTabs.length} total</div>
                  </div>

                  <div className="tabsOverviewList">
                    {reqTabs.map((t) => {
                      const d = t.draft || {};
                      const method = String(d.method || "GET").toUpperCase();
                      const name = String(d.name || "").trim();
                      const url = String(d.url || "").trim();

                      const path = (() => {
                        try {
                          const u = new URL(url);
                          const p = u.pathname || "/";
                          return p.startsWith("/") ? p : `/${p}`;
                        } catch {
                          let s = url;
                          const tokenIdx = s.indexOf("}}");
                          if (tokenIdx !== -1) s = s.slice(tokenIdx + 2);
                          s = s.split("#")[0];
                          s = s.split("?")[0];
                          s = s.trim();
                          if (s.startsWith("/")) return s || "/";
                          const slash = s.indexOf("/");
                          if (slash !== -1) {
                            const p = s.slice(slash).trim();
                            return p.startsWith("/") ? p : `/${p}`;
                          }
                          return "/";
                        }
                      })();

                      const isActive = t.id === activeReqTabId;
                      const label = name ? name : path || "/";

                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={"tabsOverviewItem" + (isActive ? " isActive" : "")}
                          onClick={() => openTabFromMenu(t.id)}
                        >
                          <span className={"tabsOverviewMethod m_" + method}>{method}</span>
                          <span className="tabsOverviewLabel">{label}</span>
                          {t.dirty ? (
                            <span className="tabsOverviewDot" title="Unsaved changes">
                              ●
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}



              <div style={{ height: 10 }} />

              <RequestBuilder
                key={activeReqTabId}
                initial={activeReqTab?.draft}
                onResponse={handleTabResponse}
                onSaveHistory={handleSaveHistory}
                onSaveRequest={handleSaveRequest}
                envName={envName}
                envNames={envNames}
                setEnvName={setEnvName}
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
{sidebarTab === "runner" ? (
  <div
    className="runnerOverlay"
    role="dialog"
    aria-modal="true"
    aria-label="Runner"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) {
        setSidebarTab(prevSidebarTabRef.current || "collections");
      }
    }}
  >
    <div className="runnerModal">
      <div className="runnerModalHeader">
        <div className="runnerModalTitle">Runner</div>
        <div className="runnerModalActions">
          <span className="badge">Env: {envName || "default"}</span>
          <button
            className="btn btnSm"
            onClick={() => setSidebarTab(prevSidebarTabRef.current || "collections")}
            title="Close Runner (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="runnerModalBody">
        <RunnerPanel
          envName={envName}
          envNames={envNames}
          setEnvName={setEnvName}
          envVars={envVars}
          runTarget={runTarget}
          onConsumeRunTarget={() => setRunTarget(null)}
          saved={saved}
          collections={collections}
        />
      </div>
    </div>
  </div>
) : null}

    </div>
  );
}
