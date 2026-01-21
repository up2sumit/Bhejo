import { useState } from "react";

export default function CollectionsPanel({
  collections,
  onAdd,
  onDelete,
}) {
  const [name, setName] = useState("");

  const create = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n);
    setName("");
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ fontWeight: 800 }}>Collections</div>

      <div className="row">
        <input
          className="input"
          placeholder="New collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btnPrimary btnSm" onClick={create}>
          Add
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="smallMuted">No collections yet.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {collections.map((c) => (
            <div key={c.id} className="collectionRow">
              <div style={{ fontWeight: 800 }}>{c.name}</div>
              <button className="btn btnDanger btnSm" onClick={() => onDelete(c.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
