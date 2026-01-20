import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;

// --- IMPORTANT SECURITY ---
// Add domains you allow here (edit this list)
const ALLOWED_HOSTS = new Set([
  "jsonplaceholder.typicode.com",
  "library-management-api-i6if.onrender.com"
]);

// Increase if needed (default 1mb)
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ type: "*/*", limit: "5mb" }));
app.use(cors({ origin: "http://localhost:5173", credentials: false }));

function isAllowedTarget(targetUrl) {
  try {
    const u = new URL(targetUrl);
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function sanitizeIncomingHeaders(headers) {
  const clean = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    // Block hop-by-hop and unsafe headers
    if ([
      "host",
      "connection",
      "content-length",
      "accept-encoding",
      "referer",
      "origin"
    ].includes(key)) continue;

    // allow everything else
    clean[k] = v;
  }
  return clean;
}

function sanitizeOutgoingHeaders(headers) {
  const clean = {};
  for (const [k, v] of headers.entries()) {
    const key = k.toLowerCase();
    // Remove headers that can cause browser issues
    if (["content-encoding", "transfer-encoding"].includes(key)) continue;
    clean[key] = v;
  }
  return clean;
}

app.post("/proxy", async (req, res) => {
  const { url, method, headers, body } = req.body || {};

  if (!url || !method) {
    return res.status(400).json({ error: "Missing url or method" });
  }

  if (!isAllowedTarget(url)) {
    return res.status(403).json({
      error: "Target host not allowed",
      allowed: Array.from(ALLOWED_HOSTS)
    });
  }

  try {
    const options = {
      method: method.toUpperCase(),
      headers: sanitizeIncomingHeaders(headers),
    };

    // Attach body only if method supports it
    if (!["GET", "HEAD"].includes(options.method) && body !== undefined && body !== null && body !== "") {
      options.body = body;
    }

    const upstream = await fetch(url, options);
    const raw = await upstream.text();

    const outHeaders = sanitizeOutgoingHeaders(upstream.headers);

    res.status(upstream.status).json({
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
      body: raw
    });
  } catch (e) {
    res.status(500).json({ error: "Proxy request failed", message: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Bhejo proxy running on http://localhost:${PORT}`);
  console.log("Allowed hosts:", Array.from(ALLOWED_HOSTS));
});

app.get("/", (req, res) => {
  res.send("Bhejo proxy is running. Use POST /proxy");
});
