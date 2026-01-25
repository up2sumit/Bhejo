// src/components/RequestTabs.jsx
import { useEffect, useMemo, useRef, useState } from "react";

function safeMethod(m) {
  return String(m || "GET").toUpperCase();
}

function extractPathOnly(url) {
  const raw = String(url || "").trim();
  if (!raw) return "/";

  // Try URL parsing first
  try {
    const u = new URL(raw);
    const p = u.pathname || "/";
    return p.startsWith("/") ? p : `/${p}`;
  } catch {
    // Handle {{baseUrl}}/path or host/path without protocol
    let s = raw;

    // strip leading {{...}} token
    const tokenIdx = s.indexOf("}}");
    if (tokenIdx !== -1) s = s.slice(tokenIdx + 2);

    // remove query/hash
    s = s.split("#")[0];
    s = s.split("?")[0];

    if (s.trim().startsWith("/")) return s.trim() || "/";

    const slash = s.indexOf("/");
    if (slash !== -1) {
      const p = s.slice(slash).trim();
      return p.startsWith("/") ? p : `/${p}`;
    }
    return "/";
  }
}

function smartPath(path, maxLen = 34) {
  const p = String(path || "/") || "/";
  if (p.length <= maxLen) return p;

  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) {
    // single long segment
    return p.slice(0, Math.max(10, maxLen - 1)) + "…";
  }

  // Keep first + last segment, collapse middle
  const first = parts[0];
  const last = parts[parts.length - 1];
  const candidate = `/${first}/…/${last}`;
  if (candidate.length <= maxLen) return candidate;

  // Keep last two segments if still too long
  const last2 = parts.slice(-2).join("/");
  const cand2 = `/…/${last2}`;
  if (cand2.length <= maxLen) return cand2;

  return cand2.slice(0, Math.max(10, maxLen - 1)) + "…";
}


function looksAutoName(name, method) {
  const n = String(name || "").trim();
  if (!n) return false;

  const upper = n.toUpperCase();
  const m = String(method || "").toUpperCase();

  // If name begins with method and then looks like host/path, it's likely auto-generated
  if (upper.startsWith(m + " ")) {
    const rest = n.slice(m.length).trim();
    if (rest.includes("{{") || rest.includes("}}")) return true;
    if (rest.includes("http://") || rest.includes("https://")) return true;
    if (rest.includes("localhost")) return true;
    if (rest.includes(".") && (rest.includes("/") || rest.includes(":"))) return true;
  }

  // Pure URL-ish names (no spaces, contains dot and slash)
  if (!n.includes(" ") && n.includes(".") && n.includes("/")) return true;

  return false;
}

function labelForTab(tab) {
  const d = tab?.draft || {};
  const method = safeMethod(d.method);
  const name = String(d.name || "").trim();
  const url = String(d.url || "").trim();

  // Manual label: keep it short as well
  // Ignore older auto-generated names that look like URLs/hosts
  if (name && !looksAutoName(name, method)) return `${method} ${name}`;

  const path = extractPathOnly(url);
  return `${method} ${smartPath(path)}`;
}

function tooltipText(tab) {
  const d = tab?.draft || {};
  const method = safeMethod(d.method);
  const name = String(d.name || "").trim();
  const url = String(d.url || "").trim();

  const parts = [];
  parts.push(method);
  if (name) parts.push(name);
  parts.push(url || "(no url)");
  if (tab?.lastResponse?.status) parts.push(`Status: ${tab.lastResponse.status}`);
  if (tab?.dirty) parts.push("● Unsaved changes");

  return parts.join("\n");
}

