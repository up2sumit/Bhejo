// Phase 6: Export API docs (Markdown + HTML)
// - Reads saved requests + collections
// - Includes docText + examples grouped by status
// - HTML export: single page with sidebar index (Postman-like)

function escHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slug(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "item"
  );
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}

function groupExamplesByStatus(examples = []) {
  const g = new Map();
  for (const ex of examples || []) {
    const st = ex?.response?.status;
    const key = st ? String(st) : "No response";
    if (!g.has(key)) g.set(key, []);
    g.get(key).push(ex);
  }
  const keys = Array.from(g.keys()).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    const aNum = !Number.isNaN(na) && /^\d+$/.test(a);
    const bNum = !Number.isNaN(nb) && /^\d+$/.test(b);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    if (a === "No response") return 1;
    if (b === "No response") return -1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ key: k, items: g.get(k) || [] }));
}

function reqTitle(req) {
  const method = (req?.method || "GET").toUpperCase();
  const name = req?.name || "";
  const url = req?.url || "";
  return name ? `${name} — ${method} ${url}` : `${method} ${url}`;
}

function mdCodeBlock(lang, text) {
  const t = String(text || "");
  return `\n\n\`\`\`${lang}\n${t}\n\`\`\`\n`;
}

function renderRequestMarkdown(req) {
  const out = [];
  out.push(`## ${reqTitle(req)}`);
  out.push(`- **Mode:** ${req?.mode || "direct"}`);
  out.push(`- **URL:** ${req?.url || ""}`);
  if (req?.docText) out.push(`\n### Documentation\n${req.docText}`);

  const examples = Array.isArray(req?.examples) ? req.examples : [];
  if (examples.length) {
    out.push(`\n### Examples`);
    const groups = groupExamplesByStatus(examples);
    for (const grp of groups) {
      out.push(`\n#### Status: ${grp.key}`);
      for (const ex of grp.items) {
        const star = ex.id && ex.id === req?.defaultExampleId ? " ★" : "";
        out.push(`\n- **${ex.name || "Example"}**${star} (${fmtDate(ex.createdAt)})`);
        out.push(mdCodeBlock("json", JSON.stringify(ex.request || {}, null, 2)));
        out.push(mdCodeBlock("json", JSON.stringify(ex.response || {}, null, 2)));
      }
    }
  }
  return out.join("\n");
}

export function exportDocsMarkdown({ savedRequests = [], collections = [] }) {
  const out = [];
  out.push(`# Bhejo API Documentation`);
  out.push(`Generated: ${new Date().toLocaleString()}\n`);

  if (collections?.length) {
    out.push(`\n# Collections\n`);
    for (const c of collections) {
      out.push(`## ${c?.name || "Collection"}`);
      const items = Array.isArray(c?.items) ? c.items : [];
      for (const r of items) out.push(renderRequestMarkdown(r));
    }
  }

  if (savedRequests?.length) {
    out.push(`\n# Saved Requests\n`);
    for (const r of savedRequests) out.push(renderRequestMarkdown(r));
  }

  return out.join("\n");
}

function renderExampleHtml(ex, isDefault) {
  const req = ex?.request || {};
  const res = ex?.response || {};
  const title = `${isDefault ? "★ " : ""}${escHtml(ex?.name || "Example")}`;

  return `
    <div class="exCard">
      <div class="exHead">
        <div class="exTitle">${title}</div>
        <div class="exMeta">${escHtml(fmtDate(ex?.createdAt))}</div>
      </div>

      <details>
        <summary>Request snapshot</summary>
        <pre>${escHtml(JSON.stringify(req, null, 2))}</pre>
      </details>

      <details>
        <summary>Response snapshot</summary>
        <pre>${escHtml(JSON.stringify({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          timeMs: res.timeMs,
          headers: res.headers,
          rawText: res.rawText,
        }, null, 2))}</pre>
      </details>
    </div>
  `;
}

function renderRequestHtml(req, sectionId) {
  const title = escHtml(reqTitle(req));
  const docText = req?.docText
    ? `<div class="docText">${escHtml(req.docText)}</div>`
    : `<div class="muted">No documentation.</div>`;

  const examples = Array.isArray(req?.examples) ? req.examples : [];
  let examplesHtml = `<div class="muted">No examples.</div>`;

  if (examples.length) {
    const groups = groupExamplesByStatus(examples);
    examplesHtml = groups
      .map((grp) => {
        const itemsHtml = grp.items
          .map((ex) => renderExampleHtml(ex, ex.id && ex.id === req?.defaultExampleId))
          .join("");
        return `
          <div class="grp">
            <div class="grpHead">Status: ${escHtml(grp.key)} <span class="count">${grp.items.length}</span></div>
            ${itemsHtml}
          </div>
        `;
      })
      .join("");
  }

  return `
    <section class="section" id="${sectionId}">
      <div class="sectionHead">
        <h2>${title}</h2>
        <div class="muted">${escHtml(req?.mode || "direct")} • ${escHtml(req?.url || "")}</div>
      </div>

      <h3>Documentation</h3>
      ${docText}

      <h3>Examples</h3>
      ${examplesHtml}
    </section>
  `;
}

