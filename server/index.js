import express from "express";
import cors from "cors";
import { getJar, clearJar, markDirty } from "./cookieJarStore.js";

const app = express();
const PORT = 3001;

// --- IMPORTANT SECURITY ---
// Add domains you allow here (edit this list)
const ALLOWED_HOSTS = new Set([
  "jsonplaceholder.typicode.com",
  "library-management-api-i6if.onrender.com",
]);

// Allow both common Vite dev ports (your Vite is 3000 in vite.config.js)
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
]);

// Payload size: multipart uploads via proxy are base64 in JSON (bigger than raw file)
app.use(express.json({ limit: "35mb" }));
app.use(express.text({ type: "*/*", limit: "35mb" }));

app.use(
  cors({
    origin: (origin, cb) => {
      // allow curl/postman/no-origin
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
  })
);

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
    if (
      ["host", "connection", "content-length", "accept-encoding", "referer", "origin"].includes(key)
    )
      continue;

    // multipart boundary must be set by fetch/FormData
    if (isMultipart && key === "content-type") continue;

    clean[k] = v;
  }
  return clean;
}

function sanitizeOutgoingHeaders(headers) {
  const clean = {};
  for (const [k, v] of headers.entries()) {
    const key = String(k).toLowerCase();
    // Remove headers that can cause browser issues
    if (["content-encoding", "transfer-encoding"].includes(key)) continue;
    clean[key] = v;
  }
  return clean;
}


function isTextLikeContentType(ct) {
  const t = String(ct || "").toLowerCase();
  if (!t) return true; // unknown -> treat as text to avoid base64 bloat
  if (t.startsWith("text/")) return true;
  if (t.includes("json")) return true;
  if (t.includes("xml")) return true;
  if (t.includes("javascript")) return true;
  if (t.includes("x-www-form-urlencoded")) return true;
  if (t.includes("graphql")) return true;
  return false;
}

function getFilenameFromContentDisposition(cd) {
  const s = String(cd || "");
  if (!s) return "";
  // filename*=UTF-8''... or filename="..."
  let m = s.match(/filename\*=UTF-8''([^;]+)/i);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch { return m[1].trim(); }
  }
  m = s.match(/filename=([^;]+)/i);
  if (m && m[1]) return m[1].trim().replace(/^"|"$/g, "");
  return "";
}

function decodeBase64ToUint8(base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  return new Uint8Array(buf);
}

/* =========================
   Cookie matching helpers
   ========================= */
function nowMs() {
  return Date.now();
}

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
  const cp = cookiePath || "/";
  const rp = reqPath || "/";
  if (rp === cp) return true;
  if (rp.startsWith(cp)) {
    if (cp.endsWith("/")) return true;
    const nextChar = rp.charAt(cp.length);
    return nextChar === "/" || nextChar === "" || nextChar === "?";
  }
  return false;
}

function parseSetCookie(setCookieStr, requestUrl) {
  const u = new URL(requestUrl);
  const parts = String(setCookieStr || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf("=");
  if (eq <= 0) return null;

  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1);

  const cookie = {
    name,
    value,
    domain: u.hostname, // default host-only
    hostOnly: true,
    path: defaultCookiePath(u.pathname),
    expiresAt: null, // ms
    secure: false,
    httpOnly: false,
    sameSite: "",
  };

  for (const a of attrs) {
    const [k0, ...rest] = a.split("=");
    const k = String(k0 || "").trim().toLowerCase();
    const v = rest.join("=").trim();

    if (k === "domain" && v) {
      cookie.domain = v.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
    } else if (k === "path" && v) {
      cookie.path = v.startsWith("/") ? v : `/${v}`;
    } else if (k === "max-age" && v) {
      const secs = Number(v);
      if (!Number.isNaN(secs)) cookie.expiresAt = nowMs() + secs * 1000;
    } else if (k === "expires" && v) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) cookie.expiresAt = t;
    } else if (k === "secure") {
      cookie.secure = true;
    } else if (k === "httponly") {
      cookie.httpOnly = true;
    } else if (k === "samesite" && v) {
      cookie.sameSite = v;
    }
  }

  return cookie;
}

