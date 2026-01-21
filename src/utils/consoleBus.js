const KEY = "bhejo_console_events_v1";
const MAX = 200;

function safeParse(raw, fallback) {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadConsoleEvents() {
  const list = safeParse(localStorage.getItem(KEY), []);
  return Array.isArray(list) ? list : [];
}

export function clearConsoleEvents() {
  localStorage.setItem(KEY, JSON.stringify([]));
}

export function pushConsoleEvent(evt) {
  const list = loadConsoleEvents();

  const item = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `ce_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    level: evt.level || "info", // info | warn | error
    type: evt.type || "log", // request | response | error | log
    data: evt.data ?? null,
  };

  const updated = [item, ...list].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(updated));

  // return updated for in-app usage if needed
  return updated;
}
