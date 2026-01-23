// src/utils/storage.js

// -------------------- Keys --------------------
const HISTORY_KEY = "bhejo_history_v1";
const SAVED_KEY = "bhejo_saved_v1";

const CURRENT_ENV_KEY = "bhejo_current_env_v1";
const ENV_VARS_KEY = "bhejo_env_vars_v1";

const COLLECTIONS_KEY = "bhejo_collections_v1";

// Phase 3: Tree collections
const COLLECTION_TREES_KEY = "bhejo_collection_trees_v1";

// -------------------- Helpers --------------------
function uuid(prefix = "id") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function nowISO() {
  return new Date().toISOString();
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeSave(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function nodeKind(node) {
  // Support both shapes: type (Phase 3) and kind (some later UI code)
  return node?.type || node?.kind || "";
}

function touchFolder(folder) {
  if (!folder) return;
  if (nodeKind(folder) !== "folder") return;
  folder.updatedAt = nowISO();
}

function normalizeParams(v) {
  return Array.isArray(v) ? v : [{ key: "", value: "" }];
}

function normalizeHeaders(v) {
  return Array.isArray(v) ? v : [{ key: "", value: "" }];
}

function normalizeTests(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeDataRows(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeAuth(v) {
  if (!v || typeof v !== "object") return { type: "none" };
  const type = String(v.type || "none");
  return {
    type,
    bearer: v.bearer || "",
    username: v.username || "",
    password: v.password || "",
    apiKeyName: v.apiKeyName || "x-api-key",
    apiKeyValue: v.apiKeyValue || "",
  };
}

function normalizePreRequestScript(v) {
  return typeof v === "string" ? v : "";
}

function ensureFolderChildren(folder) {
  if (!folder || nodeKind(folder) !== "folder") return;
  if (!folder.children) folder.children = [];
  if (!Array.isArray(folder.children)) folder.children = [];
}

function normalizeRequestPayload(payload, fallbackName = "Request") {
  const p = payload && typeof payload === "object" ? payload : {};
  const name = (p.name || fallbackName || "Request").trim() || "Request";

  return {
    id: p.id || uuid("r"),
    name,
    method: p.method || "GET",
    url: p.url || "",
    params: normalizeParams(p.params),
    headers: normalizeHeaders(p.headers),
    body: p.body || "",
    auth: normalizeAuth(p.auth),
    tests: normalizeTests(p.tests),
    dataRows: normalizeDataRows(p.dataRows),
    mode: p.mode || "direct",
    preRequestScript: normalizePreRequestScript(p.preRequestScript),
  };
}

// -------------------- History --------------------
export function loadHistory() {
  const parsed = safeParse(HISTORY_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveHistory(items) {
  safeSave(HISTORY_KEY, Array.isArray(items) ? items : []);
}

export function addHistory(item) {
  const list = loadHistory();

  const normalized = {
    id: item.id || uuid("hist"),
    name: item.name || "",
    method: item.method || "GET",
    url: item.url || "",
    params: normalizeParams(item.params),
    headers: normalizeHeaders(item.headers),
    body: item.body || "",
    auth: normalizeAuth(item.auth),
    tests: normalizeTests(item.tests),
    dataRows: normalizeDataRows(item.dataRows),
    mode: item.mode || "direct",
    preRequestScript: normalizePreRequestScript(item.preRequestScript),
    savedAt: item.savedAt || nowISO(),
    lastResult: item.lastResult || null,
  };

  const updated = [normalized, ...list].slice(0, 200);
  saveHistory(updated);
  return updated;
}

export function deleteHistory(id) {
  const list = loadHistory();
  const updated = list.filter((x) => x.id !== id);
  saveHistory(updated);
  return updated;
}

export function clearHistory() {
  saveHistory([]);
  return [];
}

// Backward-compatible aliases (older code)
export const addToHistory = addHistory;
export const deleteHistoryItem = deleteHistory;

// -------------------- Saved Requests --------------------
export function loadSaved() {
  const parsed = safeParse(SAVED_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveSaved(items) {
  safeSave(SAVED_KEY, Array.isArray(items) ? items : []);
}

export function deleteSaved(id) {
  const items = loadSaved();
  const updated = items.filter((x) => x.id !== id);
  saveSaved(updated);
  return updated;
}

/**
 * Upsert by NAME (case-insensitive uniqueness).
 * If you save again with same name, it replaces the old one.
 */
export function upsertSavedByName(newItem) {
  const items = loadSaved();

  const name = (newItem.name || "").trim();
  const nameKey = name.toLowerCase();
  const nowIso = nowISO();

  const normalized = {
    id: newItem.id || uuid("sav"),
    name: name || "Untitled",
    method: newItem.method || "GET",
    url: newItem.url || "",
    params: normalizeParams(newItem.params),
    headers: normalizeHeaders(newItem.headers),
    body: newItem.body || "",
    auth: normalizeAuth(newItem.auth),

    tests: normalizeTests(newItem.tests),

    // Legacy collections (Phase 2.2)
    collectionId: newItem.collectionId || "",

    // Data rows / Iterations (Phase 2.3)
    dataRows: normalizeDataRows(newItem.dataRows),

    // Direct / Proxy
    mode: newItem.mode || "direct",

    // Phase 4: pre-request script
    preRequestScript: normalizePreRequestScript(newItem.preRequestScript),

    createdAt: newItem.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const filtered = items.filter(
    (it) => (it.name || "").trim().toLowerCase() !== nameKey
  );
  const updated = [normalized, ...filtered];
  saveSaved(updated);
  return updated;
}

// Backward-compatible alias
export const upsertSaved = upsertSavedByName;

// -------------------- Environments --------------------
export function loadCurrentEnv() {
  const v = localStorage.getItem(CURRENT_ENV_KEY);
  return (v || "dev").trim() || "dev";
}

export function saveCurrentEnv(envName) {
  const n = (envName || "").trim() || "dev";
  localStorage.setItem(CURRENT_ENV_KEY, n);
}

// Backward-compatible aliases
export const getCurrentEnv = loadCurrentEnv;
export const setCurrentEnv = saveCurrentEnv;

export function loadEnvVars() {
  const parsed = safeParse(ENV_VARS_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

export function saveEnvVars(envVarsAll) {
  const obj =
    envVarsAll && typeof envVarsAll === "object" && !Array.isArray(envVarsAll)
      ? envVarsAll
      : {};
  safeSave(ENV_VARS_KEY, obj);
}

// -------------------- Legacy Collections (Phase 2.2) --------------------
export function loadCollections() {
  const parsed = safeParse(COLLECTIONS_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveCollections(collections) {
  safeSave(COLLECTIONS_KEY, Array.isArray(collections) ? collections : []);
}

export function addCollection(name) {
  const n = (name || "").trim();
  if (!n) return loadCollections();

  const list = loadCollections();
  if (list.some((c) => (c.name || "").toLowerCase() === n.toLowerCase()))
    return list;

  const newItem = { id: uuid("col"), name: n, createdAt: nowISO() };
  const updated = [newItem, ...list];
  saveCollections(updated);
  return updated;
}

export function deleteCollection(id) {
  const list = loadCollections();
  const updated = list.filter((c) => c.id !== id);
  saveCollections(updated);
  return updated;
}

// -------------------- Tree Collections (Phase 3) --------------------
export function loadCollectionTrees() {
  const parsed = safeParse(COLLECTION_TREES_KEY, []);
  const list = Array.isArray(parsed) ? parsed : [];

  // Compatibility layer:
  // - Ensure each tree has .root folder
  // - Also add .children alias (tree.children -> root.children) for UI code that expects it
  // - Ensure nodes have both .type and .kind aliases (non-destructive copy)
  function normalizeNode(node) {
    if (!node || typeof node !== "object") return node;
    const k = nodeKind(node);

    const out = { ...node };
    if (!out.type && out.kind) out.type = out.kind;
    if (!out.kind && out.type) out.kind = out.type;

    if (k === "folder") {
      ensureFolderChildren(out);
      out.children = (out.children || []).map(normalizeNode);
      return out;
    }

    if (k === "request") {
      const req = out.request && typeof out.request === "object" ? out.request : {};
      out.request = normalizeRequestPayload(req, out.name || "Request");
      return out;
    }

    return out;
  }

  function makeRootFolder() {
    return {
      id: "root",
      type: "folder",
      kind: "folder",
      name: "Root",
      doc: "",
      children: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
  }

  const normalizedTrees = list.map((tree) => {
    const t = tree && typeof tree === "object" ? tree : {};
    const root =
      t.root && typeof t.root === "object"
        ? normalizeNode(t.root)
        : normalizeNode({
            id: "root",
            type: "folder",
            kind: "folder",
            name: "Root",
            doc: "",
            children: Array.isArray(t.children) ? t.children : [],
            createdAt: t.createdAt || nowISO(),
            updatedAt: t.updatedAt || nowISO(),
          });

    // alias children for some UI code
    const childrenAlias = Array.isArray(root.children) ? root.children : [];

    return {
      ...t,
      id: t.id || uuid("tcol"),
      name: t.name || "Collection",
      root,
      children: childrenAlias,
      createdAt: t.createdAt || nowISO(),
      updatedAt: t.updatedAt || nowISO(),
    };
  });

  return normalizedTrees;
}

export function saveCollectionTrees(trees) {
  // Persist using the canonical shape: tree.root + node.type
  const list = Array.isArray(trees) ? trees : [];

  function stripNode(node) {
    if (!node || typeof node !== "object") return node;
    const k = nodeKind(node);

    const out = { ...node };
    // canonical: type only (kind is allowed to exist, but keep both to be safe)
    if (!out.type && out.kind) out.type = out.kind;
    if (!out.kind && out.type) out.kind = out.type;

    if (k === "folder") {
      ensureFolderChildren(out);
      out.children = (out.children || []).map(stripNode);
      out.doc = typeof out.doc === "string" ? out.doc : "";
      return out;
    }

    if (k === "request") {
      const req = out.request && typeof out.request === "object" ? out.request : {};
      out.request = normalizeRequestPayload(req, out.name || "Request");
      return out;
    }

    return out;
  }

  const cleaned = list.map((tree) => {
    const t = tree && typeof tree === "object" ? tree : {};
    const root =
      t.root && typeof t.root === "object"
        ? stripNode(t.root)
        : stripNode({
            id: "root",
            type: "folder",
            kind: "folder",
            name: "Root",
            doc: "",
            children: Array.isArray(t.children) ? t.children : [],
            createdAt: t.createdAt || nowISO(),
            updatedAt: t.updatedAt || nowISO(),
          });

    return {
      id: t.id || uuid("tcol"),
      name: t.name || "Collection",
      root,
      createdAt: t.createdAt || nowISO(),
      updatedAt: t.updatedAt || nowISO(),
    };
  });

  safeSave(COLLECTION_TREES_KEY, cleaned);
}

// Phase 3.6.1: Root folder includes doc
function makeRootFolder() {
  return {
    id: "root",
    type: "folder",
    kind: "folder",
    name: "Root",
    doc: "",
    children: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

export function addCollectionTree(name) {
  const n = (name || "").trim() || "New Collection";
  const trees = loadCollectionTrees();

  const newTree = {
    id: uuid("tcol"),
    name: n,
    root: makeRootFolder(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  const updated = [newTree, ...trees];
  saveCollectionTrees(updated);
  return updated;
}

export function renameCollectionTree(collectionId, newName) {
  const n = (newName || "").trim();
  if (!n) return loadCollectionTrees();

  const trees = loadCollectionTrees();
  const next = trees.map((t) =>
    t.id === collectionId ? { ...t, name: n, updatedAt: nowISO() } : t
  );
  saveCollectionTrees(next);
  return next;
}

export function deleteCollectionTree(collectionId) {
  const trees = loadCollectionTrees();
  const next = trees.filter((t) => t.id !== collectionId);
  saveCollectionTrees(next);
  return next;
}

// ----- Node search helpers -----
function findNodeDFS(folderNode, targetId) {
  if (!folderNode) return null;
  if (folderNode.id === targetId) return { node: folderNode, parent: null };

  if (nodeKind(folderNode) === "folder" && Array.isArray(folderNode.children)) {
    for (const child of folderNode.children) {
      if (child.id === targetId) return { node: child, parent: folderNode };
      if (nodeKind(child) === "folder") {
        const hit = findNodeDFS(child, targetId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function findNodeWithParentAndIndex(folderNode, targetId) {
  if (!folderNode) return null;

  if (folderNode.id === targetId) {
    return { node: folderNode, parent: null, index: -1 };
  }

  if (nodeKind(folderNode) === "folder" && Array.isArray(folderNode.children)) {
    for (let i = 0; i < folderNode.children.length; i++) {
      const child = folderNode.children[i];

      if (child.id === targetId) return { node: child, parent: folderNode, index: i };

      if (nodeKind(child) === "folder") {
        const found = findNodeWithParentAndIndex(child, targetId);
        if (found) return found;
      }
    }
  }

  return null;
}

function isDescendantFolder(rootFolder, ancestorFolderId, possibleDescendantId) {
  const ancestorHit = findNodeDFS(rootFolder, ancestorFolderId);
  if (!ancestorHit || nodeKind(ancestorHit.node) !== "folder") return false;
  const innerHit = findNodeDFS(ancestorHit.node, possibleDescendantId);
  return !!innerHit;
}

// ----- Node operations -----
// Phase 3.6.1: New folders include doc: ""
export function addFolderNode(collectionId, parentFolderId, name) {
  const n = (name || "").trim() || "New Folder";

  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  const parentHit =
    parentFolderId === "root" ? { node: col.root } : findNodeDFS(col.root, parentFolderId);
  if (!parentHit || nodeKind(parentHit.node) !== "folder") return trees;

  ensureFolderChildren(parentHit.node);

  parentHit.node.children.push({
    id: uuid("fld"),
    type: "folder",
    kind: "folder",
    name: n,
    doc: "",
    children: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });

  touchFolder(parentHit.node);
  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

export function addRequestNode(collectionId, parentFolderId, name, requestPayload) {
  const n = (name || "").trim() || "New Request";

  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  const parentHit =
    parentFolderId === "root" ? { node: col.root } : findNodeDFS(col.root, parentFolderId);
  if (!parentHit || nodeKind(parentHit.node) !== "folder") return trees;

  ensureFolderChildren(parentHit.node);

  const req = normalizeRequestPayload(requestPayload, n);

  parentHit.node.children.push({
    id: uuid("req"),
    type: "request",
    kind: "request",
    name: n,
    request: req,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });

  touchFolder(parentHit.node);
  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

export function renameNode(collectionId, nodeId, newName) {
  const n = (newName || "").trim();
  if (!n) return loadCollectionTrees();

  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  const hit = findNodeDFS(col.root, nodeId);
  if (!hit || !hit.node) return trees;

  hit.node.name = n;
  hit.node.updatedAt = nowISO();

  if (nodeKind(hit.node) === "request" && hit.node.request) {
    hit.node.request.name = n;
  }

  if (hit.parent) touchFolder(hit.parent);
  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

export function deleteNode(collectionId, nodeId) {
  if (nodeId === "root") return loadCollectionTrees();

  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  const hit = findNodeWithParentAndIndex(col.root, nodeId);
  if (!hit || !hit.parent || hit.index < 0) return trees;

  ensureFolderChildren(hit.parent);
  hit.parent.children.splice(hit.index, 1);

  touchFolder(hit.parent);
  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

/**
 * Phase 3.5.2: move with index (supports reorder)
 * - newParentFolderId: folder id or "root"
 * - newIndex: insertion index inside destination folder children
 */
export function moveNodeEx(collectionId, nodeId, newParentFolderId = "root", newIndex = 0) {
  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  if (nodeId === "root") return trees;

  const srcHit = findNodeWithParentAndIndex(col.root, nodeId);
  if (!srcHit || !srcHit.parent) return trees;

  const dstHit =
    newParentFolderId === "root"
      ? { node: col.root }
      : findNodeDFS(col.root, newParentFolderId);

  if (!dstHit || nodeKind(dstHit.node) !== "folder") return trees;

  // Prevent moving a folder into itself or its descendant
  if (nodeKind(srcHit.node) === "folder") {
    if (newParentFolderId === nodeId) return trees;
    if (isDescendantFolder(col.root, nodeId, newParentFolderId)) return trees;
  }

  // Remove from source
  ensureFolderChildren(srcHit.parent);
  const movingNode = srcHit.node;
  srcHit.parent.children.splice(srcHit.index, 1);
  touchFolder(srcHit.parent);

  // Insert into destination at index (clamped)
  ensureFolderChildren(dstHit.node);
  let idx = Number.isFinite(newIndex) ? newIndex : 0;

  // If moving within same parent and removing earlier index, shift destination index
  const sameParent = srcHit.parent.id === dstHit.node.id;
  if (sameParent && srcHit.index !== -1 && idx > srcHit.index) idx = idx - 1;

  idx = Math.max(0, Math.min(idx, dstHit.node.children.length));
  dstHit.node.children.splice(idx, 0, movingNode);
  touchFolder(dstHit.node);

  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

// Backward-compatible: "move into folder/root at top"
export function moveNode(collectionId, nodeId, newParentFolderId = "root") {
  return moveNodeEx(collectionId, nodeId, newParentFolderId, 0);
}

// -------------------- Phase 3.6.1: Folder Docs APIs --------------------
export function getFolderDoc(collectionId, folderId) {
  const trees = loadCollectionTrees();
  const col = trees.find((t) => t.id === collectionId);
  if (!col) return "";

  const hit =
    folderId === "root" ? { node: col.root, parent: null } : findNodeDFS(col.root, folderId);
  if (!hit || !hit.node || nodeKind(hit.node) !== "folder") return "";

  return typeof hit.node.doc === "string" ? hit.node.doc : "";
}

export function setFolderDoc(collectionId, folderId, docText) {
  const trees = loadCollectionTrees();
  const next = clone(trees);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return trees;

  const hit =
    folderId === "root" ? { node: col.root, parent: null } : findNodeDFS(col.root, folderId);
  if (!hit || !hit.node || nodeKind(hit.node) !== "folder") return trees;

  hit.node.doc = typeof docText === "string" ? docText : "";
  hit.node.updatedAt = nowISO();

  if (hit.parent) touchFolder(hit.parent);
  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

// ----- Flatten requests for Runner -----
export function flattenRequestsFromNode(collectionId, nodeId) {
  const trees = loadCollectionTrees();
  const col = trees.find((t) => t.id === collectionId);
  if (!col) return [];

  const startHit = nodeId === "root" ? { node: col.root } : findNodeDFS(col.root, nodeId);
  if (!startHit || !startHit.node) return [];

  const out = [];

  function walk(node, folderPathParts) {
    if (!node) return;

    if (nodeKind(node) === "request") {
      out.push({
        collectionId,
        nodeId: node.id,
        name: node.name,
        path: folderPathParts.join(" / "),
        request: node.request || {},
      });
      return;
    }

    if (nodeKind(node) === "folder") {
      const nextPath = node.id === "root" ? folderPathParts : [...folderPathParts, node.name];
      for (const child of node.children || []) walk(child, nextPath);
    }
  }

  walk(startHit.node, []);
  return out;
}

// -------------------- Phase 3.7.1: Export / Import Collections --------------------
function remapTreeIds(tree) {
  const newTreeId = uuid("tcol");

  function remapNode(node) {
    if (!node) return node;

    const k = nodeKind(node);
    const newId = node.id === "root" ? "root" : uuid(k === "folder" ? "fld" : "req");

    if (k === "folder") {
      return {
        ...node,
        id: newId,
        type: "folder",
        kind: "folder",
        doc: typeof node.doc === "string" ? node.doc : "",
        children: Array.isArray(node.children) ? node.children.map(remapNode) : [],
      };
    }

    if (k === "request") {
      const req = node.request && typeof node.request === "object" ? node.request : {};
      const normalizedReq = normalizeRequestPayload(req, node.name || "Request");

      return {
        ...node,
        id: newId,
        type: "request",
        kind: "request",
        request: {
          ...normalizedReq,
          id: uuid("r"),
        },
      };
    }

    return node;
  }

  const safeRoot = tree.root && typeof tree.root === "object" ? tree.root : makeRootFolder();

  const remappedRoot = {
    ...safeRoot,
    id: "root",
    type: "folder",
    kind: "folder",
    name: safeRoot.name || "Root",
    doc: typeof safeRoot.doc === "string" ? safeRoot.doc : "",
    children: Array.isArray(safeRoot.children) ? safeRoot.children.map(remapNode) : [],
  };

  const now = nowISO();

  return {
    id: newTreeId,
    name: tree.name || "Imported Collection",
    root: remappedRoot,
    createdAt: now,
    updatedAt: now,
  };
}

export function exportCollectionTree(collectionId) {
  const trees = loadCollectionTrees();
  const col = trees.find((t) => t.id === collectionId);
  if (!col) return null;

  return {
    schema: "bhejo.collectionTree",
    version: 1,
    exportedAt: nowISO(),
    collection: clone(col),
  };
}

export function importCollectionTree(exportObject, options = {}) {
  const { mode = "new" } = options;
  if (mode !== "new") return loadCollectionTrees();

  if (!exportObject || typeof exportObject !== "object") return loadCollectionTrees();
  if (exportObject.schema !== "bhejo.collectionTree") return loadCollectionTrees();
  if (!exportObject.collection || typeof exportObject.collection !== "object") return loadCollectionTrees();

  const incoming = exportObject.collection;

  const imported = remapTreeIds(incoming);

  const trees = loadCollectionTrees();
  const next = [imported, ...trees];
  saveCollectionTrees(next);
  return next;
}

// -------------------- Phase 3.7.2: Import Merge (into folder) --------------------
function ensureUniqueChildName(folderNode, desiredName, type) {
  const base =
    (desiredName || "").trim() || (type === "folder" ? "Folder" : "Request");
  const kids = Array.isArray(folderNode.children) ? folderNode.children : [];

  const exists = (nm) =>
    kids.some(
      (c) =>
        c &&
        nodeKind(c) === type &&
        (c.name || "").trim().toLowerCase() === nm.trim().toLowerCase()
    );

  if (!exists(base)) return base;

  const suffixBase = `${base} (imported)`;
  if (!exists(suffixBase)) return suffixBase;

  let i = 2;
  while (i < 1000) {
    const candidate = `${base} (imported ${i})`;
    if (!exists(candidate)) return candidate;
    i++;
  }
  return `${base} (imported ${Date.now()})`;
}

function findChildByName(folderNode, type, name) {
  const kids = Array.isArray(folderNode.children) ? folderNode.children : [];
  const key = (name || "").trim().toLowerCase();
  return (
    kids.find(
      (c) => c && nodeKind(c) === type && (c.name || "").trim().toLowerCase() === key
    ) || null
  );
}

function remapNodeIdsDeep(node) {
  if (!node || typeof node !== "object") return node;

  const k = nodeKind(node);

  if (k === "folder") {
    return {
      ...node,
      id: node.id === "root" ? "root" : uuid("fld"),
      type: "folder",
      kind: "folder",
      doc: typeof node.doc === "string" ? node.doc : "",
      children: Array.isArray(node.children) ? node.children.map(remapNodeIdsDeep) : [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
  }

  if (k === "request") {
    const req = node.request && typeof node.request === "object" ? node.request : {};
    const n = (node.name || req.name || "Request").trim() || "Request";
    const normalizedReq = normalizeRequestPayload(req, n);

    return {
      ...node,
      id: uuid("req"),
      type: "request",
      kind: "request",
      name: n,
      request: {
        ...normalizedReq,
        id: uuid("r"),
        name: n,
      },
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
  }

  return node;
}

/**
 * Merge incoming folder children into destination folder.
 * conflict:
 * - "rename": keep existing, add incoming with renamed nodes if name conflicts
 * - "skip":   keep existing, skip incoming conflicting nodes
 * - "overwrite": replace existing node when name conflicts (requests overwrite payload; folders replaced)
 */
function mergeFolderChildren(destFolder, incomingFolder, conflict) {
  ensureFolderChildren(destFolder);
  const incomingKids = Array.isArray(incomingFolder.children) ? incomingFolder.children : [];

  for (const rawChild of incomingKids) {
    const child = remapNodeIdsDeep(rawChild);
    const k = nodeKind(child);
    if (!child || !k) continue;

    if (k === "folder") {
      const existing = findChildByName(destFolder, "folder", child.name);

      if (!existing) {
        destFolder.children.push(child);
        continue;
      }

      if (conflict === "skip") continue;

      if (conflict === "overwrite") {
        const idx = destFolder.children.findIndex(
          (x) => x && nodeKind(x) === "folder" && x.id === existing.id
        );
        if (idx >= 0) destFolder.children.splice(idx, 1, child);
        continue;
      }

      if (conflict === "rename") {
        const unique = ensureUniqueChildName(destFolder, child.name, "folder");
        child.name = unique;
        destFolder.children.push(child);
        continue;
      }

      // default: merge contents into existing folder
      mergeFolderChildren(existing, child, conflict);
      touchFolder(existing);
      continue;
    }

    if (k === "request") {
      const existing = findChildByName(destFolder, "request", child.name);

      if (!existing) {
        destFolder.children.push(child);
        continue;
      }

      if (conflict === "skip") continue;

      if (conflict === "overwrite") {
        existing.request = child.request;
        existing.updatedAt = nowISO();
        existing.name = child.name;
        touchFolder(destFolder);
        continue;
      }

      const unique = ensureUniqueChildName(destFolder, child.name, "request");
      child.name = unique;
      if (child.request) child.request.name = unique;
      destFolder.children.push(child);
      continue;
    }
  }

  touchFolder(destFolder);
}

/**
 * Phase 3.7.2:
 * Import an exported collection tree INTO an existing collection folder.
 *
 * Options:
 * - targetFolderId: folder id in destination collection (default "root")
 * - conflict: "rename" | "skip" | "overwrite"  (default "rename")
 * - wrap: boolean (default true) -> creates a wrapper folder named like imported collection, then merges inside it
 */
export function importCollectionTreeInto(destinationCollectionId, exportObject, options = {}) {
  const targetFolderId = options.targetFolderId || "root";
  const conflict = options.conflict || "rename";
  const wrap = options.wrap !== false;

  if (!exportObject || typeof exportObject !== "object") return loadCollectionTrees();
  if (exportObject.schema !== "bhejo.collectionTree") return loadCollectionTrees();
  if (!exportObject.collection || typeof exportObject.collection !== "object") return loadCollectionTrees();

  const incomingTree = exportObject.collection;
  const incomingRoot =
    incomingTree.root && typeof incomingTree.root === "object" ? incomingTree.root : null;
  if (!incomingRoot || nodeKind(incomingRoot) !== "folder") return loadCollectionTrees();

  const trees = loadCollectionTrees();
  const next = clone(trees);

  const destCol = next.find((t) => t.id === destinationCollectionId);
  if (!destCol) return trees;

  const destFolderHit =
    targetFolderId === "root"
      ? { node: destCol.root }
      : findNodeDFS(destCol.root, targetFolderId);

  if (!destFolderHit || !destFolderHit.node || nodeKind(destFolderHit.node) !== "folder")
    return trees;

  ensureFolderChildren(destFolderHit.node);

  const now = nowISO();

  if (wrap) {
    const wrapperName = ensureUniqueChildName(
      destFolderHit.node,
      incomingTree.name || "Imported",
      "folder"
    );
    const wrapper = {
      id: uuid("fld"),
      type: "folder",
      kind: "folder",
      name: wrapperName,
      doc: "",
      children: [],
      createdAt: now,
      updatedAt: now,
    };

    mergeFolderChildren(wrapper, incomingRoot, conflict);

    destFolderHit.node.children.push(wrapper);
    touchFolder(destFolderHit.node);
  } else {
    mergeFolderChildren(destFolderHit.node, incomingRoot, conflict);
  }

  destCol.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}

// -------------------- Phase 4.2.5: Save imported request into tree --------------------
/**
 * Upsert a request node under a given folder (or root) in a collection tree.
 *
 * - If a request with the same name exists in that folder (case-insensitive), overwrite its request payload.
 * - Otherwise create a new request node.
 *
 * @param {Array} trees Existing tree list (usually loadCollectionTrees()).
 * @param {Object} args { collectionId, folderId, requestName, requestPayload }
 * @returns {Array|null} Updated trees list (also persisted). Null when failed.
 */
export function upsertCollectionTreeRequestUnderFolder(trees, args) {
  const list = Array.isArray(trees) ? trees : [];
  const collectionId = String(args?.collectionId || "").trim();
  const folderId = String(args?.folderId || "").trim() || "root";
  const requestName = (args?.requestName || "").trim() || "Imported Request";
  const requestPayload = args?.requestPayload;

  if (!collectionId) return null;

  const next = clone(list);
  const col = next.find((t) => t.id === collectionId);
  if (!col) return null;

  // canonical root
  if (!col.root || typeof col.root !== "object") col.root = makeRootFolder();

  const folderHit =
    folderId === "root" ? { node: col.root, parent: null } : findNodeDFS(col.root, folderId);

  if (!folderHit || !folderHit.node || nodeKind(folderHit.node) !== "folder") return null;

  ensureFolderChildren(folderHit.node);

  const key = requestName.toLowerCase();

  const existingIndex = (folderHit.node.children || []).findIndex(
    (c) => c && nodeKind(c) === "request" && (c.name || "").trim().toLowerCase() === key
  );

  const normalizedReq = normalizeRequestPayload(requestPayload, requestName);
  normalizedReq.name = requestName;

  if (existingIndex >= 0) {
    const existing = folderHit.node.children[existingIndex];
    folderHit.node.children[existingIndex] = {
      ...existing,
      type: "request",
      kind: "request",
      name: requestName,
      request: normalizedReq,
      updatedAt: nowISO(),
    };
  } else {
    folderHit.node.children.push({
      id: uuid("req"),
      type: "request",
      kind: "request",
      name: requestName,
      request: normalizedReq,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
  }

  touchFolder(folderHit.node);
  if (folderHit.parent) touchFolder(folderHit.parent);

  col.updatedAt = nowISO();
  saveCollectionTrees(next);
  return next;
}
