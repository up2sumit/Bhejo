import { loadSaved, saveSaved, loadEnvVars, saveEnvVars } from "./storage";

// Export only what's important for portability
export function exportWorkspace() {
  const data = {
    version: "bhejo-workspace-v1",
    exportedAt: new Date().toISOString(),
    saved: loadSaved(),
    envVarsAll: loadEnvVars(),
  };

  return JSON.stringify(data, null, 2);
}

export function importWorkspace(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON file.");
  }

  if (!parsed || parsed.version !== "bhejo-workspace-v1") {
    throw new Error("Unsupported backup format/version.");
  }

  if (Array.isArray(parsed.saved)) saveSaved(parsed.saved);
  if (parsed.envVarsAll && typeof parsed.envVarsAll === "object") saveEnvVars(parsed.envVarsAll);

  return {
    savedCount: Array.isArray(parsed.saved) ? parsed.saved.length : 0,
    envCount: parsed.envVarsAll ? Object.keys(parsed.envVarsAll).length : 0,
  };
}
