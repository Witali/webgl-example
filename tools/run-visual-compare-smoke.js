/*
 * Purpose: CLI smoke runner for the interactive visual comparison page.
 * Processing blocks:
 * - Open tests/visual-jpeg-compare.html with a selected image and decoder.
 * - Wait until metrics are populated in the DOM.
 * - Print the visible metrics, comparison stats, and optional timing details.
 */
"use strict";

const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const image = process.argv[2] || "/assets/stone-texture-small.jpg";
const decoder = process.argv[3] || "gpu";
const mobileEmulation = process.env.BROWSER_MOBILE_EMULATION === "1"
  ? {
      width: Number(process.env.BROWSER_MOBILE_WIDTH || 390),
      height: Number(process.env.BROWSER_MOBILE_HEIGHT || 844),
      deviceScaleFactor: Number(process.env.BROWSER_MOBILE_SCALE || 3),
      mobile: true,
      touch: true,
      userAgent: process.env.BROWSER_MOBILE_UA ||
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    }
  : null;

runBrowserPage({
  projectRoot,
  emulation: mobileEmulation,
  pagePath: "/tests/visual-jpeg-compare.html",
  query: { image, decoder },
  resultExpression: "document.getElementById('metric-size').textContent !== '-' ? ({ ok: true, size: document.getElementById('metric-size').textContent, pixels: document.getElementById('metric-pixels').textContent, max: document.getElementById('metric-max').textContent, mean: document.getElementById('metric-mean').textContent, status: document.getElementById('status').textContent, optionCount: document.getElementById('image-url').options.length, assetWarnings: window.__visualAssetWarnings || [], selectedTiming: window.__visualSelectedDecoderTiming || null, comparison: window.__visualComparison || null, timings: window.__webGpuResidentTimings || null }) : null",
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
