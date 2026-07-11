"use strict";

const controls = document.getElementById("controls");
const imageSelect = document.getElementById("image-url");
const blockSizeSelect = document.getElementById("block-size");
const localColorCountSelect = document.getElementById("local-color-count");
const globalColorCountSelect = document.getElementById("global-color-count");
const paletteColorBitsSelect = document.getElementById("palette-color-bits");
const paletteModeSelect = document.getElementById("palette-mode");
const vectorDeviationSelect = document.getElementById("vector-deviation");
const colorSpaceSelect = document.getElementById("color-space");
const algorithmSelect = document.getElementById("algorithm");
const diversityInput = document.getElementById("diversity");
const diversityValue = document.getElementById("diversity-value");
const ditheringSelect = document.getElementById("dithering");
const uploadButton = document.getElementById("upload-button");
const fileInput = document.getElementById("image-file");
const processButton = document.getElementById("process-button");
const optimizeButton = document.getElementById("optimize-button");
const downloadFileButton = document.getElementById("download-file-button");
const downloadButton = document.getElementById("download-button");
const showGridInput = document.getElementById("show-grid");
const statusElement = document.getElementById("status");
const sourceViewport = document.getElementById("source-viewport");
const resultViewport = document.getElementById("result-viewport");
const sourceStage = document.getElementById("source-stage");
const resultStage = document.getElementById("result-stage");
const sourceCanvas = document.getElementById("source-canvas");
const resultCanvas = document.getElementById("result-canvas");
const gridCanvas = document.getElementById("grid-canvas");
const zoomLevel = document.getElementById("zoom-level");
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
const storageHeader = document.getElementById("storage-header");
const storageHeaderFormula = document.getElementById("storage-header-formula");
const storageGlobal = document.getElementById("storage-global");
const storageGlobalFormula = document.getElementById("storage-global-formula");
const storageBlocks = document.getElementById("storage-blocks");
const storageBlocksFormula = document.getElementById("storage-blocks-formula");
const storagePixels = document.getElementById("storage-pixels");
const storagePixelsFormula = document.getElementById("storage-pixels-formula");
const storageTotal = document.getElementById("storage-total");
const storageTotalFormula = document.getElementById("storage-total-formula");
const integerFormatter = new Intl.NumberFormat("ru-RU");
const state = {
  sourceImageData: null,
  sourceName: "image",
  uploadedUrl: null,
  worker: null,
  optimizerWorker: null,
  processingId: 0,
  debounceTimer: 0,
  result: null,
  selectedBlock: 0,
  imageWidth: 0,
  imageHeight: 0,
  displayBaseScale: 1,
  zoom: 1,
  synchronizingScroll: false,
  optimizationApplied: false,
};

const MIN_ZOOM = 0.125;
const MAX_ZOOM = 16;

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  state.optimizationApplied = false;
  processImage();
});

imageSelect.addEventListener("change", () => {
  state.optimizationApplied = false;
  releaseUploadedImage();
  loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);
});

for (const select of [
  blockSizeSelect,
  localColorCountSelect,
  globalColorCountSelect,
  paletteColorBitsSelect,
  paletteModeSelect,
  vectorDeviationSelect,
  colorSpaceSelect,
  algorithmSelect,
  ditheringSelect,
]) {
  select.addEventListener("change", () => {
    state.optimizationApplied = false;
    updatePaletteModeControls();
    processImage();
  });
}

diversityInput.addEventListener("input", () => {
  state.optimizationApplied = false;
  updateDiversityLabel();
  window.clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(processImage, 180);
});

uploadButton.addEventListener("click", () => fileInput.click());
optimizeButton.addEventListener("click", optimizeSettings);
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];

  if (!file) {
    return;
  }

  releaseUploadedImage();
  state.optimizationApplied = false;
  state.uploadedUrl = URL.createObjectURL(file);
  const option = new Option(`Загружено: ${file.name}`, state.uploadedUrl, true, true);

  option.dataset.uploaded = "true";
  imageSelect.append(option);
  loadImage(state.uploadedUrl, file.name).catch(showError);
});

