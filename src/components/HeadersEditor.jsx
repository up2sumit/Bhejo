export default function HeadersEditor({ headers, setHeaders }) {
  const updateHeader = (idx, field, value) => {
    const copy = [...headers];
    copy[idx] = { ...copy[idx], [field]: value };
    setHeaders(copy);
  };

  const addRow = () => setHeaders([...headers, { key: "", value: "" }]);

  const removeRow = (idx) => {
    const copy = headers.filter((_, i) => i !== idx);
    setHeaders(copy.length ? copy : [{ key: "", value: "" }]);
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>Headers</div>
        <button className="btn btnSm" onClick={addRow}>
          + Add
        </button>
      </div>

      {headers.map((h, idx) => (
        <div key={idx} className="kvRow">
          <input
            className="input"
            placeholder="Key (e.g. Authorization)"
            value={h.key}
            onChange={(e) => updateHeader(idx, "key", e.target.value)}
          />
          <input
            className="input"
            placeholder="Value"
            value={h.value}
            onChange={(e) => updateHeader(idx, "value", e.target.value)}
          />
          <button
            className="btn btnDanger btnSm"
            onClick={() => removeRow(idx)}
            title="Remove header"
            aria-label="Remove header"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
