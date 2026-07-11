"use strict";

importScripts("./palette-quantizer.js?v=src-layout-1");
importScripts("./block-palette-codec.js?v=block-palette-10");

self.addEventListener("message", (event) => {
  const { pixels, width, height, settings } = event.data;
  const startedAt = performance.now();

  try {
    const result = self.BlockPaletteCodec.compressImage(
      new Uint8ClampedArray(pixels),
      width,
      height,
      settings
    );

    result.algorithm = "cpu";
    result.acceleratedStages = [];
    result.durationMs = performance.now() - startedAt;
    self.postMessage(result, [
      result.pixels.buffer,
      result.blockPaletteIndices.buffer,
      result.pixelIndices.buffer,
    ]);
  } catch (error) {
    self.postMessage({ error: error && error.message ? error.message : String(error) });
  }
});
