"use strict";

const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const manifest = process.argv[2] || "/assets/benchmark-jpegs/manifest.json";
const limit = process.argv[3] || "100";
const warmup = process.argv[4] || "3";
const wasm = process.argv[5] || "/wasm/jpeg-idct.wasm";
const readback = process.env.GPU_READBACK === "1" ? "1" : "0";

runBrowserPage({
  projectRoot,
  pagePath: "/tests/benchmark-jpeg-decode.html",
  query: {
    manifest,
    limit,
    warmup,
    wasm,
    readback,
  },
  resultExpression: "window.__benchmarkResult || null",
  snapshotExpression: "({ href: location.href, readyState: document.readyState, body: document.body ? document.body.textContent : null, hasDecoder: typeof GpuJpegDecoder, hasResult: Boolean(window.__benchmarkResult) })",
  timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 300000),
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
