/*
 * Purpose: Browser capability diagnostics for WebGPU, WebGL, and WebAssembly.
 * Processing blocks:
 * - Query browser/runtime metadata and security context flags.
 * - Probe WebGPU adapter, features, limits, and WGSL compute pipeline creation.
 * - Probe WebGL/WebGL2 contexts and WebAssembly module capabilities.
 */
"use strict";

const refreshButton = document.getElementById("refresh-button");
const statusEl = document.getElementById("status");
const overviewEl = document.getElementById("overview");
const browserDetailsEl = document.getElementById("browser-details");
const webGpuDetailsEl = document.getElementById("webgpu-details");
const webGlDetailsEl = document.getElementById("webgl-details");
const wasmDetailsEl = document.getElementById("wasm-details");

const WASM_EMPTY_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);
const WASM_I64_EXPORT_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7e,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x09, 0x01, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x42, 0x2a, 0x0b,
]);
const WASM_SIMD_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x09, 0x01, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x00, 0x00,
  0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x0b,
]);

const WEBGPU_LIMIT_NAMES = [
  "maxTextureDimension1D",
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxTextureArrayLayers",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
  "maxDynamicUniformBuffersPerPipelineLayout",
  "maxDynamicStorageBuffersPerPipelineLayout",
  "maxSampledTexturesPerShaderStage",
  "maxSamplersPerShaderStage",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesPerShaderStage",
  "maxUniformBuffersPerShaderStage",
  "maxUniformBufferBindingSize",
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupsPerDimension",
];

const WEBGL_LIMITS = [
  ["MAX_TEXTURE_SIZE", "Max texture size"],
  ["MAX_CUBE_MAP_TEXTURE_SIZE", "Max cube map texture size"],
  ["MAX_RENDERBUFFER_SIZE", "Max renderbuffer size"],
  ["MAX_TEXTURE_IMAGE_UNITS", "Texture units"],
  ["MAX_VERTEX_TEXTURE_IMAGE_UNITS", "Vertex texture units"],
  ["MAX_COMBINED_TEXTURE_IMAGE_UNITS", "Combined texture units"],
  ["MAX_VERTEX_ATTRIBS", "Vertex attributes"],
  ["MAX_VERTEX_UNIFORM_VECTORS", "Vertex uniform vectors"],
  ["MAX_FRAGMENT_UNIFORM_VECTORS", "Fragment uniform vectors"],
  ["MAX_VARYING_VECTORS", "Varying vectors"],
  ["MAX_SAMPLES", "Max samples"],
  ["MAX_3D_TEXTURE_SIZE", "Max 3D texture size"],
  ["MAX_ARRAY_TEXTURE_LAYERS", "Max array texture layers"],
];

refreshButton.addEventListener("click", () => {
  runDiagnostics();
});

runDiagnostics();

async function runDiagnostics() {
  setBusy(true);
  setStatus("Checking browser capabilities...");

  try {
    const [browser, webgpu, webgl, wasm] = await Promise.all([
      collectBrowserRuntime(),
      collectWebGpu(),
      collectWebGl(),
      collectWasm(),
    ]);
    const result = { browser, webgpu, webgl, wasm };

    window.__browserSpecsResult = result;
    renderResult(result);
    setStatus(`Checked ${new Date().toLocaleString()}`);
  } catch (error) {
    setStatus(error && error.stack ? error.stack : String(error));
  } finally {
    setBusy(false);
  }
}

