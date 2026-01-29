// server/index.js  (Phase 9b: Zero-dependency proxy server - "no feature loss" vs Express version)
// Uses ONLY Node built-ins + global fetch. No express/cors install needed.
//
// ✅ Matches the Express proxy contract used by RequestBuilder:
//   - POST /proxy accepts: { url, method, headers, body, timeoutMs, isMultipart, multipartParts, cookieJarEnabled, cookieJarId, cookieJar }
//   - Responds: { ok, status, statusText, headers, body, setCookie, jarId }
// ✅ Includes cookie jar debug endpoints like the Express server:
//   - GET  /cookiejar?jarId=default
//   - POST /cookiejar/clear { jarId }
// ✅ Multipart (form-data) support from multipartParts (text + file base64), same as Express server
//
// Notes:
// - This is for local/dev tooling. Keep ALLOWED_HOSTS strict.

import http from "node:http";
import { URL } from "node:url";
import { getJar, clearJar, markDirty } from "./cookieJarStore.js";

const PORT = 3001;

// --- IMPORTANT SECURITY ---
// Add domains you allow here (edit this list)
const ALLOWED_HOSTS = new Set([
  "jsonplaceholder.typicode.com",
  "library-management-api-i6if.onrender.com",
]);

// Allow both common Vite dev ports
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25mb

