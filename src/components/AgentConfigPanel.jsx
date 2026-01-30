import React, { useEffect, useMemo, useState } from "react";

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

const LS_BASE = "bhejo_agent_baseUrl";
const LS_TOKEN = "bhejo_agent_token";

export default function AgentConfigPanel({ baseUrl, token, onBaseUrl, onToken }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const canCall = useMemo(() => !!baseUrl && !!token, [baseUrl, token]);

  // ✅ Restore saved baseUrl/token (if parent didn't pass them)
  useEffect(() => {
    const b = safeJsonParse(localStorage.getItem(LS_BASE), null);
    const t = safeJsonParse(localStorage.getItem(LS_TOKEN), null);

    if (!baseUrl && b) onBaseUrl?.(b);
    if (!token && t) onToken?.(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Persist for convenience across refresh
  useEffect(() => {
    if (baseUrl) localStorage.setItem(LS_BASE, JSON.stringify(baseUrl));
  }, [baseUrl]);

  useEffect(() => {
    if (token) localStorage.setItem(LS_TOKEN, JSON.stringify(token));
  }, [token]);

  async function api(path, opts = {}) {
    const url = String(baseUrl || "").replace(/\/$/, "") + path;

    const res = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        "Content-Type": "application/json",
        "x-bhejo-token": token
      }
    });

    // Some infra returns non-JSON on errors; be resilient.
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!res.ok || data?.ok === false) {
      const m =
        data?.error ||
        data?.message ||
        (typeof data?.raw === "string" ? data.raw.slice(0, 240) : "") ||
        `HTTP ${res.status}`;
      throw new Error(m);
    }
    return data;
  }

  async function load() {
    if (!canCall) return;
    setBusy(true);
    setMsg("");
    try {
      const data = await api("/config", { method: "GET" });
      setCfg(data.config || null);
      setMsg("Loaded agent config.");
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!canCall) return;
    setBusy(true);
    setMsg("");
    try {
      const data = await api("/config", {
        method: "POST",
        body: JSON.stringify({ config: cfg })
      });
      setCfg(data.config || cfg);
      setMsg("Saved agent config.");
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (canCall && !cfg) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCall]);

  if (!cfg) {
    return (
      <div className="agentSettingsBox">
        <div className="agentSettingsRow">
          <div className="muted">Agent settings</div>
          <button className="btn" disabled={!canCall || busy} onClick={load}>
            {busy ? "Loading..." : "Load"}
          </button>
        </div>
        {msg ? (
          <div className="muted" style={{ marginTop: 8 }}>
            {msg}
          </div>
        ) : null}
      </div>
    );
  }

  const proxyMode = cfg.proxyMode || "off";
  const tls = cfg.tls || {};
  const custom = cfg.customProxy || {};
  const auth = custom.auth || {};
  const proxyFor = cfg.proxyFor || { http: true, https: true };

  return (
    <div className="agentSettingsBox">
      <div className="agentSettingsRow">
        <div className="muted">Agent settings (enterprise)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={!canCall || busy} onClick={load}>
            {busy ? "..." : "Reload"}
          </button>
          <button className="btnPrimary" disabled={!canCall || busy} onClick={save}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {msg ? (
        <div className="muted" style={{ marginTop: 8 }}>
          {msg}
        </div>
      ) : null}

      <div className="agentGrid">
        <label className="agentLbl">
          Proxy mode
          <select
            className="input"
            value={proxyMode}
            onChange={(e) => setCfg((p) => ({ ...p, proxyMode: e.target.value }))}
          >
            <option value="off">Off</option>
            <option value="env">Env (HTTP_PROXY / HTTPS_PROXY / NO_PROXY)</option>
            <option value="system">System (uses env in Node)</option>
            <option value="custom">Custom proxy</option>
          </select>
          <div className="muted" style={{ marginTop: 6 }}>
            If Postman works but Bhejo gets blocked (444), it’s often because Postman is using your corporate proxy.
            Choose <b>Env</b> or <b>Custom</b> and retry.
          </div>
        </label>

        <label className="agentLbl">
          NO_PROXY (comma separated)
          <input
            className="input"
            value={(cfg.noProxy || []).join(",")}
            onChange={(e) =>
              setCfg((p) => ({
                ...p,
                noProxy: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              }))
            }
            placeholder="localhost,127.0.0.1,.corp.local"
          />
          <div className="muted" style={{ marginTop: 6 }}>
            Use this to bypass proxy for internal domains if required. Example: <code>.corp.local</code>
          </div>
        </label>

        <div className="agentLbl">
          Proxy for
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={proxyFor.http !== false}
                onChange={(e) =>
                  setCfg((p) => ({ ...p, proxyFor: { ...(p.proxyFor || {}), http: e.target.checked } }))
                }
              />
              HTTP
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={proxyFor.https !== false}
                onChange={(e) =>
                  setCfg((p) => ({ ...p, proxyFor: { ...(p.proxyFor || {}), https: e.target.checked } }))
                }
              />
              HTTPS
            </label>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Keep HTTPS enabled for most corporate proxies.
          </div>
        </div>

        {proxyMode === "env" || proxyMode === "system" ? (
          <div className="agentLbl" style={{ gridColumn: "1 / -1" }}>
            Proxy env variables (set on Agent machine before starting Agent)
            <div className="muted" style={{ marginTop: 6 }}>
              Windows PowerShell:
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
$env:HTTPS_PROXY="http://proxy.corp.local:8080"
$env:HTTP_PROXY="http://proxy.corp.local:8080"
$env:NO_PROXY="localhost,127.0.0.1,.corp.local"
npm run dev
              </pre>
              Mac/Linux:
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
HTTPS_PROXY=http://proxy.corp.local:8080 \
HTTP_PROXY=http://proxy.corp.local:8080 \
NO_PROXY=localhost,127.0.0.1,.corp.local \
npm run dev
              </pre>
              <div className="muted" style={{ marginTop: 6 }}>
                Note: Node does not automatically understand PAC scripts. If your org uses PAC, ask IT for the resolved proxy host:port and use Custom mode.
              </div>
            </div>
          </div>
        ) : null}

        {proxyMode === "custom" ? (
          <div className="agentCustomBox">
            <div className="agentCustomRow">
              <label className="agentLbl">
                Protocol
                <select
                  className="input"
                  value={custom.protocol || "http"}
                  onChange={(e) =>
                    setCfg((p) => ({ ...p, customProxy: { ...(p.customProxy || {}), protocol: e.target.value } }))
                  }
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </label>
              <label className="agentLbl">
                Host
                <input
                  className="input"
                  value={custom.host || ""}
                  onChange={(e) =>
                    setCfg((p) => ({ ...p, customProxy: { ...(p.customProxy || {}), host: e.target.value } }))
                  }
                  placeholder="proxy.corp.local"
                />
              </label>
              <label className="agentLbl">
                Port
                <input
                  className="input"
                  type="number"
                  value={custom.port || 8080}
                  onChange={(e) =>
                    setCfg((p) => ({ ...p, customProxy: { ...(p.customProxy || {}), port: Number(e.target.value) } }))
                  }
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!auth.enabled}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      customProxy: {
                        ...(p.customProxy || {}),
                        auth: { ...(p.customProxy?.auth || {}), enabled: e.target.checked }
                      }
                    }))
                  }
                />
                Proxy auth (basic)
              </label>
              {auth.enabled ? (
                <>
                  <input
                    className="input"
                    style={{ maxWidth: 220 }}
                    placeholder="username"
                    value={auth.user || ""}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        customProxy: {
                          ...(p.customProxy || {}),
                          auth: { ...(p.customProxy?.auth || {}), user: e.target.value }
                        }
                      }))
                    }
                  />
                  <input
                    className="input"
                    style={{ maxWidth: 220 }}
                    placeholder="password"
                    type="password"
                    value={auth.pass || ""}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        customProxy: {
                          ...(p.customProxy || {}),
                          auth: { ...(p.customProxy?.auth || {}), pass: e.target.value }
                        }
                      }))
                    }
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="agentLbl">
          TLS verify
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <input
              type="checkbox"
              checked={tls.rejectUnauthorized !== false}
              onChange={(e) =>
                setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), rejectUnauthorized: e.target.checked } }))
              }
            />
            Reject unauthorized certificates
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btnSm"
              disabled={busy}
              onClick={() => setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), rejectUnauthorized: false } }))}
              title="Quick test only (NOT recommended for production)"
            >
              Quick test: OFF
            </button>
            <button
              type="button"
              className="btn btnSm"
              disabled={busy}
              onClick={() => setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), rejectUnauthorized: true } }))}
              title="Recommended when CA PEM is set"
            >
              Recommended: ON
            </button>
          </div>

          <div className="muted" style={{ marginTop: 6 }}>
            Turn OFF only to test. In enterprises, keep ON and set CA PEM / CA path.
          </div>
        </div>

        <label className="agentLbl" style={{ gridColumn: "1 / -1" }}>
          CA PEM (optional, paste root certificate bundle)
          <textarea
            className="input"
            style={{ minHeight: 120, fontFamily: "monospace" }}
            value={tls.caPem || ""}
            onChange={(e) => setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), caPem: e.target.value } }))}
            placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
          />
        </label>

        <label className="agentLbl" style={{ gridColumn: "1 / -1" }}>
          CA PEM Path (optional, local file path on the agent machine)
          <input
            className="input"
            value={tls.caPemPath || ""}
            onChange={(e) => setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), caPemPath: e.target.value } }))}
            placeholder="C:\\certs\\corp-root.pem  or  /etc/ssl/certs/corp-root.pem"
          />
        </label>
      </div>
    </div>
  );
}
