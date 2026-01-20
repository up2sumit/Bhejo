const HISTORY_KEY = "bhejo_history_v1";
const HISTORY_LIMIT = 20;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

export function addToHistory(item) {
  const history = loadHistory();
  const fingerprint = makeFingerprint(item);
  const filtered = history.filter((h) => makeFingerprint(h) !== fingerprint);
  const updated = [item, ...filtered].slice(0, HISTORY_LIMIT);
  saveHistory(updated);
  return updated;
}

function makeFingerprint(item) {
  return JSON.stringify({
    method: item.method,
    url: item.url,
    params: item.params,
    headers: item.headers,
    body: item.body,
    auth: item.auth,
  });
}
