(function (global) {
  "use strict";

  const USE_IMAGE_BITMAP = global.WEBP_JS_DECODER_USE_IMAGE_BITMAP === true;
  const USE_IMAGE_DECODER = global.WEBP_JS_DECODER_USE_IMAGE_DECODER === true;

  class JsWebpDecoder {
    static async create() {
      return new JsWebpDecoder();
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch WebP: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    async decode(arrayBuffer) {
      const setupStarted = performance.now();
      const blob = new Blob([arrayBuffer], { type: "image/webp" });
      const setupMs = performance.now() - setupStarted;

      const decodeStarted = performance.now();
      const decoded = await decodeWebpBlob(blob);
      const decodeMs = performance.now() - decodeStarted;

      try {
        const readbackStarted = performance.now();
        const pixels = readDrawablePixels(decoded.drawable, decoded.width, decoded.height);
        const readbackMs = performance.now() - readbackStarted;

        return {
          width: decoded.width,
          height: decoded.height,
          pixels,
          timings: {
            setupMs,
            decodeMs,
            workMs: decodeMs,
            readbackMs,
            totalDecoderMs: setupMs + decodeMs + readbackMs,
            measuresCleanWork: true,
            timedPhase: `JS WebP ${decoded.api}`,
          },
        };
      } finally {
        decoded.close();
      }
    }
  }

  async function decodeWebpBlob(blob) {
    let lastError = null;

    if (USE_IMAGE_DECODER && typeof ImageDecoder === "function") {
      try {
        return await decodeWithImageDecoder(blob);
      } catch (error) {
        lastError = error;
      }
    }

    if (USE_IMAGE_BITMAP && typeof createImageBitmap === "function") {
      try {
        return await decodeWithImageBitmap(blob);
      } catch (error) {
        lastError = error;
      }
    }

    try {
      return await decodeWithImageElement(blob);
    } catch (error) {
      throw lastError || error;
    }
  }

  async function decodeWithImageDecoder(blob) {
    const decoder = new ImageDecoder({
      data: blob,
      type: "image/webp",
    });
    const result = await decoder.decode();
    const frame = result.image;

    return {
      drawable: frame,
      width: frame.displayWidth || frame.codedWidth,
      height: frame.displayHeight || frame.codedHeight,
      api: "ImageDecoder",
      close() {
        frame.close();
        decoder.close();
      },
    };
  }

  async function decodeWithImageBitmap(blob) {
    const bitmap = await createImageBitmap(blob);

    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      api: "createImageBitmap",
      close() {
        bitmap.close();
      },
    };
  }

  function decodeWithImageElement(blob) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(blob);

      image.addEventListener("load", () => {
        resolve({
          drawable: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          api: "HTMLImageElement",
          close() {
            URL.revokeObjectURL(objectUrl);
          },
        });
      }, { once: true });
      image.addEventListener("error", () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to decode WebP image with HTMLImageElement."));
      }, { once: true });
      image.src = objectUrl;
    });
  }

  function readDrawablePixels(drawable, width, height) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = width;
    canvas.height = height;
    context.drawImage(drawable, 0, 0, width, height);

    return new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
  }

  global.JsWebpDecoder = JsWebpDecoder;
})(typeof globalThis !== "undefined" ? globalThis : window);
