/*
 * Purpose: Browser benchmark runner for native, WASM, WebGL, WebGPU, and WebP
 * image decoding paths.
 * Processing blocks:
 * - Load fixture manifests and image bytes.
 * - Warm up and time each decoder implementation.
 * - Aggregate timing phases, render tables, and expose machine-readable results.
 */
"use strict";

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get("manifest") || "/assets/benchmark-jpegs/manifest.json";
const wasmUrl = params.get("wasm") || "/wasm/jpeg-idct.wasm";
const format = (params.get("format") || "jpeg").toLowerCase();
const limit = Number(params.get("limit") || 100);
const warmupCount = Number(params.get("warmup") || 3);
const readback = params.get("readback") === "1";
const webGpuMode = params.get("webgpu") || "auto";
const includeWebGpu = webGpuMode !== "0";

runBenchmark().catch((error) => {
  writeResult({
    ok: false,
    error: error && error.stack ? error.stack : String(error),
  });
});

// Benchmark dispatcher chooses JPEG or WebP fixtures and gathers all requested decoder timings.
async function runBenchmark() {
  if (format === "webp") {
    await runWebpBenchmark();
    return;
  }

  if (format !== "jpeg") {
    throw new Error(`Unsupported benchmark format: ${format}`);
  }

  writeStatus("loading manifest");

  const manifest = await fetchJson(manifestUrl);
  const urls = manifest.slice(0, limit);

  if (urls.length === 0) {
    throw new Error("Benchmark manifest is empty.");
  }

  writeStatus(`fetching ${urls.length} JPEG files`);

  const loadedImages = await fetchImages(urls);
  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });

  if (!gl) {
    throw new Error("WebGL is not available in this browser.");
  }

  const gpuDecoder = await GpuJpegDecoder.create(gl);
  const wasmDecoder = await WasmJpegDecoder.create(wasmUrl);
  const wasmGpuDecoder = await WasmGpuJpegDecoder.create(gl, wasmUrl);
  const webGpuState = await createWebGpuState();
  const webGpuPrescanState = await createWebGpuState({ entropyMode: "prescan" });
  const webGpuWgslState = await createWebGpuWgslState();
  const webGpuDecoder = webGpuState.decoder;
  const webGpuPrescanDecoder = webGpuPrescanState.decoder;
  const webGpuWgslDecoder = webGpuWgslState.decoder;
  const warmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native browser JPEG decoder (${warmupImages.length})`);
  await runNativeDecode(warmupImages, { collectTimings: false });

  writeStatus(`warming CPU-WASM JPEG decoder (${warmupImages.length})`);
  runWasmDecode(wasmDecoder, warmupImages, { collectTimings: false });

  writeStatus(`warming CPU-WASM+GPU-IDCT JPEG decoder (${warmupImages.length})`);
  runGpuDecode(gl, wasmGpuDecoder, warmupImages, {
    collectTimings: false,
    readback,
  });

  if (webGpuDecoder) {
    writeStatus(`warming GPU-Huff+GPU-IDCT resident JPEG decoder (${warmupImages.length})`);
    await runWebGpuDecode(webGpuDecoder, warmupImages, {
      collectTimings: false,
      readback,
    });
  }

  if (webGpuPrescanDecoder) {
    writeStatus(`warming CPU-JS-Prescan+GPU-Huff+GPU-IDCT JPEG decoder (${warmupImages.length})`);
    await runWebGpuDecode(webGpuPrescanDecoder, warmupImages, {
      collectTimings: false,
      readback,
    });
  }

  if (webGpuWgslDecoder) {
    writeStatus(`warming CPU-JS-Huff+WebGPU-WGSL-IDCT JPEG decoder (${warmupImages.length})`);
    await runAsyncPixelDecode(webGpuWgslDecoder, warmupImages, { collectTimings: false });
  }

  writeStatus(`warming CPU-JS-Huff+GPU-IDCT JPEG decoder (${warmupImages.length})`);
  runGpuDecode(gl, gpuDecoder, warmupImages, {
    collectTimings: false,
    readback,
  });

  writeStatus(`benchmarking native browser JPEG decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, { collectTimings: true });

  writeStatus(`benchmarking CPU-WASM JPEG decoder (${loadedImages.length})`);
  const wasmDecode = runWasmDecode(wasmDecoder, loadedImages, { collectTimings: true });

  writeStatus(`benchmarking CPU-WASM+GPU-IDCT JPEG decoder (${loadedImages.length})`);
  const wasmGpuDecode = runGpuDecode(gl, wasmGpuDecoder, loadedImages, {
    collectTimings: true,
    readback,
  });

  let webGpuDecode = null;
  let webGpuPrescanDecode = null;
  let webGpuWgslDecode = null;

  if (webGpuDecoder) {
    writeStatus(`benchmarking GPU-Huff+GPU-IDCT resident JPEG decoder (${loadedImages.length})`);
    webGpuDecode = await runWebGpuDecode(webGpuDecoder, loadedImages, {
      collectTimings: true,
      readback,
    });
  } else if (includeWebGpu) {
    webGpuDecode = createSkippedSummary(webGpuState.status, loadedImages.length);
  }

  if (webGpuPrescanDecoder) {
    writeStatus(`benchmarking CPU-JS-Prescan+GPU-Huff+GPU-IDCT JPEG decoder (${loadedImages.length})`);
    webGpuPrescanDecode = await runWebGpuDecode(webGpuPrescanDecoder, loadedImages, {
      collectTimings: true,
      readback,
    });
  } else if (includeWebGpu) {
    webGpuPrescanDecode = createSkippedSummary(webGpuPrescanState.status, loadedImages.length);
  }

  if (webGpuWgslDecoder) {
    writeStatus(`benchmarking CPU-JS-Huff+WebGPU-WGSL-IDCT JPEG decoder (${loadedImages.length})`);
    webGpuWgslDecode = await runAsyncPixelDecode(webGpuWgslDecoder, loadedImages, {
      collectTimings: true,
    });
  } else if (includeWebGpu) {
    webGpuWgslDecode = createSkippedSummary(webGpuWgslState.status, loadedImages.length);
  }

  writeStatus(`benchmarking CPU-JS-Huff+GPU-IDCT JPEG decoder (${loadedImages.length})`);
  const gpuDecode = runGpuDecode(gl, gpuDecoder, loadedImages, {
    collectTimings: true,
    readback,
  });

  const totalBytes = loadedImages.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  const totalPixels = loadedImages.reduce((sum, image) => {
    return sum + (image.width || 0) * (image.height || 0);
  }, 0);
  const result = {
    ok: true,
    config: {
      format,
      manifest: manifestUrl,
      wasm: wasmUrl,
      requestedLimit: limit,
      imageCount: loadedImages.length,
      warmupCount,
      readback,
      includeWebGpu,
      webGpuMode,
      webGpuStatus: webGpuState.status,
      webGpuPrescanStatus: webGpuPrescanState.status,
      webGpuWgslStatus: webGpuWgslState.status,
    },
    dataset: createDataset(loadedImages, totalBytes, totalPixels),
    nativeDecode,
    wasmDecode,
    wasmGpuDecode,
    webGpuDecode,
    webGpuPrescanDecode,
    webGpuWgslDecode,
    gpuDecode,
    environment: {
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      floatTextures: Boolean(gl.getExtension("OES_texture_float")),
      userAgent: navigator.userAgent,
    },
  };

  result.speedup = createReferenceSpeedups(result);
  writeResult(result);
}

