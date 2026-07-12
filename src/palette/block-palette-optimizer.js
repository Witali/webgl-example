(function (root, factory) {
  "use strict";

  const blockPaletteCodec = typeof module === "object" && module.exports
    ? require("./block-palette-codec.js")
    : root.BlockPaletteCodec;
  const api = factory(blockPaletteCodec);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BlockPaletteOptimizer = api;
})(typeof self !== "undefined" ? self : globalThis, function (blockPaletteCodec) {
  "use strict";

  const BPAL_HEADER_BYTES = 14;
  const DEFAULT_PROFILES = [
    { blockSize: 4, localColorCount: 16, globalColorCount: 4096, paletteColorBits: 24 },
    { blockSize: 4, localColorCount: 16, globalColorCount: 1024, paletteColorBits: 24 },
    { blockSize: 4, localColorCount: 8, globalColorCount: 1024, paletteColorBits: 24 },
    { blockSize: 8, localColorCount: 16, globalColorCount: 1024, paletteColorBits: 24 },
    { blockSize: 8, localColorCount: 8, globalColorCount: 256, paletteColorBits: 24 },
    { blockSize: 8, localColorCount: 8, globalColorCount: 256, paletteColorBits: 16 },
    { blockSize: 8, localColorCount: 4, globalColorCount: 256, paletteColorBits: 16 },
    { blockSize: 16, localColorCount: 16, globalColorCount: 256, paletteColorBits: 24 },
    { blockSize: 16, localColorCount: 16, globalColorCount: 256, paletteColorBits: 16 },
    { blockSize: 16, localColorCount: 8, globalColorCount: 128, paletteColorBits: 16 },
    { blockSize: 16, localColorCount: 4, globalColorCount: 128, paletteColorBits: 16 },
    { blockSize: 16, localColorCount: 2, globalColorCount: 64, paletteColorBits: 16 },
    { blockSize: 32, localColorCount: 16, globalColorCount: 128, paletteColorBits: 16 },
    { blockSize: 32, localColorCount: 8, globalColorCount: 64, paletteColorBits: 16 },
    { blockSize: 32, localColorCount: 4, globalColorCount: 64, paletteColorBits: 16 },
    { blockSize: 32, localColorCount: 2, globalColorCount: 32, paletteColorBits: 16 },
    { blockSize: 64, localColorCount: 16, globalColorCount: 64, paletteColorBits: 16 },
    { blockSize: 64, localColorCount: 8, globalColorCount: 32, paletteColorBits: 16 },
    { blockSize: 64, localColorCount: 4, globalColorCount: 16, paletteColorBits: 16 },
    { blockSize: 64, localColorCount: 2, globalColorCount: 8, paletteColorBits: 16 },
  ];

  function findBalancedBlockPaletteSettings(
    sourcePixels,
    width,
    height,
    options,
    onProgress
  ) {
    const searchOptions = options || {};
    const profiles = normalizeProfiles(searchOptions.profiles || DEFAULT_PROFILES);
    const commonSettings = {
      colorSpace: searchOptions.colorSpace || "oklab",
      dithering: searchOptions.dithering || "none",
      diversity: searchOptions.diversity === undefined ? 0 : searchOptions.diversity,
      paletteMode: "explicit",
    };
    const candidates = [];

    for (let index = 0; index < profiles.length; index += 1) {
      const settings = { ...commonSettings, ...profiles[index] };
      const result = blockPaletteCodec.compressImage(
        sourcePixels,
        width,
        height,
        settings
      );
      const candidate = {
        settings: profiles[index],
        rmse: Math.sqrt(result.meanSquaredError),
        payloadBytes: result.storage.totalBytes,
        fileBytes: result.storage.totalBytes + BPAL_HEADER_BYTES,
        bitsPerPixel: result.storage.bitsPerPixel,
        compressionRatio: result.storage.compressionRatio,
      };

      candidates.push(candidate);

      if (typeof onProgress === "function") {
        onProgress({
          completed: index + 1,
          total: profiles.length,
          candidate,
        });
      }
    }

    const frontier = paretoFrontier(candidates);
    const selected = selectBalancedCandidate(frontier);

    return {
      settings: selected.settings,
      selected,
      frontier,
      candidates,
    };
  }

  function paretoFrontier(candidates) {
    return candidates
      .filter((candidate, candidateIndex) => !candidates.some((other, otherIndex) => (
        candidateIndex !== otherIndex &&
        other.fileBytes <= candidate.fileBytes &&
        other.rmse <= candidate.rmse &&
        (other.fileBytes < candidate.fileBytes || other.rmse < candidate.rmse)
      )))
      .sort((left, right) => left.fileBytes - right.fileBytes || left.rmse - right.rmse);
  }

  function selectBalancedCandidate(frontier) {
    if (frontier.length === 0) {
      throw new RangeError("No block-palette optimization candidates");
    }

    const minimumRmse = Math.min(...frontier.map((candidate) => candidate.rmse));
    const maximumRmse = Math.max(...frontier.map((candidate) => candidate.rmse));
    const minimumLogSize = Math.min(...frontier.map((candidate) => Math.log(candidate.fileBytes)));
    const maximumLogSize = Math.max(...frontier.map((candidate) => Math.log(candidate.fileBytes)));
    const rmseRange = maximumRmse - minimumRmse;
    const sizeRange = maximumLogSize - minimumLogSize;
    let selected = frontier[0];
    let bestScore = Infinity;

    for (const candidate of frontier) {
      const normalizedError = rmseRange === 0
        ? 0
        : (candidate.rmse - minimumRmse) / rmseRange;
      const normalizedSize = sizeRange === 0
        ? 0
        : (Math.log(candidate.fileBytes) - minimumLogSize) / sizeRange;
      const score = normalizedError * normalizedError * 1.5 + normalizedSize * normalizedSize;

      if (
        score < bestScore ||
        (score === bestScore && candidate.fileBytes < selected.fileBytes)
      ) {
        selected = candidate;
        bestScore = score;
      }
    }

    return { ...selected, score: bestScore };
  }

  function normalizeProfiles(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new RangeError("Optimization profiles must be a non-empty array");
    }

    const unique = new Map();

    for (const profile of profiles) {
      const normalized = {
        blockSize: Number(profile.blockSize),
        localColorCount: Number(profile.localColorCount),
        globalColorCount: Number(profile.globalColorCount),
        paletteColorBits: Number(profile.paletteColorBits),
      };
      const key = [
        normalized.blockSize,
        normalized.localColorCount,
        normalized.globalColorCount,
        normalized.paletteColorBits,
      ].join(":");

      unique.set(key, normalized);
    }

    return Array.from(unique.values());
  }

  return {
    DEFAULT_PROFILES,
    findBalancedBlockPaletteSettings,
    paretoFrontier,
    selectBalancedCandidate,
  };
});
