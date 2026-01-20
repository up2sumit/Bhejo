export default function TestsEditor({ tests, setTests }) {
  const update = (idx, field, value) => {
    const copy = [...tests];
    copy[idx] = { ...copy[idx], [field]: value };
    setTests(copy);
  };

  const add = () =>
    setTests([
      ...tests,
      { type: "status_equals", path: "", operator: "equals", expected: "200" },
    ]);

  const remove = (idx) => {
    const next = tests.filter((_, i) => i !== idx);
    setTests(next.length ? next : []);
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Tests</div>
        <button className="btn btnSm" onClick={add}>+ Add</button>
      </div>

      {tests.length === 0 ? (
        <div className="smallMuted" style={{ marginTop: 10 }}>
          No tests added yet.
        </div>
      ) : null}

      {tests.map((t, idx) => (
        <div key={idx} className="testRow">
          <select
            className="select"
            value={t.type}
            onChange={(e) => update(idx, "type", e.target.value)}
          >
            <option value="status_equals">Status equals</option>
            <option value="json_equals">JSON path equals</option>
            <option value="json_contains">JSON path contains</option>
            <option value="time_lt">Time &lt; (ms)</option>
          </select>

          {(t.type === "json_equals" || t.type === "json_contains") ? (
            <input
              className="input"
              placeholder="JSON path (e.g. userId or data.id)"
              value={t.path || ""}
              onChange={(e) => update(idx, "path", e.target.value)}
            />
          ) : (
            <input className="input" disabled value="" />
          )}

          <input
            className="input"
            placeholder={t.type === "time_lt" ? "Max ms (e.g. 500)" : "Expected (e.g. 200)"}
            value={t.expected ?? ""}
            onChange={(e) => update(idx, "expected", e.target.value)}
          />

          <button className="btn btnDanger btnSm" onClick={() => remove(idx)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