// WebP benchmark focuses on browser, WASM/libwebp, and pure-JS WebP decode paths.
async function runWebpBenchmark() {
  writeStatus("loading WebP manifest");

  const manifest = await fetchJson(manifestUrl);
  const urls = manifest.slice(0, limit);

  if (urls.length === 0) {
    throw new Error("Benchmark manifest is empty.");
  }

  writeStatus(`fetching ${urls.length} WebP files`);

  const loadedImages = await fetchImages(urls);
  const webpJsDecoder = await JsWebpDecoder.create();
  const webpDecoder = await WasmWebpDecoder.create();
  const warmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native browser WebP decoder (${warmupImages.length})`);
  await runNativeImageElementDecode(warmupImages, {
    collectTimings: false,
    mimeType: "image/webp",
  });

  writeStatus(`warming WebP JS-only decoder (${warmupImages.length})`);
  await runAsyncPixelDecode(webpJsDecoder, warmupImages, { collectTimings: false });

  writeStatus(`warming WebP CPU-WASM decoder (${warmupImages.length})`);
  await runAsyncPixelDecode(webpDecoder, warmupImages, { collectTimings: false });

  writeStatus(`benchmarking native browser WebP decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeImageElementDecode(loadedImages, {
    collectTimings: true,
    mimeType: "image/webp",
  });

  writeStatus(`benchmarking WebP JS-only decoder (${loadedImages.length})`);
  const jsWebpDecode = await runAsyncPixelDecode(webpJsDecoder, loadedImages, {
    collectTimings: true,
  });

  writeStatus(`benchmarking WebP CPU-WASM decoder (${loadedImages.length})`);
  const wasmWebpDecode = await runAsyncPixelDecode(webpDecoder, loadedImages, {
    collectTimings: true,
  });

  const totalBytes = loadedImages.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  const totalPixels = loadedImages.reduce((sum, image) => {
    return sum + (image.width || 0) * (image.height || 0);
  }, 0);
  const result = {
    ok: true,
    config: {
      format,
      manifest: manifestUrl,
      requestedLimit: limit,
      imageCount: loadedImages.length,
      warmupCount,
    },
    dataset: createDataset(loadedImages, totalBytes, totalPixels),
    nativeDecode,
    jsWebpDecode,
    wasmWebpDecode,
    environment: {
      userAgent: navigator.userAgent,
    },
  };

  result.speedup = createReferenceSpeedups(result);
  writeResult(result);
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

// Dataset loading keeps bytes, blobs, and aggregate size information reusable across decoders.
async function fetchImages(urls) {
  return Promise.all(urls.map(async (url) => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const bytes = await response.arrayBuffer();

    return {
      url,
      bytes,
      width: 0,
      height: 0,
    };
  }));
}

