/*
 * Purpose: WebGL demo entry point that renders the rotating textured cube.
 * Processing blocks:
 * - Create the shared textured cube renderer.
 * - Load the stone texture through the shared texture path.
 * - Run the animation loop, pointer controls, and FPS counter.
 */
"use strict";

const canvas = document.getElementById("gl-canvas");
const fpsCounter = document.getElementById("fps-counter");
const materialControls = document.getElementById("material-controls");
const heightStrengthInput = document.getElementById("height-strength");
const heightStrengthValue = document.getElementById("height-strength-value");
const bpalFileInput = document.getElementById("bpal-file");
const bpalStatus = document.getElementById("bpal-status");
const gl = canvas.getContext("webgl", { antialias: true });
const fpsState = {
  frameCount: 0,
  lastUpdateTime: 0,
};
const cubeMotionState = {
  running: true,
  angleX: 0,
  angleY: 0,
  lastFrameTime: 0,
  drag: null,
  suppressNextClick: false,
};
const AUTO_ROTATE_X_SPEED = 0.0007;
const AUTO_ROTATE_Y_SPEED = 0.001;
const POINTER_ROTATE_SPEED = 0.01;
const CLICK_DRAG_THRESHOLD = 4;
let cubeRenderer = null;
let bpalLoadId = 0;

if (!gl) {
  document.body.textContent = "WebGL is not supported in this browser.";
  throw new Error("WebGL is not supported");
}

start().catch((error) => {
  console.error("WebGL cube startup failed.", error);
  document.body.textContent = `WebGL cube startup failed: ${error.message}`;
});

async function start() {
  cubeRenderer = await TexturedCubeRenderer.create(gl);
  window.__texturedCubeRenderer = cubeRenderer;
  window.__cubeMotionState = cubeMotionState;
  initializeMaterialControls();
  initializeCubePointerControls();
  await cubeRenderer.loadTexture("assets/stone-texture-wic.jpg");
  initializeBpalTextureControls();
  requestAnimationFrame(render);
}

function render(time) {
  updateCubeAngles(time);
  updateFpsCounter(time);
  cubeRenderer.draw({
    angleY: cubeMotionState.angleY,
    angleX: cubeMotionState.angleX,
    resizeToDisplaySize: true,
  });
  requestAnimationFrame(render);
}

function updateCubeAngles(time) {
  const elapsed = cubeMotionState.lastFrameTime
    ? Math.min(64, time - cubeMotionState.lastFrameTime)
    : 0;

  cubeMotionState.lastFrameTime = time;

  if (!cubeMotionState.running || cubeMotionState.drag) {
    return;
  }

  cubeMotionState.angleY += elapsed * AUTO_ROTATE_Y_SPEED;
  cubeMotionState.angleX += elapsed * AUTO_ROTATE_X_SPEED;
}

function updateFpsCounter(time) {
  fpsState.frameCount += 1;

  if (fpsState.lastUpdateTime === 0) {
    fpsState.lastUpdateTime = time;
    return;
  }

  const elapsed = time - fpsState.lastUpdateTime;

  if (elapsed >= 500) {
    const fps = Math.round((fpsState.frameCount * 1000) / elapsed);

    fpsCounter.textContent = `${fps} FPS`;
    fpsState.frameCount = 0;
    fpsState.lastUpdateTime = time;
  }
}

function initializeMaterialControls() {
  if (!materialControls || !heightStrengthInput) {
    return;
  }

  materialControls.addEventListener("change", (event) => {
    if (event.target && event.target.name === "material") {
      applySelectedMaterial();
    }
  });
  heightStrengthInput.addEventListener("input", () => {
    cubeRenderer.setHeightStrength(Number(heightStrengthInput.value));
    updateHeightStrengthLabel();
  });
  applySelectedMaterial();
}

