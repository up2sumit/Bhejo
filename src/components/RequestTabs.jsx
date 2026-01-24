import { useEffect, useMemo, useRef, useState } from "react";

function isProbablyUrl(s) {
  if (!s) return false;
  const str = String(s).trim();
  return /^https?:\/\//i.test(str) || /^[a-z0-9.-]+\.[a-z]{2,}\/?/i.test(str);
}

function safeParseUrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  try {
    if (/^https?:\/\//i.test(s)) return new URL(s);
    // allow host/path without scheme
    return new URL(`https://${s}`);
  } catch {
    return null;
  }
}

function prettifyFromUrl(rawUrl) {
  const u = safeParseUrl(rawUrl);
  if (!u) return "";
  const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
  if (path) return path;
  return u.host || "";
}

function shorten(s, max = 34) {
  const str = String(s || "");
  if (str.length <= max) return str;
  return str.slice(0, Math.max(10, max - 1)) + "…";
}

function tabDisplayName(tab) {
  const method = tab?.draft?.method || tab?.method || "GET";
  const name = tab?.name;

  // Prefer a human name (not a URL)
  if (name && !isProbablyUrl(name)) {
    return `${method} · ${shorten(name, 38)}`;
  }

  // Otherwise derive from URL (path is best)
  const url = tab?.draft?.url || tab?.draft?.finalUrl || tab?.url;
  const derived = prettifyFromUrl(url);

  if (derived) {
    return `${method} · ${shorten(derived, 46)}`;
  }

  return `${method} · Untitled`;
}

export default function RequestTabs({
  tabs,
  activeId,
  onSwitch,
  onNew,
  onClose,
  compact = false,
}) {
  const scrollerRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const items = useMemo(() => (Array.isArray(tabs) ? tabs : []), [tabs]);

  const updateArrows = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    setCanLeft(scrollLeft > 4);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 4);
  };

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => updateArrows());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [items.length]);

  // Keep active tab visible
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector(`[data-tab-id="${activeId}"]`);
    if (!active) return;
    const a = active.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (a.left < b.left) {
      el.scrollBy({ left: a.left - b.left - 20, behavior: "smooth" });
    } else if (a.right > b.right) {
      el.scrollBy({ left: a.right - b.right + 20, behavior: "smooth" });
    }
  }, [activeId]);

  const scrollByPx = (delta) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className={`reqTabsBar ${compact ? "reqTabsBarCompact" : ""}`}>
      {/* left scroll button */}
      <button
        className="reqTabNavBtn"
        type="button"
        onClick={() => scrollByPx(-260)}
        disabled={!canLeft}
        title="Scroll left"
        aria-label="Scroll left"
      >
        ‹
      </button>

      <div className="reqTabsScroll" ref={scrollerRef}>
        {items.map((t) => {
          const label = tabDisplayName(t);
          return (
            <button
              key={t.id}
              data-tab-id={t.id}
              className={`reqTab ${t.id === activeId ? "active" : ""}`}
              onClick={() => onSwitch(t.id)}
              type="button"
              title={label}
            >
              <span className="reqTabTitle">
                {label}
                {t.dirty ? <span className="reqTabDot">•</span> : null}
              </span>

              <span
                className="reqTabClose"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                role="button"
                title="Close tab"
                aria-label="Close tab"
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>

      {/* right scroll button */}
      <button
        className="reqTabNavBtn"
        type="button"
        onClick={() => scrollByPx(260)}
        disabled={!canRight}
        title="Scroll right"
        aria-label="Scroll right"
      >
        ›
      </button>

      {/* add button */}
      <button className="reqTabAdd" onClick={onNew} type="button" title="New tab" aria-label="New tab">
        +
      </button>
    </div>
  );
}
