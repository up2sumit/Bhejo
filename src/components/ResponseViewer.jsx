import { useEffect, useMemo, useState } from "react";

function safePrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers.map(([k, v]) => [String(k), String(v)]);
  }
  if (typeof headers?.forEach === "function") {
    const out = [];
    try {
      headers.forEach((v, k) => out.push([String(k), String(v)]));
      return out;
    } catch {
      // fallthrough
    }
  }
  return Object.entries(headers).map(([k, v]) => [String(k), String(v)]);
}

function computeRawText(res) {
  if (!res) return "";
  if (typeof res.rawText === "string") return res.rawText;

  if (res.json !== null && res.json !== undefined) {
    const pretty = safePrettyJson(res.json);
    if (pretty) return pretty;
  }

  if (typeof res.body === "string") return res.body;

  if (res.body && typeof res.body === "object") {
    const pretty = safePrettyJson(res.body);
    if (pretty) return pretty;
  }

  return "";
}

function guessIsOk(res) {
  if (!res) return false;
  if (res.ok === true) return true;
  if (res.ok === false) return false;
  if (typeof res.status === "number") return res.status >= 200 && res.status < 300;
  return false;
}

function isPassTest(t) {
  if (!t) return false;
  if (typeof t.pass === "boolean") return t.pass;
  if (typeof t.ok === "boolean") return t.ok; // testWorker uses ok
  return false;
}

function getTestName(t, i) {
  return t?.name || t?.title || `Test ${i + 1}`;
}

function getTestError(t) {
  return t?.error || t?.err || t?.message || "";
}

function getLogLevel(l) {
  // some places use {level}, worker uses {type}
  return l?.level || l?.type || "info";
}

