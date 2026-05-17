"use strict";

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get("manifest") || "/assets/benchmark-jpegs/manifest.json";
const wasmUrl = params.get("wasm") || "/wasm/jpeg-idct.wasm";
const format = (params.get("format") || "jpeg").toLowerCase();
const limit = Number(params.get("limit") || 100);
const warmupCount = Number(params.get("warmup") || 3);

runBenchmark().catch((error) => {
  writeResult({
    ok: false,
    error: error && error.stack ? error.stack : String(error),
  });
});

async function runBenchmark() {
  if (format !== "jpeg") {
    throw new Error("This benchmark page compares only JPEG decoders.");
  }

  writeStatus("loading manifest");

  const manifest = await fetchJson(manifestUrl);
  const urls = manifest.slice(0, limit);

  if (urls.length === 0) {
    throw new Error("Benchmark manifest is empty.");
  }

  writeStatus(`fetching ${urls.length} JPEG files`);

  const loadedImages = await fetchImages(urls);
  const wasmDecoder = await WasmJpegDecoder.create(wasmUrl);
  const warmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native browser decoder (${warmupImages.length})`);
  await runNativeDecode(warmupImages, { collectTimings: false });

  writeStatus(`warming WASM decoder (${warmupImages.length})`);
  runWasmDecode(wasmDecoder, warmupImages, { collectTimings: false });

  writeStatus(`benchmarking native browser decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM decoder (${loadedImages.length})`);
  const wasmDecode = runWasmDecode(wasmDecoder, loadedImages, { collectTimings: true });

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
    speedup: {
      wasmTotalVsNative: nativeDecode.totalMs / wasmDecode.totalMs,
      wasmMedianVsNative: nativeDecode.medianMs / wasmDecode.medianMs,
      wasmTrimmedAverageVsNative: nativeDecode.trimmedAvgMs / wasmDecode.trimmedAvgMs,
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

  for (const image of images) {
    const started = performance.now();
    const bitmap = await createImageBitmap(new Blob([image.bytes], { type: "image/jpeg" }));
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
    createElement("h2", "JPEG decode benchmark"),
    createSummaryGrid(result),
    createTimingTable(result),
    createSpeedupTable(result),
    createRawJsonDetails(result)
  );
}

function createSummaryGrid(result) {
  const firstImage = result.dataset.firstImage || {};
  const items = [
    ["Format", "JPEG"],
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
  const speedup = result.speedup || {};
  const table = createTable(
    ["Comparison", "Total", "Median", "Trimmed avg"],
    [[
      "WASM JPEG vs Native browser",
      formatRatio(speedup.wasmTotalVsNative),
      formatRatio(speedup.wasmMedianVsNative),
      formatRatio(speedup.wasmTrimmedAverageVsNative),
    ]]
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
  return [
    { label: "Native browser JPEG", summary: result.nativeDecode },
    { label: "WASM JPEG", summary: result.wasmDecode },
  ];
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
