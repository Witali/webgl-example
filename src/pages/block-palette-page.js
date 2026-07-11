"use strict";

const controls = document.getElementById("controls");
const imageSelect = document.getElementById("image-url");
const blockSizeSelect = document.getElementById("block-size");
const localColorCountSelect = document.getElementById("local-color-count");
const globalColorCountSelect = document.getElementById("global-color-count");
const colorSpaceSelect = document.getElementById("color-space");
const uploadButton = document.getElementById("upload-button");
const fileInput = document.getElementById("image-file");
const processButton = document.getElementById("process-button");
const downloadButton = document.getElementById("download-button");
const showGridInput = document.getElementById("show-grid");
const statusElement = document.getElementById("status");
const sourceCanvas = document.getElementById("source-canvas");
const resultCanvas = document.getElementById("result-canvas");
const gridCanvas = document.getElementById("grid-canvas");
const globalPaletteElement = document.getElementById("global-palette");
const blockPaletteElement = document.getElementById("block-palette");
const blockLabel = document.getElementById("block-label");
const paletteSummary = document.getElementById("palette-summary");
const processingTime = document.getElementById("processing-time");
const metricSize = document.getElementById("metric-size");
const metricBlocks = document.getElementById("metric-blocks");
const metricPayload = document.getElementById("metric-payload");
const metricBpp = document.getElementById("metric-bpp");
const metricRatio = document.getElementById("metric-ratio");
const metricError = document.getElementById("metric-error");
const storageGlobal = document.getElementById("storage-global");
const storageGlobalFormula = document.getElementById("storage-global-formula");
const storageBlocks = document.getElementById("storage-blocks");
const storageBlocksFormula = document.getElementById("storage-blocks-formula");
const storagePixels = document.getElementById("storage-pixels");
const storagePixelsFormula = document.getElementById("storage-pixels-formula");
const storageTotal = document.getElementById("storage-total");
const integerFormatter = new Intl.NumberFormat("ru-RU");
const state = {
  sourceImageData: null,
  sourceName: "image",
  uploadedUrl: null,
  worker: null,
  processingId: 0,
  result: null,
  selectedBlock: 0,
};

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  processImage();
});

imageSelect.addEventListener("change", () => {
  releaseUploadedImage();
  loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);
});

for (const select of [blockSizeSelect, localColorCountSelect, globalColorCountSelect, colorSpaceSelect]) {
  select.addEventListener("change", processImage);
}

uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];

  if (!file) {
    return;
  }

  releaseUploadedImage();
  state.uploadedUrl = URL.createObjectURL(file);
  const option = new Option(`Загружено: ${file.name}`, state.uploadedUrl, true, true);

  option.dataset.uploaded = "true";
  imageSelect.append(option);
  loadImage(state.uploadedUrl, file.name).catch(showError);
});

downloadButton.addEventListener("click", downloadResult);
showGridInput.addEventListener("change", drawGrid);
resultCanvas.addEventListener("click", selectBlockFromPointer);
window.addEventListener("beforeunload", () => {
  stopWorker();
  releaseUploadedImage();
});

loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);

async function loadImage(url, name) {
  stopWorker();
  resetResult();
  setBusy(true);
  setStatus("Загрузка исходного изображения…", "busy");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить изображение: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;

    const context = sourceCanvas.getContext("2d", { willReadFrequently: true });

    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    state.sourceImageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    state.sourceName = stripExtension(name || "image");
    metricSize.textContent = `${formatInteger(bitmap.width)} × ${formatInteger(bitmap.height)}`;
    updateCanvasDisplaySize(bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }

  processImage();
}

function processImage() {
  if (!state.sourceImageData) {
    return;
  }

  stopWorker();
  resetResultMetrics();
  setBusy(true);

  const settings = getSettings();
  const sourceCopy = new Uint8ClampedArray(state.sourceImageData.data);
  const processingId = ++state.processingId;
  const worker = new Worker("./src/palette/block-palette-worker.js?v=block-palette-1");

  state.worker = worker;
  setStatus(
    `Общая палитра ${settings.globalColorCount} · блок ${settings.blockSize}×${settings.blockSize} · ${settings.localColorCount} цвета на блок…`,
    "busy"
  );

  worker.addEventListener("message", (event) => {
    if (worker !== state.worker || processingId !== state.processingId) {
      return;
    }

    if (event.data.error) {
      showError(new Error(event.data.error));
      stopWorker();
      return;
    }

    renderResult(event.data);
    stopWorker();
    setBusy(false);
    setStatus(
      `Готово: ${formatInteger(event.data.blockCount)} блоков, ${event.data.localIndexBits} бит/пиксель внутри блока, ${formatBytes(event.data.storage.totalBytes)} всего.`
    );
  });

  worker.addEventListener("error", (event) => {
    if (worker === state.worker) {
      showError(new Error(event.message || "Ошибка фоновой обработки"));
      stopWorker();
    }
  });

  worker.postMessage({
    pixels: sourceCopy.buffer,
    width: state.sourceImageData.width,
    height: state.sourceImageData.height,
    settings,
  }, [sourceCopy.buffer]);
}

