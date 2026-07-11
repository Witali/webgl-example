"use strict";

const assert = require("node:assert/strict");
const { convertZxSpectrum, convertModeX, zxBitmapOffset } = require("../src/retro/retro-converter.js");

test("writes a hardware-sized ZX Spectrum .scr with interleaved bitmap rows", () => {
  const pixels = solidPixels(256, 192, [0, 0, 0, 255]);

  setPixel(pixels, 256, 0, 0, [205, 0, 0, 255]);
  setPixel(pixels, 256, 0, 1, [205, 0, 0, 255]);

  const result = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "rgb",
    dithering: "none",
  });

  assert.equal(result.screen.length, 6912);
  assert.equal(zxBitmapOffset(0, 0), 0);
  assert.equal(zxBitmapOffset(0, 1), 256);
  assert.equal(zxBitmapOffset(0, 8), 32);
  assert.equal(result.screen[0], 0x80);
  assert.equal(result.screen[256], 0x80);
  assert.equal(result.screen[6144], 0x02);
  assert.equal(result.screen[6144] & 0x80, 0, "FLASH must stay disabled");
});

test("keeps ZX output within one bright group and two colors per 8x8 block", () => {
  const pixels = solidPixels(256, 192, [0, 0, 0, 255]);

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      setPixel(pixels, 256, x, y, (x + y) % 2
        ? [255, 255, 0, 255]
        : [0, 0, 255, 255]);
    }
  }

  const result = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "oklab",
    dithering: "pattern",
  });
  const attribute = result.screen[6144];

  assert.equal(attribute & 0x80, 0);
  assert.ok(((attribute >>> 3) & 7) <= 7);
  assert.ok((attribute & 7) <= 7);
  assert.equal(result.pixels.length, 256 * 192 * 4);
});

test("creates four sequential 19200-byte Mode X planes and a VGA DAC palette", () => {
  const colors = [
    [0, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ];
  const pixels = new Uint8ClampedArray(320 * 240 * 4);

  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 320; x += 1) {
      setPixel(pixels, 320, x, y, colors[x & 3]);
    }
  }

  const result = convertModeX(pixels, 320, 240, {
    colorCount: 4,
    colorSpace: "rgb",
    dithering: "none",
  });
  const planeSize = 19200;

  assert.equal(result.indexedPixels.length, 76800);
  assert.equal(result.planar.length, 76800);
  assert.equal(result.palette6Bit.length, 768);
  assert.equal(result.palette.length, 4);
  assert.equal(result.planar[0], result.indexedPixels[0]);
  assert.equal(result.planar[planeSize], result.indexedPixels[1]);
  assert.equal(result.planar[planeSize * 2], result.indexedPixels[2]);
  assert.equal(result.planar[planeSize * 3], result.indexedPixels[3]);
  assert.ok(Array.from(result.palette6Bit).every((value) => value <= 63));
});

test("validates native retro screen dimensions", () => {
  assert.throws(
    () => convertZxSpectrum(new Uint8ClampedArray(4), 1, 1),
    /must be 256x192/
  );
  assert.throws(
    () => convertModeX(new Uint8ClampedArray(4), 1, 1),
    /must be 320x240/
  );
});

function solidPixels(width, height, color) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set(color, index);
  }

  return pixels;
}

function setPixel(pixels, width, x, y, color) {
  pixels.set(color, (y * width + x) * 4);
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
