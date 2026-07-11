"use strict";

const assert = require("node:assert/strict");
const { compressImage } = require("../src/palette/block-palette-codec.js");

test("uses quality-oriented explicit-palette defaults", () => {
  const source = new Uint8ClampedArray(8 * 8 * 4);

  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset + 3] = 255;
  }

  const result = compressImage(source, 8, 8);

  assert.equal(result.blockSize, 8);
  assert.equal(result.localColorCount, 8);
  assert.equal(result.paletteMode, "explicit");
  assert.equal(result.globalColorCount, 256);
});

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

test("supports 1024-color and 4096-color common palettes", () => {
  const source = new Uint8ClampedArray(8 * 8 * 4);

  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset + 3] = 255;
  }

  const palette1024 = compressImage(source, 8, 8, {
    blockSize: 8,
    localColorCount: 4,
    globalColorCount: 1024,
  });
  const palette4096 = compressImage(source, 8, 8, {
    blockSize: 8,
    localColorCount: 4,
    globalColorCount: 4096,
  });

  assert.equal(palette1024.globalIndexBits, 10);
  assert.equal(palette1024.storage.globalPaletteBytes, 3072);
  assert.equal(palette1024.storage.blockPaletteBytes, 5);
  assert.equal(palette1024.storage.totalBytes, 3093);
  assert.ok(Array.from(palette1024.blockPaletteIndices).every((index) => index < 1024));
  assert.equal(palette4096.globalIndexBits, 12);
  assert.equal(palette4096.storage.globalPaletteBytes, 12288);
  assert.equal(palette4096.storage.blockPaletteBytes, 6);
  assert.equal(palette4096.storage.totalBytes, 12310);
  assert.ok(Array.from(palette4096.blockPaletteIndices).every((index) => index < 4096));
});

test("builds an adaptive multi-vector palette from the requested deviation", () => {
  const values = [];

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      values.push([x * 17, y * 17, x * y % 16 * 17, 255]);
    }
  }

  const settings = {
    blockSize: 8,
    localColorCount: 4,
    globalColorCount: 64,
    paletteColorBits: 24,
    paletteMode: "vector",
    colorSpace: "rgb",
  };
  const precise = compressImage(pixels(values), 16, 16, {
    ...settings,
    vectorDeviation: 0.02,
  });
  const compact = compressImage(pixels(values), 16, 16, {
    ...settings,
    vectorDeviation: 0.10,
  });

  assert.equal(precise.paletteMode, "vector");
  assert.equal(precise.palette.length, settings.globalColorCount);
  assert.ok(precise.paletteVectorCount >= compact.paletteVectorCount);
  assert.equal(precise.paletteVectors.length, precise.paletteVectorCount);
  assert.equal(
    precise.storage.globalPaletteBits,
    precise.paletteVectorCount * 2 * settings.paletteColorBits
  );
  assert.ok(precise.paletteVectors.every((vector) => vector.start && vector.end));
});

test("represents colors on one RGB axis with one stored vector", () => {
  const values = [];

  for (let value = 0; value < 16; value += 1) {
    const channel = value * 17;

    values.push([channel, channel, channel, 255]);
  }

  const result = compressImage(pixels(values), 4, 4, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 16,
    paletteColorBits: 24,
    paletteMode: "vector",
    vectorDeviation: 0.02,
    colorSpace: "rgb",
  });

  assert.equal(result.paletteVectorCount, 1);
  assert.equal(result.storage.globalPaletteBits, 48);
  assert.deepEqual(result.palette[0], {
    r: 0, g: 0, b: 0, hex: "#000000", count: result.palette[0].count, active: true,
  });
  assert.equal(result.palette[15].hex, "#ffffff");
});

test("builds and interpolates adaptive vectors in OKLab", () => {
  const values = [];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      values.push([x * 36, y * 36, (7 - x) * 36, 255]);
    }
  }

  const result = compressImage(pixels(values), 8, 8, {
    blockSize: 4,
    localColorCount: 4,
    globalColorCount: 32,
    paletteColorBits: 24,
    paletteMode: "vector",
    vectorColorSpace: "oklab",
    vectorDeviation: 0.01,
    colorSpace: "oklab",
  });

  assert.equal(result.vectorColorSpace, "oklab");
  assert.equal(result.vectorDeviation, 0.01);
  assert.ok(result.paletteVectorCount > 0);
  assert.equal(result.palette.length, 32);
  assert.ok(result.palette.every((color) => (
    color.r >= 0 && color.r <= 255 &&
    color.g >= 0 && color.g <= 255 &&
    color.b >= 0 && color.b <= 255
  )));
});

