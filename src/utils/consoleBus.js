const KEY = "bhejo_console_events_v1";
const KEY_SEQ = "bhejo_console_events_seq_v1";
const MAX = 200;
const DEDUPE_WINDOW = 80; // only scan the most recent N events for duplicates

function safeParse(raw, fallback) {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function stableStringify(value) {
  // stable-ish stringify for fingerprints (sort object keys)
  const seen = new WeakSet();
  const helper = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);

    if (Array.isArray(v)) return v.map(helper);

    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = helper(v[k]);
    return out;
  };

  try {
    return JSON.stringify(helper(value));
  } catch {
    try {
      return JSON.stringify(String(value));
    } catch {
      return "";
    }
  }
}

function hashString(str) {
  // fast, small hash (FNV-1a 32-bit)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function nextSeq() {
  const cur = Number(safeParse(localStorage.getItem(KEY_SEQ), 0)) || 0;
  const next = cur + 1;
  localStorage.setItem(KEY_SEQ, JSON.stringify(next));
  return next;
}

export function loadConsoleEvents() {
  const list = safeParse(localStorage.getItem(KEY), []);
  return Array.isArray(list) ? list : [];
}

export function clearConsoleEvents() {
  localStorage.setItem(KEY, JSON.stringify([]));
  localStorage.setItem(KEY_SEQ, JSON.stringify(0));
}

function computeFingerprint(evt) {
  const d = evt?.data || {};
  // Keep this minimal: enough to detect duplicates, but not so detailed that harmless diffs prevent dedupe
  const base = {
    traceId: d.traceId || null,
    type: evt.type || "log",
    level: evt.level || "info",
    source: d.source || null,
    name: d.name || null,
    method: d.method || null,
    finalUrl: d.finalUrl || null,
    status: d.status ?? null,
    message: d.message || null,
    at: d.at || null,
  };
  return hashString(stableStringify(base));
}

export function pushConsoleEvent(evt) {
  const list = loadConsoleEvents();

  const item = {
    id:
      evt.id ||
      globalThis.crypto?.randomUUID?.() ||
      `ce_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    seq: evt.seq || nextSeq(),
    ts: evt.ts || new Date().toISOString(),
    level: evt.level || "info", // info | warn | error
    type: evt.type || "log", // request | response | error | log | ...
    data: evt.data ?? null,
  };

  // De-dupe protection:
  // - Prefer explicit fingerprint if provided, else compute from key fields.
  // - Skip if we've seen the same fingerprint recently.
  const fp = evt.fingerprint || computeFingerprint(item);
  item.fingerprint = fp;

  const recent = list.slice(0, DEDUPE_WINDOW);
  if (recent.some((x) => x && x.fingerprint === fp)) {
    return list; // no-op
  }

  const updated = [item, ...list].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(updated));

  return updated;
}
