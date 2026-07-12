"use strict";

const assert = require("node:assert/strict");
const {
  findBalancedBlockPaletteSettings,
  paretoFrontier,
} = require("../src/palette/block-palette-optimizer.js");
const { compressImage } = require("../src/palette/block-palette-codec.js");

test("searches profiles and returns a non-dominated balanced setting", () => {
  const source = new Uint8ClampedArray(16 * 16 * 4);

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const offset = (y * 16 + x) * 4;

      source[offset] = x * 17;
      source[offset + 1] = y * 17;
      source[offset + 2] = (x + y) * 8;
      source[offset + 3] = 255;
    }
  }

  const profiles = [
    { blockSize: 4, localColorCount: 8, globalColorCount: 32, paletteColorBits: 24 },
    { blockSize: 8, localColorCount: 4, globalColorCount: 16, paletteColorBits: 24 },
    { blockSize: 8, localColorCount: 4, globalColorCount: 16, paletteColorBits: 16 },
    { blockSize: 16, localColorCount: 2, globalColorCount: 8, paletteColorBits: 16 },
  ];
  const progress = [];
  const result = findBalancedBlockPaletteSettings(source, 16, 16, {
    profiles,
    colorSpace: "rgb",
    dithering: "none",
    diversity: 0,
  }, (entry) => progress.push(entry));

  assert.equal(result.candidates.length, profiles.length);
  assert.equal(progress.length, profiles.length);
  assert.deepEqual(progress.map((entry) => entry.completed), [1, 2, 3, 4]);
  assert.ok(result.frontier.includes(result.frontier.find((candidate) => (
    candidate.settings.blockSize === result.settings.blockSize &&
    candidate.settings.localColorCount === result.settings.localColorCount &&
    candidate.settings.globalColorCount === result.settings.globalColorCount &&
    candidate.settings.paletteColorBits === result.settings.paletteColorBits
  ))));
  assert.ok(!result.candidates.some((candidate) => (
    candidate.fileBytes < result.selected.fileBytes &&
    candidate.rmse < result.selected.rmse
  )));
});

test("removes settings dominated by both file size and error", () => {
  const best = { fileBytes: 100, rmse: 4 };
  const smaller = { fileBytes: 80, rmse: 8 };
  const dominated = { fileBytes: 120, rmse: 9 };
  const frontier = paretoFrontier([best, smaller, dominated]);

  assert.deepEqual(frontier, [smaller, best]);
});

test("optimizes using explicit-palette storage and the BPAL v3 header", () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255, 85, 85, 85, 255,
    170, 170, 170, 255, 255, 255, 255, 255,
  ]);
  const profile = {
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 8,
    paletteColorBits: 24,
  };
  const options = {
    profiles: [profile],
    colorSpace: "rgb",
  };
  const optimized = findBalancedBlockPaletteSettings(source, 2, 2, options);
  const compressed = compressImage(source, 2, 2, { ...profile, ...options });

  assert.equal(compressed.paletteMode, "explicit");
  assert.equal(compressed.storage.globalPaletteBits, 8 * 24);
  assert.equal(optimized.selected.fileBytes, compressed.storage.totalBytes + 14);
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
