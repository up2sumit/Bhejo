// src/utils/testRuntimeSafe.js
// Phase 4.3.1 - Safe JS tests runtime (Web Worker + hard timeout + returns per-test results)

let workerRef = null;

function getWorker() {
  if (workerRef) return workerRef;
  workerRef = new Worker(new URL("./testWorker.js", import.meta.url), {
    type: "module",
  });
  return workerRef;
}

export async function runTestScriptSafe({
  script,
  response,
  request,
  env,
  setEnv,
  timeoutMs = 1200,
  allowEnvWrites = true,
}) {
  const worker = getWorker();

  return await new Promise((resolve) => {
    const startedAt = performance.now();
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      try {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
      } catch {}
    };

    const finish = (payload) => {
      cleanup();

      // Apply envDelta back to caller
      if (payload?.envDelta && setEnv) {
        try {
          // support object-batch set: setEnv({a:"1"})
          setEnv(payload.envDelta);
        } catch {
          // fallback: per-key
          try {
            for (const [k, v] of Object.entries(payload.envDelta)) {
              setEnv(k, v);
            }
          } catch {}
        }
      }

      resolve({
        ...payload,
        timeMs: Math.round(performance.now() - startedAt),
      });
    };

    const onMsg = (e) => finish(e.data || {});
    const onErr = (e) =>
      finish({
        ok: false,
        passed: 0,
        failed: 0,
        total: 0,
        results: [],
        logs: [],
        error: e?.message || "Worker error",
        timedOut: false,
        envDelta: {},
      });

    worker.addEventListener("message", onMsg, { once: true });
    worker.addEventListener("error", onErr, { once: true });

    // Hard kill timeout (ensures no UI freeze)
    const hard = setTimeout(() => {
      if (done) return;
      // terminate and recreate worker so it can't hang
      try {
        worker.terminate();
      } catch {}
      workerRef = null;

      finish({
        ok: false,
        passed: 0,
        failed: 0,
        total: 0,
        results: [],
        logs: [],
        error: `Test script timeout after ${timeoutMs}ms`,
        timedOut: true,
        envDelta: {},
      });
      clearTimeout(hard);
    }, Math.max(50, timeoutMs + 50));

    // Send job
    worker.postMessage({
      script: String(script || ""),
      response,
      request,
      env: env || {},
      timeoutMs,
      allowEnvWrites,
    });
  });
}
