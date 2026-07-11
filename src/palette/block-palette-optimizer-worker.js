"use strict";

importScripts("./palette-quantizer.js?v=src-layout-1");
importScripts("./block-palette-codec.js?v=block-palette-8");
importScripts("./block-palette-optimizer.js?v=block-palette-1");

self.addEventListener("message", (event) => {
  const { pixels, width, height, options } = event.data;

  try {
    const result = self.BlockPaletteOptimizer.findBalancedBlockPaletteSettings(
      new Uint8ClampedArray(pixels),
      width,
      height,
      options,
      (progress) => self.postMessage({ type: "progress", ...progress })
    );

    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error && error.message ? error.message : String(error),
    });
  }
});
