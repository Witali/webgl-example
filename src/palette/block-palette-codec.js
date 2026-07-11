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
  const PALETTE_MODES = new Set(["explicit", "vector"]);
  const VECTOR_COLOR_SPACES = new Set(["rgb", "oklab"]);
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
    const paletteMode = options.paletteMode || "explicit";
    const vectorColorSpace = options.vectorColorSpace || "rgb";
    const vectorDeviation = options.vectorDeviation === undefined
      ? 0.05
      : Number(options.vectorDeviation);
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
      paletteMode,
      vectorColorSpace,
      vectorDeviation,
      colorSpace,
      dithering,
      diversity
    );

    const sample = samplePixels(sourcePixels, MAX_PALETTE_SAMPLE_PIXELS);
    let activePalette;
    let paletteVectors = [];
    let vectorDeviationActual = 0;
    let iterations = 0;

    if (paletteMode === "vector") {
      const vectorPalette = createAdaptiveVectorPalette(
        sample,
        globalColorCount,
        paletteColorBits,
        vectorColorSpace,
        vectorDeviation
      );

      activePalette = vectorPalette.palette;
      paletteVectors = vectorPalette.vectors;
      vectorDeviationActual = vectorPalette.actualDeviation;
    } else {
      const quantizedSample = paletteQuantizer.quantizeImage(
        sample,
        sample.length / 4,
        1,
        globalColorCount,
        { colorSpace, dithering: "none", diversity, maxIterations: 16 }
      );

      activePalette = quantizedSample.palette.length > 0
        ? quantizedSample.palette.map((color) => applyPaletteColorDepth(color, paletteColorBits))
        : [{ r: 0, g: 0, b: 0, hex: "#000000", count: 0 }];
      iterations = quantizedSample.iterations;
    }
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
          paletteDistances,
          palettePoints,
          colorSpace,
          dithering
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
    const globalPaletteBits = paletteMode === "vector"
      ? paletteVectors.length * 2 * paletteColorBits
      : globalColorCount * paletteColorBits;
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
      paletteMode,
      vectorColorSpace,
      vectorDeviation,
      paletteVectorCount: paletteVectors.length,
      paletteVectors,
      vectorDeviationActual,
      activeGlobalColorCount: activePalette.length,
      globalIndexBits,
      localIndexBits,
      uniqueColorCount,
      resultColorCount: countNonZero(resultUsage),
      meanSquaredError: meanSquaredError(sourcePixels, outputPixels),
      colorSpace,
      dithering,
      diversity,
      iterations,
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
    paletteDistances,
    palettePoints,
    colorSpace,
    dithering
  ) {
    const counts = new Uint32Array(activeColorCount);
    const startX = blockX * blockSize;
    const startY = blockY * blockSize;
    const endX = Math.min(width, startX + blockSize);
    const endY = Math.min(height, startY + blockSize);
    const sourcePointSum = [0, 0, 0];
    let sourcePointCount = 0;

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;

        if (sourcePixels[offset + 3] !== 0) {
          counts[globalAssignments[pixel]] += 1;

          if (dithering === "floyd-steinberg") {
            const point = colorPoint(
              sourcePixels[offset],
              sourcePixels[offset + 1],
              sourcePixels[offset + 2],
              colorSpace
            );

            sourcePointSum[0] += point[0];
            sourcePointSum[1] += point[1];
            sourcePointSum[2] += point[2];
            sourcePointCount += 1;
          }
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

    const refined = refineSelectedColors(
      selected,
      candidates,
      counts,
      activeColorCount,
      paletteDistances
    );

    if (dithering === "floyd-steinberg") {
      const sourceMean = sourcePointCount === 0
        ? palettePoints[refined[0]]
        : sourcePointSum.map((value) => value / sourcePointCount);

      fillFloydSupportColors(
        refined,
        sourceMean,
        localColorCount,
        activeColorCount,
        palettePoints
      );
    }

    while (refined.length < localColorCount) {
      refined.push(refined[0] || 0);
    }

    return refined;
  }

  function fillFloydSupportColors(
    selected,
    sourceMean,
    localColorCount,
    activeColorCount,
    palettePoints
  ) {
    const isSelected = new Uint8Array(activeColorCount);

    for (const color of selected) {
      isSelected[color] = 1;
    }

    const alternatives = [];

    for (let candidate = 0; candidate < activeColorCount; candidate += 1) {
      if (isSelected[candidate]) {
        continue;
      }

      alternatives.push({
        candidate,
        error: squaredDistance(sourceMean, palettePoints[candidate]),
      });
    }

    alternatives.sort((left, right) => (
      left.error - right.error || left.candidate - right.candidate
    ));

    for (const alternative of alternatives) {
      if (selected.length >= localColorCount) {
        break;
      }

      selected.push(alternative.candidate);
    }
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

  function createAdaptiveVectorPalette(
    sourcePixels,
    globalColorCount,
    paletteColorBits,
    vectorColorSpace,
    allowedDeviation
  ) {
    const points = [];
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];

    for (let offset = 0; offset < sourcePixels.length; offset += 4) {
      if (sourcePixels[offset + 3] === 0) {
        continue;
      }

      const point = vectorColorSpace === "oklab"
        ? paletteQuantizer.srgbToOklab(
          sourcePixels[offset],
          sourcePixels[offset + 1],
          sourcePixels[offset + 2]
        )
        : [
          sourcePixels[offset],
          sourcePixels[offset + 1],
          sourcePixels[offset + 2],
        ];

      points.push(point);

      for (let channel = 0; channel < 3; channel += 1) {
        minimum[channel] = Math.min(minimum[channel], point[channel]);
        maximum[channel] = Math.max(maximum[channel], point[channel]);
      }
    }

    if (points.length === 0) {
      points.push([0, 0, 0]);
      minimum.fill(0);
      maximum.fill(0);
    }

    const overallRange = Math.max(1e-12, Math.sqrt(
      (maximum[0] - minimum[0]) ** 2 +
      (maximum[1] - minimum[1]) ** 2 +
      (maximum[2] - minimum[2]) ** 2
    ));
    const maximumVectors = Math.max(
      1,
      Math.min(Math.floor(globalColorCount / 2), points.length)
    );
    const clusters = [fitVectorCluster(points)];

    while (clusters.length < maximumVectors) {
      let splitIndex = -1;
      let worstDeviation = allowedDeviation;

      for (let index = 0; index < clusters.length; index += 1) {
        const cluster = clusters[index];
        const relativeDeviation = cluster.rmsDeviation / overallRange;

        if (
          cluster.points.length >= 4 &&
          relativeDeviation > worstDeviation
        ) {
          splitIndex = index;
          worstDeviation = relativeDeviation;
        }
      }

      if (splitIndex < 0) {
        break;
      }

      const cluster = clusters[splitIndex];
      const sorted = cluster.points.slice().sort((left, right) => (
        projectPoint(left, cluster.mean, cluster.axis) -
        projectPoint(right, cluster.mean, cluster.axis)
      ));
      const middle = Math.floor(sorted.length / 2);
      const left = fitVectorCluster(sorted.slice(0, middle));
      const right = fitVectorCluster(sorted.slice(middle));

      clusters.splice(splitIndex, 1, left, right);
    }

    const vectors = clusters.map((cluster) => {
      const start = applyPaletteColorDepth(
        createPaletteColor(
          pointOnAxis(cluster.mean, cluster.axis, cluster.minimumProjection),
          vectorColorSpace
        ),
        paletteColorBits
      );
      const end = applyPaletteColorDepth(
        createPaletteColor(
          pointOnAxis(cluster.mean, cluster.axis, cluster.maximumProjection),
          vectorColorSpace
        ),
        paletteColorBits
      );

      return { start, end };
    });
    const palette = interpolatePaletteVectors(vectors, globalColorCount, vectorColorSpace);
    const actualDeviation = Math.max(
      0,
      ...clusters.map((cluster) => cluster.rmsDeviation / overallRange)
    );

    return { palette, vectors, actualDeviation };
  }

  function fitVectorCluster(points) {
    const mean = [0, 0, 0];

    for (const point of points) {
      mean[0] += point[0];
      mean[1] += point[1];
      mean[2] += point[2];
    }

    mean[0] /= points.length;
    mean[1] /= points.length;
    mean[2] /= points.length;

    const covariance = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    for (const point of points) {
      const difference = [
        point[0] - mean[0],
        point[1] - mean[1],
        point[2] - mean[2],
      ];

      for (let row = 0; row < 3; row += 1) {
        for (let column = row; column < 3; column += 1) {
          covariance[row][column] += difference[row] * difference[column];

          if (row !== column) {
            covariance[column][row] = covariance[row][column];
          }
        }
      }
    }

    const axis = principalAxis(covariance);
    let minimumProjection = Infinity;
    let maximumProjection = -Infinity;
    let perpendicularSquared = 0;

    for (const point of points) {
      const projection = projectPoint(point, mean, axis);
      const projected = pointOnAxis(mean, axis, projection);

      minimumProjection = Math.min(minimumProjection, projection);
      maximumProjection = Math.max(maximumProjection, projection);
      perpendicularSquared +=
        (point[0] - projected[0]) ** 2 +
        (point[1] - projected[1]) ** 2 +
        (point[2] - projected[2]) ** 2;
    }

    return {
      points,
      mean,
      axis,
      minimumProjection,
      maximumProjection,
      rmsDeviation: Math.sqrt(perpendicularSquared / points.length),
    };
  }

  function principalAxis(covariance) {
    let largestDiagonal = 0;

    for (let channel = 1; channel < 3; channel += 1) {
      if (covariance[channel][channel] > covariance[largestDiagonal][largestDiagonal]) {
        largestDiagonal = channel;
      }
    }

    let axis = [0, 0, 0];

    axis[largestDiagonal] = 1;

    for (let iteration = 0; iteration < 16; iteration += 1) {
      const next = [
        covariance[0][0] * axis[0] + covariance[0][1] * axis[1] + covariance[0][2] * axis[2],
        covariance[1][0] * axis[0] + covariance[1][1] * axis[1] + covariance[1][2] * axis[2],
        covariance[2][0] * axis[0] + covariance[2][1] * axis[1] + covariance[2][2] * axis[2],
      ];
      const length = Math.sqrt(next[0] ** 2 + next[1] ** 2 + next[2] ** 2);

      if (length < 1e-12) {
        break;
      }

      axis = next.map((value) => value / length);
    }

    return axis;
  }

  function projectPoint(point, mean, axis) {
    return (
      (point[0] - mean[0]) * axis[0] +
      (point[1] - mean[1]) * axis[1] +
      (point[2] - mean[2]) * axis[2]
    );
  }

  function pointOnAxis(mean, axis, projection) {
    return [
      mean[0] + axis[0] * projection,
      mean[1] + axis[1] * projection,
      mean[2] + axis[2] * projection,
    ];
  }

  function createPaletteColor(point, vectorColorSpace) {
    const channels = vectorColorSpace === "oklab"
      ? paletteQuantizer.oklabToSrgb(point[0], point[1], point[2])
      : point;
    const red = clampByte(Math.round(channels[0]));
    const green = clampByte(Math.round(channels[1]));
    const blue = clampByte(Math.round(channels[2]));

    return { r: red, g: green, b: blue, hex: rgbToHex(red, green, blue), count: 0 };
  }

  function interpolatePaletteVectors(vectors, globalColorCount, vectorColorSpace) {
    const palette = [];
    const colorsPerVector = Math.floor(globalColorCount / vectors.length);
    const extraColors = globalColorCount % vectors.length;

    for (let vectorIndex = 0; vectorIndex < vectors.length; vectorIndex += 1) {
      const vector = vectors[vectorIndex];
      const colorCount = colorsPerVector + (vectorIndex < extraColors ? 1 : 0);
      const start = vectorColorSpace === "oklab"
        ? paletteQuantizer.srgbToOklab(vector.start.r, vector.start.g, vector.start.b)
        : [vector.start.r, vector.start.g, vector.start.b];
      const end = vectorColorSpace === "oklab"
        ? paletteQuantizer.srgbToOklab(vector.end.r, vector.end.g, vector.end.b)
        : [vector.end.r, vector.end.g, vector.end.b];

      for (let colorIndex = 0; colorIndex < colorCount; colorIndex += 1) {
        const ratio = colorCount <= 1 ? 0 : colorIndex / (colorCount - 1);
        const point = [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio,
          start[2] + (end[2] - start[2]) * ratio,
        ];
        const channels = vectorColorSpace === "oklab"
          ? paletteQuantizer.oklabToSrgb(point[0], point[1], point[2])
          : point;
        const red = clampByte(Math.round(channels[0]));
        const green = clampByte(Math.round(channels[1]));
        const blue = clampByte(Math.round(channels[2]));

        palette.push({ r: red, g: green, b: blue, hex: rgbToHex(red, green, blue), count: 0 });
      }
    }

    return palette;
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
    paletteMode,
    vectorColorSpace,
    vectorDeviation,
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

    if (!PALETTE_MODES.has(paletteMode)) {
      throw new RangeError(`Unsupported palette mode: ${paletteMode}`);
    }

    if (!VECTOR_COLOR_SPACES.has(vectorColorSpace)) {
      throw new RangeError(`Unsupported vector color space: ${vectorColorSpace}`);
    }

    if (!Number.isFinite(vectorDeviation) || vectorDeviation < 0.01 || vectorDeviation > 0.5) {
      throw new RangeError("vectorDeviation must be between 0.01 and 0.5");
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
