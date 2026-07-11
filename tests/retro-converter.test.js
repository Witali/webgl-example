"use strict";

const assert = require("node:assert/strict");
const {
  convertZxSpectrum,
  convertModeX,
  zxBitmapOffset,
  getZxPalette,
} = require("../src/retro/retro-converter.js");
const { optimizeZxSpectrum } = require("../src/retro/zx-optimizer.js");

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
  assert.equal(result.hardwarePaletteSize, 15);
  assert.equal(result.paletteSource, "zx-spectrum-native");
});

test("uses only the 15 unique native ZX Spectrum colors", () => {
  const nativePalette = getZxPalette();
  const nativeColors = new Set(nativePalette.map((color) => `${color.r},${color.g},${color.b}`));
  const pixels = new Uint8ClampedArray(256 * 192 * 4);

  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = index / 4;

    pixels[index] = pixel % 256;
    pixels[index + 1] = Math.floor(pixel / 256) % 256;
    pixels[index + 2] = pixel * 13 % 256;
    pixels[index + 3] = 255;
  }

  const result = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "oklab",
    dithering: "floyd-steinberg",
  });

  assert.equal(nativePalette.length, 15);
  assert.equal(nativeColors.size, 15);

  for (let index = 0; index < result.pixels.length; index += 4) {
    const key = `${result.pixels[index]},${result.pixels[index + 1]},${result.pixels[index + 2]}`;

    assert.ok(nativeColors.has(key), `Unexpected non-ZX color: ${key}`);
  }
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

test("mixes a ZX color pair so averaged dithering is closer to brown", () => {
  const brown = [120, 80, 55, 255];
  const pixels = solidPixels(256, 192, brown);
  const plain = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "oklab",
    dithering: "none",
  });
  const bayer2 = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "oklab",
    dithering: "pattern-2x2",
  });
  const bayer4 = convertZxSpectrum(pixels, 256, 192, {
    colorSpace: "oklab",
    dithering: "pattern",
  });

  assert.equal(plain.palette.length, 1);
  assert.equal(bayer2.palette.length, 2);
  assert.equal(bayer4.palette.length, 2);
  assert.ok(averageColorError(bayer2.pixels, brown) < averageColorError(plain.pixels, brown));
  assert.ok(averageColorError(bayer4.pixels, brown) < averageColorError(bayer2.pixels, brown));
  assert.ok(bayer4.palette.every((color) => color.count < 256 * 192 * 0.8));
});

test("optimizes ZX color matching and dithering candidates", () => {
  const pixels = new Uint8ClampedArray(256 * 192 * 4);
  let progressUpdates = 0;

  for (let y = 0; y < 192; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      setPixel(pixels, 256, x, y, [
        Math.round(x / 255 * 180),
        Math.round(y / 191 * 220),
        Math.round((x + y) / 446 * 255),
        255,
      ]);
    }
  }

  const optimization = optimizeZxSpectrum(pixels, 256, 192, {
    colorSpaces: ["rgb"],
    ditheringModes: ["none", "pattern-2x2", "pattern"],
    onProgress() {
      progressUpdates += 1;
    },
  });

  assert.equal(optimization.candidates.length, 3);
  assert.equal(progressUpdates, 3);
  assert.equal(optimization.result.screen.length, 6912);
  assert.equal(optimization.result.optimization.candidateCount, 3);
  assert.equal(optimization.recommended.rank, 1);
  assert.equal(optimization.recommended.colorSpace, "rgb");
  assert.ok(Number.isFinite(optimization.recommended.selectionScore));
  assert.ok(
    optimization.candidates[0].selectionScore <= optimization.candidates[2].selectionScore
  );
  assert.ok(optimization.candidates.some((candidate) => candidate.dithering === "pattern-2x2"));
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

function averageColorError(pixels, target) {
  const average = [0, 0, 0];
  const pixelCount = pixels.length / 4;

  for (let index = 0; index < pixels.length; index += 4) {
    average[0] += pixels[index] / pixelCount;
    average[1] += pixels[index + 1] / pixelCount;
    average[2] += pixels[index + 2] / pixelCount;
  }

  return average.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0);
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
