import axios from "axios";
import { URL } from "url";
import { createAgents } from "./proxy.js";
import { loadCaBundle } from "./certs.js";
import { getConfig } from "./store.js";

function headersArrayToObject(headersArr) {
  if (!Array.isArray(headersArr)) return headersArr && typeof headersArr === "object" ? headersArr : {};
  const out = {};
  for (const h of headersArr) {
    const k = String(h?.key || "").trim();
    if (!k) continue;
    out[k] = String(h?.value ?? "");
  }
  return out;
}

function mergeQuery(url, paramsArr) {
  const u = new URL(url);
  if (Array.isArray(paramsArr)) {
    for (const p of paramsArr) {
      const k = String(p?.key || "").trim();
      if (!k) continue;
      if (p?.enabled === false) continue;
      u.searchParams.set(k, String(p?.value ?? ""));
    }
  }
  return u.toString();
}

function isTextLike(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) return true;
  if (ct.includes("application/json")) return true;
  if (ct.startsWith("text/")) return true;
  if (ct.includes("xml")) return true;
  if (ct.includes("javascript")) return true;
  if (ct.includes("x-www-form-urlencoded")) return true;
  return false;
}

function bufferToBody(buffer, contentType) {
  const sizeBytes = buffer ? buffer.byteLength : 0;
  if (!buffer) return { body: "", isBase64: false, sizeBytes: 0 };

  if (isTextLike(contentType)) {
    const text = Buffer.from(buffer).toString("utf8");
    return { body: text, isBase64: false, sizeBytes };
  }

  const b64 = Buffer.from(buffer).toString("base64");
  return { body: b64, isBase64: true, sizeBytes };
}

function extractRedirectChain(resp) {
  const redir = resp?.request?._redirectable;
  const arr = redir?._redirects;
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => ({
    url: r.url,
    statusCode: r.statusCode,
    headers: r.headers || {}
  }));
}

function buildBody(body) {
  if (!body) return { data: undefined, contentType: "" };
  const mode = body.mode || "none";

  if (mode === "raw") return { data: body.raw ?? "", contentType: body.contentType || "" };

  if (mode === "json") {
    const raw = typeof body.json === "string" ? body.json : JSON.stringify(body.json ?? {});
    return { data: raw, contentType: "application/json" };
  }

  if (mode === "form-url") {
    const usp = new URLSearchParams();
    for (const row of body.items || []) {
      if (row?.enabled === false) continue;
      const k = String(row?.key || "").trim();
      if (!k) continue;
      usp.append(k, String(row?.value ?? ""));
    }
    return { data: usp.toString(), contentType: "application/x-www-form-urlencoded" };
  }

  // multipart/form-data later
  return { data: undefined, contentType: "" };
}

/**
 * Agent request executor.
 * Supports: proxy mode (env/custom), TLS CA, rejectUnauthorized, binary bodies, redirect chain.
 */
export async function sendOnce(payload) {
  const config = getConfig();

  const tls = config?.tls || {};
  const caBundle = loadCaBundle({ caPem: tls.caPem, caPemPath: tls.caPemPath });

  const started = Date.now();

  const method = String(payload.method || "GET").toUpperCase();
  const urlWithParams = mergeQuery(String(payload.url || ""), payload.params);

  const headersObj = headersArrayToObject(payload.headers);
  const { data, contentType } = buildBody(payload.body);
  const outHeaders = { ...headersObj };

  if (contentType && !Object.keys(outHeaders).some((k) => k.toLowerCase() === "content-type")) {
    outHeaders["Content-Type"] = contentType;
  }

  const agents = createAgents({
    targetUrl: urlWithParams,
    config: {
      ...config,
      tls: {
        ...tls,
        ca: caBundle,
        rejectUnauthorized: tls.rejectUnauthorized !== false
      }
    }
  });

  const followRedirects = payload.followRedirects !== false;
  const maxRedirects = typeof payload.maxRedirects === "number" ? payload.maxRedirects : 10;

  let resp;
  try {
    resp = await axios.request({
      method,
      url: urlWithParams,
      headers: outHeaders,
      data,
      timeout: typeof payload.timeoutMs === "number" ? payload.timeoutMs : 30000,
      maxRedirects: followRedirects ? maxRedirects : 0,
      validateStatus: () => true,
      responseType: "arraybuffer",
      decompress: true,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent
    });
  } catch (e) {
    return {
      ok: false,
      error: "Request failed",
      message: e?.message || String(e),
      ms: Date.now() - started,
      proxySource: agents.proxySource,
      proxyUrl: agents.proxyUrl ? "(set)" : ""
    };
  }

  const headers = resp.headers || {};
  const contentTypeResp = headers["content-type"] || headers["Content-Type"] || "";
  const converted = bufferToBody(resp.data, contentTypeResp);

  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    statusText: resp.statusText || "",
    headers,
    body: converted.body,
    isBase64: converted.isBase64,
    sizeBytes: converted.sizeBytes,
    contentType: contentTypeResp,
    ms: Date.now() - started,
    redirectChain: extractRedirectChain(resp),
    finalUrl: resp?.request?.res?.responseUrl || urlWithParams,
    proxySource: agents.proxySource,
    proxyUrl: agents.proxyUrl ? "(set)" : ""
  };
}
