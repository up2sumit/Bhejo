import express from "express";
import cors from "cors";

import { makePairCode, getOrCreateToken, requireToken } from "./auth.js";
import { getConfig, setConfig, getToken } from "./store.js";
import { sendOnce } from "./send.js";

// Config
const PORT = process.env.BHEJO_AGENT_PORT ? Number(process.env.BHEJO_AGENT_PORT) : 3131;
// default is local-only; if you want other machines to reach it: set BHEJO_AGENT_HOST=0.0.0.0
const HOST = process.env.BHEJO_AGENT_HOST || "127.0.0.1";

// Allow UI origins beyond localhost (comma-separated list)
const EXTRA_UI_ORIGINS = (process.env.BHEJO_UI_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Optional: allow any origin (useful in locked-down corp browsers)
const ALLOW_ANY_ORIGIN = process.env.BHEJO_CORS_ANY === "1";

function isAllowedOrigin(origin) {
  if (ALLOW_ANY_ORIGIN) return true;
  if (!origin) return true; // curl/postman/no-origin tools

  // always allow localhost dev
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    return true;
  }

  // allow additional explicit origins
  if (EXTRA_UI_ORIGINS.includes(origin)) return true;

  return false;
}

export function startAgent() {
  const DEBUG = process.env.BHEJO_DEBUG === "1";
  const dbg = (...a) => DEBUG && console.log("[Bhejo Agent]", ...a);

  const app = express();

  const corsMw = cors({
    origin(origin, cb) {
      return cb(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-bhejo-token", "Authorization", "Accept"],
    maxAge: 600,
  });

  app.use(corsMw);
  app.options("*", corsMw);
  app.use(express.json({ limit: "20mb" }));

  // Force JSON + no-cache for API responses
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Pair code is generated on boot
  let pairCode = makePairCode();

  // Print clear instructions
  const printedHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log("\n==============================");
  console.log("Bhejo Agent running");
  console.log(`Health:   http://${printedHost}:${PORT}/health`);
  console.log(`Pair (GET):  http://${printedHost}:${PORT}/pair`);
  console.log(`Base URL in UI: http://${printedHost}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log("NOTE: Agent reachable from other machines. Use your PC IP in UI base URL.");
    if (EXTRA_UI_ORIGINS.length) console.log("Allowed UI origins:", EXTRA_UI_ORIGINS);
    else console.log("TIP: set BHEJO_UI_ORIGINS=http://<UI_HOST>:<UI_PORT> to avoid CORS issues.");
  }
  console.log("PAIR CODE (one-time):", pairCode);
  console.log("Use this code from UI to get token.");
  console.log("==============================\n");

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      agent: "bhejo-agent",
      paired: !!getToken(),
      port: PORT,
      host: HOST,
      debug: DEBUG,
      allowAnyOrigin: ALLOW_ANY_ORIGIN,
    });
  });

  // Convenience: show current pair code (JSON)
  app.get("/pair", (req, res) => {
    res.json({ ok: true, pairCode });
  });

  // Pair: exchange pairCode -> token. Rotates pairCode on success.
  app.post("/pair", (req, res) => {
    const got = String(req.body?.pairCode || "");
    if (!got || got !== pairCode) {
      return res.status(401).json({ ok: false, error: "Invalid pair code" });
    }
    const token = getOrCreateToken();
    pairCode = makePairCode(); // rotate after success
    return res.json({ ok: true, token });
  });

  app.get("/config", requireToken, (req, res) => {
    res.json({ ok: true, config: getConfig() });
  });

  app.post("/config", requireToken, (req, res) => {
    const next = setConfig(req.body?.config || {});
    res.json({ ok: true, config: next });
  });

  app.post("/send", requireToken, async (req, res) => {
    try {
      const result = await sendOnce(req.body || {});
      res.json({ ok: true, result });
    } catch (e) {
      console.error("[Bhejo Agent] /send failed", {
        message: e?.message || String(e),
        stack: e?.stack,
      });
      res.status(500).json({
        ok: false,
        error: "Send failed",
        message: e?.message || String(e),
        ...(DEBUG ? { stack: e?.stack || "" } : {}),
      });
    }
  });

  // Helpful 404 JSON
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "Not found", path: req.path });
  });

  app.listen(PORT, HOST, () => {
    dbg(`listening on http://${HOST}:${PORT}`);
    dbg("extra UI origins:", EXTRA_UI_ORIGINS);
  });
}
