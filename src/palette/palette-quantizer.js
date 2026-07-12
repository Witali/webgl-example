(function (root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.PaletteQuantizer = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const DEFAULT_MAX_ITERATIONS = 24;
  const DITHERING_MODES = new Set(["none", "pattern-2x2", "pattern", "floyd-steinberg"]);
  const COLOR_SPACES = new Set(["oklab", "rgb"]);
  const CLUSTERING_METHODS = new Set(["k-means", "k-medians"]);
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

  function quantizeImage(sourcePixels, width, height, requestedColorCount, options) {
    validateInput(sourcePixels, width, height, requestedColorCount);

    const settings = options || {};
    const maxIterations = Number.isInteger(settings.maxIterations)
      ? Math.max(1, settings.maxIterations)
      : DEFAULT_MAX_ITERATIONS;
    const dithering = settings.dithering || "none";
    const colorSpace = settings.colorSpace || "oklab";
    const clusteringMethod = settings.clusteringMethod || "k-means";
    const diversity = settings.diversity === undefined ? 0 : Number(settings.diversity);

    if (!DITHERING_MODES.has(dithering)) {
      throw new RangeError(`Unsupported dithering mode: ${dithering}`);
    }

    if (!COLOR_SPACES.has(colorSpace)) {
      throw new RangeError(`Unsupported color space: ${colorSpace}`);
    }

    if (!CLUSTERING_METHODS.has(clusteringMethod)) {
      throw new RangeError(`Unsupported clustering method: ${clusteringMethod}`);
    }

    if (!Number.isFinite(diversity) || diversity < 0 || diversity > 1) {
      throw new RangeError("diversity must be between 0 and 1");
    }

    const histogram = buildHistogram(sourcePixels);

    if (histogram.colors.length === 0) {
      return {
        width,
        height,
        pixels: new Uint8ClampedArray(sourcePixels),
        palette: [],
        iterations: 0,
        uniqueColorCount: 0,
        meanSquaredError: 0,
        dithering,
        colorSpace,
        clusteringMethod,
        diversity,
      };
    }

    const colorCount = Math.min(
      Math.max(1, Math.round(requestedColorCount)),
      histogram.colors.length
    );
    const clusteringColors = colorSpace === "oklab"
      ? histogram.colors.map((color) => srgbToOklab(color[0], color[1], color[2]))
      : histogram.colors;
    const clusteringWeights = createClusteringWeights(histogram.weights, diversity);
    const centroids = initializeCentroids(
      clusteringColors,
      clusteringWeights,
      colorCount,
      clusteringMethod
    );
    const assignments = new Int16Array(histogram.colors.length);

    assignments.fill(-1);

    let iterations = 0;

    for (; iterations < maxIterations; iterations += 1) {
      const changed = assignColors(
        clusteringColors,
        centroids,
        assignments,
        clusteringMethod
      );
      const moved = updateCentroids(
        clusteringColors,
        clusteringWeights,
        assignments,
        centroids,
        clusteringMethod
      );

      const movementThreshold = colorSpace === "oklab" ? 1e-8 : 0.01;

      if (!changed || moved < movementThreshold) {
        iterations += 1;
        break;
      }
    }

    // Reassign once after the last centroid update so palette membership and
    // output pixels always refer to the final centers.
    assignColors(clusteringColors, centroids, assignments, clusteringMethod);

    const paletteData = createPalette(
      histogram.colors,
      histogram.weights,
      assignments,
      centroids,
      colorSpace
    );
    const outputPixels = applyPalette(
      sourcePixels,
      histogram.indexByColor,
      assignments,
      paletteData.clusterToPalette,
      paletteData.palette,
      width,
      height,
      dithering,
      colorSpace,
      clusteringMethod
    );

    return {
      width,
      height,
      pixels: outputPixels,
      palette: paletteData.palette,
      iterations,
      uniqueColorCount: histogram.colors.length,
      meanSquaredError: calculatePixelMeanSquaredError(sourcePixels, outputPixels),
      dithering,
      colorSpace,
      clusteringMethod,
      diversity,
    };
  }

  function createClusteringWeights(pixelCounts, diversity) {
    if (diversity === 0) {
      return pixelCounts;
    }

    const exponent = 1 - diversity;
    const weights = new Float64Array(pixelCounts.length);

    for (let index = 0; index < pixelCounts.length; index += 1) {
      weights[index] = Math.pow(pixelCounts[index], exponent);
    }

    return weights;
  }

  function buildHistogram(pixels) {
    const countByColor = new Map();

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) {
        continue;
      }

      const key = colorKey(pixels[index], pixels[index + 1], pixels[index + 2]);

      countByColor.set(key, (countByColor.get(key) || 0) + 1);
    }

    const colors = new Array(countByColor.size);
    const weights = new Float64Array(countByColor.size);
    const indexByColor = new Map();
    let colorIndex = 0;

    countByColor.forEach((count, key) => {
      colors[colorIndex] = [key >>> 16, (key >>> 8) & 255, key & 255];
      weights[colorIndex] = count;
      indexByColor.set(key, colorIndex);
      colorIndex += 1;
    });

    return { colors, weights, indexByColor };
  }

  function initializeCentroids(colors, weights, colorCount, clusteringMethod) {
    const centroids = [];
    const selected = new Set();
    let firstIndex = 0;

    for (let index = 1; index < colors.length; index += 1) {
      if (weights[index] > weights[firstIndex]) {
        firstIndex = index;
      }
    }

    centroids.push(colors[firstIndex].slice());
    selected.add(firstIndex);

    while (centroids.length < colorCount) {
      let bestIndex = -1;
      let bestScore = -1;

      for (let index = 0; index < colors.length; index += 1) {
        if (selected.has(index)) {
          continue;
        }

        const nearestDistance = nearestCentroidDistance(
          colors[index],
          centroids,
          clusteringMethod
        );
        const score = nearestDistance * weights[index];

        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }

      selected.add(bestIndex);
      centroids.push(colors[bestIndex].slice());
    }

    return centroids;
  }

  function assignColors(colors, centroids, assignments, clusteringMethod) {
    let changed = false;

    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      const color = colors[colorIndex];
      let bestCluster = 0;
      let bestDistance = clusteringDistance(color, centroids[0], clusteringMethod);

      for (let cluster = 1; cluster < centroids.length; cluster += 1) {
        const distance = clusteringDistance(color, centroids[cluster], clusteringMethod);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = cluster;
        }
      }

      if (assignments[colorIndex] !== bestCluster) {
        assignments[colorIndex] = bestCluster;
        changed = true;
      }
    }

    return changed;
  }

  function updateCentroids(colors, weights, assignments, centroids, clusteringMethod) {
    return clusteringMethod === "k-medians"
      ? updateMedians(colors, weights, assignments, centroids)
      : updateMeans(colors, weights, assignments, centroids);
  }

  function updateMeans(colors, weights, assignments, centroids) {
    const sums = Array.from({ length: centroids.length }, () => [0, 0, 0]);
    const clusterWeights = new Float64Array(centroids.length);

    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      const cluster = assignments[colorIndex];
      const weight = weights[colorIndex];
      const color = colors[colorIndex];

      sums[cluster][0] += color[0] * weight;
      sums[cluster][1] += color[1] * weight;
      sums[cluster][2] += color[2] * weight;
      clusterWeights[cluster] += weight;
    }

    let totalMovement = 0;

    for (let cluster = 0; cluster < centroids.length; cluster += 1) {
      if (clusterWeights[cluster] === 0) {
        continue;
      }

      const next = [
        sums[cluster][0] / clusterWeights[cluster],
        sums[cluster][1] / clusterWeights[cluster],
        sums[cluster][2] / clusterWeights[cluster],
      ];

      totalMovement += squaredDistance(centroids[cluster], next);
      centroids[cluster] = next;
    }

    return totalMovement;
  }

  function updateMedians(colors, weights, assignments, centroids) {
    const members = Array.from({ length: centroids.length }, () => []);

    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      members[assignments[colorIndex]].push(colorIndex);
    }

    let totalMovement = 0;

    for (let cluster = 0; cluster < centroids.length; cluster += 1) {
      if (members[cluster].length === 0) {
        continue;
      }

      const next = [
        weightedMedian(colors, weights, members[cluster], 0),
        weightedMedian(colors, weights, members[cluster], 1),
        weightedMedian(colors, weights, members[cluster], 2),
      ];

      totalMovement += manhattanDistance(centroids[cluster], next);
      centroids[cluster] = next;
    }

    return totalMovement;
  }

  function weightedMedian(colors, weights, members, channel) {
    const sorted = members.slice().sort((left, right) => (
      colors[left][channel] - colors[right][channel] || left - right
    ));
    let totalWeight = 0;

    for (const colorIndex of sorted) {
      totalWeight += weights[colorIndex];
    }

    const midpoint = totalWeight / 2;
    let accumulated = 0;

    for (const colorIndex of sorted) {
      accumulated += weights[colorIndex];

      if (accumulated >= midpoint) {
        return colors[colorIndex][channel];
      }
    }

    return colors[sorted[sorted.length - 1]][channel];
  }

  function createPalette(colors, weights, assignments, centroids, colorSpace) {
    const populations = new Float64Array(centroids.length);

    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      populations[assignments[colorIndex]] += weights[colorIndex];
    }

    const palette = centroids.map((centroid, cluster) => {
      const rgb = colorSpace === "oklab"
        ? oklabToSrgb(centroid[0], centroid[1], centroid[2])
        : centroid;
      const red = clampByte(Math.round(rgb[0]));
      const green = clampByte(Math.round(rgb[1]));
      const blue = clampByte(Math.round(rgb[2]));

      return {
        r: red,
        g: green,
        b: blue,
        count: populations[cluster],
        hex: rgbToHex(red, green, blue),
        cluster,
      };
    }).filter((entry) => entry.count > 0);

    palette.sort((left, right) => right.count - left.count || left.cluster - right.cluster);

    const clusterToPalette = new Int16Array(centroids.length);

    palette.forEach((entry, paletteIndex) => {
      clusterToPalette[entry.cluster] = paletteIndex;
      delete entry.cluster;
    });

    return { palette, clusterToPalette };
  }

  function applyPalette(
    sourcePixels,
    indexByColor,
    assignments,
    clusterToPalette,
    palette,
    width,
    height,
    dithering,
    colorSpace,
    clusteringMethod
  ) {
    if (dithering === "pattern-2x2" || dithering === "pattern") {
      const matrix = dithering === "pattern-2x2" ? BAYER_2X2 : BAYER_4X4;
      const matrixSize = dithering === "pattern-2x2" ? 2 : 4;

      return applyPatternDithering(
        sourcePixels,
        width,
        height,
        palette,
        colorSpace,
        matrix,
        matrixSize,
        clusteringMethod
      );
    }

    if (dithering === "floyd-steinberg") {
      return applyFloydSteinbergDithering(
        sourcePixels,
        width,
        height,
        palette,
        colorSpace,
        clusteringMethod
      );
    }

    const output = new Uint8ClampedArray(sourcePixels.length);

    for (let index = 0; index < sourcePixels.length; index += 4) {
      const alpha = sourcePixels[index + 3];

      if (alpha === 0) {
        output[index] = sourcePixels[index];
        output[index + 1] = sourcePixels[index + 1];
        output[index + 2] = sourcePixels[index + 2];
        output[index + 3] = 0;
        continue;
      }

      const key = colorKey(sourcePixels[index], sourcePixels[index + 1], sourcePixels[index + 2]);
      const colorIndex = indexByColor.get(key);
      const paletteIndex = clusterToPalette[assignments[colorIndex]];
      const color = palette[paletteIndex];

      output[index] = color.r;
      output[index + 1] = color.g;
      output[index + 2] = color.b;
      output[index + 3] = alpha;
    }

    return output;
  }

  function applyPatternDithering(
    sourcePixels,
    width,
    height,
    palette,
    colorSpace,
    matrix,
    matrixSize,
    clusteringMethod
  ) {
    const output = new Uint8ClampedArray(sourcePixels.length);
    const palettePoints = createPalettePoints(palette, colorSpace);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = sourcePixels[index + 3];

        if (alpha === 0) {
          copyPixel(sourcePixels, output, index);
          continue;
        }

        const threshold = (
          (matrix[(y % matrixSize) * matrixSize + (x % matrixSize)] + 0.5) /
          matrix.length - 0.5
        ) * PATTERN_STRENGTH;
        const paletteIndex = findNearestPaletteIndex(
          sourcePixels[index] + threshold,
          sourcePixels[index + 1] + threshold,
          sourcePixels[index + 2] + threshold,
          palettePoints,
          colorSpace,
          clusteringMethod
        );

        writePalettePixel(output, index, alpha, palette[paletteIndex]);
      }
    }

    return output;
  }

  function applyFloydSteinbergDithering(
    sourcePixels,
    width,
    height,
    palette,
    colorSpace,
    clusteringMethod
  ) {
    const output = new Uint8ClampedArray(sourcePixels.length);
    const palettePoints = createPalettePoints(palette, colorSpace);
    const rowLength = (width + 2) * 3;
    let currentErrors = new Float32Array(rowLength);
    let nextErrors = new Float32Array(rowLength);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = sourcePixels[index + 3];
        const errorIndex = (x + 1) * 3;

        if (alpha === 0) {
          copyPixel(sourcePixels, output, index);
          continue;
        }

        const correctedRed = clampByte(sourcePixels[index] + currentErrors[errorIndex]);
        const correctedGreen = clampByte(sourcePixels[index + 1] + currentErrors[errorIndex + 1]);
        const correctedBlue = clampByte(sourcePixels[index + 2] + currentErrors[errorIndex + 2]);
        const paletteIndex = findNearestPaletteIndex(
          correctedRed,
          correctedGreen,
          correctedBlue,
          palettePoints,
          colorSpace,
          clusteringMethod
        );
        const color = palette[paletteIndex];

        writePalettePixel(output, index, alpha, color);
        diffuseError(correctedRed - color.r, 0, errorIndex, currentErrors, nextErrors);
        diffuseError(correctedGreen - color.g, 1, errorIndex, currentErrors, nextErrors);
        diffuseError(correctedBlue - color.b, 2, errorIndex, currentErrors, nextErrors);
      }

      const previousErrors = currentErrors;

      currentErrors = nextErrors;
      nextErrors = previousErrors;
      nextErrors.fill(0);
    }

    return output;
  }

  function diffuseError(error, channel, errorIndex, currentErrors, nextErrors) {
    currentErrors[errorIndex + 3 + channel] += error * 7 / 16;
    nextErrors[errorIndex - 3 + channel] += error * 3 / 16;
    nextErrors[errorIndex + channel] += error * 5 / 16;
    nextErrors[errorIndex + 3 + channel] += error / 16;
  }

  function createPalettePoints(palette, colorSpace) {
    return palette.map((color) => {
      return toClusteringPoint(color.r, color.g, color.b, colorSpace);
    });
  }

  function findNearestPaletteIndex(
    red,
    green,
    blue,
    palettePoints,
    colorSpace,
    clusteringMethod
  ) {
    const color = toClusteringPoint(red, green, blue, colorSpace);
    let bestIndex = 0;
    let bestDistance = clusteringDistance(color, palettePoints[0], clusteringMethod);

    for (let index = 1; index < palettePoints.length; index += 1) {
      const distance = clusteringDistance(color, palettePoints[index], clusteringMethod);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function toClusteringPoint(red, green, blue, colorSpace) {
    return colorSpace === "oklab"
      ? srgbToOklab(red, green, blue)
      : [red, green, blue];
  }

  function writePalettePixel(output, index, alpha, color) {
    output[index] = color.r;
    output[index + 1] = color.g;
    output[index + 2] = color.b;
    output[index + 3] = alpha;
  }

  function copyPixel(source, output, index) {
    output[index] = source[index];
    output[index + 1] = source[index + 1];
    output[index + 2] = source[index + 2];
    output[index + 3] = source[index + 3];
  }

  function calculatePixelMeanSquaredError(sourcePixels, outputPixels) {
    let squaredError = 0;
    let channelCount = 0;

    for (let index = 0; index < sourcePixels.length; index += 4) {
      if (sourcePixels[index + 3] === 0) {
        continue;
      }

      for (let channel = 0; channel < 3; channel += 1) {
        const error = sourcePixels[index + channel] - outputPixels[index + channel];

        squaredError += error * error;
        channelCount += 1;
      }
    }

    return channelCount === 0 ? 0 : squaredError / channelCount;
  }

  function nearestCentroidDistance(color, centroids, clusteringMethod) {
    let distance = clusteringDistance(color, centroids[0], clusteringMethod);

    for (let index = 1; index < centroids.length; index += 1) {
      distance = Math.min(
        distance,
        clusteringDistance(color, centroids[index], clusteringMethod)
      );
    }

    return distance;
  }

  function squaredDistance(left, right) {
    const first = left[0] - right[0];
    const second = left[1] - right[1];
    const third = left[2] - right[2];

    return first * first + second * second + third * third;
  }

  function manhattanDistance(left, right) {
    return (
      Math.abs(left[0] - right[0]) +
      Math.abs(left[1] - right[1]) +
      Math.abs(left[2] - right[2])
    );
  }

  function clusteringDistance(left, right, clusteringMethod) {
    return clusteringMethod === "k-medians"
      ? manhattanDistance(left, right)
      : squaredDistance(left, right);
  }

  function srgbToOklab(red, green, blue) {
    const linearRed = srgbByteToLinear(red);
    const linearGreen = srgbByteToLinear(green);
    const linearBlue = srgbByteToLinear(blue);
    const l = Math.cbrt(
      0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue
    );
    const m = Math.cbrt(
      0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue
    );
    const s = Math.cbrt(
      0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue
    );

    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToSrgb(lightness, greenRed, blueYellow) {
    const lRoot = lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow;
    const mRoot = lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow;
    const sRoot = lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow;
    const l = lRoot * lRoot * lRoot;
    const m = mRoot * mRoot * mRoot;
    const s = sRoot * sRoot * sRoot;

    return [
      linearToSrgbByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }

  function srgbByteToLinear(value) {
    const normalized = clampByte(value) / 255;

    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function linearToSrgbByte(value) {
    const linear = Math.max(0, Math.min(1, value));
    const normalized = linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;

    return normalized * 255;
  }

  function colorKey(red, green, blue) {
    return (red << 16) | (green << 8) | blue;
  }

  function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  function validateInput(pixels, width, height, colorCount) {
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
      throw new TypeError("sourcePixels must be a Uint8Array or Uint8ClampedArray");
    }

    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("width and height must be positive integers");
    }

    if (pixels.length !== width * height * 4) {
      throw new RangeError("sourcePixels length does not match width and height");
    }

    if (!Number.isFinite(colorCount) || colorCount < 1) {
      throw new RangeError("colorCount must be at least 1");
    }
  }

  return { quantizeImage, srgbToOklab, oklabToSrgb };
});
