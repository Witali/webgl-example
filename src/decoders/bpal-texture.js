(function (root, factory) {
  "use strict";

  const blockPaletteFormat = typeof module === "object" && module.exports
    ? require("../palette/block-palette-format.js")
    : root.BlockPaletteFormat;
  const api = factory(blockPaletteFormat);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BpalTextureDecoder = api;
})(typeof self !== "undefined" ? self : globalThis, function (blockPaletteFormat) {
  "use strict";

  function decode(input) {
    if (!blockPaletteFormat || typeof blockPaletteFormat.decodeBlockPaletteFile !== "function") {
      throw new Error("BPAL format decoder is unavailable");
    }

    const decoded = blockPaletteFormat.decodeBlockPaletteFile(input);
    const expectedLength = decoded.width * decoded.height * 4;

    if (!(decoded.pixels instanceof Uint8ClampedArray) || decoded.pixels.length !== expectedLength) {
      throw new RangeError("Decoded BPAL texture has an invalid RGBA buffer");
    }

    return {
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.pixels,
      version: decoded.version,
      blockSize: decoded.blockSize,
      localColorCount: decoded.localColorCount,
      globalColorCount: decoded.globalColorCount,
      paletteMode: decoded.paletteMode,
      paletteColorBits: decoded.paletteColorBits,
      blocksX: decoded.blocksX,
      palette: decoded.palette,
      blockPaletteIndices: decoded.blockPaletteIndices,
      pixelIndices: decoded.pixelIndices,
    };
  }

  function createShaderTextureData(texture, maxTextureSize) {
    if (!texture || !Number.isInteger(texture.width) || !Number.isInteger(texture.height)) {
      throw new TypeError("Decoded BPAL texture metadata is invalid");
    }

    const textureLimit = Number(maxTextureSize);

    if (!Number.isInteger(textureLimit) || textureLimit < 1) {
      throw new RangeError("WebGL maximum texture size must be a positive integer");
    }

    const pixelAtlas = createAtlas(texture.pixelIndices, 1, textureLimit, (target, offset, value) => {
      target[offset] = value;
    });
    const blockPaletteAtlas = createAtlas(
      texture.blockPaletteIndices,
      4,
      textureLimit,
      (target, offset, value) => {
        target[offset] = value & 255;
        target[offset + 1] = value >> 8 & 255;
        target[offset + 3] = 255;
      }
    );
    const paletteAtlas = createAtlas(texture.palette, 4, textureLimit, (target, offset, color) => {
      target[offset] = color.r;
      target[offset + 1] = color.g;
      target[offset + 2] = color.b;
      target[offset + 3] = 255;
    });

    return {
      width: texture.width,
      height: texture.height,
      blockSize: texture.blockSize,
      blocksX: texture.blocksX,
      localColorCount: texture.localColorCount,
      pixelAtlas,
      blockPaletteAtlas,
      paletteAtlas,
    };
  }

  function createAtlas(values, channels, maxTextureSize, writeValue) {
    if (!values || typeof values.length !== "number" || values.length < 1) {
      throw new RangeError("BPAL shader atlas source is empty");
    }

    const width = Math.min(maxTextureSize, values.length);
    const height = Math.ceil(values.length / width);

    if (height > maxTextureSize) {
      throw new RangeError("BPAL data exceeds the WebGL texture size limit");
    }

    const data = new Uint8Array(width * height * channels);

    for (let index = 0; index < values.length; index += 1) {
      writeValue(data, index * channels, values[index]);
    }

    return { width, height, data, channels };
  }

  return { decode, createShaderTextureData };
});
