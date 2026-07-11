"use strict";

const assert = require("node:assert/strict");
const { compressImage } = require("../src/palette/block-palette-codec.js");
const {
  MAGIC,
  VERSION,
  HEADER_BYTES,
  encodeBlockPaletteFile,
  decodeBlockPaletteFile,
  getBlockPaletteFileLayout,
} = require("../src/palette/block-palette-format.js");

test("round-trips an explicit RGB888 block-palette image through BPAL v3", () => {
  const values = [];

  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      values.push([x * 45, y * 80, (x + y) * 30, 255]);
    }
  }

  const result = compressImage(pixels(values), 5, 3, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 8,
    paletteColorBits: 24,
    colorSpace: "rgb",
  });
  const encoded = encodeBlockPaletteFile(result);
  const decoded = decodeBlockPaletteFile(encoded);
  const layout = getBlockPaletteFileLayout(result);

  assert.equal(String.fromCharCode(...encoded.slice(0, 4)), MAGIC);
  assert.equal(decoded.version, VERSION);
  assert.equal(decoded.width, result.width);
  assert.equal(decoded.height, result.height);
  assert.equal(decoded.blockSize, result.blockSize);
  assert.equal(decoded.localColorCount, result.localColorCount);
  assert.equal(decoded.globalColorCount, result.globalColorCount);
  assert.equal(decoded.paletteColorBits, result.paletteColorBits);
  assert.equal(decoded.paletteMode, "explicit");
  assert.deepEqual(Array.from(decoded.blockPaletteIndices), Array.from(result.blockPaletteIndices));
  assert.deepEqual(Array.from(decoded.pixelIndices), Array.from(result.pixelIndices));
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
  assert.equal(encoded.length, layout.totalBytes);
});

test("packs adjacent BPAL payload sections without byte alignment", () => {
  const source = pixels([
    [123, 201, 77, 255], [123, 201, 77, 255],
    [123, 201, 77, 255], [123, 201, 77, 255],
  ]);
  const result = compressImage(source, 2, 2, {
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 4,
    paletteColorBits: 16,
    colorSpace: "rgb",
  });
  const layout = getBlockPaletteFileLayout(result);
  const encoded = encodeBlockPaletteFile(result);
  const decoded = decodeBlockPaletteFile(encoded);

  assert.equal(layout.globalPaletteBits, 64);
  assert.equal(layout.blockPaletteBits, 4);
  assert.equal(layout.pixelDataBits, 4);
  assert.equal(layout.payloadBits, 72);
  assert.equal(layout.payloadBytes, 9);
  assert.equal(layout.headerBytes, HEADER_BYTES);
  assert.equal(layout.totalBytes, 23);
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
});

test("stores vector endpoints and reconstructs the preview palette", () => {
  const values = [];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      values.push([x * 36, y * 36, (x * y % 8) * 36, 255]);
    }
  }

  const result = compressImage(pixels(values), 8, 8, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 32,
    paletteColorBits: 24,
    paletteMode: "vector",
    vectorColorSpace: "rgb",
    vectorDeviation: 0.05,
    colorSpace: "rgb",
  });
  const layout = getBlockPaletteFileLayout(result);
  const encoded = encodeBlockPaletteFile(result);
  const decoded = decodeBlockPaletteFile(encoded);

  assert.equal(decoded.paletteMode, "vector");
  assert.equal(decoded.vectorColorSpace, "rgb");
  assert.equal(decoded.paletteVectorCount, result.paletteVectorCount);
  assert.equal(decoded.paletteVectors.length, result.paletteVectorCount);
  assert.equal(layout.globalPaletteBits, result.paletteVectorCount * 2 * 24);
  assert.deepEqual(decoded.paletteVectors, result.paletteVectors.map((vector) => ({
    start: colorWithoutCodecFields(vector.start),
    end: colorWithoutCodecFields(vector.end),
  })));
  assert.deepEqual(
    decoded.palette.map((color) => color.hex),
    result.palette.map((color) => color.hex)
  );
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
});

test("stores and reconstructs OKLab vector palettes in BPAL v3", () => {
  const values = [];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      values.push([x * 36, y * 36, (7 - x) * 36, 255]);
    }
  }

  const result = compressImage(pixels(values), 8, 8, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 32,
    paletteColorBits: 24,
    paletteMode: "vector",
    vectorColorSpace: "oklab",
    vectorDeviation: 0.02,
    colorSpace: "oklab",
  });
  const decoded = decodeBlockPaletteFile(encodeBlockPaletteFile(result));

  assert.equal(decoded.version, 3);
  assert.equal(decoded.paletteMode, "vector");
  assert.equal(decoded.vectorColorSpace, "oklab");
  assert.deepEqual(
    decoded.palette.map((color) => color.hex),
    result.palette.map((color) => color.hex)
  );
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
});

