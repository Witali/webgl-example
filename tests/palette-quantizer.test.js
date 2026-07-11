"use strict";

const assert = require("node:assert/strict");
const { quantizeImage } = require("../palette-quantizer.js");

test("keeps two exact source colors when two clusters are requested", () => {
  const source = pixels([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);
  const result = quantizeImage(source, 2, 2, 2);

  assert.equal(result.uniqueColorCount, 2);
  assert.equal(result.palette.length, 2);
  assert.deepEqual(Array.from(result.pixels), Array.from(source));
  assert.deepEqual(result.palette.map((color) => color.count), [2, 2]);
  assert.equal(result.meanSquaredError, 0);
});

test("uses no more clusters than the number of opaque source colors", () => {
  const result = quantizeImage(pixels([
    [10, 20, 30, 255],
    [10, 20, 30, 128],
  ]), 2, 1, 8);

  assert.equal(result.uniqueColorCount, 1);
  assert.equal(result.palette.length, 1);
  assert.equal(result.palette[0].hex, "#0a141e");
  assert.deepEqual(Array.from(result.pixels), [10, 20, 30, 255, 10, 20, 30, 128]);
});

test("preserves fully transparent pixels", () => {
  const source = pixels([
    [41, 42, 43, 0],
    [250, 100, 10, 255],
  ]);
  const result = quantizeImage(source, 2, 1, 2);

  assert.deepEqual(Array.from(result.pixels.slice(0, 4)), [41, 42, 43, 0]);
  assert.equal(result.uniqueColorCount, 1);
});

test("is deterministic and limits output colors to the requested count", () => {
  const source = pixels([
    [0, 0, 0, 255],
    [30, 30, 30, 255],
    [90, 90, 90, 255],
    [180, 180, 180, 255],
    [255, 255, 255, 255],
  ]);
  const first = quantizeImage(source, 5, 1, 3);
  const second = quantizeImage(source, 5, 1, 3);
  const outputColors = new Set();

  for (let index = 0; index < first.pixels.length; index += 4) {
    outputColors.add(first.pixels.slice(index, index + 3).join(","));
  }

  assert.ok(outputColors.size <= 3);
  assert.deepEqual(first.palette, second.palette);
  assert.deepEqual(Array.from(first.pixels), Array.from(second.pixels));
});

test("supports ordered pattern and Floyd-Steinberg output dithering", () => {
  const values = [];

  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const value = Math.round(x / 15 * 255);

      values.push([value, value, value, 255]);
    }
  }

  const source = pixels(values);
  const plain = quantizeImage(source, 16, 4, 2, { dithering: "none" });
  const pattern = quantizeImage(source, 16, 4, 2, { dithering: "pattern" });
  const floyd = quantizeImage(source, 16, 4, 2, { dithering: "floyd-steinberg" });

  assert.equal(pattern.dithering, "pattern");
  assert.equal(floyd.dithering, "floyd-steinberg");
  assert.notDeepEqual(Array.from(pattern.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(floyd.pixels), Array.from(plain.pixels));
  assertUsesOnlyPaletteColors(pattern);
  assertUsesOnlyPaletteColors(floyd);
});

test("uses OKLab by default and supports explicit RGB clustering", () => {
  const source = pixels([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ]);
  const defaultResult = quantizeImage(source, 2, 1, 1);
  const oklab = quantizeImage(source, 2, 1, 1, { colorSpace: "oklab" });
  const rgb = quantizeImage(source, 2, 1, 1, { colorSpace: "rgb" });

  assert.equal(defaultResult.colorSpace, "oklab");
  assert.equal(oklab.colorSpace, "oklab");
  assert.equal(rgb.colorSpace, "rgb");
  assert.equal(rgb.palette[0].hex, "#808000");
  assert.notEqual(oklab.palette[0].hex, rgb.palette[0].hex);
  assertUsesOnlyPaletteColors(oklab);
  assertUsesOnlyPaletteColors(rgb);
});

test("rejects unknown dithering modes", () => {
  assert.throws(
    () => quantizeImage(pixels([[0, 0, 0, 255]]), 1, 1, 1, { dithering: "random" }),
    /Unsupported dithering mode/
  );
});

test("rejects unknown color spaces", () => {
  assert.throws(
    () => quantizeImage(pixels([[0, 0, 0, 255]]), 1, 1, 1, { colorSpace: "xyz" }),
    /Unsupported color space/
  );
});

test("validates the RGBA buffer dimensions", () => {
  assert.throws(
    () => quantizeImage(new Uint8ClampedArray(3), 1, 1, 2),
    /length does not match/
  );
});

function pixels(values) {
  return new Uint8ClampedArray(values.flat());
}

function assertUsesOnlyPaletteColors(result) {
  const paletteColors = new Set(result.palette.map((color) => `${color.r},${color.g},${color.b}`));

  for (let index = 0; index < result.pixels.length; index += 4) {
    const color = Array.from(result.pixels.slice(index, index + 3)).join(",");

    assert.ok(paletteColors.has(color), `output color ${color} is not in the palette`);
  }
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
