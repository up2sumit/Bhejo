// src/utils/assertions.js

function getHeaderValue(headersObj, headerName) {
  if (!headersObj || typeof headersObj !== "object") return "";
  const target = String(headerName || "").trim().toLowerCase();
  if (!target) return "";

  for (const [k, v] of Object.entries(headersObj)) {
    if (String(k).toLowerCase() === target) return String(v ?? "");
  }
  return "";
}

function getByPathWithExists(obj, path) {
  if (!path) return { exists: false, value: undefined };
  const parts = String(path)
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);

  let cur = obj;

  for (const p of parts) {
    if (cur == null || (typeof cur !== "object" && typeof cur !== "function")) {
      return { exists: false, value: undefined };
    }

    const has = Object.prototype.hasOwnProperty.call(cur, p);
    if (!has) return { exists: false, value: undefined };

    cur = cur[p];
  }

  return { exists: true, value: cur };
}

function normalizeType(val) {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val; // string, number, boolean, object, undefined, function
}

function parseStatusExpected(expected) {
  const s = String(expected ?? "").trim();
  if (!s) return { mode: "single", values: [200] };

  // "200-299"
  const range = s.match(/^\s*(\d{3})\s*-\s*(\d{3})\s*$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { mode: "range", min: Math.min(a, b), max: Math.max(a, b) };
  }

  // "200,201,204"
  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));

  if (parts.length) return { mode: "list", values: parts };

  const n = Number(s);
  if (Number.isFinite(n)) return { mode: "single", values: [n] };

  return { mode: "single", values: [200] };
}

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function parseRequiredPaths(expected) {
  // "id, data.id, user.name"
  const s = String(expected ?? "");
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * runAssertions
 * - Skips tests where enabled === false (so unchecked tests do NOT run)
 * - Supports both "legacy" types and new Builder UI types:
 *   - status_between, response_time_lt, header_contains (headerName/contains),
 *     json_path_equals (expectedValue), json_has_key (key)
 */
export function runAssertions({ tests, response }) {
  const list = Array.isArray(tests) ? tests : [];
  const enabledTests = list.filter((t) => t && t.enabled !== false);

  if (enabledTests.length === 0) {
    return { total: 0, passed: 0, failed: 0, results: [] };
  }

  const results = [];
  const total = enabledTests.length;

  const status = response?.status;
  const timeMs = response?.timeMs;
  const json = response?.json;
  const headers = response?.headers || {};

  for (const t of enabledTests) {
    const type = String(t?.type || "").trim();

    // ---- Builder UI: Status equals ----
    if (type === "status_equals") {
      const expected = Number(t.expected);
      const pass = status === expected;
      results.push({
        pass,
        message: pass
          ? `Status is ${expected}`
          : `Expected status ${expected}, got ${status}`,
      });
      continue;
    }

    // ---- Builder UI: Status between (min/max) ----
    if (type === "status_between") {
      const min = Number(t.min ?? 200);
      const max = Number(t.max ?? 299);
      const pass = typeof status === "number" && status >= min && status <= max;
      results.push({
        pass,
        message: pass
          ? `Status is in ${min}-${max}`
          : `Expected status in ${min}-${max}, got ${status}`,
      });
      continue;
    }

    // ---- Legacy: time_lt + Builder UI: response_time_lt ----
    if (type === "time_lt" || type === "response_time_lt") {
      const max = Number(t.maxMs ?? t.expected);
      const pass = Number(timeMs) < max;
      results.push({
        pass,
        message: pass
          ? `Time ${timeMs}ms < ${max}ms`
          : `Expected time < ${max}ms, got ${timeMs}ms`,
      });
      continue;
    }

    // ---- Legacy: json_equals + Builder UI: json_path_equals ----
    if (type === "json_equals" || type === "json_path_equals") {
      const path = (t.path || "").trim();
      const expected = (t.expectedValue ?? t.expected ?? "").toString();
      const got = getByPathWithExists(json, path);
      const actual = got.value;

      const pass = got.exists && actual != null && String(actual) === expected;
      results.push({
        pass,
        message: pass
          ? `JSON ${path} equals ${expected}`
          : `Expected JSON ${path} == ${expected}, got ${got.exists ? actual : "missing"}`,
      });
      continue;
    }

    // ---- Legacy: json_contains ----
    if (type === "json_contains") {
      const path = (t.path || "").trim();
      const expected = (t.expected ?? "").toString();
      const got = getByPathWithExists(json, path);
      const actual = got.value;

      const pass = got.exists && actual != null && String(actual).includes(expected);
      results.push({
        pass,
        message: pass
          ? `JSON ${path} contains "${expected}"`
          : `Expected JSON ${path} to contain "${expected}", got ${got.exists ? actual : "missing"}`,
      });
      continue;
    }

    // ---- New: Status in list/range (kept) ----
    if (type === "status_in") {
      const cfg = parseStatusExpected(t.expected);
      let pass = false;

      if (typeof status !== "number") pass = false;
      else if (cfg.mode === "range") pass = status >= cfg.min && status <= cfg.max;
      else if (cfg.mode === "list" || cfg.mode === "single") pass = cfg.values.includes(status);

      const label =
        cfg.mode === "range"
          ? `${cfg.min}-${cfg.max}`
          : cfg.values.join(",");

      results.push({
        pass,
        message: pass
          ? `Status is in ${label}`
          : `Expected status in ${label}, got ${status}`,
      });
      continue;
    }

    // ---- Header checks (supports both legacy and Builder UI fields) ----
    if (type === "header_exists") {
      const headerName = (t.headerName ?? t.path ?? "").trim();
      const v = getHeaderValue(headers, headerName);
      const pass = v !== "";
      results.push({
        pass,
        message: pass
          ? `Header "${headerName}" exists`
          : `Expected header "${headerName}" to exist`,
      });
      continue;
    }

    if (type === "header_equals") {
      const headerName = (t.headerName ?? t.path ?? "").trim();
      const expected = String(t.expected ?? "");
      const v = getHeaderValue(headers, headerName);
      const pass = v !== "" && v === expected;
      results.push({
        pass,
        message: pass
          ? `Header "${headerName}" equals "${expected}"`
          : `Expected header "${headerName}" == "${expected}", got "${v}"`,
      });
      continue;
    }

    if (type === "header_contains") {
      const headerName = (t.headerName ?? t.path ?? "").trim();
      const expected = String(t.contains ?? t.expected ?? "");
      const v = getHeaderValue(headers, headerName);
      const pass = v !== "" && v.toLowerCase().includes(expected.toLowerCase());
      results.push({
        pass,
        message: pass
          ? `Header "${headerName}" contains "${expected}"`
          : `Expected header "${headerName}" to contain "${expected}", got "${v}"`,
      });
      continue;
    }

    // ---- New: JSON exists / type / not empty ----
    if (type === "json_exists") {
      const path = (t.path || "").trim();
      const got = getByPathWithExists(json, path);
      const pass = got.exists;
      results.push({
        pass,
        message: pass
          ? `JSON ${path} exists`
          : `Expected JSON ${path} to exist`,
      });
      continue;
    }

    if (type === "json_type") {
      const path = (t.path || "").trim();
      const expected = String(t.expected ?? "").trim().toLowerCase(); // string|number|boolean|object|array|null
      const got = getByPathWithExists(json, path);

      const actualType = normalizeType(got.value);
      const pass = got.exists && actualType === expected;

      results.push({
        pass,
        message: pass
          ? `JSON ${path} type is ${expected}`
          : `Expected JSON ${path} type ${expected}, got ${got.exists ? actualType : "missing"}`,
      });
      continue;
    }

    if (type === "json_not_empty") {
      const path = (t.path || "").trim();
      const got = getByPathWithExists(json, path);
      const pass = got.exists && !isEmptyValue(got.value);

      results.push({
        pass,
        message: pass
          ? `JSON ${path} is not empty`
          : `Expected JSON ${path} to be not empty`,
      });
      continue;
    }

    // ---- Builder UI: JSON has key/path ----
    if (type === "json_has_key") {
      const path = String(t.key ?? t.path ?? "").trim();
      const got = getByPathWithExists(json, path);
      const pass = got.exists;
      results.push({
        pass,
        message: pass
          ? `JSON has key/path "${path}"`
          : `Expected JSON to have key/path "${path}"`,
      });
      continue;
    }

    // ---- New: required fields (simple schema-lite) ----
    if (type === "json_required") {
      const required = parseRequiredPaths(t.expected);
      const missing = [];

      for (const p of required) {
        const got = getByPathWithExists(json, p);
        if (!got.exists) missing.push(p);
      }

      const pass = missing.length === 0;
      results.push({
        pass,
        message: pass
          ? `Required fields exist: ${required.join(", ")}`
          : `Missing required fields: ${missing.join(", ")}`,
      });
      continue;
    }

    results.push({ pass: false, message: "Unknown test type" });
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  return { total, passed, failed, results };
}
