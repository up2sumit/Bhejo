import express from "express";
import cors from "cors";

import { makePairCode, getOrCreateToken, requireToken } from "./auth.js";
import { getConfig, setConfig, getToken } from "./store.js";
import { sendOnce } from "./send.js";

// ✅ configurable
const PORT = process.env.BHEJO_AGENT_PORT ? Number(process.env.BHEJO_AGENT_PORT) : 3131;
// default is local-only; if you want other machines to reach it: set BHEJO_AGENT_HOST=0.0.0.0
const HOST = process.env.BHEJO_AGENT_HOST || "127.0.0.1";

// ✅ allow UI origins beyond localhost (comma-separated list)
const EXTRA_UI_ORIGINS = (process.env.BHEJO_UI_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/postman/no-origin tools

  // always allow localhost dev
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    return true;
  }

  // allow additional explicit origins (for hostname/IP based UI)
  if (EXTRA_UI_ORIGINS.includes(origin)) return true;

  return false;
}

export function startAgent() {
  const app = express();

  const corsMw = cors({
    origin(origin, cb) {
      return cb(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-bhejo-token", "Authorization", "Accept"],
    maxAge: 600
  });

  app.use(corsMw);
  app.options("*", corsMw);

  app.use(express.json({ limit: "20mb" }));

  // Pair code is generated on boot
  const pairCode = makePairCode();

  // Print clear instructions
  const printedHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log("\n==============================");
  console.log("Bhejo Agent running");
  console.log(`Health:  http://${printedHost}:${PORT}/health`);
  console.log(`Base URL to use in UI: http://${printedHost}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log("NOTE: Agent is reachable from other machines (0.0.0.0). Use your PC IP in UI base URL.");
    if (EXTRA_UI_ORIGINS.length) console.log("Allowed UI origins:", EXTRA_UI_ORIGINS);
    else console.log("TIP: set BHEJO_UI_ORIGINS=http://<UI_HOST>:<UI_PORT> to avoid CORS issues.");
  }
  console.log("PAIR CODE (one-time):", pairCode);
  console.log("Use this code once from UI to get token.");
  console.log("==============================\n");

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      agent: "bhejo-agent",
      paired: !!getToken(),
      port: PORT,
      host: HOST
    });
  });

  app.post("/pair", (req, res) => {
    const got = String(req.body?.pairCode || "");
    if (!got || got !== pairCode) {
      return res.status(401).json({ ok: false, error: "Invalid pairCode" });
    }
    const token = getOrCreateToken();
    res.json({ ok: true, token });
  });

  app.get("/config", requireToken, (req, res) => {
    res.json({ ok: true, config: getConfig() });
  });

  app.post("/config", requireToken, (req, res) => {
    const next = req.body?.config;
    if (!next || typeof next !== "object") {
      return res.status(400).json({ ok: false, error: "Missing config object" });
    }
    const saved = setConfig(next);
    res.json({ ok: true, config: saved });
  });

  // execute requests
  app.post("/send", requireToken, async (req, res) => {
    try {
      const result = await sendOnce(req.body || {});
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: "Send failed",
        message: e?.message || String(e)
      });
    }
  });

  app.listen(PORT, HOST, () => {});
}
