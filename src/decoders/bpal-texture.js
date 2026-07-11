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
    };
  }

  return { decode };
});
