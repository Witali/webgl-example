"use strict";

const controls = document.getElementById("controls");
const imageSelect = document.getElementById("image-url");
const modeSelect = document.getElementById("retro-mode");
const fitSelect = document.getElementById("image-fit");
const rotationSelect = document.getElementById("image-rotation");
const colorSpaceSelect = document.getElementById("color-space");
const ditheringSelect = document.getElementById("dithering");
const autoOptimizeLabel = document.getElementById("auto-optimize-label");
const autoOptimizeInput = document.getElementById("auto-optimize");
const colorCountInput = document.getElementById("color-count");
const colorCountValue = document.getElementById("color-count-value");
const colorCountNumberInput = document.getElementById("color-count-number");
const uploadButton = document.getElementById("upload-button");
const fileInput = document.getElementById("image-file");
const processButton = document.getElementById("process-button");
const downloadDataButton = document.getElementById("download-data-button");
const downloadPaletteButton = document.getElementById("download-palette-button");
const downloadPngButton = document.getElementById("download-png-button");
const sourceCanvas = document.getElementById("source-canvas");
const resultCanvas = document.getElementById("result-canvas");
const resultCaption = document.getElementById("result-caption");
const statusElement = document.getElementById("status");
const metricProfile = document.getElementById("metric-profile");
const metricSize = document.getElementById("metric-size");
const metricColors = document.getElementById("metric-colors");
const metricBytes = document.getElementById("metric-bytes");
const metricTime = document.getElementById("metric-time");
const formatNoteTitle = document.getElementById("format-note-title");
const formatNoteText = document.getElementById("format-note-text");
const paletteElement = document.getElementById("palette");
const paletteSummary = document.getElementById("palette-summary");
const state = {
  sourceImageData: null,
  sourceName: "image",
  uploadedUrl: null,
  worker: null,
  processingId: 0,
  debounceTimer: 0,
  result: null,
  busy: false,
};

const PROFILES = {
  "zx-spectrum": {
    name: "ZX Spectrum",
    width: 256,
    height: 192,
    extension: "scr",
  },
  "mode-x": {
    name: "PC VGA Mode X",
    width: 320,
    height: 240,
    extension: "modex.bin",
  },
};

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  processImage();
});

imageSelect.addEventListener("change", () => {
  releaseUploadedImage();
  loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);
});

modeSelect.addEventListener("change", () => {
  updateModeUi();
  processImage();
});
fitSelect.addEventListener("change", processImage);
rotationSelect.addEventListener("change", processImage);
colorSpaceSelect.addEventListener("change", processImage);
ditheringSelect.addEventListener("change", processImage);
autoOptimizeInput.addEventListener("change", () => {
  updateModeUi();
  processImage();
});
colorCountInput.addEventListener("input", () => {
  updateColorCountLabel();
  scheduleProcessing();
});
colorCountNumberInput.addEventListener("input", () => {
  const value = colorCountFromNumberInput(false);

  if (value === null) {
    scheduleNumberCommit();
    return;
  }

  colorCountInput.value = String(value);
  colorCountValue.textContent = String(value);
  scheduleProcessing();
});
colorCountNumberInput.addEventListener("change", () => {
  commitNumberInput();
});

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

downloadDataButton.addEventListener("click", downloadHardwareData);
downloadPaletteButton.addEventListener("click", downloadModeXPalette);
downloadPngButton.addEventListener("click", downloadPreviewPng);
window.addEventListener("beforeunload", () => {
  stopWorker();
  releaseUploadedImage();
});

updateModeUi();
loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);

