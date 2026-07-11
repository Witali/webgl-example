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
  const DITHERING_MODES = new Set(["none", "pattern-2x2", "pattern", "floyd-steinberg"]);
  const BAYER_2X2 = [
    0, 2,
    3, 1,
  ];
  const BAYER_4X4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];
  const PATTERN_STRENGTH = 48;

  function compressImage(sourcePixels, width, height, settings) {
    const options = settings || {};
    const blockSize = Number(options.blockSize || 8);
    const localColorCount = Number(options.localColorCount || 4);
    const globalColorCount = Number(options.globalColorCount || 256);
    const paletteColorBits = Number(options.paletteColorBits || 24);
    const colorSpace = options.colorSpace || "oklab";
    const dithering = options.dithering || "none";
    const diversity = options.diversity === undefined ? 0 : Number(options.diversity);
    const accelerator = options.accelerator || null;

    validateInput(
      sourcePixels,
      width,
      height,
      blockSize,
      localColorCount,
      globalColorCount,
      paletteColorBits,
      colorSpace,
      dithering,
      diversity
    );

    const sample = samplePixels(sourcePixels, MAX_PALETTE_SAMPLE_PIXELS);
    const quantizedSample = paletteQuantizer.quantizeImage(
      sample,
      sample.length / 4,
      1,
      globalColorCount,
      { colorSpace, dithering: "none", diversity, maxIterations: 16 }
    );
    const activePalette = quantizedSample.palette.length > 0
      ? quantizedSample.palette.map((color) => applyPaletteColorDepth(color, paletteColorBits))
      : [{ r: 0, g: 0, b: 0, hex: "#000000", count: 0 }];
    const palette = padPalette(activePalette, globalColorCount);
    const palettePoints = activePalette.map((color) => colorPoint(color.r, color.g, color.b, colorSpace));
    const paletteDistances = createPaletteDistanceMatrix(palettePoints);
    const sourcePointByColor = new Map();
    const globalIndexByColor = new Map();
    let globalAssignments;
    let uniqueColorCount;

    if (accelerator && typeof accelerator.mapGlobalAssignments === "function") {
      globalAssignments = accelerator.mapGlobalAssignments({
        sourcePixels,
        width,
        height,
        palette: activePalette,
        colorSpace,
      });

      if (!(globalAssignments instanceof Uint16Array) || globalAssignments.length !== width * height) {
        throw new TypeError("Accelerated global assignments have an invalid format");
      }

      const uniqueColors = new Set();

      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const offset = pixel * 4;

        if (sourcePixels[offset + 3] === 0) {
          continue;
        }

        if (globalAssignments[pixel] >= activePalette.length) {
          throw new RangeError("Accelerated global assignment is outside the active palette");
        }

        uniqueColors.add(colorKey(
          sourcePixels[offset],
          sourcePixels[offset + 1],
          sourcePixels[offset + 2]
        ));
      }

      uniqueColorCount = uniqueColors.size;
    } else {
      globalAssignments = new Uint16Array(width * height);

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
      }

      uniqueColorCount = globalIndexByColor.size;
    }

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const blockCount = blocksX * blocksY;
    const blockPaletteIndices = new Uint16Array(blockCount * localColorCount);
    let pixelIndices = new Uint8Array(width * height);
    let outputPixels = new Uint8ClampedArray(sourcePixels.length);
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
          activePalette.length,
          paletteDistances
        );

        for (let localIndex = 0; localIndex < localColorCount; localIndex += 1) {
          blockPaletteIndices[blockIndex * localColorCount + localIndex] = selected[localIndex];
        }

      }
    }

    if (
      dithering !== "floyd-steinberg" &&
      accelerator &&
      typeof accelerator.encodeBlocks === "function"
    ) {
      const encoded = accelerator.encodeBlocks({
        sourcePixels,
        width,
        height,
        blockSize,
        blocksX,
        blocksY,
        localColorCount,
        blockPaletteIndices,
        palette,
        colorSpace,
        dithering,
      });

      if (
        !encoded ||
        !(encoded.pixels instanceof Uint8ClampedArray) ||
        encoded.pixels.length !== sourcePixels.length ||
        !(encoded.pixelIndices instanceof Uint8Array) ||
        encoded.pixelIndices.length !== width * height
      ) {
        throw new TypeError("Accelerated block encoding has an invalid format");
      }

      outputPixels = encoded.pixels;
      pixelIndices = encoded.pixelIndices;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = y * width + x;
          const offset = pixel * 4;

          if (sourcePixels[offset + 3] === 0) {
            continue;
          }

          const localIndex = pixelIndices[pixel];

          if (localIndex >= localColorCount) {
            throw new RangeError("Accelerated local index is outside the block palette");
          }

          const blockIndex = Math.floor(y / blockSize) * blocksX + Math.floor(x / blockSize);
          const globalIndex = blockPaletteIndices[blockIndex * localColorCount + localIndex];

          resultUsage[globalIndex] += 1;
        }
      }
    } else if (dithering === "floyd-steinberg") {
      applyBlockFloydSteinbergDithering(
        sourcePixels,
        outputPixels,
        pixelIndices,
        resultUsage,
        width,
        height,
        blockSize,
        blocksX,
        localColorCount,
        blockPaletteIndices,
        palette,
        palettePoints,
        colorSpace
      );
    } else {
      for (let blockY = 0; blockY < blocksY; blockY += 1) {
        for (let blockX = 0; blockX < blocksX; blockX += 1) {
          const blockIndex = blockY * blocksX + blockX;
          const paletteOffset = blockIndex * localColorCount;
          const selected = Array.from(
            blockPaletteIndices.slice(paletteOffset, paletteOffset + localColorCount)
          );

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
            sourcePointByColor,
            dithering
          );
        }
      }
    }

    palette.forEach((color, index) => {
      color.count = resultUsage[index];
      color.active = index < activePalette.length;
    });

    const globalIndexBits = Math.log2(globalColorCount);
    const localIndexBits = Math.log2(localColorCount);
    const globalPaletteBits = globalColorCount * paletteColorBits;
    const blockPaletteBits = blockCount * localColorCount * globalIndexBits;
    const pixelDataBits = width * height * localIndexBits;
    const payloadBits = globalPaletteBits + blockPaletteBits + pixelDataBits;
    const globalPaletteBytes = Math.ceil(globalPaletteBits / 8);
    const blockPaletteBytes = Math.ceil(blockPaletteBits / 8);
    const pixelDataBytes = Math.ceil(pixelDataBits / 8);
    const totalBytes = Math.ceil(payloadBits / 8);
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
      paletteColorBits,
      activeGlobalColorCount: activePalette.length,
      globalIndexBits,
      localIndexBits,
      uniqueColorCount,
      resultColorCount: countNonZero(resultUsage),
      meanSquaredError: meanSquaredError(sourcePixels, outputPixels),
      colorSpace,
      dithering,
      diversity,
      iterations: quantizedSample.iterations,
      storage: {
        globalPaletteBits,
        blockPaletteBits,
        pixelDataBits,
        payloadBits,
        globalPaletteBytes,
        blockPaletteBytes,
        pixelDataBytes,
        totalBytes,
        rawRgbBytes,
        bitsPerPixel: payloadBits / (width * height),
        compressionRatio: rawRgbBytes * 8 / payloadBits,
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
    activeColorCount,
    paletteDistances
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

    const candidates = [];

    for (let index = 0; index < activeColorCount; index += 1) {
      if (counts[index] > 0) {
        candidates.push(index);
      }
    }

    if (candidates.length === 0) {
      candidates.push(0);
    }

    candidates.sort((left, right) => counts[right] - counts[left] || left - right);

    const selected = candidates.length <= localColorCount
      ? candidates.slice()
      : selectMinimumErrorColors(
        candidates,
        counts,
        localColorCount,
        activeColorCount,
        paletteDistances
      );

    while (selected.length < localColorCount) {
      selected.push(selected[0] || 0);
    }

    return refineSelectedColors(
      selected,
      candidates,
      counts,
      activeColorCount,
      paletteDistances
    );
  }

  function refineSelectedColors(
    selected,
    candidates,
    counts,
    activeColorCount,
    paletteDistances
  ) {
    const isSelected = new Uint8Array(activeColorCount);
    let bestError = calculateSelectionError(
      selected,
      candidates,
      counts,
      activeColorCount,
      paletteDistances
    );
    let bestSlot = -1;
    let bestReplacement = -1;

    for (const color of selected) {
      isSelected[color] = 1;
    }

    for (let slot = 0; slot < selected.length; slot += 1) {
      const nearestWithoutSlot = new Float64Array(candidates.length);

      nearestWithoutSlot.fill(Infinity);

      for (let sourcePosition = 0; sourcePosition < candidates.length; sourcePosition += 1) {
        const sourceColor = candidates[sourcePosition];

        for (let selectedSlot = 0; selectedSlot < selected.length; selectedSlot += 1) {
          if (selectedSlot === slot) {
            continue;
          }

          const distance = paletteDistances[
            sourceColor * activeColorCount + selected[selectedSlot]
          ];

          nearestWithoutSlot[sourcePosition] = Math.min(
            nearestWithoutSlot[sourcePosition],
            distance
          );
        }
      }

      for (const replacement of candidates) {
        if (isSelected[replacement]) {
          continue;
        }

        let error = 0;

        for (let sourcePosition = 0; sourcePosition < candidates.length; sourcePosition += 1) {
          const sourceColor = candidates[sourcePosition];
          const replacementDistance = paletteDistances[
            sourceColor * activeColorCount + replacement
          ];

          error += counts[sourceColor] * Math.min(
            nearestWithoutSlot[sourcePosition],
            replacementDistance
          );
        }

        if (error < bestError) {
          bestError = error;
          bestSlot = slot;
          bestReplacement = replacement;
        }
      }
    }

    if (bestSlot >= 0) {
      selected[bestSlot] = bestReplacement;
    }

    return selected;
  }

  function calculateSelectionError(
    selected,
    candidates,
    counts,
    activeColorCount,
    paletteDistances
  ) {
    let error = 0;

    for (const sourceColor of candidates) {
      let nearestDistance = Infinity;

      for (const selectedColor of selected) {
        nearestDistance = Math.min(
          nearestDistance,
          paletteDistances[sourceColor * activeColorCount + selectedColor]
        );
      }

      error += counts[sourceColor] * nearestDistance;
    }

    return error;
  }

  function selectMinimumErrorColors(
    candidates,
    counts,
    localColorCount,
    activeColorCount,
    paletteDistances
  ) {
    const selected = [];
    const isSelected = new Uint8Array(activeColorCount);
    const nearestDistances = new Float64Array(candidates.length);

    nearestDistances.fill(Infinity);

    while (selected.length < localColorCount) {
      let bestCandidate = -1;
      let bestError = Infinity;

      for (const candidate of candidates) {
        if (isSelected[candidate]) {
          continue;
        }

        let error = 0;

        for (let sourcePosition = 0; sourcePosition < candidates.length; sourcePosition += 1) {
          const sourceColor = candidates[sourcePosition];
          const candidateDistance = paletteDistances[sourceColor * activeColorCount + candidate];

          error += counts[sourceColor] * Math.min(
            nearestDistances[sourcePosition],
            candidateDistance
          );
        }

        if (
          error < bestError ||
          (error === bestError && (
            bestCandidate < 0 ||
            counts[candidate] > counts[bestCandidate] ||
            (counts[candidate] === counts[bestCandidate] && candidate < bestCandidate)
          ))
        ) {
          bestCandidate = candidate;
          bestError = error;
        }
      }

      selected.push(bestCandidate);
      isSelected[bestCandidate] = 1;

      for (let sourcePosition = 0; sourcePosition < candidates.length; sourcePosition += 1) {
        const sourceColor = candidates[sourcePosition];
        const distance = paletteDistances[sourceColor * activeColorCount + bestCandidate];

        nearestDistances[sourcePosition] = Math.min(nearestDistances[sourcePosition], distance);
      }
    }

    return selected;
  }

  function createPaletteDistanceMatrix(palettePoints) {
    const colorCount = palettePoints.length;
    const distances = new Float64Array(colorCount * colorCount);

    for (let left = 0; left < colorCount; left += 1) {
      for (let right = left + 1; right < colorCount; right += 1) {
        const distance = squaredDistance(palettePoints[left], palettePoints[right]);

        distances[left * colorCount + right] = distance;
        distances[right * colorCount + left] = distance;
      }
    }

    return distances;
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
    sourcePointByColor,
    dithering
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
        let point;

        if (dithering === "pattern-2x2" || dithering === "pattern") {
          const threshold = getPatternThreshold(x, y, dithering);

          point = colorPoint(
            sourcePixels[offset] + threshold,
            sourcePixels[offset + 1] + threshold,
            sourcePixels[offset + 2] + threshold,
            colorSpace
          );
        } else {
          point = sourcePointByColor.get(key);

          if (!point) {
            point = colorPoint(
              sourcePixels[offset],
              sourcePixels[offset + 1],
              sourcePixels[offset + 2],
              colorSpace
            );
            sourcePointByColor.set(key, point);
          }
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

  function applyBlockFloydSteinbergDithering(
    sourcePixels,
    outputPixels,
    pixelIndices,
    resultUsage,
    width,
    height,
    blockSize,
    blocksX,
    localColorCount,
    blockPaletteIndices,
    palette,
    palettePoints,
    colorSpace
  ) {
    const rowLength = (blockSize + 2) * 3;
    let currentErrors = new Float32Array(rowLength);
    let nextErrors = new Float32Array(rowLength);

    for (let startY = 0; startY < height; startY += blockSize) {
      const endY = Math.min(height, startY + blockSize);
      const blockY = Math.floor(startY / blockSize);

      for (let startX = 0; startX < width; startX += blockSize) {
        const endX = Math.min(width, startX + blockSize);
        const blockX = Math.floor(startX / blockSize);
        const paletteOffset = (blockY * blocksX + blockX) * localColorCount;

        currentErrors.fill(0);
        nextErrors.fill(0);

        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const pixel = y * width + x;
            const offset = pixel * 4;
            const alpha = sourcePixels[offset + 3];
            const errorOffset = (x - startX + 1) * 3;

            if (alpha === 0) {
              outputPixels[offset] = sourcePixels[offset];
              outputPixels[offset + 1] = sourcePixels[offset + 1];
              outputPixels[offset + 2] = sourcePixels[offset + 2];
              outputPixels[offset + 3] = 0;
              continue;
            }

            const correctedRed = clampByte(sourcePixels[offset] + currentErrors[errorOffset]);
            const correctedGreen = clampByte(sourcePixels[offset + 1] + currentErrors[errorOffset + 1]);
            const correctedBlue = clampByte(sourcePixels[offset + 2] + currentErrors[errorOffset + 2]);
            const point = colorPoint(correctedRed, correctedGreen, correctedBlue, colorSpace);
            const localIndex = nearestBlockPaletteIndex(
              point,
              paletteOffset,
              localColorCount,
              blockPaletteIndices,
              palettePoints
            );
            const globalIndex = blockPaletteIndices[paletteOffset + localIndex];
            const color = palette[globalIndex];

            pixelIndices[pixel] = localIndex;
            outputPixels[offset] = color.r;
            outputPixels[offset + 1] = color.g;
            outputPixels[offset + 2] = color.b;
            outputPixels[offset + 3] = alpha;
            resultUsage[globalIndex] += 1;

            diffuseError(correctedRed - color.r, 0, errorOffset, currentErrors, nextErrors);
            diffuseError(correctedGreen - color.g, 1, errorOffset, currentErrors, nextErrors);
            diffuseError(correctedBlue - color.b, 2, errorOffset, currentErrors, nextErrors);
          }

          const previousErrors = currentErrors;

          currentErrors = nextErrors;
          nextErrors = previousErrors;
          nextErrors.fill(0);
        }
      }
    }
  }

  function nearestBlockPaletteIndex(
    point,
    paletteOffset,
    localColorCount,
    blockPaletteIndices,
    palettePoints
  ) {
    let bestLocalIndex = 0;
    let bestDistance = squaredDistance(
      point,
      palettePoints[blockPaletteIndices[paletteOffset]]
    );

    for (let localIndex = 1; localIndex < localColorCount; localIndex += 1) {
      const distance = squaredDistance(
        point,
        palettePoints[blockPaletteIndices[paletteOffset + localIndex]]
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestLocalIndex = localIndex;
      }
    }

    return bestLocalIndex;
  }

  function diffuseError(error, channel, errorOffset, currentErrors, nextErrors) {
    currentErrors[errorOffset + 3 + channel] += error * 7 / 16;
    nextErrors[errorOffset - 3 + channel] += error * 3 / 16;
    nextErrors[errorOffset + channel] += error * 5 / 16;
    nextErrors[errorOffset + 3 + channel] += error / 16;
  }

  function getPatternThreshold(x, y, dithering) {
    const matrix = dithering === "pattern-2x2" ? BAYER_2X2 : BAYER_4X4;
    const matrixSize = dithering === "pattern-2x2" ? 2 : 4;

    return (
      (matrix[(y % matrixSize) * matrixSize + (x % matrixSize)] + 0.5) /
      matrix.length - 0.5
    ) * PATTERN_STRENGTH;
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

  function applyPaletteColorDepth(color, paletteColorBits) {
    if (paletteColorBits === 24) {
      return copyPaletteColor(color);
    }

    const red = expandChannel(quantizeChannel(color.r, 31), 31);
    const green = expandChannel(quantizeChannel(color.g, 63), 63);
    const blue = expandChannel(quantizeChannel(color.b, 31), 31);

    return {
      r: red,
      g: green,
      b: blue,
      hex: rgbToHex(red, green, blue),
      count: color.count || 0,
    };
  }

  function quantizeChannel(value, maximum) {
    return Math.round(value * maximum / 255);
  }

  function expandChannel(value, maximum) {
    return Math.round(value * 255 / maximum);
  }

  function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
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
    paletteColorBits,
    colorSpace,
    dithering,
    diversity
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

    if (!isPowerOfTwo(globalColorCount) || globalColorCount < 2 || globalColorCount > 1024) {
      throw new RangeError("globalColorCount must be a power of two from 2 to 1024");
    }

    if (paletteColorBits !== 16 && paletteColorBits !== 24) {
      throw new RangeError("paletteColorBits must be either 16 or 24");
    }

    if (!DITHERING_MODES.has(dithering)) {
      throw new RangeError(`Unsupported dithering mode: ${dithering}`);
    }

    if (!Number.isFinite(diversity) || diversity < 0 || diversity > 1) {
      throw new RangeError("diversity must be between 0 and 1");
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

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  return { compressImage };
});
