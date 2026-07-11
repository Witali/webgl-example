"use strict";

const assert = require("node:assert/strict");
const { encodeBlockPaletteFile } = require("../src/palette/block-palette-format.js");
const {
  decode,
  createShaderTextureData,
  createMipmappedShaderTextureData,
} = require("../src/decoders/bpal-texture.js");

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

test("packs BPAL double indices into WebGL shader atlases", () => {
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
  const shaderTexture = createShaderTextureData(decode(bytes), 4);

  assert.deepEqual(
    [shaderTexture.pixelAtlas.width, shaderTexture.pixelAtlas.height],
    [4, 1]
  );
  assert.deepEqual(Array.from(shaderTexture.pixelAtlas.data), [0, 1, 1, 0]);
  assert.deepEqual(
    Array.from(shaderTexture.blockPaletteAtlas.data.slice(0, 8)),
    [0, 0, 0, 255, 1, 0, 0, 255]
  );
  assert.deepEqual(
    Array.from(shaderTexture.paletteAtlas.data.slice(0, 8)),
    [12, 34, 56, 255, 210, 180, 90, 255]
  );
});

test("rejects BPAL shader atlases larger than the WebGL texture limit", () => {
  assert.throws(
    () => createShaderTextureData({
      width: 3,
      height: 2,
      blockSize: 2,
      blocksX: 2,
      localColorCount: 2,
      pixelIndices: new Uint8Array(6),
      blockPaletteIndices: new Uint16Array(4),
      palette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }],
    }, 2),
    /exceeds the WebGL texture size limit/
  );
});

test("builds independently indexed BPAL mip levels for shader filtering", () => {
  const bytes = encodeBlockPaletteFile({
    width: 4,
    height: 4,
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 2,
    paletteColorBits: 24,
    paletteMode: "explicit",
    palette: [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ],
    blockPaletteIndices: new Uint16Array([
      0, 1, 0, 1,
      0, 1, 0, 1,
    ]),
    pixelIndices: new Uint8Array([
      0, 0, 1, 1,
      0, 0, 1, 1,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]),
  });
  const mipmapped = createMipmappedShaderTextureData(decode(bytes), 64);

  assert.equal(mipmapped.mipCount, 3);
  assert.deepEqual(
    mipmapped.levels.map((level) => [level.width, level.height]),
    [[4, 4], [2, 2], [1, 1]]
  );
  assert.deepEqual(
    mipmapped.levels.map((level) => level.pixelOffset),
    [0, 16, 20]
  );
  assert.ok(mipmapped.pixelAtlas.data.length >= 21);
  assert.ok(mipmapped.blockPaletteAtlas.data.length >= 12 * 4);
  assert.equal(
    mipmapped.gpuBytes,
    mipmapped.pixelAtlas.data.byteLength +
      mipmapped.blockPaletteAtlas.data.byteLength +
      mipmapped.paletteAtlas.data.byteLength
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