test("continues to decode legacy RGB-vector BPAL v2 files", () => {
  const values = Array.from({ length: 16 }, (_, index) => {
    const channel = index * 17;

    return [channel, channel, channel, 255];
  });
  const result = compressImage(pixels(values), 4, 4, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 16,
    paletteColorBits: 24,
    paletteMode: "vector",
    vectorColorSpace: "rgb",
    vectorDeviation: 0.02,
    colorSpace: "rgb",
  });
  const encoded = encodeBlockPaletteFile(result);

  encoded[4] = (encoded[4] & 0x0f) | 0x20;

  const decoded = decodeBlockPaletteFile(encoded);

  assert.equal(decoded.version, 2);
  assert.equal(decoded.vectorColorSpace, "rgb");
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
});

test("continues to decode legacy BPAL v1 files", () => {
  const decoded = decodeBlockPaletteFile(createVersion1Fixture());

  assert.equal(decoded.version, 1);
  assert.equal(decoded.paletteMode, "explicit");
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.pixels), [
    255, 0, 0, 255, 0, 0, 255, 255,
    0, 0, 255, 255, 255, 0, 0, 255,
  ]);
});

test("stores and restores 10-bit common-palette indices", () => {
  const palette = Array.from({ length: 1024 }, (_, index) => ({
    r: index & 255,
    g: index >> 2 & 255,
    b: index >> 4 & 255,
  }));
  const image = {
    width: 2,
    height: 2,
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 1024,
    paletteColorBits: 24,
    palette,
    blockPaletteIndices: new Uint16Array([0, 1023]),
    pixelIndices: new Uint8Array([0, 1, 1, 0]),
  };
  const decoded = decodeBlockPaletteFile(encodeBlockPaletteFile(image));

  assert.equal(decoded.globalIndexBits, 10);
  assert.deepEqual(Array.from(decoded.blockPaletteIndices), [0, 1023]);
  assert.deepEqual(Array.from(decoded.pixelIndices), [0, 1, 1, 0]);
  assert.deepEqual(Array.from(decoded.pixels.slice(4, 8)), [255, 255, 63, 255]);
});

test("rejects invalid BPAL magic, versions, and lengths", () => {
  const image = {
    width: 2,
    height: 2,
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 8,
    paletteColorBits: 24,
    palette: Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0 })),
    blockPaletteIndices: new Uint16Array([0, 1]),
    pixelIndices: new Uint8Array([0, 1, 1, 0]),
  };
  const encoded = encodeBlockPaletteFile(image);
  const invalidMagic = encoded.slice();
  const invalidVersion = encoded.slice();

  invalidMagic[0] = 0;
  invalidVersion[4] = (invalidVersion[4] & 0x0f) | 0x40;

  assert.throws(() => decodeBlockPaletteFile(invalidMagic), /Invalid BPAL magic/);
  assert.throws(() => decodeBlockPaletteFile(invalidVersion), /Unsupported BPAL version: 4/);
  assert.throws(() => decodeBlockPaletteFile(encoded.slice(0, -1)), /file size does not match/);
});

function pixels(values) {
  return new Uint8ClampedArray(values.flat());
}

function colorWithoutCodecFields(color) {
  return { r: color.r, g: color.g, b: color.b, hex: color.hex };
}

function createVersion1Fixture() {
  const bits = [];
  const write = (value, count) => {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      bits.push(Math.floor(value / 2 ** bit) % 2);
    }
  };

  write(1, 4); // version
  write(1, 24); // width - 1
  write(1, 24); // height - 1
  write(0, 3); // log2(block size) - 1
  write(0, 2); // log2(local colors) - 1
  write(0, 4); // log2(global colors) - 1
  write(1, 1); // RGB888
  write(0, 2); // reserved
  write(255, 8); write(0, 8); write(0, 8);
  write(0, 8); write(0, 8); write(255, 8);
  write(0, 1); write(1, 1); // block palette
  write(0, 1); write(1, 1); write(1, 1); write(0, 1); // pixels

  const bytes = new Uint8Array(4 + Math.ceil(bits.length / 8));

  bytes.set([0x42, 0x50, 0x41, 0x4c]);

  for (let index = 0; index < bits.length; index += 1) {
    bytes[4 + Math.floor(index / 8)] |= bits[index] << (7 - index % 8);
  }

  return bytes;
}

function test(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
