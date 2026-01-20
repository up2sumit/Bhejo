import { useRef, useState } from "react";
import { exportWorkspace, importWorkspace } from "../utils/backup";

export default function ToolsPanel({ onImported }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");

  const doExport = () => {
    const json = exportWorkspace();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `bhejo-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    setMsg("Exported workspace JSON.");
  };

  const doImportClick = () => fileRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const info = importWorkspace(text);
      setMsg(`Imported: ${info.savedCount} saved requests, env loaded.`);
      onImported?.(); // refresh App state
    } catch (err) {
      setMsg(err?.message || "Import failed");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ fontWeight: 800 }}>Tools</div>
      <div className="smallMuted">
        Backup / restore your Saved Requests + Environments.
      </div>

      <div className="row">
        <button className="btn btnPrimary btnSm" onClick={doExport}>
          Export workspace
        </button>
        <button className="btn btnSm" onClick={doImportClick}>
          Import workspace
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>

      {msg ? <div className="smallMuted">{msg}</div> : null}
    </div>
  );
}
