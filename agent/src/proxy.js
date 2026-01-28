import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { URL } from "url";

function isNoProxy(host, noProxyList = []) {
  const h = String(host || "").toLowerCase();
  for (const raw of noProxyList || []) {
    const rule = String(raw || "").trim().toLowerCase();
    if (!rule) continue;
    if (rule === h) return true;
    if (rule.startsWith(".") && h.endsWith(rule)) return true;
  }
  return false;
}

function envProxyForUrl(targetUrl) {
  const u = new URL(targetUrl);
  const isHttps = u.protocol === "https:";
  const proxy = isHttps
    ? (process.env.HTTPS_PROXY || process.env.https_proxy)
    : (process.env.HTTP_PROXY || process.env.http_proxy);

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
  const noProxyList = noProxy.split(",").map((s) => s.trim()).filter(Boolean);
  return { proxy, noProxyList };
}

function buildCustomProxyUrl(customProxy) {
  if (!customProxy?.host || !customProxy?.port) return "";
  const proto = customProxy.protocol || "http";
  const host = customProxy.host;
  const port = customProxy.port;

  let auth = "";
  if (customProxy.auth?.enabled && customProxy.auth.user) {
    const user = encodeURIComponent(customProxy.auth.user);
    const pass = encodeURIComponent(customProxy.auth.pass || "");
    auth = `${user}:${pass}@`;
  }
  return `${proto}://${auth}${host}:${port}`;
}

export function createAgents({ targetUrl, config }) {
  const u = new URL(targetUrl);
  const host = u.hostname;

  const mode = config?.proxyMode || "off";
  const tls = config?.tls || {};
  const rejectUnauthorized = tls.rejectUnauthorized !== false;
  const ca = tls.ca || undefined;

  const noProxyList = config?.noProxy || [];
  const skip = isNoProxy(host, noProxyList);

  let proxyUrl = "";
  let proxySource = "off";

  if (!skip) {
    if (mode === "custom") {
      proxyUrl = buildCustomProxyUrl(config.customProxy);
      proxySource = proxyUrl ? "custom" : "off";
    } else if (mode === "env" || mode === "system") {
      const env = envProxyForUrl(targetUrl);
      proxyUrl = env.proxy || "";
      proxySource = proxyUrl ? (mode === "system" ? "system(env)" : "env") : "off";
      if (proxyUrl && isNoProxy(host, env.noProxyList)) {
        proxyUrl = "";
        proxySource = "off(no_proxy)";
      }
    }
  } else {
    proxySource = "off(no_proxy)";
  }

  if (!proxyUrl) {
    return { httpAgent: undefined, httpsAgent: undefined, proxySource, proxyUrl: "" };
  }

  const proxyFor = config?.proxyFor || { http: true, https: true };
  const isHttps = u.protocol === "https:";
  if ((isHttps && proxyFor.https === false) || (!isHttps && proxyFor.http === false)) {
    return { httpAgent: undefined, httpsAgent: undefined, proxySource: "off(proxyFor disabled)", proxyUrl: "" };
  }

  const httpAgent = new HttpProxyAgent(proxyUrl);
  const httpsAgent = new HttpsProxyAgent({
    ...new URL(proxyUrl),
    rejectUnauthorized,
    ca
  });

  return { httpAgent, httpsAgent, proxySource, proxyUrl };
}

// ✅ Backward-compatible alias (prevents this exact crash)
export function createAgent(args) {
  return createAgents(args);
}