downloadFileButton.addEventListener("click", downloadBlockPaletteFile);
downloadButton.addEventListener("click", downloadResult);
showGridInput.addEventListener("change", drawGrid);
resultCanvas.addEventListener("click", selectBlockFromPointer);
sourceViewport.addEventListener("scroll", () => synchronizeScroll(sourceViewport, resultViewport), { passive: true });
resultViewport.addEventListener("scroll", () => synchronizeScroll(resultViewport, sourceViewport), { passive: true });
sourceViewport.addEventListener("wheel", zoomFromWheel, { passive: false });
resultViewport.addEventListener("wheel", zoomFromWheel, { passive: false });
window.addEventListener("beforeunload", () => {
  stopWorker();
  stopOptimizer();
  releaseUploadedImage();
});

updateDiversityLabel();
updatePaletteModeControls();
loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);

async function loadImage(url, name) {
  stopWorker();
  stopOptimizer();
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
  window.clearTimeout(state.debounceTimer);

  if (!state.sourceImageData) {
    return;
  }

  stopWorker();
  resetResultMetrics();
  setBusy(true);

  const settings = getSettings();
  const sourceCopy = new Uint8ClampedArray(state.sourceImageData.data);
  const processingId = ++state.processingId;
  const workerUrl = settings.algorithm === "webgl"
    ? "./src/palette/block-palette-webgl-worker.js?v=block-palette-3"
    : "./src/palette/block-palette-worker.js?v=block-palette-9";
  const worker = new Worker(workerUrl);

  state.worker = worker;
  setStatus(
    `${getAlgorithmLabel(settings.algorithm)} · общая палитра ${settings.globalColorCount} · ${getPaletteStorageLabel(settings)} · ${getPaletteFormatLabel(settings.paletteColorBits)} · ${getDiversityLabel()} · блок ${settings.blockSize}×${settings.blockSize} · ${settings.localColorCount} цвета на блок · ${getDitheringLabel(settings.dithering)}…`,
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

    const fileLayout = renderResult(event.data);
    stopWorker();
    setBusy(false);
    setStatus(
      `Готово: ${formatInteger(event.data.blockCount)} блоков, ${event.data.localIndexBits} бит/пиксель внутри блока, файл BPAL ${formatBytes(fileLayout.totalBytes)} · ${getPaletteStorageLabel(event.data)} · ${getAlgorithmLabel(event.data.algorithm)} · ${getDiversityLabel()} · ${getDitheringLabel(event.data.dithering)}${state.optimizationApplied ? " · подобрано автоматически" : ""}.`
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
  const fileLayout = window.BlockPaletteFormat.getBlockPaletteFileLayout(result);

  resultCanvas.width = result.width;
  resultCanvas.height = result.height;
  resultCanvas.getContext("2d").putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
  gridCanvas.width = result.width;
  gridCanvas.height = result.height;

  metricBlocks.textContent = `${formatInteger(result.blocksX)} × ${formatInteger(result.blocksY)}`;
  metricPayload.textContent = formatBytes(fileLayout.payloadBytes);
  metricBpp.textContent = result.storage.bitsPerPixel.toFixed(2);
  metricRatio.textContent = `${result.storage.compressionRatio.toFixed(2)}×`;
  metricError.textContent = Math.sqrt(result.meanSquaredError).toFixed(2);
  processingTime.textContent = `${result.durationMs.toFixed(1)} мс · ${getColorSpaceLabel(result.colorSpace)} · ${getAlgorithmLabel(result.algorithm)}`;

  storageHeader.textContent = formatBytes(fileLayout.headerBytes);
  storageHeaderFormula.textContent = `${window.BlockPaletteFormat.MAGIC} · v${window.BlockPaletteFormat.VERSION} · ${fileLayout.bitFieldHeaderBits} бит полей`;
  storageGlobal.textContent = formatBitSize(result.storage.globalPaletteBits);
  storageGlobalFormula.textContent = result.paletteMode === "vector"
    ? `${formatVectorCount(result.paletteVectorCount)} × 2 конца × ${result.paletteColorBits / 8} байта · восстановлено ${result.globalColorCount} цветов`
    : `${result.globalColorCount} × ${result.paletteColorBits / 8} байта · ${getPaletteFormatLabel(result.paletteColorBits)}`;
  storageBlocks.textContent = formatBitSize(result.storage.blockPaletteBits);
  storageBlocksFormula.textContent = `${formatInteger(result.blockCount)} × ${result.localColorCount} × ${result.globalIndexBits} бит`;
  storagePixels.textContent = formatBitSize(result.storage.pixelDataBits);
  storagePixelsFormula.textContent = `${formatInteger(result.width * result.height)} × ${result.localIndexBits} бит`;
  storageTotal.textContent = formatBytes(fileLayout.totalBytes);
  storageTotalFormula.textContent = `${formatBitSize(fileLayout.payloadBits)} данных · ${fileLayout.paddingBits === 0 ? "без padding" : `${fileLayout.paddingBits} бит padding`}`;
  paletteSummary.textContent = result.paletteMode === "vector"
    ? `${formatVectorCount(result.paletteVectorCount)} · девиация до ${(result.vectorDeviationActual * 100).toFixed(1)}% · ${result.resultColorCount} использовано`
    : `${result.activeGlobalColorCount} активных · ${result.resultColorCount} использовано · ${getPaletteFormatLabel(result.paletteColorBits)}`;

  globalPaletteElement.replaceChildren(...result.palette.map(createGlobalSwatch));
  renderSelectedBlock();
  drawGrid();
  downloadFileButton.disabled = false;
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
    paletteColorBits: result.paletteColorBits,
    paletteMode: result.paletteMode,
    vectorDeviation: result.vectorDeviation,
    vectorDeviationActual: result.vectorDeviationActual,
    paletteVectorCount: result.paletteVectorCount,
    algorithm: result.algorithm,
    acceleratedStages: result.acceleratedStages,
    fallbackReason: result.fallbackReason || null,
    dithering: result.dithering,
    diversity: result.diversity,
    storage: result.storage,
    rmse: Math.sqrt(result.meanSquaredError),
    durationMs: result.durationMs,
    file: fileLayout,
  };

  return fileLayout;
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
    paletteColorBits: Number(paletteColorBitsSelect.value),
    paletteMode: paletteModeSelect.value,
    vectorDeviation: Number(vectorDeviationSelect.value),
    colorSpace: colorSpaceSelect.value,
    algorithm: algorithmSelect.value,
    dithering: ditheringSelect.value,
    diversity: getDiversity(),
  };
}

