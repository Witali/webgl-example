"use strict";

const uploadButton = document.querySelector("#upload-button");
const fileInput = document.querySelector("#file-input");
const viewport = document.querySelector("#image-viewport");
const stage = document.querySelector("#image-stage");
const canvas = document.querySelector("#image-canvas");
const emptyState = document.querySelector("#empty-state");
const statusElement = document.querySelector("#status");
const zoomLevel = document.querySelector("#zoom-level");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomInButton = document.querySelector("#zoom-in");
const actualSizeButton = document.querySelector("#actual-size");
const fitImageButton = document.querySelector("#fit-image");
const panButtons = {
  left: document.querySelector("#pan-left"),
  up: document.querySelector("#pan-up"),
  down: document.querySelector("#pan-down"),
  right: document.querySelector("#pan-right"),
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const ZOOM_FACTOR = 1.25;
const STAGE_MARGIN = 32;
const state = {
  width: 0,
  height: 0,
  zoom: 1,
  loaded: false,
  dragging: false,
  dragPointerId: null,
  dragX: 0,
  dragY: 0,
  dragScrollLeft: 0,
  dragScrollTop: 0,
  touches: new Map(),
  pinching: false,
  pinchStartDistance: 0,
  pinchStartZoom: 1,
  pinchImageX: 0,
  pinchImageY: 0,
};

uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;

  if (file) {
    loadFile(file);
  }
});

zoomOutButton.addEventListener("click", () => setZoom(state.zoom / ZOOM_FACTOR));
zoomInButton.addEventListener("click", () => setZoom(state.zoom * ZOOM_FACTOR));
actualSizeButton.addEventListener("click", () => setZoom(1));
fitImageButton.addEventListener("click", fitImage);

panButtons.left.addEventListener("click", () => panBy(-getPanStep("x"), 0));
panButtons.right.addEventListener("click", () => panBy(getPanStep("x"), 0));
panButtons.up.addEventListener("click", () => panBy(0, -getPanStep("y")));
panButtons.down.addEventListener("click", () => panBy(0, getPanStep("y")));