function collectBrowserRuntime() {
  return {
    rows: [
      ["User agent", navigator.userAgent],
      ["Platform", navigator.platform || "Unknown"],
      ["Languages", (navigator.languages || [navigator.language]).filter(Boolean).join(", ") || "Unknown"],
      ["Hardware concurrency", valueOrUnknown(navigator.hardwareConcurrency)],
      ["Device memory", navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Not exposed"],
      ["Secure context", yesNo(window.isSecureContext)],
      ["Cross-origin isolated", yesNo(window.crossOriginIsolated)],
      ["OffscreenCanvas", yesNo(typeof OffscreenCanvas !== "undefined")],
      ["ImageBitmap", yesNo(typeof createImageBitmap === "function")],
      ["SharedArrayBuffer", yesNo(typeof SharedArrayBuffer !== "undefined")],
    ],
  };
}

async function collectWebGpu() {
  const result = {
    supported: false,
    adapterReady: false,
    deviceReady: false,
    adapterInfo: [],
    features: [],
    limits: [],
    shader: [],
    status: "navigator.gpu is not available",
  };

  if (!navigator.gpu) {
    return result;
  }

  result.supported = true;
  result.status = "navigator.gpu is available";

  let adapter = null;

  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    result.status = `requestAdapter failed: ${formatError(error)}`;
    return result;
  }

  if (!adapter) {
    result.status = "No adapter returned";
    return result;
  }

  result.adapterReady = true;
  result.adapterInfo = await collectWebGpuAdapterInfo(adapter);
  result.features = Array.from(adapter.features || []).sort();
  result.limits = collectWebGpuLimits(adapter.limits);

  let device = null;

  try {
    device = await adapter.requestDevice();
    result.deviceReady = true;
    result.status = "Device acquired";
    result.shader = await testWebGpuShader(device);
  } catch (error) {
    result.status = `requestDevice failed: ${formatError(error)}`;
  } finally {
    if (device && typeof device.destroy === "function") {
      device.destroy();
    }
  }

  return result;
}

async function collectWebGpuAdapterInfo(adapter) {
  let info = adapter.info || null;

  if (!info && typeof adapter.requestAdapterInfo === "function") {
    try {
      info = await adapter.requestAdapterInfo();
    } catch (error) {
      info = null;
    }
  }

  const rows = [
    ["Fallback adapter", yesNo(adapter.isFallbackAdapter === true)],
  ];

  if (!info) {
    rows.push(["Adapter info", "Not exposed"]);
    return rows;
  }

  [
    "vendor",
    "architecture",
    "device",
    "description",
    "subgroupMinSize",
    "subgroupMaxSize",
  ].forEach((key) => {
    if (info[key] !== undefined && info[key] !== "") {
      rows.push([formatIdentifier(key), String(info[key])]);
    }
  });

  return rows;
}

function collectWebGpuLimits(limits) {
  return WEBGPU_LIMIT_NAMES
    .filter((name) => limits && limits[name] !== undefined)
    .map((name) => {
      const value = /Buffer|StorageSize|BindingSize/.test(name)
        ? formatBytes(Number(limits[name]))
        : formatInteger(Number(limits[name]));

      return [formatIdentifier(name), value];
    });
}

async function testWebGpuShader(device) {
  const code = `
    @compute @workgroup_size(1)
    fn main() {
    }
  `;
  const module = device.createShaderModule({ code });
  const rows = [];

  if (typeof module.getCompilationInfo === "function") {
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === "error");

    rows.push(["WGSL compile messages", errors.length === 0 ? "No errors" : `${errors.length} errors`]);
  }

  if (typeof device.createComputePipelineAsync === "function") {
    await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  } else {
    device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  rows.push(["WGSL compute pipeline", "Created"]);
  return rows;
}

function collectWebGl() {
  return {
    contexts: [
      collectWebGlContext("webgl", "WebGL 1"),
      collectWebGlContext("webgl2", "WebGL 2"),
    ],
  };
}

