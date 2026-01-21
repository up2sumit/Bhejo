import { useEffect, useMemo, useState } from "react";

export default function SavedPanel({
  saved,
  collections,
  onLoad,
  onDelete,
  onUpdateCollection,
}) {
  const getCollectionName = (id) => {
    const c = (collections || []).find((x) => x.id === id);
    return c ? c.name : "(none)";
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {(!saved || saved.length === 0) ? (
        <div className="smallMuted">No saved requests yet.</div>
      ) : (
        saved.map((item) => (
          <div key={item.id} className="historyItem">
            <div
              className="row"
              style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span>{item.name}</span>
                  <span className="badge">{item.method}</span>
                  {item.collectionId ? (
                    <span className="badge">{getCollectionName(item.collectionId)}</span>
                  ) : (
                    <span className="badge">(none)</span>
                  )}
                </div>

                <div className="smallMuted" style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                  {item.url}
                </div>

                {/* Optional: show tests count */}
                {Array.isArray(item.tests) && item.tests.length > 0 ? (
                  <div className="smallMuted" style={{ marginTop: 6 }}>
                    Tests: <span style={{ fontFamily: "var(--mono)" }}>{item.tests.length}</span>
                  </div>
                ) : null}
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btnSm" onClick={() => onLoad?.(item)}>
                  Load
                </button>
                <button className="btn btnDanger btnSm" onClick={() => onDelete?.(item.id)}>
                  Delete
                </button>
              </div>
            </div>

            {/* Collection assignment */}
            <div className="row" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
              <span className="badge">Collection</span>

              <select
                className="select"
                value={item.collectionId || ""}
                onChange={(e) => onUpdateCollection?.(item, e.target.value)}
              >
                <option value="">(none)</option>
                {(collections || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
