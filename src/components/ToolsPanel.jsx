import { useRef, useState } from "react";
import { exportWorkspace, importWorkspace } from "../utils/backup";
import { exportDocsMarkdown, exportDocsHtml } from "../utils/docExport";

export default function ToolsPanel({ onImported }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");

  const doExport = () => {
    const json = JSON.stringify(exportWorkspace(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `bhejo-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    setMsg("Exported workspace JSON.");
  };



  const downloadTextFile = (text, filename, mime) => {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doExportDocsMd = () => {
    const md = exportDocsMarkdown();
    downloadTextFile(md, `bhejo-api-docs-${new Date().toISOString().slice(0, 10)}.md`, "text/markdown");
    setMsg("Exported API docs (Markdown).");
  };

  const doExportDocsHtml = () => {
    const html = exportDocsHtml();
    downloadTextFile(html, `bhejo-api-docs-${new Date().toISOString().slice(0, 10)}.html`, "text/html");
    setMsg("Exported API docs (HTML).");
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
      </div>

      <div className="row">
        <button className="btn btnSm" onClick={doExportDocsMd}>
          Export API docs (MD)
        </button>
        <button className="btn btnSm" onClick={doExportDocsHtml}>
          Export API docs (HTML)
        </button>
      </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={onFile}
        />


      {msg ? <div className="smallMuted">{msg}</div> : null}
    </div>
  );
}
