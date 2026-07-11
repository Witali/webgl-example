"use strict";

importScripts("./palette-quantizer.js?v=src-layout-1");

self.addEventListener("message", (event) => {
  const { pixels, width, height, colorCount, dithering, colorSpace } = event.data;
  const startedAt = performance.now();

  try {
    const result = self.PaletteQuantizer.quantizeImage(
      new Uint8ClampedArray(pixels),
      width,
      height,
      colorCount,
      { dithering, colorSpace }
    );

    result.durationMs = performance.now() - startedAt;
    self.postMessage(result, [result.pixels.buffer]);
  } catch (error) {
    self.postMessage({
      error: error && error.message ? error.message : String(error),
    });
  }
});