function updateCanvasDisplaySize(width, height) {
  const longestSide = Math.max(width, height);
  const preferredScale = longestSide < 512 ? Math.min(8, Math.floor(512 / longestSide)) : 1;
  const viewportWidth = Math.min(sourceViewport.clientWidth, resultViewport.clientWidth);
  const availableWidth = Math.max(1, viewportWidth - 28);

  state.imageWidth = width;
  state.imageHeight = height;
  state.displayBaseScale = Math.min(preferredScale, availableWidth / width);
  state.zoom = 1;
  applyCanvasDisplaySize();
  sourceViewport.scrollTo(0, 0);
  resultViewport.scrollTo(0, 0);
}

function applyCanvasDisplaySize() {
  const displayScale = state.displayBaseScale * state.zoom;
  const displayWidth = `${state.imageWidth * displayScale}px`;
  const displayHeight = `${state.imageHeight * displayScale}px`;

  for (const stage of [sourceStage, resultStage]) {
    stage.style.width = displayWidth;
    stage.style.height = displayHeight;
  }

  zoomLevel.value = `${Math.round(state.zoom * 100)}%`;
}

function synchronizeScroll(source, target) {
  if (state.synchronizingScroll) {
    return;
  }

  state.synchronizingScroll = true;
  const sourceRangeX = Math.max(0, source.scrollWidth - source.clientWidth);
  const sourceRangeY = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetRangeX = Math.max(0, target.scrollWidth - target.clientWidth);
  const targetRangeY = Math.max(0, target.scrollHeight - target.clientHeight);

  target.scrollLeft = sourceRangeX > 0 ? source.scrollLeft / sourceRangeX * targetRangeX : 0;
  target.scrollTop = sourceRangeY > 0 ? source.scrollTop / sourceRangeY * targetRangeY : 0;
  window.requestAnimationFrame(() => {
    state.synchronizingScroll = false;
  });
}

