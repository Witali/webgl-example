/*
 * Purpose: Interactive visual comparison page for browser, JS, WASM, WebGL,
 * WebGPU, and WebP decoders.
 * Processing blocks:
 * - Resolve selected/uploaded images and choose a matching decoder.
 * - Decode with the browser and selected library path.
 * - Draw source/result/diff canvases, synced zoom state, metrics, and timing text.
 */
"use strict";

// DOM references and static configuration for the comparison controls and metrics.
const form = document.getElementById("controls");
const imageInput = document.getElementById("image-url");
const decoderSelect = document.getElementById("decoder");
const diffScaleInput = document.getElementById("diff-scale");
const diffScaleValue = document.getElementById("diff-scale-value");
const diffScaleCaption = document.getElementById("diff-scale-caption");
const uploadButton = document.getElementById("upload-button");
const fileInput = document.getElementById("image-file");
const statusEl = document.getElementById("status");
const browserCanvas = document.getElementById("browser-canvas");
const libraryCanvas = document.getElementById("library-canvas");
const diffCanvas = document.getElementById("diff-canvas");
const metricSize = document.getElementById("metric-size");
const metricPixels = document.getElementById("metric-pixels");
const metricMax = document.getElementById("metric-max");
const metricMean = document.getElementById("metric-mean");

const DEFAULT_DIFF_SCALE = 16;
const DEFAULT_IMAGE_URL = "/assets/stone-texture-small.jpg";
const STATIC_ASSET_JPEGS = [
  "/assets/stone-texture-small.jpg",
  "/assets/stone-texture-tiny.jpg",
  "/assets/stone-texture.jpg",
  "/assets/stone-texture-wic.jpg",
];
const MAX_BENCH_ASSET_OPTIONS = 2;
const ASSET_JPEG_MANIFESTS = [
  "/assets/benchmark-jpegs/manifest.json",
];
const ASSET_WEBP_MANIFESTS = [
  "/assets/webp-assets/manifest.json",
];
const MIN_IMAGE_ZOOM = 1;
const MAX_IMAGE_ZOOM = 12;
const WHEEL_ZOOM_STEP = 1.18;
const params = new URLSearchParams(window.location.search);
const comparisonCanvases = [browserCanvas, libraryCanvas, diffCanvas];
const comparisonZoomState = {
  scale: 1,
  originX: 50,
  originY: 50,
};

if (params.get("decoder")) {
  decoderSelect.value = params.get("decoder");
}

if (params.get("diffScale") && diffScaleInput) {
  diffScaleInput.value = params.get("diffScale");
}

let wasmDecoderPromise = null;
let webGpuDecoderPromise = null;
let webGpuPrescanDecoderPromise = null;
let webGpuWgslDecoderPromise = null;
let webpDecoderPromise = null;
let webpJsDecoderPromise = null;
let uploadedImageUrl = null;
let lastDiffSource = null;
let assetImageUrls = STATIC_ASSET_JPEGS.slice();

initializeCanvasZoom();

// UI event wiring keeps image selection, uploads, diff scaling, and decoder choice in sync.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  runVisualCompare();
});

if (diffScaleInput) {
  updateDiffScaleLabel();
  diffScaleInput.addEventListener("input", () => {
    updateDiffScaleLabel();
    redrawDiffImage();
  });
}

if (uploadButton && fileInput) {
  uploadButton.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      return;
    }

    if (!isSupportedImageFile(file)) {
      setStatus("Please choose a JPEG or WebP file.");
      fileInput.value = "";
      return;
    }

    releaseUploadedImage();
    uploadedImageUrl = URL.createObjectURL(file);
    addImageOption(uploadedImageUrl, file.name || "Uploaded image");
    imageInput.value = uploadedImageUrl;

    if (isWebpFile(file)) {
      decoderSelect.value = "webp-js";
    }

    runVisualCompare();
  });

  imageInput.addEventListener("change", () => {
    if (uploadedImageUrl && imageInput.value !== uploadedImageUrl) {
      releaseUploadedImage();
    }

    syncDecoderToImage(imageInput.value);
  });
}

initializeImageSelect().then(runVisualCompare);

