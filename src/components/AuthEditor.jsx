import { base64Safe } from "../utils/auth";
export { applyAuthToHeaders } from "../utils/auth";

export default function AuthEditor({ auth, setAuth }) {
  const setType = (type) =>
    setAuth({
      type,
      bearer: "",
      username: "",
      password: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
    });

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Auth</div>

      <div className="row">
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={auth.type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </select>

        <span className="smallMuted">
          Adds auth header automatically (you can still add manual headers too)
        </span>
      </div>

      {auth.type === "bearer" && (
        <div style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder="Token (will be added as Authorization: Bearer ...)"
            value={auth.bearer}
            onChange={(e) => setAuth({ ...auth, bearer: e.target.value })}
          />
        </div>
      )}

      {auth.type === "basic" && (
        <div
          className="kvRow"
          style={{ marginTop: 10, gridTemplateColumns: "1fr 1fr" }}
        >
          <input
            className="input"
            placeholder="Username"
            value={auth.username}
            onChange={(e) => setAuth({ ...auth, username: e.target.value })}
          />
          <input
            className="input"
            placeholder="Password"
            type="password"
            value={auth.password}
            onChange={(e) => setAuth({ ...auth, password: e.target.value })}
          />
          <div className="smallMuted" style={{ gridColumn: "1 / -1" }}>
            Will send: Authorization: Basic {base64Safe("username:password")}
          </div>
        </div>
      )}

      {auth.type === "apikey" && (
        <div style={{ marginTop: 10 }} className="stack">
          <div className="kvRow" style={{ gridTemplateColumns: "1fr 1.6fr" }}>
            <input
              className="input"
              placeholder="Header name (e.g. x-api-key)"
              value={auth.apiKeyName}
              onChange={(e) => setAuth({ ...auth, apiKeyName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Key value"
              value={auth.apiKeyValue}
              onChange={(e) => setAuth({ ...auth, apiKeyValue: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
