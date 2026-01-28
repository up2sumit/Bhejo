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
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
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
      const data = await api("/config", { method: "POST", body: JSON.stringify({ config: cfg }) });
      setCfg(data.config || cfg);
      setMsg("Saved agent config.");
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // auto-load once when token exists
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
        {msg ? <div className="muted" style={{ marginTop: 8 }}>{msg}</div> : null}
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

      {msg ? <div className="muted" style={{ marginTop: 8 }}>{msg}</div> : null}

      <div className="agentGrid">
        <label className="agentLbl">
          Proxy mode
          <select
            className="input"
            value={proxyMode}
            onChange={(e) => setCfg((p) => ({ ...p, proxyMode: e.target.value }))}
          >
            <option value="off">Off</option>
            <option value="env">Use env (HTTP_PROXY/HTTPS_PROXY/NO_PROXY)</option>
            <option value="custom">Custom proxy</option>
          </select>
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
        </label>

        <div className="agentLbl">
          Proxy for
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={proxyFor.http !== false}
                onChange={(e) => setCfg((p) => ({ ...p, proxyFor: { ...(p.proxyFor || {}), http: e.target.checked } }))}
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
        </div>

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
              onChange={(e) => setCfg((p) => ({ ...p, tls: { ...(p.tls || {}), rejectUnauthorized: e.target.checked } }))}
            />
            Reject unauthorized certificates
          </label>
          <div className="muted" style={{ marginTop: 6 }}>
            Turn OFF only for dev. In enterprises, keep ON and set CA PEM.
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
          <div className="muted" style={{ marginTop: 6 }}>
            If your org uses TLS interception (Zscaler/Bluecoat), paste the org root CA here.
          </div>
        </label>
      </div>
    </div>
  );
}
