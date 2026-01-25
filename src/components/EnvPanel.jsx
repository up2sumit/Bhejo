// src/components/EnvPanel.jsx
import React, { useMemo, useRef, useState } from "react";
import { DEFAULT_ENVS, normalizeEnvStore, buildEnvNames } from "../utils/envs";

/**
 * EnvPanel
 * - Multiple envs (dev/qa/prod + custom)
 * - Per-env Variables + Secrets
 * - Import/Export JSON
 *
 * Props:
 *  envName, setEnvName
 *  envVarsAll, setEnvVarsAll   // normalized store shape
 */
export default function EnvPanel({ envName, setEnvName, envVarsAll, setEnvVarsAll }) {
  const fileRef = useRef(null);
  const [tab, setTab] = useState("vars"); // "vars" | "secrets"
  const [reveal, setReveal] = useState({}); // key -> boolean
  const [includeSecrets, setIncludeSecrets] = useState(false);

  const store = useMemo(() => normalizeEnvStore(envVarsAll), [envVarsAll]);
  const envNames = useMemo(() => buildEnvNames(store), [store]);

  const current = store[envName] || store.dev || { vars: {}, secrets: {} };
  const map = tab === "secrets" ? current.secrets : current.vars;

  const rows = useMemo(() => {
    const entries = Object.entries(map || {});
    if (!entries.length) return [{ k: "", v: "" }];
    return entries.map(([k, v]) => ({ k, v: String(v ?? "") }));
  }, [map]);

  const updateStore = (nextStore) => setEnvVarsAll(normalizeEnvStore(nextStore));

  const setKV = (idx, k, v) => {
    const next = rows.slice();
    next[idx] = { k, v };

    const cleaned = {};
    for (const r of next) {
      const key = String(r.k || "").trim();
      if (!key) continue;
      cleaned[key] = r.v ?? "";
    }

    updateStore({
      ...store,
      [envName]: {
        vars: tab === "vars" ? cleaned : current.vars,
        secrets: tab === "secrets" ? cleaned : current.secrets,
      },
    });
  };

  const addRow = () => setKV(rows.length, "", "");
  const removeRow = (idx) => {
    const next = rows.slice();
    next.splice(idx, 1);
    const cleaned = {};
    for (const r of next) {
      const key = String(r.k || "").trim();
      if (!key) continue;
      cleaned[key] = r.v ?? "";
    }
    updateStore({
      ...store,
      [envName]: {
        vars: tab === "vars" ? cleaned : current.vars,
        secrets: tab === "secrets" ? cleaned : current.secrets,
      },
    });
  };

  const addEnv = () => {
    const name = prompt("New environment name (e.g., staging):");
    if (!name) return;
    const n = String(name).trim();
    if (!n) return;
    if (store[n]) {
      setEnvName(n);
      return;
    }
    updateStore({ ...store, [n]: { vars: {}, secrets: {} } });
    setEnvName(n);
  };

  const removeEnv = () => {
    if (DEFAULT_ENVS.includes(envName)) {
      alert("dev/qa/prod cannot be removed.");
      return;
    }
    if (!confirm(`Delete environment "${envName}"?`)) return;
    const next = { ...store };
    delete next[envName];
    updateStore(next);
    setEnvName("dev");
  };

  const doExport = () => {
    const payload = {
      version: 2,
      currentEnv: envName,
      envs: includeSecrets
        ? store
        : Object.fromEntries(
            Object.entries(store).map(([k, v]) => [k, { vars: v.vars || {}, secrets: {} }])
          ),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bhejo.environments.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      const envs = parsed?.envs && typeof parsed.envs === "object" ? parsed.envs : parsed;
      const next = normalizeEnvStore(envs);

      updateStore({ ...store, ...next });

      const nextCurrent = parsed?.currentEnv;
      if (nextCurrent && next[nextCurrent]) setEnvName(nextCurrent);
      else if (!store[envName]) setEnvName("dev");
    } catch (e) {
      console.error(e);
      alert("Invalid JSON file.");
    }
  };

  return (
    <div className="sidePanel">
      <div className="sidePanelHeader">
        <div>
          <div className="sidePanelTitle">Environments</div>
          <div className="sidePanelSub">Variables &amp; secrets used in <code>{'{{...}}'}</code> templates</div>
        </div>

        <div className="sidePanelHeaderActions">
          <button className="btn" type="button" onClick={addEnv}>
            + Env
          </button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button className="btnPrimary" type="button" onClick={doExport}>
            Export
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImport(f);
          e.target.value = "";
        }}
      />

      <div className="panelSection">
        <div className="fieldRow">
          <label className="fieldLabel">Active env</label>
          <select className="select" value={envName} onChange={(e) => setEnvName(e.target.value)}>
            {envNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          {!DEFAULT_ENVS.includes(envName) && (
            <button className="btnDanger" type="button" onClick={removeEnv}>
              Delete
            </button>
          )}
        </div>

        <div className="segmented">
          <button
            type="button"
            className={tab === "vars" ? "segBtn active" : "segBtn"}
            onClick={() => setTab("vars")}
          >
            Variables
          </button>
          <button
            type="button"
            className={tab === "secrets" ? "segBtn active" : "segBtn"}
            onClick={() => setTab("secrets")}
          >
            Secrets
          </button>
        </div>

        <div className="hintRow">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            Include secrets on export
          </label>
        </div>
      </div>

      <div className="panelSection">
        <div className="kvGridHead">
          <div>Key</div>
          <div>Value</div>
          <div />
        </div>

        {rows.map((r, idx) => (
          <div className="kvRow" key={idx}>
            <input
              className="input"
              value={r.k}
              placeholder="e.g. baseUrl"
              onChange={(e) => setKV(idx, e.target.value, r.v)}
            />

            <div className="kvValueWrap">
              <input
                className="input"
                value={tab === "secrets" && !reveal[r.k] && r.v ? "••••••••" : r.v}
                placeholder={tab === "secrets" ? "secret value" : "value"}
                onChange={(e) => setKV(idx, r.k, e.target.value)}
              />
              {tab === "secrets" && (
                <button
                  type="button"
                  className="miniBtn"
                  onClick={() => setReveal((s) => ({ ...s, [r.k]: !s[r.k] }))}
                  title={reveal[r.k] ? "Hide" : "Show"}
                >
                  {reveal[r.k] ? "🙈" : "👁"}
                </button>
              )}
            </div>

            <button type="button" className="miniBtn danger" onClick={() => removeRow(idx)}>
              ✕
            </button>
          </div>
        ))}

        <div className="panelFooter">
          <button type="button" className="btn" onClick={addRow}>
            + Add
          </button>
        </div>
      </div>

      <div className="panelSection">
        <div className="sideHelp">
          Tip: Use <code>{"{{var}}"}</code> anywhere (URL/headers/body). Secrets are merged at runtime but can be
          excluded from export.
        </div>
      </div>
    </div>
  );
}