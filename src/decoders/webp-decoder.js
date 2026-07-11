/*
 * Purpose: WASM/libwebp wrapper used as the reference WebP decoder in tests.
 * Processing blocks:
 * - Load the Emscripten factory and locate the bundled WebP WASM file.
 * - Cache the async decode function after first initialization.
 * - Normalize decoded ImageData into the same result shape as other decoders.
 */
(function (global) {
  "use strict";

  const WEBP_DECODER_FACTORY_URL = "/assets/vendor/jsquash-webp/codec/dec/webp_dec.js";
  const WEBP_DECODER_WASM_URL = "/assets/vendor/jsquash-webp/codec/dec/webp_dec.wasm";

  let decodePromise = null;

  // Adapter class that presents the WASM WebP path like the other benchmark decoders.
  class WasmWebpDecoder {
    static async create() {
      return new WasmWebpDecoder();
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch WebP: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    async decode(arrayBuffer) {
      const decode = await loadWebpDecode();
      const started = performance.now();
      const imageData = await decode(arrayBuffer);
      const decodeMs = performance.now() - started;

      return {
        width: imageData.width,
        height: imageData.height,
        pixels: imageData.data,
        timings: {
          decodeMs,
          workMs: decodeMs,
          readbackMs: 0,
          measuresCleanWork: true,
          timedPhase: "WASM WebP decode API",
        },
      };
    }
  }

  // Lazy initialization avoids paying the libwebp WASM startup cost until WebP is selected.
  async function loadWebpDecode() {
    if (!decodePromise) {
      decodePromise = loadWebpModuleFactory()
        .then((moduleFactory) => {
          const emscriptenModule = moduleFactory({
            noInitialRun: true,
            locateFile(path) {
              return path === "webp_dec.wasm" ? WEBP_DECODER_WASM_URL : path;
            },
          });

          return async function decode(buffer) {
            const module = await emscriptenModule;
            const result = module.decode(buffer);

            if (!result) {
              throw new Error("Decoding error");
            }

            return result;
          };
        })
        .catch((error) => {
          decodePromise = null;
          throw new Error(
            `Failed to load WebP decoder from ${WEBP_DECODER_FACTORY_URL}: ${
              error && error.message ? error.message : error
            }`
          );
        });
    }

    return decodePromise;
  }

  // Load the generated Emscripten module as a temporary blob-backed ES module.
  async function loadWebpModuleFactory() {
    const response = await fetch(WEBP_DECODER_FACTORY_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const source = await response.text();
    const blob = new Blob([source], { type: "text/javascript" });
    const moduleUrl = URL.createObjectURL(blob);

    try {
      const module = await import(moduleUrl);

      if (typeof module.default !== "function") {
        throw new Error("WebP decoder factory did not export a function.");
      }

      return module.default;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }

  global.WasmWebpDecoder = WasmWebpDecoder;
})(typeof globalThis !== "undefined" ? globalThis : window);
