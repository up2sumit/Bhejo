import { loadJar } from "./cookieJarStore.js";

function isExpired(c) {
  const exp = c.expires;
  if (!exp) return false;
  const t = exp instanceof Date ? exp.getTime() : new Date(exp).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

function domainMatches(cookieDomain, host) {
  const cd = String(cookieDomain || "").toLowerCase();
  const h = String(host || "").toLowerCase();
  if (!cd) return false;
  const d = cd.startsWith(".") ? cd.slice(1) : cd;
  return h === d || h.endsWith("." + d);
}

function pathMatches(cookiePath, reqPath) {
  const cp = cookiePath || "/";
  const rp = reqPath || "/";
  if (cp === "/") return true;
  if (rp === cp) return true;
  return rp.startsWith(cp.endsWith("/") ? cp : cp + "/");
}

const normalizeSameSite = (v) => String(v || "").toLowerCase(); // lax/strict/none/""
const effectiveSameSite = (c) => normalizeSameSite(c.sameSite) || "lax";

export function resolveCookiesForUrl({ jarId = "default", url, siteOrigin = "", manualCookieHeader = "" }) {
  const jar = loadJar(jarId);

  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  const isHttps = u.protocol === "https:";

  let siteHost = "";
  try {
    siteHost = siteOrigin ? new URL(siteOrigin).hostname.toLowerCase() : "";
  } catch {
    siteHost = "";
  }
  const isCrossSite = !!(siteHost && siteHost !== host);

  // tough-cookie has serialize, but easiest is iterate from jar.toJSON()
  const json = jar.toJSON();
  const allCookies = [];
  for (const c of json.cookies || []) allCookies.push(c);

  const sentCandidates = [];
  const excluded = [];

  for (const c of allCookies) {
    const base = {
      name: c.key,
      value: c.value,
      domain: c.domain,
      hostOnly: !!c.hostOnly,
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite || "",
      expiresAt: c.expires || null
    };

    const reasons = [];
    const notes = [];

    if (c.httpOnly) notes.push("HttpOnly: not accessible to scripts");

    if (isExpired(c)) {
      reasons.push("Expired");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    if (c.secure && !isHttps) {
      reasons.push("Secure cookie over HTTP");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    const ss = effectiveSameSite(c);

    if (ss === "none" && !c.secure) {
      reasons.push("SameSite=None requires Secure");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    if (isCrossSite) {
      if (ss === "strict") {
        reasons.push("SameSite=Strict blocks cross-site requests");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
      if (ss === "lax") {
        reasons.push("SameSite=Lax blocks cross-site XHR/fetch");
        excluded.push({ ...base, reasons, notes });
        continue;
      }
    }

    if (c.hostOnly) {
      if (String(c.domain || "").toLowerCase() !== host) {
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

    if (!pathMatches(c.path, path)) {
      reasons.push("Path mismatch");
      excluded.push({ ...base, reasons, notes });
      continue;
    }

    sentCandidates.push({ c, base, notes });
  }

  sentCandidates.sort((a, b) => (b.c.path || "").length - (a.c.path || "").length);

  const seen = new Set();
  const sentCookies = [];
  const pairs = [];

  for (const item of sentCandidates) {
    const c = item.c;
    const base = item.base;
    const notes = item.notes;

    if (seen.has(base.name)) {
      excluded.push({ ...base, reasons: ["Overridden by a more specific cookie with the same name"], notes });
      continue;
    }
    seen.add(base.name);

    const whyParts = [];
    whyParts.push(base.hostOnly ? "Host-only match" : "Domain match");
    whyParts.push(`Path match (${base.path})`);
    whyParts.push(base.secure ? "Secure" : "Not secure");
    whyParts.push(`SameSite=${String(base.sameSite || "default(Lax)")}`);

    sentCookies.push({ ...base, whyParts, notes });
    pairs.push(`${base.name}=${base.value}`);
  }

  const headerFromJar = pairs.join("; ");

  if (manualCookieHeader) {
    const overridden = sentCookies.map((c) => ({ ...c, reasons: ["Overridden by manual Cookie header"], notes: c.notes || [] }));
    const excl = excluded.map((c) => ({
      ...c,
      reasons: Array.isArray(c.reasons) && c.reasons.length ? [...c.reasons, "Manual Cookie header present"] : ["Manual Cookie header present"]
    }));

    return {
      header: manualCookieHeader,
      cookiesSent: [],
      cookiesExcluded: [...overridden, ...excl],
      manualOverride: true,
      isCrossSite,
      siteOrigin
    };
  }

  return {
    header: headerFromJar,
    cookiesSent: sentCookies,
    cookiesExcluded: excluded,
    manualOverride: false,
    isCrossSite,
    siteOrigin
  };
}