// Main comparison path: decode both images, draw canvases, compute diffs, and update status.
async function runVisualCompare() {
  const imageUrl = imageInput.value.trim();
  const decoder = decoderSelect.value;

  try {
    setStatus(`Loading ${imageUrl}`);
    resetMetrics();
    lastDiffSource = null;
    window.__webGpuResidentTimings = null;

    const [browserDecoded, libraryDecoded] = await Promise.all([
      decodeWithBrowser(imageUrl),
      decodeWithLibrary(imageUrl, decoder),
    ]);

    if (
      browserDecoded.width !== libraryDecoded.width ||
      browserDecoded.height !== libraryDecoded.height
    ) {
      throw new Error(
        `Size mismatch: browser ${browserDecoded.width}x${browserDecoded.height}, library ${libraryDecoded.width}x${libraryDecoded.height}`
      );
    }

    const comparison = comparePixels(
      libraryDecoded.pixels,
      browserDecoded.pixels,
      browserDecoded.width,
      browserDecoded.height
    );

    window.__visualComparison = comparison;
    lastDiffSource = {
      actual: libraryDecoded.pixels,
      expected: browserDecoded.pixels,
      width: browserDecoded.width,
      height: browserDecoded.height,
    };

    resetAllCanvasZoom();
    drawPixels(browserCanvas, browserDecoded);
    drawPixels(libraryCanvas, libraryDecoded);
    redrawDiffImage();
    updateMetrics(browserDecoded.width, browserDecoded.height, comparison);
    setStatus(
      `Loaded with ${formatDecoderName(decoder)} decoder${formatTimingStatus(libraryDecoded.timings)}`
    );
  } catch (error) {
    setStatus(error && error.stack ? error.stack : String(error));
  }
}

// Decoder dispatch normalizes GPU textures, pixel buffers, WebGPU paths, and WebP decoders.
async function decodeWithLibrary(url, decoder) {
  if (decoder === "webp-js") {
    if (!webpJsDecoderPromise) {
      webpJsDecoderPromise = JsWebpDecoder.create();
    }

    const webpDecoder = await webpJsDecoderPromise;
    const decoded = await webpDecoder.decodeUrl(url);

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: new Uint8ClampedArray(decoded.pixels),
      timings: decoded.timings,
    };
  }

  if (decoder === "webp-wasm") {
    if (!webpDecoderPromise) {
      webpDecoderPromise = WasmWebpDecoder.create();
    }

    const webpDecoder = await webpDecoderPromise;
    const decoded = await webpDecoder.decodeUrl(url);

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: new Uint8ClampedArray(decoded.pixels),
      timings: decoded.timings,
    };
  }

  if (decoder === "wasm") {
    if (!wasmDecoderPromise) {
      wasmDecoderPromise = WasmJpegDecoder.create("/wasm/jpeg-idct.wasm");
    }

    const wasmDecoder = await wasmDecoderPromise;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const decoded = wasmDecoder.decode(await response.arrayBuffer());

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: new Uint8ClampedArray(decoded.pixels),
    };
  }

  if (decoder === "webgpu-wgsl") {
    if (!webGpuWgslDecoderPromise) {
      webGpuWgslDecoderPromise = WebGpuWgslJpegDecoder.create();
    }

    const webGpuWgslDecoder = await webGpuWgslDecoderPromise;
    const decoded = await webGpuWgslDecoder.decodeUrl(url);

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: new Uint8ClampedArray(decoded.pixels),
      timings: decoded.timings,
    };
  }

  if (decoder === "webgpu" || decoder === "webgpu-prescan") {
    const usePreScan = decoder === "webgpu-prescan";

    if (usePreScan && !webGpuPrescanDecoderPromise) {
      webGpuPrescanDecoderPromise = WebGpuJpegDecoder.create({ entropyMode: "prescan" });
    } else if (!usePreScan && !webGpuDecoderPromise) {
      webGpuDecoderPromise = WebGpuJpegDecoder.create();
    }

    const webGpuDecoder = await (usePreScan ? webGpuPrescanDecoderPromise : webGpuDecoderPromise);
    const decoded = await webGpuDecoder.decodeUrl(url);
    const pixels = await decoded.readPixels();
    const timings = { ...decoded.timings };

    decoded.dispose();
    window.__webGpuResidentTimings = timings;

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: new Uint8ClampedArray(pixels),
      timings,
    };
  }

  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });

  if (!gl) {
    throw new Error("WebGL is not available.");
  }

  let gpuDecoder;

  if (decoder === "wasm-gpu") {
    gpuDecoder = await WasmGpuJpegDecoder.create(gl, "/wasm/jpeg-idct.wasm");
  } else {
    gpuDecoder = await GpuJpegDecoder.create(gl);
  }

  const decoded = await gpuDecoder.decodeUrl(url);
  const pixels = readTextureTopLeft(gl, decoded.texture, decoded.width, decoded.height);

  decoded.dispose();

  return {
    width: decoded.width,
    height: decoded.height,
    pixels: new Uint8ClampedArray(pixels),
  };
}

