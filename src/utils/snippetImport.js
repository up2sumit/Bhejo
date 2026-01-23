// src/utils/snippetImport.js
// Phase 4.2.5:
// - Keep robust cURL / fetch / axios / raw HTTP import
// - Add helpers to extract auth from parsed headers (Bearer / Basic) so UI can map to Auth tab cleanly
// - Keep output normalized to RequestBuilder shape: { name, method, url, headers[], params[], body, mode, auth }

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function trimQuotes(s) {
  const t = String(s ?? "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith("`") && t.endsWith("`"))
  ) {
    return t.slice(1, -1);
  }
  if (
    (t.startsWith("$'") && t.endsWith("'")) ||
    (t.startsWith('$"') && t.endsWith('"'))
  ) {
    return t.slice(2, -1);
  }
  return t;
}

function looksLikeJson(text) {
  const b = String(text || "").trim();
  if (!b) return false;
  return (
    (b.startsWith("{") && b.endsWith("}")) ||
    (b.startsWith("[") && b.endsWith("]"))
  );
}

function splitHeaderLine(line) {
  const s = String(line ?? "");
  const idx = s.indexOf(":");
  if (idx === -1) return null;
  const key = s.slice(0, idx).trim();
  const value = s.slice(idx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function toKvArray(headersObj) {
  const out = [];
  for (const [k, v] of Object.entries(headersObj || {})) {
    if (!k) continue;
    out.push({ key: String(k), value: String(v ?? "") });
  }
  return out.length ? out : [{ key: "", value: "" }];
}

function ensureKvRows(arr) {
  const a = Array.isArray(arr) ? arr : [];
  if (!a.length) return [{ key: "", value: "" }];
  const hasBlank = a.some((x) => !String(x?.key || "") && !String(x?.value || ""));
  return hasBlank ? a : [...a, { key: "", value: "" }];
}

function parseUrlIntoParams(url) {
  try {
    const u = new URL(url);
    const params = [];
    u.searchParams.forEach((value, key) => {
      params.push({ key, value });
    });
    u.search = "";
    const cleanUrl = u.toString();
    return {
      url: cleanUrl,
      params: params.length ? params : [{ key: "", value: "" }],
    };
  } catch {
    return { url, params: [{ key: "", value: "" }] };
  }
}

function addQueryParamsToUrl(url, kvPairs) {
  try {
    const u = new URL(url);
    for (const p of kvPairs || []) {
      const k = String(p?.key || "").trim();
      if (!k) continue;
      u.searchParams.append(k, String(p?.value ?? ""));
    }
    return u.toString();
  } catch {
    return url;
  }
}

function normalizeOut(out) {
  const method = String(out.method || "GET").toUpperCase();
  const url = String(out.url || "").trim();
  const headers = ensureKvRows(out.headers);
  const params = ensureKvRows(out.params);
  const body = String(out.body || "");
  const name = String(out.name || "").trim();
  const mode = out.mode === "proxy" ? "proxy" : "direct";
  const auth = out.auth || { type: "none" };

  return { name, method, url, headers, params, body, mode, auth };
}

// -----------------------------------------
// Phase 4.2.5: Auth extraction helper
// -----------------------------------------
export function extractAuthFromHeaders(headers) {
  const list = Array.isArray(headers) ? headers : [];
  const outHeaders = [];

  let authHeaderValue = "";
  for (const h of list) {
    const k = String(h?.key || "").trim();
    const v = String(h?.value ?? "");
    if (!k) continue;
    if (k.toLowerCase() === "authorization") {
      authHeaderValue = v.trim();
    } else {
      outHeaders.push({ key: k, value: v });
    }
  }

  if (!authHeaderValue) {
    return {
      auth: {
        type: "none",
        bearer: "",
        username: "",
        password: "",
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },
      headers: ensureKvRows(outHeaders),
      detected: "none",
    };
  }

  const lower = authHeaderValue.toLowerCase();

  if (lower.startsWith("bearer ")) {
    const token = authHeaderValue.slice(7).trim();
    return {
      auth: {
        type: "bearer",
        bearer: token,
        username: "",
        password: "",
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },
      headers: ensureKvRows(outHeaders),
      detected: "bearer",
    };
  }

  if (lower.startsWith("basic ")) {
    const b64 = authHeaderValue.slice(6).trim();
    let username = "";
    let password = "";

    try {
      const decoded = atob(b64);
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        username = decoded.slice(0, idx);
        password = decoded.slice(idx + 1);
      }
    } catch {
      // leave blank if decode fails
    }

    return {
      auth: {
        type: "basic",
        bearer: "",
        username,
        password,
        apiKeyName: "x-api-key",
        apiKeyValue: "",
      },
      headers: ensureKvRows(outHeaders),
      detected: "basic",
    };
  }

  // Unknown scheme: keep Authorization in headers, do not map
  const kept = ensureKvRows([...outHeaders, { key: "Authorization", value: authHeaderValue }]);
  return {
    auth: {
      type: "none",
      bearer: "",
      username: "",
      password: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
    },
    headers: kept,
    detected: "unknown",
  };
}

// -----------------------------------------
// Robust shell-like tokenizer for cURL
// -----------------------------------------
function tokenizeShellLike(input) {
  const s = String(input || "");
  const tokens = [];

  let cur = "";
  let quote = null;
  let dollarQuote = null;
  let i = 0;

  const push = () => {
    if (cur) tokens.push(cur);
    cur = "";
  };

  while (i < s.length) {
    const ch = s[i];

    if (!quote && !dollarQuote && /\s/.test(ch)) {
      push();
      i++;
      continue;
    }

    if (!quote && !dollarQuote && ch === "$" && i + 1 < s.length) {
      const nxt = s[i + 1];
      if (nxt === "'" || nxt === '"') {
        dollarQuote = `$${nxt}`;
        i += 2;
        continue;
      }
    }

    if (!quote && !dollarQuote && (ch === "'" || ch === '"' || ch === "`")) {
      quote = ch;
      i++;
      continue;
    }

    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < s.length) {
        cur += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    if (dollarQuote) {
      const endChar = dollarQuote === "$'" ? "'" : '"';
      if (ch === "\\" && i + 1 < s.length) {
        const nxt = s[i + 1];
        if (nxt === "n") cur += "\n";
        else if (nxt === "t") cur += "\t";
        else cur += nxt;
        i += 2;
        continue;
      }
      if (ch === endChar) {
        dollarQuote = null;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    if (ch === "\\" && i + 1 < s.length) {
      const nxt = s[i + 1];
      if (nxt === "\n") {
        i += 2;
        continue;
      }
      if (nxt === "\r" && i + 2 < s.length && s[i + 2] === "\n") {
        i += 3;
        continue;
      }
      cur += nxt;
      i += 2;
      continue;
    }

    cur += ch;
    i++;
  }

  push();
  return tokens.filter(Boolean);
}

// -----------------------------------------
// cURL parser (robust + Chrome variants)
// -----------------------------------------
export function parseCurlSnippet(snippet) {
  const raw = String(snippet || "").trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const curlIndex = lower.indexOf("curl");
  if (curlIndex === -1) return null;

  const sliced = raw.slice(curlIndex);
  const cleaned = sliced.replace(/\\\s*\r?\n/g, " ").trim();

  const tokens = tokenizeShellLike(cleaned);
  if (!tokens.length) return null;
  if (String(tokens[0]).toLowerCase() !== "curl") return null;

  let method = "GET";
  let url = "";
  let isGetWithData = false;
  let explicitMethod = false;

  const headersObj = {};
  const dataParts = [];
  const urlEncodeParts = [];
  const formParts = [];
  let contentTypeForced = "";

  function setHeader(k, v) {
    const key = String(k || "").trim();
    if (!key) return;
    headersObj[key] = String(v ?? "");
  }

  function takeEqOrNext(t, i) {
    const idx = t.indexOf("=");
    if (idx !== -1) return { value: t.slice(idx + 1), consumed: 0 };
    return { value: tokens[i + 1] || "", consumed: 1 };
  }

  for (let i = 1; i < tokens.length; i++) {
    const t = String(tokens[i] || "");

    // -XPOST (no space)
    if (t.startsWith("-X") && t.length > 2) {
      method = t.slice(2).toUpperCase();
      explicitMethod = true;
      continue;
    }

    if (t === "-X" || t === "--request" || t.startsWith("--request=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      method = String(value || "GET").toUpperCase();
      explicitMethod = true;
      i += consumed;
      continue;
    }

    if (t === "-I" || t === "--head") {
      method = "HEAD";
      explicitMethod = true;
      continue;
    }

    if (t === "-G" || t === "--get") {
      isGetWithData = true;
      continue;
    }

    if (t === "-H" || t === "--header" || t.startsWith("--header=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      const parsed = splitHeaderLine(value);
      if (parsed) setHeader(parsed.key, parsed.value);
      i += consumed;
      continue;
    }

    // cookies: -b / --cookie
    if (t === "-b" || t === "--cookie" || t.startsWith("--cookie=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      if (String(value || "").trim()) setHeader("Cookie", String(value).trim());
      i += consumed;
      continue;
    }

    // basic auth -u user:pass
    if (t === "-u" || t === "--user" || t.startsWith("--user=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      try {
        setHeader("Authorization", `Basic ${btoa(String(value || ""))}`);
      } catch {
        // ignore
      }
      i += consumed;
      continue;
    }

    if (t === "--url" || t.startsWith("--url=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      url = String(value || "");
      i += consumed;
      continue;
    }

    // json helper
    if (t === "--json" || t.startsWith("--json=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      dataParts.push(String(value || ""));
      contentTypeForced = "application/json";
      if (!explicitMethod) method = "POST";
      i += consumed;
      continue;
    }

    // data variants
    if (
      t === "-d" ||
      t === "--data" ||
      t === "--data-raw" ||
      t === "--data-binary" ||
      t.startsWith("--data=") ||
      t.startsWith("--data-raw=") ||
      t.startsWith("--data-binary=")
    ) {
      const { value, consumed } = takeEqOrNext(t, i);
      dataParts.push(String(value || ""));
      if (!explicitMethod && method === "GET" && !isGetWithData) method = "POST";
      i += consumed;
      continue;
    }

    if (t === "--data-urlencode" || t.startsWith("--data-urlencode=")) {
      const { value, consumed } = takeEqOrNext(t, i);
      urlEncodeParts.push(String(value || ""));
      if (!explicitMethod && method === "GET" && !isGetWithData) method = "POST";
      i += consumed;
      continue;
    }

    if (
      t === "-F" ||
      t === "--form" ||
      t === "--form-string" ||
      t.startsWith("--form=") ||
      t.startsWith("--form-string=")
    ) {
      const { value, consumed } = takeEqOrNext(t, i);
      formParts.push(String(value || ""));
      if (!explicitMethod && method === "GET" && !isGetWithData) method = "POST";
      i += consumed;
      continue;
    }

    // URL as plain token
    if (t.startsWith("http://") || t.startsWith("https://")) {
      url = t;
      continue;
    }

    // ignore other flags
  }

  url = trimQuotes(url);

  let body = "";
  const hasData = dataParts.length > 0;
  const hasUrlEncode = urlEncodeParts.length > 0;
  const hasForm = formParts.length > 0;

  // If -G, force GET and move data into query
  if (isGetWithData) {
    method = "GET";

    const queryPairs = [];
    const parts = [...dataParts, ...urlEncodeParts];

    for (const p of parts) {
      const s = String(p ?? "");
      const eq = s.indexOf("=");
      if (eq > 0) queryPairs.push({ key: s.slice(0, eq), value: s.slice(eq + 1) });
      else queryPairs.push({ key: "data", value: s });
    }

    url = addQueryParamsToUrl(url, queryPairs);
    body = "";
  } else {
    // Body composition
    const urlEncodedBody = hasUrlEncode ? urlEncodeParts.join("&") : "";

    if (hasData) {
      if (dataParts.length === 1 && looksLikeJson(dataParts[0])) body = dataParts[0];
      else body = dataParts.join("&");
    }

    if (hasData && hasUrlEncode) {
      const left = body ? body : "";
      const right = urlEncodedBody ? urlEncodedBody : "";
      body = [left, right].filter(Boolean).join("&");
    }

    if (!hasData && hasUrlEncode) body = urlEncodedBody;

    if (hasForm) {
      const formText = formParts.map((x) => String(x)).join("\n");
      body = body ? `${body}\n${formText}` : formText;
    }
  }

  // Infer Content-Type if missing
  const hasCT = Object.keys(headersObj).some((k) => k.toLowerCase() === "content-type");
  if (!hasCT) {
    if (contentTypeForced) {
      headersObj["Content-Type"] = contentTypeForced;
    } else if (hasForm) {
      headersObj["Content-Type"] = "multipart/form-data";
    } else if (String(body || "").trim()) {
      headersObj["Content-Type"] = looksLikeJson(body)
        ? "application/json"
        : "application/x-www-form-urlencoded";
    }
  }

  const urlParsed = parseUrlIntoParams(url);

  const headersArr = toKvArray(headersObj);
  const { auth, headers } = extractAuthFromHeaders(headersArr);

  return normalizeOut({
    name: "",
    method,
    url: urlParsed.url,
    params: urlParsed.params,
    headers,
    body,
    mode: "direct",
    auth,
  });
}

// -----------------------------------------
// Fetch parser (supports browser + node snippets)
// -----------------------------------------
function tryExtractCallArgs(code, fnName) {
  const s = String(code || "");
  const idx = s.indexOf(`${fnName}(`);
  if (idx === -1) return null;

  const start = idx + fnName.length + 1;
  let depth = 1;
  let i = start;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  return s.slice(start, i).trim();
}

function safeEvalObjectLiteral(str) {
  const t = String(str || "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${t});`);
    const out = fn();
    if (!isPlainObject(out)) return null;
    return out;
  } catch {
    return null;
  }
}

function splitArgsTopLevel(argString) {
  const s = String(argString || "");
  const args = [];
  let depth = 0;
  let quote = null;
  let cur = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < s.length) {
        cur += s[i + 1];
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      cur += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.trim()) args.push(cur.trim());
  return args;
}

function tryExtractJsonStringifyArg(expr) {
  const t = String(expr || "").trim();
  const m = t.match(/JSON\.stringify\s*\(\s*([\s\S]+)\s*\)\s*$/);
  if (!m?.[1]) return null;

  const inner = m[1].trim();
  if (inner.startsWith("{") || inner.startsWith("[")) {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${inner});`);
      const v = fn();
      return JSON.stringify(v, null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

export function parseFetchSnippet(snippet) {
  const code = String(snippet || "").trim();
  if (!code.includes("fetch(")) return null;

  const inside = tryExtractCallArgs(code, "fetch");
  if (!inside) return null;

  const args = splitArgsTopLevel(inside);
  if (!args.length) return null;

  const urlRaw = trimQuotes(args[0] || "");
  let method = "GET";
  let headersObj = {};
  let body = "";

  if (args[1]) {
    const obj = safeEvalObjectLiteral(args[1]);
    if (obj) {
      if (obj.method) method = String(obj.method).toUpperCase();

      if (obj.headers && isPlainObject(obj.headers)) {
        headersObj = obj.headers;
      }

      if (typeof obj.body === "string") {
        body = obj.body;
      } else if (obj.body != null) {
        const stringifyBody = tryExtractJsonStringifyArg(String(obj.body));
        if (stringifyBody) body = stringifyBody;
      }
    }
  }

  const urlParsed = parseUrlIntoParams(urlRaw);

  const headersArr = toKvArray(headersObj);
  const { auth, headers } = extractAuthFromHeaders(headersArr);

  return normalizeOut({
    name: "",
    method,
    url: urlParsed.url,
    params: urlParsed.params,
    headers,
    body,
    mode: "direct",
    auth,
  });
}

// -----------------------------------------
// Axios parser (tolerant)
// -----------------------------------------
export function parseAxiosSnippet(snippet) {
  const code = String(snippet || "").trim();
  if (!code.includes("axios")) return null;

  const objCall = code.match(/axios\s*\(\s*({[\s\S]*})\s*\)/);
  if (objCall?.[1]) {
    const obj = safeEvalObjectLiteral(objCall[1]);
    if (!obj) return null;

    const method = String(obj.method || "GET").toUpperCase();
    const urlRaw = String(obj.url || "");
    const headersObj = isPlainObject(obj.headers) ? obj.headers : {};
    let body = "";

    if (typeof obj.data === "string") body = obj.data;
    else if (obj.data != null) body = JSON.stringify(obj.data, null, 2);

    const urlParsed = parseUrlIntoParams(urlRaw);

    const headersArr = toKvArray(headersObj);
    const { auth, headers } = extractAuthFromHeaders(headersArr);

    return normalizeOut({
      name: "",
      method,
      url: urlParsed.url,
      params: urlParsed.params,
      headers,
      body,
      mode: "direct",
      auth,
    });
  }

  const getCall = code.match(
    /axios\.get\s*\(\s*([^,]+)\s*(?:,\s*({[\s\S]*}))?\s*\)/
  );
  if (getCall?.[1]) {
    const urlRaw = trimQuotes(getCall[1]);
    const cfg = getCall[2] ? safeEvalObjectLiteral(getCall[2]) : null;
    const headersObj = cfg && isPlainObject(cfg.headers) ? cfg.headers : {};

    const urlParsed = parseUrlIntoParams(urlRaw);

    const headersArr = toKvArray(headersObj);
    const { auth, headers } = extractAuthFromHeaders(headersArr);

    return normalizeOut({
      name: "",
      method: "GET",
      url: urlParsed.url,
      params: urlParsed.params,
      headers,
      body: "",
      mode: "direct",
      auth,
    });
  }

  const postCall = code.match(
    /axios\.(post|put|patch|delete)\s*\(\s*([^,]+)\s*(?:,\s*([^,]+))?\s*(?:,\s*({[\s\S]*}))?\s*\)/
  );
  if (postCall?.[1]) {
    const method = String(postCall[1]).toUpperCase();
    const urlRaw = trimQuotes(postCall[2]);

    let body = "";
    const dataArg = postCall[3] ? postCall[3].trim() : "";
    if (dataArg) {
      const dq = trimQuotes(dataArg);
      if (dq !== dataArg) body = dq;
      else if (dq.startsWith("{") || dq.startsWith("[")) body = dq;
      else body = tryExtractJsonStringifyArg(dq) || dq;
    }

    const cfg = postCall[4] ? safeEvalObjectLiteral(postCall[4]) : null;
    const headersObj = cfg && isPlainObject(cfg.headers) ? cfg.headers : {};

    const urlParsed = parseUrlIntoParams(urlRaw);

    const headersArr = toKvArray(headersObj);
    const { auth, headers } = extractAuthFromHeaders(headersArr);

    return normalizeOut({
      name: "",
      method,
      url: urlParsed.url,
      params: urlParsed.params,
      headers,
      body,
      mode: "direct",
      auth,
    });
  }

  return null;
}

// -----------------------------------------
// Raw HTTP parser
// -----------------------------------------
export function parseHttpSnippet(snippet) {
  const raw = String(snippet || "").trim();
  if (!raw) return null;

  const lines = raw.split(/\r?\n/);
  const first = (lines[0] || "").trim();
  const m = first.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d/i);
  if (!m) return null;

  const method = m[1].toUpperCase();
  const path = m[2];

  let i = 1;
  const headersObj = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    const h = splitHeaderLine(line);
    if (h) headersObj[h.key] = h.value;
  }

  const body = lines.slice(i).join("\n").trim();

  const host = headersObj.Host || headersObj.host || "";
  const scheme =
    headersObj["X-Forwarded-Proto"] ||
    headersObj["x-forwarded-proto"] ||
    "https";

  const urlRaw = host
    ? `${scheme}://${host}${path.startsWith("/") ? path : `/${path}`}`
    : path;

  const urlParsed = parseUrlIntoParams(urlRaw);

  const headersArr = toKvArray(headersObj);
  const { auth, headers } = extractAuthFromHeaders(headersArr);

  return normalizeOut({
    name: "",
    method,
    url: urlParsed.url,
    params: urlParsed.params,
    headers,
    body,
    mode: "direct",
    auth,
  });
}

// -----------------------------------------
// Auto detect + parse
// -----------------------------------------
export function importSnippet(snippet, hint = "auto") {
  const text = String(snippet || "").trim();
  const h = String(hint || "auto").toLowerCase();

  const tryAll = () => {
    return (
      parseCurlSnippet(text) ||
      parseFetchSnippet(text) ||
      parseAxiosSnippet(text) ||
      parseHttpSnippet(text) ||
      null
    );
  };

  if (h === "auto") return tryAll();
  if (h === "curl") return parseCurlSnippet(text);
  if (h === "fetch") return parseFetchSnippet(text);
  if (h === "axios") return parseAxiosSnippet(text);
  if (h === "http") return parseHttpSnippet(text);
  return null;
}
