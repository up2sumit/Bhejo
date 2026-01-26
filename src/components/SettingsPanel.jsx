// src/components/SettingsPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";

function getDefaultSettings() {
  return {
    proxy: {
      mode: "manual", // "off" | "manual" | "system"
      manualUrl: "http://localhost:3001/proxy",
      defaultRequestMode: "direct", // "direct" | "proxy"
    },
    runtime: {
      requestTimeoutMs: 30000,
      testTimeoutMs: 1200,
      safeTests: true,
      allowScriptEnvWrites: true,
      showEnvToast: true,
      logEnvChanges: true,
      envToastMs: 3500,
    },
    ui: {
      palette: "default",
    },
  };
}

function mergeSettings(incoming) {
  const d = getDefaultSettings();
  const s = incoming && typeof incoming === "object" ? incoming : {};
  return {
    ...d,
    ...s,
    proxy: { ...d.proxy, ...(s.proxy || {}) },
    runtime: { ...d.runtime, ...(s.runtime || {}) },
    ui: { ...d.ui, ...(s.ui || {}) },
  };
}

export default function SettingsPanel({
  open,
  onClose,
  settings,
  setSettings,
  theme,
  setTheme,
}) {
  const merged = useMemo(() => mergeSettings(settings), [settings]);

  const [draft, setDraft] = useState(merged);

  const didSaveRef = useRef(false);
  const initialPaletteRef = useRef("default");

  // when opened / settings change → sync draft
  useEffect(() => {
    if (!open) return;
    setDraft(merged);

    // Track palette at the moment the drawer opens so Cancel can revert correctly.
    // Also prevents "Save" from being undone by the preview cleanup.
    didSaveRef.current = false;
    initialPaletteRef.current =
      document.documentElement.getAttribute("data-palette") ||
      (settings?.ui?.palette || "default");
  }, [open, merged, settings?.ui?.palette]);
  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live preview palette while drawer is open.
// IMPORTANT: Do not revert after Save — only revert on Cancel / dismiss.
  useEffect(() => {
    if (!open) return;

    const next = draft?.ui?.palette || "default";
    document.documentElement.setAttribute("data-palette", next);

    return () => {
      if (didSaveRef.current) return;
      document.documentElement.setAttribute("data-palette", initialPaletteRef.current || "default");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft?.ui?.palette]);

  const setProxy = (patch) =>
    setDraft((p) => ({ ...p, proxy: { ...(p.proxy || {}), ...patch } }));

  const setRuntime = (patch) =>
    setDraft((p) => ({ ...p, runtime: { ...(p.runtime || {}), ...patch } }));

  const setUI = (patch) =>
    setDraft((p) => ({ ...p, ui: { ...(p.ui || {}), ...patch } }));

  const save = () => {
    const next = mergeSettings(draft);
    didSaveRef.current = true;
    // Apply immediately so the UI does not "snap back" due to preview cleanup timing.
    document.documentElement.setAttribute("data-palette", next?.ui?.palette || "default");
    setSettings?.(next);
    onClose?.();
  };

  const reset = () => setDraft(getDefaultSettings());

  const cancel = () => {
    // revert draft + close
    didSaveRef.current = false;
    setDraft(merged);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="settingsOverlay" onMouseDown={cancel}>
      <div
        className="settingsDrawer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="settingsHeader">
          <div className="settingsTitle">
            <div className="settingsH1">Settings</div>
            <div className="settingsSub">Local preferences • stored in browser</div>
          </div>

          <div className="settingsHeaderRight">
            <span className="badge">v1</span>
            <button className="btn btnSm" onClick={reset} type="button">
              Reset
            </button>
            <button
              className="settingsCloseBtn"
              onClick={cancel}
              type="button"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="settingsBody">
          {/* Appearance */}
          <div className="settingsSection">
            <div className="settingsSectionTitle">Appearance</div>

            <div className="settingsGrid2">
              <div className="settingsField">
                <div className="settingsLabel">Theme</div>
                <select
                  className="select"
                  value={theme}
                  onChange={(e) => setTheme?.(e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
                <div className="settingsHint">
                  Theme is saved locally (also synced with header toggle).
                </div>
              </div>

              <div className="settingsField">
                <div className="settingsLabel">Palette</div>
                <select
                  className="select"
                  value={draft.ui?.palette || "default"}
                  onChange={(e) => setUI({ palette: e.target.value })}
                >
                  <option value="default">Default</option>
                  <option value="imperial_topaz">Imperial Topaz</option>
                  <option value="royal_amethyst">Royal Amethyst</option>
                </select>
                <div className="settingsHint">
                  Optional UI accent set (applies after Save; preview while open).
                </div>
              </div>
            </div>
          </div>

          {/* Proxy */}
          <div className="settingsSection">
            <div className="settingsSectionTitle">Proxy</div>

            <div className="settingsGrid2">
              <div className="settingsField">
                <div className="settingsLabel">Proxy mode</div>
                <select
                  className="select"
                  value={draft.proxy?.mode || "manual"}
                  onChange={(e) => setProxy({ mode: e.target.value })}
                >
                  <option value="off">Off</option>
                  <option value="manual">Manual</option>
                  <option value="system">System</option>
                </select>
              </div>

              <div className="settingsField">
                <div className="settingsLabel">Manual proxy URL</div>
                <input
                  className="input"
                  value={draft.proxy?.manualUrl || ""}
                  onChange={(e) => setProxy({ manualUrl: e.target.value })}
                  placeholder="http://localhost:3001/proxy"
                />
                <div className="settingsHint">
                  Used when request mode is Proxy + proxy mode is Manual.
                </div>
              </div>
            </div>

            <div className="settingsField" style={{ marginTop: 12 }}>
              <div className="settingsLabel">Default request mode</div>
              <select
                className="select"
                value={draft.proxy?.defaultRequestMode || "direct"}
                onChange={(e) => setProxy({ defaultRequestMode: e.target.value })}
              >
                <option value="direct">Direct</option>
                <option value="proxy">Proxy</option>
              </select>
              <div className="settingsHint">New requests start in this mode.</div>
            </div>
          </div>

          {/* Runtime */}
          <div className="settingsSection">
            <div className="settingsSectionTitle">Runtime</div>

            <div className="settingsGrid2">
              <div className="settingsField">
                <div className="settingsLabel">Request timeout (ms)</div>
                <input
                  className="input"
                  type="number"
                  min="1000"
                  max="180000"
                  value={draft.runtime?.requestTimeoutMs ?? 30000}
                  onChange={(e) =>
                    setRuntime({ requestTimeoutMs: Number(e.target.value || 0) })
                  }
                />
                <div className="settingsHint">1,000 – 180,000</div>
              </div>

              <div className="settingsField">
                <div className="settingsLabel">Test timeout (ms)</div>
                <input
                  className="input"
                  type="number"
                  min="100"
                  max="15000"
                  value={draft.runtime?.testTimeoutMs ?? 1200}
                  onChange={(e) =>
                    setRuntime({ testTimeoutMs: Number(e.target.value || 0) })
                  }
                />
                <div className="settingsHint">100 – 15,000</div>
              </div>
            </div>

            <div className="settingsChecks">
              <label className="checkRow">
                <input
                  type="checkbox"
                  checked={!!draft.runtime?.safeTests}
                  onChange={(e) => setRuntime({ safeTests: e.target.checked })}
                />
                Safe tests (Web Worker, prevents UI freezes)
              </label>

              <label className="checkRow">
                <input
                  type="checkbox"
                  checked={!!draft.runtime?.allowScriptEnvWrites}
                  onChange={(e) =>
                    setRuntime({ allowScriptEnvWrites: e.target.checked })
                  }
                />
                Allow scripts to write Env (pm.environment.set)
              </label>
            </div>
          </div>

          {/* (Keep the rest of your sections here if you already had them) */}
        </div>

        <div className="settingsFooter">
          <button className="btn btnSm" onClick={cancel} type="button">
            Cancel
          </button>
          <button className="btn btnPrimary btnSm" onClick={save} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
