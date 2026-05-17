"use strict";

const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const image = process.argv[2] || "/assets/stone-texture-small.jpg";
const decoder = process.argv[3] || "gpu";

runBrowserPage({
  projectRoot,
  pagePath: "/tests/visual-jpeg-compare.html",
  query: { image, decoder },
  resultExpression: "document.getElementById('metric-size').textContent !== '-' ? ({ ok: true, size: document.getElementById('metric-size').textContent, pixels: document.getElementById('metric-pixels').textContent, max: document.getElementById('metric-max').textContent, mean: document.getElementById('metric-mean').textContent, status: document.getElementById('status').textContent, comparison: window.__visualComparison || null }) : null",
  snapshotExpression: "({ href: location.href, readyState: document.readyState, body: document.body ? document.body.textContent.slice(0, 300) : null })",
  timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 120000),
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