test("stores and reconstructs the common palette as RGB565 in 16-bit mode", () => {
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

  assert.equal(result.paletteColorBits, 16);
  assert.deepEqual(Array.from(result.pixels.slice(0, 4)), [123, 202, 74, 255]);
  assert.equal(result.palette[0].hex, "#7bca4a");
  assert.equal(result.storage.globalPaletteBytes, 8);
  assert.equal(result.storage.payloadBits, 72);
  assert.equal(result.storage.totalBytes, 9);
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

test("supports 4x4 and 64x64 block sizes", () => {
  const source = new Uint8ClampedArray(64 * 64 * 4);

  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset] = 80;
    source[offset + 1] = 120;
    source[offset + 2] = 160;
    source[offset + 3] = 255;
  }

  const settings = { localColorCount: 2, globalColorCount: 2 };
  const smallBlocks = compressImage(source, 64, 64, { ...settings, blockSize: 4 });
  const largeBlock = compressImage(source, 64, 64, { ...settings, blockSize: 64 });

  assert.equal(smallBlocks.blockCount, 256);
  assert.equal(largeBlock.blockCount, 1);
  assert.equal(smallBlocks.blockSize, 4);
  assert.equal(largeBlock.blockSize, 64);
});

test("selects block colors by total error instead of frequency alone", () => {
  const values = [];

  for (let index = 0; index < 30; index += 1) {
    values.push([0, 0, 0, 255]);
  }

  for (let index = 0; index < 20; index += 1) {
    values.push([10, 10, 10, 255]);
  }

  for (let index = 0; index < 14; index += 1) {
    values.push([255, 255, 255, 255]);
  }

  const result = compressImage(pixels(values), 8, 8, {
    blockSize: 8,
    localColorCount: 2,
    globalColorCount: 4,
    colorSpace: "rgb",
  });
  const selectedColors = Array.from(result.blockPaletteIndices.slice(0, 2))
    .map((paletteIndex) => result.palette[paletteIndex].hex);

  assert.ok(selectedColors.includes("#ffffff"));
  assert.ok(Math.sqrt(result.meanSquaredError) < 6);
});

test("minimizes source-pixel error when selecting colors for a block", () => {
  const values = [
    ...Array(18).fill([20, 20, 20, 255]),
    ...Array(14).fill([90, 90, 90, 255]),
    ...Array(14).fill([130, 130, 130, 255]),
    ...Array(10).fill([190, 190, 190, 255]),
    ...Array(8).fill([250, 250, 250, 255]),
  ];
  const source = pixels(values);
  const result = compressImage(source, 8, 8, {
    blockSize: 8,
    localColorCount: 2,
    globalColorCount: 8,
    paletteMode: "vector",
    vectorDeviation: 0.01,
    colorSpace: "rgb",
  });
  const selected = Array.from(result.blockPaletteIndices.slice(0, 2));
  const selectionError = blockRgbError(values, selected, result.palette);
  const individuallyNearest = new Set(values.map((value) => nearestRgbPaletteIndex(
    value,
    result.palette.slice(0, result.activeGlobalColorCount)
  )));
  let optimumError = Infinity;

  for (let first = 0; first < result.activeGlobalColorCount; first += 1) {
    for (let second = first + 1; second < result.activeGlobalColorCount; second += 1) {
      optimumError = Math.min(
        optimumError,
        blockRgbError(values, [first, second], result.palette)
      );
    }
  }

  assert.equal(selectionError, optimumError);
  assert.ok(selected.some((paletteIndex) => !individuallyNearest.has(paletteIndex)));
});

test("supports Bayer and Floyd-Steinberg dithering inside block palettes", () => {
  const values = [];

  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const value = Math.round(x / 15 * 255);

      values.push([value, value, value, 255]);
    }
  }

  const source = pixels(values);
  const settings = {
    blockSize: 4,
    localColorCount: 2,
    globalColorCount: 4,
    colorSpace: "rgb",
  };
  const plain = compressImage(source, 16, 4, { ...settings, dithering: "none" });
  const bayer2 = compressImage(source, 16, 4, { ...settings, dithering: "pattern-2x2" });
  const bayer4 = compressImage(source, 16, 4, { ...settings, dithering: "pattern" });
  const floyd = compressImage(source, 16, 4, { ...settings, dithering: "floyd-steinberg" });

  assert.equal(bayer2.dithering, "pattern-2x2");
  assert.equal(bayer4.dithering, "pattern");
  assert.equal(floyd.dithering, "floyd-steinberg");
  assert.notDeepEqual(Array.from(bayer2.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(bayer4.pixels), Array.from(plain.pixels));
  assert.notDeepEqual(Array.from(floyd.pixels), Array.from(plain.pixels));
  assert.ok(Array.from(floyd.pixelIndices).every((index) => index < settings.localColorCount));
});

