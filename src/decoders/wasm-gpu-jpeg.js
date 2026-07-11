/*
 * Purpose: Hybrid JPEG decoder that reuses the WebGL shader path while using
 * WASM to pack coefficient atlases faster than JavaScript loops.
 * Processing blocks:
 * - Load the shared JPEG WASM module.
 * - Copy parsed coefficient blocks into WASM memory.
 * - Pack a float atlas and upload it to the WebGL IDCT renderer.
 */
(function (global) {
  "use strict";

  const PAGE_SIZE = 65536;

  // Extends the WebGL JPEG decoder by replacing JavaScript atlas packing with a WASM helper.
  class WasmGpuJpegDecoder extends global.GpuJpegDecoder {
    constructor(gl, instance) {
      super(gl);

      this.instance = instance;
      this.exports = instance.exports;
      this.memory = this.exports.memory;
    }

    // Load both the shared WebGL shaders and the WASM module used for atlas packing.
    static async create(gl, url) {
      await global.GpuJpegDecoder.loadShaderSources();

      const wasmUrl = url || "wasm/jpeg-idct.wasm";
      let result;

      if (WebAssembly.instantiateStreaming) {
        try {
          result = await WebAssembly.instantiateStreaming(fetch(wasmUrl));
        } catch (error) {
          result = null;
        }
      }

      if (!result) {
        const response = await fetch(wasmUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch WASM GPU helper: ${response.status}`);
        }

        result = await WebAssembly.instantiate(await response.arrayBuffer());
      }

      return new WasmGpuJpegDecoder(gl, result.instance);
    }

    // Pack one component's coefficient blocks into a float RGBA atlas before uploading to WebGL.
    createCoefficientTexture(component) {
      const gl = this.gl;
      const texture = gl.createTexture();
      const width = component.blockCountX * 8;
      const height = component.blockCountY * 8;
      const coeffBytes = component.blocks.byteLength;
      const coeffPtr = 0;
      const atlasPtr = align(coeffPtr + coeffBytes, 4);
      const atlasBytes = width * height * 4 * Float32Array.BYTES_PER_ELEMENT;
      const totalBytes = atlasPtr + atlasBytes;

      this.ensureMemory(totalBytes);

      new Float32Array(
        this.memory.buffer,
        coeffPtr,
        component.blocks.length
      ).set(component.blocks);

      this.exports.packCoefficientAtlas(
        coeffPtr,
        component.blockCountX,
        component.blockCountY,
        atlasPtr
      );

      const atlas = new Float32Array(this.memory.buffer, atlasPtr, width * height * 4);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.FLOAT,
        atlas
      );

      return texture;
    }

    ensureMemory(requiredBytes) {
      const currentBytes = this.memory.buffer.byteLength;

      if (currentBytes >= requiredBytes) {
        return;
      }

      this.memory.grow(Math.ceil((requiredBytes - currentBytes) / PAGE_SIZE));
    }
  }

  function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }

  global.WasmGpuJpegDecoder = WasmGpuJpegDecoder;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { WasmGpuJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
