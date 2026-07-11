"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { optimizeZxSpectrum } = require("../src/retro/zx-optimizer.js");

const WIDTH = 256;
const HEIGHT = 192;

main();

function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPath = path.resolve(options.input);
  const outputDirectory = path.resolve(options.output);
  const baseName = sanitizeBaseName(options.name || path.parse(inputPath).name);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zx-optimize-"));

  try {
    const sourceRawPath = path.join(temporaryDirectory, "source.rgba");

    resizeToZx(inputPath, sourceRawPath, options.fit);
    const sourcePixels = new Uint8ClampedArray(fs.readFileSync(sourceRawPath));

    if (sourcePixels.length !== WIDTH * HEIGHT * 4) {
      throw new Error(`FFmpeg produced ${sourcePixels.length} bytes instead of ${WIDTH * HEIGHT * 4}`);
    }

    const optimization = optimizeZxSpectrum(sourcePixels, WIDTH, HEIGHT);
    const outputBase = path.join(outputDirectory, `${baseName}-zx-spectrum`);

    fs.mkdirSync(outputDirectory, { recursive: true });
    writeCandidate(outputBase, optimization.result, temporaryDirectory);
    encodeRgbaPng(sourcePixels, `${outputBase}-source.png`, temporaryDirectory, "source-preview");
    const perceptualOutputBase = `${outputBase}-lowest-perceptual`;

    if (optimization.lowestPerceptual.rank !== optimization.recommended.rank) {
      writeCandidate(
        perceptualOutputBase,
        optimization.lowestPerceptualResult,
        temporaryDirectory
      );
    } else {
      fs.rmSync(`${perceptualOutputBase}.scr`, { force: true });
      fs.rmSync(`${perceptualOutputBase}-preview.png`, { force: true });
    }

    const report = {
      input: inputPath,
      target: { format: "ZX Spectrum .scr", width: WIDTH, height: HEIGHT, fit: options.fit },
      scoring: {
        description: "Spatial OKLab error plus RGB RMSE to discourage large hue shifts",
        formula: "0.05*OKLab(1px) + 0.15*OKLab(2px) + 0.30*OKLab(4px) + 0.50*OKLab(8px) + 0.25*RGB_RMSE(8px)",
      },
      recommended: optimization.recommended,
      lowestPerceptual: optimization.lowestPerceptual,
      candidates: optimization.candidates,
    };

    fs.writeFileSync(`${outputBase}-report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      screen: `${outputBase}.scr`,
      preview: `${outputBase}-preview.png`,
      report: `${outputBase}-report.json`,
      recommended: optimization.recommended,
      lowestPerceptual: optimization.lowestPerceptual,
    }, null, 2));
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList) {
  const options = { input: "", output: "zx-output", name: "", fit: "cover" };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (!argument.startsWith("--") && !options.input) {
      options.input = argument;
      continue;
    }

    if (["--output", "--name", "--fit"].includes(argument)) {
      const value = argumentsList[index + 1];

      if (!value) {
        throw new Error(`${argument} requires a value`);
      }

      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.input) {
    printUsage();
    throw new Error("An input image is required");
  }

  if (!fs.existsSync(options.input)) {
    throw new Error(`Input image does not exist: ${options.input}`);
  }

  if (!["cover", "contain", "stretch"].includes(options.fit)) {
    throw new Error("--fit must be cover, contain, or stretch");
  }

  return options;
}

function printUsage() {
  console.log(
    "Usage: npm run optimize:zx -- <image> [--output directory] [--name base-name] " +
    "[--fit cover|contain|stretch]"
  );
}

function resizeToZx(inputPath, outputPath, fit) {
  const filters = {
    cover: `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT}`,
    contain: `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    stretch: `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
  };

  runFfmpeg([
    "-y", "-loglevel", "error", "-i", inputPath,
    "-vf", filters[fit], "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", outputPath,
  ]);
}

function writeCandidate(outputBase, result, temporaryDirectory) {
  fs.writeFileSync(`${outputBase}.scr`, result.screen);
  encodeRgbaPng(result.pixels, `${outputBase}-preview.png`, temporaryDirectory, path.basename(outputBase));
}

function encodeRgbaPng(pixels, outputPath, temporaryDirectory, temporaryName) {
  const rawPath = path.join(temporaryDirectory, `${temporaryName}.rgba`);

  fs.writeFileSync(rawPath, pixels);
  runFfmpeg([
    "-y", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${WIDTH}x${HEIGHT}`, "-i", rawPath, "-frames:v", "1", "-update", "1", outputPath,
  ]);
}

function runFfmpeg(argumentsList) {
  const result = spawnSync("ffmpeg", argumentsList, { encoding: "utf8" });

  if (result.error) {
    throw new Error(`Unable to run FFmpeg: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`FFmpeg failed:\n${result.stderr || result.stdout}`);
  }
}

function sanitizeBaseName(value) {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

  return sanitized || "image";
}
