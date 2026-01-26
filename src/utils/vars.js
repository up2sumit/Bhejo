/**
 * Variable resolution utilities for Bhejo.
 *
 * Tokens: {{var}} or {{nested.var}}.
 * - replaceVars(): replaces tokens inside a string
 * - applyVarsToRequest(): applies replacement across request draft (URL/params/headers/body/auth/scripts/tests)
 * - resolveTemplateSegments(): returns segments so UI can highlight resolved vs missing vars
 */

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function getVarValue(name, envVars) {
  if (!name) return undefined;
  const parts = String(name).split(".");
  let cur = envVars;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (!hasOwn(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function createVarMeta() {
  return {
    used: new Set(),
    resolved: new Set(),
    missing: new Set(),
  };
}

export function metaToPlain(meta) {
  const usedKeys = Array.from(meta?.used || []).sort();
  const resolvedKeys = Array.from(meta?.resolved || []).sort();
  const missingKeys = Array.from(meta?.missing || []).sort();
  return {
    usedKeys,
    resolvedKeys,
    missingKeys,
    usedCount: usedKeys.length,
    resolvedCount: resolvedKeys.length,
    missingCount: missingKeys.length,
  };
}

/**
 * Returns an array of segments:
 * - { t: "text", text }
 * - { t: "var", name, resolved, value, display }
 *
 * UI can render resolved vars as pills and missing vars as red {{token}}.
 */
export function resolveTemplateSegments(input, envVars, metaOut) {
  const s = String(input ?? "");
  const segs = [];
  let last = 0;

  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(s)) !== null) {
    const start = m.index;
    if (start > last) segs.push({ t: "text", text: s.slice(last, start) });

    const name = m[1];
    const rawVal = getVarValue(name, envVars);

    // Consider empty-string as "missing" (common in env setups)
    const hasValue = rawVal !== undefined && rawVal !== null && String(rawVal) !== "";

    if (metaOut?.used) metaOut.used.add(name);
    if (hasValue) {
      if (metaOut?.resolved) metaOut.resolved.add(name);
      const v = String(rawVal);
      segs.push({ t: "var", name, resolved: true, value: v, display: v });
    } else {
      if (metaOut?.missing) metaOut.missing.add(name);
      segs.push({ t: "var", name, resolved: false, value: null, display: `{{${name}}}` });
    }

    last = start + m[0].length;
  }

  if (last < s.length) segs.push({ t: "text", text: s.slice(last) });
  if (!segs.length) segs.push({ t: "text", text: s });
  return segs;
}

export function replaceVars(input, envVars, metaOut) {
  const segs = resolveTemplateSegments(input, envVars, metaOut);
  return segs
    .map((seg) => {
      if (seg.t === "text") return seg.text;
      return seg.resolved ? seg.value : seg.display;
    })
    .join("");
}

function deepResolve(value, envVars, metaOut) {
  if (value == null) return value;

  if (typeof value === "string") {
    return replaceVars(value, envVars, metaOut);
  }

  if (Array.isArray(value)) {
    return value.map((v) => deepResolve(v, envVars, metaOut));
  }

  if (typeof value === "object") {
    const out = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) {
      const rk = replaceVars(k, envVars, metaOut);
      out[rk] = deepResolve(v, envVars, metaOut);
    }
    return out;
  }

  // number, boolean, function, etc.
  return value;
}

export function applyVarsToRequest(draft, envVars, metaOut) {
  const d = draft || {};

  const out = { ...d };

  // URL + Query Params
  out.url = replaceVars(d.url ?? "", envVars, metaOut);
  if (Array.isArray(d.params)) {
    out.params = d.params.map((p) => ({
      ...p,
      key: replaceVars(p?.key ?? "", envVars, metaOut),
      value: replaceVars(p?.value ?? "", envVars, metaOut),
    }));
  }

  // Headers
  if (Array.isArray(d.headers)) {
    out.headers = d.headers.map((h) => ({
      ...h,
      key: replaceVars(h?.key ?? "", envVars, metaOut),
      value: replaceVars(h?.value ?? "", envVars, metaOut),
    }));
  }

  // Body
  // bodyMode: "json" | "text" | "formurl" | "formdata"
  out.bodyMode = d.bodyMode || "json";

  // raw body string (JSON / text)
  if (typeof d.body === "string") out.body = replaceVars(d.body, envVars, metaOut);
  else out.body = deepResolve(d.body, envVars, metaOut);

  // x-www-form-urlencoded rows
  if (Array.isArray(d.bodyFormUrl)) {
    out.bodyFormUrl = d.bodyFormUrl.map((r) => ({
      ...r,
      key: replaceVars(r?.key ?? "", envVars, metaOut),
      value: replaceVars(r?.value ?? "", envVars, metaOut),
    }));
  } else {
    out.bodyFormUrl = d.bodyFormUrl;
  }

  // form-data rows (text + file placeholders)
  if (Array.isArray(d.bodyFormData)) {
    out.bodyFormData = d.bodyFormData.map((r) => {
      const kind = (r?.kind || "text").toLowerCase();
      if (kind === "file") {
        return {
          ...r,
          key: replaceVars(r?.key ?? "", envVars, metaOut),
          // keep fileRefId / fileName / fileType / fileSize as-is
        };
      }
      return {
        ...r,
        key: replaceVars(r?.key ?? "", envVars, metaOut),
        value: replaceVars(r?.value ?? "", envVars, metaOut),
      };
    });
  } else {
    out.bodyFormData = d.bodyFormData;
  }

  // Auth config (object)
  out.auth = deepResolve(d.auth, envVars, metaOut);

  // Scripts + tests
  if (typeof d.preRequestScript === "string") {
    out.preRequestScript = replaceVars(d.preRequestScript, envVars, metaOut);
  }
  if (typeof d.testScript === "string") {
    out.testScript = replaceVars(d.testScript, envVars, metaOut);
  }
  out.tests = deepResolve(d.tests, envVars, metaOut);

  return out;
}
