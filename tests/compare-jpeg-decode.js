/*
 * Purpose: Browser test page script that compares one GPU JPEG decode against
 * the native browser decode.
 * Processing blocks:
 * - Decode the same image with GpuJpegDecoder and an HTMLImageElement canvas path.
 * - Read the GPU output texture back to pixels.
 * - Compare channels and publish a JSON result for the Node harness.
 */
"use strict";

const RESULT_START = "COMPARE_RESULT_START";
const RESULT_END = "COMPARE_RESULT_END";
const JPEG_URL = new URLSearchParams(window.location.search).get("image") ||
  "/assets/stone-texture-wic.jpg";

runComparison().catch((error) => {
  writeResult({
    ok: false,
    error: error && error.stack ? error.stack : String(error),
  });
});

// Main smoke test flow: decode through the GPU path, decode natively, then compare pixels.
async function runComparison() {
  writeStatus("creating WebGL context");
  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });

  if (!gl) {
    throw new Error("WebGL is not available in this browser.");
  }

  writeStatus("running GPU JPEG decoder");
  const decoder = await GpuJpegDecoder.create(gl);
  const gpuDecoded = await decoder.decodeUrl(JPEG_URL);
  writeStatus("reading GPU decoded pixels");
  const gpuPixels = readTextureTopLeft(gl, gpuDecoded.texture, gpuDecoded.width, gpuDecoded.height);
  writeStatus("running native browser JPEG decoder");
  const nativeDecoded = await decodeWithBrowser(JPEG_URL);

  if (
    gpuDecoded.width !== nativeDecoded.width ||
    gpuDecoded.height !== nativeDecoded.height
  ) {
    throw new Error(
      `Size mismatch: GPU ${gpuDecoded.width}x${gpuDecoded.height}, native ${nativeDecoded.width}x${nativeDecoded.height}`
    );
  }

  const comparison = comparePixels(gpuPixels, nativeDecoded.pixels, gpuDecoded.width, gpuDecoded.height);

  writeResult({
    ok: comparison.mismatchBytes === 0,
    image: {
      width: gpuDecoded.width,
      height: gpuDecoded.height,
      totalPixels: gpuDecoded.width * gpuDecoded.height,
      totalBytes: gpuPixels.length,
    },
    comparison,
    environment: {
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      floatTextures: Boolean(gl.getExtension("OES_texture_float")),
    },
  });

  gpuDecoded.dispose();
}

function writeStatus(message) {
  document.getElementById("result").textContent = `COMPARE_STATUS ${message}`;
}

function writeResult(result) {
  window.__comparisonResult = result;
  document.getElementById("result").textContent =
    `${RESULT_START}${JSON.stringify(result)}${RESULT_END}`;
}

// GPU textures are read back through a temporary framebuffer for byte-level comparison.
function readTextureTopLeft(gl, texture, width, height) {
  const framebuffer = gl.createFramebuffer();
  const bottomLeftPixels = new Uint8Array(width * height * 4);
  const topLeftPixels = new Uint8Array(bottomLeftPixels.length);
  const rowSize = width * 4;

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Could not attach GPU decoded texture for readback.");
  }

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomLeftPixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = (height - y - 1) * rowSize;
    const sourceEnd = sourceStart + rowSize;
    topLeftPixels.set(bottomLeftPixels.subarray(sourceStart, sourceEnd), y * rowSize);
  }

  return topLeftPixels;
}

// Native browser decode provides the expected RGBA pixels.
async function decodeWithBrowser(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error(`Failed to decode ${url}`)));
    image.src = url;
  });
}

// Comparison keeps both quick pass/fail data and the first mismatches for debugging.
function comparePixels(actual, expected, width, height) {
  let mismatchBytes = 0;
  let mismatchPixels = 0;
  let maxChannelDiff = 0;
  let sumAbsDiff = 0;
  const firstMismatches = [];

  for (let index = 0; index < actual.length; index += 4) {
    let pixelMismatched = false;

    for (let channel = 0; channel < 4; channel += 1) {
      const byteIndex = index + channel;
      const diff = Math.abs(actual[byteIndex] - expected[byteIndex]);

      if (diff !== 0) {
        mismatchBytes += 1;
        pixelMismatched = true;
        sumAbsDiff += diff;
        maxChannelDiff = Math.max(maxChannelDiff, diff);

        if (firstMismatches.length < 16) {
          const pixelIndex = index / 4;

          firstMismatches.push({
            x: pixelIndex % width,
            y: Math.floor(pixelIndex / width),
            channel: ["r", "g", "b", "a"][channel],
            gpu: actual[byteIndex],
            native: expected[byteIndex],
            diff,
          });
        }
      }
    }

    if (pixelMismatched) {
      mismatchPixels += 1;
    }
  }

  return {
    mismatchBytes,
    mismatchPixels,
    mismatchPixelRatio: mismatchPixels / (width * height),
    maxChannelDiff,
    meanAbsDiffPerByte: sumAbsDiff / actual.length,
    firstMismatches,
  };
}