async function loadImage(url, name) {
  stopWorker();
  setBusy(true);
  setStatus("Загрузка исходного изображения…", "busy");
  resetResult();

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить изображение: ${response.status} ${response.statusText}`);
  }

  const bitmap = await createImageBitmap(await response.blob());

  try {
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;

    const context = sourceCanvas.getContext("2d", { willReadFrequently: true });

    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    state.sourceImageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    state.sourceName = stripExtension(name || "image");
    updateSourceDisplaySize(bitmap.width, bitmap.height);
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
  resetResult();
  setBusy(true);

  const processingId = ++state.processingId;
  const mode = modeSelect.value;
  const profile = PROFILES[mode];
  const autoOptimize = mode === "zx-spectrum" && autoOptimizeInput.checked;
  const rotation = getRotation();
  const prepared = prepareTargetImage(
    profile.width,
    profile.height,
    fitSelect.value,
    rotation
  );
  const sourceCopy = new Uint8ClampedArray(prepared.data);
  const worker = new Worker("./src/retro/retro-worker.js?v=mix-average-1");

  state.worker = worker;
  setStatus(autoOptimize
    ? `Автоподбор ${profile.name}: проверка 8 вариантов по родной палитре · ${rotationLabel(rotation)}…`
    : `${profile.name}: ${profile.width}×${profile.height} · ${rotationLabel(rotation)} · ${colorSpaceLabel(colorSpaceSelect.value)} · ${ditheringLabel(ditheringSelect.value)}…`,
  "busy");

  worker.addEventListener("message", (event) => {
    if (worker !== state.worker || processingId !== state.processingId) {
      return;
    }

    if (event.data.progress) {
      const progress = event.data.progress;

      setStatus(
        `Автоподбор ZX Spectrum: ${progress.completed}/${progress.total} · ` +
        `${colorSpaceLabel(progress.candidate.colorSpace)} · ` +
        `${ditheringLabel(progress.candidate.dithering)}…`,
        "busy"
      );
      return;
    }

    if (event.data.error) {
      showError(new Error(event.data.error));
      stopWorker();
      return;
    }

    event.data.rotation = rotation;
    renderResult(event.data);
    stopWorker();
    setBusy(false);
    const colorSummary = event.data.mode === "zx-spectrum"
      ? `${event.data.palette.length} из ${event.data.hardwarePaletteSize} родных цветов`
      : `${event.data.palette.length} цветов`;

    setStatus(
      event.data.optimization
        ? `Готово: ${profile.name} · автоподбор ${optimizationLabel(event.data.optimization.recommended)} · ` +
          `${rotationLabel(rotation)} · ${colorSummary} · ${formatBytes(hardwareByteLength(event.data))}.`
        : `Готово: ${profile.name} · ${colorSpaceLabel(event.data.colorSpace)} · ` +
          `${ditheringLabel(event.data.dithering)} · ${rotationLabel(rotation)} · ${colorSummary} · ` +
          `${formatBytes(hardwareByteLength(event.data))}.`
    );
  });

  worker.addEventListener("error", (event) => {
    if (worker === state.worker) {
      showError(new Error(event.message || "Ошибка фоновой обработки"));
      stopWorker();
    }
  });

  worker.postMessage({
    mode,
    pixels: sourceCopy.buffer,
    width: profile.width,
    height: profile.height,
    options: {
      colorSpace: colorSpaceSelect.value,
      dithering: ditheringSelect.value,
      colorCount: getColorCount(),
      autoOptimize,
    },
  }, [sourceCopy.buffer]);
}

function prepareTargetImage(width, height, fit, rotation) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const swapsDimensions = rotation === 90 || rotation === 270;
  const rotatedWidth = swapsDimensions ? sourceHeight : sourceWidth;
  const rotatedHeight = swapsDimensions ? sourceWidth : sourceHeight;
  let drawWidth;
  let drawHeight;

  if (fit === "stretch") {
    drawWidth = swapsDimensions ? height : width;
    drawHeight = swapsDimensions ? width : height;
  } else {
    const scale = fit === "contain"
      ? Math.min(width / rotatedWidth, height / rotatedHeight)
      : Math.max(width / rotatedWidth, height / rotatedHeight);

    drawWidth = sourceWidth * scale;
    drawHeight = sourceHeight * scale;
  }

  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(sourceCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();

  return context.getImageData(0, 0, width, height);
}

function renderResult(result) {
  const profile = PROFILES[result.mode];
  const optimized = result.optimization && result.optimization.recommended;
  const rotationSuffix = result.rotation ? ` · поворот ${result.rotation}°` : "";

  if (optimized) {
    colorSpaceSelect.value = optimized.colorSpace;
    ditheringSelect.value = optimized.dithering;
  }

  state.result = result;
  resultCanvas.width = result.width;
  resultCanvas.height = result.height;
  resultCanvas.style.width = `${result.width * 2}px`;
  resultCanvas.style.height = `${result.height * 2}px`;
  resultCanvas.getContext("2d").putImageData(
    new ImageData(result.pixels, result.width, result.height),
    0,
    0
  );

  metricProfile.textContent = optimized ? `${profile.name} · авто` : profile.name;
  metricSize.textContent = `${result.width} × ${result.height}`;
  metricColors.textContent = result.mode === "zx-spectrum"
    ? `${formatInteger(result.palette.length)} / ${result.hardwarePaletteSize}`
    : formatInteger(result.palette.length);
  metricBytes.textContent = formatBytes(hardwareByteLength(result));
  metricTime.textContent = `${result.durationMs.toFixed(1)} мс`;
  resultCaption.textContent = optimized
    ? `${profile.name} · ${colorSpaceLabel(optimized.colorSpace)} · ${ditheringLabel(optimized.dithering)}${rotationSuffix}`
    : `${profile.name} · ${colorSpaceLabel(result.colorSpace)} · ${ditheringLabel(result.dithering)}${rotationSuffix}`;
  paletteSummary.textContent = result.mode === "zx-spectrum"
    ? `${result.hardwarePaletteSize} родных цветов · 2 цвета на блок 8×8`
    : `${result.palette.length} из 256 регистров DAC`;
  renderPalette(result.palette, result.width * result.height);

  downloadDataButton.disabled = false;
  downloadDataButton.textContent = result.mode === "zx-spectrum"
    ? "Скачать .scr"
    : "Скачать planar .bin";
  downloadPaletteButton.disabled = result.mode !== "mode-x";
  downloadPngButton.disabled = false;

  window.__retroResult = {
    mode: result.mode,
    width: result.width,
    height: result.height,
    colors: result.palette.length,
    bytes: hardwareByteLength(result),
    paletteBytes: result.palette6Bit ? result.palette6Bit.length : 0,
    colorSpace: result.colorSpace,
    dithering: result.dithering,
    hardwarePaletteSize: result.hardwarePaletteSize || 0,
    paletteSource: result.paletteSource || null,
    rotation: result.rotation || 0,
    optimization: optimized || null,
  };
}

function renderPalette(palette, totalPixels) {
  paletteElement.replaceChildren(...palette.map((color) => {
    const item = document.createElement("div");
    const sample = document.createElement("span");
    const data = document.createElement("span");
    const hex = document.createElement("strong");
    const share = document.createElement("span");
    const percent = totalPixels ? color.count / totalPixels * 100 : 0;

    item.className = "swatch";
    item.title = `RGB(${color.r}, ${color.g}, ${color.b}) — ${percent.toFixed(2)}%`;
    sample.className = "swatch-color";
    sample.style.backgroundColor = color.hex;
    data.className = "swatch-data";
    hex.textContent = color.hex;
    share.textContent = `${percent.toFixed(1)}% · ${formatInteger(color.count)} px`;
    data.append(hex, share);
    item.append(sample, data);

    return item;
  }));
}

function updateModeUi() {
  const isZx = modeSelect.value === "zx-spectrum";
  const autoOptimize = isZx && autoOptimizeInput.checked;

  colorCountInput.disabled = state.busy || isZx;
  colorCountNumberInput.disabled = state.busy || isZx;
  colorCountNumberInput.hidden = isZx;
  colorSpaceSelect.disabled = state.busy || autoOptimize;
  ditheringSelect.disabled = state.busy || autoOptimize;
  autoOptimizeInput.disabled = state.busy || !isZx;
  autoOptimizeLabel.hidden = !isZx;
  colorCountValue.textContent = isZx ? "15 · 2/8×8" : String(getColorCount());
  formatNoteTitle.textContent = isZx ? "ZX Spectrum .scr" : "Mode X raw planar + VGA DAC";
  formatNoteText.textContent = isZx
    ? autoOptimize
      ? "15 родных цветов; пары PAPER/INK выбираются по усреднённому цвету смеси; RGB/OKLab × 4 режима дизеринга."
      : "6144 байта bitmap в аппаратном порядке строк и 768 байт атрибутов 8×8; FLASH выключен."
    : "Четыре плана по 19 200 байт идут последовательно; .pal содержит 256 RGB-троек по 6 бит на канал.";
  downloadPaletteButton.hidden = isZx;
}

function updateColorCountLabel() {
  if (modeSelect.value !== "zx-spectrum") {
    const colorCount = getColorCount();

    colorCountValue.textContent = String(colorCount);
    colorCountNumberInput.value = String(colorCount);
  }
}

function downloadHardwareData() {
  if (!state.result) {
    return;
  }

  if (state.result.mode === "zx-spectrum") {
    downloadBytes(state.result.screen, `${state.sourceName}.scr`);
    return;
  }

  downloadBytes(state.result.planar, `${state.sourceName}.modex.bin`);
}

function downloadModeXPalette() {
  if (state.result && state.result.palette6Bit) {
    downloadBytes(state.result.palette6Bit, `${state.sourceName}.modex.pal`);
  }
}

function downloadPreviewPng() {
  if (!state.result) {
    return;
  }

  resultCanvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, `${state.sourceName}.${state.result.mode}.png`);
    }
  }, "image/png");
}

function downloadBytes(bytes, filename) {
  downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hardwareByteLength(result) {
  return result.screen ? result.screen.byteLength : result.planar.byteLength;
}

function setBusy(busy) {
  state.busy = busy;
  processButton.disabled = busy;
  imageSelect.disabled = busy;
  modeSelect.disabled = busy;
  fitSelect.disabled = busy;
  rotationSelect.disabled = busy;
  colorSpaceSelect.disabled = busy;
  ditheringSelect.disabled = busy;
  uploadButton.disabled = busy;
  updateModeUi();
}

function resetResult() {
  state.result = null;
  resultCanvas.width = 0;
  resultCanvas.height = 0;
  metricProfile.textContent = "—";
  metricSize.textContent = "—";
  metricColors.textContent = "—";
  metricBytes.textContent = "—";
  metricTime.textContent = "—";
  paletteSummary.textContent = "";
  paletteElement.replaceChildren();
  downloadDataButton.disabled = true;
  downloadPaletteButton.disabled = true;
  downloadPngButton.disabled = true;
  delete window.__retroResult;
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

function showError(error) {
  console.error("Retro conversion failed.", error);
  stopWorker();
  setBusy(false);
  setStatus(error && error.message ? error.message : String(error), "error");
}

function setStatus(message, kind) {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-busy", kind === "busy");
  statusElement.classList.toggle("is-error", kind === "error");
}

function updateSourceDisplaySize(width, height) {
  const longestSide = Math.max(width, height);
  const scale = longestSide < 512 ? Math.min(8, Math.floor(512 / longestSide)) : 1;

  sourceCanvas.style.width = `${width * scale}px`;
  sourceCanvas.style.height = `${height * scale}px`;
}

function getColorCount() {
  return Math.max(2, Math.min(256, Math.round(Number(colorCountInput.value) || 256)));
}

function getRotation() {
  const rotation = Number(rotationSelect.value);

  return [0, 90, 180, 270].includes(rotation) ? rotation : 0;
}

function rotationLabel(rotation) {
  return rotation === 0 ? "без поворота" : `поворот ${rotation}°`;
}

function colorCountFromNumberInput(clampToRange) {
  const value = Number(colorCountNumberInput.value);

  if (!Number.isFinite(value) || colorCountNumberInput.value === "") {
    return null;
  }

  if (!clampToRange && (value < 2 || value > 256)) {
    return null;
  }

  return Math.max(2, Math.min(256, Math.round(value)));
}

function scheduleProcessing() {
  window.clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(processImage, 180);
}

function scheduleNumberCommit() {
  window.clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(commitNumberInput, 700);
}

function commitNumberInput() {
  const value = colorCountFromNumberInput(true);

  colorCountInput.value = String(value === null ? getColorCount() : value);
  updateColorCountLabel();
  scheduleProcessing();
}

function colorSpaceLabel(value) {
  return value === "rgb" ? "RGB" : "OKLab";
}

function ditheringLabel(value) {
  if (value === "pattern-2x2") {
    return "Bayer 2×2";
  }

  if (value === "pattern") {
    return "Bayer 4×4";
  }

  if (value === "floyd-steinberg") {
    return "Floyd–Steinberg";
  }

  return "без дизеринга";
}

function optimizationLabel(candidate) {
  return `${colorSpaceLabel(candidate.colorSpace)} · ${ditheringLabel(candidate.dithering)}`;
}

function formatBytes(value) {
  return value >= 1024
    ? `${formatInteger(value)} Б · ${(value / 1024).toFixed(2)} КиБ`
    : `${formatInteger(value)} Б`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function optionLabel(option) {
  return option ? option.textContent.trim() : "image";
}

function stripExtension(name) {
  return String(name).replace(/^Загружено:\s*/, "").replace(/\.[^.]+$/, "") || "image";
}
