export default function EnvPanel({
  envName,
  setEnvName,
  envVarsAll,
  setEnvVarsAll,
}) {
  const current = envVarsAll?.[envName] || {};

  const entries = Object.entries(current);

  const updateKey = (oldKey, newKey) => {
    const trimmed = (newKey || "").trim();
    if (!trimmed) return;

    const copy = { ...envVarsAll };
    const env = { ...(copy[envName] || {}) };

    const value = env[oldKey];
    delete env[oldKey];
    env[trimmed] = value;

    copy[envName] = env;
    setEnvVarsAll(copy);
  };

  const updateValue = (key, value) => {
    const copy = { ...envVarsAll };
    copy[envName] = { ...(copy[envName] || {}), [key]: value };
    setEnvVarsAll(copy);
  };

  const addVar = () => {
    const copy = { ...envVarsAll };
    const env = { ...(copy[envName] || {}) };

    // generate unique key
    let key = "newVar";
    let i = 1;
    while (env[key]) {
      key = `newVar${i++}`;
    }
    env[key] = "";
    copy[envName] = env;
    setEnvVarsAll(copy);
  };

  const removeVar = (key) => {
    const copy = { ...envVarsAll };
    const env = { ...(copy[envName] || {}) };
    delete env[key];
    copy[envName] = env;
    setEnvVarsAll(copy);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>Environment</div>

        <select className="select" value={envName} onChange={(e) => setEnvName(e.target.value)}>
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="prod">prod</option>
        </select>
      </div>

      <div className="smallMuted">
        Use variables like <span style={{ fontFamily: "var(--mono)" }}>{"{{baseUrl}}"}</span>,{" "}
        <span style={{ fontFamily: "var(--mono)" }}>{"{{token}}"}</span> in URL/Headers/Body.
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Variables</div>
          <button className="btn btnSm" onClick={addVar}>+ Add</button>
        </div>

        {entries.length === 0 ? (
          <div className="smallMuted" style={{ marginTop: 10 }}>
            No variables yet.
          </div>
        ) : null}

        {entries.map(([k, v]) => (
          <div key={k} className="kvRow">
            <input
              className="input"
              value={k}
              onChange={(e) => updateKey(k, e.target.value)}
            />
            <input
              className="input"
              value={v}
              onChange={(e) => updateValue(k, e.target.value)}
              placeholder="value"
            />
            <button className="btn btnDanger btnSm" onClick={() => removeVar(k)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
