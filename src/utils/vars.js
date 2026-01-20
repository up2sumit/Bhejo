// Replace {{var}} with values from envVars.
// Unknown vars are left as-is so user can spot mistakes.
export function replaceVars(input, envVars) {
  if (input == null) return input;
  const str = String(input);

  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const val = envVars?.[key];
    if (val === undefined || val === null) return match;
    return String(val);
  });
}

// Apply replaceVars to structured request parts
export function applyVarsToRequest(draft, envVars) {
  const out = { ...draft };

  out.url = replaceVars(out.url, envVars);

  out.params = (out.params || []).map((p) => ({
    key: replaceVars(p.key, envVars),
    value: replaceVars(p.value, envVars),
  }));

  out.headers = (out.headers || []).map((h) => ({
    key: replaceVars(h.key, envVars),
    value: replaceVars(h.value, envVars),
  }));

  out.body = replaceVars(out.body, envVars);

  // Auth values can also contain vars
  if (out.auth) {
    out.auth = {
      ...out.auth,
      bearer: replaceVars(out.auth.bearer, envVars),
      username: replaceVars(out.auth.username, envVars),
      password: replaceVars(out.auth.password, envVars),
      apiKeyName: replaceVars(out.auth.apiKeyName, envVars),
      apiKeyValue: replaceVars(out.auth.apiKeyValue, envVars),
    };
  }

  return out;
}
