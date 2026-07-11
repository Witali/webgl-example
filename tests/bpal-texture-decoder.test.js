"use strict";

const assert = require("node:assert/strict");
const { encodeBlockPaletteFile } = require("../src/palette/block-palette-format.js");
const { decode } = require("../src/decoders/bpal-texture.js");

test("decodes a BPAL file into uploadable RGBA texture pixels", () => {
  const bytes = encodeBlockPaletteFile({
    width: 2,
    height: 2,
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 2,
    paletteColorBits: 24,
    paletteMode: "explicit",
    palette: [
      { r: 12, g: 34, b: 56 },
      { r: 210, g: 180, b: 90 },
    ],
    blockPaletteIndices: new Uint16Array([0, 1]),
    pixelIndices: new Uint8Array([0, 1, 1, 0]),
  });
  const texture = decode(bytes);

  assert.equal(texture.width, 2);
  assert.equal(texture.height, 2);
  assert.equal(texture.version, 3);
  assert.equal(texture.localColorCount, 2);
  assert.equal(texture.globalColorCount, 2);
  assert.equal(texture.paletteMode, "explicit");
  assert.ok(texture.pixels instanceof Uint8ClampedArray);
  assert.deepEqual(Array.from(texture.pixels), [
    12, 34, 56, 255,
    210, 180, 90, 255,
    210, 180, 90, 255,
    12, 34, 56, 255,
  ]);
});

test("rejects a non-BPAL texture file", () => {
  assert.throws(
    () => decode(new Uint8Array([0, 1, 2, 3, 4, 5])),
    /Invalid BPAL magic/
  );
});

function test(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
