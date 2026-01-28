import fs from "fs";
import path from "path";
import os from "os";
import { CookieJar } from "tough-cookie";

const APP_DIR = path.join(os.homedir(), ".bhejo-agent");
const JARS_DIR = path.join(APP_DIR, "cookiejars");

function ensureDirs() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
  if (!fs.existsSync(JARS_DIR)) fs.mkdirSync(JARS_DIR, { recursive: true });
}

function jarFile(jarId) {
  ensureDirs();
  const safe = String(jarId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(JARS_DIR, `${safe}.json`);
}

export function loadJar(jarId = "default") {
  const file = jarFile(jarId);
  if (!fs.existsSync(file)) return new CookieJar();
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const json = JSON.parse(raw);
    return CookieJar.fromJSON(json);
  } catch {
    return new CookieJar();
  }
}

export function saveJar(jarId = "default", jar) {
  const file = jarFile(jarId);
  const json = jar.toJSON();
  fs.writeFileSync(file, JSON.stringify(json, null, 2), "utf-8");
}

export async function applySetCookie(jarId, url, setCookieArr) {
  const jar = loadJar(jarId);
  const list = Array.isArray(setCookieArr) ? setCookieArr : [];
  for (const sc of list) {
    if (!sc) continue;
    await new Promise((resolve) => {
      jar.setCookie(sc, url, { ignoreError: true }, () => resolve());
    });
  }
  saveJar(jarId, jar);
  return jar;
}
