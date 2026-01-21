import { useMemo, useState } from "react";

function safeParseJson(text) {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, error: "Row must be a JSON object (e.g. {\"userId\":1})" };
    }
    return { ok: true, value: obj };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

export default function DataEditor({ rows, setRows }) {
  const [errors, setErrors] = useState({}); // idx -> msg

  const addRow = () => {
    setRows([...(rows || []), { _text: "{\n  \n}" }]);
  };

  const removeRow = (idx) => {
    const next = (rows || []).filter((_, i) => i !== idx);
    setRows(next);
    setErrors((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  };

  const updateRowText = (idx, text) => {
    const next = [...(rows || [])];
    next[idx] = { ...next[idx], _text: text };
    setRows(next);

    const parsed = safeParseJson(text);
    setErrors((prev) => ({ ...prev, [idx]: parsed.ok ? "" : parsed.error }));
  };

  const normalizeRows = () => {
    // Convert row objects into stored form: { vars: {...} }
    const out = [];
    const nextErrors = {};
    (rows || []).forEach((r, idx) => {
      const text = (r?._text ?? JSON.stringify(r?.vars ?? {}, null, 2));
      const parsed = safeParseJson(text);
      if (!parsed.ok) {
        nextErrors[idx] = parsed.error;
      } else {
        out.push({ vars: parsed.value, _text: JSON.stringify(parsed.value, null, 2) });
        nextErrors[idx] = "";
      }
    });

    setErrors(nextErrors);
    setRows(out);
  };

  const loadSample = () => {
    setRows([
      { vars: { userId: 1 }, _text: JSON.stringify({ userId: 1 }, null, 2) },
      { vars: { userId: 2 }, _text: JSON.stringify({ userId: 2 }, null, 2) },
      { vars: { userId: 3 }, _text: JSON.stringify({ userId: 3 }, null, 2) },
    ]);
    setErrors({});
  };

  const countValid = useMemo(() => {
    let ok = 0;
    (rows || []).forEach((r, idx) => {
      const text = r?._text ?? JSON.stringify(r?.vars ?? {}, null, 2);
      if (safeParseJson(text).ok) ok += 1;
    });
    return ok;
  }, [rows]);

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Data rows (iterations)</div>
          <div className="smallMuted" style={{ marginTop: 4 }}>
            Each row is a JSON object. Runner will execute once per row.
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge">{countValid}/{(rows || []).length} valid</span>
          <button className="btn btnSm" onClick={loadSample}>Sample</button>
          <button className="btn btnSm" onClick={normalizeRows}>Normalize</button>
          <button className="btn btnPrimary btnSm" onClick={addRow}>+ Add</button>
        </div>
      </div>

      {(rows || []).length === 0 ? (
        <div className="smallMuted" style={{ marginTop: 12 }}>
          No data rows. Add rows to run iterations.
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          {(rows || []).map((r, idx) => (
            <div key={idx} className="card" style={{ padding: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800 }}>Row {idx + 1}</div>
                <button className="btn btnDanger btnSm" onClick={() => removeRow(idx)}>
                  Remove
                </button>
              </div>

              <textarea
                className="input"
                style={{ marginTop: 10, minHeight: 110, fontFamily: "var(--mono)" }}
                value={r?._text ?? JSON.stringify(r?.vars ?? {}, null, 2)}
                onChange={(e) => updateRowText(idx, e.target.value)}
                placeholder='{"userId": 1, "token": "abc"}'
              />

              {errors[idx] ? (
                <div className="smallMuted" style={{ color: "var(--danger)", marginTop: 8 }}>
                  {errors[idx]}
                </div>
              ) : (
                <div className="smallMuted" style={{ marginTop: 8 }}>
                  Use variables like <span style={{ fontFamily: "var(--mono)" }}>{"{{userId}}"}</span> in URL/headers/body.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
