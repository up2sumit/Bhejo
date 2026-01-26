// src/utils/auth.js
// Shared auth helpers used by UI + runner.
// Keeps behavior identical to the Auth tab, but makes Basic auth safe for unicode.

export function base64Safe(str) {
  try {
    return btoa(str);
  } catch {
    // fallback for unicode
    return btoa(unescape(encodeURIComponent(str)));
  }
}

export function applyAuthToHeaders(auth, headerObj) {
  const out = headerObj && typeof headerObj === "object" ? { ...headerObj } : {};
  const a = auth && typeof auth === "object" ? auth : { type: "none" };

  const hasAuthHeader = Object.keys(out).some((k) => k.toLowerCase() === "authorization");

  // If user already set Authorization manually, don't override.
  if (hasAuthHeader && a.type !== "apikey") return out;

  if (a.type === "bearer" && a.bearer?.trim()) {
    return { ...out, Authorization: `Bearer ${a.bearer.trim()}` };
  }

  if (a.type === "basic" && (a.username || a.password)) {
    const token = base64Safe(`${a.username || ""}:${a.password || ""}`);
    return { ...out, Authorization: `Basic ${token}` };
  }

  if (a.type === "apikey" && a.apiKeyName?.trim()) {
    return { ...out, [a.apiKeyName.trim()]: a.apiKeyValue ?? "" };
  }

  return out;
}
