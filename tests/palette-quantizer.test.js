"use strict";

const assert = require("node:assert/strict");
const { quantizeImage } = require("../src/palette/palette-quantizer.js");

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

test("supports Bayer 2x2, Bayer 4x4, and Floyd-Steinberg output dithering", () => {
  const values = [];

  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const value = Math.round(x / 15 * 255);

      values.push([value, value, value, 255]);
    }
  }

  const source = pixels(values);
  const plain = quantizeImage(source, 16, 4, 2, { dithering: "none" });
  const pattern2 = quantizeImage(source, 16, 4, 2, { dithering: "pattern-2x2" });
  const pattern = quantizeImage(source, 16, 4, 2, { dithering: "pattern" });
  const floyd = quantizeImage(source, 16, 4, 2, { dithering: "floyd-steinberg" });

  assert.equal(pattern2.dithering, "pattern-2x2");
  assert.equal(pattern.dithering, "pattern");
  assert.equal(floyd.dithering, "floyd-steinberg");
  assert.notDeepEqual(Array.from(pattern2.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(pattern.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(floyd.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(pattern2.pixels), Array.from(pattern.pixels));
  assertUsesOnlyPaletteColors(pattern2);
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

test("supports K-medians with weighted medians and Manhattan distance", () => {
  const source = pixels([
    [0, 0, 0, 255],
    [100, 100, 100, 255],
    [255, 255, 255, 255],
  ]);
  const means = quantizeImage(source, 3, 1, 1, {
    colorSpace: "rgb",
    clusteringMethod: "k-means",
  });
  const medians = quantizeImage(source, 3, 1, 1, {
    colorSpace: "rgb",
    clusteringMethod: "k-medians",
  });

  assert.equal(means.clusteringMethod, "k-means");
  assert.equal(medians.clusteringMethod, "k-medians");
  assert.equal(means.palette[0].hex, "#767676");
  assert.equal(medians.palette[0].hex, "#646464");
});

test("diversity weighting gives rare hues more influence", () => {
  const values = [];

  for (let index = 0; index < 400; index += 1) {
    values.push([0, 20, 100, 255]);
    values.push([0, 120, 240, 255]);
  }

  for (let index = 0; index < 10; index += 1) {
    values.push([0, 255, 0, 255]);
  }

  const source = pixels(values);
  const accurate = quantizeImage(source, values.length, 1, 2, {
    colorSpace: "oklab",
    diversity: 0,
  });
  const diverse = quantizeImage(source, values.length, 1, 2, {
    colorSpace: "oklab",
    diversity: 1,
  });
  const strongestAccurateGreen = Math.max(...accurate.palette.map(greenDominance));
  const strongestDiverseGreen = Math.max(...diverse.palette.map(greenDominance));

  assert.equal(accurate.diversity, 0);
  assert.equal(diverse.diversity, 1);
  assert.ok(strongestDiverseGreen > strongestAccurateGreen + 40);
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

test("rejects unknown clustering methods", () => {
  assert.throws(
    () => quantizeImage(
      pixels([[0, 0, 0, 255]]),
      1,
      1,
      1,
      { clusteringMethod: "k-medoids" }
    ),
    /Unsupported clustering method/
  );
});

test("rejects diversity values outside the zero-to-one range", () => {
  const source = pixels([[0, 0, 0, 255]]);

  assert.throws(
    () => quantizeImage(source, 1, 1, 1, { diversity: -0.1 }),
    /diversity must be between 0 and 1/
  );
  assert.throws(
    () => quantizeImage(source, 1, 1, 1, { diversity: 1.1 }),
    /diversity must be between 0 and 1/
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

function greenDominance(color) {
  return color.g - (color.r + color.b) / 2;
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
