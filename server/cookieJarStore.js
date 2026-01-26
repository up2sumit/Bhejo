// server/cookieJarStore.js
// Persistent cookie-jar storage (JSON files on disk).
// - One file per jarId (safe filename)
// - In-memory cache + debounced flush
// - Atomic writes (tmp + rename)
// Designed for local/dev use (similar to Postman desktop persistence)

import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data", "cookiejars");
const FLUSH_DELAY_MS = 400;

function safeJarId(jarId) {
  const raw = String(jarId || "default");
  // Prevent traversal and keep names reasonable
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  return cleaned || "default";
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function jarFilePath(jarId) {
  return path.join(DATA_DIR, `${safeJarId(jarId)}.json`);
}

// Cache: jarId -> { jar: Map(host -> cookies[]), dirty: boolean, timer: Timeout|null }
const cache = new Map();

function plainToMap(obj) {
  const m = new Map();
  const o = obj && typeof obj === "object" ? obj : {};
  for (const [host, list] of Object.entries(o)) {
    m.set(host, Array.isArray(list) ? list : []);
  }
  return m;
}

function mapToPlain(m) {
  const out = {};
  for (const [host, list] of (m || new Map()).entries()) {
    out[host] = Array.isArray(list) ? list : [];
  }
  return out;
}

async function readJarFromDisk(jarId) {
  await ensureDir();
  const fp = jarFilePath(jarId);

  try {
    const txt = await fs.readFile(fp, "utf-8");
    const parsed = JSON.parse(txt);

    // Support two shapes:
    // { version, savedAt, jar: { host: [...] } }
    // OR legacy: { host: [...] }
    const jarObj = parsed?.jar && typeof parsed.jar === "object" ? parsed.jar : parsed;
    return plainToMap(jarObj);
  } catch {
    return new Map();
  }
}

async function writeJarToDisk(jarId, jarMap) {
  await ensureDir();
  const fp = jarFilePath(jarId);
  const tmp = fp + ".tmp";

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    jar: mapToPlain(jarMap),
  };

  const txt = JSON.stringify(payload, null, 2);
  await fs.writeFile(tmp, txt, "utf-8");
  await fs.rename(tmp, fp); // atomic-ish replace
}

export async function getJar(jarId) {
  const id = safeJarId(jarId);
  const cached = cache.get(id);
  if (cached) return cached.jar;

  const jar = await readJarFromDisk(id);
  cache.set(id, { jar, dirty: false, timer: null });
  return jar;
}

export async function clearJar(jarId) {
  const id = safeJarId(jarId);
  const entry = cache.get(id);
  if (entry?.timer) clearTimeout(entry.timer);
  cache.delete(id);

  await ensureDir();
  const fp = jarFilePath(id);
  try {
    await fs.unlink(fp);
  } catch {
    // ignore
  }
}

export function markDirty(jarId) {
  const id = safeJarId(jarId);
  const entry = cache.get(id);
  if (!entry) return;

  entry.dirty = true;

  if (entry.timer) return;

  entry.timer = setTimeout(async () => {
    entry.timer = null;
    if (!entry.dirty) return;

    entry.dirty = false;
    try {
      await writeJarToDisk(id, entry.jar);
    } catch {
      // ignore in dev
    }
  }, FLUSH_DELAY_MS);
}

export async function flushJar(jarId) {
  const id = safeJarId(jarId);
  const entry = cache.get(id);
  if (!entry) return;

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  entry.dirty = false;
  await writeJarToDisk(id, entry.jar);
}

// Best-effort flush on shutdown (helps avoid losing last cookies)
process.on("SIGINT", async () => {
  try {
    for (const [id, entry] of cache.entries()) {
      if (entry?.dirty) await writeJarToDisk(id, entry.jar);
    }
  } catch {
    // ignore
  } finally {
    process.exit(0);
  }
});