export default function RequestTabs({
  tabs,
  activeId,
  onSwitch,
  onNew,
  onClose,
  onRename,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onCloseAll,
  onDuplicate,
}) {
  const items = useMemo(() => (Array.isArray(tabs) ? tabs : []), [tabs]);

  // --- Rename
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (tab) => {
    setEditingId(tab.id);
    setDraftName(String(tab?.draft?.name || "").trim());
  };

  const commitRename = (tabId) => {
    const next = String(draftName || "").trim();
    onRename?.(tabId, next);
    setEditingId(null);
  };

  const cancelRename = () => setEditingId(null);

  // --- Scroll controls
  const scrollRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft;
    setCanLeft(left > 2);
    setCanRight(max - left > 2);
  };

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => updateScrollButtons();
    el.addEventListener("scroll", onScroll, { passive: true });

    const onResize = () => updateScrollButtons();
    window.addEventListener("resize", onResize);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [items.length]);

  const scrollByAmount = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const amt = Math.max(260, Math.floor(el.clientWidth * 0.65));
    el.scrollBy({ left: dir * amt, behavior: "smooth" });
    window.requestAnimationFrame(updateScrollButtons);
  };

  // --- Context menu
  const [menu, setMenu] = useState(null); // {x,y,tabId}

  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const openContextMenu = (e, tabId) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const menuIndex = menu ? items.findIndex((t) => t.id === menu.tabId) : -1;
  const hasRightTabs = menuIndex !== -1 && menuIndex < items.length - 1;
  const hasLeftTabs = menuIndex > 0;
  const hasOtherTabs = items.length > 1;

  const doMenuAction = (action) => {
    if (!menu?.tabId) return;
    const id = menu.tabId;
    setMenu(null);

    if (action === "close") onClose?.(id);
    if (action === "closeOthers") onCloseOthers?.(id);
    if (action === "closeToRight") onCloseToRight?.(id);
    if (action === "closeToLeft") onCloseToLeft?.(id);
    if (action === "closeAll") onCloseAll?.();
    if (action === "duplicate") onDuplicate?.(id);
    if (action === "rename") {
      const t = items.find((x) => x.id === id);
      if (t) startRename(t);
    }
  };

  return (
    <div className="reqTabsBar" role="tablist" aria-label="Request tabs">
      <button
        className="reqTabsNavBtn"
        type="button"
        onClick={() => scrollByAmount(-1)}
        disabled={!canLeft}
        aria-label="Scroll tabs left"
        title="Scroll left"
      >
        ‹
      </button>

      <div className="reqTabsScroll" ref={scrollRef}>
        {items.map((t) => {
          const isActive = t.id === activeId;
          const label = labelForTab(t);
          const tip = tooltipText(t);
          const isEditing = editingId === t.id;

          return (
            <button
              key={t.id}
              type="button"
              className={`reqTab ${isActive ? "active" : ""}`}
              onClick={() => {
                if (isEditing) return;
                onSwitch?.(t.id);
              }}
              onMouseDown={(e) => {
                // Middle click closes tab
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose?.(t.id);
                }
              }}
              onContextMenu={(e) => openContextMenu(e, t.id)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startRename(t);
              }}
              role="tab"
              aria-selected={isActive}
              title={tip}
            >
              <span className="reqTabTitle">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="reqTabRenameInput"
                    value={draftName}
                    placeholder="Rename…"
                    onChange={(e) => setDraftName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        commitRename(t.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelRename();
                      }
                    }}
                    onBlur={() => commitRename(t.id)}
                  />
                ) : (
                  <>
                    <span className="reqTabLabel">{label}</span>
                    {t.dirty ? (
                      <span className="reqTabDot" title="Unsaved changes">
                        ●
                      </span>
                    ) : null}
                  </>
                )}
              </span>

              <span
                className="reqTabClose"
                role="button"
                aria-label="Close tab"
                title="Close tab"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose?.(t.id);
                }}
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>

      <button
        className="reqTabsNavBtn"
        type="button"
        onClick={() => scrollByAmount(1)}
        disabled={!canRight}
        aria-label="Scroll tabs right"
        title="Scroll right"
      >
        ›
      </button>

      <button
        className="reqTabAdd"
        type="button"
        onClick={onNew}
        title="New tab"
        aria-label="New tab"
      >
        ＋
      </button>

      {menu ? (
        <div
          className="reqTabMenu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="reqTabMenuItem" type="button" onClick={() => doMenuAction("rename")}>
            Rename
          </button>

          <button className="reqTabMenuItem" type="button" onClick={() => doMenuAction("duplicate")}>
            Duplicate
          </button>

          <div className="reqTabMenuSep" />

          <button className="reqTabMenuItem" type="button" onClick={() => doMenuAction("close")}>
            Close
          </button>

          <button
            className="reqTabMenuItem"
            type="button"
            onClick={() => doMenuAction("closeToLeft")}
            disabled={!hasLeftTabs}
          >
            Close to the left
          </button>

          <button
            className="reqTabMenuItem"
            type="button"
            onClick={() => doMenuAction("closeToRight")}
            disabled={!hasRightTabs}
          >
            Close to the right
          </button>

          <button
            className="reqTabMenuItem"
            type="button"
            onClick={() => doMenuAction("closeOthers")}
            disabled={!hasOtherTabs}
          >
            Close others
          </button>

          <button
            className="reqTabMenuItem"
            type="button"
            onClick={() => doMenuAction("closeAll")}
            disabled={items.length === 0}
          >
            Close all
          </button>
        </div>
      ) : null}
    </div>
  );
}
