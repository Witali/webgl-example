"use strict";

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get("manifest") || "/assets/benchmark-jpegs/manifest.json";
const wasmUrl = params.get("wasm") || "/wasm/jpeg-idct.wasm";
const format = (params.get("format") || "jpeg").toLowerCase();
const limit = Number(params.get("limit") || 100);
const warmupCount = Number(params.get("warmup") || 3);
const readback = params.get("readback") === "1";
const includeWebGpu = params.get("webgpu") === "1";

runBenchmark().catch((error) => {
  writeResult({
    ok: false,
    error: error && error.stack ? error.stack : String(error),
  });
});

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

  const gpuDecoder = new GpuJpegDecoder(gl);
  const wasmDecoder = await WasmJpegDecoder.create(wasmUrl);
  const wasmGpuDecoder = await WasmGpuJpegDecoder.create(gl, wasmUrl);
  const webGpuDecoder = includeWebGpu ? await WebGpuJpegDecoder.create() : null;
  const warmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native browser JPEG decoder (${warmupImages.length})`);
  await runNativeDecode(warmupImages, { collectTimings: false });

  writeStatus(`warming WASM JPEG decoder (${warmupImages.length})`);
  runWasmDecode(wasmDecoder, warmupImages, { collectTimings: false });

  writeStatus(`warming WASM+GPU JPEG decoder (${warmupImages.length})`);
  runGpuDecode(gl, wasmGpuDecoder, warmupImages, {
    collectTimings: false,
    readback,
  });

  if (webGpuDecoder) {
    writeStatus(`warming WebGPU resident JPEG decoder (${warmupImages.length})`);
    await runWebGpuDecode(webGpuDecoder, warmupImages, {
      collectTimings: false,
      readback,
    });
  }

  writeStatus(`warming GPU JPEG decoder (${warmupImages.length})`);
  runGpuDecode(gl, gpuDecoder, warmupImages, {
    collectTimings: false,
    readback,
  });

  writeStatus(`benchmarking native browser JPEG decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM JPEG decoder (${loadedImages.length})`);
  const wasmDecode = runWasmDecode(wasmDecoder, loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM+GPU JPEG decoder (${loadedImages.length})`);
  const wasmGpuDecode = runGpuDecode(gl, wasmGpuDecoder, loadedImages, {
    collectTimings: true,
    readback,
  });

  let webGpuDecode = null;

  if (webGpuDecoder) {
    writeStatus(`benchmarking WebGPU resident JPEG decoder (${loadedImages.length})`);
    webGpuDecode = await runWebGpuDecode(webGpuDecoder, loadedImages, {
      collectTimings: true,
      readback,
    });
  }

  writeStatus(`benchmarking GPU JPEG decoder (${loadedImages.length})`);
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
    },
    dataset: createDataset(loadedImages, totalBytes, totalPixels),
    nativeDecode,
    wasmDecode,
    wasmGpuDecode,
    webGpuDecode,
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

async function runWebpBenchmark() {
  writeStatus("loading WebP manifest");

  const manifest = await fetchJson(manifestUrl);
  const urls = manifest.slice(0, limit);

  if (urls.length === 0) {
    throw new Error("Benchmark manifest is empty.");
  }

  writeStatus(`fetching ${urls.length} WebP files`);

  const loadedImages = await fetchImages(urls);
  const webpDecoder = await WasmWebpDecoder.create();
  const warmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native browser WebP decoder (${warmupImages.length})`);
  await runNativeDecode(warmupImages, {
    collectTimings: false,
    mimeType: "image/webp",
  });

  writeStatus(`warming WASM WebP decoder (${warmupImages.length})`);
  await runAsyncPixelDecode(webpDecoder, warmupImages, { collectTimings: false });

  writeStatus(`benchmarking native browser WebP decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, {
    collectTimings: true,
    mimeType: "image/webp",
  });

  writeStatus(`benchmarking WASM WebP decoder (${loadedImages.length})`);
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