export default function ResponseViewer({ response }) {
  const [tab, setTab] = useState("body");

  // Reset to Body when a new response arrives (Postman-like)
  useEffect(() => {
    if (!response) return;
    setTab("body");
  }, [response?.traceId, response?.timeMs, response?.status, response?.ok]);

  const ok = useMemo(() => guessIsOk(response), [response]);

  const statusPillClass = useMemo(() => {
    if (!response) return "statusPill";
    return ok ? "statusPill ok" : "statusPill bad";
  }, [response, ok]);

  const headersArr = useMemo(() => normalizeHeaders(response?.headers), [response?.headers]);
  const rawText = useMemo(() => computeRawText(response), [response]);

  const bodyText = useMemo(() => {
    if (!response) return "";
    if (response.json !== null && response.json !== undefined) {
      const pretty = safePrettyJson(response.json);
      if (pretty) return pretty;
    }
    return rawText || "";
  }, [response, rawText]);

  const sizeBytes = useMemo(() => {
    if (!rawText) return 0;
    try {
      return new Blob([rawText]).size;
    } catch {
      return 0;
    }
  }, [rawText]);

  const sizeLabel = useMemo(() => {
    const n = sizeBytes;
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }, [sizeBytes]);

  if (!response) {
    return <div className="smallMuted">No response yet. Send a request.</div>;
  }

  // Error view
  if (response.ok === false && !ok) {
    return (
      <div className="responseWrap">
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800 }}>Error</div>
            <span className="badge badgeErr">{response.errorName || "Error"}</span>
          </div>

          <div className="smallMuted" style={{ marginTop: 10 }}>
            {response.errorMessage || "Request failed"}
          </div>

          {typeof response.timeMs === "number" ? (
            <div className="smallMuted" style={{ marginTop: 8 }}>
              Time: <span style={{ fontFamily: "var(--mono)" }}>{response.timeMs} ms</span>
            </div>
          ) : null}
        </div>

        {(response.rawText || response.errorStack) ? (
          <pre className="responseBody">{response.rawText || response.errorStack}</pre>
        ) : null}
      </div>
    );
  }

  const TabBtn = ({ id, label, danger = false }) => (
    <button
      className={`tabBtn ${tab === id ? "active" : ""} ${danger ? "tabDanger" : ""}`}
      onClick={() => setTab(id)}
      type="button"
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {label}
        {danger ? <span className="tabDotDanger" /> : null}
      </span>
    </button>
  );

  const builderTotal = response?.testReport?.total ?? 0;
  const builderPassed = response?.testReport?.passed ?? 0;

  const scriptTotal = response?.scriptTestReport?.total ?? 0;
  const scriptPassed = response?.scriptTestReport?.passed ?? 0;
  const scriptTests = Array.isArray(response?.scriptTestReport?.tests)
    ? response.scriptTestReport.tests
    : [];
  const scriptLogs = Array.isArray(response?.scriptTestReport?.logs)
    ? response.scriptTestReport.logs
    : [];

  const scriptFail = scriptTotal > 0 && scriptPassed < scriptTotal;
  const builderFail = builderTotal > 0 && builderPassed < builderTotal;
  const totalTestsForTab = (builderTotal || 0) + (scriptTotal || 0);
  const anyTestsFail = builderFail || scriptFail;

  const contentTypePill = response.json !== null && response.json !== undefined ? "JSON" : "Text";

  return (
    <div className="responseWrap">
      {/* Summary row */}
      <div className="responseTop">
        <div className="responseMeta">
          <span className={statusPillClass}>
            {response.status} {response.statusText || ""}
          </span>
          {typeof response.timeMs === "number" ? (
            <span className="metaPill">{response.timeMs} ms</span>
          ) : null}
          {sizeLabel ? <span className="metaPill">{sizeLabel}</span> : null}
          <span className="metaPill">{contentTypePill}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="responseTabs">
        <TabBtn id="body" label="Body" />
        <TabBtn id="headers" label={`Headers (${headersArr.length})`} />
        <TabBtn id="raw" label="Raw" />
        <TabBtn id="tests" label={totalTestsForTab > 0 ? `Tests (${totalTestsForTab})` : "Tests"} danger={anyTestsFail} />
      </div>

      {/* Panel */}
      <div className="responsePanel">
        {tab === "body" && (
          <pre className="responseBody">{bodyText || "(empty body)"}</pre>
        )}

        {tab === "headers" && (
          <div className="headersTable">
            {headersArr.length === 0 ? (
              <div className="smallMuted" style={{ padding: 10 }}>No headers.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {headersArr.map(([k, v], idx) => (
                    <tr key={`${k}-${idx}`}>
                      <td className="mono">{k}</td>
                      <td className="mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "raw" && (
          <pre className="responseBody">{rawText || "(empty)"}</pre>
        )}

        {tab === "tests" && (
          <div className="testsWrap">
            {/* Builder tests */}
            <div className="testBlock">
              <div className="testBlockTitle">{`Builder Tests${builderTotal > 0 ? ` (${builderTotal})` : ""}`}</div>

              {builderTotal > 0 ? (
                <>
                  <div className="smallMuted">{builderPassed}/{builderTotal} passed</div>
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {response.testReport.results?.map((r, i) => (
                      <div
                        key={i}
                        className={`testResultRow ${r.pass ? "pass" : "fail"}`}
                      >
                        <div className="testResultMsg">{r.message}</div>
                        <span className={`badge ${r.pass ? "badgeOk" : "badgeErr"}`}>
                          {r.pass ? "PASS" : "FAIL"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="smallMuted">No builder tests.</div>
              )}
            </div>

            {/* Script tests */}
            <div className={`testBlock ${scriptFail ? "testBlockFail" : ""}`}>
              <div className="testBlockTitle">{`Script Tests${scriptTotal > 0 ? ` (${scriptTotal})` : ""}`}</div>

              {scriptTotal > 0 ? (
                <>
                  <div className={scriptFail ? "testSummaryFail" : "smallMuted"}>{scriptPassed}/{scriptTotal} passed</div>

                  {scriptTests.length > 0 ? (
                    <ul className="testList">
                      {scriptTests.map((t, i) => {
                        const pass = isPassTest(t);
                        const name = getTestName(t, i);
                        const err = getTestError(t);
                        return (
                          <li key={i} className={`testCase ${pass ? "pass" : "fail"}`}>
                            <div className="testCaseTop">
                              <span className="testCaseMark">{pass ? "✓" : "✗"}</span>
                              <span className="testCaseName">{name}</span>
                              <span className={`badge ${pass ? "badgeOk" : "badgeErr"}`}>
                                {pass ? "PASS" : "FAIL"}
                              </span>
                            </div>

                            {!pass && err ? (
                              <div className="testCaseErr">{err}</div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className={scriptFail ? "testFailNote" : "smallMuted"} style={{ marginTop: 10 }}>
                      {scriptFail
                        ? "Script tests failed, but no per-test details were returned. Check logs below."
                        : "No per-test details returned."}
                    </div>
                  )}

                  {scriptLogs.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div className="testBlockTitle">Console / Errors</div>
                      <pre className="responseBody">
                        {scriptLogs
                          .map((l) => `[${getLogLevel(l)}] ${l.message}`)
                          .join("\n")}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="smallMuted">No script tests.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
