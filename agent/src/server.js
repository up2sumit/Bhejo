import express from "express";
import cors from "cors";

import { makePairCode, getOrCreateToken, requireToken } from "./auth.js";
import { getConfig, setConfig, getToken } from "./store.js";
import { sendOnce } from "./send.js";

const PORT = process.env.BHEJO_AGENT_PORT ? Number(process.env.BHEJO_AGENT_PORT) : 3131;
const HOST = "127.0.0.1";

export function startAgent() {
  const app = express();

  // ✅ CORS that won't break OPTIONS preflight
  const corsMw = cors({
    origin(origin, cb) {
      // allow curl / Postman / no-origin tools
      if (!origin) return cb(null, true);

      // ✅ allow any localhost origin (dev ports can change)
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return cb(null, true);
      }

      // If your UI is deployed on https, add it here later, e.g.:
      // if (origin === "https://your-ui-domain.com") return cb(null, true);

      // IMPORTANT: don't throw error here; return false cleanly
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "x-bhejo-token",
      "Authorization",
      "Accept"
    ],
    maxAge: 600
  });

  app.use(corsMw);

  // ✅ This line is the preflight fix
  app.options("*", corsMw);

  // JSON body
  app.use(express.json({ limit: "20mb" }));

  // Pairing: one-time code printed in terminal on each boot
  const pairCode = makePairCode();
  console.log("\n==============================");
  console.log("Bhejo Agent running");
  console.log(`Health:  http://${HOST}:${PORT}/health`);
  console.log("PAIR CODE (one-time):", pairCode);
  console.log("Use this code once from UI to get token.");
  console.log("==============================\n");

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      agent: "bhejo-agent",
      paired: !!getToken(),
      port: PORT
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

  // ✅ Phase 2: execute requests
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
