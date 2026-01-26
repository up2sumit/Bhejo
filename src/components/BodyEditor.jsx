// src/components/BodyEditor.jsx
import { useMemo } from "react";
import { putFile, removeFile } from "../utils/fileCache";

function encodeFormUrl(rows) {
  const sp = new URLSearchParams();
  for (const r of rows || []) {
    const k = String(r?.key || "").trim();
    if (!k) continue;
    if (r?.enabled === false) continue;
    sp.append(k, r?.value ?? "");
  }
  return sp.toString();
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function BodyEditor({
  method,
  bodyMode,
  setBodyMode,

  body,
  setBody,
  bodyError,
  setBodyError,

  formUrlRows,
  setFormUrlRows,

  formDataRows,
  setFormDataRows,
}) {
  const showBody = !["GET", "HEAD"].includes(String(method || "GET").toUpperCase());

  const onModeChange = (mode) => {
    setBodyMode(mode);
    setBodyError("");
  };

  // JSON validation only when JSON mode
  const onJsonChange = (val) => {
    setBody(val);
    if (val.trim().length === 0) return setBodyError("");
    try {
      JSON.parse(val);
      setBodyError("");
    } catch {
      setBodyError("Invalid JSON body");
    }
  };

  const onRawChange = (val) => {
    setBody(val);
    setBodyError("");
  };

  const updateKv = (rows, setRows, idx, patch) => {
    const copy = [...(rows || [])];
    copy[idx] = { ...(copy[idx] || {}), ...(patch || {}) };
    setRows(copy);
  };

  const addKvRow = (rows, setRows, extra = {}) =>
    setRows([...(rows || []), { key: "", value: "", enabled: true, ...extra }]);

  const removeKvRow = (rows, setRows, idx, fallbackExtra = {}) => {
    const copy = (rows || []).filter((_, i) => i !== idx);
    setRows(copy.length ? copy : [{ key: "", value: "", enabled: true, ...fallbackExtra }]);
  };

  const formUrlPreview = useMemo(() => encodeFormUrl(formUrlRows), [formUrlRows]);

  const onPickFile = (idx, file) => {
    if (!file) return;

    const MAX_MB = 15; // keep practical; proxy JSON payload will grow due to base64
    if (file.size > MAX_MB * 1024 * 1024) {
      setBodyError(`File too large (${formatBytes(file.size)}). Limit is ${MAX_MB} MB.`);
      return;
    }

    const fileRefId = putFile(file);

    updateKv(formDataRows, setFormDataRows, idx, {
      kind: "file",
      fileRefId,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      // value is unused for file rows
      value: "",
    });

    setBodyError("");
  };

  const onClearFile = (idx) => {
    const r = (formDataRows || [])[idx] || {};
    if (r.fileRefId) removeFile(r.fileRefId);

    updateKv(formDataRows, setFormDataRows, idx, {
      kind: "file",
      fileRefId: "",
      fileName: "",
      fileType: "",
      fileSize: 0,
    });
  };

  if (!showBody) return null;

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>Body</div>

        <select
          className="select"
          style={{ maxWidth: 240 }}
          value={bodyMode || "json"}
          onChange={(e) => onModeChange(e.target.value)}
          title="Body type"
        >
          <option value="json">JSON (application/json)</option>
          <option value="text">Raw text (text/plain)</option>
          <option value="formurl">x-www-form-urlencoded</option>
          <option value="formdata">form-data (multipart)</option>
        </select>
      </div>

      {bodyMode === "json" && (
        <>
          <div className="smallMuted" style={{ marginTop: 6 }}>
            Sends JSON. If you don&apos;t set Content-Type manually, Bhejo sets it to application/json.
          </div>
          <textarea
            className="textarea"
            value={body}
            onChange={(e) => onJsonChange(e.target.value)}
            placeholder='{ "email": "test@test.com", "password": "123" }'
          />
          {bodyError ? (
            <div className="smallMuted" style={{ color: "var(--danger)", marginTop: 8 }}>
              {bodyError}
            </div>
          ) : null}
        </>
      )}

      {bodyMode === "text" && (
        <>
          <div className="smallMuted" style={{ marginTop: 6 }}>
            Sends raw text. If you don&apos;t set Content-Type manually, Bhejo sets it to text/plain.
          </div>
          <textarea
            className="textarea"
            value={body}
            onChange={(e) => onRawChange(e.target.value)}
            placeholder="Plain text body..."
          />
        </>
      )}

      {bodyMode === "formurl" && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <div className="smallMuted">
              Encoded as <span style={{ fontFamily: "monospace" }}>key=value&amp;...</span> and sent with
              <span style={{ fontFamily: "monospace" }}> application/x-www-form-urlencoded</span>
            </div>
            <button className="btn btnSm" onClick={() => addKvRow(formUrlRows, setFormUrlRows)}>
              + Add
            </button>
          </div>

          {(formUrlRows || []).map((r, idx) => (
            <div key={idx} className="kvRow" style={{ marginTop: 8 }}>
              <input
                className="input"
                placeholder="key"
                value={r.key}
                onChange={(e) => updateKv(formUrlRows, setFormUrlRows, idx, { key: e.target.value })}
              />
              <input
                className="input"
                placeholder="value"
                value={r.value}
                onChange={(e) => updateKv(formUrlRows, setFormUrlRows, idx, { value: e.target.value })}
              />
              <button
                className="btn btnSm"
                onClick={() => removeKvRow(formUrlRows, setFormUrlRows, idx)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="smallMuted" style={{ marginTop: 10 }}>
            Preview:&nbsp;
            <span style={{ fontFamily: "monospace" }}>{formUrlPreview || "(empty)"}</span>
          </div>
        </>
      )}

      {bodyMode === "formdata" && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <div className="smallMuted">
              Multipart form-data. File rows are stored as “placeholders” (you may need to reattach after a refresh),
              similar to how Postman stores file paths locally.
            </div>
            <button
              className="btn btnSm"
              onClick={() => addKvRow(formDataRows, setFormDataRows, { kind: "text" })}
            >
              + Add
            </button>
          </div>

          {(formDataRows || []).map((r0, idx) => {
            const r = r0 || {};
            const kind = r.kind || "text";
            const enabled = r.enabled !== false;

            return (
              <div
                key={idx}
                className="kvRow"
                style={{ marginTop: 8, gridTemplateColumns: "1fr 140px 1.4fr 40px" }}
              >
                <input
                  className="input"
                  placeholder="key"
                  value={r.key || ""}
                  onChange={(e) => updateKv(formDataRows, setFormDataRows, idx, { key: e.target.value })}
                />

                <select
                  className="select"
                  value={kind}
                  onChange={(e) => {
                    const nextKind = e.target.value;
                    // clear file metadata when switching
                    updateKv(formDataRows, setFormDataRows, idx, {
                      kind: nextKind,
                      value: nextKind === "text" ? (r.value || "") : "",
                      fileRefId: "",
                      fileName: "",
                      fileType: "",
                      fileSize: 0,
                    });
                  }}
                  title="Field type"
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>

                {kind === "text" ? (
                  <input
                    className="input"
                    placeholder="value"
                    value={r.value || ""}
                    onChange={(e) =>
                      updateKv(formDataRows, setFormDataRows, idx, { value: e.target.value })
                    }
                  />
                ) : (
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="file"
                      className="input"
                      style={{ padding: 6 }}
                      disabled={!enabled}
                      onChange={(e) => onPickFile(idx, e.target.files?.[0] || null)}
                    />
                    {r.fileName ? (
                      <div className="smallMuted" title={r.fileName} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.fileName}{" "}
                        <span style={{ opacity: 0.75 }}>({formatBytes(r.fileSize)})</span>
                        <button
                          className="btn btnSm"
                          style={{ marginLeft: 8 }}
                          onClick={() => onClearFile(idx)}
                          title="Clear file"
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div className="smallMuted">No file selected</div>
                    )}
                  </div>
                )}

                <button
                  className="btn btnSm"
                  onClick={() => removeKvRow(formDataRows, setFormDataRows, idx, { kind: "text" })}
                  title="Remove"
                  type="button"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {bodyError ? (
            <div className="smallMuted" style={{ color: "var(--danger)", marginTop: 8 }}>
              {bodyError}
            </div>
          ) : null}

          <div className="smallMuted" style={{ marginTop: 10 }}>
            Tip: Don&apos;t manually set <b>Content-Type</b> for multipart — the client/proxy will set the boundary.
          </div>
        </>
      )}
    </div>
  );
}