function flattenCollections(collections = []) {
  const nav = [];
  const sections = [];

  for (const col of collections || []) {
    const colName = col?.name || "Collection";
    nav.push({ type: "header", label: colName, href: null });

    const items = Array.isArray(col?.items) ? col.items : [];
    for (const r of items) {
      const id = `req_${slug(colName)}_${slug(r?.name || r?.url || "request")}_${Math.random().toString(16).slice(2, 6)}`;
      nav.push({ type: "item", label: r?.name || reqTitle(r), href: `#${id}` });
      sections.push({ req: r, id });
    }
  }

  return { nav, sections };
}

function flattenSaved(savedRequests = []) {
  const nav = [];
  const sections = [];
  if (savedRequests?.length) nav.push({ type: "header", label: "Saved Requests", href: null });

  for (const r of savedRequests || []) {
    const id = `saved_${slug(r?.name || r?.url || "request")}_${Math.random().toString(16).slice(2, 6)}`;
    nav.push({ type: "item", label: r?.name || reqTitle(r), href: `#${id}` });
    sections.push({ req: r, id });
  }

  return { nav, sections };
}

export function exportDocsHtml({ savedRequests = [], collections = [] }) {
  const a = flattenCollections(collections);
  const b = flattenSaved(savedRequests);

  const nav = [...a.nav, ...b.nav].filter(Boolean);
  const sections = [...a.sections, ...b.sections];

  const navHtml = nav
    .map((n) => {
      if (n.type === "header") return `<div class="navHeader">${escHtml(n.label)}</div>`;
      return `<a class="navItem" href="${escHtml(n.href)}">${escHtml(n.label)}</a>`;
    })
    .join("");

  const bodyHtml = sections.map((s) => renderRequestHtml(s.req, s.id)).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Bhejo API Docs</title>
  <style>
    :root{
      --bg:#0b1220; --panel:#0f172a; --border:rgba(255,255,255,0.10);
      --text:#e5e7eb; --muted:rgba(229,231,235,0.72);
      --accent:#7c3aed;
    }
    *{ box-sizing:border-box; }
    body{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
    a{ color:inherit; text-decoration:none; }
    .wrap{ display:grid; grid-template-columns: 320px 1fr; min-height:100vh; }
    .side{ position:sticky; top:0; height:100vh; overflow:auto; padding:18px; background:linear-gradient(180deg, var(--panel), rgba(15,23,42,0.6)); border-right:1px solid var(--border); }
    .main{ padding:22px; max-width: 1080px; }
    .title{ font-size:18px; font-weight:900; margin-bottom:6px; }
    .subtitle{ color:var(--muted); font-size:12px; margin-bottom:16px; }
    .navHeader{ margin:14px 0 8px; font-weight:900; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; }
    .navItem{ display:block; padding:9px 10px; border-radius:12px; border:1px solid transparent; }
    .navItem:hover{ background:rgba(255,255,255,0.04); border-color:rgba(255,255,255,0.08); }
    .section{ background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:18px; padding:16px; margin-bottom:14px; }
    .sectionHead h2{ margin:0; font-size:16px; }
    .muted{ color:var(--muted); font-size:12px; margin-top:6px; }
    h3{ margin:14px 0 8px; font-size:13px; }
    .docText{ white-space:pre-wrap; background:rgba(0,0,0,0.18); border:1px solid rgba(255,255,255,0.08); padding:10px; border-radius:14px; color:var(--text); }
    .grp{ margin-top:10px; }
    .grpHead{ font-weight:900; font-size:12px; color:var(--muted); display:flex; justify-content:space-between; align-items:center; }
    .count{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10); padding:2px 8px; border-radius:999px; }
    .exCard{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:10px; margin-top:10px; }
    .exHead{ display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .exTitle{ font-weight:800; }
    .exMeta{ color:var(--muted); font-size:12px; }
    details{ margin-top:8px; }
    summary{ cursor:pointer; color:var(--accent); font-weight:800; }
    pre{ margin:8px 0 0; padding:10px; overflow:auto; border-radius:12px; background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.08); }
    @media (max-width: 980px){ ...wrap{ grid-template-columns: 1fr; }
      .side{ position:relative; height:auto; border-right:none; border-bottom:1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <aside class="side">
      <div class="title">Bhejo API Docs</div>
      <div class="subtitle">Generated ${escHtml(new Date().toLocaleString())}</div>
      ${navHtml}
    </aside>

    <main class="main">
      ${bodyHtml || `<div class="muted">No requests found.</div>`}
    </main>
  </div>
</body>
</html>`;
}
