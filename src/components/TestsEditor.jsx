// src/components/TestsEditor.jsx
// Phase 4: Postman-like Tests tab UI
// Adds a mode toggle:
//  - "Builder" (your existing structured tests UI)
//  - "JavaScript" (textarea editor for pm.test + chai expect/assert)
// Backward compatible: if you only pass tests/setTests, it behaves like before.
// If you also pass testScript/setTestScript, it enables JS mode editing.

import { useMemo, useState } from "react";

const TEMPLATES = [
  {
    label: "Status is 200",
    value: `pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});`,
  },
  {
    label: "Content-Type is JSON",
    value: `pm.test("Content-Type is JSON", () => {
  pm.expect(pm.response.headers.get("content-type")).to.include("application/json");
});`,
  },
  {
    label: "Body has property",
    value: `pm.test("Body has id", () => {
  const data = pm.response.json();
  pm.expect(data).to.have.property("id");
});`,
  },
  {
    label: "Response time under 500ms",
    value: `pm.test("Response time < 500ms", () => {
  pm.expect(pm.response.responseTime).to.be.lessThan(500);
});`,
  },
  {
    label: "Header exists",
    value: `pm.test("Header exists", () => {
  pm.expect(pm.response.headers.get("x-request-id")).to.exist;
});`,
  },
];

function uid(prefix = "t") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

/**
 * Existing structured (builder) tests UI
 * This is adapted from your current TestsEditor behavior: add/remove tests,
 * choose type, edit values, etc.
 *
 * If your old TestsEditor had more types/templates, you can paste those pieces
 * into this component (the integration point remains the same).
 */