async function runNativeDecode(images, options) {
  const timings = [];
  const startedAt = performance.now();
  const mimeType = options.mimeType || "image/jpeg";

  for (const image of images) {
    const started = performance.now();
    const bitmap = await createImageBitmap(new Blob([image.bytes], { type: mimeType }));
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

  return summarizeTimings(timings, performance.now() - startedAt);
}

async function runAsyncPixelDecode(decoder, images, options) {
  const timings = [];
  const startedAt = performance.now();
  let checksum = 0;

  for (const image of images) {
    const buffer = image.bytes.slice(0);
    const started = performance.now();
    const decoded = await decoder.decode(buffer);
    const elapsed = performance.now() - started;

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.pixels[0] + decoded.pixels[decoded.pixels.length - 4]) & 65535;

    if (options.collectTimings) {
      timings.push(elapsed);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings, performance.now() - startedAt);

  summary.checksum = checksum;
  return summary;
}

function runWasmDecode(decoder, images, options) {
  const timings = [];
  const startedAt = performance.now();
  let checksum = 0;

  for (const image of images) {
    const buffer = image.bytes.slice(0);
    const started = performance.now();
    const decoded = decoder.decode(buffer);
    const elapsed = performance.now() - started;

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.pixels[0] + decoded.pixels[decoded.pixels.length - 4]) & 65535;

    if (options.collectTimings) {
      timings.push(elapsed);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings, performance.now() - startedAt);

  summary.checksum = checksum;
  return summary;
}

function runGpuDecode(gl, decoder, images, options) {
  const timings = [];
  const startedAt = performance.now();
  let checksum = 0;

  for (const image of images) {
    const buffer = image.bytes.slice(0);
    const started = performance.now();
    const decoded = decoder.decode(buffer);

    gl.finish();

    if (options.readback) {
      readTexture(gl, decoded.texture, decoded.width, decoded.height);
    }

    const elapsed = performance.now() - started;

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.width + decoded.height) & 65535;
    decoded.dispose();

    if (options.collectTimings) {
      timings.push(elapsed);
    }
  }

  if (!options.collectTimings) {
    return null;
  }

  const summary = summarizeTimings(timings, performance.now() - startedAt);

  summary.checksum = checksum;
  return summary;
}

async function runWebGpuDecode(decoder, images, options) {
  const timings = [];
  let checksum = 0;
  let uploadMs = 0;
  let readbackMs = 0;

  for (const image of images) {
    const buffer = image.bytes.slice(0);
    const decoded = await decoder.decode(buffer);

    if (options.readback) {
      await decoded.readPixels();
    }

    image.width = image.width || decoded.width;
    image.height = image.height || decoded.height;
    checksum = (checksum + decoded.width + decoded.height) & 65535;
    uploadMs += decoded.timings.uploadMs;
    readbackMs += decoded.timings.readbackMs;

    if (options.collectTimings) {
      timings.push(decoded.timings.gpuDecodeMs);
    }

    decoded.dispose();
  }

  if (!options.collectTimings) {
    return null;
  }

  const decodeMs = timings.reduce((sum, value) => sum + value, 0);
  const summary = summarizeTimings(timings, decodeMs);

  summary.checksum = checksum;
  summary.uploadMs = uploadMs;
  summary.readbackMs = readbackMs;
  summary.measuresDecodeOnly = true;
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

function summarizeTimings(timings, totalMs) {
  const sorted = timings.slice().sort((a, b) => a - b);
  const sum = timings.reduce((current, value) => current + value, 0);
  const trimCount = Math.floor(sorted.length * 0.05);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount || sorted.length);
  const trimmedSum = trimmed.reduce((current, value) => current + value, 0);

  return {
    totalMs,
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
      "Total",
      "Measured",
      "Avg",
      "Trimmed avg",
      "Median",
      "P95",
      "Min",
      "Max",
      "Samples",
    ],
    rows.map((row) => [
      row.label,
      formatMs(row.summary.totalMs),
      formatMs(row.summary.measuredMs),
      formatMs(row.summary.avgMs),
      formatMs(row.summary.trimmedAvgMs),
      formatMs(row.summary.medianMs),
      formatMs(row.summary.p95Ms),
      formatMs(row.summary.minMs),
      formatMs(row.summary.maxMs),
      formatInteger(row.summary.samples),
    ])
  );

  return createSection("Timings", table);
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
    ["nativeDecode", "Native browser"],
    ["wasmDecode", "WASM JPEG"],
    ["wasmGpuDecode", "WASM+GPU JPEG"],
    ["webGpuDecode", "WebGPU resident JPEG"],
    ["gpuDecode", "GPU JPEG"],
    ["wasmWebpDecode", "WASM WebP"],
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
