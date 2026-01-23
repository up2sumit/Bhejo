// src/components/CollectionsPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addCollectionTree,
  addFolderNode,
  addRequestNode,
  deleteCollectionTree,
  deleteNode,
  exportCollectionTree,
  getFolderDoc,
  importCollectionTree,
  importCollectionTreeInto,
  loadCollectionTrees,
  moveNodeEx,
  renameCollectionTree,
  renameNode,
  setFolderDoc,
} from "../utils/storage";
import { applyVarsToRequest } from "../utils/vars";
import { toCurl, toFetch, toAxios } from "../utils/codegen";
import { applyAuthToHeaders } from "./AuthEditor";

/* ------------------------- Small inline SVG icon set ------------------------- */

function SvgIcon({ name, size = 16 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    style: { display: "block" },
  };

  const stroke = "currentColor";
  const strokeWidth = 2;
  const strokeLinecap = "round";
  const strokeLinejoin = "round";

  switch (name) {
    case "chevDown":
      return (
        <svg {...common}>
          <path
            d="M6 9l6 6 6-6"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "chevRight":
      return (
        <svg {...common}>
          <path
            d="M9 6l6 6-6 6"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path
            d="M3 7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path
            d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0 0-7.07 5 5 0 0 0-7.07 0L10.5 5.43"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 0 7.07 5 5 0 0 0 7.07 0l.91-.91"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path
            d="M8 5l12 7-12 7V5z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path
            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M7 10l5 5 5-5"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M12 15V3"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path
            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M17 8l-5-5-5 5"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M12 3v12"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path
            d="M12 5v14"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
          />
          <path
            d="M5 12h14"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
          />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path
            d="M12 20h9"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
          />
          <path
            d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
          <path
            d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "move":
      return (
        <svg {...common}>
          <path d="M12 2v20" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
          <path
            d="M8 6l4-4 4 4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M8 18l4 4 4-4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path d="M2 12h20" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
          <path
            d="M6 8l-4 4 4 4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M18 8l4 4-4 4"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
          <path d="M14 2v6h6" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
          <path d="M8 13h8" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
          <path d="M8 17h8" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <path
            d="M9 9h10v12H9V9z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin={strokeLinejoin}
          />
          <path
            d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={strokeLinecap}
            strokeLinejoin={strokeLinejoin}
          />
        </svg>
      );
    case "dots":
      return (
        <svg {...common}>
          <path d="M5 12h.01" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
          <path d="M12 12h.01" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
          <path d="M19 12h.01" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 12h.01" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
        </svg>
      );
  }
}

function IconSlot({ children }) {
  return (
    <span
      style={{
        width: 20,
        height: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.95,
        flex: "0 0 auto",
      }}
    >
      {children}
    </span>
  );
}

/* ----------------------------- Tree helper fns ------------------------------ */

function findNodeDFS(folderNode, targetId) {
  if (!folderNode) return null;
  if (folderNode.id === targetId) return folderNode;

  if (folderNode.type === "folder" && Array.isArray(folderNode.children)) {
    for (const child of folderNode.children) {
      if (child.id === targetId) return child;
      if (child.type === "folder") {
        const hit = findNodeDFS(child, targetId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function isDescendant(rootFolder, ancestorFolderId, possibleDescendantId) {
  const ancestor = findNodeDFS(rootFolder, ancestorFolderId);
  if (!ancestor || ancestor.type !== "folder") return false;
  return !!findNodeDFS(ancestor, possibleDescendantId);
}

function collectFolders(rootFolder) {
  const out = [];
  function walk(node, pathParts) {
    if (!node) return;
    if (node.type === "folder") {
      const path = node.id === "root" ? "Root" : [...pathParts, node.name].join(" / ");
      out.push({ id: node.id, path });
      const nextPath = node.id === "root" ? [] : [...pathParts, node.name];
      for (const c of node.children || []) walk(c, nextPath);
    }
  }
  walk(rootFolder, []);
  return out;
}

function filterTree(root, q) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return { filtered: root, forcedExpanded: new Set() };

  const forcedExpanded = new Set(["root"]);

  function nodeMatches(node) {
    const nameMatch = (node.name || "").toLowerCase().includes(query);
    if (node.type === "folder") {
      const doc = typeof node.doc === "string" ? node.doc : "";
      const docMatch = doc.toLowerCase().includes(query);
      return nameMatch || docMatch;
    }
    return nameMatch;
  }

  function walk(node) {
    if (!node) return null;

    if (node.type === "request") {
      return nodeMatches(node) ? node : null;
    }

    if (node.type === "folder") {
      const kids = node.children || [];
      const keptChildren = [];

      for (const child of kids) {
        const kept = walk(child);
        if (kept) keptChildren.push(kept);
      }

      const selfMatch = node.id === "root" ? true : nodeMatches(node);
      if (selfMatch || keptChildren.length > 0) {
        if (node.id !== "root") forcedExpanded.add(node.id);
        return { ...node, children: keptChildren };
      }
      return null;
    }

    return null;
  }

  const filtered = walk(root) || { ...root, children: [] };
  return { filtered, forcedExpanded };
}

function downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function copyToClipboard(text) {
  const t = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function buildFinalUrl(baseUrl, params) {
  try {
    const urlObj = new URL(baseUrl);
    for (const p of params || []) {
      const k = (p.key || "").trim();
      if (!k) continue;
      urlObj.searchParams.set(k, p.value ?? "");
    }
    return urlObj.toString();
  } catch {
    return baseUrl;
  }
}

/* -------------------------------- Component -------------------------------- */

export default function CollectionsPanel({
  onLoadRequest,
  onRunNode,
  envVars, // optional: pass current env vars from App.jsx for resolved snippets
}) {
  const [trees, setTrees] = useState([]);
  const [activeCollectionId, setActiveCollectionId] = useState(null);

  const [expanded, setExpanded] = useState(() => new Set(["root"]));
  const [selected, setSelected] = useState(null); // { collectionId, nodeId, type }
  const [addMenu, setAddMenu] = useState("none");

  const [search, setSearch] = useState("");
  const [safeReorderOnly, setSafeReorderOnly] = useState(true);

  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editingValue, setEditingValue] = useState("");

  const [ctx, setCtx] = useState(null); // { x, y, node }
  const ctxRef = useRef(null);

  const [draggingId, setDraggingId] = useState(null);
  const draggingMetaRef = useRef({ parentId: null, index: null });

  const [dropState, setDropState] = useState(null);

  const dropClearTimerRef = useRef(null);
  const rafDropRef = useRef({ pending: null, raf: null });

  const hoverExpandTimerRef = useRef(null);
  const lastHoverFolderRef = useRef(null);

  const [docDraft, setDocDraft] = useState("");
  const [docDirty, setDocDirty] = useState(false);

  const importInputRef = useRef(null);

  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  const setToastMsg = (msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 1600);
  };

  useEffect(() => {
    const t = loadCollectionTrees();
    setTrees(t);
    if (!activeCollectionId && t.length) setActiveCollectionId(t[0].id);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onDown = (e) => {
      if (!ctx) return;
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtx(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setCtx(null);
    };
    const onScroll = () => setCtx(null);

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ctx]);

  const activeCollection = useMemo(
    () => trees.find((t) => t.id === activeCollectionId) || null,
    [trees, activeCollectionId]
  );

  const { filtered: filteredRoot, forcedExpanded } = useMemo(() => {
    if (!activeCollection) return { filtered: null, forcedExpanded: new Set() };
    return filterTree(activeCollection.root, search);
  }, [activeCollection, search]);

  useEffect(() => {
    if (!activeCollection || !selected) return;

    if (selected.type === "folder") {
      const text = getFolderDoc(activeCollection.id, selected.nodeId);
      setDocDraft(text || "");
      setDocDirty(false);
    } else {
      setDocDraft("");
      setDocDirty(false);
    }
  }, [activeCollection?.id, selected?.nodeId, selected?.type]);

  const refresh = () => {
    const t = loadCollectionTrees();
    setTrees(t);
    if (t.length && !t.find((x) => x.id === activeCollectionId)) {
      setActiveCollectionId(t[0].id);
      setSelected(null);
    }
  };

  const toggleExpand = (nodeId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  };

  const clearHoverExpandTimer = () => {
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    lastHoverFolderRef.current = null;
  };

  const setDropStateThrottled = (next) => {
    rafDropRef.current.pending = next;
    if (rafDropRef.current.raf) return;
    rafDropRef.current.raf = requestAnimationFrame(() => {
      rafDropRef.current.raf = null;
      setDropState(rafDropRef.current.pending);
      rafDropRef.current.pending = null;
    });
  };

  const scheduleClearDropState = () => {
    if (dropClearTimerRef.current) clearTimeout(dropClearTimerRef.current);
    dropClearTimerRef.current = setTimeout(() => setDropState(null), 80);
  };

  const cancelClearDropState = () => {
    if (dropClearTimerRef.current) clearTimeout(dropClearTimerRef.current);
    dropClearTimerRef.current = null;
  };

  // --- Collection actions ---
  const createCollection = () => {
    const name = prompt("Collection name?");
    if (!name) return;
    const next = addCollectionTree(name);
    setTrees(next);
    setActiveCollectionId(next[0]?.id || null);
    setSelected(null);
  };

  const renameCollection = () => {
    if (!activeCollection) return;
    const name = prompt("New collection name?", activeCollection.name);
    if (!name) return;
    const next = renameCollectionTree(activeCollection.id, name);
    setTrees(next);
  };

  const removeCollection = () => {
    if (!activeCollection) return;
    const ok = confirm(`Delete collection "${activeCollection.name}"?`);
    if (!ok) return;
    const next = deleteCollectionTree(activeCollection.id);
    setTrees(next);
    setSelected(null);
    setActiveCollectionId(next[0]?.id || null);
  };

  const exportActive = () => {
    if (!activeCollection) return;
    const payload = exportCollectionTree(activeCollection.id);
    if (!payload) return;
    const safeName = (activeCollection.name || "collection").replace(/[^\w\-]+/g, "_").slice(0, 60);
    downloadJson(`${safeName}.bhejo.json`, payload);
  };

  const openImportPicker = () => {
    if (!importInputRef.current) return;
    importInputRef.current.value = "";
    importInputRef.current.click();
  };

  const onImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const obj = JSON.parse(text);

      const mode = prompt(
        "Import mode:\n1) New Collection\n2) Merge into current collection (Root)\n3) Merge into selected folder\n\nEnter 1/2/3:",
        "1"
      );
      const m = String(mode || "1").trim();

      const conflictIn = prompt(
        "Conflict handling:\n1) Rename conflicts (recommended)\n2) Overwrite conflicts\n3) Skip conflicts\n\nEnter 1/2/3:",
        "1"
      );
      const c = String(conflictIn || "1").trim();
      const conflict = c === "2" ? "overwrite" : c === "3" ? "skip" : "rename";

      if (m === "1") {
        const next = importCollectionTree(obj, { mode: "new" });
        setTrees(next);
        setActiveCollectionId(next[0]?.id || null);
        setSelected(null);
        setSearch("");
        setEditingNodeId(null);
        setCtx(null);
        setExpanded(new Set(["root"]));
        return;
      }

      if (!activeCollection) {
        alert("No active collection to merge into. Please create/select a collection first.");
        return;
      }

      if (m === "2") {
        const next = importCollectionTreeInto(activeCollection.id, obj, {
          targetFolderId: "root",
          conflict,
          wrap: true,
        });
        setTrees(next);
        setActiveCollectionId(activeCollection.id);
        setSelected(null);
        setSearch("");
        setEditingNodeId(null);
        setCtx(null);
        return;
      }

      if (m === "3") {
        if (!selected || selected.type !== "folder") {
          alert("Please select a folder first, then import with mode 3.");
          return;
        }

        const next = importCollectionTreeInto(activeCollection.id, obj, {
          targetFolderId: selected.nodeId,
          conflict,
          wrap: true,
        });

        setTrees(next);
        setActiveCollectionId(activeCollection.id);
        setSelected({ collectionId: activeCollection.id, nodeId: selected.nodeId, type: "folder" });
        setSearch("");
        setEditingNodeId(null);
        setCtx(null);
        setExpanded((prev) => new Set([...prev, selected.nodeId]));
        return;
      }

      const next = importCollectionTree(obj, { mode: "new" });
      setTrees(next);
      setActiveCollectionId(next[0]?.id || null);
      setSelected(null);
      setSearch("");
      setEditingNodeId(null);
      setCtx(null);
      setExpanded(new Set(["root"]));
    } catch {
      alert("Import failed. Please select a valid Bhejo collection export JSON file.");
    }
  };

  // --- Node actions ---
  const addFolder = (parentFolderId = null) => {
    if (!activeCollection) return;
    const parentId = parentFolderId || (selected?.type === "folder" ? selected.nodeId : "root");
    const name = prompt("Folder name?");
    if (!name) return;

    const next = addFolderNode(activeCollection.id, parentId, name);
    setTrees(next);
    setExpanded((s) => new Set([...s, parentId]));
  };

  const addRequest = (parentFolderId = null) => {
    if (!activeCollection) return;
    const parentId = parentFolderId || (selected?.type === "folder" ? selected.nodeId : "root");
    const name = prompt("Request name?");
    if (!name) return;

    const blank = {
      name,
      method: "GET",
      url: "",
      params: [{ key: "", value: "" }],
      headers: [{ key: "", value: "" }],
      body: "",
      auth: { type: "none" },
      tests: [],
      dataRows: [],
      mode: "direct",
    };

    const next = addRequestNode(activeCollection.id, parentId, name, blank);
    setTrees(next);
    setExpanded((s) => new Set([...s, parentId]));
  };

  const runNode = (node) => {
    if (!activeCollection) return;
    if (node.type !== "folder" && node.type !== "request") return;
    onRunNode?.({ collectionId: activeCollection.id, nodeId: node.id, kind: node.type });
  };

  const beginInlineRename = (node) => {
    setEditingNodeId(node.id);
    setEditingValue(node.name || "");
    setCtx(null);
  };

  const commitInlineRename = () => {
    if (!activeCollection) return;
    const id = editingNodeId;
    const name = (editingValue || "").trim();
    if (!id) return;

    setEditingNodeId(null);

    if (!name) return;
    const next = renameNode(activeCollection.id, id, name);
    setTrees(next);
  };

  const cancelInlineRename = () => {
    setEditingNodeId(null);
    setEditingValue("");
  };

  const deleteNodeConfirm = (node) => {
    if (!activeCollection) return;
    const ok = confirm(`Delete ${node.type} "${node.name}"?`);
    if (!ok) return;

    const next = deleteNode(activeCollection.id, node.id);
    setTrees(next);
    if (selected?.nodeId === node.id) setSelected(null);
  };

  const moveToPrompt = (node) => {
    if (!activeCollection) return;

    const folders = collectFolders(activeCollection.root);
    const lines = folders.map((f, idx) => `${idx + 1}. ${f.path}`).join("\n");

    const input = prompt(`Move "${node.name}" to which folder?\n\n${lines}\n\nEnter number:`, "1");
    if (!input) return;

    const n = Number(input);
    if (!Number.isFinite(n) || n < 1 || n > folders.length) return;

    const dest = folders[n - 1];
    if (!dest) return;

    if (node.type === "folder") {
      if (dest.id === node.id) return;
      if (isDescendant(activeCollection.root, node.id, dest.id)) return;
    }

    const next = moveNodeEx(activeCollection.id, node.id, dest.id, 0);
    setTrees(next);
    setExpanded((prev) => new Set([...prev, dest.id]));
  };

  // Folder docs actions
  const saveFolderDoc = () => {
    if (!activeCollection || selected?.type !== "folder") return;
    const next = setFolderDoc(activeCollection.id, selected.nodeId, docDraft);
    setTrees(next);
    setDocDirty(false);
  };

  const resetFolderDoc = () => {
    if (!activeCollection || selected?.type !== "folder") return;
    const text = getFolderDoc(activeCollection.id, selected.nodeId);
    setDocDraft(text || "");
    setDocDirty(false);
  };

  // Phase 3.8.4: Copy-as for request nodes in Collections menu
  const buildHeadersObject = (hdrs) => {
    const obj = {};
    for (const h of hdrs || []) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    return obj;
  };

  const buildSnippetInputFromSavedRequest = (req) => {
    const base = {
      method: req?.method || "GET",
      url: req?.url || "",
      params: Array.isArray(req?.params) ? req.params : [],
      headers: Array.isArray(req?.headers) ? req.headers : [],
      body: req?.body || "",
      auth: req?.auth || { type: "none" },
    };

    const resolved = applyVarsToRequest(base, envVars || {});
    const finalUrl = buildFinalUrl(resolved.url, resolved.params);

    let headerObj = buildHeadersObject(resolved.headers);
    headerObj = applyAuthToHeaders(resolved.auth, headerObj);

    const m = String(resolved.method || "GET").toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(m) && String(resolved.body || "").trim().length > 0;
    if (hasBody) {
      const hasContentType = Object.keys(headerObj).some((k) => k.toLowerCase() === "content-type");
      if (!hasContentType) headerObj["Content-Type"] = "application/json";
    }

    return {
      method: m,
      finalUrl,
      headersObj: headerObj,
      body: hasBody ? resolved.body : "",
    };
  };

  const copyRequestAs = async (node, format) => {
    if (!node || node.type !== "request") return;
    const req = node.request;
    const urlStr = (req?.url || "").trim();
    if (!urlStr) {
      setToastMsg("Cannot copy: URL is empty");
      return;
    }

    try {
      const input = buildSnippetInputFromSavedRequest(req);
      let snippet = "";
      if (format === "curl") snippet = toCurl(input);
      if (format === "fetch") snippet = toFetch(input);
      if (format === "axios") snippet = toAxios(input);

      await copyToClipboard(snippet);

      if (format === "curl") setToastMsg("Copied as cURL");
      if (format === "fetch") setToastMsg("Copied as Fetch");
      if (format === "axios") setToastMsg("Copied as Axios");
    } catch {
      setToastMsg("Copy failed");
    }
  };

  // --- Context menu ---
  const openContextMenu = (e, node) => {
    if (!activeCollection) return;
    if (node.id === "root") return;
    e.preventDefault();
    e.stopPropagation();
    setSelected({ collectionId: activeCollectionId, nodeId: node.id, type: node.type });
    setCtx({ x: e.clientX, y: e.clientY, node });
  };

  const renderCtxMenu = () => {
    if (!ctx) return null;
    const node = ctx.node;

    const w = 280;
    const approxItems = node.type === "folder" ? 10 : 10;
    const h = 44 + approxItems * 34;
    const x = Math.min(ctx.x, window.innerWidth - w - 10);
    const y = Math.min(ctx.y, window.innerHeight - h - 10);

    const parentFolderId = node.type === "folder" ? node.id : "root";

    return (
      <div ref={ctxRef} className="ctxMenu" style={{ left: x, top: y }}>
        <button className="ctxItem" onClick={() => (setCtx(null), runNode(node))}>
          <span className="ctxIcon">
            <SvgIcon name="play" />
          </span>
          <span>Run</span>
        </button>

        <button
          className="ctxItem"
          disabled={node.type !== "request"}
          onClick={() => (setCtx(null), onLoadRequest?.(node.request))}
        >
          <span className="ctxIcon">
            <SvgIcon name="link" />
          </span>
          <span>Load request</span>
        </button>

        {node.type === "request" ? (
          <>
            <div className="ctxSep" />
            <button className="ctxItem" onClick={() => (setCtx(null), copyRequestAs(node, "curl"))}>
              <span className="ctxIcon">
                <SvgIcon name="copy" />
              </span>
              <span>Copy as cURL</span>
            </button>
            <button className="ctxItem" onClick={() => (setCtx(null), copyRequestAs(node, "fetch"))}>
              <span className="ctxIcon">
                <SvgIcon name="copy" />
              </span>
              <span>Copy as Fetch</span>
            </button>
            <button className="ctxItem" onClick={() => (setCtx(null), copyRequestAs(node, "axios"))}>
              <span className="ctxIcon">
                <SvgIcon name="copy" />
              </span>
              <span>Copy as Axios</span>
            </button>
          </>
        ) : null}

        <div className="ctxSep" />

        <button className="ctxItem" onClick={() => (setCtx(null), addFolder(parentFolderId))}>
          <span className="ctxIcon">
            <SvgIcon name="folder" />
          </span>
          <span>Add folder here</span>
        </button>

        <button className="ctxItem" onClick={() => (setCtx(null), addRequest(parentFolderId))}>
          <span className="ctxIcon">
            <SvgIcon name="plus" />
          </span>
          <span>Add request here</span>
        </button>

        <div className="ctxSep" />

        {node.type === "folder" ? (
          <button
            className="ctxItem"
            onClick={() => {
              setCtx(null);
              setSelected({ collectionId: activeCollectionId, nodeId: node.id, type: "folder" });
            }}
          >
            <span className="ctxIcon">
              <SvgIcon name="doc" />
            </span>
            <span>Edit documentation</span>
          </button>
        ) : null}

        <button className="ctxItem" onClick={() => (setCtx(null), moveToPrompt(node))}>
          <span className="ctxIcon">
            <SvgIcon name="move" />
          </span>
          <span>Move to...</span>
        </button>

        <button className="ctxItem" onClick={() => beginInlineRename(node)}>
          <span className="ctxIcon">
            <SvgIcon name="edit" />
          </span>
          <span>Rename (inline)</span>
        </button>

        <button className="ctxItem ctxItemDanger" onClick={() => (setCtx(null), deleteNodeConfirm(node))}>
          <span className="ctxIcon">
            <SvgIcon name="trash" />
          </span>
          <span>Delete</span>
        </button>
      </div>
    );
  };

  // --- Drag & drop ---
  const getDropModeForRow = (e, node) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    const edge = 6;
    if (y <= edge) return "before";
    if (y >= h - edge) return "after";

    if (node.type === "folder") return "into";
    return y < h / 2 ? "before" : "after";
  };

  const findParentAndIndex = (folder, targetId) => {
    if (!folder || folder.type !== "folder") return null;
    const kids = folder.children || [];
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (child.id === targetId) return { parentId: folder.id, index: i };
      if (child.type === "folder") {
        const inner = findParentAndIndex(child, targetId);
        if (inner) return inner;
      }
    }
    return null;
  };

  const canDrop = (targetNode, draggedId, mode, targetParentId) => {
    if (!activeCollection) return false;
    if (!draggedId) return false;
    if (draggedId === "root") return false;

    if (targetNode?.id === draggedId) return false;
    if (mode === "into" && targetNode && targetNode.type !== "folder") return false;

    const draggedNode = findNodeDFS(activeCollection.root, draggedId);
    if (draggedNode?.type === "folder" && targetNode?.type === "folder") {
      if (isDescendant(activeCollection.root, draggedId, targetNode.id)) return false;
    }

    if (safeReorderOnly && (mode === "before" || mode === "after")) {
      const srcParentId = draggingMetaRef.current.parentId;
      if (!srcParentId || !targetParentId) return false;
      if (srcParentId !== targetParentId) return false;
    }

    return true;
  };

  const queueAutoExpand = (folderId, ms) => {
    const isAlready = expanded.has(folderId);
    if (isAlready) return;

    if (lastHoverFolderRef.current !== folderId) {
      clearHoverExpandTimer();
      lastHoverFolderRef.current = folderId;
      hoverExpandTimerRef.current = setTimeout(() => {
        setExpanded((prev) => new Set([...prev, folderId]));
      }, ms);
    }
  };

  const beginDrag = (e, node) => {
    if (!activeCollection) return;
    if (node.id === "root") return;
    if ((search || "").trim()) return;

    setDraggingId(node.id);
    setCtx(null);
    setDropState(null);
    clearHoverExpandTimer();
    cancelClearDropState();

    const meta = findParentAndIndex(activeCollection.root, node.id);
    draggingMetaRef.current = { parentId: meta?.parentId || null, index: meta?.index ?? null };

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/bhejo-node", JSON.stringify({ nodeId: node.id, type: node.type }));
  };

  const endDrag = () => {
    setDraggingId(null);
    setDropState(null);
    clearHoverExpandTimer();
    scheduleClearDropState();
    draggingMetaRef.current = { parentId: null, index: null };
  };

  const onDragOverRow = (e, node) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    cancelClearDropState();

    const mode = getDropModeForRow(e, node);

    if (node.type === "folder") {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const arrowZone = x < 30;

      if (arrowZone) queueAutoExpand(node.id, 180);
      else if (mode === "into") queueAutoExpand(node.id, 520);
      else clearHoverExpandTimer();
    } else {
      clearHoverExpandTimer();
    }

    if (node.id === "root") {
      setDropStateThrottled({ targetId: "root", mode: "into", parentId: "root", index: 0 });
      return;
    }

    const targetMeta = findParentAndIndex(activeCollection.root, node.id);
    if (!targetMeta) return;

    const targetParentId = targetMeta.parentId;
    if (!canDrop(node, draggingId, mode, mode === "into" ? node.id : targetParentId)) {
      setDropStateThrottled(null);
      return;
    }

    if (mode === "into") {
      setDropStateThrottled({ targetId: node.id, mode, parentId: node.id, index: 0 });
    } else if (mode === "before") {
      setDropStateThrottled({ targetId: node.id, mode, parentId: targetParentId, index: targetMeta.index });
    } else {
      setDropStateThrottled({
        targetId: node.id,
        mode,
        parentId: targetParentId,
        index: targetMeta.index + 1,
      });
    }
  };

  const onDrop = (e) => {
    if (!activeCollection) return;
    e.preventDefault();
    e.stopPropagation();

    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("application/bhejo-node"));
    } catch {}

    const draggedId = payload?.nodeId || draggingId;
    if (!draggedId || !dropState) {
      endDrag();
      return;
    }

    if (dropState.targetId === "root") {
      const next = moveNodeEx(activeCollection.id, draggedId, "root", 0);
      setTrees(next);
      endDrag();
      return;
    }

    const next = moveNodeEx(activeCollection.id, draggedId, dropState.parentId, dropState.index);
    setTrees(next);

    if (dropState.mode === "into") {
      setExpanded((prev) => new Set([...prev, dropState.parentId]));
    }

    endDrag();
  };

  const getNodeName = (id) => {
    if (!activeCollection) return "";
    if (id === "root") return "Root";
    const n = findNodeDFS(activeCollection.root, id);
    return n?.name || "";
  };

  const renderNode = (node, depth = 0) => {
    const isFolder = node.type === "folder";
    const forced = (search || "").trim() ? forcedExpanded.has(node.id) : false;
    const isExpanded = forced || expanded.has(node.id);

    const isSelected = selected?.nodeId === node.id && selected?.collectionId === activeCollectionId;

    const paddingLeft = 10 + depth * 14;

    const dropTop = dropState?.targetId === node.id && dropState?.mode === "before";
    const dropBottom = dropState?.targetId === node.id && dropState?.mode === "after";
    const dropInto = dropState?.targetId === node.id && dropState?.mode === "into";

    const rowClass = [
      "treeRow",
      isSelected ? "treeRowActive" : "",
      draggingId === node.id ? "dragGhost" : "",
      dropInto ? "dropHint" : "",
      dropTop ? "dropLineTop" : "",
      dropBottom ? "dropLineBottom" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const isEditing = editingNodeId === node.id;

    return (
      <div key={node.id} style={{ position: "relative" }}>
        <div
          className={rowClass}
          style={{ paddingLeft }}
          draggable={node.id !== "root"}
          onDragStart={(e) => beginDrag(e, node)}
          onDragEnd={endDrag}
          onDragOver={(e) => onDragOverRow(e, node)}
          onDragLeave={() => scheduleClearDropState()}
          onDrop={onDrop}
          onContextMenu={(e) => openContextMenu(e, node)}
          onClick={() => setSelected({ collectionId: activeCollectionId, nodeId: node.id, type: node.type })}
          onDoubleClick={() => {
            if (node.type === "request") onLoadRequest?.(node.request);
            if (node.type === "folder") toggleExpand(node.id);
          }}
          title={(search || "").trim() ? "Search is active: drag disabled" : "Right-click for actions. Drag to move/reorder."}
        >
          {isFolder ? (
            <span
              className="treeArrowHit"
              onClick={(e) => {
                e.stopPropagation();
                if ((search || "").trim()) return;
                toggleExpand(node.id);
              }}
              title={isExpanded ? "Collapse" : "Expand"}
            >
              <IconSlot>{isExpanded ? <SvgIcon name="chevDown" /> : <SvgIcon name="chevRight" />}</IconSlot>
            </span>
          ) : (
            <IconSlot />
          )}

          <IconSlot>{isFolder ? <SvgIcon name="folder" /> : <SvgIcon name="link" />}</IconSlot>

          {!isEditing ? (
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {node.name}
            </span>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
              <input
                className="inlineEditInput"
                value={editingValue}
                autoFocus
                onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitInlineRename();
                  if (e.key === "Escape") cancelInlineRename();
                }}
                onBlur={() => commitInlineRename()}
              />
              <span className="inlineEditHint">Enter to save, Esc to cancel</span>
            </div>
          )}

          {isFolder && !isEditing ? (
            <span style={{ opacity: 0.6, fontSize: 12 }}>
              {(node.children || []).filter((c) => c.type === "request").length} req
            </span>
          ) : null}

          {node.id !== "root" && !isEditing ? (
            <span className="treeRowActions">
              <button
                className="kebabBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setCtx({ x: rect.left, y: rect.bottom + 6, node });
                }}
                title="Actions"
              >
                <SvgIcon name="dots" />
              </button>
            </span>
          ) : null}
        </div>

        {isFolder && isExpanded ? <div>{(node.children || []).map((child) => renderNode(child, depth + 1))}</div> : null}
      </div>
    );
  };

  if (!activeCollection || !filteredRoot) {
    return (
      <div className="collectionsWrap">
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={onImportFile}
        />

        <div className="collectionsToolbar">
          <div className="collectionsToolbarLeft">
            <div style={{ fontWeight: 800 }}>Collections</div>
            <span className="badge">0 collections</span>
          </div>
          <div className="collectionsToolbarRight">
            <button className="btn btnSm" onClick={createCollection}>New</button>
            <button className="btn btnSm" onClick={openImportPicker}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <SvgIcon name="upload" /> Import
              </span>
            </button>
          </div>
        </div>

        <div className="muted">No collections yet.</div>
      </div>
    );
  }

  const selectedFolderName = selected?.type === "folder" ? getNodeName(selected.nodeId) : "";

  return (
    <div className="collectionsWrap">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={onImportFile}
      />

      <div className="collectionsToolbar">
        <div className="collectionsToolbarLeft">
          <div style={{ fontWeight: 800 }}>Collections</div>
          <span className="badge">{trees.length} collections</span>
        </div>

        <div className="collectionsToolbarRight">
          <button className="btn btnSm" onClick={createCollection}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <SvgIcon name="plus" /> New
            </span>
          </button>
          <button className="btn btnSm" onClick={refresh}>Refresh</button>
        </div>
      </div>

      <div className="collectionsToolbar">
        <div className="collectionsToolbarLeft" style={{ flex: 1 }}>
          <select
            className="input"
            value={activeCollectionId || ""}
            onChange={(e) => {
              setActiveCollectionId(e.target.value);
              setSelected(null);
              setCtx(null);
              setEditingNodeId(null);
              setSearch("");
            }}
            style={{ flex: 1, minWidth: 180 }}
          >
            {trees.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={addMenu}
            onChange={(e) => {
              const v = e.target.value;
              setAddMenu("none");
              if (v === "folder") addFolder();
              if (v === "request") addRequest();
            }}
            style={{ maxWidth: 160 }}
          >
            <option value="none">Add...</option>
            <option value="folder">Folder</option>
            <option value="request">Request</option>
          </select>
        </div>

        <div className="collectionsToolbarRight">
          <button className="btn btnSm" onClick={exportActive} disabled={!activeCollection}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <SvgIcon name="download" /> Export
            </span>
          </button>
          <button className="btn btnSm" onClick={openImportPicker}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <SvgIcon name="upload" /> Import
            </span>
          </button>
          <button className="btn btnSm" onClick={renameCollection}>Rename</button>
          <button className="btn btnDanger btnSm" onClick={removeCollection}>Delete</button>
        </div>
      </div>

      <div className="collectionsToolbar">
        <div className="collectionsSearchRow">
          <input
            className="input searchInput"
            placeholder="Search folders/requests/docs..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setEditingNodeId(null);
              setCtx(null);
            }}
          />

          <button className="btn btnSm" onClick={() => setSearch("")} disabled={!search.trim()}>
            Clear
          </button>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={safeReorderOnly} onChange={(e) => setSafeReorderOnly(e.target.checked)} />
            <span className="muted">Safe reorder only</span>
          </label>
        </div>
      </div>

      {toast ? (
        <div className="smallMuted" style={{ color: "var(--muted)" }}>
          {toast}
        </div>
      ) : null}

      <div
        className="collectionsTree"
        onDragOver={(e) => {
          if (!draggingId) return;
          e.preventDefault();
          cancelClearDropState();
          setDropStateThrottled({ targetId: "root", mode: "into", parentId: "root", index: 0 });
        }}
        onDragLeave={() => scheduleClearDropState()}
        onDrop={onDrop}
        style={dropState?.targetId === "root" ? { outline: "2px dashed rgba(255,255,255,0.14)", borderRadius: 14 } : null}
        title="Drop here to move into Root"
      >
        {renderNode(filteredRoot, 0)}
      </div>

      {selected?.type === "folder" ? (
        <div className="folderDocsPanel">
          <div className="folderDocsHeader">
            <div className="folderDocsTitle">Docs: {selectedFolderName || "Folder"}</div>
            <div className="muted">{docDirty ? "Unsaved" : "Saved"}</div>
          </div>

          <textarea
            className="folderDocsTextarea"
            value={docDraft}
            onChange={(e) => {
              setDocDraft(e.target.value);
              setDocDirty(true);
            }}
            placeholder="Write notes for this folder (auth, headers, how to run, etc.)"
          />

          <div className="folderDocsActions">
            <button className="btn btnSm" disabled={!docDirty} onClick={saveFolderDoc}>
              Save
            </button>
            <button className="btn btnSm" disabled={!docDirty} onClick={resetFolderDoc}>
              Reset
            </button>
          </div>
        </div>
      ) : null}

      <div className="muted">
        Drag to move/reorder. Drop near top/bottom edge to reorder. Hover a folder while dragging to auto-expand.
        {(search || "").trim() ? " Search is active: drag is disabled." : ""}
      </div>

      {renderCtxMenu()}
    </div>
  );
}
