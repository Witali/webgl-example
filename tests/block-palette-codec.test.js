"use strict";

const assert = require("node:assert/strict");
const { compressImage } = require("../src/palette/block-palette-codec.js");

test("keeps exact colors when every block can reference them", () => {
  const source = pixels([
    [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255],
    [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255],
  ]);
  const result = compressImage(source, 4, 2, {
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 4,
    colorSpace: "rgb",
  });

  assert.deepEqual(Array.from(result.pixels), Array.from(source));
  assert.equal(result.blocksX, 2);
  assert.equal(result.blocksY, 1);
  assert.equal(result.blockPaletteIndices.length, 4);
  assert.equal(result.pixelIndices.length, 8);
  assert.equal(result.meanSquaredError, 0);
});

test("calculates the tightly packed 256-color, four-color block layout", () => {
  const source = new Uint8ClampedArray(8 * 8 * 4);

  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset + 3] = 255;
  }

  const result = compressImage(source, 8, 8, {
    blockSize: 8,
    localColorCount: 4,
    globalColorCount: 256,
  });

  assert.equal(result.globalIndexBits, 8);
  assert.equal(result.localIndexBits, 2);
  assert.equal(result.storage.globalPaletteBytes, 768);
  assert.equal(result.storage.blockPaletteBytes, 4);
  assert.equal(result.storage.pixelDataBytes, 16);
  assert.equal(result.storage.totalBytes, 788);
});

test("uses only local indices and global palette references that fit the format", () => {
  const values = [];

  for (let index = 0; index < 64; index += 1) {
    values.push([index * 3, 255 - index * 3, index * 2, 255]);
  }

  const result = compressImage(pixels(values), 8, 8, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 16,
  });

  assert.ok(Array.from(result.pixelIndices).every((index) => index < 4));
  assert.ok(Array.from(result.blockPaletteIndices).every((index) => index < 16));
  assert.equal(result.blockCount, 4);
});

test("rejects non-power-of-two format settings", () => {
  const source = pixels([[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);

  assert.throws(
    () => compressImage(source, 2, 2, { blockSize: 3, localColorCount: 2, globalColorCount: 4 }),
    /blockSize must be a power of two/
  );
  assert.throws(
    () => compressImage(source, 2, 2, { blockSize: 2, localColorCount: 3, globalColorCount: 4 }),
    /localColorCount must be a power of two/
  );
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
