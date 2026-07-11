(function (root, factory) {
  "use strict";

  const paletteQuantizer = typeof module === "object" && module.exports
    ? require("./palette-quantizer.js")
    : root.PaletteQuantizer;
  const api = factory(paletteQuantizer);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.RetroConverter = api;
})(typeof self !== "undefined" ? self : globalThis, function (paletteQuantizer) {
  "use strict";

  if (!paletteQuantizer) {
    throw new Error("PaletteQuantizer is required");
  }

  const ZX_WIDTH = 256;
  const ZX_HEIGHT = 192;
  const MODE_X_WIDTH = 320;
  const MODE_X_HEIGHT = 240;
  const BAYER_4X4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];
  const ZX_PALETTE = createZxPalette();

  function convertZxSpectrum(sourcePixels, width, height, options) {
    validateDimensions(sourcePixels, width, height, ZX_WIDTH, ZX_HEIGHT, "ZX Spectrum");

    const settings = options || {};
    const colorSpace = normalizeColorSpace(settings.colorSpace);
    const dithering = normalizeDithering(settings.dithering);
    const pixels = flattenTransparency(sourcePixels);
    const sourcePoints = createSourcePoints(pixels, colorSpace);
    const palettePoints = ZX_PALETTE.map((color) => toPoint(color.r, color.g, color.b, colorSpace));
    const blocks = chooseZxAttributeBlocks(sourcePoints, palettePoints);
    const inkBits = renderZxInkBits(pixels, sourcePoints, blocks, palettePoints, colorSpace, dithering);
    const outputPixels = new Uint8ClampedArray(pixels.length);
    const screen = new Uint8Array(6912);
    const paletteCounts = new Float64Array(ZX_PALETTE.length);

    for (let blockY = 0; blockY < 24; blockY += 1) {
      for (let blockX = 0; blockX < 32; blockX += 1) {
        const block = blocks[blockY * 32 + blockX];

        screen[6144 + blockY * 32 + blockX] = (
          block.bright << 6 | block.paper << 3 | block.ink
        );
      }
    }

    for (let y = 0; y < ZX_HEIGHT; y += 1) {
      for (let xByte = 0; xByte < 32; xByte += 1) {
        let bitmapByte = 0;

        for (let bit = 0; bit < 8; bit += 1) {
          const x = xByte * 8 + bit;
          const pixelIndex = y * ZX_WIDTH + x;
          const block = blocks[(y >>> 3) * 32 + xByte];
          const usesInk = inkBits[pixelIndex] !== 0;
          const paletteIndex = block.bright * 8 + (usesInk ? block.ink : block.paper);
          const color = ZX_PALETTE[paletteIndex];
          const outputIndex = pixelIndex * 4;

          if (usesInk) {
            bitmapByte |= 0x80 >>> bit;
          }

          outputPixels[outputIndex] = color.r;
          outputPixels[outputIndex + 1] = color.g;
          outputPixels[outputIndex + 2] = color.b;
          outputPixels[outputIndex + 3] = 255;
          paletteCounts[paletteIndex] += 1;
        }

        screen[zxBitmapOffset(xByte, y)] = bitmapByte;
      }
    }

    return {
      mode: "zx-spectrum",
      width,
      height,
      pixels: outputPixels,
      palette: createUsedPalette(ZX_PALETTE, paletteCounts),
      screen,
      colorSpace,
      dithering,
      binaryDescription: "ZX Spectrum .scr: 6144 bitmap bytes + 768 attribute bytes",
    };
  }

  function convertModeX(sourcePixels, width, height, options) {
    validateDimensions(sourcePixels, width, height, MODE_X_WIDTH, MODE_X_HEIGHT, "Mode X");

    const settings = options || {};
    const colorSpace = normalizeColorSpace(settings.colorSpace);
    const dithering = normalizeDithering(settings.dithering);
    const colorCount = Math.max(2, Math.min(256, Math.round(settings.colorCount || 256)));
    const pixels = flattenTransparency(sourcePixels);
    const quantized = paletteQuantizer.quantizeImage(
      pixels,
      width,
      height,
      colorCount,
      { colorSpace, dithering, maxIterations: settings.maxIterations || 16 }
    );
    const colorToIndex = new Map();

    quantized.palette.forEach((color, index) => {
      colorToIndex.set(colorKey(color.r, color.g, color.b), index);
    });

    const indexedPixels = new Uint8Array(width * height);

    for (let pixelIndex = 0; pixelIndex < indexedPixels.length; pixelIndex += 1) {
      const sourceIndex = pixelIndex * 4;
      const key = colorKey(
        quantized.pixels[sourceIndex],
        quantized.pixels[sourceIndex + 1],
        quantized.pixels[sourceIndex + 2]
      );

      indexedPixels[pixelIndex] = colorToIndex.get(key);
    }

    const planeSize = width / 4 * height;
    const planar = new Uint8Array(planeSize * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const plane = x & 3;
        const planeOffset = y * (width / 4) + (x >>> 2);

        planar[plane * planeSize + planeOffset] = indexedPixels[y * width + x];
      }
    }

    const palette6Bit = new Uint8Array(256 * 3);

    quantized.palette.forEach((color, index) => {
      palette6Bit[index * 3] = Math.round(color.r * 63 / 255);
      palette6Bit[index * 3 + 1] = Math.round(color.g * 63 / 255);
      palette6Bit[index * 3 + 2] = Math.round(color.b * 63 / 255);
    });

    return {
      mode: "mode-x",
      width,
      height,
      pixels: quantized.pixels,
      palette: quantized.palette,
      indexedPixels,
      planar,
      palette6Bit,
      colorSpace,
      dithering,
      binaryDescription: "Mode X raw planes: plane 0, 1, 2, 3; 19200 bytes each",
    };
  }

  function chooseZxAttributeBlocks(sourcePoints, palettePoints) {
    const blocks = new Array(32 * 24);

    for (let blockY = 0; blockY < 24; blockY += 1) {
      for (let blockX = 0; blockX < 32; blockX += 1) {
        let best = null;
        let bestError = Infinity;

        for (let bright = 0; bright <= 1; bright += 1) {
          for (let paper = 0; paper < 8; paper += 1) {
            for (let ink = paper; ink < 8; ink += 1) {
              const paperPoint = palettePoints[bright * 8 + paper];
              const inkPoint = palettePoints[bright * 8 + ink];
              let error = 0;

              for (let localY = 0; localY < 8 && error < bestError; localY += 1) {
                const y = blockY * 8 + localY;

                for (let localX = 0; localX < 8; localX += 1) {
                  const x = blockX * 8 + localX;
                  const point = sourcePoints[y * ZX_WIDTH + x];

                  error += Math.min(squaredDistance(point, paperPoint), squaredDistance(point, inkPoint));
                }
              }

              if (error < bestError) {
                bestError = error;
                best = { bright, paper, ink };
              }
            }
          }
        }

        blocks[blockY * 32 + blockX] = best;
      }
    }

    return blocks;
  }

  function renderZxInkBits(pixels, sourcePoints, blocks, palettePoints, colorSpace, dithering) {
    const inkBits = new Uint8Array(ZX_WIDTH * ZX_HEIGHT);
    const currentErrors = new Float32Array((ZX_WIDTH + 2) * 3);
    const nextErrors = new Float32Array((ZX_WIDTH + 2) * 3);
    let current = currentErrors;
    let next = nextErrors;

    for (let y = 0; y < ZX_HEIGHT; y += 1) {
      for (let x = 0; x < ZX_WIDTH; x += 1) {
        const pixelIndex = y * ZX_WIDTH + x;
        const rgbaIndex = pixelIndex * 4;
        const block = blocks[(y >>> 3) * 32 + (x >>> 3)];
        const paperIndex = block.bright * 8 + block.paper;
        const inkIndex = block.bright * 8 + block.ink;
        let red = pixels[rgbaIndex];
        let green = pixels[rgbaIndex + 1];
        let blue = pixels[rgbaIndex + 2];

        if (dithering === "pattern") {
          const threshold = ((BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 48;

          red += threshold;
          green += threshold;
          blue += threshold;
        } else if (dithering === "floyd-steinberg") {
          const errorIndex = (x + 1) * 3;

          red = clampByte(red + current[errorIndex]);
          green = clampByte(green + current[errorIndex + 1]);
          blue = clampByte(blue + current[errorIndex + 2]);
        }

        const point = dithering === "none"
          ? sourcePoints[pixelIndex]
          : toPoint(red, green, blue, colorSpace);
        const usesInk = squaredDistance(point, palettePoints[inkIndex]) <
          squaredDistance(point, palettePoints[paperIndex]);

        inkBits[pixelIndex] = usesInk ? 1 : 0;

        if (dithering === "floyd-steinberg") {
          const errorIndex = (x + 1) * 3;
          const color = ZX_PALETTE[usesInk ? inkIndex : paperIndex];

          diffuseError(red - color.r, 0, errorIndex, current, next);
          diffuseError(green - color.g, 1, errorIndex, current, next);
          diffuseError(blue - color.b, 2, errorIndex, current, next);
        }
      }

      if (dithering === "floyd-steinberg") {
        const previous = current;

        current = next;
        next = previous;
        next.fill(0);
      }
    }

    return inkBits;
  }

  function diffuseError(error, channel, errorIndex, current, next) {
    current[errorIndex + 3 + channel] += error * 7 / 16;
    next[errorIndex - 3 + channel] += error * 3 / 16;
    next[errorIndex + channel] += error * 5 / 16;
    next[errorIndex + 3 + channel] += error / 16;
  }

  function createSourcePoints(pixels, colorSpace) {
    const points = new Array(pixels.length / 4);

    for (let index = 0; index < points.length; index += 1) {
      const pixelIndex = index * 4;

      points[index] = toPoint(
        pixels[pixelIndex],
        pixels[pixelIndex + 1],
        pixels[pixelIndex + 2],
        colorSpace
      );
    }

    return points;
  }

  function flattenTransparency(sourcePixels) {
    const output = new Uint8ClampedArray(sourcePixels.length);

    for (let index = 0; index < sourcePixels.length; index += 4) {
      const alpha = sourcePixels[index + 3] / 255;

      output[index] = Math.round(sourcePixels[index] * alpha);
      output[index + 1] = Math.round(sourcePixels[index + 1] * alpha);
      output[index + 2] = Math.round(sourcePixels[index + 2] * alpha);
      output[index + 3] = 255;
    }

    return output;
  }

  function createUsedPalette(colors, counts) {
    const usedByColor = new Map();

    colors.forEach((color, index) => {
      if (counts[index] === 0) {
        return;
      }

      const key = colorKey(color.r, color.g, color.b);
      const existing = usedByColor.get(key);

      if (existing) {
        existing.count += counts[index];
      } else {
        usedByColor.set(key, {
          r: color.r,
          g: color.g,
          b: color.b,
          hex: color.hex,
          count: counts[index],
        });
      }
    });

    return Array.from(usedByColor.values());
  }

  function createZxPalette() {
    const normal = 205;
    const bright = 255;
    const colors = [];

    for (let intensityIndex = 0; intensityIndex < 2; intensityIndex += 1) {
      const intensity = intensityIndex === 0 ? normal : bright;

      for (let index = 0; index < 8; index += 1) {
        const red = index & 2 ? intensity : 0;
        const green = index & 4 ? intensity : 0;
        const blue = index & 1 ? intensity : 0;

        colors.push({
          r: red,
          g: green,
          b: blue,
          hex: rgbToHex(red, green, blue),
        });
      }
    }

    return colors;
  }

  function zxBitmapOffset(xByte, y) {
    return ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | xByte;
  }

  function toPoint(red, green, blue, colorSpace) {
    return colorSpace === "oklab"
      ? paletteQuantizer.srgbToOklab(red, green, blue)
      : [red, green, blue];
  }

  function squaredDistance(left, right) {
    const first = left[0] - right[0];
    const second = left[1] - right[1];
    const third = left[2] - right[2];

    return first * first + second * second + third * third;
  }

  function normalizeColorSpace(value) {
    if (value !== undefined && value !== "oklab" && value !== "rgb") {
      throw new RangeError(`Unsupported color space: ${value}`);
    }

    return value || "oklab";
  }

  function normalizeDithering(value) {
    if (value !== undefined && !["none", "pattern", "floyd-steinberg"].includes(value)) {
      throw new RangeError(`Unsupported dithering mode: ${value}`);
    }

    return value || "none";
  }

  function validateDimensions(pixels, width, height, expectedWidth, expectedHeight, name) {
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
      throw new TypeError("sourcePixels must be a Uint8Array or Uint8ClampedArray");
    }

    if (width !== expectedWidth || height !== expectedHeight) {
      throw new RangeError(`${name} input must be ${expectedWidth}x${expectedHeight}`);
    }

    if (pixels.length !== width * height * 4) {
      throw new RangeError("sourcePixels length does not match width and height");
    }
  }

  function colorKey(red, green, blue) {
    return (red << 16) | (green << 8) | blue;
  }

  function rgbToHex(red, green, blue) {
    return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  return {
    convertZxSpectrum,
    convertModeX,
    zxBitmapOffset,
    profiles: {
      "zx-spectrum": { width: ZX_WIDTH, height: ZX_HEIGHT },
      "mode-x": { width: MODE_X_WIDTH, height: MODE_X_HEIGHT },
    },
  };
});
