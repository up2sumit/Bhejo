// src/utils/fileCache.js
// In-browser file cache so Saved/History can store "file placeholders" like Postman stores a file path.
// Files are kept only in-memory for the current session (reload clears them).

const GLOBAL_KEY = "__bhejo_file_cache__";

function getMap() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

export function putFile(file) {
  const id = `file_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  getMap().set(id, file);
  return id;
}

export function getFile(fileRefId) {
  if (!fileRefId) return null;
  return getMap().get(fileRefId) || null;
}

export function removeFile(fileRefId) {
  if (!fileRefId) return;
  getMap().delete(fileRefId);
}

export async function fileToBase64(file) {
  // Use ArrayBuffer -> base64 (chunked) to avoid stack overflow
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