function createDataset(loadedImages, totalBytes, totalPixels) {
  return {
    totalBytes,
    totalPixels,
    megapixels: totalPixels / 1000000,
    firstImage: {
      url: loadedImages[0].url,
      width: loadedImages[0].width,
      height: loadedImages[0].height,
      bytes: loadedImages[0].bytes.byteLength,
    },
  };
}

// WebGPU setup is isolated because it may be skipped when unavailable or disabled.
async function createWebGpuState(options) {
  if (!includeWebGpu) {
    return {
      decoder: null,
      status: "disabled",
    };
  }

  if (!globalThis.navigator || !globalThis.navigator.gpu) {
    return {
      decoder: null,
      status: "navigator.gpu is not available",
    };
  }

  try {
    return {
      decoder: await WebGpuJpegDecoder.create(options),
      status: "enabled",
    };
  } catch (error) {
    return {
      decoder: null,
      status: error && error.message ? error.message : String(error),
    };
  }
}

async function createWebGpuWgslState() {
  if (!includeWebGpu) {
    return {
      decoder: null,
      status: "disabled",
    };
  }

  if (!globalThis.navigator || !globalThis.navigator.gpu) {
    return {
      decoder: null,
      status: "navigator.gpu is not available",
    };
  }

  try {
    return {
      decoder: await WebGpuWgslJpegDecoder.create(),
      status: "enabled",
    };
  } catch (error) {
    return {
      decoder: null,
      status: error && error.message ? error.message : String(error),
    };
  }
}