function collectWebGlContext(contextId, label) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext(contextId, { failIfMajorPerformanceCaveat: false });
  const result = {
    label,
    supported: Boolean(gl),
    rows: [],
    limits: [],
    extensions: [],
  };

  if (!gl) {
    result.rows.push(["Status", "Not available"]);
    return result;
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const attributes = gl.getContextAttributes();

  result.rows = [
    ["Status", "Available"],
    ["Version", gl.getParameter(gl.VERSION)],
    ["Shading language", gl.getParameter(gl.SHADING_LANGUAGE_VERSION)],
    ["Vendor", gl.getParameter(gl.VENDOR)],
    ["Renderer", gl.getParameter(gl.RENDERER)],
    ["Unmasked vendor", debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "Not exposed"],
    ["Unmasked renderer", debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "Not exposed"],
    ["Antialias", yesNo(attributes && attributes.antialias)],
    ["High precision fragment float", formatShaderPrecision(gl, gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)],
  ];
  result.limits = WEBGL_LIMITS
    .filter(([constant]) => typeof gl[constant] === "number")
    .map(([constant, name]) => [name, formatInteger(gl.getParameter(gl[constant]))]);
  result.extensions = (gl.getSupportedExtensions() || []).sort();

  return result;
}

async function collectWasm() {
  const rows = [
    ["WebAssembly object", yesNo(typeof WebAssembly === "object")],
  ];

  if (typeof WebAssembly !== "object") {
    return { rows };
  }

  rows.push(["Core module validate", yesNo(WebAssembly.validate(WASM_EMPTY_MODULE))]);
  rows.push(["SIMD module validate", yesNo(WebAssembly.validate(WASM_SIMD_MODULE))]);
  rows.push(["compile()", yesNo(typeof WebAssembly.compile === "function")]);
  rows.push(["instantiateStreaming()", yesNo(typeof WebAssembly.instantiateStreaming === "function")]);

  rows.push(["Minimal instantiate", await testWasmInstantiate()]);
  rows.push(["Streaming instantiate", await testWasmStreaming()]);
  rows.push(["i64 BigInt export", await testWasmBigInt()]);
  rows.push(["Shared memory", testWasmSharedMemory()]);
  rows.push(["Threads prerequisite", window.crossOriginIsolated ? "crossOriginIsolated" : "Needs cross-origin isolation"]);

  return { rows };
}

async function testWasmInstantiate() {
  try {
    await WebAssembly.instantiate(WASM_EMPTY_MODULE);
    return "OK";
  } catch (error) {
    return formatError(error);
  }
}

async function testWasmStreaming() {
  if (typeof WebAssembly.instantiateStreaming !== "function") {
    return "Not available";
  }

  try {
    const response = new Response(WASM_EMPTY_MODULE, {
      headers: { "Content-Type": "application/wasm" },
    });

    await WebAssembly.instantiateStreaming(Promise.resolve(response));
    return "OK";
  } catch (error) {
    return formatError(error);
  }
}

async function testWasmBigInt() {
  try {
    const result = await WebAssembly.instantiate(WASM_I64_EXPORT_MODULE);
    const value = result.instance.exports.value();

    return typeof value === "bigint" && value === 42n ? "OK" : `Unexpected value: ${String(value)}`;
  } catch (error) {
    return formatError(error);
  }
}

function testWasmSharedMemory() {
  if (typeof SharedArrayBuffer === "undefined") {
    return "SharedArrayBuffer unavailable";
  }

  try {
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });

    return memory.buffer instanceof SharedArrayBuffer ? "OK" : "Created non-shared buffer";
  } catch (error) {
    return formatError(error);
  }
}

function renderResult(result) {
  renderOverview(result);
  renderTable(browserDetailsEl, result.browser.rows);
  renderWebGpu(webGpuDetailsEl, result.webgpu);
  renderWebGl(webGlDetailsEl, result.webgl);
  renderTable(wasmDetailsEl, result.wasm.rows);
}

function renderOverview(result) {
  overviewEl.replaceChildren(
    createSummaryCard("WebGPU", result.webgpu.deviceReady ? "Device ready" : result.webgpu.status),
    createSummaryCard("WebGL", result.webgl.contexts.filter((context) => context.supported).map((context) => context.label).join(" / ") || "Not available"),
    createSummaryCard("WASM", hasWasmOk(result.wasm) ? "Available" : "Limited"),
    createSummaryCard("Secure context", window.isSecureContext ? "Yes" : "No")
  );
}

