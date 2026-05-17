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

  const decoder = new GpuJpegDecoder(gl);
  const wasmDecoder = await WasmJpegDecoder.create(wasmUrl);
  const wasmGpuDecoder = await WasmGpuJpegDecoder.create(gl, wasmUrl);
  const webGpuDecoder = includeWebGpu ? await WebGpuJpegDecoder.create() : null;
  const nativeWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const wasmWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const wasmGpuWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const webGpuWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const gpuWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native decoder (${nativeWarmupImages.length})`);
  await runNativeDecode(nativeWarmupImages, { collectTimings: false });

  writeStatus(`warming WASM decoder (${wasmWarmupImages.length})`);
  runWasmDecode(wasmDecoder, wasmWarmupImages, { collectTimings: false });

  writeStatus(`warming WASM+GPU decoder (${wasmGpuWarmupImages.length})`);
  runGpuDecode(gl, wasmGpuDecoder, wasmGpuWarmupImages, { collectTimings: false, readback });

  if (webGpuDecoder) {
    writeStatus(`warming WebGPU resident decoder (${webGpuWarmupImages.length})`);
    await runWebGpuDecode(webGpuDecoder, webGpuWarmupImages, { collectTimings: false, readback });
  }

  writeStatus(`warming GPU decoder (${gpuWarmupImages.length})`);
  runGpuDecode(gl, decoder, gpuWarmupImages, { collectTimings: false, readback });

  writeStatus(`benchmarking native decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM decoder (${loadedImages.length})`);
  const wasmDecode = runWasmDecode(wasmDecoder, loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM+GPU decoder (${loadedImages.length})`);
  const wasmGpuDecode = runGpuDecode(gl, wasmGpuDecoder, loadedImages, { collectTimings: true, readback });

  let webGpuDecode = null;

  if (webGpuDecoder) {
    writeStatus(`benchmarking WebGPU resident decoder (${loadedImages.length})`);
    webGpuDecode = await runWebGpuDecode(webGpuDecoder, loadedImages, { collectTimings: true, readback });
  }

  writeStatus(`benchmarking GPU decoder (${loadedImages.length})`);
  const gpuDecode = runGpuDecode(gl, decoder, loadedImages, { collectTimings: true, readback });

  const totalBytes = loadedImages.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  const totalPixels = loadedImages.reduce((sum, image) => {
    return sum + (image.width || 0) * (image.height || 0);
  }, 0);

  writeResult({
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
    dataset: {
      totalBytes,
      totalPixels,
      megapixels: totalPixels / 1000000,
      firstImage: {
        url: loadedImages[0].url,
        width: loadedImages[0].width,
        height: loadedImages[0].height,
        bytes: loadedImages[0].bytes.byteLength,
      },
    },
    nativeDecode,
    wasmDecode,
    wasmGpuDecode,
    webGpuDecode,
    gpuDecode,
    speedup: {
      wasmTotalVsNative: nativeDecode.totalMs / wasmDecode.totalMs,
      wasmMedianVsNative: nativeDecode.medianMs / wasmDecode.medianMs,
      wasmTrimmedAverageVsNative: nativeDecode.trimmedAvgMs / wasmDecode.trimmedAvgMs,
      wasmGpuTotalVsNative: nativeDecode.totalMs / wasmGpuDecode.totalMs,
      wasmGpuMedianVsNative: nativeDecode.medianMs / wasmGpuDecode.medianMs,
      wasmGpuTrimmedAverageVsNative: nativeDecode.trimmedAvgMs / wasmGpuDecode.trimmedAvgMs,
      gpuTotalVsNative: nativeDecode.totalMs / gpuDecode.totalMs,
      gpuMedianVsNative: nativeDecode.medianMs / gpuDecode.medianMs,
      gpuTrimmedAverageVsNative: nativeDecode.trimmedAvgMs / gpuDecode.trimmedAvgMs,
      gpuTotalVsWasm: wasmDecode.totalMs / gpuDecode.totalMs,
      gpuTrimmedAverageVsWasm: wasmDecode.trimmedAvgMs / gpuDecode.trimmedAvgMs,
      wasmGpuTotalVsWasm: wasmDecode.totalMs / wasmGpuDecode.totalMs,
      wasmGpuTrimmedAverageVsWasm: wasmDecode.trimmedAvgMs / wasmGpuDecode.trimmedAvgMs,
      wasmGpuTotalVsGpu: gpuDecode.totalMs / wasmGpuDecode.totalMs,
      wasmGpuTrimmedAverageVsGpu: gpuDecode.trimmedAvgMs / wasmGpuDecode.trimmedAvgMs,
      webGpuTotalVsNative: webGpuDecode ? nativeDecode.totalMs / webGpuDecode.totalMs : null,
      webGpuMedianVsNative: webGpuDecode ? nativeDecode.medianMs / webGpuDecode.medianMs : null,
      webGpuTrimmedAverageVsNative: webGpuDecode ? nativeDecode.trimmedAvgMs / webGpuDecode.trimmedAvgMs : null,
      webGpuTotalVsGpu: webGpuDecode ? gpuDecode.totalMs / webGpuDecode.totalMs : null,
      webGpuTrimmedAverageVsGpu: webGpuDecode ? gpuDecode.trimmedAvgMs / webGpuDecode.trimmedAvgMs : null,
    },
    environment: {
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      floatTextures: Boolean(gl.getExtension("OES_texture_float")),
      userAgent: navigator.userAgent,
    },
  });
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
  const nativeWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const wasmWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native WebP decoder (${nativeWarmupImages.length})`);
  await runNativeDecode(nativeWarmupImages, {
    collectTimings: false,
    mimeType: "image/webp",
  });

  writeStatus(`warming WASM WebP decoder (${wasmWarmupImages.length})`);
  await runAsyncPixelDecode(webpDecoder, wasmWarmupImages, { collectTimings: false });

  writeStatus(`benchmarking native WebP decoder (${loadedImages.length})`);
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

  writeResult({
    ok: true,
    config: {
      format,
      manifest: manifestUrl,
      requestedLimit: limit,
      imageCount: loadedImages.length,
      warmupCount,
    },
    dataset: {
      totalBytes,
      totalPixels,
      megapixels: totalPixels / 1000000,
      firstImage: {
        url: loadedImages[0].url,
        width: loadedImages[0].width,
        height: loadedImages[0].height,
        bytes: loadedImages[0].bytes.byteLength,
      },
    },
    nativeDecode,
    wasmWebpDecode,
    speedup: {
      wasmWebpTotalVsNative: nativeDecode.totalMs / wasmWebpDecode.totalMs,
      wasmWebpMedianVsNative: nativeDecode.medianMs / wasmWebpDecode.medianMs,
      wasmWebpTrimmedAverageVsNative: nativeDecode.trimmedAvgMs / wasmWebpDecode.trimmedAvgMs,
    },
    environment: {
      userAgent: navigator.userAgent,
    },
  });
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

  const totalMs = performance.now() - startedAt;

  return summarizeTimings(timings, totalMs);
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

  const totalMs = performance.now() - startedAt;

  const summary = summarizeTimings(timings, totalMs);

  summary.checksum = checksum;
  return summary;
}

async function runWebGpuDecode(decoder, images, options) {
  const timings = [];
  const startedAt = performance.now();
  let checksum = 0;

  for (const image of images) {
    const buffer = image.bytes.slice(0);
    const started = performance.now();
    const decoded = await decoder.decode(buffer);

    if (options.readback) {
      await decoded.readPixels();
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
    createSpeedupTable(result),
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
    ["Decoder", "Total", "Measured", "Avg", "Trimmed avg", "Median", "P95", "Min", "Max", "Samples"],
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

function createSpeedupTable(result) {
  const rows = getSpeedupRows(result);

  if (rows.length === 0) {
    return document.createDocumentFragment();
  }

  const table = createTable(
    ["Comparison", "Total", "Median", "Trimmed avg"],
    rows.map((row) => [
      row.label,
      formatRatio(row.total),
      formatRatio(row.median),
      formatRatio(row.trimmed),
    ])
  );

  return createSection("Speedups", table);
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
    .map(([key, label]) => ({ label, summary: result[key] }));
}

function getSpeedupRows(result) {
  const speedup = result.speedup || {};

  if (result.config.format === "webp") {
    return [{
      label: "WASM WebP vs Native browser",
      total: speedup.wasmWebpTotalVsNative,
      median: speedup.wasmWebpMedianVsNative,
      trimmed: speedup.wasmWebpTrimmedAverageVsNative,
    }];
  }

  return [
    {
      label: "WASM JPEG vs Native browser",
      total: speedup.wasmTotalVsNative,
      median: speedup.wasmMedianVsNative,
      trimmed: speedup.wasmTrimmedAverageVsNative,
    },
    {
      label: "WASM+GPU JPEG vs Native browser",
      total: speedup.wasmGpuTotalVsNative,
      median: speedup.wasmGpuMedianVsNative,
      trimmed: speedup.wasmGpuTrimmedAverageVsNative,
    },
    {
      label: "GPU JPEG vs Native browser",
      total: speedup.gpuTotalVsNative,
      median: speedup.gpuMedianVsNative,
      trimmed: speedup.gpuTrimmedAverageVsNative,
    },
    {
      label: "WebGPU resident JPEG vs Native browser",
      total: speedup.webGpuTotalVsNative,
      median: speedup.webGpuMedianVsNative,
      trimmed: speedup.webGpuTrimmedAverageVsNative,
    },
    {
      label: "WebGPU resident JPEG vs GPU JPEG",
      total: speedup.webGpuTotalVsGpu,
      median: null,
      trimmed: speedup.webGpuTrimmedAverageVsGpu,
    },
    {
      label: "GPU JPEG vs WASM JPEG",
      total: speedup.gpuTotalVsWasm,
      median: null,
      trimmed: speedup.gpuTrimmedAverageVsWasm,
    },
    {
      label: "WASM+GPU JPEG vs WASM JPEG",
      total: speedup.wasmGpuTotalVsWasm,
      median: null,
      trimmed: speedup.wasmGpuTrimmedAverageVsWasm,
    },
    {
      label: "WASM+GPU JPEG vs GPU JPEG",
      total: speedup.wasmGpuTotalVsGpu,
      median: null,
      trimmed: speedup.wasmGpuTrimmedAverageVsGpu,
    },
  ].filter((row) => {
    return Number.isFinite(row.total) ||
      Number.isFinite(row.median) ||
      Number.isFinite(row.trimmed);
  });
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
