"use strict";

const controls = document.getElementById("controls");
const imageSelect = document.getElementById("image-url");
const colorSpaceSelect = document.getElementById("color-space");
const colorCountInput = document.getElementById("color-count");
const colorCountValue = document.getElementById("color-count-value");
const colorCountNumberInput = document.getElementById("color-count-number");
const diversityInput = document.getElementById("diversity");
const diversityValue = document.getElementById("diversity-value");
const ditheringSelect = document.getElementById("dithering");
const uploadButton = document.getElementById("upload-button");
const fileInput = document.getElementById("image-file");
const processButton = document.getElementById("process-button");
const downloadButton = document.getElementById("download-button");
const statusElement = document.getElementById("status");
const sourceCanvas = document.getElementById("source-canvas");
const resultCanvas = document.getElementById("result-canvas");
const paletteElement = document.getElementById("palette");
const iterationCount = document.getElementById("iteration-count");
const metricSize = document.getElementById("metric-size");
const metricSourceColors = document.getElementById("metric-source-colors");
const metricResultColors = document.getElementById("metric-result-colors");
const metricTime = document.getElementById("metric-time");
const metricError = document.getElementById("metric-error");
const state = {
  sourceImageData: null,
  sourceName: "image",
  uploadedUrl: null,
  worker: null,
  processingId: 0,
  debounceTimer: 0,
};

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  processImage();
});

imageSelect.addEventListener("change", () => {
  releaseUploadedImage();
  loadImage(imageSelect.value, optionLabel(imageSelect.selectedOptions[0])).catch(showError);
});

colorSpaceSelect.addEventListener("change", processImage);

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

diversityInput.addEventListener("input", () => {
  updateDiversityLabel();
  window.clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(processImage, 180);
});

ditheringSelect.addEventListener("change", processImage);

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
window.addEventListener("beforeunload", () => {
  stopWorker();
  releaseUploadedImage();
});

updateColorCountLabel();
updateDiversityLabel();
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
    updateCanvasDisplaySize(bitmap.width, bitmap.height);
    metricSize.textContent = `${formatInteger(bitmap.width)} × ${formatInteger(bitmap.height)}`;
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

  const processingId = ++state.processingId;
  const colorCount = getColorCount();
  const dithering = ditheringSelect.value;
  const colorSpace = colorSpaceSelect.value;
  const diversity = getDiversity();
  const sourceCopy = new Uint8ClampedArray(state.sourceImageData.data);
  const worker = new Worker("./src/palette/palette-worker.js?v=bayer2-1");

  state.worker = worker;
  setStatus(
    `Кластеризация в ${getColorSpaceLabel(colorSpace)} · ${colorCount} кластеров · ${getDiversityLabel()} · ${getDitheringLabel(dithering)}…`,
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
      `Готово: ${formatInteger(event.data.uniqueColorCount)} исходных цветов сведены к ${event.data.palette.length} · ${getColorSpaceLabel(event.data.colorSpace)} · ${getDiversityLabel()} · ${getDitheringLabel(event.data.dithering)}.`
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
    colorCount,
    dithering,
    colorSpace,
    diversity,
  }, [sourceCopy.buffer]);
}

function renderResult(result) {
  resultCanvas.width = result.width;
  resultCanvas.height = result.height;
  resultCanvas.getContext("2d").putImageData(
    new ImageData(result.pixels, result.width, result.height),
    0,
    0
  );

  const representedPixels = result.palette.reduce((sum, color) => sum + color.count, 0);

  metricSourceColors.textContent = formatInteger(result.uniqueColorCount);
  metricResultColors.textContent = formatInteger(result.palette.length);
  metricTime.textContent = `${result.durationMs.toFixed(1)} мс`;
  metricError.textContent = Math.sqrt(result.meanSquaredError).toFixed(2);
  iterationCount.textContent = `Итераций: ${result.iterations}`;
  paletteElement.replaceChildren(...result.palette.map((color) => {
    return createSwatch(color, representedPixels);
  }));
  downloadButton.disabled = false;

  window.__paletteResult = {
    width: result.width,
    height: result.height,
    uniqueColorCount: result.uniqueColorCount,
    palette: result.palette,
    iterations: result.iterations,
    durationMs: result.durationMs,
    rmse: Math.sqrt(result.meanSquaredError),
    dithering: result.dithering,
    colorSpace: result.colorSpace,
    diversity: result.diversity,
  };
}

