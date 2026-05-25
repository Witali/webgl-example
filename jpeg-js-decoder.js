/*
 * Purpose: Pure JavaScript JPEG decoder that reconstructs pixels without
 * WebGL, WebGPU, WASM, Image, or canvas decode paths.
 * Processing blocks:
 * - Parse JPEG markers and Huffman entropy through the existing JavaScript parser.
 * - Convert dequantized DCT blocks into component sample planes with JavaScript IDCT.
 * - Upsample components and convert grayscale or YCbCr samples into RGBA pixels.
 */
(function (global) {
  "use strict";

  const BASIS_VALUES = new Float64Array(64);

  // The basis includes JPEG's C(0)=1/sqrt(2) scale so IDCT can use simple products.
  for (let local = 0; local < 8; local += 1) {
    for (let frequency = 0; frequency < 8; frequency += 1) {
      const scale = frequency === 0 ? Math.SQRT1_2 : 1;

      BASIS_VALUES[local * 8 + frequency] =
        scale * Math.cos(((2 * local + 1) * frequency * Math.PI) / 16);
    }
  }

  // Public JS-only decoder facade: JavaScript handles both entropy and reconstruction.
  class JsJpegDecoder {
    static async create() {
      return new JsJpegDecoder();
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch JPEG: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    decode(arrayBuffer) {
      if (!global.GpuJpegDecoder || typeof global.GpuJpegDecoder.parse !== "function") {
        throw new Error("GpuJpegDecoder.parse is required before JsJpegDecoder.");
      }

      const parseStarted = performance.now();
      const jpeg = global.GpuJpegDecoder.parse(arrayBuffer);
      const parseMs = performance.now() - parseStarted;

      if (jpeg.components.length !== 1 && jpeg.components.length !== 3) {
        throw new Error("JsJpegDecoder supports grayscale and YCbCr JPEG images.");
      }

      const decodeStarted = performance.now();
      const planes = jpeg.components.map((component) => decodeComponentPlane(component));

      while (planes.length < 3) {
        planes.push(planes[0]);
      }

      const pixels = composeRgbaPixels(jpeg, planes);
      const jsDecodeMs = performance.now() - decodeStarted;

      return {
        width: jpeg.width,
        height: jpeg.height,
        pixels,
        timings: {
          parseMs,
          setupMs: 0,
          uploadMs: 0,
          decodeMs: jsDecodeMs,
          jsDecodeMs,
          coreDecodeMs: jsDecodeMs,
          readbackMs: 0,
          workMs: parseMs + jsDecodeMs,
          totalDecoderMs: parseMs + jsDecodeMs,
          measuresCleanWork: true,
          timedPhase: "JPEG entropy parse + JavaScript IDCT/color",
        },
      };
    }
  }

  function decodeComponentPlane(component) {
    const width = component.blockCountX * 8;
    const height = component.blockCountY * 8;
    const plane = new Uint8Array(width * height);
    const blocks = component.blocks;

    for (let blockY = 0; blockY < component.blockCountY; blockY += 1) {
      for (let blockX = 0; blockX < component.blockCountX; blockX += 1) {
        const blockOffset = (blockY * component.blockCountX + blockX) * 64;

        decodeBlock(blocks, blockOffset, plane, width, blockX * 8, blockY * 8);
      }
    }

    return {
      plane,
      width,
      height,
      horizontalSampling: component.horizontalSampling,
      verticalSampling: component.verticalSampling,
    };
  }

  function decodeBlock(blocks, blockOffset, plane, planeWidth, originX, originY) {
    for (let localY = 0; localY < 8; localY += 1) {
      const yBasisOffset = localY * 8;

      for (let localX = 0; localX < 8; localX += 1) {
        const xBasisOffset = localX * 8;
        let value = 0;

        for (let row = 0; row < 8; row += 1) {
          const yBasis = BASIS_VALUES[yBasisOffset + row];
          const rowOffset = blockOffset + row * 8;

          for (let column = 0; column < 8; column += 1) {
            value += blocks[rowOffset + column] *
              BASIS_VALUES[xBasisOffset + column] *
              yBasis;
          }
        }

        plane[(originY + localY) * planeWidth + originX + localX] =
          clampByte(0.25 * value + 128);
      }
    }
  }

  function composeRgbaPixels(jpeg, planes) {
    const output = new Uint8ClampedArray(jpeg.width * jpeg.height * 4);
    const luma = planes[0];
    const isGrayscale = jpeg.components.length === 1;
    let target = 0;

    for (let y = 0; y < jpeg.height; y += 1) {
      for (let x = 0; x < jpeg.width; x += 1) {
        const yy = sampleComponent(jpeg, luma, x, y);

        if (isGrayscale) {
          output[target] = yy;
          output[target + 1] = yy;
          output[target + 2] = yy;
          output[target + 3] = 255;
          target += 4;
          continue;
        }

        const cb = sampleComponent(jpeg, planes[1], x, y) - 128;
        const cr = sampleComponent(jpeg, planes[2], x, y) - 128;

        output[target] = clampByte(yy + 1.402 * cr);
        output[target + 1] = clampByte(yy - 0.344136286201022 * cb - 0.714136285714286 * cr);
        output[target + 2] = clampByte(yy + 1.772 * cb);
        output[target + 3] = 255;
        target += 4;
      }
    }

    return output;
  }

  function sampleComponent(jpeg, component, imageX, imageY) {
    const scaleX = component.horizontalSampling / jpeg.maxHorizontalSampling;
    const scaleY = component.verticalSampling / jpeg.maxVerticalSampling;
    const componentX = (imageX + 0.5) * scaleX - 0.5;
    const componentY = (imageY + 0.5) * scaleY - 0.5;
    let x0 = Math.floor(componentX);
    let y0 = Math.floor(componentY);
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let tx = componentX - x0;
    let ty = componentY - y0;

    x0 = clampInt(x0, 0, component.width - 1);
    y0 = clampInt(y0, 0, component.height - 1);
    x1 = clampInt(x1, 0, component.width - 1);
    y1 = clampInt(y1, 0, component.height - 1);

    if (x0 === x1) {
      tx = 0;
    }

    if (y0 === y1) {
      ty = 0;
    }

    const top = mix(
      component.plane[y0 * component.width + x0],
      component.plane[y0 * component.width + x1],
      tx
    );
    const bottom = mix(
      component.plane[y1 * component.width + x0],
      component.plane[y1 * component.width + x1],
      tx
    );

    return mix(top, bottom, ty);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function clampInt(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampByte(value) {
    const rounded = Math.floor(value + 0.5);

    if (rounded <= 0) {
      return 0;
    }

    if (rounded >= 255) {
      return 255;
    }

    return rounded;
  }

  global.JsJpegDecoder = JsJpegDecoder;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { JsJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
