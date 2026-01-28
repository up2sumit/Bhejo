import fs from "fs";
import path from "path";
import os from "os";

const APP_DIR = path.join(os.homedir(), ".bhejo-agent");
const STORE_FILE = path.join(APP_DIR, "store.json");

function ensureDir() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
}

function defaultStore() {
  return {
    token: "",
    config: {
      // Proxy settings (enterprise)
      proxyMode: "off", // "off" | "env" | "custom" | "system"
      customProxy: {
        protocol: "http", // "http" | "https"
        host: "127.0.0.1",
        port: 8080,
        auth: { enabled: false, user: "", pass: "" }
      },
      proxyFor: { http: true, https: true },
      noProxy: ["localhost", "127.0.0.1"],

      // TLS settings (enterprise)
      tls: {
        rejectUnauthorized: true,
        // Provide either caPem (preferred from UI) or caPemPath (optional local path)
        caPem: "",
        caPemPath: ""
      }
    }
  };
}

export function loadStore() {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) {
    const init = defaultStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(init, null, 2), "utf-8");
    return init;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const d = defaultStore();
    return {
      ...d,
      ...parsed,
      config: {
        ...d.config,
        ...(parsed.config || {}),
        customProxy: { ...d.config.customProxy, ...(parsed.config?.customProxy || {}) },
        proxyFor: { ...d.config.proxyFor, ...(parsed.config?.proxyFor || {}) },
        tls: { ...d.config.tls, ...(parsed.config?.tls || {}) }
      }
    };
  } catch {
    const init = defaultStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(init, null, 2), "utf-8");
    return init;
  }
}

export function saveStore(next) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(next, null, 2), "utf-8");
}

export function getToken() {
  return loadStore().token || "";
}

export function setToken(token) {
  const s = loadStore();
  s.token = token;
  saveStore(s);
  return token;
}

export function getConfig() {
  return loadStore().config;
}

export function setConfig(config) {
  const s = loadStore();
  s.config = {
    ...s.config,
    ...config,
    customProxy: { ...s.config.customProxy, ...(config.customProxy || {}) },
    proxyFor: { ...s.config.proxyFor, ...(config.proxyFor || {}) },
    tls: { ...s.config.tls, ...(config.tls || {}) }
  };
  saveStore(s);
  return s.config;
}