// Browser decode is the visual reference path used for every comparison.
async function decodeWithBrowser(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  return {
    width: canvas.width,
    height: canvas.height,
    pixels,
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
    throw new Error("Could not attach decoded texture for readback.");
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

function drawPixels(canvas, image) {
  const context = canvas.getContext("2d");

  canvas.width = image.width;
  canvas.height = image.height;
  context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
}

// Synchronized wheel zoom applies the same scale/origin to source, decoded, and diff canvases.
function initializeCanvasZoom() {
  comparisonCanvases.forEach((canvas) => {
    const viewport = document.createElement("div");

    viewport.className = "canvas-viewport";
    viewport.tabIndex = 0;
    canvas.before(viewport);
    viewport.append(canvas);

    applyCanvasZoom(canvas, comparisonZoomState);

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      updateCanvasZoomFromWheel(viewport, event);
    }, { passive: false });
  });
}

function updateCanvasZoomFromWheel(viewport, event) {
  const rect = viewport.getBoundingClientRect();
  const wheelSteps = Math.max(-4, Math.min(4, -event.deltaY / 100));

  if (rect.width <= 0 || rect.height <= 0 || wheelSteps === 0) {
    return;
  }

  comparisonZoomState.originX = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  comparisonZoomState.originY = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
  comparisonZoomState.scale = Math.max(
    MIN_IMAGE_ZOOM,
    Math.min(MAX_IMAGE_ZOOM, comparisonZoomState.scale * Math.pow(WHEEL_ZOOM_STEP, wheelSteps))
  );

  if (comparisonZoomState.scale === MIN_IMAGE_ZOOM) {
    comparisonZoomState.originX = 50;
    comparisonZoomState.originY = 50;
  }

  applyComparisonCanvasZoom();
}

function resetAllCanvasZoom() {
  comparisonZoomState.scale = 1;
  comparisonZoomState.originX = 50;
  comparisonZoomState.originY = 50;
  applyComparisonCanvasZoom();
}

function applyComparisonCanvasZoom() {
  comparisonCanvases.forEach((canvas) => {
    applyCanvasZoom(canvas, comparisonZoomState);
  });
}

function applyCanvasZoom(canvas, state) {
  canvas.style.setProperty("--image-zoom", state.scale.toFixed(3));
  canvas.style.setProperty("--image-zoom-origin-x", `${state.originX.toFixed(2)}%`);
  canvas.style.setProperty("--image-zoom-origin-y", `${state.originY.toFixed(2)}%`);
}

// Pixel comparison renders a magnified diff image and records aggregate mismatch metrics.
function createDiffImage(actual, expected, width, height, scale) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < pixels.length; index += 4) {
    const redDiff = Math.abs(actual[index] - expected[index]);
    const greenDiff = Math.abs(actual[index + 1] - expected[index + 1]);
    const blueDiff = Math.abs(actual[index + 2] - expected[index + 2]);
    const diff = Math.max(redDiff, greenDiff, blueDiff);
    const amplified = Math.min(255, diff * scale);

    pixels[index] = amplified;
    pixels[index + 1] = amplified;
    pixels[index + 2] = amplified;
    pixels[index + 3] = 255;
  }

  return { width, height, pixels };
}