function renderWebGpu(container, webgpu) {
  container.replaceChildren();
  renderTable(container, [
    ["Status", createBadge(webgpu.deviceReady ? "OK" : webgpu.supported ? "Partial" : "Missing", webgpu.deviceReady ? "ok" : webgpu.supported ? "warn" : "error")],
    ["Summary", webgpu.status],
  ].concat(webgpu.adapterInfo));

  appendSubsection(container, "Features", createTagList(webgpu.features));
  appendSubsection(container, "Limits", createTableElement(webgpu.limits));
  appendSubsection(container, "WGSL", createTableElement(webgpu.shader));
}

function renderWebGl(container, webgl) {
  container.replaceChildren();

  webgl.contexts.forEach((context) => {
    appendSubsection(container, context.label, createTableElement(context.rows));

    if (context.supported) {
      appendSubsection(container, `${context.label} limits`, createTableElement(context.limits));
      appendSubsection(container, `${context.label} extensions`, createTagList(context.extensions));
    }
  });
}

function renderTable(container, rows) {
  container.replaceChildren(createTableElement(rows));
}

function createTableElement(rows) {
  const wrap = document.createElement("div");
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");

  wrap.className = "table-wrap";

  if (!rows || rows.length === 0) {
    const note = document.createElement("p");

    note.className = "empty-note";
    note.textContent = "No data exposed";
    wrap.append(note);
    return wrap;
  }

  rows.forEach(([name, value]) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    const td = document.createElement("td");

    th.scope = "row";
    th.textContent = name;
    appendValue(td, value);
    tr.append(th, td);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function appendSubsection(container, title, child) {
  const heading = document.createElement("h3");

  heading.textContent = title;
  container.append(heading, child);
}

function createSummaryCard(label, value) {
  const card = document.createElement("div");
  const labelEl = document.createElement("span");
  const valueEl = document.createElement("strong");

  card.className = "summary-card";
  labelEl.textContent = label;
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}

function createTagList(items) {
  if (!items || items.length === 0) {
    const note = document.createElement("p");

    note.className = "empty-note";
    note.textContent = "None exposed";
    return note;
  }

  const list = document.createElement("ul");

  list.className = "tag-list";
  items.forEach((item) => {
    const li = document.createElement("li");

    li.textContent = item;
    list.append(li);
  });
  return list;
}

function createBadge(text, tone) {
  const badge = document.createElement("span");

  badge.className = `badge badge-${tone}`;
  badge.textContent = text;
  return badge;
}

function appendValue(container, value) {
  if (value instanceof Node) {
    container.append(value);
    return;
  }

  container.textContent = value === undefined || value === null ? "Unknown" : String(value);
}

function hasWasmOk(wasm) {
  return wasm.rows.some(([name, value]) => name === "Minimal instantiate" && value === "OK");
}

function formatShaderPrecision(gl, shaderType, precisionType) {
  const precision = gl.getShaderPrecisionFormat(shaderType, precisionType);

  if (!precision) {
    return "Not exposed";
  }

  return `precision ${precision.precision}, range ${precision.rangeMin}..${precision.rangeMax}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "Unknown";
  }

  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(current)} ${units[unitIndex]}`;
}

function formatIdentifier(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (first) => first.toUpperCase());
}

function formatInteger(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "Unknown";
}

function formatNumber(value) {
  return Number.isInteger(value) ? formatInteger(value) : value.toFixed(1);
}

function valueOrUnknown(value) {
  return value === undefined || value === null || value === "" ? "Unknown" : String(value);
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function formatError(error) {
  return error && error.message ? error.message : String(error);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setBusy(value) {
  refreshButton.disabled = value;
}
