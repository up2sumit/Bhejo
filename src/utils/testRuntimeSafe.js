// src/utils/testRuntimeSafe.js

/**
 * Safe Postman-like JS tests using a Web Worker + hard timeout.
 * If script hangs (even infinite loop), worker is terminated.
 *
 * Returns: { passed, total, tests, logs, envDelta }
 */
export function runTestScriptSafe({
  script,
  response,
  request,
  env = {},
  timeoutMs = 1200,
}) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve) => {
    const worker = new Worker(new URL("./testWorker.js", import.meta.url), {
      type: "module",
    });

    const finish = (report) => {
      try {
        worker.terminate();
      } catch {}
      resolve(report);
    };

    const timer = setTimeout(() => {
      finish({
        passed: 0,
        total: 0,
        tests: [],
        logs: [{ type: "error", message: `Test script timed out after ${timeoutMs}ms` }],
        envDelta: {},
      });
    }, timeoutMs);

    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.id !== id) return;
      clearTimeout(timer);
      finish(msg.report);
    };

    worker.onerror = (err) => {
      clearTimeout(timer);
      finish({
        passed: 0,
        total: 0,
        tests: [],
        logs: [{ type: "error", message: `Worker error: ${err?.message || "Unknown"}` }],
        envDelta: {},
      });
    };

    worker.postMessage({
      id,
      script: String(script || ""),
      response: response || {},
      request: request || {},
      env: env || {},
    });
  });
}