function comparePixels(actual, expected, width, height) {
  let mismatchBytes = 0;
  let mismatchPixels = 0;
  let maxChannelDiff = 0;
  let sumAbsDiff = 0;
  const channelSignedDiff = [0, 0, 0, 0];
  const channelAbsDiff = [0, 0, 0, 0];
  const channelPositiveDiffs = [0, 0, 0, 0];
  const channelNegativeDiffs = [0, 0, 0, 0];
  const firstMismatches = [];

  for (let index = 0; index < actual.length; index += 4) {
    let pixelMismatched = false;

    for (let channel = 0; channel < 4; channel += 1) {
      const byteIndex = index + channel;
      const signedDiff = actual[byteIndex] - expected[byteIndex];
      const diff = Math.abs(signedDiff);

      if (diff !== 0) {
        mismatchBytes += 1;
        pixelMismatched = true;
        sumAbsDiff += diff;
        channelSignedDiff[channel] += signedDiff;
        channelAbsDiff[channel] += diff;
        if (signedDiff > 0) {
          channelPositiveDiffs[channel] += 1;
        } else {
          channelNegativeDiffs[channel] += 1;
        }
        maxChannelDiff = Math.max(maxChannelDiff, diff);

        if (firstMismatches.length < 20) {
          const pixelIndex = index / 4;

          firstMismatches.push({
            x: pixelIndex % width,
            y: Math.floor(pixelIndex / width),
            channel: ["r", "g", "b", "a"][channel],
            library: actual[byteIndex],
            browser: expected[byteIndex],
            diff: signedDiff,
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
    channelSignedDiff,
    channelAbsDiff,
    channelPositiveDiffs,
    channelNegativeDiffs,
    firstMismatches,
  };
}

function updateMetrics(width, height, comparison) {
  metricSize.textContent = `${width} x ${height}`;
  metricPixels.textContent = `${comparison.mismatchPixels} / ${width * height} (${formatPercent(comparison.mismatchPixelRatio)})`;
  metricMax.textContent = String(comparison.maxChannelDiff);
  metricMean.textContent = comparison.meanAbsDiffPerByte.toFixed(3);
}

function resetMetrics() {
  metricSize.textContent = "-";
  metricPixels.textContent = "-";
  metricMax.textContent = "-";
  metricMean.textContent = "-";
}

function setStatus(message) {
  statusEl.textContent = message;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function redrawDiffImage() {
  if (!lastDiffSource) {
    return;
  }

  const scale = getDiffScale();

  drawPixels(diffCanvas, createDiffImage(
    lastDiffSource.actual,
    lastDiffSource.expected,
    lastDiffSource.width,
    lastDiffSource.height,
    scale
  ));
  window.__visualDiffScale = scale;
}

function getDiffScale() {
  if (!diffScaleInput) {
    return DEFAULT_DIFF_SCALE;
  }

  const min = Number(diffScaleInput.min) || 1;
  const max = Number(diffScaleInput.max) || 64;
  const value = Number(diffScaleInput.value);

  if (!Number.isFinite(value)) {
    return DEFAULT_DIFF_SCALE;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function updateDiffScaleLabel() {
  const scale = getDiffScale();
  const text = `${scale}x`;

  if (diffScaleInput && diffScaleInput.value !== String(scale)) {
    diffScaleInput.value = String(scale);
  }

  if (diffScaleValue) {
    diffScaleValue.textContent = text;
  }

  if (diffScaleCaption) {
    diffScaleCaption.textContent = text;
  }
}

// Asset discovery fills the image dropdown from static entries and optional manifests.
async function initializeImageSelect() {
  const requestedImage = params.get("image") || DEFAULT_IMAGE_URL;

  try {
    assetImageUrls = await loadAssetImageUrls();
  } catch (error) {
    setStatus(`Could not load asset image list: ${error && error.message ? error.message : error}`);
    assetImageUrls = STATIC_ASSET_JPEGS.slice();
  }

  const selectedImage = assetImageUrls.includes(requestedImage) ||
    !isBenchmarkFixtureUrl(requestedImage)
    ? requestedImage
    : DEFAULT_IMAGE_URL;

  imageInput.replaceChildren();
  assetImageUrls.forEach((url) => {
    addImageOption(url, formatAssetImageLabel(url));
  });

  if (!assetImageUrls.includes(selectedImage)) {
    addImageOption(selectedImage, formatAssetImageLabel(selectedImage));
  }

  imageInput.value = selectedImage;
  syncDecoderToImage(selectedImage);
}

async function loadAssetImageUrls() {
  const urls = new Set(STATIC_ASSET_JPEGS);
  let benchAssetCount = 0;

  for (const manifestUrl of ASSET_JPEG_MANIFESTS) {
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      throw new Error(`${manifestUrl}: ${response.status}`);
    }

    const manifest = await response.json();

    manifest.forEach((url) => {
      if (typeof url !== "string" || !isJpegUrl(url)) {
        return;
      }

      if (isBenchmarkFixtureUrl(url)) {
        if (benchAssetCount >= MAX_BENCH_ASSET_OPTIONS) {
          return;
        }

        benchAssetCount += 1;
      }

      urls.add(url);
    });
  }

  for (const manifestUrl of ASSET_WEBP_MANIFESTS) {
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      throw new Error(`${manifestUrl}: ${response.status}`);
    }

    const manifest = await response.json();

    manifest
      .filter((url) => typeof url === "string" && isWebpUrl(url))
      .forEach((url) => urls.add(url));
  }

  return Array.from(urls);
}

function addImageOption(url, label) {
  const option = document.createElement("option");

  option.value = url;
  option.textContent = label;
  imageInput.append(option);
}

function formatAssetImageLabel(url) {
  if (url.startsWith("blob:")) {
    return "Uploaded image";
  }

  return url.replace(/^\/?assets\//, "");
}

function isJpegUrl(url) {
  return /\.jpe?g(?:[?#].*)?$/i.test(url);
}

function isWebpUrl(url) {
  return /\.webp(?:[?#].*)?$/i.test(url);
}

function isBenchmarkFixtureUrl(url) {
  return /\/bench-[^/]*\.jpe?g(?:[?#].*)?$/i.test(url);
}

function isSupportedImageFile(file) {
  return isJpegFile(file) || isWebpFile(file);
}

function isJpegFile(file) {
  if (file.type) {
    return file.type === "image/jpeg" || file.type === "image/pjpeg";
  }

  return /\.jpe?g$/i.test(file.name);
}

function isWebpFile(file) {
  if (file.type) {
    return file.type === "image/webp";
  }

  return /\.webp$/i.test(file.name);
}

// Decoder choice follows image format so WebP fixtures do not accidentally hit JPEG-only paths.
function syncDecoderToImage(url) {
  if (isWebpUrl(url)) {
    if (decoderSelect.value !== "webp-js" && decoderSelect.value !== "webp-wasm") {
      decoderSelect.value = "webp-js";
    }
    return;
  }

  if (decoderSelect.value === "webp-js" || decoderSelect.value === "webp-wasm") {
    decoderSelect.value = "gpu";
  }
}

function formatDecoderName(decoder) {
  switch (decoder) {
    case "wasm":
      return "CPU-WASM";
    case "webgpu":
      return "GPU-Huff+GPU-IDCT resident";
    case "webgpu-wgsl":
      return "CPU-JS-Huff+WebGPU-WGSL-IDCT";
    case "webgpu-prescan":
      return "CPU-JS-Prescan+GPU-Huff+GPU-IDCT";
    case "wasm-gpu":
      return "CPU-WASM+GPU-IDCT";
    case "webp-js":
      return "WebP JS-only";
    case "webp-wasm":
      return "WebP CPU-WASM";
    default:
      return "CPU-JS-Huff+GPU-IDCT";
  }
}

function formatTimingStatus(timings) {
  if (!timings || !Number.isFinite(timings.gpuDecodeMs)) {
    if (timings && Number.isFinite(timings.decodeMs)) {
      return ` (${timings.decodeMs.toFixed(2)} ms decode${
        Number.isFinite(timings.readbackMs) && timings.readbackMs > 0
          ? `, ${timings.readbackMs.toFixed(2)} ms readback`
          : ""
      })`;
    }

    return "";
  }

  return [
    ` (${timings.gpuDecodeMs.toFixed(2)} ms decode`,
    Number.isFinite(timings.preScanMs) && timings.preScanMs > 0
      ? `${timings.preScanMs.toFixed(2)} ms pre-scan`
      : null,
    `${timings.uploadMs.toFixed(2)} ms upload`,
    `${timings.readbackMs.toFixed(2)} ms readback)`,
  ].filter(Boolean).join(", ");
}

function releaseUploadedImage() {
  if (uploadedImageUrl) {
    const uploadedOption = Array.from(imageInput.options).find((option) => {
      return option.value === uploadedImageUrl;
    });

    if (uploadedOption) {
      uploadedOption.remove();
    }

    URL.revokeObjectURL(uploadedImageUrl);
    uploadedImageUrl = null;
  }

  if (fileInput) {
    fileInput.value = "";
  }
}
