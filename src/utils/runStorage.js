const RUNS_KEY = "bhejo_run_history_v1";
const RUNS_LIMIT = 30;

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `run_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

export function loadRuns() {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs) {
  const clean = Array.isArray(runs) ? runs : [];
  localStorage.setItem(RUNS_KEY, JSON.stringify(clean.slice(0, RUNS_LIMIT)));
}

export function addRun(run) {
  const runs = loadRuns();

  const normalized = {
    id: run.id || uuid(),
    createdAt: run.createdAt || new Date().toISOString(),
    envName: run.envName || "dev",
    summary: run.summary || { total: 0, ok: 0, passedAll: 0, failedAny: 0 },
    results: Array.isArray(run.results) ? run.results : [],
  };

  const updated = [normalized, ...runs].slice(0, RUNS_LIMIT);
  saveRuns(updated);
  return updated;
}

export function deleteRun(id) {
  const runs = loadRuns();
  const updated = runs.filter((r) => r.id !== id);
  saveRuns(updated);
  return updated;
}

export function clearRuns() {
  saveRuns([]);
  return [];
}