function corsHeaders(origin) {
  // allow curl/postman/no-origin
  const allow = !origin ? "*" : (ALLOWED_ORIGINS.has(origin) ? origin : "");
  const h = {
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Trace-Id",
    "Access-Control-Max-Age": "86400",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

function json(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function text(res, status, body, extraHeaders = {}) {
  const b = String(body ?? "");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(b),
    ...extraHeaders,
  });
  res.end(b);
}

async function readBody(req, maxBytes = MAX_BYTES) {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isAllowedTarget(targetUrl) {
  try {
    const u = new URL(targetUrl);
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function sanitizeIncomingHeaders(headers, { isMultipart } = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();

    // Block hop-by-hop and unsafe headers
    if (["host", "connection", "content-length", "accept-encoding", "referer", "origin"].includes(key)) continue;

    // multipart boundary must be set by us
    if (isMultipart && key === "content-type") continue;

    clean[k] = v;
  }
  return clean;
}

function sanitizeOutgoingHeaders(headers) {
  const clean = {};
  for (const [k, v] of headers.entries()) {
    const key = String(k).toLowerCase();
    if (["content-encoding", "transfer-encoding"].includes(key)) continue;
    clean[key] = v;
  }
  return clean;
}

function decodeBase64ToUint8(base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  return new Uint8Array(buf);
}

/* =========================
   Cookie matching helpers (ported from your Express server)
   ========================= */
function nowMs() { return Date.now(); }

function defaultCookiePath(pathname) {
  if (!pathname || !pathname.startsWith("/")) return "/";
  if (pathname === "/") return "/";
  const idx = pathname.lastIndexOf("/");
  if (idx <= 0) return "/";
  return pathname.slice(0, idx) || "/";
}

function isExpired(cookie) {
  return cookie.expiresAt !== null && nowMs() > cookie.expiresAt;
}

function domainMatches(cookieDomain, host) {
  const cd = String(cookieDomain || "").toLowerCase();
  const h = String(host || "").toLowerCase();
  if (!cd || !h) return false;
  if (cd === h) return true;
  return h.endsWith("." + cd);
}

function pathMatches(cookiePath, reqPath) {
  const cp = String(cookiePath || "/");
  const rp = String(reqPath || "/");
  if (cp === "/") return true;
  if (!rp.startsWith(cp)) return false;
  // If exact match or next char is /
  if (rp.length === cp.length) return true;
  return rp.charAt(cp.length) === "/";
}

function parseSetCookie(setCookieStr, url) {
  // Basic Set-Cookie parsing sufficient for Postman-like persistence
  const parts = String(setCookieStr || "").split(";").map((s) => s.trim()).filter(Boolean);
  const first = parts.shift() || "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;

  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();

  const u = new URL(url);
  const host = u.hostname;
  const path = u.pathname || "/";

  const cookie = {
    name,
    value,
    domain: host,
    path: defaultCookiePath(path),
    hostOnly: true,
    secure: u.protocol === "https:",
    httpOnly: false,
    sameSite: null,
    expiresAt: null,
  };

  for (const p of parts) {
    const [kRaw, ...rest] = p.split("=");
    const k = String(kRaw || "").toLowerCase();
    const v = rest.join("=").trim();

    if (k === "domain" && v) {
      cookie.domain = v.replace(/^\./, "");
      cookie.hostOnly = false;
    } else if (k === "path" && v) {
      cookie.path = v;
    } else if (k === "secure") {
      cookie.secure = true;
    } else if (k === "httponly") {
      cookie.httpOnly = true;
    } else if (k === "samesite" && v) {
      cookie.sameSite = v;
    } else if (k === "max-age" && v) {
      const sec = Number(v);
      if (!Number.isNaN(sec)) cookie.expiresAt = nowMs() + sec * 1000;
    } else if (k === "expires" && v) {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) cookie.expiresAt = ms;
    }
  }

  return cookie;
}

function upsertCookie(jar, hostname, cookie) {
  const hostKey = String(hostname || "").toLowerCase();
  const list = jar.get(hostKey) || [];

  // Replace if same name+domain+path
  const out = [];
  let replaced = false;
  for (const c of list) {
    if (!c) continue;
    if (
      c.name === cookie.name &&
      String(c.domain).toLowerCase() === String(cookie.domain).toLowerCase() &&
      String(c.path || "/") === String(cookie.path || "/")
    ) {
      out.push(cookie);
      replaced = true;
    } else {
      out.push(c);
    }
  }
  if (!replaced) out.push(cookie);
  jar.set(hostKey, out);
}

function buildCookieHeader(jar, url) {
  if (!jar) return "";
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  const isHttps = u.protocol === "https:";

  const allCookies = [];
  for (const [, list] of jar.entries()) {
    if (Array.isArray(list)) allCookies.push(...list);
  }

  const candidates = allCookies.filter((c) => {
    if (!c || isExpired(c)) return false;
    if (c.secure && !isHttps) return false;

    if (c.hostOnly) {
      if (String(c.domain).toLowerCase() !== host) return false;
    } else {
      if (!domainMatches(c.domain, host)) return false;
    }

    if (!pathMatches(c.path, path)) return false;
    return true;
  });

  if (!candidates.length) return "";

  // Most specific path wins
  candidates.sort((a, b) => (String(b.path || "").length - String(a.path || "").length));

  const seen = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    pairs.push(`${c.name}=${c.value}`);
  }

  return pairs.join("; ");
}

function getSetCookiesFromFetchResponse(res) {
  // Node/undici fetch supports headers.getSetCookie()
  try {
    if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie() || [];
  } catch {
    // ignore
  }
  const sc = res.headers.get("set-cookie");
  return sc ? [sc] : [];
}

/* =========================
   Multipart builder (no FormData needed)
   ========================= */
function buildMultipartBody(multipartParts) {
  const boundary = "----bhejo_" + Math.random().toString(16).slice(2);
  const chunks = [];

  for (const p of multipartParts || []) {
    const name = String(p?.name || "").trim();
    if (!name) continue;

    const kind = String(p?.kind || "text").toLowerCase();

    chunks.push(Buffer.from(`--${boundary}\r\n`, "utf-8"));

    if (kind === "file") {
      const filename = String(p?.filename || "file");
      const mime = String(p?.mime || "application/octet-stream");
      const base64 = p?.base64 || "";
      const bytes = Buffer.from(decodeBase64ToUint8(base64));

      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeQuotes(name)}"; filename="${escapeQuotes(filename)}"\r\n` +
          `Content-Type: ${mime}\r\n\r\n`,
          "utf-8"
        )
      );
      chunks.push(bytes);
      chunks.push(Buffer.from("\r\n", "utf-8"));
    } else {
      const value = String(p?.value ?? "");
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${escapeQuotes(name)}"\r\n\r\n${value}\r\n`,
          "utf-8"
        )
      );
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function escapeQuotes(s) {
  return String(s).replace(/"/g, "%22");
}

/* =========================
   Cookie jar debug endpoints (same idea as Express version)
   ========================= */
async function handleGetCookieJar(req, res, ch) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const jarId = String(url.searchParams.get("jarId") || "default");
  const jar = await getJar(jarId);

  // Flatten for UI/debug: include all fields
  const out = [];
  for (const [host, list] of jar.entries()) {
    for (const c of list || []) {
      if (!c || isExpired(c)) continue;
      out.push({
        host,
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expiresAt: c.expiresAt,
      });
    }
  }

  json(res, 200, { jarId, count: out.length, cookies: out }, ch);
}

async function handleClearCookieJar(req, res, ch, payload) {
  const jarId = String(payload?.jarId || "default");
  await clearJar(jarId);
  json(res, 200, { ok: true, jarId }, ch);
}

/* =========================
   Main proxy
   ========================= */
