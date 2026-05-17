"use strict";

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get("manifest") || "/assets/benchmark-jpegs/manifest.json";
const wasmUrl = params.get("wasm") || "/wasm/jpeg-idct.wasm";
const format = (params.get("format") || "jpeg").toLowerCase();
const limit = Number(params.get("limit") || 100);
const warmupCount = Number(params.get("warmup") || 3);
const readback = params.get("readback") === "1";

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
  const nativeWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const wasmWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const wasmGpuWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));
  const gpuWarmupImages = loadedImages.slice(0, Math.min(warmupCount, loadedImages.length));

  writeStatus(`warming native decoder (${nativeWarmupImages.length})`);
  await runNativeDecode(nativeWarmupImages, { collectTimings: false });

  writeStatus(`warming WASM decoder (${wasmWarmupImages.length})`);
  runWasmDecode(wasmDecoder, wasmWarmupImages, { collectTimings: false });

  writeStatus(`warming WASM+GPU decoder (${wasmGpuWarmupImages.length})`);
  runGpuDecode(gl, wasmGpuDecoder, wasmGpuWarmupImages, { collectTimings: false, readback });

  writeStatus(`warming GPU decoder (${gpuWarmupImages.length})`);
  runGpuDecode(gl, decoder, gpuWarmupImages, { collectTimings: false, readback });

  writeStatus(`benchmarking native decoder (${loadedImages.length})`);
  const nativeDecode = await runNativeDecode(loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM decoder (${loadedImages.length})`);
  const wasmDecode = runWasmDecode(wasmDecoder, loadedImages, { collectTimings: true });

  writeStatus(`benchmarking WASM+GPU decoder (${loadedImages.length})`);
  const wasmGpuDecode = runGpuDecode(gl, wasmGpuDecoder, loadedImages, { collectTimings: true, readback });

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
  document.getElementById("result").textContent = `BENCHMARK_STATUS ${message}`;
}

function writeResult(result) {
  window.__benchmarkResult = result;
  document.getElementById("result").textContent = JSON.stringify(result, null, 2);
}
