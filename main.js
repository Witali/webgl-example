/*
 * Purpose: WebGL demo entry point that renders the rotating textured cube.
 * Processing blocks:
 * - Create the shared textured cube renderer.
 * - Load the stone texture through the shared texture path.
 * - Run the animation loop and update the FPS counter.
 */
"use strict";

const canvas = document.getElementById("gl-canvas");
const fpsCounter = document.getElementById("fps-counter");
const materialControls = document.getElementById("material-controls");
const heightStrengthInput = document.getElementById("height-strength");
const heightStrengthValue = document.getElementById("height-strength-value");
const gl = canvas.getContext("webgl", { antialias: true });
const fpsState = {
  frameCount: 0,
  lastUpdateTime: 0,
};
let cubeRenderer = null;

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
  initializeMaterialControls();
  cubeRenderer.loadTexture("assets/stone-texture-wic.jpg");
  requestAnimationFrame(render);
}

function render(time) {
  updateFpsCounter(time);
  cubeRenderer.draw({
    angleY: time * 0.001,
    angleX: time * 0.0007,
    resizeToDisplaySize: true,
  });
  requestAnimationFrame(render);
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