function getImageBlob(image, mimeType) {
  if (!image.blobs) {
    image.blobs = new Map();
  }

  if (!image.blobs.has(mimeType)) {
    image.blobs.set(mimeType, new Blob([image.bytes], { type: mimeType }));
  }

  return image.blobs.get(mimeType);
}

function createSkippedSummary(reason, skipped) {
  return {
    totalMs: NaN,
    measuredMs: 0,
    avgMs: NaN,
    trimmedAvgMs: NaN,
    trimmedMeasuredMs: 0,
    minMs: NaN,
    medianMs: NaN,
    p95Ms: NaN,
    maxMs: NaN,
    samples: 0,
    skipped,
    skipReason: reason,
    timedPhase: reason,
    measuresCleanWork: true,
  };
}

function createPhaseTotals() {
  return {
    parseMs: 0,
    setupMs: 0,
    uploadMs: 0,
    preScanMs: 0,
    coreDecodeMs: 0,
    gpuDecodeMs: 0,
    wasmDecodeMs: 0,
    readbackMs: 0,
    totalDecoderMs: 0,
    measuresCleanWork: true,
    timedPhase: null,
  };
}

function getWorkSample(decoded, fallbackMs) {
  const timings = decoded && decoded.timings;

  if (timings && Number.isFinite(timings.workMs)) {
    return timings.workMs;
  }

  if (timings && Number.isFinite(timings.decodeMs)) {
    return timings.decodeMs;
  }

  if (timings && Number.isFinite(timings.gpuDecodeMs)) {
    return timings.gpuDecodeMs;
  }

  return fallbackMs;
}

function addPhaseTotals(totals, timings) {
  if (!timings) {
    return;
  }

  [
    "parseMs",
    "setupMs",
    "uploadMs",
    "preScanMs",
    "coreDecodeMs",
    "gpuDecodeMs",
    "wasmDecodeMs",
    "readbackMs",
    "totalDecoderMs",
  ].forEach((key) => {
    if (Number.isFinite(timings[key])) {
      totals[key] += timings[key];
    }
  });

  if (timings.timedPhase && !totals.timedPhase) {
    totals.timedPhase = timings.timedPhase;
  }

  if (timings.measuresCleanWork === false) {
    totals.measuresCleanWork = false;
  }
}

function applyPhaseTotals(summary, totals) {
  Object.entries(totals).forEach(([key, value]) => {
    if (key === "timedPhase") {
      if (value) {
        summary[key] = value;
      }
      return;
    }

    if (key === "measuresCleanWork") {
      summary[key] = value;
      return;
    }

    if (Number.isFinite(value) && value > 0) {
      summary[key] = value;
    }
  });

  if (!summary.timedPhase) {
    summary.timedPhase = "Decoder API";
  }
}

