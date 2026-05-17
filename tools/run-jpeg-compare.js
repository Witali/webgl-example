"use strict";

const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const imagePath = process.argv[2] || "/assets/stone-texture-wic.jpg";

runBrowserPage({
  projectRoot,
  pagePath: "/tests/compare-jpeg-decode.html",
  query: { image: imagePath },
  resultExpression: "window.__comparisonResult || null",
  snapshotExpression: "({ href: location.href, readyState: document.readyState, body: document.body ? document.body.textContent : null, hasDecoder: typeof GpuJpegDecoder, hasResult: Boolean(window.__comparisonResult) })",
  timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 120000),
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