function initializeBpalTextureControls() {
  if (!bpalFileInput || !bpalStatus) {
    return;
  }

  bpalFileInput.addEventListener("change", () => {
    const file = bpalFileInput.files && bpalFileInput.files[0];

    if (file) {
      loadBpalTextureFile(file).catch((error) => {
        console.error("BPAL texture load failed.", error);
        setBpalStatus(error && error.message ? error.message : String(error), true);
      });
    }
  });
}

async function loadBpalTextureFile(file) {
  if (!window.BpalTextureDecoder) {
    throw new Error("BPAL texture decoder is unavailable");
  }

  const loadId = ++bpalLoadId;

  bpalFileInput.disabled = true;
  setBpalStatus(`Чтение ${file.name}…`, false);

  try {
    const bytes = await file.arrayBuffer();

    if (loadId !== bpalLoadId) {
      return;
    }

    const decoded = window.BpalTextureDecoder.decode(bytes);

    cubeRenderer.loadTexturePixels(decoded.pixels, decoded.width, decoded.height, {
      flipY: true,
      resetMaterialMaps: true,
    });

    window.__cubeBpalTexture = {
      name: file.name,
      width: decoded.width,
      height: decoded.height,
      version: decoded.version,
      blockSize: decoded.blockSize,
      localColorCount: decoded.localColorCount,
      globalColorCount: decoded.globalColorCount,
      paletteMode: decoded.paletteMode,
    };

    setBpalStatus(
      `${file.name} · ${decoded.width}×${decoded.height} · BPAL v${decoded.version}`,
      false
    );
  } finally {
    if (loadId === bpalLoadId) {
      bpalFileInput.disabled = false;
      bpalFileInput.value = "";
    }
  }
}

function setBpalStatus(message, isError) {
  bpalStatus.textContent = message;
  bpalStatus.classList.toggle("is-error", Boolean(isError));
}

function initializeCubePointerControls() {
  canvas.addEventListener("click", () => {
    if (cubeMotionState.suppressNextClick) {
      cubeMotionState.suppressNextClick = false;
      return;
    }

    cubeMotionState.running = !cubeMotionState.running;
    cubeMotionState.lastFrameTime = 0;
  });
  canvas.addEventListener("pointerdown", startCubeDrag);
  canvas.addEventListener("pointermove", updateCubeDrag);
  canvas.addEventListener("pointerup", finishCubeDrag);
  canvas.addEventListener("pointercancel", finishCubeDrag);
  canvas.addEventListener("lostpointercapture", () => {
    cubeMotionState.drag = null;
    canvas.classList.remove("is-dragging");
  });
}

function startCubeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();

  if (canvas.setPointerCapture) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Synthetic pointer events used by tests may not have a capturable pointer.
    }
  }

  canvas.classList.add("is-dragging");
  cubeMotionState.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    angleX: cubeMotionState.angleX,
    angleY: cubeMotionState.angleY,
    moved: false,
  };
}

function updateCubeDrag(event) {
  const drag = cubeMotionState.drag;

  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();

  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;

  if (Math.hypot(deltaX, deltaY) >= CLICK_DRAG_THRESHOLD) {
    drag.moved = true;
  }

  cubeMotionState.angleY = drag.angleY + deltaX * POINTER_ROTATE_SPEED;
  cubeMotionState.angleX = drag.angleX - deltaY * POINTER_ROTATE_SPEED;
}

function finishCubeDrag(event) {
  const drag = cubeMotionState.drag;

  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  cubeMotionState.drag = null;
  cubeMotionState.suppressNextClick = drag.moved;
  canvas.classList.remove("is-dragging");

  if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function applySelectedMaterial() {
  const formData = new FormData(materialControls);
  const material = formData.get("material") || "matte";

  cubeRenderer.setMaterial(String(material));
  heightStrengthInput.value = cubeRenderer.material.heightStrength.toFixed(2);
  updateHeightStrengthLabel();
}

function updateHeightStrengthLabel() {
  if (heightStrengthValue) {
    heightStrengthValue.textContent = Number(heightStrengthInput.value).toFixed(2);
  }
}
