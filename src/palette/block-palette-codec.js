(function (root, factory) {
  "use strict";

  const paletteQuantizer = typeof module === "object" && module.exports
    ? require("./palette-quantizer.js")
    : root.PaletteQuantizer;
  const api = factory(paletteQuantizer);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BlockPaletteCodec = api;
})(typeof self !== "undefined" ? self : globalThis, function (paletteQuantizer) {
  "use strict";

  const MAX_PALETTE_SAMPLE_PIXELS = 32768;

  function compressImage(sourcePixels, width, height, settings) {
    const options = settings || {};
    const blockSize = Number(options.blockSize || 8);
    const localColorCount = Number(options.localColorCount || 4);
    const globalColorCount = Number(options.globalColorCount || 256);
    const colorSpace = options.colorSpace || "oklab";

    validateInput(
      sourcePixels,
      width,
      height,
      blockSize,
      localColorCount,
      globalColorCount,
      colorSpace
    );

    const sample = samplePixels(sourcePixels, MAX_PALETTE_SAMPLE_PIXELS);
    const quantizedSample = paletteQuantizer.quantizeImage(
      sample,
      sample.length / 4,
      1,
      globalColorCount,
      { colorSpace, dithering: "none", maxIterations: 16 }
    );
    const activePalette = quantizedSample.palette.length > 0
      ? quantizedSample.palette.map(copyPaletteColor)
      : [{ r: 0, g: 0, b: 0, hex: "#000000", count: 0 }];
    const palette = padPalette(activePalette, globalColorCount);
    const palettePoints = activePalette.map((color) => colorPoint(color.r, color.g, color.b, colorSpace));
    const sourcePointByColor = new Map();
    const globalIndexByColor = new Map();
    const globalAssignments = new Uint16Array(width * height);
    const globalUsage = new Uint32Array(globalColorCount);

    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;

      if (sourcePixels[offset + 3] === 0) {
        continue;
      }

      const key = colorKey(sourcePixels[offset], sourcePixels[offset + 1], sourcePixels[offset + 2]);
      let globalIndex = globalIndexByColor.get(key);

      if (globalIndex === undefined) {
        const point = colorPoint(sourcePixels[offset], sourcePixels[offset + 1], sourcePixels[offset + 2], colorSpace);

        sourcePointByColor.set(key, point);
        globalIndex = nearestPointIndex(point, palettePoints);
        globalIndexByColor.set(key, globalIndex);
      }

      globalAssignments[pixel] = globalIndex;
      globalUsage[globalIndex] += 1;
    }

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const blockCount = blocksX * blocksY;
    const blockPaletteIndices = new Uint16Array(blockCount * localColorCount);
    const pixelIndices = new Uint8Array(width * height);
    const outputPixels = new Uint8ClampedArray(sourcePixels.length);
    const resultUsage = new Uint32Array(globalColorCount);

    for (let blockY = 0; blockY < blocksY; blockY += 1) {
      for (let blockX = 0; blockX < blocksX; blockX += 1) {
        const blockIndex = blockY * blocksX + blockX;
        const selected = selectBlockPalette(
          globalAssignments,
          sourcePixels,
          width,
          height,
          blockX,
          blockY,
          blockSize,
          localColorCount,
          activePalette.length
        );

        for (let localIndex = 0; localIndex < localColorCount; localIndex += 1) {
          blockPaletteIndices[blockIndex * localColorCount + localIndex] = selected[localIndex];
        }

        encodeBlock(
          sourcePixels,
          outputPixels,
          pixelIndices,
          resultUsage,
          width,
          height,
          blockX,
          blockY,
          blockSize,
          selected,
          palette,
          palettePoints,
          colorSpace,
          sourcePointByColor
        );
      }
    }

    palette.forEach((color, index) => {
      color.count = resultUsage[index];
      color.active = index < activePalette.length;
    });

    const globalIndexBits = Math.log2(globalColorCount);
    const localIndexBits = Math.log2(localColorCount);
    const globalPaletteBytes = globalColorCount * 3;
    const blockPaletteBytes = Math.ceil(blockCount * localColorCount * globalIndexBits / 8);
    const pixelDataBytes = Math.ceil(width * height * localIndexBits / 8);
    const totalBytes = globalPaletteBytes + blockPaletteBytes + pixelDataBytes;
    const rawRgbBytes = width * height * 3;

    return {
      width,
      height,
      pixels: outputPixels,
      palette,
      blockPaletteIndices,
      pixelIndices,
      blockSize,
      blocksX,
      blocksY,
      blockCount,
      localColorCount,
      globalColorCount,
      activeGlobalColorCount: activePalette.length,
      globalIndexBits,
      localIndexBits,
      uniqueColorCount: globalIndexByColor.size,
      resultColorCount: countNonZero(resultUsage),
      meanSquaredError: meanSquaredError(sourcePixels, outputPixels),
      colorSpace,
      iterations: quantizedSample.iterations,
      storage: {
        globalPaletteBytes,
        blockPaletteBytes,
        pixelDataBytes,
        totalBytes,
        rawRgbBytes,
        bitsPerPixel: totalBytes * 8 / (width * height),
        compressionRatio: rawRgbBytes / totalBytes,
      },
    };
  }

  function selectBlockPalette(
    globalAssignments,
    sourcePixels,
    width,
    height,
    blockX,
    blockY,
    blockSize,
    localColorCount,
    activeColorCount
  ) {
    const counts = new Uint32Array(activeColorCount);
    const startX = blockX * blockSize;
    const startY = blockY * blockSize;
    const endX = Math.min(width, startX + blockSize);
    const endY = Math.min(height, startY + blockSize);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;

        if (sourcePixels[pixel * 4 + 3] !== 0) {
          counts[globalAssignments[pixel]] += 1;
        }
      }
    }

    const candidates = Array.from({ length: activeColorCount }, (_, index) => index);

    candidates.sort((left, right) => counts[right] - counts[left] || left - right);

    const selected = candidates.slice(0, Math.min(localColorCount, activeColorCount));

    while (selected.length < localColorCount) {
      selected.push(selected[0] || 0);
    }

    return selected;
  }

  function encodeBlock(
    sourcePixels,
    outputPixels,
    pixelIndices,
    resultUsage,
    width,
    height,
    blockX,
    blockY,
    blockSize,
    selected,
    palette,
    palettePoints,
    colorSpace,
    sourcePointByColor
  ) {
    const startX = blockX * blockSize;
    const startY = blockY * blockSize;
    const endX = Math.min(width, startX + blockSize);
    const endY = Math.min(height, startY + blockSize);
    const localPoints = selected.map((globalIndex) => palettePoints[globalIndex]);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const key = colorKey(sourcePixels[offset], sourcePixels[offset + 1], sourcePixels[offset + 2]);
        let point = sourcePointByColor.get(key);

        if (!point) {
          point = colorPoint(sourcePixels[offset], sourcePixels[offset + 1], sourcePixels[offset + 2], colorSpace);
          sourcePointByColor.set(key, point);
        }

        const localIndex = nearestPointIndex(point, localPoints);
        const globalIndex = selected[localIndex];
        const color = palette[globalIndex];

        pixelIndices[pixel] = localIndex;
        outputPixels[offset] = color.r;
        outputPixels[offset + 1] = color.g;
        outputPixels[offset + 2] = color.b;
        outputPixels[offset + 3] = sourcePixels[offset + 3];

        if (sourcePixels[offset + 3] !== 0) {
          resultUsage[globalIndex] += 1;
        }
      }
    }
  }

  function samplePixels(sourcePixels, maximumPixels) {
    const pixelCount = sourcePixels.length / 4;
    const step = Math.max(1, Math.ceil(pixelCount / maximumPixels));
    const sampleCount = Math.ceil(pixelCount / step);
    const sample = new Uint8ClampedArray(sampleCount * 4);
    let target = 0;

    for (let sourcePixel = 0; sourcePixel < pixelCount; sourcePixel += step) {
      const sourceOffset = sourcePixel * 4;

      sample[target] = sourcePixels[sourceOffset];
      sample[target + 1] = sourcePixels[sourceOffset + 1];
      sample[target + 2] = sourcePixels[sourceOffset + 2];
      sample[target + 3] = sourcePixels[sourceOffset + 3];
      target += 4;
    }

    return target === sample.length ? sample : sample.slice(0, target);
  }

  function padPalette(activePalette, requestedCount) {
    const palette = activePalette.map(copyPaletteColor);

    while (palette.length < requestedCount) {
      palette.push({ r: 0, g: 0, b: 0, hex: "#000000", count: 0 });
    }

    return palette;
  }

  function copyPaletteColor(color) {
    return { r: color.r, g: color.g, b: color.b, hex: color.hex, count: color.count || 0 };
  }

  function colorPoint(red, green, blue, colorSpace) {
    return colorSpace === "oklab"
      ? paletteQuantizer.srgbToOklab(red, green, blue)
      : [red, green, blue];
  }

  function nearestPointIndex(point, candidates) {
    let bestIndex = 0;
    let bestDistance = squaredDistance(point, candidates[0]);

    for (let index = 1; index < candidates.length; index += 1) {
      const distance = squaredDistance(point, candidates[index]);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function squaredDistance(left, right) {
    const first = left[0] - right[0];
    const second = left[1] - right[1];
    const third = left[2] - right[2];

    return first * first + second * second + third * third;
  }

  function meanSquaredError(source, output) {
    let error = 0;
    let channelCount = 0;

    for (let offset = 0; offset < source.length; offset += 4) {
      if (source[offset + 3] === 0) {
        continue;
      }

      for (let channel = 0; channel < 3; channel += 1) {
        const difference = source[offset + channel] - output[offset + channel];

        error += difference * difference;
        channelCount += 1;
      }
    }

    return channelCount === 0 ? 0 : error / channelCount;
  }

  function countNonZero(values) {
    let count = 0;

    for (const value of values) {
      count += value > 0 ? 1 : 0;
    }

    return count;
  }

  function colorKey(red, green, blue) {
    return (red << 16) | (green << 8) | blue;
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  function validateInput(
    pixels,
    width,
    height,
    blockSize,
    localColorCount,
    globalColorCount,
    colorSpace
  ) {
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
      throw new TypeError("sourcePixels must be a Uint8Array or Uint8ClampedArray");
    }

    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("width and height must be positive integers");
    }

    if (pixels.length !== width * height * 4) {
      throw new RangeError("sourcePixels length does not match width and height");
    }

    if (!isPowerOfTwo(blockSize) || blockSize < 2 || blockSize > 64) {
      throw new RangeError("blockSize must be a power of two from 2 to 64");
    }

    if (!isPowerOfTwo(globalColorCount) || globalColorCount < 2 || globalColorCount > 256) {
      throw new RangeError("globalColorCount must be a power of two from 2 to 256");
    }

    if (!isPowerOfTwo(localColorCount) || localColorCount < 2 || localColorCount > globalColorCount) {
      throw new RangeError("localColorCount must be a power of two not greater than globalColorCount");
    }

    if (localColorCount > blockSize * blockSize) {
      throw new RangeError("localColorCount cannot exceed the number of pixels in a block");
    }

    if (colorSpace !== "oklab" && colorSpace !== "rgb") {
      throw new RangeError(`Unsupported color space: ${colorSpace}`);
    }
  }

  return { compressImage };
});