test("does not diffuse Floyd-Steinberg error across block palette boundaries", () => {
  const leftA = [
    [0, 255, 0, 128],
    [255, 0, 255, 0],
    [128, 255, 128, 0],
    [255, 0, 255, 128],
  ];
  const leftB = [
    [128, 255, 0, 0],
    [255, 0, 255, 0],
    [128, 255, 128, 0],
    [255, 0, 255, 128],
  ];
  const right = [
    [128, 0, 255, 0],
    [255, 0, 255, 128],
    [0, 255, 128, 255],
    [0, 255, 0, 255],
  ];
  const compress = (left) => {
    const values = [];

    for (let y = 0; y < 4; y += 1) {
      for (const value of [...left[y], ...right[y]]) {
        values.push([value, value, value, 255]);
      }
    }

    return compressImage(pixels(values), 8, 4, {
      blockSize: 4,
      localColorCount: 2,
      globalColorCount: 4,
      colorSpace: "rgb",
      dithering: "floyd-steinberg",
    });
  };
  const resultA = compress(leftA);
  const resultB = compress(leftB);
  const rightBlockIndices = (result) => {
    const indices = [];

    for (let y = 0; y < 4; y += 1) {
      indices.push(...result.pixelIndices.slice(y * 8 + 4, y * 8 + 8));
    }

    return indices;
  };

  assert.deepEqual(
    Array.from(resultA.blockPaletteIndices.slice(2, 4)),
    Array.from(resultB.blockPaletteIndices.slice(2, 4))
  );
  assert.deepEqual(rightBlockIndices(resultA), rightBlockIndices(resultB));
});

test("fills every block palette slot with distinct source-adjacent colors", () => {
  const values = [];
  const ramp = [0, 36, 72, 108, 144, 180, 216, 255];

  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const value = x < 12 ? ramp[(x + y * 3) % ramp.length] : 119;

      values.push([value, value, value, 255]);
    }
  }

  for (const dithering of ["none", "pattern", "floyd-steinberg"]) {
    const result = compressImage(pixels(values), 16, 4, {
      blockSize: 4,
      localColorCount: 4,
      globalColorCount: 8,
      colorSpace: "rgb",
      dithering,
    });
    const flatBlockPalette = result.blockPaletteIndices.slice(12, 16);
    const closestToSource = result.palette
      .slice(0, result.activeGlobalColorCount)
      .map((color, index) => ({ index, distance: Math.abs(color.r - 119) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)
      .slice(0, 4)
      .map((entry) => entry.index);

    assert.equal(new Set(flatBlockPalette).size, 4, dithering);
    assert.deepEqual(new Set(flatBlockPalette), new Set(closestToSource), dithering);
  }
});

test("diversity weighting gives rare colors more influence in the common palette", () => {
  const values = [];

  for (let index = 0; index < 400; index += 1) {
    values.push([0, 20, 100, 255]);
    values.push([0, 120, 240, 255]);
  }

  for (let index = 0; index < 10; index += 1) {
    values.push([0, 255, 0, 255]);
  }

  const source = pixels(values);
  const settings = {
    blockSize: 2,
    localColorCount: 2,
    globalColorCount: 2,
    colorSpace: "oklab",
  };
  const accurate = compressImage(source, values.length, 1, { ...settings, diversity: 0 });
  const diverse = compressImage(source, values.length, 1, { ...settings, diversity: 1 });
  const strongestAccurateGreen = Math.max(...accurate.palette.map(greenDominance));
  const strongestDiverseGreen = Math.max(...diverse.palette.map(greenDominance));

  assert.equal(accurate.diversity, 0);
  assert.equal(diverse.diversity, 1);
  assert.ok(strongestDiverseGreen > strongestAccurateGreen + 40);
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
  assert.throws(
    () => compressImage(source, 2, 2, { blockSize: 2, localColorCount: 2, globalColorCount: 8192 }),
    /globalColorCount must be a power of two from 2 to 4096/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      paletteColorBits: 20,
    }),
    /paletteColorBits must be either 16 or 24/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      dithering: "random",
    }),
    /Unsupported dithering mode/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      diversity: 1.1,
    }),
    /diversity must be between 0 and 1/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      paletteMode: "curves",
    }),
    /Unsupported palette mode/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      paletteMode: "vector",
      vectorDeviation: 0.005,
    }),
    /vectorDeviation must be between 0.01 and 0.5/
  );
  assert.throws(
    () => compressImage(source, 2, 2, {
      blockSize: 2,
      localColorCount: 2,
      globalColorCount: 4,
      paletteMode: "vector",
      vectorColorSpace: "xyz",
    }),
    /Unsupported vector color space/
  );
});

function blockRgbError(values, paletteIndices, palette) {
  let error = 0;

  for (const value of values) {
    let nearest = Infinity;

    for (const paletteIndex of paletteIndices) {
      const color = palette[paletteIndex];
      const red = value[0] - color.r;
      const green = value[1] - color.g;
      const blue = value[2] - color.b;

      nearest = Math.min(nearest, red * red + green * green + blue * blue);
    }

    error += nearest;
  }

  return error;
}

function nearestRgbPaletteIndex(value, palette) {
  let bestIndex = 0;
  let bestError = Infinity;

  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    const red = value[0] - color.r;
    const green = value[1] - color.g;
    const blue = value[2] - color.b;
    const error = red * red + green * green + blue * blue;

    if (error < bestError) {
      bestIndex = index;
      bestError = error;
    }
  }

  return bestIndex;
}

function pixels(values) {
  return new Uint8ClampedArray(values.flat());
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
