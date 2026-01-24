// src/utils/envStore.js
// Phase 4.5 - Persist envDelta returned from scripts into envVarsAll[envName]
// Phase 4.6 - Diff helpers for toast + console logs

export function normalizeEnvDelta(envDelta) {
  if (!envDelta || typeof envDelta !== "object" || Array.isArray(envDelta)) return {};
  return envDelta;
}

// Apply delta to a single env object (not envVarsAll)
export function applyEnvDelta(baseEnv, envDelta) {
  const out = { ...(baseEnv || {}) };
  const delta = normalizeEnvDelta(envDelta);

  for (const [k, v] of Object.entries(delta)) {
    const key = String(k || "").trim();
    if (!key) continue;

    if (v === null || v === undefined) {
      delete out[key];
    } else {
      out[key] = String(v);
    }
  }

  return out;
}

// Apply delta into envVarsAll for envName (returns a new envVarsAll object)
export function applyEnvDeltaToEnvVarsAll(envVarsAll, envName, envDelta) {
  const all =
    envVarsAll && typeof envVarsAll === "object" && !Array.isArray(envVarsAll)
      ? envVarsAll
      : {};

  const name = String(envName || "dev").trim() || "dev";
  const current = all?.[name] && typeof all[name] === "object" ? all[name] : {};

  const nextEnv = applyEnvDelta(current, envDelta);

  return {
    ...all,
    [name]: nextEnv,
  };
}

/**
 * Phase 4.6 helpers
 * Changes shape:
 * {
 *   added:   [{ key, to }],
 *   updated: [{ key, from, to }],
 *   removed: [{ key, from }]
 * }
 */
export function diffEnvs(prevEnv = {}, nextEnv = {}) {
  const prev = prevEnv && typeof prevEnv === "object" ? prevEnv : {};
  const next = nextEnv && typeof nextEnv === "object" ? nextEnv : {};

  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));
  const allKeys = new Set([...prevKeys, ...nextKeys]);

  const added = [];
  const updated = [];
  const removed = [];

  for (const key of allKeys) {
    const inPrev = prevKeys.has(key);
    const inNext = nextKeys.has(key);

    if (!inPrev && inNext) {
      added.push({ key, to: String(next[key]) });
      continue;
    }
    if (inPrev && !inNext) {
      removed.push({ key, from: String(prev[key]) });
      continue;
    }

    const from = String(prev[key]);
    const to = String(next[key]);
    if (from !== to) updated.push({ key, from, to });
  }

  return { added, updated, removed };
}

// When we have an envDelta, compute changes *relative to prevEnv*
export function changesFromDelta(prevEnv = {}, envDelta = {}) {
  const prev = prevEnv && typeof prevEnv === "object" ? prevEnv : {};
  const delta = normalizeEnvDelta(envDelta);

  const added = [];
  const updated = [];
  const removed = [];

  for (const [k, v] of Object.entries(delta)) {
    const key = String(k || "").trim();
    if (!key) continue;

    const had = Object.prototype.hasOwnProperty.call(prev, key);

    if (v === null || v === undefined) {
      removed.push({ key, from: had ? String(prev[key]) : "" });
      continue;
    }

    const to = String(v);
    if (!had) added.push({ key, to });
    else {
      const from = String(prev[key]);
      if (from !== to) updated.push({ key, from, to });
    }
  }

  return { added, updated, removed };
}
