(function (root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BlockPaletteFormat = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAGIC = [0x42, 0x50, 0x41, 0x4c];
  const MAGIC_TEXT = "BPAL";
  const VERSION = 3;
  const MAGIC_BYTES = 4;
  const VERSION_1_HEADER_BITS = 64;
  const BIT_FIELD_HEADER_BITS = 80;
  const HEADER_BYTES = MAGIC_BYTES + BIT_FIELD_HEADER_BITS / 8;
  const MAX_DIMENSION = 1 << 24;

  function encodeBlockPaletteFile(image) {
    const metadata = validateImage(image);
    const layout = getBlockPaletteFileLayout(metadata);
    const bytes = new Uint8Array(layout.totalBytes);

    bytes.set(MAGIC, 0);

    const writer = new BitWriter(bytes, MAGIC_BYTES * 8);

    writer.write(VERSION, 4);
    writer.write(metadata.width - 1, 24);
    writer.write(metadata.height - 1, 24);
    writer.write(metadata.blockSizeExponent - 1, 3);
    writer.write(metadata.localIndexBits - 1, 2);
    writer.write(metadata.globalIndexBits - 1, 4);
    writer.write(metadata.paletteColorBits === 24 ? 1 : 0, 1);
    writer.write(metadata.paletteMode === "vector" ? 1 : 0, 1);
    writer.write(metadata.paletteMode === "vector" ? metadata.paletteVectorCount - 1 : 0, 9);
    writer.write(metadata.vectorColorSpace === "oklab" ? 1 : 0, 1);
    writer.write(0, 7);

    const storedColors = metadata.paletteMode === "vector"
      ? metadata.paletteVectors.flatMap((vector) => [vector.start, vector.end])
      : metadata.palette;

    for (const color of storedColors) {

      if (metadata.paletteColorBits === 16) {
        writer.write(packRgb565(color), 16);
      } else {
        writer.write(color.r, 8);
        writer.write(color.g, 8);
        writer.write(color.b, 8);
      }
    }

    for (const globalIndex of metadata.blockPaletteIndices) {
      writer.write(globalIndex, metadata.globalIndexBits);
    }

    for (const localIndex of metadata.pixelIndices) {
      writer.write(localIndex, metadata.localIndexBits);
    }

    return bytes;
  }

  function decodeBlockPaletteFile(input) {
    const bytes = asUint8Array(input);

    if (bytes.length < MAGIC_BYTES + 1) {
      throw new RangeError("Truncated BPAL header");
    }

    for (let index = 0; index < MAGIC.length; index += 1) {
      if (bytes[index] !== MAGIC[index]) {
        throw new RangeError("Invalid BPAL magic");
      }
    }

    const reader = new BitReader(bytes, MAGIC_BYTES * 8);
    const version = reader.read(4);

    if (version === 1) {
      return decodeVersion1(bytes, reader, version);
    }

    if (version === 2) {
      return decodeVersion2(bytes, reader, version);
    }

    if (version === VERSION) {
      return decodeVersion3(bytes, reader, version);
    }

    throw new RangeError(`Unsupported BPAL version: ${version}`);
  }

  function decodeVersion1(bytes, reader, version) {
    const width = reader.read(24) + 1;
    const height = reader.read(24) + 1;
    const blockSizeExponent = reader.read(3) + 1;
    const localIndexBits = reader.read(2) + 1;
    const globalIndexBits = reader.read(4) + 1;
    const paletteColorBits = reader.read(1) === 1 ? 24 : 16;
    const reserved = reader.read(2);
    const blockSize = 2 ** blockSizeExponent;
    const localColorCount = 2 ** localIndexBits;
    const globalColorCount = 2 ** globalIndexBits;

    if (reserved !== 0) {
      throw new RangeError("Unsupported BPAL v1 flags");
    }

    validateMetadata({
      width,
      height,
      blockSize,
      localColorCount,
      globalColorCount,
      paletteColorBits,
    });

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const blockCount = blocksX * blocksY;
    const layout = calculateLayout(
      width,
      height,
      blockCount,
      localColorCount,
      globalColorCount,
      paletteColorBits,
      "explicit",
      0,
      VERSION_1_HEADER_BITS
    );

    if (bytes.length !== layout.totalBytes) {
      throw new RangeError("BPAL file size does not match its header");
    }

    const palette = new Array(globalColorCount);

    for (let index = 0; index < globalColorCount; index += 1) {
      palette[index] = paletteColorBits === 16
        ? unpackRgb565(reader.read(16))
        : createColor(reader.read(8), reader.read(8), reader.read(8));
    }

    const blockPaletteIndices = new Uint16Array(blockCount * localColorCount);

    for (let index = 0; index < blockPaletteIndices.length; index += 1) {
      blockPaletteIndices[index] = reader.read(globalIndexBits);
    }

    const pixelIndices = new Uint8Array(width * height);

    for (let index = 0; index < pixelIndices.length; index += 1) {
      pixelIndices[index] = reader.read(localIndexBits);
    }

    const pixels = reconstructPixels(
      width,
      height,
      blockSize,
      blocksX,
      localColorCount,
      palette,
      blockPaletteIndices,
      pixelIndices
    );

    return {
      magic: MAGIC_TEXT,
      version,
      width,
      height,
      blockSize,
      blocksX,
      blocksY,
      blockCount,
      localColorCount,
      globalColorCount,
      paletteColorBits,
      paletteMode: "explicit",
      vectorColorSpace: "rgb",
      paletteVectorCount: 0,
      paletteVectors: [],
      localIndexBits,
      globalIndexBits,
      palette,
      blockPaletteIndices,
      pixelIndices,
      pixels,
      storage: layout,
    };
  }

  function decodeVersion2(bytes, reader, version) {
    return decodeVectorVersion(bytes, reader, version, false);
  }

  function decodeVersion3(bytes, reader, version) {
    return decodeVectorVersion(bytes, reader, version, true);
  }

  function decodeVectorVersion(bytes, reader, version, storesVectorColorSpace) {
    if (bytes.length < HEADER_BYTES) {
      throw new RangeError(`Truncated BPAL v${version} header`);
    }

    const width = reader.read(24) + 1;
    const height = reader.read(24) + 1;
    const blockSizeExponent = reader.read(3) + 1;
    const localIndexBits = reader.read(2) + 1;
    const globalIndexBits = reader.read(4) + 1;
    const paletteColorBits = reader.read(1) === 1 ? 24 : 16;
    const paletteMode = reader.read(1) === 1 ? "vector" : "explicit";
    const storedVectorCount = reader.read(9) + 1;
    const vectorColorSpace = storesVectorColorSpace && reader.read(1) === 1
      ? "oklab"
      : "rgb";
    const reserved = reader.read(storesVectorColorSpace ? 7 : 8);
    const paletteVectorCount = paletteMode === "vector" ? storedVectorCount : 0;
    const blockSize = 2 ** blockSizeExponent;
    const localColorCount = 2 ** localIndexBits;
    const globalColorCount = 2 ** globalIndexBits;

    if (reserved !== 0) {
      throw new RangeError(`Unsupported BPAL v${version} flags`);
    }

    validateMetadata({
      width,
      height,
      blockSize,
      localColorCount,
      globalColorCount,
      paletteColorBits,
    });
    validatePaletteVectorCount(paletteMode, paletteVectorCount, globalColorCount);

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const blockCount = blocksX * blocksY;
    const layout = calculateLayout(
      width,
      height,
      blockCount,
      localColorCount,
      globalColorCount,
      paletteColorBits,
      paletteMode,
      paletteVectorCount,
      BIT_FIELD_HEADER_BITS
    );

    if (bytes.length !== layout.totalBytes) {
      throw new RangeError("BPAL file size does not match its header");
    }

    let palette;
    let paletteVectors = [];

    if (paletteMode === "vector") {
      paletteVectors = new Array(paletteVectorCount);

      for (let index = 0; index < paletteVectorCount; index += 1) {
        paletteVectors[index] = {
          start: readColor(reader, paletteColorBits),
          end: readColor(reader, paletteColorBits),
        };
      }

      palette = interpolatePaletteVectors(paletteVectors, globalColorCount, vectorColorSpace);
    } else {
      palette = new Array(globalColorCount);

      for (let index = 0; index < globalColorCount; index += 1) {
        palette[index] = readColor(reader, paletteColorBits);
      }
    }

    const blockPaletteIndices = new Uint16Array(blockCount * localColorCount);

    for (let index = 0; index < blockPaletteIndices.length; index += 1) {
      blockPaletteIndices[index] = reader.read(globalIndexBits);
    }

    const pixelIndices = new Uint8Array(width * height);

    for (let index = 0; index < pixelIndices.length; index += 1) {
      pixelIndices[index] = reader.read(localIndexBits);
    }

    const pixels = reconstructPixels(
      width,
      height,
      blockSize,
      blocksX,
      localColorCount,
      palette,
      blockPaletteIndices,
      pixelIndices
    );

    return {
      magic: MAGIC_TEXT,
      version,
      width,
      height,
      blockSize,
      blocksX,
      blocksY,
      blockCount,
      localColorCount,
      globalColorCount,
      paletteColorBits,
      paletteMode,
      vectorColorSpace,
      paletteVectorCount,
      paletteVectors,
      localIndexBits,
      globalIndexBits,
      palette,
      blockPaletteIndices,
      pixelIndices,
      pixels,
      storage: layout,
    };
  }

  function getBlockPaletteFileLayout(image) {
    const blockCount = image.blockCount === undefined
      ? Math.ceil(image.width / image.blockSize) * Math.ceil(image.height / image.blockSize)
      : image.blockCount;

    return calculateLayout(
      image.width,
      image.height,
      blockCount,
      image.localColorCount,
      image.globalColorCount,
      image.paletteColorBits,
      image.paletteMode || "explicit",
      image.paletteVectorCount || 0,
      BIT_FIELD_HEADER_BITS
    );
  }

  function calculateLayout(
    width,
    height,
    blockCount,
    localColorCount,
    globalColorCount,
    paletteColorBits,
    paletteMode,
    paletteVectorCount,
    bitFieldHeaderBits
  ) {
    const localIndexBits = Math.log2(localColorCount);
    const globalIndexBits = Math.log2(globalColorCount);
    const globalPaletteBits = (paletteMode === "vector" ? paletteVectorCount * 2 : globalColorCount) * paletteColorBits;
    const blockPaletteBits = blockCount * localColorCount * globalIndexBits;
    const pixelDataBits = width * height * localIndexBits;
    const payloadBits = globalPaletteBits + blockPaletteBits + pixelDataBits;
    const payloadBytes = Math.ceil(payloadBits / 8);

    return {
      magicBytes: MAGIC_BYTES,
      bitFieldHeaderBits,
      headerBytes: MAGIC_BYTES + bitFieldHeaderBits / 8,
      globalPaletteBits,
      blockPaletteBits,
      pixelDataBits,
      payloadBits,
      payloadBytes,
      paddingBits: payloadBytes * 8 - payloadBits,
      totalBytes: MAGIC_BYTES + bitFieldHeaderBits / 8 + payloadBytes,
    };
  }

  function validateImage(image) {
    if (!image || typeof image !== "object") {
      throw new TypeError("BPAL image must be an object");
    }

    validateMetadata(image);

    const blockSizeExponent = Math.log2(image.blockSize);
    const localIndexBits = Math.log2(image.localColorCount);
    const globalIndexBits = Math.log2(image.globalColorCount);
    const blocksX = Math.ceil(image.width / image.blockSize);
    const blocksY = Math.ceil(image.height / image.blockSize);
    const blockCount = blocksX * blocksY;
    const paletteMode = image.paletteMode || "explicit";
    const vectorColorSpace = image.vectorColorSpace || "rgb";
    const paletteVectorCount = paletteMode === "vector"
      ? Number(image.paletteVectorCount || image.paletteVectors && image.paletteVectors.length)
      : 0;

    if (paletteMode === "explicit" && (!Array.isArray(image.palette) || image.palette.length < image.globalColorCount)) {
      throw new RangeError("BPAL palette is shorter than globalColorCount");
    }

    validatePaletteVectorCount(paletteMode, paletteVectorCount, image.globalColorCount);
    validateVectorColorSpace(vectorColorSpace);

    if (paletteMode === "vector") {
      if (!Array.isArray(image.paletteVectors) || image.paletteVectors.length !== paletteVectorCount) {
        throw new RangeError("BPAL paletteVectors length does not match paletteVectorCount");
      }

      for (let index = 0; index < image.paletteVectors.length; index += 1) {
        const vector = image.paletteVectors[index];

        validateColor(vector && vector.start, `${index} start`);
        validateColor(vector && vector.end, `${index} end`);
      }
    }

    validateIndexArray(
      image.blockPaletteIndices,
      blockCount * image.localColorCount,
      image.globalColorCount,
      "blockPaletteIndices"
    );
    validateIndexArray(
      image.pixelIndices,
      image.width * image.height,
      image.localColorCount,
      "pixelIndices"
    );

    if (paletteMode === "explicit") {
      for (let index = 0; index < image.globalColorCount; index += 1) {
        validateColor(image.palette[index], index);
      }
    }

    return {
      width: image.width,
      height: image.height,
      blockSize: image.blockSize,
      blockSizeExponent,
      blocksX,
      blocksY,
      blockCount,
      localColorCount: image.localColorCount,
      globalColorCount: image.globalColorCount,
      paletteColorBits: image.paletteColorBits,
      paletteMode,
      vectorColorSpace,
      paletteVectorCount,
      paletteVectors: image.paletteVectors || [],
      localIndexBits,
      globalIndexBits,
      palette: image.palette,
      blockPaletteIndices: image.blockPaletteIndices,
      pixelIndices: image.pixelIndices,
    };
  }

  function validatePaletteVectorCount(paletteMode, paletteVectorCount, globalColorCount) {
    if (paletteMode !== "explicit" && paletteMode !== "vector") {
      throw new RangeError(`Unsupported BPAL palette mode: ${paletteMode}`);
    }

    if (
      paletteMode === "vector" &&
      (!Number.isInteger(paletteVectorCount) || paletteVectorCount < 1 || paletteVectorCount > Math.min(512, globalColorCount / 2))
    ) {
      throw new RangeError("BPAL paletteVectorCount is out of range");
    }
  }

  function validateVectorColorSpace(vectorColorSpace) {
    if (vectorColorSpace !== "rgb" && vectorColorSpace !== "oklab") {
      throw new RangeError(`Unsupported BPAL vector color space: ${vectorColorSpace}`);
    }
  }

  function validateMetadata(image) {
    if (!Number.isInteger(image.width) || image.width < 1 || image.width > MAX_DIMENSION) {
      throw new RangeError(`BPAL width must be from 1 to ${MAX_DIMENSION}`);
    }

    if (!Number.isInteger(image.height) || image.height < 1 || image.height > MAX_DIMENSION) {
      throw new RangeError(`BPAL height must be from 1 to ${MAX_DIMENSION}`);
    }

    if (!isPowerOfTwo(image.blockSize) || image.blockSize < 2 || image.blockSize > 64) {
      throw new RangeError("BPAL blockSize must be a power of two from 2 to 64");
    }

    if (!isPowerOfTwo(image.localColorCount) || image.localColorCount < 2 || image.localColorCount > 16) {
      throw new RangeError("BPAL localColorCount must be a power of two from 2 to 16");
    }

    if (!isPowerOfTwo(image.globalColorCount) || image.globalColorCount < 2 || image.globalColorCount > 1024) {
      throw new RangeError("BPAL globalColorCount must be a power of two from 2 to 1024");
    }

    if (image.localColorCount > image.globalColorCount) {
      throw new RangeError("BPAL localColorCount cannot exceed globalColorCount");
    }

    if (image.paletteColorBits !== 16 && image.paletteColorBits !== 24) {
      throw new RangeError("BPAL paletteColorBits must be either 16 or 24");
    }
  }

  function validateIndexArray(values, expectedLength, limit, name) {
    if (!values || typeof values.length !== "number" || values.length !== expectedLength) {
      throw new RangeError(`BPAL ${name} length does not match image metadata`);
    }

    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value >= limit) {
        throw new RangeError(`BPAL ${name} contains an out-of-range index`);
      }
    }
  }

  function validateColor(color, index) {
    if (!color || !isByte(color.r) || !isByte(color.g) || !isByte(color.b)) {
      throw new RangeError(`BPAL palette color ${index} is invalid`);
    }
  }

  function reconstructPixels(
    width,
    height,
    blockSize,
    blocksX,
    localColorCount,
    palette,
    blockPaletteIndices,
    pixelIndices
  ) {
    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const blockX = Math.floor(x / blockSize);
        const blockY = Math.floor(y / blockSize);
        const blockIndex = blockY * blocksX + blockX;
        const paletteOffset = blockIndex * localColorCount;
        const globalIndex = blockPaletteIndices[paletteOffset + pixelIndices[pixel]];
        const color = palette[globalIndex];
        const offset = pixel * 4;

        pixels[offset] = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = 255;
      }
    }

    return pixels;
  }

  function packRgb565(color) {
    const red = Math.round(color.r * 31 / 255);
    const green = Math.round(color.g * 63 / 255);
    const blue = Math.round(color.b * 31 / 255);

    return (red << 11) | (green << 5) | blue;
  }

  function unpackRgb565(value) {
    return createColor(
      Math.round((value >> 11 & 31) * 255 / 31),
      Math.round((value >> 5 & 63) * 255 / 63),
      Math.round((value & 31) * 255 / 31)
    );
  }

  function readColor(reader, paletteColorBits) {
    return paletteColorBits === 16
      ? unpackRgb565(reader.read(16))
      : createColor(reader.read(8), reader.read(8), reader.read(8));
  }

  function interpolatePaletteVectors(vectors, globalColorCount, vectorColorSpace) {
    const palette = [];
    const colorsPerVector = Math.floor(globalColorCount / vectors.length);
    const extraColors = globalColorCount % vectors.length;

    for (let vectorIndex = 0; vectorIndex < vectors.length; vectorIndex += 1) {
      const vector = vectors[vectorIndex];
      const colorCount = colorsPerVector + (vectorIndex < extraColors ? 1 : 0);
      const start = vectorColorSpace === "oklab"
        ? srgbToOklab(vector.start.r, vector.start.g, vector.start.b)
        : [vector.start.r, vector.start.g, vector.start.b];
      const end = vectorColorSpace === "oklab"
        ? srgbToOklab(vector.end.r, vector.end.g, vector.end.b)
        : [vector.end.r, vector.end.g, vector.end.b];

      for (let colorIndex = 0; colorIndex < colorCount; colorIndex += 1) {
        const ratio = colorCount <= 1 ? 0 : colorIndex / (colorCount - 1);
        const point = [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio,
          start[2] + (end[2] - start[2]) * ratio,
        ];
        const channels = vectorColorSpace === "oklab"
          ? oklabToSrgb(point[0], point[1], point[2])
          : point;

        palette.push(createColor(
          clampByte(Math.round(channels[0])),
          clampByte(Math.round(channels[1])),
          clampByte(Math.round(channels[2]))
        ));
      }
    }

    return palette;
  }

  function srgbToOklab(red, green, blue) {
    const redLinear = srgbByteToLinear(red);
    const greenLinear = srgbByteToLinear(green);
    const blueLinear = srgbByteToLinear(blue);
    const l = Math.cbrt(0.4122214708 * redLinear + 0.5363325363 * greenLinear + 0.0514459929 * blueLinear);
    const m = Math.cbrt(0.2119034982 * redLinear + 0.6806995451 * greenLinear + 0.1073969566 * blueLinear);
    const s = Math.cbrt(0.0883024619 * redLinear + 0.2817188376 * greenLinear + 0.6299787005 * blueLinear);

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
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;

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
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function linearToSrgbByte(value) {
    const linear = Math.max(0, Math.min(1, value));
    const normalized = linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * linear ** (1 / 2.4) - 0.055;

    return normalized * 255;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  function createColor(red, green, blue) {
    return {
      r: red,
      g: green,
      b: blue,
      hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
    };
  }

  function toHex(value) {
    return value.toString(16).padStart(2, "0");
  }

  function asUint8Array(input) {
    if (input instanceof Uint8Array) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }

    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }

    throw new TypeError("BPAL input must be an ArrayBuffer or Uint8Array");
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  function isByte(value) {
    return Number.isInteger(value) && value >= 0 && value <= 255;
  }

  class BitWriter {
    constructor(bytes, bitOffset) {
      this.bytes = bytes;
      this.bitOffset = bitOffset;
    }

    write(value, bitCount) {
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** bitCount) {
        throw new RangeError(`Value ${value} does not fit in ${bitCount} bits`);
      }

      if (this.bitOffset + bitCount > this.bytes.length * 8) {
        throw new RangeError("BPAL output buffer is too small");
      }

      for (let bit = bitCount - 1; bit >= 0; bit -= 1) {
        const byteIndex = Math.floor(this.bitOffset / 8);
        const bitInByte = 7 - this.bitOffset % 8;
        const bitValue = Math.floor(value / 2 ** bit) % 2;

        this.bytes[byteIndex] |= bitValue << bitInByte;
        this.bitOffset += 1;
      }
    }
  }

  class BitReader {
    constructor(bytes, bitOffset) {
      this.bytes = bytes;
      this.bitOffset = bitOffset;
    }

    read(bitCount) {
      if (this.bitOffset + bitCount > this.bytes.length * 8) {
        throw new RangeError("Truncated BPAL bit stream");
      }

      let value = 0;

      for (let bit = 0; bit < bitCount; bit += 1) {
        const byteIndex = Math.floor(this.bitOffset / 8);
        const bitInByte = 7 - this.bitOffset % 8;

        value = value * 2 + (this.bytes[byteIndex] >> bitInByte & 1);
        this.bitOffset += 1;
      }

      return value;
    }
  }

  return {
    MAGIC: MAGIC_TEXT,
    VERSION,
    HEADER_BYTES,
    encodeBlockPaletteFile,
    decodeBlockPaletteFile,
    getBlockPaletteFileLayout,
  };
});
