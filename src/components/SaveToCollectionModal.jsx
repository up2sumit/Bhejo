// src/components/SaveToCollectionModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { addRequestNode, loadCollectionTrees } from "../utils/storage";

function collectFolders(node, out = [], path = []) {
  if (!node) return out;
  if (node.type === "folder") {
    const currentPath = node.id === "root" ? path : [...path, node.name];
    out.push({ id: node.id, label: currentPath.length ? currentPath.join(" / ") : "Root" });
    for (const child of node.children || []) {
      if (child.type === "folder") collectFolders(child, out, currentPath);
    }
  }
  return out;
}

export default function SaveToCollectionModal({ open, onClose, requestPayload }) {
  const [trees, setTrees] = useState([]);
  const [collectionId, setCollectionId] = useState("");
  const [folderId, setFolderId] = useState("root");
  const [name, setName] = useState("New Request");

  useEffect(() => {
    if (!open) return;
    const t = loadCollectionTrees();
    setTrees(t);
    setCollectionId(t[0]?.id || "");
    setFolderId("root");
  }, [open]);

  const folders = useMemo(() => {
    const col = trees.find((t) => t.id === collectionId);
    if (!col) return [{ id: "root", label: "Root" }];
    return collectFolders(col.root, []);
  }, [trees, collectionId]);

  if (!open) return null;

  const save = () => {
    if (!collectionId) return;
    addRequestNode(collectionId, folderId, name || "Request", requestPayload || {});
    onClose?.(true);
  };

  return (
    <div className="modalOverlay" onClick={() => onClose?.(false)}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalTitle">Save to Collection</div>

        <div className="modalRow">
          <div className="modalLabel">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="modalRow">
          <div className="modalLabel">Collection</div>
          <select className="input" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {trees.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="modalRow">
          <div className="modalLabel">Folder</div>
          <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="modalActions">
          <button className="btn" onClick={() => onClose?.(false)}>Cancel</button>
          <button className="btn" onClick={save} disabled={!collectionId}>Save</button>
        </div>
      </div>
    </div>
  );
}
