(function (global) {
  "use strict";

  const BASIS_VALUES = new Float32Array(64);
  const PAGE_SIZE = 65536;

  for (let local = 0; local < 8; local += 1) {
    for (let frequency = 0; frequency < 8; frequency += 1) {
      const scale = frequency === 0 ? Math.SQRT1_2 : 1;

      BASIS_VALUES[local * 8 + frequency] =
        scale * Math.cos(((2 * local + 1) * frequency * Math.PI) / 16);
    }
  }

  class WasmJpegDecoder {
    constructor(instance) {
      this.instance = instance;
      this.exports = instance.exports;
      this.memory = this.exports.memory;
      this.basisPtr = 0;
      this.basisBytes = BASIS_VALUES.byteLength;
      this.basisInitialized = false;

      this.ensureBasis();
    }

    static async create(url) {
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
          throw new Error(`Failed to fetch WASM decoder: ${response.status}`);
        }

        result = await WebAssembly.instantiate(await response.arrayBuffer());
      }

      return new WasmJpegDecoder(result.instance);
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch JPEG: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    decode(arrayBuffer) {
      const jpeg = global.GpuJpegDecoder.parse(arrayBuffer);
      const layout = this.createMemoryLayout(jpeg);

      this.ensureMemory(layout.totalBytes);
      this.ensureBasis();
      this.copyComponents(jpeg, layout);

      if (this.exports.decodeFast) {
        this.decodeFast(jpeg, layout);
      } else {
        this.decodeSlow(jpeg, layout);
      }

      return {
        width: jpeg.width,
        height: jpeg.height,
        pixels: new Uint8Array(this.memory.buffer, layout.outputPtr, jpeg.width * jpeg.height * 4),
      };
    }

    decodeSlow(jpeg, layout) {
      this.exports.decode(
        jpeg.width,
        jpeg.height,
        jpeg.components.length,
        jpeg.maxHorizontalSampling,
        jpeg.maxVerticalSampling,
        this.basisPtr,
        layout.components[0].ptr,
        jpeg.components[0].blockCountX,
        jpeg.components[0].blockCountY,
        jpeg.components[0].horizontalSampling,
        jpeg.components[0].verticalSampling,
        layout.components[1].ptr,
        (jpeg.components[1] || jpeg.components[0]).blockCountX,
        (jpeg.components[1] || jpeg.components[0]).blockCountY,
        (jpeg.components[1] || jpeg.components[0]).horizontalSampling,
        (jpeg.components[1] || jpeg.components[0]).verticalSampling,
        layout.components[2].ptr,
        (jpeg.components[2] || jpeg.components[0]).blockCountX,
        (jpeg.components[2] || jpeg.components[0]).blockCountY,
        (jpeg.components[2] || jpeg.components[0]).horizontalSampling,
        (jpeg.components[2] || jpeg.components[0]).verticalSampling,
        layout.outputPtr
      );
    }

    decodeFast(jpeg, layout) {
      const c0 = jpeg.components[0];
      const c1 = jpeg.components[1] || c0;
      const c2 = jpeg.components[2] || c0;

      this.exports.decodeFast(
        jpeg.width,
        jpeg.height,
        jpeg.components.length,
        jpeg.maxHorizontalSampling,
        jpeg.maxVerticalSampling,
        this.basisPtr,
        layout.components[0].ptr,
        c0.blockCountX,
        c0.blockCountY,
        c0.horizontalSampling,
        c0.verticalSampling,
        layout.components[0].planePtr,
        layout.components[1].ptr,
        c1.blockCountX,
        c1.blockCountY,
        c1.horizontalSampling,
        c1.verticalSampling,
        layout.components[1].planePtr,
        layout.components[2].ptr,
        c2.blockCountX,
        c2.blockCountY,
        c2.horizontalSampling,
        c2.verticalSampling,
        layout.components[2].planePtr,
        layout.tempPtr,
        layout.outputPtr
      );
    }

    createMemoryLayout(jpeg) {
      let offset = align(this.basisBytes, 4);
      const components = jpeg.components.map((component) => {
        const bytes = component.blocks.byteLength;
        const ptr = offset;
        const planeBytes = component.blockCountX * 8 * component.blockCountY * 8 * Float32Array.BYTES_PER_ELEMENT;
        let planePtr;

        offset = align(offset + bytes, 4);
        planePtr = offset;
        offset = align(offset + planeBytes, 4);

        return { ptr, bytes, planePtr, planeBytes };
      });

      while (components.length < 3) {
        components.push(components[0]);
      }

      const tempPtr = offset;
      offset = align(tempPtr + 64 * Float64Array.BYTES_PER_ELEMENT, 8);

      const outputPtr = offset;
      offset = align(outputPtr + jpeg.width * jpeg.height * 4, 4);

      return {
        components,
        tempPtr,
        outputPtr,
        totalBytes: offset,
      };
    }

    ensureMemory(requiredBytes) {
      const currentBytes = this.memory.buffer.byteLength;

      if (currentBytes >= requiredBytes) {
        return;
      }

      const missingBytes = requiredBytes - currentBytes;
      const pages = Math.ceil(missingBytes / PAGE_SIZE);

      this.memory.grow(pages);
      this.basisInitialized = false;
    }

    ensureBasis() {
      if (this.basisInitialized) {
        return;
      }

      new Float32Array(this.memory.buffer, this.basisPtr, BASIS_VALUES.length)
        .set(BASIS_VALUES);
      this.basisInitialized = true;
    }

    copyComponents(jpeg, layout) {
      jpeg.components.forEach((component, index) => {
        new Float32Array(
          this.memory.buffer,
          layout.components[index].ptr,
          component.blocks.length
        ).set(component.blocks);
      });
    }
  }

  function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }

  global.WasmJpegDecoder = WasmJpegDecoder;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { WasmJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
