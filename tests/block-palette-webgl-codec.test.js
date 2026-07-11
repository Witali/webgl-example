"use strict";

const assert = require("node:assert/strict");
const { compressImageWebGL } = require("../src/palette/block-palette-webgl-codec.js");

test("falls back to the CPU codec when WebGL2 is unavailable", () => {
  const source = new Uint8ClampedArray(4 * 4 * 4);

  for (let pixel = 0; pixel < 16; pixel += 1) {
    const offset = pixel * 4;

    source[offset] = pixel * 16;
    source[offset + 1] = 255 - pixel * 16;
    source[offset + 2] = pixel * 8;
    source[offset + 3] = 255;
  }

  const result = compressImageWebGL(source, 4, 4, {
    blockSize: 4,
    localColorCount: 2,
    globalColorCount: 8,
    paletteColorBits: 24,
    colorSpace: "rgb",
  });

  assert.equal(result.algorithm, "cpu-fallback");
  assert.deepEqual(result.acceleratedStages, []);
  assert.ok(result.fallbackReason.length > 0);
  assert.equal(result.pixels.length, source.length);
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