function updateCanvasDisplaySize(width, height) {
  const longestSide = Math.max(width, height);
  const scale = longestSide < 512 ? Math.min(8, Math.floor(512 / longestSide)) : 1;
  const displayWidth = `${width * scale}px`;
  const displayHeight = `${height * scale}px`;

  sourceCanvas.style.width = displayWidth;
  sourceCanvas.style.height = displayHeight;
  resultCanvas.style.width = displayWidth;
  resultCanvas.style.height = displayHeight;
}

function createSwatch(color, totalPixels) {
  const item = document.createElement("div");
  const sample = document.createElement("span");
  const data = document.createElement("span");
  const hex = document.createElement("strong");
  const share = document.createElement("span");
  const percent = totalPixels === 0 ? 0 : color.count / totalPixels * 100;

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
}

function downloadResult() {
  if (downloadButton.disabled || resultCanvas.width === 0) {
    return;
  }

  resultCanvas.toBlob((blob) => {
    if (!blob) {
      showError(new Error("Браузер не смог создать PNG"));
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    const ditherSuffix = ditheringSelect.value === "none" ? "" : `-${ditheringSelect.value}`;

    link.download = `${state.sourceName}-${getColorCount()}-colors-${colorSpaceSelect.value}${ditherSuffix}.png`;
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
  resultCanvas.width = 0;
  resultCanvas.height = 0;
  metricSize.textContent = "—";
  resetResultMetrics();
}

function resetResultMetrics() {
  metricSourceColors.textContent = "—";
  metricResultColors.textContent = "—";
  metricTime.textContent = "—";
  metricError.textContent = "—";
  iterationCount.textContent = "";
  paletteElement.replaceChildren();
  downloadButton.disabled = true;
  delete window.__paletteResult;
}

function showError(error) {
  console.error("Palette conversion failed.", error);
  setBusy(false);
  setStatus(error && error.message ? error.message : String(error), "error");
}

function setBusy(busy) {
  processButton.disabled = busy;
  imageSelect.disabled = busy;
  uploadButton.disabled = busy;
  ditheringSelect.disabled = busy;
  colorSpaceSelect.disabled = busy;
}

function setStatus(message, kind) {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-busy", kind === "busy");
  statusElement.classList.toggle("is-error", kind === "error");
}

function getColorCount() {
  return Math.max(2, Math.min(32, Math.round(Number(colorCountInput.value) || 8)));
}

function updateColorCountLabel() {
  const colorCount = getColorCount();

  colorCountValue.textContent = String(colorCount);
  colorCountNumberInput.value = String(colorCount);
}

function colorCountFromNumberInput(clampToRange) {
  const value = Number(colorCountNumberInput.value);

  if (!Number.isFinite(value) || colorCountNumberInput.value === "") {
    return null;
  }

  if (!clampToRange && (value < 2 || value > 32)) {
    return null;
  }

  return Math.max(2, Math.min(32, Math.round(value)));
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

function getDitheringLabel(mode) {
  switch (mode) {
    case "pattern-2x2":
      return "паттерн Bayer 2×2";
    case "pattern":
      return "паттерн Bayer 4×4";
    case "floyd-steinberg":
      return "Floyd–Steinberg";
    default:
      return "без дизеринга";
  }
}

function getColorSpaceLabel(colorSpace) {
  return colorSpace === "rgb" ? "RGB" : "OKLab";
}

function optionLabel(option) {
  return option ? option.textContent.trim() : "image";
}

function stripExtension(name) {
  return String(name).replace(/^Загружено:\s*/, "").replace(/\.[^.]+$/, "") || "image";
}

function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}
