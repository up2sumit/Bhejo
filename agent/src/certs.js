import fs from "fs";

/**
 * Returns a Buffer CA bundle or null.
 * Priority:
 *  1) caPem string (from UI)
 *  2) caPemPath (from local filesystem)
 */
export function loadCaBundle({ caPem, caPemPath } = {}) {
  const pem = String(caPem || "").trim();
  if (pem) {
    // normalize: allow pasting without trailing newline
    return Buffer.from(pem.endsWith("\n") ? pem : pem + "\n");
  }

  const p = String(caPemPath || "").trim();
  if (!p) return null;

  try {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch {
    // ignore
  }
  return null;
}
