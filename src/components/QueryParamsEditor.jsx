export default function QueryParamsEditor({ params, setParams }) {
  const updateParam = (idx, field, value) => {
    const copy = [...params];
    copy[idx] = { ...copy[idx], [field]: value };
    setParams(copy);
  };

  const addRow = () => setParams([...params, { key: "", value: "" }]);

  const removeRow = (idx) => {
    const copy = params.filter((_, i) => i !== idx);
    setParams(copy.length ? copy : [{ key: "", value: "" }]);
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>Query Params</div>
        <button className="btn btnSm" onClick={addRow}>+ Add</button>
      </div>

      {params.map((p, idx) => (
        <div key={idx} className="kvRow">
          <input
            className="input"
            placeholder="Key (e.g. page)"
            value={p.key}
            onChange={(e) => updateParam(idx, "key", e.target.value)}
          />
          <input
            className="input"
            placeholder="Value (e.g. 1)"
            value={p.value}
            onChange={(e) => updateParam(idx, "value", e.target.value)}
          />
          <button
            className="btn btnDanger btnSm"
            onClick={() => removeRow(idx)}
            title="Remove param"
            aria-label="Remove param"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
