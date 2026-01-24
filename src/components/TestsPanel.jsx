// src/components/TestsPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import TestsEditor from "./TestsEditor";

const SNIPPETS = [
  {
    title: "Status is 200",
    code: `pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});`,
  },
  {
    title: "Status is 2xx",
    code: `pm.test("Status is 2xx", () => {
  pm.expect(pm.response.code).to.be.within(200, 299);
});`,
  },
  {
    title: "Header contains",
    code: `pm.test("Content-Type has json", () => {
  pm.expect(pm.response.headers.get("content-type") || "").to.include("application/json");
});`,
  },
  {
    title: "JSON has field",
    code: `pm.test("Body has id", () => {
  const data = pm.response.json();
  pm.expect(data).to.have.property("id");
});`,
  },
  {
    title: "JSON path equals",
    code: `pm.test("data.id equals 1", () => {
  const data = pm.response.json();
  pm.expect(data?.id).to.equal(1);
});`,
  },
  {
    title: "Set env token",
    code: `pm.test("Set token", () => {
  pm.environment.set("token", "abc123");
  pm.expect(pm.environment.get("token")).to.equal("abc123");
});`,
  },
  {
    title: "Log body",
    code: `console.log("Body:", pm.response.text());`,
  },
];

function appendSnippet(current, snippet) {
  const base = String(current || "").trimEnd();
  return base ? `${base}\n\n${snippet}\n` : `${snippet}\n`;
}

function badgeClass(ok) {
  return ok ? "badge badgeOk" : "badge badgeErr";
}

function countLines(text) {
  const t = String(text || "");
  // Always show at least 1 line
  return Math.max(1, t.split("\n").length);
}

function buildLineNumberString(n) {
  let out = "";
  for (let i = 1; i <= n; i++) out += i + "\n";
  return out;
}

// Keep scroll in sync (textarea <-> line numbers)
function syncScroll(fromEl, toEl) {
  if (!fromEl || !toEl) return;
  toEl.scrollTop = fromEl.scrollTop;
}