viewport.addEventListener("wheel", (event) => {
  if (!state.loaded || (!event.ctrlKey && !event.metaKey)) {
    return;
  }

  event.preventDefault();
  const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

  setZoom(state.zoom * factor, event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener("pointerdown", (event) => {
  if (!state.loaded) {
    return;
  }

  if (event.pointerType === "touch") {
    startTouch(event);
    return;
  }

  if (event.button === 0) {
    startDrag(event.pointerId, event.clientX, event.clientY);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
});

viewport.addEventListener("pointermove", (event) => {
  if (state.touches.has(event.pointerId)) {
    moveTouch(event);
    return;
  }

  if (!state.dragging || event.pointerId !== state.dragPointerId) {
    return;
  }

  viewport.scrollLeft = state.dragScrollLeft - (event.clientX - state.dragX);
  viewport.scrollTop = state.dragScrollTop - (event.clientY - state.dragY);
});

viewport.addEventListener("pointerup", finishPointer);
viewport.addEventListener("pointercancel", finishPointer);

viewport.addEventListener("keydown", (event) => {
  if (!state.loaded) {
    return;
  }

  const directions = {
    ArrowLeft: [-getPanStep("x"), 0],
    ArrowRight: [getPanStep("x"), 0],
    ArrowUp: [0, -getPanStep("y")],
    ArrowDown: [0, getPanStep("y")],
  };
  const offset = directions[event.key];

  if (offset) {
    event.preventDefault();
    panBy(offset[0], offset[1]);
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  viewport.addEventListener(eventName, (event) => {
    event.preventDefault();
    viewport.classList.add("is-drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  viewport.addEventListener(eventName, (event) => {
    event.preventDefault();
    viewport.classList.remove("is-drag-over");
  });
}

viewport.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;

  if (file) {
    loadFile(file);
  }
});

window.addEventListener("resize", () => {
  if (state.loaded && stage.dataset.fitted === "true") {
    fitImage();
  }
});

async function loadFile(file) {
  setStatus(`Открываю ${file.name}…`);
  uploadButton.disabled = true;

  try {
    const bytes = await file.arrayBuffer();
    const isBpal = hasBpalMagic(bytes);

    if (isBpal || file.name.toLowerCase().endsWith(".bpal")) {
      loadBpal(bytes, file.name);
    } else {
      await loadRegularImage(file);
    }
  } catch (error) {
    console.error("Could not open the selected image.", error);
    setStatus(error && error.message ? error.message : String(error), true);
  } finally {
    uploadButton.disabled = false;
    fileInput.value = "";
  }
}

function loadBpal(bytes, fileName) {
  const decoded = window.BlockPaletteFormat.decodeBlockPaletteFile(bytes);
  const pixels = new Uint8ClampedArray(decoded.pixels);

  drawPixels(pixels, decoded.width, decoded.height);
  setStatus(
    `${fileName} · ${decoded.width} × ${decoded.height} · BPAL v${decoded.version} · `
      + `${decoded.globalColorCount} цветов · блок ${decoded.blockSize} × ${decoded.blockSize}`
  );
}

async function loadRegularImage(file) {
  const image = await decodeBrowserImage(file);

  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").drawImage(image, 0, 0);

  if (typeof image.close === "function") {
    image.close();
  }

  finishLoading(file.name, canvas.width, canvas.height);
  setStatus(`${file.name} · ${canvas.width} × ${canvas.height} · обычное изображение`);
}

async function decodeBrowserImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();

    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawPixels(pixels, width, height) {
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  finishLoading("BPAL", width, height);
}

function finishLoading(_name, width, height) {
  state.width = width;
  state.height = height;
  state.loaded = true;
  stage.hidden = false;
  emptyState.hidden = true;
  setControlsEnabled(true);

  requestAnimationFrame(fitImage);
}

function fitImage() {
  if (!state.loaded) {
    return;
  }

  const availableWidth = Math.max(1, viewport.clientWidth - STAGE_MARGIN * 2);
  const availableHeight = Math.max(1, viewport.clientHeight - STAGE_MARGIN * 2);
  const fittedZoom = Math.min(availableWidth / state.width, availableHeight / state.height);

  setZoom(fittedZoom, undefined, undefined, true);
  stage.dataset.fitted = "true";
}

function setZoom(value, clientX, clientY, forceCenter, fixedImagePoint) {
  if (!state.loaded) {
    return;
  }

  const nextZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
  const viewportRect = viewport.getBoundingClientRect();
  const anchorOffsetX = clientX === undefined ? viewport.clientWidth / 2 : clientX - viewportRect.left;
  const anchorOffsetY = clientY === undefined ? viewport.clientHeight / 2 : clientY - viewportRect.top;
  const imageX = fixedImagePoint
    ? fixedImagePoint.x
    : (viewport.scrollLeft + anchorOffsetX - STAGE_MARGIN) / state.zoom;
  const imageY = fixedImagePoint
    ? fixedImagePoint.y
    : (viewport.scrollTop + anchorOffsetY - STAGE_MARGIN) / state.zoom;

  state.zoom = nextZoom;
  stage.style.width = `${state.width * nextZoom}px`;
  stage.style.height = `${state.height * nextZoom}px`;
  stage.classList.toggle("is-magnified", nextZoom >= 2);
  zoomLevel.value = `${formatZoom(nextZoom)}%`;
  zoomOutButton.disabled = nextZoom <= MIN_ZOOM;
  zoomInButton.disabled = nextZoom >= MAX_ZOOM;

  if (!forceCenter) {
    stage.dataset.fitted = "false";
  }

  const updateScrollPosition = () => {
    if (forceCenter) {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
      return;
    }

    viewport.scrollLeft = imageX * nextZoom + STAGE_MARGIN - anchorOffsetX;
    viewport.scrollTop = imageY * nextZoom + STAGE_MARGIN - anchorOffsetY;
  };

  if (fixedImagePoint) {
    updateScrollPosition();
  } else {
    requestAnimationFrame(updateScrollPosition);
  }
}

function panBy(left, top) {
  viewport.scrollBy({ left, top, behavior: "smooth" });
}

function getPanStep(axis) {
  return (axis === "x" ? viewport.clientWidth : viewport.clientHeight) * 0.35;
}

function startTouch(event) {
  if (state.touches.size >= 2) {
    event.preventDefault();
    return;
  }

  state.touches.set(event.pointerId, {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  });
  viewport.setPointerCapture(event.pointerId);

  if (state.touches.size === 1) {
    startDrag(event.pointerId, event.clientX, event.clientY);
  } else {
    startPinch();
  }

  event.preventDefault();
}

function moveTouch(event) {
  const touch = state.touches.get(event.pointerId);

  touch.x = event.clientX;
  touch.y = event.clientY;

  if (state.pinching && state.touches.size === 2) {
    const [first, second] = state.touches.values();
    const distance = Math.max(1, getDistance(first, second));
    const center = getCenter(first, second);
    const nextZoom = state.pinchStartZoom * distance / state.pinchStartDistance;

    setZoom(nextZoom, center.x, center.y, false, {
      x: state.pinchImageX,
      y: state.pinchImageY,
    });
  } else if (state.dragging && event.pointerId === state.dragPointerId) {
    viewport.scrollLeft = state.dragScrollLeft - (event.clientX - state.dragX);
    viewport.scrollTop = state.dragScrollTop - (event.clientY - state.dragY);
  }

  event.preventDefault();
}

function startPinch() {
  const [first, second] = state.touches.values();
  const center = getCenter(first, second);
  const viewportRect = viewport.getBoundingClientRect();
  const anchorOffsetX = center.x - viewportRect.left;
  const anchorOffsetY = center.y - viewportRect.top;

  state.dragging = false;
  state.dragPointerId = null;
  state.pinching = true;
  state.pinchStartDistance = Math.max(1, getDistance(first, second));
  state.pinchStartZoom = state.zoom;
  state.pinchImageX = (viewport.scrollLeft + anchorOffsetX - STAGE_MARGIN) / state.zoom;
  state.pinchImageY = (viewport.scrollTop + anchorOffsetY - STAGE_MARGIN) / state.zoom;
  viewport.classList.add("is-dragging");
}

function startDrag(pointerId, clientX, clientY) {
  state.dragging = true;
  state.dragPointerId = pointerId;
  state.dragX = clientX;
  state.dragY = clientY;
  state.dragScrollLeft = viewport.scrollLeft;
  state.dragScrollTop = viewport.scrollTop;
  viewport.classList.add("is-dragging");
}

function finishPointer(event) {
  if (state.touches.has(event.pointerId)) {
    state.touches.delete(event.pointerId);

    if (state.pinching) {
      state.pinching = false;

      if (state.touches.size === 1) {
        const [remainingTouch] = state.touches.values();

        startDrag(remainingTouch.id, remainingTouch.x, remainingTouch.y);
      } else {
        stopDrag();
      }
    } else if (state.dragPointerId === event.pointerId) {
      stopDrag();
    }
  } else if (state.dragPointerId === event.pointerId) {
    stopDrag();
  }

  if (viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
}

function stopDrag() {
  state.dragging = false;
  state.dragPointerId = null;
  viewport.classList.remove("is-dragging");
}

function getDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function getCenter(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function setControlsEnabled(enabled) {
  actualSizeButton.disabled = !enabled;
  fitImageButton.disabled = !enabled;

  for (const button of Object.values(panButtons)) {
    button.disabled = !enabled;
  }
}

function setStatus(message, isError) {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-error", Boolean(isError));
}

function hasBpalMagic(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));

  return bytes.length === 4
    && bytes[0] === 0x42
    && bytes[1] === 0x50
    && bytes[2] === 0x41
    && bytes[3] === 0x4c;
}

function formatZoom(value) {
  const percent = value * 100;

  return percent < 10 ? percent.toFixed(1) : String(Math.round(percent));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
