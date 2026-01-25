// src/utils/envs.js
export const DEFAULT_ENVS = ["dev", "qa", "prod"];

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

export function normalizeEnvStore(store) {
  const s = isPlainObject(store) ? store : {};
  const out = {};
  for (const [name, val] of Object.entries(s)) {
    if (!isPlainObject(val)) continue;

    // New shape: { vars: {}, secrets: {} }
    if ("vars" in val || "secrets" in val) {
      out[name] = {
        vars: isPlainObject(val.vars) ? { ...val.vars } : {},
        secrets: isPlainObject(val.secrets) ? { ...val.secrets } : {},
      };
      continue;
    }

    // Legacy shape: env -> { k: v }
    out[name] = { vars: { ...val }, secrets: {} };
  }

  for (const d of DEFAULT_ENVS) {
    if (!out[d]) out[d] = { vars: {}, secrets: {} };
  }

  return out;
}

export function buildEnvNames(store) {
  const s = isPlainObject(store) ? store : {};
  const keys = Object.keys(s);
  const base = DEFAULT_ENVS.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !DEFAULT_ENVS.includes(k)).sort();
  return [...base, ...rest];
}

export function envVarsOnly(store, envName) {
  const e = store?.[envName];
  if (!e) return {};
  if (isPlainObject(e) && ("vars" in e || "secrets" in e)) return isPlainObject(e.vars) ? e.vars : {};
  if (isPlainObject(e)) return e; // legacy
  return {};
}

export function envSecretsOnly(store, envName) {
  const e = store?.[envName];
  if (!e) return {};
  if (isPlainObject(e) && ("vars" in e || "secrets" in e)) return isPlainObject(e.secrets) ? e.secrets : {};
  return {};
}

export function envMerged(store, envName) {
  return { ...envVarsOnly(store, envName), ...envSecretsOnly(store, envName) };
}
