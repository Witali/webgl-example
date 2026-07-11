(function (root, factory) {
  "use strict";

  const retroConverter = typeof module === "object" && module.exports
    ? require("./retro-converter.js")
    : root.RetroConverter;
  const paletteQuantizer = typeof module === "object" && module.exports
    ? require("../palette/palette-quantizer.js")
    : root.PaletteQuantizer;
  const api = factory(retroConverter, paletteQuantizer);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ZxOptimizer = api;
})(typeof self !== "undefined" ? self : globalThis, function (retroConverter, paletteQuantizer) {
  "use strict";

  if (!retroConverter || !paletteQuantizer) {
    throw new Error("RetroConverter and PaletteQuantizer are required");
  }

  const WIDTH = 256;
  const HEIGHT = 192;
  const PIXEL_COUNT = WIDTH * HEIGHT;
  const COLOR_SPACES = ["oklab", "rgb"];
  const DITHERING_MODES = ["none", "pattern-2x2", "pattern", "floyd-steinberg"];

  function optimizeZxSpectrum(sourcePixels, width, height, options) {
    if (!(sourcePixels instanceof Uint8Array || sourcePixels instanceof Uint8ClampedArray)) {
      throw new TypeError("sourcePixels must be a Uint8Array or Uint8ClampedArray");
    }

    if (width !== WIDTH || height !== HEIGHT || sourcePixels.length !== PIXEL_COUNT * 4) {
      throw new RangeError("ZX optimizer input must be 256x192 RGBA");
    }

    const settings = options || {};
    const colorSpaces = settings.colorSpaces || COLOR_SPACES;
    const ditheringModes = settings.ditheringModes || DITHERING_MODES;
    const totalCandidates = colorSpaces.length * ditheringModes.length;
    const candidates = [];
    let recommended = null;
    let recommendedResult = null;
    let lowestPerceptual = null;
    let lowestPerceptualResult = null;
    let completedCandidates = 0;

    for (const colorSpace of colorSpaces) {
      for (const dithering of ditheringModes) {
        const result = retroConverter.convertZxSpectrum(
          sourcePixels,
          width,
          height,
          { colorSpace, dithering }
        );
        const candidate = measureCandidate(
          sourcePixels,
          result,
          width,
          height,
          colorSpace,
          dithering
        );

        candidates.push(candidate);

        if (!recommended || candidate.selectionScore < recommended.selectionScore) {
          recommended = candidate;
          recommendedResult = result;
        }

        if (!lowestPerceptual || candidate.perceptualScore < lowestPerceptual.perceptualScore) {
          lowestPerceptual = candidate;
          lowestPerceptualResult = result;
        }

        completedCandidates += 1;

        if (typeof settings.onProgress === "function") {
          settings.onProgress({ completed: completedCandidates, total: totalCandidates, candidate });
        }
      }
    }

    candidates.sort((left, right) => left.selectionScore - right.selectionScore);
    const recommendedMetadata = serializeCandidate(
      recommended,
      candidates.indexOf(recommended) + 1
    );
    const lowestPerceptualMetadata = serializeCandidate(
      lowestPerceptual,
      candidates.indexOf(lowestPerceptual) + 1
    );

    recommendedResult.optimization = {
      candidateCount: totalCandidates,
      recommended: recommendedMetadata,
      lowestPerceptual: lowestPerceptualMetadata,
    };

    return {
      result: recommendedResult,
      recommended: recommendedMetadata,
      lowestPerceptual: lowestPerceptualMetadata,
      lowestPerceptualResult,
      candidates: candidates.map((candidate, index) => serializeCandidate(candidate, index + 1)),
    };
  }

  function measureCandidate(source, result, width, height, colorSpace, dithering) {
    const fullDeltaE = perceptualError(source, result.pixels, width, height, 1);
    const twoPixelDeltaE = perceptualError(source, result.pixels, width, height, 2);
    const fourPixelDeltaE = perceptualError(source, result.pixels, width, height, 4);
    const eightPixelDeltaE = perceptualError(source, result.pixels, width, height, 8);
    const rgbError = rgbRmse(source, result.pixels, width, height);
    const averagedRgbError = averagedRgbRmse(source, result.pixels, width, height, 8);
    const perceptualScore = fullDeltaE * 0.05 +
      twoPixelDeltaE * 0.15 +
      fourPixelDeltaE * 0.3 +
      eightPixelDeltaE * 0.5;

    return {
      colorSpace,
      dithering,
      selectionScore: perceptualScore + averagedRgbError * 0.25,
      perceptualScore,
      fullDeltaE,
      twoPixelDeltaE,
      fourPixelDeltaE,
      eightPixelDeltaE,
      rgbRmse: rgbError,
      averagedRgbRmse: averagedRgbError,
      palette: result.palette.map((color) => color.hex),
    };
  }

  function perceptualError(source, output, width, height, blockSize) {
    let sum = 0;
    let blockCount = 0;

    for (let blockY = 0; blockY < height; blockY += blockSize) {
      for (let blockX = 0; blockX < width; blockX += blockSize) {
        const sourceLab = paletteQuantizer.srgbToOklab(
          ...averageLinearBlock(source, width, height, blockX, blockY, blockSize)
        );
        const outputLab = paletteQuantizer.srgbToOklab(
          ...averageLinearBlock(output, width, height, blockX, blockY, blockSize)
        );
        const deltaL = sourceLab[0] - outputLab[0];
        const deltaA = sourceLab[1] - outputLab[1];
        const deltaB = sourceLab[2] - outputLab[2];

        sum += deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
        blockCount += 1;
      }
    }

    return Math.sqrt(sum / blockCount) * 100;
  }

  function averageLinearBlock(pixels, width, height, startX, startY, blockSize) {
    const sum = [0, 0, 0];
    let count = 0;

    for (let y = startY; y < Math.min(height, startY + blockSize); y += 1) {
      for (let x = startX; x < Math.min(width, startX + blockSize); x += 1) {
        const index = (y * width + x) * 4;

        sum[0] += srgbToLinear(pixels[index]);
        sum[1] += srgbToLinear(pixels[index + 1]);
        sum[2] += srgbToLinear(pixels[index + 2]);
        count += 1;
      }
    }

    return sum.map((value) => linearToSrgbByte(value / count));
  }

  function rgbRmse(source, output, width, height) {
    let sum = 0;

    for (let index = 0; index < source.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = source[index + channel] - output[index + channel];

        sum += difference * difference;
      }
    }

    return Math.sqrt(sum / (width * height * 3));
  }

  function averagedRgbRmse(source, output, width, height, blockSize) {
    let sum = 0;
    let blockCount = 0;

    for (let blockY = 0; blockY < height; blockY += blockSize) {
      for (let blockX = 0; blockX < width; blockX += blockSize) {
        const sourceAverage = averageSrgbBlock(source, width, height, blockX, blockY, blockSize);
        const outputAverage = averageSrgbBlock(output, width, height, blockX, blockY, blockSize);

        for (let channel = 0; channel < 3; channel += 1) {
          sum += (sourceAverage[channel] - outputAverage[channel]) ** 2;
        }

        blockCount += 1;
      }
    }

    return Math.sqrt(sum / (blockCount * 3));
  }

  function averageSrgbBlock(pixels, width, height, startX, startY, blockSize) {
    const sum = [0, 0, 0];
    let count = 0;

    for (let y = startY; y < Math.min(height, startY + blockSize); y += 1) {
      for (let x = startX; x < Math.min(width, startX + blockSize); x += 1) {
        const index = (y * width + x) * 4;

        sum[0] += pixels[index];
        sum[1] += pixels[index + 1];
        sum[2] += pixels[index + 2];
        count += 1;
      }
    }

    return sum.map((value) => value / count);
  }

  function serializeCandidate(candidate, rank) {
    return {
      rank,
      colorSpace: candidate.colorSpace,
      dithering: candidate.dithering,
      selectionScore: candidate.selectionScore,
      perceptualScore: candidate.perceptualScore,
      fullDeltaE: candidate.fullDeltaE,
      twoPixelDeltaE: candidate.twoPixelDeltaE,
      fourPixelDeltaE: candidate.fourPixelDeltaE,
      eightPixelDeltaE: candidate.eightPixelDeltaE,
      rgbRmse: candidate.rgbRmse,
      averagedRgbRmse: candidate.averagedRgbRmse,
      palette: candidate.palette,
    };
  }

  function srgbToLinear(value) {
    const normalized = value / 255;

    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function linearToSrgbByte(value) {
    const encoded = value <= 0.0031308
      ? value * 12.92
      : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

    return clampByte(encoded * 255);
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  return {
    optimizeZxSpectrum,
  };
});
