import { useEffect, useMemo, useState } from "react";

export default function SavedPanel({ saved, onLoad, onDelete }) {
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [saved?.length]);

  const visible = useMemo(() => saved.slice(0, visibleCount), [saved, visibleCount]);
  const canLoadMore = saved.length > visibleCount;

  if (!saved?.length) return <div className="smallMuted">No saved requests yet.</div>;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="list">
        {visible.map((item) => (
          <div key={item.id} className="listRow">
            <button className="listRowMain" onClick={() => onLoad(item)}>
              <div style={{ fontWeight: 800 }}>
                {item.name}{" "}
                <span className="badge" style={{ marginLeft: 8 }}>
                  {item.method}
                </span>
              </div>

              <div className="listRowMeta">
                <span className="listRowUrl">{item.url}</span>
                <span className="smallMuted">
                  Updated: {new Date(item.updatedAt || item.createdAt).toLocaleString()}
                </span>
              </div>
            </button>

            <div className="listRowActions">
              <button
                className="iconBtn"
                title="Load into editor"
                aria-label="Load"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onLoad(item);
                }}
              >
                ▶
              </button>

              <button
                className="iconBtn iconBtnDanger"
                title="Delete"
                aria-label="Delete"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(item.id);
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="smallMuted">
          Showing {Math.min(visibleCount, saved.length)} of {saved.length}
        </div>

        {canLoadMore ? (
          <button className="btn btnSm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            Load more
          </button>
        ) : (
          <button className="btn btnSm" disabled>
            End
          </button>
        )}
      </div>
    </div>
  );
}
