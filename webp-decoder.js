(function (global) {
  "use strict";

  const WEBP_DECODE_MODULE_URL = "/assets/vendor/jsquash-webp/decode.js";

  let decodePromise = null;

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

  async function loadWebpDecode() {
    if (!decodePromise) {
      decodePromise = import(WEBP_DECODE_MODULE_URL).then((module) => module.default);
    }

    return decodePromise;
  }

  global.WasmWebpDecoder = WasmWebpDecoder;
})(typeof globalThis !== "undefined" ? globalThis : window);