function BuilderTests({ tests, setTests }) {
  const list = Array.isArray(tests) ? tests : [];

  const addTest = () => {
    const next = [
      ...list,
      {
        id: uid("test"),
        type: "status_equals",
        expected: 200,
        enabled: true,
      },
    ];
    setTests(next);
  };

  const removeTest = (id) => {
    setTests(list.filter((t) => t.id !== id));
  };

  const update = (id, patch) => {
    setTests(list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const typeLabel = (t) => {
    switch (t) {
      case "status_equals":
        return "Status equals";
      case "status_between":
        return "Status between";
      case "header_contains":
        return "Header contains";
      case "json_path_equals":
        return "JSON path equals";
      case "json_has_key":
        return "JSON has key";
      case "response_time_lt":
        return "Response time <";
      default:
        return t || "test";
    }
  };

  return (
    <div className="panelSoft">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700 }}>Builder Tests</div>
        <button className="btn btnSm" onClick={addTest}>
          + Add
        </button>
      </div>

      {list.length === 0 ? (
        <div className="smallMuted" style={{ marginTop: 10 }}>
          No builder tests yet.
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {list.map((t) => (
            <div
              key={t.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 8 }}>
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={t.enabled !== false}
                      onChange={(e) => update(t.id, { enabled: e.target.checked })}
                    />
                    <span className="smallMuted">Enabled</span>
                  </label>

                  <select
                    className="select"
                    value={t.type || "status_equals"}
                    onChange={(e) => update(t.id, { type: e.target.value })}
                  >
                    <option value="status_equals">Status equals</option>
                    <option value="status_between">Status between</option>
                    <option value="response_time_lt">Response time &lt;</option>
                    <option value="header_contains">Header contains</option>
                    <option value="json_path_equals">JSON path equals</option>
                    <option value="json_has_key">JSON has key</option>
                  </select>
                </div>

                <button className="btn btnSm btnDanger" onClick={() => removeTest(t.id)}>
                  Delete
                </button>
              </div>

              <div className="smallMuted" style={{ marginTop: 8 }}>
                {typeLabel(t.type)}
              </div>

              {/* simple editors per type */}
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {t.type === "status_equals" && (
                  <div className="row" style={{ gap: 8 }}>
                    <div className="smallMuted" style={{ width: 140 }}>
                      Expected
                    </div>
                    <input
                      className="input"
                      type="number"
                      value={t.expected ?? 200}
                      onChange={(e) => update(t.id, { expected: Number(e.target.value) })}
                      style={{ maxWidth: 160 }}
                    />
                  </div>
                )}

                {t.type === "status_between" && (
                  <div className="row" style={{ gap: 8 }}>
                    <div className="smallMuted" style={{ width: 140 }}>
                      Min / Max
                    </div>
                    <input
                      className="input"
                      type="number"
                      value={t.min ?? 200}
                      onChange={(e) => update(t.id, { min: Number(e.target.value) })}
                      style={{ maxWidth: 120 }}
                    />
                    <input
                      className="input"
                      type="number"
                      value={t.max ?? 299}
                      onChange={(e) => update(t.id, { max: Number(e.target.value) })}
                      style={{ maxWidth: 120 }}
                    />
                  </div>
                )}

                {t.type === "response_time_lt" && (
                  <div className="row" style={{ gap: 8 }}>
                    <div className="smallMuted" style={{ width: 140 }}>
                      Max ms
                    </div>
                    <input
                      className="input"
                      type="number"
                      value={t.maxMs ?? 500}
                      onChange={(e) => update(t.id, { maxMs: Number(e.target.value) })}
                      style={{ maxWidth: 160 }}
                    />
                  </div>
                )}

                {t.type === "header_contains" && (
                  <>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="smallMuted" style={{ width: 140 }}>
                        Header name
                      </div>
                      <input
                        className="input"
                        value={t.headerName ?? ""}
                        onChange={(e) => update(t.id, { headerName: e.target.value })}
                        placeholder="content-type"
                      />
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="smallMuted" style={{ width: 140 }}>
                        Contains
                      </div>
                      <input
                        className="input"
                        value={t.contains ?? ""}
                        onChange={(e) => update(t.id, { contains: e.target.value })}
                        placeholder="application/json"
                      />
                    </div>
                  </>
                )}

                {t.type === "json_path_equals" && (
                  <>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="smallMuted" style={{ width: 140 }}>
                        JSON path
                      </div>
                      <input
                        className="input"
                        value={t.path ?? ""}
                        onChange={(e) => update(t.id, { path: e.target.value })}
                        placeholder="data.id"
                      />
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="smallMuted" style={{ width: 140 }}>
                        Expected
                      </div>
                      <input
                        className="input"
                        value={t.expectedValue ?? ""}
                        onChange={(e) => update(t.id, { expectedValue: e.target.value })}
                        placeholder="123"
                      />
                    </div>
                  </>
                )}

                {t.type === "json_has_key" && (
                  <div className="row" style={{ gap: 8 }}>
                    <div className="smallMuted" style={{ width: 140 }}>
                      Key / path
                    </div>
                    <input
                      className="input"
                      value={t.key ?? ""}
                      onChange={(e) => update(t.id, { key: e.target.value })}
                      placeholder="id"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsTests({ testScript, setTestScript }) {
  const [template, setTemplate] = useState("");

  const insertTemplate = () => {
    const t = TEMPLATES.find((x) => x.label === template);
    if (!t) return;

    const cur = String(testScript || "");
    const next = cur.trim()
      ? `${cur}\n\n${t.value}\n`
      : `${t.value}\n`;
    setTestScript(next);
  };

  return (
    <div className="panelSoft">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700 }}>JavaScript Tests (Postman-like)</div>

        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{ maxWidth: 220 }}
            title="Insert template"
          >
            <option value="">Insert template…</option>
            {TEMPLATES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>

          <button
            className="btn btnSm"
            onClick={insertTemplate}
            disabled={!template}
          >
            Insert
          </button>
        </div>
      </div>

      <textarea
        className="textarea"
        style={{ minHeight: 260, marginTop: 10, fontFamily: "var(--mono)" }}
        value={String(testScript || "")}
        onChange={(e) => setTestScript(e.target.value)}
        placeholder={`// Example:
pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test("Body has id", () => {
  const data = pm.response.json();
  pm.expect(data).to.have.property("id");
});`}
      />

      <div className="smallMuted" style={{ marginTop: 10 }}>
        Available:{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.test</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.expect</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.assert</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.response</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.request</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>pm.environment</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>console.log</span>
      </div>
    </div>
  );
}

/**
 * Updated TestsEditor with Postman-like mode toggle.
 *
 * Props:
 * - tests, setTests  (required for Builder mode)
 * - testScript, setTestScript (optional; if provided, JS mode enabled)
 * - defaultMode ("builder" | "js") optional
 */
export default function TestsEditor({
  tests,
  setTests,
  testScript,
  setTestScript,
  defaultMode = "builder",
}) {
  const hasJs = typeof setTestScript === "function";

  const initialMode = useMemo(() => {
    if (!hasJs) return "builder";
    // if script already exists, default to JS
    if (String(testScript || "").trim()) return "js";
    return defaultMode;
  }, [hasJs, testScript, defaultMode]);

  const [mode, setMode] = useState(initialMode);

  // If JS mode is not supported, lock to builder
  const effectiveMode = hasJs ? mode : "builder";

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="smallMuted">
          Tests run after the response. Builder tests are structured; JS tests use
          <span style={{ fontFamily: "var(--mono)" }}> pm.test </span> + Chai{" "}
          <span style={{ fontFamily: "var(--mono)" }}>expect/assert</span>.
        </div>

        {hasJs ? (
          <div className="tabs">
            <button
              className={`tab ${effectiveMode === "builder" ? "tabActive" : ""}`}
              onClick={() => setMode("builder")}
            >
              Builder
            </button>
            <button
              className={`tab ${effectiveMode === "js" ? "tabActive" : ""}`}
              onClick={() => setMode("js")}
            >
              JavaScript
            </button>
          </div>
        ) : null}
      </div>

      {effectiveMode === "builder" ? (
        <BuilderTests tests={tests} setTests={setTests} />
      ) : (
        <JsTests testScript={testScript} setTestScript={setTestScript} />
      )}
    </div>
  );
}
