// src/components/CookiesPanel.jsx
import { useEffect, useMemo, useState } from "react";

function formatExpires(expiresAt) {
  if (expiresAt === null || expiresAt === undefined) return "";
  const n = Number(expiresAt);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return String(expiresAt);
  }
}

function proxyBaseFromSettings(settings) {
  const manual = settings?.proxy?.manualUrl || import.meta.env.VITE_PROXY_URL || "http://localhost:3001/proxy";
  return String(manual).replace(/\/proxy\/?$/i, "");
}

export default function CookiesPanel({ settings }) {
  const base = useMemo(() => proxyBaseFromSettings(settings), [settings]);
  const [jars, setJars] = useState([]);
  const [jarId, setJarId] = useState("default");

  const [cookies, setCookies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [newCookie, setNewCookie] = useState({
    name: "",
    value: "",
    domain: "",
    path: "/",
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: "",
    expiresAt: "",
  });

  const [editKey, setEditKey] = useState(null); // string key
  const [editDraft, setEditDraft] = useState(null);

  const api = {
    jars: `${base}/cookiejar/jars`,
    list: `${base}/cookiejar`,
    set: `${base}/cookiejar/set`,
    del: `${base}/cookiejar/delete`,
    clear: `${base}/cookiejar/clear`,
  };

  const refreshJars = async () => {
    try {
      const res = await fetch(api.jars);
      const data = await res.json();
      setJars(Array.isArray(data?.jars) ? data.jars : []);
    } catch {
      // ignore
    }
  };

  const refreshCookies = async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`${api.list}?jarId=${encodeURIComponent(jarId)}`);
      const data = await res.json();
      setCookies(Array.isArray(data?.cookies) ? data.cookies : []);
      setMsg(`Loaded ${data?.count ?? 0} cookies.`);
    } catch (e) {
      setMsg(e?.message || "Failed to load cookies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshJars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshCookies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jarId]);

  const makeRowKey = (c) => `${c.name}|||${c.domain}|||${c.path}`;

  const startEdit = (c) => {
    const key = makeRowKey(c);
    setEditKey(key);
    setEditDraft({
      name: c.name,
      value: c.value ?? "",
      domain: c.domain ?? "",
      path: c.path ?? "/",
      hostOnly: !!c.hostOnly,
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite ?? "",
      expiresAt: c.expiresAt ?? "",
    });
  };

  const cancelEdit = () => {
    setEditKey(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editDraft) return;
    setMsg("");
    try {
      const payload = {
        jarId,
        cookie: {
          ...editDraft,
          expiresAt: editDraft.expiresAt === "" ? null : Number(editDraft.expiresAt),
        },
      };
      const res = await fetch(api.set, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setMsg("Cookie saved.");
      cancelEdit();
      refreshCookies();
    } catch (e) {
      setMsg(e?.message || "Save failed");
    }
  };

  const addCookie = async () => {
    setMsg("");
    const name = newCookie.name.trim();
    if (!name) return setMsg("Name is required");
    if (!newCookie.domain.trim()) return setMsg("Domain is required");

    try {
      const payload = {
        jarId,
        cookie: {
          ...newCookie,
          expiresAt: newCookie.expiresAt === "" ? null : Number(newCookie.expiresAt),
        },
      };

      const res = await fetch(api.set, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Add failed");
      setMsg("Cookie added.");
      setNewCookie({
        name: "",
        value: "",
        domain: newCookie.domain, // keep domain for quick adds
        path: "/",
        hostOnly: true,
        secure: false,
        httpOnly: false,
        sameSite: "",
        expiresAt: "",
      });
      refreshCookies();
      refreshJars();
    } catch (e) {
      setMsg(e?.message || "Add failed");
    }
  };

  const deleteCookie = async (c) => {
    setMsg("");
    try {
      const res = await fetch(api.del, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jarId, name: c.name, domain: c.domain, path: c.path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      setMsg(`Deleted ${data?.removed ?? 0} cookie(s).`);
      refreshCookies();
      refreshJars();
    } catch (e) {
      setMsg(e?.message || "Delete failed");
    }
  };

  const clearJar = async () => {
    setMsg("");
    try {
      const res = await fetch(api.clear, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jarId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Clear failed");
      setMsg("Jar cleared.");
      refreshCookies();
      refreshJars();
    } catch (e) {
      setMsg(e?.message || "Clear failed");
    }
  };

  return (
    <div className="stack">
      <div className="panelTitleRow">
        <div>
          <div className="panelTitle">Cookies</div>
          <div className="muted">Server-side cookie jar. Works mainly in Proxy mode.</div>
        </div>
      </div>

      <div className="panelSubRow">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="muted">Jar</label>
          <select className="select" value={jarId} onChange={(e) => setJarId(e.target.value)}>
            <option value="default">default</option>
            {jars.filter((j) => j !== "default").map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
          <div className="muted" style={{ marginTop: 6 }}>Tip: jarId comes from Request settings (cookie jar).</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <button className="btn btnSm" onClick={refreshCookies} disabled={loading}>Refresh</button>
          <button className="btn btnSm danger" onClick={clearJar} disabled={loading}>Clear Jar</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="muted" style={{ marginBottom: 8 }}>Add cookie</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.7fr", gap: 8 }}>
          <input className="input" placeholder="Name" value={newCookie.name} onChange={(e) => setNewCookie((s) => ({ ...s, name: e.target.value }))} />
          <input className="input" placeholder="Value" value={newCookie.value} onChange={(e) => setNewCookie((s) => ({ ...s, value: e.target.value }))} />
          <input className="input" placeholder="Domain (example.com)" value={newCookie.domain} onChange={(e) => setNewCookie((s) => ({ ...s, domain: e.target.value }))} />
          <input className="input" placeholder="Path (/)" value={newCookie.path} onChange={(e) => setNewCookie((s) => ({ ...s, path: e.target.value }))} />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={newCookie.hostOnly} onChange={(e) => setNewCookie((s) => ({ ...s, hostOnly: e.target.checked }))} />
            hostOnly
          </label>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={newCookie.secure} onChange={(e) => setNewCookie((s) => ({ ...s, secure: e.target.checked }))} />
            secure
          </label>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={newCookie.httpOnly} onChange={(e) => setNewCookie((s) => ({ ...s, httpOnly: e.target.checked }))} />
            httpOnly
          </label>

          <input className="input" style={{ maxWidth: 160 }} placeholder="expiresAt ms (optional)" value={newCookie.expiresAt} onChange={(e) => setNewCookie((s) => ({ ...s, expiresAt: e.target.value }))} />

          <button className="btn btnSm btnPrimary" onClick={addCookie}>Add</button>
        </div>
      </div>

      {msg ? <div className="muted">{msg}</div> : null}

      <div className="headersTable" style={{ maxHeight: "52vh" }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Domain</th>
              <th>Path</th>
              <th>Flags</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cookies.map((c) => {
              const key = makeRowKey(c);
              const editing = editKey === key;

              return (
                <tr key={key}>
                  <td>{c.name}</td>
                  <td style={{ minWidth: 220 }}>
                    {editing ? (
                      <input className="input" value={editDraft?.value ?? ""} onChange={(e) => setEditDraft((s) => ({ ...s, value: e.target.value }))} />
                    ) : (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{String(c.value ?? "")}</span>
                    )}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    {editing ? (
                      <input className="input" value={editDraft?.domain ?? ""} onChange={(e) => setEditDraft((s) => ({ ...s, domain: e.target.value }))} />
                    ) : (
                      c.domain
                    )}
                  </td>
                  <td style={{ minWidth: 120 }}>
                    {editing ? (
                      <input className="input" value={editDraft?.path ?? "/"} onChange={(e) => setEditDraft((s) => ({ ...s, path: e.target.value }))} />
                    ) : (
                      c.path
                    )}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    {editing ? (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={!!editDraft?.hostOnly} onChange={(e) => setEditDraft((s) => ({ ...s, hostOnly: e.target.checked }))} />
                          hostOnly
                        </label>
                        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={!!editDraft?.secure} onChange={(e) => setEditDraft((s) => ({ ...s, secure: e.target.checked }))} />
                          secure
                        </label>
                        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={!!editDraft?.httpOnly} onChange={(e) => setEditDraft((s) => ({ ...s, httpOnly: e.target.checked }))} />
                          httpOnly
                        </label>
                      </div>
                    ) : (
                      <span className="muted">
                        {c.hostOnly ? "hostOnly " : ""}
                        {c.secure ? "secure " : ""}
                        {c.httpOnly ? "httpOnly " : ""}
                        {c.sameSite ? `samesite=${c.sameSite}` : ""}
                      </span>
                    )}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    {editing ? (
                      <input
                        className="input"
                        placeholder="ms or empty"
                        value={editDraft?.expiresAt ?? ""}
                        onChange={(e) => setEditDraft((s) => ({ ...s, expiresAt: e.target.value }))}
                      />
                    ) : (
                      <span className="muted">{formatExpires(c.expiresAt)}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {editing ? (
                      <>
                        <button className="btn btnSm btnPrimary" onClick={saveEdit}>Save</button>{" "}
                        <button className="btn btnSm" onClick={cancelEdit}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btnSm" onClick={() => startEdit(c)}>Edit</button>{" "}
                        <button className="btn btnSm danger" onClick={() => deleteCookie(c)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!cookies.length ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 14 }}>
                  No cookies in this jar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
