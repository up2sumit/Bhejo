// src/utils/backup.js
// Phase 3.5: export/import workspace including collection trees (v2), still supports v1 import.

import {
  loadEnvVars,
  loadCurrentEnv,
  saveEnvVars,
  saveCurrentEnv,
  loadCollectionTrees,
  saveCollectionTrees,
  loadSaved,
  saveSaved,
  loadCollections,
  saveCollections,
} from "./storage";

const WORKSPACE_V2 = "bhejo-workspace-v2";
const WORKSPACE_V1 = "bhejo-workspace-v1";

export function exportWorkspace() {
  const data = {
    version: WORKSPACE_V2,
    exportedAt: new Date().toISOString(),
    env: {
      current: loadCurrentEnv(),
      vars: loadEnvVars(),
    },
    collectionsTree: loadCollectionTrees(),
    // keep legacy too (optional, helps backward compatibility)
    legacy: {
      collections: loadCollections(),
      saved: loadSaved(),
    },
  };

  return data;
}

export function importWorkspace(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid workspace file");

  // V2
  if (data.version === WORKSPACE_V2) {
    if (data.env?.vars) saveEnvVars(data.env.vars);
    if (data.env?.current) saveCurrentEnv(data.env.current);
    if (Array.isArray(data.collectionsTree)) saveCollectionTrees(data.collectionsTree);

    // legacy optional
    if (Array.isArray(data.legacy?.collections)) saveCollections(data.legacy.collections);
    if (Array.isArray(data.legacy?.saved)) saveSaved(data.legacy.saved);

    return { ok: true, version: WORKSPACE_V2 };
  }

  // V1 (older export): {version:"bhejo-workspace-v1", saved, envVars}
  if (data.version === WORKSPACE_V1) {
    if (data.envVars) saveEnvVars(data.envVars);
    if (data.currentEnv) saveCurrentEnv(data.currentEnv);
    if (Array.isArray(data.saved)) saveSaved(data.saved);
    if (Array.isArray(data.collections)) saveCollections(data.collections);

    // trees will auto-migrate on next load via loadCollectionTrees()
    return { ok: true, version: WORKSPACE_V1 };
  }

  // Fallback: try to interpret
  if (data.envVars || data.saved || data.collectionsTree) {
    if (data.envVars) saveEnvVars(data.envVars);
    if (data.currentEnv) saveCurrentEnv(data.currentEnv);
    if (Array.isArray(data.collectionsTree)) saveCollectionTrees(data.collectionsTree);
    if (Array.isArray(data.saved)) saveSaved(data.saved);
    if (Array.isArray(data.collections)) saveCollections(data.collections);
    return { ok: true, version: "unknown" };
  }

  throw new Error("Unsupported workspace file version");
}