export default function TestsPanel({
  // builder tests
  tests,
  setTests,

  // script tests
  testScript,
  setTestScript,

  // last results
  lastBuilderReport,
  lastScriptReport,

  // actions
  onRerunScript,

  // meta
  safeTests,
  testTimeoutMs,
}) {
  const [activeRightTab, setActiveRightTab] = useState("results"); // "results" | "logs"
  const taRef = useRef(null);
  const lnRef = useRef(null);

  const builderPassed = lastBuilderReport?.passed ?? 0;
  const builderTotal = lastBuilderReport?.total ?? 0;

  const scriptPassed = lastScriptReport?.passed ?? 0;
  const scriptTotal = lastScriptReport?.total ?? 0;

  const canRerun = typeof onRerunScript === "function";

  const lineCount = useMemo(() => countLines(testScript), [testScript]);
  const lineString = useMemo(() => buildLineNumberString(lineCount), [lineCount]);

  const hasResults = !!lastScriptReport?.tests?.length;
  const hasLogs = !!lastScriptReport?.logs?.length;

  // Sync scroll when textarea scrolls
  useEffect(() => {
    const ta = taRef.current;
    const ln = lnRef.current;
    if (!ta || !ln) return;

    const onScroll = () => syncScroll(ta, ln);
    ta.addEventListener("scroll", onScroll);
    return () => ta.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Tests</div>
          <span className="badge">Builder: {builderTotal ? `${builderPassed}/${builderTotal}` : "—"}</span>
          <span className="badge">Script: {scriptTotal ? `${scriptPassed}/${scriptTotal}` : "—"}</span>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge">{safeTests ? "Safe tests: ON" : "Safe tests: OFF"}</span>
          <span className="badge">Timeout: {Number(testTimeoutMs || 0)}ms</span>
          <button className="btn btnSm btnPrimary" onClick={onRerunScript} disabled={!canRerun}>
            Re-run script tests
          </button>
        </div>
      </div>

      {/* Builder tests (existing editor) */}
      <TestsEditor tests={tests} setTests={setTests} />

      {/* Script split view */}
      <div className="testsSplit">
        {/* LEFT: Editor */}
        <div className="card testsLeft">
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13 }}>JavaScript Tests (Postman-like)</div>
              <div className="smallMuted" style={{ marginTop: 4, fontFamily: "var(--mono)" }}>
                pm.test(…), pm.expect(…), pm.response.json(), pm.environment.set(…)
              </div>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {SNIPPETS.map((s) => (
                <button
                  key={s.title}
                  className="btn btnSm"
                  onClick={() => setTestScript((cur) => appendSnippet(cur, s.code))}
                  title="Insert snippet"
                >
                  + {s.title}
                </button>
              ))}
            </div>
          </div>

          {/* Code editor with line numbers */}
          <div className="codeEditor" style={{ marginTop: 10 }}>
            <pre ref={lnRef} className="codeEditorLines" aria-hidden="true">
              {lineString}
            </pre>

            <textarea
              ref={taRef}
              className="codeEditorText"
              value={testScript}
              onChange={(e) => setTestScript(e.target.value)}
              spellCheck={false}
              placeholder={`// Example:
pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test("Body has id", () => {
  const data = pm.response.json();
  pm.expect(data).to.have.property("id");
});`}
            />
          </div>

          <div className="smallMuted" style={{ marginTop: 10 }}>
            Tip: Use <span style={{ fontFamily: "var(--mono)" }}>console.log()</span> to print debug logs.
          </div>
        </div>

        {/* RIGHT: Results + Logs */}
        <div className="card testsRight">
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>Last run</div>
            <span className="badge">
              {scriptTotal ? `${scriptPassed}/${scriptTotal} passed` : "No results yet"}
            </span>
          </div>

          <div className="testsRightTabs">
            <button
              className={`tab ${activeRightTab === "results" ? "tabActive" : ""}`}
              onClick={() => setActiveRightTab("results")}
            >
              Results {hasResults ? `(${lastScriptReport.tests.length})` : ""}
            </button>

            <button
              className={`tab ${activeRightTab === "logs" ? "tabActive" : ""}`}
              onClick={() => setActiveRightTab("logs")}
            >
              Logs {hasLogs ? `(${lastScriptReport.logs.length})` : ""}
            </button>
          </div>

          {activeRightTab === "results" && (
            <div className="testsRightBody">
              {hasResults ? (
                <div className="stack" style={{ gap: 8 }}>
                  {lastScriptReport.tests.map((t, i) => (
                    <div key={i} className="testsResultRow">
                      <div className="testsResultMain">
                        <div style={{ fontWeight: 700 }}>{t.name}</div>
                        {!t.ok && t.error ? (
                          <div className="smallDanger" style={{ marginTop: 4 }}>
                            {t.error}
                          </div>
                        ) : null}
                        {typeof t.ms === "number" ? (
                          <div className="smallMuted" style={{ marginTop: 4 }}>
                            {t.ms} ms
                          </div>
                        ) : null}
                      </div>
                      <span className={badgeClass(!!t.ok)}>{t.ok ? "PASS" : "FAIL"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="smallMuted">
                  Run a request once (Send) or click “Re-run script tests”.
                </div>
              )}
            </div>
          )}

          {activeRightTab === "logs" && (
            <div className="testsRightBody">
              {hasLogs ? (
                <pre className="codeBlock" style={{ margin: 0 }}>
                  {lastScriptReport.logs.map((l) => `[${l.type}] ${l.message}`).join("\n")}
                </pre>
              ) : (
                <div className="smallMuted">No logs yet.</div>
              )}
            </div>
          )}

          <div className="smallMuted" style={{ marginTop: 10 }}>
            “Re-run script tests” runs on the <b>last response</b> without sending again.
          </div>
        </div>
      </div>
    </div>
  );
}