function zoomFromWheel(event) {
  if (!event.ctrlKey || !state.imageWidth || !state.imageHeight) {
    return;
  }

  event.preventDefault();
  const viewport = event.currentTarget;
  const otherViewport = viewport === sourceViewport ? resultViewport : sourceViewport;
  const bounds = viewport.getBoundingClientRect();
  const pointerX = event.clientX - bounds.left;
  const pointerY = event.clientY - bounds.top;
  const anchorX = (viewport.scrollLeft + pointerX) / Math.max(1, viewport.scrollWidth);
  const anchorY = (viewport.scrollTop + pointerY) / Math.max(1, viewport.scrollHeight);
  const pixelDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * viewport.clientHeight
      : event.deltaY;
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * Math.exp(-pixelDelta * 0.002)));

  if (Math.abs(nextZoom - state.zoom) < 0.0001) {
    return;
  }

  state.zoom = nextZoom;
  applyCanvasDisplaySize();
  viewport.scrollLeft = anchorX * viewport.scrollWidth - pointerX;
  viewport.scrollTop = anchorY * viewport.scrollHeight - pointerY;
  state.synchronizingScroll = false;
  synchronizeScroll(viewport, otherViewport);
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
    const ditherSuffix = settings.dithering === "none" ? "" : `-${settings.dithering}`;

    downloadBlob(
      blob,
      `${state.sourceName}-blocks-${settings.blockSize}-local-${settings.localColorCount}-global-${settings.globalColorCount}-${settings.paletteColorBits}bit${ditherSuffix}.png`
    );
  }, "image/png");
}

