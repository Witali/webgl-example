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
      const blockTemp = new Float64Array(64);
      const planes = [];

      for (let index = 0; index < jpeg.components.length; index += 1) {
        planes.push(decodeComponentPlane(jpeg.components[index], blockTemp));
      }

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

  function decodeComponentPlane(component, blockTemp) {
    const width = component.blockCountX * 8;
    const height = component.blockCountY * 8;
    const plane = new Uint8Array(width * height);
    const blocks = component.blocks;

    for (let blockY = 0; blockY < component.blockCountY; blockY += 1) {
      for (let blockX = 0; blockX < component.blockCountX; blockX += 1) {
        const blockOffset = (blockY * component.blockCountX + blockX) * 64;

        decodeBlock(blocks, blockOffset, plane, width, blockX * 8, blockY * 8, blockTemp);
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

  function decodeBlock(blocks, blockOffset, plane, planeWidth, originX, originY, blockTemp) {
    if (isDcOnly(blocks, blockOffset)) {
      fillDcBlock(blocks, blockOffset, plane, planeWidth, originX, originY);
      return;
    }

    runVerticalIdct(blocks, blockOffset, blockTemp);
    runHorizontalIdct(blockTemp, plane, planeWidth, originX, originY);
  }

  function isDcOnly(blocks, blockOffset) {
    for (let index = 1; index < 64; index += 1) {
      if (blocks[blockOffset + index] !== 0) {
        return false;
      }
    }

    return true;
  }

  function fillDcBlock(blocks, blockOffset, plane, planeWidth, originX, originY) {
    const value = clampByte(0.125 * blocks[blockOffset] + 128);
    let target = originY * planeWidth + originX;

    for (let row = 0; row < 8; row += 1) {
      plane.fill(value, target, target + 8);
      target += planeWidth;
    }
  }

  // Separable IDCT reduces each block from 64 full 2D sums to two 1D passes.
  function runVerticalIdct(blocks, blockOffset, blockTemp) {
    for (let localY = 0; localY < 8; localY += 1) {
      const yBasisOffset = localY * 8;
      const tempOffset = localY * 8;
      const b0 = BASIS_VALUES[yBasisOffset];
      const b1 = BASIS_VALUES[yBasisOffset + 1];
      const b2 = BASIS_VALUES[yBasisOffset + 2];
      const b3 = BASIS_VALUES[yBasisOffset + 3];
      const b4 = BASIS_VALUES[yBasisOffset + 4];
      const b5 = BASIS_VALUES[yBasisOffset + 5];
      const b6 = BASIS_VALUES[yBasisOffset + 6];
      const b7 = BASIS_VALUES[yBasisOffset + 7];

      for (let column = 0; column < 8; column += 1) {
        blockTemp[tempOffset + column] =
          blocks[blockOffset + column] * b0 +
          blocks[blockOffset + 8 + column] * b1 +
          blocks[blockOffset + 16 + column] * b2 +
          blocks[blockOffset + 24 + column] * b3 +
          blocks[blockOffset + 32 + column] * b4 +
          blocks[blockOffset + 40 + column] * b5 +
          blocks[blockOffset + 48 + column] * b6 +
          blocks[blockOffset + 56 + column] * b7;
      }
    }
  }

  function runHorizontalIdct(blockTemp, plane, planeWidth, originX, originY) {
    for (let localY = 0; localY < 8; localY += 1) {
      const tempOffset = localY * 8;
      const outputOffset = (originY + localY) * planeWidth + originX;
      const t0 = blockTemp[tempOffset];
      const t1 = blockTemp[tempOffset + 1];
      const t2 = blockTemp[tempOffset + 2];
      const t3 = blockTemp[tempOffset + 3];
      const t4 = blockTemp[tempOffset + 4];
      const t5 = blockTemp[tempOffset + 5];
      const t6 = blockTemp[tempOffset + 6];
      const t7 = blockTemp[tempOffset + 7];

      for (let localX = 0; localX < 8; localX += 1) {
        const xBasisOffset = localX * 8;
        const value =
          t0 * BASIS_VALUES[xBasisOffset] +
          t1 * BASIS_VALUES[xBasisOffset + 1] +
          t2 * BASIS_VALUES[xBasisOffset + 2] +
          t3 * BASIS_VALUES[xBasisOffset + 3] +
          t4 * BASIS_VALUES[xBasisOffset + 4] +
          t5 * BASIS_VALUES[xBasisOffset + 5] +
          t6 * BASIS_VALUES[xBasisOffset + 6] +
          t7 * BASIS_VALUES[xBasisOffset + 7];

        plane[outputOffset + localX] = clampByte(0.25 * value + 128);
      }
    }
  }

  function composeRgbaPixels(jpeg, planes) {
    const output = new Uint8ClampedArray(jpeg.width * jpeg.height * 4);
    const samplers = createComponentSamplers(jpeg, planes);

    if (jpeg.components.length === 1) {
      composeGrayscalePixels(jpeg, samplers[0], output);
      return output;
    }

    composeColorPixels(jpeg, samplers[0], samplers[1], samplers[2], output);
    return output;
  }

  function composeGrayscalePixels(jpeg, sampler, output) {
    const component = sampler.component;
    const plane = component.plane;
    let target = 0;

    if (sampler.direct) {
      for (let y = 0; y < jpeg.height; y += 1) {
        let source = y * component.width;

        for (let x = 0; x < jpeg.width; x += 1) {
          const gray = plane[source + x];

          output[target] = gray;
          output[target + 1] = gray;
          output[target + 2] = gray;
          output[target + 3] = 255;
          target += 4;
        }
      }

      return;
    }

    for (let y = 0; y < jpeg.height; y += 1) {
      const y0Base = sampler.y0[y] * component.width;
      const y1Base = sampler.y1[y] * component.width;
      const ty = sampler.ty[y];

      for (let x = 0; x < jpeg.width; x += 1) {
        const gray = sampleMappedComponent(sampler, plane, y0Base, y1Base, ty, x);

        output[target] = gray;
        output[target + 1] = gray;
        output[target + 2] = gray;
        output[target + 3] = 255;
        target += 4;
      }
    }
  }

  function composeColorPixels(jpeg, ySampler, cbSampler, crSampler, output) {
    const yPlane = ySampler.component.plane;
    const cbPlane = cbSampler.component.plane;
    const crPlane = crSampler.component.plane;
    const yWidth = ySampler.component.width;
    const cbWidth = cbSampler.component.width;
    const crWidth = crSampler.component.width;
    let target = 0;

    for (let y = 0; y < jpeg.height; y += 1) {
      const yDirectBase = y * yWidth;
      const y0Base = ySampler.direct ? 0 : ySampler.y0[y] * yWidth;
      const y1Base = ySampler.direct ? 0 : ySampler.y1[y] * yWidth;
      const cbDirectBase = y * cbWidth;
      const cb0Base = cbSampler.direct ? 0 : cbSampler.y0[y] * cbWidth;
      const cb1Base = cbSampler.direct ? 0 : cbSampler.y1[y] * cbWidth;
      const crDirectBase = y * crWidth;
      const cr0Base = crSampler.direct ? 0 : crSampler.y0[y] * crWidth;
      const cr1Base = crSampler.direct ? 0 : crSampler.y1[y] * crWidth;
      const yTy = ySampler.direct ? 0 : ySampler.ty[y];
      const cbTy = cbSampler.direct ? 0 : cbSampler.ty[y];
      const crTy = crSampler.direct ? 0 : crSampler.ty[y];

      for (let x = 0; x < jpeg.width; x += 1) {
        const yy = ySampler.direct
          ? yPlane[yDirectBase + x]
          : sampleMappedComponent(ySampler, yPlane, y0Base, y1Base, yTy, x);
        const cb = (cbSampler.direct
          ? cbPlane[cbDirectBase + x]
          : sampleMappedComponent(cbSampler, cbPlane, cb0Base, cb1Base, cbTy, x)) - 128;
        const cr = (crSampler.direct
          ? crPlane[crDirectBase + x]
          : sampleMappedComponent(crSampler, crPlane, cr0Base, cr1Base, crTy, x)) - 128;


        output[target] = clampByte(yy + 1.402 * cr);
        output[target + 1] = clampByte(yy - 0.344136286201022 * cb - 0.714136285714286 * cr);
        output[target + 2] = clampByte(yy + 1.772 * cb);
        output[target + 3] = 255;
        target += 4;
      }
    }
  }

  function createComponentSamplers(jpeg, planes) {
    const samplers = [];

    for (let index = 0; index < planes.length; index += 1) {
      samplers.push(createComponentSampler(jpeg, planes[index]));
    }

    return samplers;
  }

  function createComponentSampler(jpeg, component) {
    const direct =
      component.horizontalSampling === jpeg.maxHorizontalSampling &&
      component.verticalSampling === jpeg.maxVerticalSampling;

    if (direct) {
      return {
        component,
        direct: true,
        x0: null,
        x1: null,
        tx: null,
        y0: null,
        y1: null,
        ty: null,
      };
    }

    const xMap = createAxisSampleMap(
      jpeg.width,
      component.width,
      component.horizontalSampling,
      jpeg.maxHorizontalSampling
    );
    const yMap = createAxisSampleMap(
      jpeg.height,
      component.height,
      component.verticalSampling,
      jpeg.maxVerticalSampling
    );

    return {
      component,
      direct: false,
      x0: xMap.first,
      x1: xMap.second,
      tx: xMap.weight,
      y0: yMap.first,
      y1: yMap.second,
      ty: yMap.weight,
    };
  }

  function createAxisSampleMap(imageLength, componentLength, sampling, maxSampling) {
    const first = new Uint32Array(imageLength);
    const second = new Uint32Array(imageLength);
    const weight = new Float64Array(imageLength);
    const scale = sampling / maxSampling;

    for (let index = 0; index < imageLength; index += 1) {
      const componentPosition = (index + 0.5) * scale - 0.5;
      let p0 = Math.floor(componentPosition);
      let p1 = p0 + 1;
      let t = componentPosition - p0;

      p0 = clampInt(p0, 0, componentLength - 1);
      p1 = clampInt(p1, 0, componentLength - 1);

      if (p0 === p1) {
        t = 0;
      }

      first[index] = p0;
      second[index] = p1;
      weight[index] = t;
    }

    return { first, second, weight };
  }

  function sampleMappedComponent(sampler, plane, y0Base, y1Base, ty, x) {
    const x0 = sampler.x0[x];
    const x1 = sampler.x1[x];
    const tx = sampler.tx[x];
    const top0 = plane[y0Base + x0];
    const top = top0 + (plane[y0Base + x1] - top0) * tx;
    const bottom0 = plane[y1Base + x0];
    const bottom = bottom0 + (plane[y1Base + x1] - bottom0) * tx;

    return top + (bottom - top) * ty;
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
