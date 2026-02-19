import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { URL } from "url";

const DEBUG = process.env.BHEJO_DEBUG === "1";
const dbg = (...a) => DEBUG && console.log("[Bhejo Agent][proxy]", ...a);

function normalizeNoProxy(noProxy) {
  if (!noProxy) return [];
  if (Array.isArray(noProxy)) return noProxy.map((s) => String(s).trim()).filter(Boolean);
  if (typeof noProxy === "string") return noProxy.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function isNoProxy(host, noProxyList = []) {
  const h = String(host || "").toLowerCase();
  for (const raw of noProxyList || []) {
    const rule = String(raw || "").trim().toLowerCase();
    if (!rule) continue;
    if (rule === "*") return true;
    if (rule === h) return true;
    // .example.com matches subdomains too
    if (rule.startsWith(".") && (h === rule.slice(1) || h.endsWith(rule))) return true;
  }
  return false;
}

function envProxyForUrl(targetUrl) {
  const u = new URL(targetUrl);
  const isHttps = u.protocol === "https:";
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || "";
  // prefer scheme-specific proxy, fallback to the other if missing
  const proxy = isHttps ? (httpsProxy || httpProxy) : (httpProxy || httpsProxy);

  const noProxyRaw = process.env.NO_PROXY || process.env.no_proxy || "";
  const noProxyList = normalizeNoProxy(noProxyRaw);
  return { proxy: String(proxy || "").trim(), noProxyList };
}

function buildCustomProxyUrl(customProxy) {
  if (!customProxy?.host || !customProxy?.port) return "";
  const proto = String(customProxy.protocol || "http").replace(/:$/, "").trim();
  const host = String(customProxy.host).trim();
  const port = String(customProxy.port).trim();

  let auth = "";
  if (customProxy.auth?.enabled && customProxy.auth.user) {
    const user = encodeURIComponent(String(customProxy.auth.user));
    const pass = encodeURIComponent(String(customProxy.auth.pass || ""));
    auth = `${user}:${pass}@`;
  }
  if (!host || !port) return "";
  return `${proto}://${auth}${host}:${port}`;
}

function redact(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (u.username) u.username = "****";
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return String(proxyUrl || "");
  }
}

export function createAgents({ targetUrl, config } = {}) {
  const u = new URL(targetUrl);
  const host = u.hostname;

  const mode = String(config?.proxyMode || "off").toLowerCase();
  const tls = config?.tls || {};
  const rejectUnauthorized = tls.rejectUnauthorized !== false;
  const ca = tls.ca || undefined;

  const appNoProxyList = normalizeNoProxy(config?.noProxy);
  const skip = isNoProxy(host, appNoProxyList);

  let proxyUrl = "";
  let proxySource = "off";

  if (!skip) {
    if (mode === "custom") {
      proxyUrl = buildCustomProxyUrl(config?.customProxy);
      proxySource = proxyUrl ? "custom" : "off";
    } else if (mode === "env" || mode === "system") {
      const env = envProxyForUrl(targetUrl);
      proxyUrl = env.proxy || "";
      proxySource = proxyUrl ? (mode === "system" ? "system(env)" : "env") : "off";
      if (proxyUrl && isNoProxy(host, env.noProxyList)) {
        proxyUrl = "";
        proxySource = "off(no_proxy_env)";
      }
    }
  } else {
    proxySource = "off(no_proxy_app)";
  }

  // ✅ Critical guard: never construct agents without a valid URL string.
  if (!proxyUrl) {
    dbg("disabled", { mode, proxySource, host });
    return { httpAgent: undefined, httpsAgent: undefined, proxySource, proxyUrl: "" };
  }

  const proxyFor = config?.proxyFor || { http: true, https: true };
  const isHttps = u.protocol === "https:";
  if ((isHttps && proxyFor.https === false) || (!isHttps && proxyFor.http === false)) {
    dbg("disabled(proxyFor)", { proxyFor, host });
    return { httpAgent: undefined, httpsAgent: undefined, proxySource: "off(proxyFor disabled)", proxyUrl: "" };
  }

  // ✅ HttpProxyAgent: string is best
  const httpAgent = new HttpProxyAgent(proxyUrl);

  // ✅ HttpsProxyAgent: DO NOT spread URL objects (it breaks protocol/hostname fields)
  // Build explicit options.
  const p = new URL(proxyUrl);
  const httpsAgent = new HttpsProxyAgent({
    protocol: p.protocol,             // e.g. "http:"
    hostname: p.hostname,
    port: p.port ? Number(p.port) : undefined,
    username: p.username || undefined,
    password: p.password || undefined,
    rejectUnauthorized,
    ca,
  });

  dbg("enabled", { mode, proxySource, proxyUrl: redact(proxyUrl), host });
  return { httpAgent, httpsAgent, proxySource, proxyUrl };
}

// Backward-compatible alias
export function createAgent(args) {
  return createAgents(args);
}