async function handleProxy(req, res, ch, payload) {
  const {
    url,
    method,
    headers,
    body,
    timeoutMs,
    isMultipart,
    multipartParts,

    cookieJarEnabled,
    cookieJarId,
    cookieJar, // optional: { enabled, jarId }
  } = payload || {};

  if (!url || !method) {
    json(res, 400, { error: "Missing url or method" }, ch);
    return;
  }

  if (!isAllowedTarget(url)) {
    json(res, 403, { error: "Target host not allowed", allowed: Array.from(ALLOWED_HOSTS) }, ch);
    return;
  }

  const m = String(method).toUpperCase();

  // Cookie jar inputs (same logic)
  const jarEnabled =
    cookieJarEnabled !== undefined
      ? !!cookieJarEnabled
      : cookieJar?.enabled !== undefined
        ? !!cookieJar.enabled
        : true;

  const jarId = cookieJarId || cookieJar?.jarId || "default";
  const jar = jarEnabled ? await getJar(jarId) : null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Number(timeoutMs || 30000));

  try {
    const useMultipart = !!isMultipart && Array.isArray(multipartParts) && multipartParts.length > 0;

    // Build outgoing headers
    let outHeaders = sanitizeIncomingHeaders(headers, { isMultipart: useMultipart });

    // If cookie jar enabled and caller didn't send Cookie explicitly, add Cookie header
    const hasCookieHeader = Object.keys(outHeaders).some((k) => k.toLowerCase() === "cookie");
    if (jar && !hasCookieHeader) {
      const cookieHeader = buildCookieHeader(jar, url);
      if (cookieHeader) outHeaders = { ...outHeaders, Cookie: cookieHeader };
    }

    let requestBody = undefined;

    if (useMultipart) {
      if (m === "GET" || m === "HEAD") {
        json(res, 400, { error: "Multipart body not allowed for GET/HEAD" }, ch);
        return;
      }
      const mp = buildMultipartBody(multipartParts);
      requestBody = mp.body;
      outHeaders = { ...outHeaders, "Content-Type": mp.contentType };
    } else {
      if (!["GET", "HEAD"].includes(m) && body !== undefined && body !== null && body !== "") {
        requestBody = body;
      }
    }

    const options = {
      method: m,
      headers: outHeaders,
      signal: controller.signal,
      body: requestBody,
      redirect: "follow",
    };

    const upstream = await fetch(url, options);

    // Capture Set-Cookie into jar and persist
    const setCookies = getSetCookiesFromFetchResponse(upstream);
    if (jar && setCookies.length) {
      const hostname = new URL(url).hostname;
      for (const sc of setCookies) {
        const ck = parseSetCookie(sc, url);
        if (ck) upsertCookie(jar, hostname, ck);
      }
      markDirty(jarId); // debounce flush to disk
    }

    const raw = await upstream.text();
    const outHeadersResp = sanitizeOutgoingHeaders(upstream.headers);

    json(res, 200, {
      ok: upstream.ok,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeadersResp,
      body: raw,
      setCookie: setCookies,
      jarId: jarEnabled ? jarId : null,
    }, ch);
  } catch (e) {
    json(res, 500, {
      error: "Proxy request failed",
      message: e?.message || String(e),
    }, ch);
  } finally {
    clearTimeout(t);
  }
}

/* =========================
   Server
   ========================= */
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  const ch = corsHeaders(origin);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, ch);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Basic origin allowlist for browser requests
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    json(res, 403, { error: "Origin not allowed", origin }, ch);
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    text(res, 200, "Bhejo proxy is running. Use POST /proxy", ch);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, name: "bhejo-proxy", port: PORT }, ch);
    return;
  }

  if (req.method === "GET" && url.pathname === "/cookiejar") {
    await handleGetCookieJar(req, res, ch);
    return;
  }

  if (req.method === "POST" && url.pathname === "/cookiejar/clear") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw.toString("utf-8") || "{}");
      await handleClearCookieJar(req, res, ch, payload);
    } catch {
      json(res, 400, { error: "Invalid JSON" }, ch);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/proxy") {
    try {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf-8") || "{}");
      } catch {
        json(res, 400, { error: "Invalid JSON" }, ch);
        return;
      }
      await handleProxy(req, res, ch, payload);
    } catch (e) {
      json(res, 413, { error: e?.message || "Payload too large" }, ch);
    }
    return;
  }

  text(res, 404, "Not Found", ch);
});

server.listen(PORT, () => {
  console.log(`Bhejo proxy running on http://localhost:${PORT}`);
  console.log("Allowed hosts:", Array.from(ALLOWED_HOSTS));
  console.log("Allowed origins:", Array.from(ALLOWED_ORIGINS));
  console.log("Cookie jar persistence:", "server/.data/cookiejars/<jarId>.json");
});