// Native browser paths provide both ImageBitmap/canvas and HTMLImageElement baselines.
async function runNativeDecode(images, options) {
  const timings = [];
  const mimeType = options.mimeType || "image/jpeg";

  for (const image of images) {
    const blob = getImageBlob(image, mimeType);
    const started = performance.now();
    const bitmap = await createImageBitmap(blob);
    const elapsed = performance.now() - started;

    image.width = image.width || bitmap.width;
    image.height = image.height || bitmap.height;
    bitmap.close();

    if (options.collectTimings) {
      timings.push(elapsed);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings);

  summary.measuresCleanWork = true;
  summary.timedPhase = "Browser decode API";
  return summary;
}

async function runNativeImageElementDecode(images, options) {
  const timings = [];
  const mimeType = options.mimeType || "image/jpeg";

  for (const image of images) {
    const blob = getImageBlob(image, mimeType);
    const objectUrl = URL.createObjectURL(blob);
    const started = performance.now();

    try {
      const imageElement = await loadBenchmarkImage(objectUrl);
      const elapsed = performance.now() - started;

      image.width = image.width || imageElement.naturalWidth;
      image.height = image.height || imageElement.naturalHeight;

      if (options.collectTimings) {
        timings.push(elapsed);
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings);

  summary.measuresCleanWork = true;
  summary.timedPhase = "Browser image element decode API";
  return summary;
}

function loadBenchmarkImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Failed to decode ${url}`)), { once: true });
    image.src = url;
  });
}

async function runAsyncPixelDecode(decoder, images, options) {
  const timings = [];
  const phaseTotals = createPhaseTotals();
  let checksum = 0;

  for (const image of images) {
    const started = performance.now();
    const decoded = await decoder.decode(image.bytes);
    const elapsed = performance.now() - started;
    const workMs = getWorkSample(decoded, elapsed);

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.pixels[0] + decoded.pixels[decoded.pixels.length - 4]) & 65535;
    addPhaseTotals(phaseTotals, decoded.timings);

    if (options.collectTimings) {
      timings.push(workMs);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings);

  summary.checksum = checksum;
  applyPhaseTotals(summary, phaseTotals);
  return summary;
}

// Decoder runners time only decode work unless readback is explicitly requested.
function runWasmDecode(decoder, images, options) {
  const timings = [];
  const phaseTotals = createPhaseTotals();
  let checksum = 0;

  for (const image of images) {
    const started = performance.now();
    const decoded = decoder.decode(image.bytes);
    const elapsed = performance.now() - started;
    const workMs = getWorkSample(decoded, elapsed);

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.pixels[0] + decoded.pixels[decoded.pixels.length - 4]) & 65535;
    addPhaseTotals(phaseTotals, decoded.timings);

    if (options.collectTimings) {
      timings.push(workMs);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings);

  summary.checksum = checksum;
  applyPhaseTotals(summary, phaseTotals);
  return summary;
}

function runGpuDecode(gl, decoder, images, options) {
  const timings = [];
  const phaseTotals = createPhaseTotals();
  let checksum = 0;

  for (const image of images) {
    const started = performance.now();
    const decoded = decoder.decode(image.bytes);
    const elapsed = performance.now() - started;
    const workMs = getWorkSample(decoded, elapsed);

    if (options.readback) {
      const readbackStarted = performance.now();
      readTexture(gl, decoded.texture, decoded.width, decoded.height);
      decoded.timings.readbackMs += performance.now() - readbackStarted;
    }

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.width + decoded.height) & 65535;
    addPhaseTotals(phaseTotals, decoded.timings);
    decoded.dispose();

    if (options.collectTimings) {
      timings.push(workMs);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings);

  summary.checksum = checksum;
  applyPhaseTotals(summary, phaseTotals);
  return summary;
}

async function runWebGpuDecode(decoder, images, options) {
  const timings = [];
  let checksum = 0;
  const phaseTotals = createPhaseTotals();
  let skipped = 0;
  let skipReason = "";

  for (const image of images) {
    let decoded;

    try {
      decoded = await decoder.decode(image.bytes);
    } catch (error) {
      skipped += 1;

      if (!skipReason) {
        skipReason = error && error.message ? error.message : String(error);
      }

      continue;
    }

    if (options.readback) {
      await decoded.readPixels();
    }

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.width + decoded.height) & 65535;
    addPhaseTotals(phaseTotals, decoded.timings);

    if (options.collectTimings) {
      timings.push(getWorkSample(decoded, decoded.timings.gpuDecodeMs));
    }

    decoded.dispose();
  }

  if (!options.collectTimings) {
    return null;
  }

  if (timings.length === 0) {
    return createSkippedSummary(skipReason || "No WebGPU-resident compatible images", skipped);
  }

  const decodeMs = timings.reduce((sum, value) => sum + value, 0);
  const summary = summarizeTimings(timings, decodeMs);

  summary.checksum = checksum;
  summary.skipped = skipped;
  summary.skipReason = skipReason;
  applyPhaseTotals(summary, phaseTotals);
  return summary;
}

function readTexture(gl, texture, width, height) {
  const framebuffer = gl.createFramebuffer();
  const pixels = new Uint8Array(width * height * 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);

  return pixels;
}

// Summary helpers aggregate raw samples into totals, percentiles, and UI tables.
function summarizeTimings(timings, totalMs) {
  const sorted = timings.slice().sort((a, b) => a - b);
  const sum = timings.reduce((current, value) => current + value, 0);
  const trimCount = Math.floor(sorted.length * 0.05);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount || sorted.length);
  const trimmedSum = trimmed.reduce((current, value) => current + value, 0);

  return {
    totalMs: Number.isFinite(totalMs) ? totalMs : sum,
    measuredMs: sum,
    avgMs: sum / timings.length,
    trimmedAvgMs: trimmedSum / trimmed.length,
    trimmedMeasuredMs: trimmedSum,
    minMs: sorted[0],
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
    samples: timings.length,
  };
}

function percentile(sorted, value) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * value) - 1)
  );

  return sorted[index];
}

function writeStatus(message) {
  const resultEl = document.getElementById("result");

  resultEl.className = "benchmark-output benchmark-status";
  resultEl.textContent = `BENCHMARK_STATUS ${message}`;
}

function writeResult(result) {
  window.__benchmarkResult = result;
  const resultEl = document.getElementById("result");

  resultEl.className = "benchmark-output";
  resultEl.replaceChildren();

  if (!result.ok) {
    resultEl.append(
      createElement("h2", "Benchmark failed"),
      createElement("pre", result.error || "Unknown benchmark error")
    );
    return;
  }

  resultEl.append(
    createElement("h2", `${formatName(result.config.format)} decode benchmark`),
    createSummaryGrid(result),
    createTimingTable(result),
    createReferenceSpeedupTable(result),
    createRawJsonDetails(result)
  );
}

function createSummaryGrid(result) {
  const firstImage = result.dataset.firstImage || {};
  const items = [
    ["Format", formatName(result.config.format)],
    ["Images", formatInteger(result.config.imageCount)],
    ["Total bytes", formatBytes(result.dataset.totalBytes)],
    ["Total pixels", formatInteger(result.dataset.totalPixels)],
    ["Megapixels", formatNumber(result.dataset.megapixels, 3)],
    ["First image", `${firstImage.width || 0} x ${firstImage.height || 0}`],
  ];

  return createDefinitionGrid(items);
}

function createTimingTable(result) {
  const rows = getTimingRows(result);
  const table = createTable(
    [
      "Decoder",
      "Timed phase",
      "Work total",
      "Avg",
      "Trimmed avg",
      "Median",
      "P95",
      "Min",
      "Max",
      "Setup/upload",
      "Pre-scan",
      "Readback",
      "Samples",
      "Skipped",
    ],
    rows.map((row) => [
      row.label,
      row.summary.timedPhase || "Decoder API",
      formatMs(row.summary.totalMs),
      formatMs(row.summary.avgMs),
      formatMs(row.summary.trimmedAvgMs),
      formatMs(row.summary.medianMs),
      formatMs(row.summary.p95Ms),
      formatMs(row.summary.minMs),
      formatMs(row.summary.maxMs),
      formatMs(getSetupOrUploadMs(row.summary)),
      formatMs(row.summary.preScanMs),
      formatMs(row.summary.readbackMs),
      formatInteger(row.summary.samples),
      formatInteger(row.summary.skipped),
    ])
  );

  return createSection("Clean Work Timings", table);
}

function createReferenceSpeedupTable(result) {
  const rows = getReferenceSpeedupRows(result);

  if (rows.length === 0) {
    return document.createDocumentFragment();
  }

  const table = createTable(
    [
      "Decoder",
      "vs Browser total",
      "vs Browser median",
      "vs Browser trimmed avg",
      "vs WASM total",
      "vs WASM median",
      "vs WASM trimmed avg",
    ],
    rows.map((row) => [
      row.label,
      formatRatio(row.browser.total),
      formatRatio(row.browser.median),
      formatRatio(row.browser.trimmed),
      formatRatio(row.wasm.total),
      formatRatio(row.wasm.median),
      formatRatio(row.wasm.trimmed),
    ])
  );

  return createSection("Reference Speedups", table);
}

function createRawJsonDetails(result) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");

  summary.textContent = "Raw JSON";
  pre.textContent = JSON.stringify(result, null, 2);
  details.append(summary, pre);

  return details;
}

function getTimingRows(result) {
  const rows = [
    ["nativeDecode", "Browser built-in"],
    ["wasmDecode", "CPU-WASM"],
    ["wasmGpuDecode", "CPU-WASM+GPU-IDCT"],
    ["webGpuDecode", "GPU-Huff+GPU-IDCT resident"],
    ["webGpuPrescanDecode", "CPU-JS-Prescan+GPU-Huff+GPU-IDCT"],
    ["webGpuWgslDecode", "CPU-JS-Huff+WebGPU-WGSL-IDCT"],
    ["gpuDecode", "CPU-JS-Huff+GPU-IDCT"],
    ["jsWebpDecode", "WebP JS-only"],
    ["wasmWebpDecode", "WebP CPU-WASM"],
  ];

  return rows
    .filter(([key]) => result[key])
    .map(([key, label]) => ({
      key,
      label,
      summary: result[key],
    }));
}

function createReferenceSpeedups(result) {
  return getReferenceSpeedupRows(result).map((row) => ({
    decoder: row.label,
    vsBrowser: row.browser,
    vsWasm: row.wasm,
  }));
}

function getReferenceSpeedupRows(result) {
  const rows = getTimingRows(result);
  const browserReference = result.nativeDecode;
  const wasmReference = result.wasmDecode || result.wasmWebpDecode;

  if (!browserReference || !wasmReference) {
    return [];
  }

  return rows.map((row) => ({
    label: row.label,
    browser: ratioAgainst(browserReference, row.summary),
    wasm: ratioAgainst(wasmReference, row.summary),
  }));
}

function ratioAgainst(reference, target) {
  return {
    total: reference.totalMs / target.totalMs,
    median: reference.medianMs / target.medianMs,
    trimmed: reference.trimmedAvgMs / target.trimmedAvgMs,
  };
}

function getSetupOrUploadMs(summary) {
  if (Number.isFinite(summary.setupMs)) {
    return summary.setupMs;
  }

  return summary.uploadMs;
}

function createSection(title, child) {
  const section = document.createElement("section");

  section.className = "benchmark-section";
  section.append(createElement("h3", title), child);

  return section;
}

function createDefinitionGrid(items) {
  const grid = document.createElement("dl");

  grid.className = "benchmark-summary";

  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    grid.append(item);
  });

  return grid;
}

function createTable(headers, rows) {
  const wrapper = document.createElement("div");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headRow = document.createElement("tr");

  wrapper.className = "benchmark-table-wrap";

  headers.forEach((header) => {
    const th = document.createElement("th");

    th.textContent = header;
    headRow.append(th);
  });

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    row.forEach((cell) => {
      const td = document.createElement("td");

      td.textContent = cell;
      tr.append(td);
    });

    tbody.append(tr);
  });

  thead.append(headRow);
  table.append(thead, tbody);
  wrapper.append(table);

  return wrapper;
}

function createElement(tagName, text) {
  const element = document.createElement(tagName);

  element.textContent = text;

  return element;
}

function formatName(value) {
  return String(value || "").toUpperCase();
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${formatNumber(value, 2)} ms`;
}

function formatRatio(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${formatNumber(value, 2)}x`;
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return Math.round(value).toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(scaled, unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