function renderResult(result) {
  state.result = result;
  state.selectedBlock = 0;
  resultCanvas.width = result.width;
  resultCanvas.height = result.height;
  resultCanvas.getContext("2d").putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
  gridCanvas.width = result.width;
  gridCanvas.height = result.height;

  metricBlocks.textContent = `${formatInteger(result.blocksX)} × ${formatInteger(result.blocksY)}`;
  metricPayload.textContent = formatBytes(result.storage.totalBytes);
  metricBpp.textContent = result.storage.bitsPerPixel.toFixed(2);
  metricRatio.textContent = `${result.storage.compressionRatio.toFixed(2)}×`;
  metricError.textContent = Math.sqrt(result.meanSquaredError).toFixed(2);
  processingTime.textContent = `${result.durationMs.toFixed(1)} мс · ${getColorSpaceLabel(result.colorSpace)}`;

  storageGlobal.textContent = formatBytes(result.storage.globalPaletteBytes);
  storageGlobalFormula.textContent = `${result.globalColorCount} × 3 байта RGB`;
  storageBlocks.textContent = formatBytes(result.storage.blockPaletteBytes);
  storageBlocksFormula.textContent = `${formatInteger(result.blockCount)} × ${result.localColorCount} × ${result.globalIndexBits} бит`;
  storagePixels.textContent = formatBytes(result.storage.pixelDataBytes);
  storagePixelsFormula.textContent = `${formatInteger(result.width * result.height)} × ${result.localIndexBits} бит`;
  storageTotal.textContent = formatBytes(result.storage.totalBytes);
  paletteSummary.textContent = `${result.activeGlobalColorCount} активных · ${result.resultColorCount} использовано`;

  globalPaletteElement.replaceChildren(...result.palette.map(createGlobalSwatch));
  renderSelectedBlock();
  drawGrid();
  downloadButton.disabled = false;

  window.__blockPaletteResult = {
    width: result.width,
    height: result.height,
    blockSize: result.blockSize,
    blocksX: result.blocksX,
    blocksY: result.blocksY,
    blockCount: result.blockCount,
    localColorCount: result.localColorCount,
    globalColorCount: result.globalColorCount,
    storage: result.storage,
    rmse: Math.sqrt(result.meanSquaredError),
    durationMs: result.durationMs,
  };
}

function createGlobalSwatch(color, index) {
  const item = document.createElement("div");
  const sample = document.createElement("span");
  const label = document.createElement("small");

  item.className = `global-swatch${color.count === 0 ? " is-unused" : ""}`;
  item.title = `Индекс ${index}: ${color.hex} · ${formatInteger(color.count)} px`;
  sample.className = "swatch-color";
  sample.style.backgroundColor = color.hex;
  sample.textContent = formatPaletteIndex(index, state.result.globalIndexBits);
  label.textContent = color.hex;
  item.append(sample, label);

  return item;
}

function renderSelectedBlock() {
  const result = state.result;

  if (!result) {
    return;
  }

  const blockX = state.selectedBlock % result.blocksX;
  const blockY = Math.floor(state.selectedBlock / result.blocksX);
  const offset = state.selectedBlock * result.localColorCount;
  const entries = [];

  for (let localIndex = 0; localIndex < result.localColorCount; localIndex += 1) {
    const globalIndex = result.blockPaletteIndices[offset + localIndex];
    const color = result.palette[globalIndex];
    const item = document.createElement("div");
    const sample = document.createElement("span");
    const data = document.createElement("span");
    const hex = document.createElement("strong");
    const mapping = document.createElement("span");

    item.className = "block-swatch";
    sample.className = "swatch-color";
    sample.style.backgroundColor = color.hex;
    sample.textContent = String(localIndex);
    data.className = "swatch-data";
    hex.textContent = color.hex;
    mapping.textContent = `локальный ${localIndex} → общий ${globalIndex}`;
    data.append(hex, mapping);
    item.append(sample, data);
    entries.push(item);
  }

  blockLabel.textContent = `Блок (${blockX}, ${blockY}) · пиксели ${blockX * result.blockSize}…${Math.min(result.width, (blockX + 1) * result.blockSize) - 1} × ${blockY * result.blockSize}…${Math.min(result.height, (blockY + 1) * result.blockSize) - 1}`;
  blockPaletteElement.replaceChildren(...entries);
}

function selectBlockFromPointer(event) {
  if (!state.result) {
    return;
  }

  const bounds = resultCanvas.getBoundingClientRect();
  const pixelX = Math.min(state.result.width - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * state.result.width)));
  const pixelY = Math.min(state.result.height - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * state.result.height)));
  const blockX = Math.floor(pixelX / state.result.blockSize);
  const blockY = Math.floor(pixelY / state.result.blockSize);

  state.selectedBlock = blockY * state.result.blocksX + blockX;
  renderSelectedBlock();
  drawGrid();
}