function downloadBlockPaletteFile() {
  if (!state.result || downloadFileButton.disabled) {
    return;
  }

  try {
    const settings = getSettings();
    const bytes = window.BlockPaletteFormat.encodeBlockPaletteFile(state.result);
    const blob = new Blob([bytes], { type: "application/vnd.block-palette" });

    downloadBlob(
      blob,
      `${state.sourceName}-blocks-${settings.blockSize}-local-${settings.localColorCount}-global-${settings.globalColorCount}-${settings.paletteColorBits}bit${settings.paletteMode === "vector" ? `-vectors-${Math.round(settings.vectorDeviation * 100)}pct` : ""}.bpal`
    );
  } catch (error) {
    showError(error);
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function optimizeSettings() {
  if (!state.sourceImageData || state.optimizerWorker) {
    return;
  }

  stopWorker();
  stopOptimizer();
  setBusy(true);
  optimizeButton.textContent = "Подбор 0/20";
  setStatus("Подготавливаю уменьшенную копию для поиска настроек…", "busy");

  const preview = createOptimizationPreview();
  const worker = new Worker("./src/palette/block-palette-optimizer-worker.js?v=block-palette-2");

  state.optimizerWorker = worker;

  worker.addEventListener("message", (event) => {
    if (worker !== state.optimizerWorker) {
      return;
    }

    if (event.data.type === "progress") {
      const { completed, total, candidate } = event.data;

      optimizeButton.textContent = `Подбор ${completed}/${total}`;
      setStatus(
        `Ищу настройки: ${completed}/${total} · пробный BPAL ${formatBytes(candidate.fileBytes)} · RMSE ${candidate.rmse.toFixed(2)}…`,
        "busy"
      );
      return;
    }

    if (event.data.type === "error") {
      stopOptimizer();
      showError(new Error(event.data.error));
      return;
    }

    if (event.data.type === "result") {
      const { settings, selected, frontier } = event.data.result;

      blockSizeSelect.value = String(settings.blockSize);
      localColorCountSelect.value = String(settings.localColorCount);
      globalColorCountSelect.value = String(settings.globalColorCount);
      paletteColorBitsSelect.value = String(settings.paletteColorBits);
      state.optimizationApplied = true;
      stopOptimizer();
      setBusy(false);
      setStatus(
        `Найден баланс среди ${frontier.length} вариантов Парето: пробный BPAL ${formatBytes(selected.fileBytes)}, RMSE ${selected.rmse.toFixed(2)}. Выполняю полное сжатие…`,
        "busy"
      );
      processImage();
    }
  });

  worker.addEventListener("error", (event) => {
    if (worker === state.optimizerWorker) {
      stopOptimizer();
      showError(new Error(event.message || "Ошибка подбора настроек"));
    }
  });

  worker.postMessage({
    pixels: preview.data.buffer,
    width: preview.width,
    height: preview.height,
    options: {
      colorSpace: colorSpaceSelect.value,
      dithering: ditheringSelect.value,
      diversity: getDiversity(),
      paletteMode: paletteModeSelect.value,
      vectorDeviation: Number(vectorDeviationSelect.value),
    },
  }, [preview.data.buffer]);
}

function createOptimizationPreview() {
  const maximumSide = 96;
  const sourceWidth = state.sourceImageData.width;
  const sourceHeight = state.sourceImageData.height;
  const scale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (width === sourceWidth && height === sourceHeight) {
    return new ImageData(new Uint8ClampedArray(state.sourceImageData.data), width, height);
  }

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, width, height);

  return context.getImageData(0, 0, width, height);
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

  for (const element of [metricBlocks, metricPayload, metricBpp, metricRatio, metricError, storageHeader, storageGlobal, storageBlocks, storagePixels, storageTotal]) {
    element.textContent = "—";
  }

  storageHeaderFormula.textContent = "—";
  storageGlobalFormula.textContent = "—";
  storageBlocksFormula.textContent = "—";
  storagePixelsFormula.textContent = "—";
  storageTotalFormula.textContent = "—";
  processingTime.textContent = "";
  blockLabel.textContent = "—";
  paletteSummary.textContent = "—";
  blockPaletteElement.replaceChildren();
  globalPaletteElement.replaceChildren();
  downloadFileButton.disabled = true;
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
  optimizeButton.disabled = busy;
  imageSelect.disabled = busy;
  uploadButton.disabled = busy;
  blockSizeSelect.disabled = busy;
  localColorCountSelect.disabled = busy;
  globalColorCountSelect.disabled = busy;
  paletteColorBitsSelect.disabled = busy;
  paletteModeSelect.disabled = busy;
  vectorDeviationSelect.disabled = busy || paletteModeSelect.value !== "vector";
  colorSpaceSelect.disabled = busy;
  algorithmSelect.disabled = busy;
  diversityInput.disabled = busy;
  ditheringSelect.disabled = busy;
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

function updatePaletteModeControls() {
  vectorDeviationSelect.disabled = paletteModeSelect.disabled || paletteModeSelect.value !== "vector";
}

function formatBitSize(bits) {
  return bits % 8 === 0 ? formatBytes(bits / 8) : `${formatInteger(bits)} бит`;
}

function formatPaletteIndex(index, bits) {
  return bits >= 8
    ? index.toString(16).padStart(Math.ceil(bits / 4), "0").toUpperCase()
    : String(index);
}

function getColorSpaceLabel(value) {
  return value === "rgb" ? "RGB" : "OKLab";
}

function getAlgorithmLabel(value) {
  if (value === "webgl") {
    return "WebGL2";
  }

  if (value === "webgl-hybrid") {
    return "WebGL2 + CPU Floyd";
  }

  if (value === "cpu-fallback") {
    return "WebGL2 → CPU";
  }

  return "CPU";
}

function getPaletteFormatLabel(bits) {
  return Number(bits) === 16 ? "RGB565" : "RGB888";
}

function getPaletteStorageLabel(settings) {
  if (settings.paletteMode !== "vector") {
    return "явная палитра";
  }

  if (settings.paletteVectorCount) {
    return formatVectorCount(settings.paletteVectorCount);
  }

  return `RGB-векторы · девиация ${Math.round(Number(settings.vectorDeviation) * 100)}%`;
}

function formatVectorCount(count) {
  const absolute = Math.abs(Number(count));
  const modulo100 = absolute % 100;
  const modulo10 = absolute % 10;
  let suffix = "ов";

  if (modulo100 < 11 || modulo100 > 14) {
    suffix = modulo10 === 1 ? "" : modulo10 >= 2 && modulo10 <= 4 ? "а" : "ов";
  }

  return `${formatInteger(count)} RGB-вектор${suffix}`;
}

function getDitheringLabel(mode) {
  switch (mode) {
    case "pattern-2x2":
      return "Bayer 2×2";
    case "pattern":
      return "Bayer 4×4";
    case "floyd-steinberg":
      return "Floyd–Steinberg";
    default:
      return "без дизеринга";
  }
}

function stopOptimizer() {
  if (state.optimizerWorker) {
    state.optimizerWorker.terminate();
    state.optimizerWorker = null;
  }

  optimizeButton.textContent = "Подобрать настройки";
}

function getDiversityLevel() {
  return Math.max(0, Math.min(6, Math.round(Number(diversityInput.value) || 0)));
}

function getDiversity() {
  return getDiversityLevel() / 6;
}

function updateDiversityLabel() {
  diversityValue.textContent = getDiversityLabel();
}

function getDiversityLabel() {
  return [
    "Макс. точность",
    "Точность 5/6",
    "Точность 4/6",
    "Баланс",
    "Разнообразие 4/6",
    "Разнообразие 5/6",
    "Макс. разнообразие",
  ][getDiversityLevel()];
}

function optionLabel(option) {
  return option ? option.textContent.trim() : "image";
}

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, "") || "image";
}
