/*
 * Purpose: Generate checked-in material maps from an existing texture image.
 * Processing blocks:
 * - Open the source texture in the browser harness and read pixels through Canvas.
 * - Derive height and specular grayscale maps from luminance and local contrast.
 * - Write sibling PNG files next to the source texture without extra image libraries.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { runBrowserPage } = require("./browser-harness");

const projectRoot = path.resolve(__dirname, "..");
const inputPath = path.resolve(projectRoot, process.argv[2] || "assets/stone-texture-wic.jpg");
const outputBase = inputPath.replace(/\.[^/.\\]+$/, "");
const heightPath = `${outputBase}-height.png`;
const specularPath = `${outputBase}-specular.png`;
const browserTexturePath = toBrowserPath(inputPath);

runBrowserPage({
  projectRoot,
  pagePath: "/index.html",
  resultExpression: createResultExpression(browserTexturePath),
  snapshotExpression: "({ readyState: document.readyState, result: window.__materialMapResult || null })",
  timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 120000),
})
  .then((result) => {
    if (!result.ok) {
      throw new Error(result.error || "Material map generation failed.");
    }

    fs.writeFileSync(heightPath, Buffer.from(result.heightPngBase64, "base64"));
    fs.writeFileSync(specularPath, Buffer.from(result.specularPngBase64, "base64"));
    console.log(JSON.stringify({
      source: path.relative(projectRoot, inputPath),
      width: result.width,
      height: result.height,
      heightMap: path.relative(projectRoot, heightPath),
      specularMap: path.relative(projectRoot, specularPath),
    }, null, 2));
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });

function toBrowserPath(filePath) {
  const relativePath = path.relative(projectRoot, filePath);

  if (relativePath.startsWith("..")) {
    throw new Error(`Texture must be inside the project root: ${filePath}`);
  }

  return `/${relativePath.split(path.sep).join("/")}`;
}

function createResultExpression(texturePath) {
  return `(() => {
    if (window.__materialMapResult) {
      return window.__materialMapResult;
    }

    if (window.__materialMapStarted) {
      return null;
    }

    window.__materialMapStarted = true;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const smoothstep = (edge0, edge1, value) => {
      const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

      return t * t * (3 - 2 * t);
    };
    const image = new Image();

    image.addEventListener("load", () => {
      try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const sourceCanvas = document.createElement("canvas");
        const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });

        sourceCanvas.width = width;
        sourceCanvas.height = height;
        sourceContext.drawImage(image, 0, 0);

        const source = sourceContext.getImageData(0, 0, width, height);
        const luminance = new Float32Array(width * height);

        for (let pixel = 0, texel = 0; pixel < source.data.length; pixel += 4, texel += 1) {
          luminance[texel] = (
            source.data[pixel] * 0.2126 +
            source.data[pixel + 1] * 0.7152 +
            source.data[pixel + 2] * 0.0722
          ) / 255;
        }

        const heightImage = sourceContext.createImageData(width, height);
        const specularImage = sourceContext.createImageData(width, height);

        for (let y = 0; y < height; y += 1) {
          const yUp = Math.max(0, y - 1);
          const yDown = Math.min(height - 1, y + 1);

          for (let x = 0; x < width; x += 1) {
            const xLeft = Math.max(0, x - 1);
            const xRight = Math.min(width - 1, x + 1);
            const texel = y * width + x;
            const left = luminance[y * width + xLeft];
            const right = luminance[y * width + xRight];
            const up = luminance[yUp * width + x];
            const down = luminance[yDown * width + x];
            const center = luminance[texel];
            const gradient = Math.hypot(right - left, down - up) * 0.5;
            const heightValue = smoothstep(0.04, 0.96, clamp((center - 0.05) / 0.82 + gradient * 0.18, 0, 1));
            const specularValue = clamp(0.08 + smoothstep(0.24, 0.88, center) * 0.74 + gradient * 1.2, 0, 1);
            const heightByte = Math.round(heightValue * 255);
            const specularByte = Math.round(specularValue * 255);
            const offset = texel * 4;

            heightImage.data[offset] = heightByte;
            heightImage.data[offset + 1] = heightByte;
            heightImage.data[offset + 2] = heightByte;
            heightImage.data[offset + 3] = 255;
            specularImage.data[offset] = specularByte;
            specularImage.data[offset + 1] = specularByte;
            specularImage.data[offset + 2] = specularByte;
            specularImage.data[offset + 3] = 255;
          }
        }

        const heightCanvas = document.createElement("canvas");
        const specularCanvas = document.createElement("canvas");

        heightCanvas.width = width;
        heightCanvas.height = height;
        specularCanvas.width = width;
        specularCanvas.height = height;
        heightCanvas.getContext("2d").putImageData(heightImage, 0, 0);
        specularCanvas.getContext("2d").putImageData(specularImage, 0, 0);

        window.__materialMapResult = {
          ok: true,
          width,
          height,
          heightPngBase64: heightCanvas.toDataURL("image/png").split(",")[1],
          specularPngBase64: specularCanvas.toDataURL("image/png").split(",")[1],
        };
      } catch (error) {
        window.__materialMapResult = { ok: false, error: error && error.message ? error.message : String(error) };
      }
    }, { once: true });
    image.addEventListener("error", () => {
      window.__materialMapResult = { ok: false, error: "Failed to load texture ${texturePath}." };
    }, { once: true });
    image.src = ${JSON.stringify(texturePath)};

    return null;
  })()`;
}
