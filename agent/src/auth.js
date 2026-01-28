import crypto from "crypto";
import { getToken, setToken } from "./store.js";

export function makePairCode() {
  // short, readable
  return crypto.randomBytes(4).toString("hex"); // e.g. "a1b2c3d4"
}

export function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function getOrCreateToken() {
  const existing = getToken();
  if (existing) return existing;
  return setToken(makeToken());
}

export function requireToken(req, res, next) {
  const token = getToken();
  if (!token) {
    return res.status(401).json({ ok: false, error: "Agent not paired yet" });
  }
  const got = String(req.headers["x-bhejo-token"] || "");
  if (!got || got !== token) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
  next();
}
