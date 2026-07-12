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
    const localColorCount = Number(options.localColorCount || 8);
    const globalColorCount = Number(options.globalColorCount || 256);
    const paletteColorBits = Number(options.paletteColorBits || 24);
    const paletteMode = options.paletteMode || "explicit";
    const colorSpace = options.colorSpace || "oklab";
    const clusteringMethod = options.clusteringMethod || "k-means";
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
      colorSpace,
      clusteringMethod,
      dithering,
      diversity
    );

    const maximumSamplePixels = globalColorCount >= 4096
      ? 8192
      : MAX_PALETTE_SAMPLE_PIXELS;
    const sample = samplePixels(sourcePixels, maximumSamplePixels);
    const quantizedSample = paletteQuantizer.quantizeImage(
      sample,
      sample.length / 4,
      1,
      globalColorCount,
      {
        colorSpace,
        clusteringMethod,
        dithering: "none",
        diversity,
        maxIterations: globalColorCount >= 4096 ? 6 : 16,
      }
    );
    const activePalette = quantizedSample.palette.length > 0
      ? quantizedSample.palette.map((color) => applyPaletteColorDepth(color, paletteColorBits))
      : [{ r: 0, g: 0, b: 0, hex: "#000000", count: 0 }];
    const iterations = quantizedSample.iterations;
    const palette = padPalette(activePalette, globalColorCount);
    const palettePoints = activePalette.map((color) => colorPoint(color.r, color.g, color.b, colorSpace));
    const paletteDistances = createPaletteDistanceMatrix(palettePoints);
    const paletteNeighborCache = new Map();
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
          paletteNeighborCache
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
      paletteMode: "explicit",
      activeGlobalColorCount: activePalette.length,
      globalIndexBits,
      localIndexBits,
      uniqueColorCount,
      resultColorCount: countNonZero(resultUsage),
      meanSquaredError: meanSquaredError(sourcePixels, outputPixels),
      colorSpace,
      clusteringMethod,
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
    paletteNeighborCache
  ) {
    const counts = new Uint32Array(activeColorCount);
    const startX = blockX * blockSize;
    const startY = blockY * blockSize;
    const endX = Math.min(width, startX + blockSize);
    const endY = Math.min(height, startY + blockSize);
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;

        if (sourcePixels[offset + 3] !== 0) {
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
    const sourceTargets = collectBlockSourceTargets(
      globalAssignments,
      sourcePixels,
      width,
      startX,
      startY,
      endX,
      endY,
      candidates,
      counts,
      palettePoints,
      colorSpace
    );

    const selected = candidates.length <= localColorCount
      ? candidates.slice()
      : selectMinimumErrorColors(
        candidates,
        sourceTargets,
        counts,
        localColorCount,
        palettePoints
      );
    const replacementCandidates = expandBlockPaletteCandidates(
      selected,
      candidates,
      sourceTargets,
      counts,
      localColorCount,
      activeColorCount,
      paletteDistances,
      palettePoints,
      paletteNeighborCache
    );
    const refined = refineSelectedColors(
      selected,
      replacementCandidates,
      candidates,
      sourceTargets,
      counts,
      palettePoints
    );

    fillBlockSupportColors(
      refined,
      candidates,
      sourceTargets,
      counts,
      localColorCount,
      activeColorCount,
      palettePoints
    );

    while (refined.length < localColorCount) {
      refined.push(refined[0] || 0);
    }

    return refined;
  }

  function collectBlockSourceTargets(
    globalAssignments,
    sourcePixels,
    width,
    startX,
    startY,
    endX,
    endY,
    sourceColors,
    counts,
    palettePoints,
    colorSpace
  ) {
    const sums = sourceColors.map(() => [0, 0, 0]);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;

        if (sourcePixels[offset + 3] === 0) {
          continue;
        }

        const sourcePosition = sourceColors.indexOf(globalAssignments[pixel]);
        const point = colorPoint(
          sourcePixels[offset],
          sourcePixels[offset + 1],
          sourcePixels[offset + 2],
          colorSpace
        );

        sums[sourcePosition][0] += point[0];
        sums[sourcePosition][1] += point[1];
        sums[sourcePosition][2] += point[2];
      }
    }

    return sums.map((sum, sourcePosition) => {
      const count = counts[sourceColors[sourcePosition]];

      return count > 0
        ? sum.map((value) => value / count)
        : palettePoints[sourceColors[sourcePosition]];
    });
  }

  function fillBlockSupportColors(
    selected,
    sourceColors,
    sourceTargets,
    counts,
    localColorCount,
    activeColorCount,
    palettePoints
  ) {
    const isSelected = new Uint8Array(activeColorCount);
    const supportCounts = new Uint16Array(sourceColors.length);

    for (const color of selected) {
      isSelected[color] = 1;

      const sourcePosition = sourceColors.indexOf(color);

      if (sourcePosition >= 0) {
        supportCounts[sourcePosition] += 1;
      }
    }

    while (selected.length < localColorCount && selected.length < activeColorCount) {
      let bestSourcePosition = 0;
      let bestPriority = -1;

      for (let sourcePosition = 0; sourcePosition < sourceColors.length; sourcePosition += 1) {
        const sourceColor = sourceColors[sourcePosition];
        const priority = Math.max(1, counts[sourceColor]) / (supportCounts[sourcePosition] + 1);

        if (priority > bestPriority) {
          bestPriority = priority;
          bestSourcePosition = sourcePosition;
        }
      }

      const sourceTarget = sourceTargets[bestSourcePosition];
      let bestCandidate = -1;
      let bestDistance = Infinity;

      for (let candidate = 0; candidate < activeColorCount; candidate += 1) {
        if (isSelected[candidate]) {
          continue;
        }

        const distance = squaredDistance(sourceTarget, palettePoints[candidate]);

        if (distance < bestDistance) {
          bestCandidate = candidate;
          bestDistance = distance;
        }
      }

      if (bestCandidate < 0) {
        break;
      }

      selected.push(bestCandidate);
      isSelected[bestCandidate] = 1;
      supportCounts[bestSourcePosition] += 1;
    }
  }

  function expandBlockPaletteCandidates(
    selected,
    sourceColors,
    sourceTargets,
    counts,
    localColorCount,
    activeColorCount,
    paletteDistances,
    palettePoints,
    paletteNeighborCache
  ) {
    const candidates = sourceColors.slice();
    const included = new Uint8Array(activeColorCount);
    const neighborCount = Math.min(activeColorCount - 1, Math.max(4, Math.min(8, localColorCount)));

    for (const candidate of candidates) {
      included[candidate] = 1;
    }

    for (const selectedColor of selected) {
      const neighbors = getPaletteNeighbors(
        selectedColor,
        neighborCount,
        activeColorCount,
        paletteDistances,
        paletteNeighborCache
      );

      for (const neighbor of neighbors) {
        if (!included[neighbor]) {
          included[neighbor] = 1;
          candidates.push(neighbor);
        }
      }
    }

    const optimizedCentroids = optimizeBlockCentroids(
      selected,
      sourceColors,
      sourceTargets,
      counts,
      palettePoints
    );

    for (const centroid of optimizedCentroids) {
      const centroidCandidates = findNearestPalettePoints(
        centroid,
        palettePoints,
        Math.min(localColorCount, activeColorCount)
      );

      for (const candidate of centroidCandidates) {
        if (!included[candidate]) {
          included[candidate] = 1;
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  function optimizeBlockCentroids(
    selected,
    sourceColors,
    sourceTargets,
    counts,
    palettePoints
  ) {
    const centroids = selected.map((paletteIndex) => palettePoints[paletteIndex].slice());

    for (let iteration = 0; iteration < 6; iteration += 1) {
      const sums = centroids.map(() => [0, 0, 0]);
      const weights = new Float64Array(centroids.length);

      for (let sourcePosition = 0; sourcePosition < sourceTargets.length; sourcePosition += 1) {
        const centroidIndex = nearestPointIndex(sourceTargets[sourcePosition], centroids);
        const weight = counts[sourceColors[sourcePosition]];

        sums[centroidIndex][0] += sourceTargets[sourcePosition][0] * weight;
        sums[centroidIndex][1] += sourceTargets[sourcePosition][1] * weight;
        sums[centroidIndex][2] += sourceTargets[sourcePosition][2] * weight;
        weights[centroidIndex] += weight;
      }

      let movement = 0;

      for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
        if (weights[centroidIndex] === 0) {
          continue;
        }

        const next = sums[centroidIndex].map((value) => value / weights[centroidIndex]);

        movement += squaredDistance(centroids[centroidIndex], next);
        centroids[centroidIndex] = next;
      }

      if (movement < 1e-8) {
        break;
      }
    }

    return centroids;
  }

  function findNearestPalettePoints(point, palettePoints, count) {
    const nearest = [];

    for (let paletteIndex = 0; paletteIndex < palettePoints.length; paletteIndex += 1) {
      const entry = {
        index: paletteIndex,
        distance: squaredDistance(point, palettePoints[paletteIndex]),
      };
      let position = nearest.length;

      while (position > 0 && (
        entry.distance < nearest[position - 1].distance ||
        (entry.distance === nearest[position - 1].distance && entry.index < nearest[position - 1].index)
      )) {
        position -= 1;
      }

      if (position < count) {
        nearest.splice(position, 0, entry);

        if (nearest.length > count) {
          nearest.pop();
        }
      }
    }

    return nearest.map((entry) => entry.index);
  }

  function getPaletteNeighbors(
    paletteIndex,
    neighborCount,
    activeColorCount,
    paletteDistances,
    paletteNeighborCache
  ) {
    let neighbors = paletteNeighborCache.get(paletteIndex);

    if (neighbors) {
      return neighbors;
    }

    neighbors = [];

    for (let candidate = 0; candidate < activeColorCount; candidate += 1) {
      if (candidate === paletteIndex) {
        continue;
      }

      const entry = {
        index: candidate,
        distance: paletteDistances[paletteIndex * activeColorCount + candidate],
      };
      let position = neighbors.length;

      while (position > 0 && (
        entry.distance < neighbors[position - 1].distance ||
        (entry.distance === neighbors[position - 1].distance && entry.index < neighbors[position - 1].index)
      )) {
        position -= 1;
      }

      if (position < neighborCount) {
        neighbors.splice(position, 0, entry);

        if (neighbors.length > neighborCount) {
          neighbors.pop();
        }
      }
    }

    neighbors = neighbors.map((entry) => entry.index);
    paletteNeighborCache.set(paletteIndex, neighbors);

    return neighbors;
  }

  function refineSelectedColors(
    selected,
    replacementCandidates,
    sourceColors,
    sourceTargets,
    counts,
    palettePoints
  ) {
    const isSelected = new Uint8Array(palettePoints.length);

    for (const color of selected) {
      isSelected[color] = 1;
    }

    for (let pass = 0; pass < 4; pass += 1) {
      let bestError = calculateSelectionError(
        selected,
        sourceColors,
        sourceTargets,
        counts,
        palettePoints
      );
      let bestSlot = -1;
      let bestReplacement = -1;

      for (let slot = 0; slot < selected.length; slot += 1) {
        const nearestWithoutSlot = new Float64Array(sourceColors.length);

        nearestWithoutSlot.fill(Infinity);

        for (let sourcePosition = 0; sourcePosition < sourceColors.length; sourcePosition += 1) {
          for (let selectedSlot = 0; selectedSlot < selected.length; selectedSlot += 1) {
            if (selectedSlot === slot) {
              continue;
            }

            nearestWithoutSlot[sourcePosition] = Math.min(
              nearestWithoutSlot[sourcePosition],
              squaredDistance(
                sourceTargets[sourcePosition],
                palettePoints[selected[selectedSlot]]
              )
            );
          }
        }

        for (const replacement of replacementCandidates) {
          if (isSelected[replacement]) {
            continue;
          }

          let error = 0;

          for (let sourcePosition = 0; sourcePosition < sourceColors.length; sourcePosition += 1) {
            const replacementDistance = squaredDistance(
              sourceTargets[sourcePosition],
              palettePoints[replacement]
            );

            error += counts[sourceColors[sourcePosition]] * Math.min(
              nearestWithoutSlot[sourcePosition],
              replacementDistance
            );
          }

          if (
            error < bestError ||
            (error === bestError && bestReplacement >= 0 && replacement < bestReplacement)
          ) {
            bestError = error;
            bestSlot = slot;
            bestReplacement = replacement;
          }
        }
      }

      if (bestSlot < 0) {
        break;
      }

      isSelected[selected[bestSlot]] = 0;
      selected[bestSlot] = bestReplacement;
      isSelected[bestReplacement] = 1;
    }

    return selected;
  }

  function calculateSelectionError(
    selected,
    sourceColors,
    sourceTargets,
    counts,
    palettePoints
  ) {
    let error = 0;

    for (let sourcePosition = 0; sourcePosition < sourceColors.length; sourcePosition += 1) {
      let nearestDistance = Infinity;

      for (const selectedColor of selected) {
        nearestDistance = Math.min(
          nearestDistance,
          squaredDistance(sourceTargets[sourcePosition], palettePoints[selectedColor])
        );
      }

      error += counts[sourceColors[sourcePosition]] * nearestDistance;
    }

    return error;
  }

  function selectMinimumErrorColors(
    candidates,
    sourceTargets,
    counts,
    localColorCount,
    palettePoints
  ) {
    const selected = [];
    const isSelected = new Uint8Array(palettePoints.length);
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
          const candidateDistance = squaredDistance(
            sourceTargets[sourcePosition],
            palettePoints[candidate]
          );

          error += counts[candidates[sourcePosition]] * Math.min(
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
        nearestDistances[sourcePosition] = Math.min(
          nearestDistances[sourcePosition],
          squaredDistance(sourceTargets[sourcePosition], palettePoints[bestCandidate])
        );
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
    paletteMode,
    colorSpace,
    clusteringMethod,
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

    if (!isPowerOfTwo(globalColorCount) || globalColorCount < 2 || globalColorCount > 4096) {
      throw new RangeError("globalColorCount must be a power of two from 2 to 4096");
    }

    if (paletteColorBits !== 16 && paletteColorBits !== 24) {
      throw new RangeError("paletteColorBits must be either 16 or 24");
    }

    if (paletteMode !== "explicit") {
      throw new RangeError(`Unsupported palette mode: ${paletteMode}`);
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

    if (
      clusteringMethod !== "k-means" &&
      clusteringMethod !== "k-means-uniform" &&
      clusteringMethod !== "k-medians"
    ) {
      throw new RangeError(`Unsupported clustering method: ${clusteringMethod}`);
    }
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  return { compressImage };
});
