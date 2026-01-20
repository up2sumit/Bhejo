function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function runAssertions({ tests, response }) {
  const results = [];
  const total = tests?.length || 0;

  if (!tests || tests.length === 0) {
    return { total: 0, passed: 0, failed: 0, results: [] };
  }

  for (const t of tests) {
    if (t.type === "status_equals") {
      const expected = Number(t.expected);
      const pass = response?.status === expected;
      results.push({
        pass,
        message: pass
          ? `Status is ${expected}`
          : `Expected status ${expected}, got ${response?.status}`,
      });
      continue;
    }

    if (t.type === "time_lt") {
      const max = Number(t.expected);
      const pass = Number(response?.timeMs) < max;
      results.push({
        pass,
        message: pass
          ? `Time ${response?.timeMs}ms < ${max}ms`
          : `Expected time < ${max}ms, got ${response?.timeMs}ms`,
      });
      continue;
    }

    if (t.type === "json_equals") {
      const path = (t.path || "").trim();
      const expected = (t.expected ?? "").toString();
      const actual = getByPath(response?.json, path);

      const pass = actual != null && String(actual) === expected;
      results.push({
        pass,
        message: pass
          ? `JSON ${path} equals ${expected}`
          : `Expected JSON ${path} == ${expected}, got ${actual}`,
      });
      continue;
    }

    if (t.type === "json_contains") {
      const path = (t.path || "").trim();
      const expected = (t.expected ?? "").toString();
      const actual = getByPath(response?.json, path);

      const pass = actual != null && String(actual).includes(expected);
      results.push({
        pass,
        message: pass
          ? `JSON ${path} contains "${expected}"`
          : `Expected JSON ${path} to contain "${expected}", got ${actual}`,
      });
      continue;
    }

    results.push({ pass: false, message: "Unknown test type" });
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  return { total, passed, failed, results };
}
