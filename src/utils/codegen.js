// src/utils/codegen.js

function escapeBashSingleQuotes(input) {
  const s = String(input ?? "");
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function isProbablyJson(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

function indentLines(text, spaces) {
  const pad = " ".repeat(spaces);
  return String(text ?? "")
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

function toCurl({ method, finalUrl, headersObj, body }) {
  const m = String(method || "GET").toUpperCase();
  const urlPart = escapeBashSingleQuotes(finalUrl || "");
  let cmd = `curl -X ${m} ${urlPart}`;

  const headerKeys = Object.keys(headersObj || {});
  for (const k of headerKeys) {
    const v = headersObj[k];
    const line = `${k}: ${v ?? ""}`;
    cmd += ` \\\n  -H ${escapeBashSingleQuotes(line)}`;
  }

  const includeBody = !["GET", "HEAD"].includes(m) && String(body || "").trim().length > 0;
  if (includeBody) {
    cmd += ` \\\n  --data-raw ${escapeBashSingleQuotes(body)}`;
  }

  return cmd;
}

function toFetch({ method, finalUrl, headersObj, body }) {
  const m = String(method || "GET").toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(m) && String(body || "").trim().length > 0;

  const headersLines = Object.keys(headersObj || {})
    .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(String(headersObj[k] ?? ""))},`)
    .join("\n");

  let bodyLine = "";
  if (hasBody) {
    const bodyStr = String(body || "");
    const isJson = isProbablyJson(bodyStr);
    if (isJson) {
      const parsed = parseJsonOrNull(bodyStr);
      bodyLine = `  body: JSON.stringify(${JSON.stringify(parsed, null, 2)}),`;
    } else {
      bodyLine = `  body: ${JSON.stringify(bodyStr)},`;
    }
  }

  const optionsBlock = [
    "{",
    `  method: ${JSON.stringify(m)},`,
    Object.keys(headersObj || {}).length > 0 ? "  headers: {" : "  headers: {},",
    headersLines ? `${headersLines}` : "",
    Object.keys(headersObj || {}).length > 0 ? "  }," : "",
    bodyLine,
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const snippet = [
    `const url = ${JSON.stringify(finalUrl || "")};`,
    `const options = ${optionsBlock};`,
    "",
    "fetch(url, options)",
    "  .then(async (res) => {",
    "    const text = await res.text();",
    "    let data;",
    "    try { data = text ? JSON.parse(text) : null; } catch { data = text; }",
    "    if (!res.ok) throw { status: res.status, statusText: res.statusText, data };",
    "    return data;",
    "  })",
    "  .then((data) => console.log(data))",
    "  .catch((err) => console.error(err));",
  ].join("\n");

  return snippet;
}

function toAxios({ method, finalUrl, headersObj, body }) {
  const m = String(method || "GET").toLowerCase();
  const hasBody = !["get", "head"].includes(m) && String(body || "").trim().length > 0;

  const headersLines = Object.keys(headersObj || {})
    .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(String(headersObj[k] ?? ""))},`)
    .join("\n");

  let dataLine = "";
  if (hasBody) {
    const bodyStr = String(body || "");
    const isJson = isProbablyJson(bodyStr);
    if (isJson) {
      const parsed = parseJsonOrNull(bodyStr);
      dataLine = `  data: ${JSON.stringify(parsed, null, 2)},`;
    } else {
      dataLine = `  data: ${JSON.stringify(bodyStr)},`;
    }
  }

  const configBlock = [
    "{",
    `  method: ${JSON.stringify(m)},`,
    `  url: ${JSON.stringify(finalUrl || "")},`,
    Object.keys(headersObj || {}).length > 0 ? "  headers: {" : "  headers: {},",
    headersLines ? `${headersLines}` : "",
    Object.keys(headersObj || {}).length > 0 ? "  }," : "",
    dataLine,
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const snippet = [
    'import axios from "axios";',
    "",
    `const config = ${configBlock};`,
    "",
    "axios(config)",
    "  .then((res) => console.log(res.data))",
    "  .catch((err) => {",
    "    const status = err?.response?.status;",
    "    const data = err?.response?.data;",
    "    console.error({ status, data, message: err?.message });",
    "  });",
  ].join("\n");

  return snippet;
}

function toPythonRequests({ method, finalUrl, headersObj, body }) {
  const m = String(method || "GET").toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(m) && String(body || "").trim().length > 0;

  const headersPy =
    Object.keys(headersObj || {}).length === 0
      ? "{}"
      : "{\n" +
        Object.keys(headersObj || {})
          .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(String(headersObj[k] ?? ""))},`)
          .join("\n") +
        "\n}";

  let dataPart = "";
  if (hasBody) {
    const bodyStr = String(body || "");
    if (isProbablyJson(bodyStr)) {
      const parsed = parseJsonOrNull(bodyStr);
      dataPart = `json=${JSON.stringify(parsed, null, 2).replace(/\n/g, "\n")}`;
      dataPart = "json=" + indentLines(JSON.stringify(parsed, null, 2), 0);
    } else {
      dataPart = `data=${JSON.stringify(bodyStr)}`;
    }
  }

  const args = [
    JSON.stringify(finalUrl || ""),
    `headers=${headersPy}`,
    hasBody ? dataPart : "",
    "timeout=30",
  ].filter(Boolean);

  const snippet = [
    "import requests",
    "",
    `url = ${JSON.stringify(finalUrl || "")}`,
    `headers = ${headersPy}`,
    "",
    "try:",
    `    r = requests.request(${JSON.stringify(m)}, url, ${args
      .slice(1)
      .map((a) => a)
      .join(", ")})`,
    "    print('Status:', r.status_code)",
    "    ct = r.headers.get('content-type', '')",
    "    if 'application/json' in ct:",
    "        print(r.json())",
    "    else:",
    "        print(r.text)",
    "except requests.RequestException as e:",
    "    print('Request failed:', e)",
  ].join("\n");

  return snippet;
}

function toNodeHttps({ method, finalUrl, headersObj, body }) {
  const m = String(method || "GET").toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(m) && String(body || "").trim().length > 0;

  let urlObj = null;
  try {
    urlObj = new URL(finalUrl);
  } catch {
    urlObj = null;
  }

  const headersLines =
    Object.keys(headersObj || {}).length === 0
      ? "{}"
      : "{\n" +
        Object.keys(headersObj || {})
          .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(String(headersObj[k] ?? ""))},`)
          .join("\n") +
        "\n}";

  const bodyValue = hasBody ? String(body || "") : "";

  const optionsBlock = urlObj
    ? [
        "{",
        `  method: ${JSON.stringify(m)},`,
        `  hostname: ${JSON.stringify(urlObj.hostname)},`,
        `  path: ${JSON.stringify(urlObj.pathname + (urlObj.search || ""))},`,
        `  port: ${urlObj.port ? JSON.stringify(Number(urlObj.port)) : urlObj.protocol === "http:" ? "80" : "443"},`,
        `  headers: ${headersLines},`,
        "}",
      ].join("\n")
    : [
        "{",
        `  method: ${JSON.stringify(m)},`,
        `  headers: ${headersLines},`,
        "}",
      ].join("\n");

  const snippet = [
    "const https = require('https');",
    "const http = require('http');",
    "",
    `const url = ${JSON.stringify(finalUrl || "")};`,
    `const options = ${optionsBlock};`,
    "",
    "const lib = url.startsWith('http://') ? http : https;",
    "",
    "const req = lib.request(url, options, (res) => {",
    "  let data = '';",
    "  res.on('data', (chunk) => (data += chunk));",
    "  res.on('end', () => {",
    "    console.log('Status:', res.statusCode);",
    "    const ct = res.headers['content-type'] || '';",
    "    try {",
    "      if (ct.includes('application/json')) console.log(JSON.parse(data || 'null'));",
    "      else console.log(data);",
    "    } catch {",
    "      console.log(data);",
    "    }",
    "  });",
    "});",
    "",
    "req.on('error', (err) => console.error('Request failed:', err.message));",
    "",
    hasBody ? `req.write(${JSON.stringify(bodyValue)});` : "",
    "req.end();",
  ]
    .filter(Boolean)
    .join("\n");

  return snippet;
}

export { toCurl, toFetch, toAxios, toPythonRequests, toNodeHttps };