function upsertCookie(jar, hostname, cookie) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return;

  if (!jar.has(host)) jar.set(host, []);
  const list = jar.get(host);

  // Remove expired cookies first
  const kept = (list || []).filter((c) => c && !isExpired(c));

  // If expires in past => delete cookie
  if (cookie.expiresAt !== null && cookie.expiresAt <= nowMs()) {
    jar.set(
      host,
      kept.filter((c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path))
    );
    return;
  }

  const next = kept.filter((c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
  next.push(cookie);
  jar.set(host, next);
}


function resolveCookiesForUrl(jar, requestUrl, options = {}) {
  const u = new URL(requestUrl);
  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  const isHttps = u.protocol === "https:";

  const siteOrigin = options.siteOrigin ? String(options.siteOrigin) : "";
  let siteHost = "";
  try {
    siteHost = siteOrigin ? new URL(siteOrigin).hostname.toLowerCase() : "";
  } catch {
    siteHost = "";
  }
  const isCrossSite = !!(siteHost && siteHost !== host);

  const manualCookieHeader = options.manualCookieHeader ? String(options.manualCookieHeader) : "";

  const allCookies = [];
  for (const [, list] of jar.entries()) {
    if (Array.isArray(list)) allCookies.push(...list);
  }

  const sentCandidates = [];
  const excluded = [];

  const normalizeSameSite = (v) => String(v || "").toLowerCase(); // "lax" | "strict" | "none" | ""
  const effectiveSameSite = (c) => {
    const ss = normalizeSameSite(c.sameSite);
    // Modern browsers default to Lax when unspecified; Postman-like debug is more useful with that assumption.
    return ss || "lax";
  };

  for (const c of allCookies) {
    if (!c) continue;

    const base = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      hostOnly: !!c.hostOnly,
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite || "",
      expiresAt: c.expiresAt ?? null,
    };

    const reasons = [];
    const notes = [];

    // Notes (not blockers)
    if (c.httpOnly) notes.push("HttpOnly: not accessible to scripts");

    // Expiry
    if (isExpired(c)) {
      reasons.push("Expired");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    // Secure over http
    if (c.secure && !isHttps) {
      reasons.push("Secure cookie over HTTP");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    // SameSite=None requires Secure
    const ssEff = effectiveSameSite(c); // lax/strict/none
    if (ssEff === "none" && !c.secure) {
      reasons.push("SameSite=None requires Secure");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    // SameSite cross-site blocking (XHR/fetch)
    if (isCrossSite) {
      if (ssEff === "strict") {
        reasons.push("SameSite=Strict blocks cross-site requests");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
      if (ssEff === "lax") {
        reasons.push("SameSite=Lax blocks cross-site XHR/fetch");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
      // none => allowed (if secure requirement satisfied)
    }

    // domain match
    if (c.hostOnly) {
      if (String(c.domain).toLowerCase() !== host) {
        reasons.push("Host-only domain mismatch");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
    } else {
      if (!domainMatches(c.domain, host)) {
        reasons.push("Domain mismatch");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
    }

    // path match
    if (!pathMatches(c.path, path)) {
      reasons.push("Path mismatch");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    // Candidate to send
    sentCandidates.push({ c, base, notes, ssEff });
  }

  // Most specific path wins for sent candidates
  sentCandidates.sort((a, b) => (b.c.path || "").length - (a.c.path || "").length);

  const seen = new Set();
  const sentCookies = [];
  const pairs = [];

  for (const item of sentCandidates) {
    const c = item.c;
    const base = item.base;
    const notes = item.notes;

    if (seen.has(c.name)) {
      excluded.push({
        ...base,
        reasons: ["Overridden by a more specific cookie with the same name"],
        notes,
      });
      continue;
    }
    seen.add(c.name);

    const whyParts = [];
    if (c.hostOnly) whyParts.push("Host-only match");
    else whyParts.push("Domain match");
    whyParts.push(`Path match (${c.path || "/"})`);
    whyParts.push(c.secure ? "Secure" : "Not secure");
    whyParts.push(`SameSite=${String(c.sameSite || "default(Lax)")}`);

    sentCookies.push({
      ...base,
      whyParts,
      notes,
    });

    pairs.push(`${c.name}=${c.value}`);
  }

  const header = pairs.join("; ");

  // Manual Cookie header overrides jar cookies (debug explains why)
  if (manualCookieHeader) {
    const overridden = sentCookies.map((c) => ({
      ...c,
      reasons: ["Overridden by manual Cookie header"],
      notes: c.notes || [],
    }));
    const excl = excluded.map((c) => ({
      ...c,
      reasons: Array.isArray(c.reasons) && c.reasons.length
        ? [...c.reasons, "Manual Cookie header present"]
        : ["Manual Cookie header present"],
    }));

    return {
      host,
      path,
      isHttps,
      isCrossSite,
      siteOrigin: siteOrigin || "",
      header: manualCookieHeader,
      count: manualCookieHeader.split(";").map((x) => x.trim()).filter(Boolean).length,
      cookiesSent: [],
      cookiesExcluded: [...overridden, ...excl],
      manualOverride: true,
    };
  }

  return {
    host,
    path,
    isHttps,
    isCrossSite,
    siteOrigin: siteOrigin || "",
    header,
    count: sentCookies.length,
    cookiesSent: sentCookies,
    cookiesExcluded: excluded,
    manualOverride: false,
  };
}




function buildCookieHeader(jar, requestUrl) {
  const resolved = resolveCookiesForUrl(jar, requestUrl);
  return resolved.header || "";
}

function getSetCookiesFromFetchResponse(res) {
  // undici fetch in Node exposes headers.getSetCookie()
  try {
    if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie() || [];
  } catch {
    // ignore
  }
  const sc = res.headers.get("set-cookie");
  return sc ? [sc] : [];
}

/* =========================
   Cookie jar debug endpoints
   ========================= */
app.get("/cookiejar", async (req, res) => {
  const jarId = String(req.query.jarId || "default");
  const jar = await getJar(jarId);

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

  res.json({ jarId, count: out.length, cookies: out });
});

app.get("/cookiejar/resolve", async (req, res) => {
  try {
    const jarId = String(req.query?.jarId || "default");
    const url = String(req.query?.url || "");
    if (!url) return res.status(400).json({ error: "Missing url" });
    if (!isAllowedTarget(url)) {
      return res.status(403).json({ error: "Target host not allowed", allowed: Array.from(ALLOWED_HOSTS) });
    }
    const jar = await getJar(jarId);
    const siteOrigin = String(req.query?.siteOrigin || "");
    const resolved = resolveCookiesForUrl(jar, url, { siteOrigin });
    res.json({
      ok: true,
      jarId,
      url,
      host: resolved.host,
      path: resolved.path,
      isHttps: resolved.isHttps,
      header: resolved.header,
      count: resolved.count,
      cookies: resolved.cookiesSent || [],
      cookiesSent: resolved.cookiesSent || [],
      cookiesExcluded: resolved.cookiesExcluded || [],
      manualOverride: !!resolved.manualOverride,
      siteOrigin: resolved.siteOrigin || "",
      isCrossSite: !!resolved.isCrossSite,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to resolve cookies", message: e?.message || String(e) });
  }
});


app.post("/cookiejar/clear", async (req, res) => {
  const jarId = String(req.body?.jarId || "default");
  await clearJar(jarId);
  res.json({ ok: true, jarId });
});

/* =========================
   Main proxy
   ========================= */
app.post("/proxy", async (req, res) => {
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
  } = req.body || {};

  if (!url || !method) {
    return res.status(400).json({ error: "Missing url or method" });
  }

  if (!isAllowedTarget(url)) {
    return res.status(403).json({
      error: "Target host not allowed",
      allowed: Array.from(ALLOWED_HOSTS),
    });
  }

  const m = String(method).toUpperCase();

  // Cookie jar inputs
  const jarEnabled =
    cookieJarEnabled !== undefined
      ? !!cookieJarEnabled
      : cookieJar?.enabled !== undefined
        ? !!cookieJar.enabled
        : true;

  const jarId =
    cookieJarId || cookieJar?.jarId || "default";

  const jar = jarEnabled ? await getJar(jarId) : null;

  // Cookie debug (Postman-like)
  let cookieSentHeader = "";
  let cookieSentFrom = jarEnabled ? "jar-empty" : "disabled";
  let cookieSentCount = 0;
  let cookieSentCookies = [];
  let cookieExcludedCookies = [];


  // Abort / timeout
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Number(timeoutMs || 30000));

  try {
    const useMultipart = !!isMultipart && Array.isArray(multipartParts) && multipartParts.length > 0;

    // Build outgoing headers
    let outHeaders = sanitizeIncomingHeaders(headers, { isMultipart: useMultipart });

    // If cookie jar enabled and caller didn't send Cookie explicitly, add Cookie header
    const hasCookieHeader = Object.keys(outHeaders).some((k) => k.toLowerCase() === "cookie");

    if (hasCookieHeader) {
      cookieSentFrom = "manual";
      cookieSentHeader = String(outHeaders.Cookie || outHeaders.cookie || "");
      if (jar) {
        const resolvedManual = resolveCookiesForUrl(jar, url, { manualCookieHeader: cookieSentHeader, siteOrigin });
        cookieSentCount = resolvedManual.count || 0;
        cookieExcludedCookies = resolvedManual.cookiesExcluded || [];
      }
    } else if (jar) {
      const siteOrigin = String(req.query?.siteOrigin || "");
    const resolved = resolveCookiesForUrl(jar, url, { siteOrigin });
      cookieSentHeader = resolved.header || "";
      cookieSentCount = resolved.count || 0;
      cookieSentCookies = resolved.cookiesSent || [];
      cookieExcludedCookies = resolved.cookiesExcluded || [];
      cookieSentFrom = cookieSentHeader ? "jar" : "jar-empty";
      if (cookieSentHeader) outHeaders = { ...outHeaders, Cookie: cookieSentHeader };
    }

    let requestBody = undefined;

    if (useMultipart) {
      if (m === "GET" || m === "HEAD") {
        return res.status(400).json({ error: "Multipart body not allowed for GET/HEAD" });
      }

      const fd = new FormData();

      for (const p of multipartParts) {
        const name = String(p?.name || "").trim();
        if (!name) continue;

        const kind = String(p?.kind || "text").toLowerCase();

        if (kind === "file") {
          const filename = p?.filename || "file";
          const mime = p?.mime || "application/octet-stream";
          const base64 = p?.base64 || "";
          const bytes = decodeBase64ToUint8(base64);
          const blob = new Blob([bytes], { type: mime });
          fd.append(name, blob, filename);
        } else {
          fd.append(name, String(p?.value ?? ""));
        }
      }

      requestBody = fd;
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

      // debounce flush to disk
      markDirty(jarId);
    }

    const outHeadersResp = sanitizeOutgoingHeaders(upstream.headers);

    const ct = upstream.headers.get("content-type") || outHeadersResp["content-type"] || "";
    const cd = upstream.headers.get("content-disposition") || outHeadersResp["content-disposition"] || "";
    const filename = getFilenameFromContentDisposition(cd);

    let body = "";
    let bodyBase64 = "";
    let isBase64 = false;
    let sizeBytes = 0;

    if (isTextLikeContentType(ct)) {
      body = await upstream.text();
      try { sizeBytes = Buffer.byteLength(body, "utf8"); } catch { sizeBytes = body.length; }
    } else {
      const ab = await upstream.arrayBuffer();
      const buf = Buffer.from(ab);
      bodyBase64 = buf.toString("base64");
      isBase64 = true;
      sizeBytes = buf.length;
    }

    return res.json({
      ok: upstream.ok,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeadersResp,
      body,
      bodyBase64,
      isBase64,
      contentType: ct,
      filename,
      sizeBytes,
      setCookie: setCookies,
      jarId: jarEnabled ? jarId : null,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Proxy request failed",
      message: e?.message || String(e),
    });
  } finally {
    clearTimeout(t);
  }
});

app.get("/", (req, res) => {
  res.send("Bhejo proxy is running. Use POST /proxy");
});

app.listen(PORT, () => {
  console.log(`Bhejo proxy running on http://localhost:${PORT}`);
  console.log("Allowed hosts:", Array.from(ALLOWED_HOSTS));
  console.log("Allowed origins:", Array.from(ALLOWED_ORIGINS));
  console.log("Cookie jar persistence:", "server/.data/cookiejars/<jarId>.json");
});
