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
