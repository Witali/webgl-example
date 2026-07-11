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

test("round-trips an RGB888 block-palette image through BPAL v1", () => {
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
  assert.equal(layout.totalBytes, 21);
  assert.deepEqual(Array.from(decoded.pixels), Array.from(result.pixels));
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
  invalidVersion[4] = (invalidVersion[4] & 0x0f) | 0x20;

  assert.throws(() => decodeBlockPaletteFile(invalidMagic), /Invalid BPAL magic/);
  assert.throws(() => decodeBlockPaletteFile(invalidVersion), /Unsupported BPAL version: 2/);
  assert.throws(() => decodeBlockPaletteFile(encoded.slice(0, -1)), /file size does not match/);
});

function pixels(values) {
  return new Uint8ClampedArray(values.flat());
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
