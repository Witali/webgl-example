/*
 * Purpose: Asset helper that asks a real browser to encode selected JPEG
 * fixtures into WebP files.
 * Processing blocks:
 * - Serve the project through the browser harness.
 * - Draw each source image to a canvas and export image/webp.
 * - Write the generated WebP assets back into the repo.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const quality = Number(process.env.WEBP_QUALITY || 0.86);
const assets = [
  {
    source: "/assets/stone-texture-small.jpg",
    output: "assets/stone-texture-small.webp",
  },
  {
    source: "/assets/benchmark-jpegs/landscape-alaska.jpg",
    output: "assets/benchmark-webps/landscape-alaska.webp",
  },
  {
    source: "/assets/benchmark-jpegs/landscape-cleveland-volcano.jpg",
    output: "assets/benchmark-webps/landscape-cleveland-volcano.webp",
  },
  {
    source: "/assets/benchmark-jpegs/landscape-horizon.jpg",
    output: "assets/benchmark-webps/landscape-horizon.webp",
  },
  {
    source: "/assets/benchmark-jpegs/landscape-pennsylvania-pond.jpg",
    output: "assets/benchmark-webps/landscape-pennsylvania-pond.webp",
  },
  {
    source: "/assets/benchmark-jpegs/landscape-madison-golf-course.jpg",
    output: "assets/benchmark-webps/landscape-madison-golf-course.webp",
  },
];

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

// Encode each configured source image and write the browser-produced WebP bytes to disk.
async function main() {
  for (const asset of assets) {
    const result = await encodeWithBrowser(asset.source);

    if (!result.ok) {
      throw new Error(`Failed to encode ${asset.source}: ${result.error}`);
    }

    const outputPath = path.join(projectRoot, asset.output);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(result.base64, "base64"));
    console.log(`${asset.source} -> ${asset.output} (${result.width}x${result.height}, ${result.bytes} bytes)`);
  }
}

// Browser encoding is driven by evaluating a self-contained canvas/toBlob expression.
function encodeWithBrowser(source) {
  return runBrowserPage({
    projectRoot,
    pagePath: "/index.html",
    query: { encode: source },
    resultExpression: createEncodeExpression(source),
    snapshotExpression: "document.body ? document.body.textContent.slice(0, 240) : null",
    timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 180000),
  });
}

function createEncodeExpression(source) {
  return `
    (() => {
      if (!location.origin || location.origin === "null") {
        return null;
      }

      if (!window.__webpEncodeState) {
        window.__webpEncodeState = { pending: true };
        (async () => {
          const sourceUrl = new URL(${JSON.stringify(source)}, location.href);
          const response = await fetch(sourceUrl, { cache: "no-store" });

          if (!response.ok) {
            throw new Error("Failed to fetch source: " + response.status);
          }

          const bitmap = await createImageBitmap(await response.blob());
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();

          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((value) => {
              if (value) {
                resolve(value);
              } else {
                reject(new Error("Browser did not produce a WebP blob."));
              }
            }, "image/webp", ${JSON.stringify(quality)});
          });
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.addEventListener("load", () => resolve(reader.result));
            reader.addEventListener("error", () => reject(reader.error));
            reader.readAsDataURL(blob);
          });

          window.__webpEncodeState = {
            ok: true,
            width: canvas.width,
            height: canvas.height,
            bytes: blob.size,
            base64: String(dataUrl).split(",")[1],
          };
        })().catch((error) => {
          window.__webpEncodeState = {
            ok: false,
            error: error && error.stack ? error.stack : String(error),
          };
        });
      }

      return window.__webpEncodeState.pending ? null : window.__webpEncodeState;
    })()
  `;
}
