export async function sendHttpRequest({ method, url, headers, body }) {
  const controller = new AbortController();
  const start = performance.now();

  // Convert headers array -> object
  const headerObj = {};
  for (const h of headers) {
    const key = (h.key || "").trim();
    if (!key) continue;
    headerObj[key] = h.value ?? "";
  }

  // Prepare fetch options
  const options = {
    method,
    headers: headerObj,
    signal: controller.signal,
  };

  // Add body only for non-GET/HEAD
  if (!["GET", "HEAD"].includes(method)) {
    if (body && body.trim().length > 0) {
      options.body = body;

      // If user is sending JSON but didn't specify content-type, set it
      const hasContentType = Object.keys(headerObj).some(
        (k) => k.toLowerCase() === "content-type"
      );
      if (!hasContentType) {
        options.headers["Content-Type"] = "application/json";
      }
    }
  }

  const cancel = () => controller.abort();

  try {
    const res = await fetch(url, options);
    const end = performance.now();

    const timeMs = Math.round(end - start);

    // Read as text first, then try parse JSON
    const rawText = await res.text();
    let parsedJson = null;
    try {
      parsedJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsedJson = null;
    }

    // Collect response headers
    const resHeaders = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      timeMs,
      headers: resHeaders,
      rawText,
      json: parsedJson,
    };
  } catch (err) {
    const end = performance.now();
    const timeMs = Math.round(end - start);

    // fetch abort error usually has name AbortError
    return {
      ok: false,
      timeMs,
      errorName: err?.name || "Error",
      errorMessage: err?.message || "Request failed",
    };
  }

  // Note: caller uses cancel() while request is in-flight
  // We return cancel via wrapper below (in component)
}
