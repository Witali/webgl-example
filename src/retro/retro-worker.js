"use strict";

importScripts("../palette/palette-quantizer.js?v=mix-average-1");
importScripts("./retro-converter.js?v=mix-average-1");
importScripts("./zx-optimizer.js?v=mix-average-1");

self.addEventListener("message", (event) => {
  const { mode, pixels, width, height, options } = event.data;
  const startedAt = performance.now();

  try {
    const sourcePixels = new Uint8ClampedArray(pixels);
    let result;

    if (mode === "zx-spectrum" && options.autoOptimize) {
      result = self.ZxOptimizer.optimizeZxSpectrum(sourcePixels, width, height, {
        onProgress(progress) {
          self.postMessage({ progress });
        },
      }).result;
    } else if (mode === "zx-spectrum") {
      result = self.RetroConverter.convertZxSpectrum(sourcePixels, width, height, options);
    } else {
      result = self.RetroConverter.convertModeX(sourcePixels, width, height, options);
    }
    const transfers = [result.pixels.buffer];

    if (result.screen) {
      transfers.push(result.screen.buffer);
    }

    if (result.planar) {
      transfers.push(result.planar.buffer, result.palette6Bit.buffer, result.indexedPixels.buffer);
    }

    result.durationMs = performance.now() - startedAt;
    self.postMessage(result, transfers);
  } catch (error) {
    self.postMessage({ error: error && error.message ? error.message : String(error) });
  }
});