function drawGrid() {
  const result = state.result;
  const context = gridCanvas.getContext("2d");

  context.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

  if (!result || !showGridInput.checked) {
    return;
  }

  const lineWidth = Math.max(1, Math.min(result.width, result.height) / 420);

  context.beginPath();
  context.strokeStyle = "rgba(230, 241, 255, 0.42)";
  context.lineWidth = lineWidth;

  for (let x = result.blockSize; x < result.width; x += result.blockSize) {
    context.moveTo(x, 0);
    context.lineTo(x, result.height);
  }

  for (let y = result.blockSize; y < result.height; y += result.blockSize) {
    context.moveTo(0, y);
    context.lineTo(result.width, y);
  }

  context.stroke();

  const blockX = state.selectedBlock % result.blocksX;
  const blockY = Math.floor(state.selectedBlock / result.blocksX);
  const x = blockX * result.blockSize;
  const y = blockY * result.blockSize;

  context.strokeStyle = "#69b5ff";
  context.lineWidth = lineWidth * 2.5;
  context.strokeRect(
    x + context.lineWidth / 2,
    y + context.lineWidth / 2,
    Math.min(result.blockSize, result.width - x) - context.lineWidth,
    Math.min(result.blockSize, result.height - y) - context.lineWidth
  );
}

function getSettings() {
  return {
    blockSize: Number(blockSizeSelect.value),
    localColorCount: Number(localColorCountSelect.value),
    globalColorCount: Number(globalColorCountSelect.value),
    colorSpace: colorSpaceSelect.value,
  };
}

function updateCanvasDisplaySize(width, height) {
  const longestSide = Math.max(width, height);
  const scale = longestSide < 512 ? Math.min(8, Math.floor(512 / longestSide)) : 1;
  const displayWidth = `${width * scale}px`;
  const displayHeight = `${height * scale}px`;

  for (const canvas of [sourceCanvas, resultCanvas, gridCanvas]) {
    canvas.style.width = displayWidth;
    canvas.style.height = displayHeight;
  }
}

function downloadResult() {
  if (!state.result || downloadButton.disabled) {
    return;
  }

  resultCanvas.toBlob((blob) => {
    if (!blob) {
      showError(new Error("Браузер не смог создать PNG"));
      return;
    }

    const settings = getSettings();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${state.sourceName}-blocks-${settings.blockSize}-local-${settings.localColorCount}-global-${settings.globalColorCount}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function stopWorker() {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
}

function releaseUploadedImage() {
  const uploadedOption = imageSelect.querySelector("option[data-uploaded='true']");

  if (uploadedOption) {
    uploadedOption.remove();
  }

  if (state.uploadedUrl) {
    URL.revokeObjectURL(state.uploadedUrl);
    state.uploadedUrl = null;
  }

  fileInput.value = "";
}

function resetResult() {
  state.sourceImageData = null;
  metricSize.textContent = "—";
  resetResultMetrics();
}

function resetResultMetrics() {
  state.result = null;
  resultCanvas.width = 0;
  resultCanvas.height = 0;
  gridCanvas.width = 0;
  gridCanvas.height = 0;

  for (const element of [metricBlocks, metricPayload, metricBpp, metricRatio, metricError, storageGlobal, storageBlocks, storagePixels, storageTotal]) {
    element.textContent = "—";
  }

  storageGlobalFormula.textContent = "—";
  storageBlocksFormula.textContent = "—";
  storagePixelsFormula.textContent = "—";
  processingTime.textContent = "";
  blockLabel.textContent = "—";
  paletteSummary.textContent = "—";
  blockPaletteElement.replaceChildren();
  globalPaletteElement.replaceChildren();
  downloadButton.disabled = true;
  delete window.__blockPaletteResult;
}

function showError(error) {
  console.error("Block palette conversion failed.", error);
  setBusy(false);
  setStatus(error && error.message ? error.message : String(error), "error");
}

function setBusy(busy) {
  processButton.disabled = busy;
  imageSelect.disabled = busy;
  uploadButton.disabled = busy;
  blockSizeSelect.disabled = busy;
  localColorCountSelect.disabled = busy;
  globalColorCountSelect.disabled = busy;
  colorSpaceSelect.disabled = busy;
}

function setStatus(message, kind) {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-busy", kind === "busy");
  statusElement.classList.toggle("is-error", kind === "error");
}

function formatInteger(value) {
  return integerFormatter.format(value);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${formatInteger(bytes)} Б`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} КиБ`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} МиБ`;
}

function formatPaletteIndex(index, bits) {
  return bits === 8 ? index.toString(16).padStart(2, "0").toUpperCase() : String(index);
}

function getColorSpaceLabel(value) {
  return value === "rgb" ? "RGB" : "OKLab";
}

function optionLabel(option) {
  return option ? option.textContent.trim() : "image";
}

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, "") || "image";
}
