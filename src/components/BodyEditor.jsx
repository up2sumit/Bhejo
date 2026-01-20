export default function BodyEditor({
  method,
  body,
  setBody,
  bodyError,
  setBodyError,
}) {
  const showBody = !["GET", "HEAD"].includes(method);

  const onChange = (val) => {
    setBody(val);
    if (val.trim().length === 0) return setBodyError("");
    try {
      JSON.parse(val);
      setBodyError("");
    } catch {
      setBodyError("Invalid JSON body");
    }
  };

  if (!showBody) return null;

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
        Body (JSON)
      </div>
      <textarea
        className="textarea"
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder='{ "email": "test@test.com", "password": "123" }'
      />
      {bodyError ? (
        <div className="smallMuted" style={{ color: "var(--danger)", marginTop: 8 }}>
          {bodyError}
        </div>
      ) : null}
    </div>
  );
}
