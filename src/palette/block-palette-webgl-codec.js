(function (root, factory) {
  "use strict";

  const blockPaletteCodec = typeof module === "object" && module.exports
    ? require("./block-palette-codec.js")
    : root.BlockPaletteCodec;
  const api = factory(blockPaletteCodec);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BlockPaletteWebGLCodec = api;
})(typeof self !== "undefined" ? self : globalThis, function (blockPaletteCodec) {
  "use strict";

  const VERTEX_SHADER = `#version 300 es
    const vec2 POSITIONS[3] = vec2[3](
      vec2(-1.0, -1.0),
      vec2(3.0, -1.0),
      vec2(-1.0, 3.0)
    );

    void main() {
      gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
    }
  `;

  const COLOR_FUNCTIONS = `
    vec3 srgbToLinear(vec3 color) {
      vec3 low = color / 12.92;
      vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));
      return mix(high, low, lessThanEqual(color, vec3(0.04045)));
    }

    vec3 srgbToOklab(vec3 color) {
      vec3 linear = srgbToLinear(color);
      float l = 0.4122214708 * linear.r + 0.5363325363 * linear.g + 0.0514459929 * linear.b;
      float m = 0.2119034982 * linear.r + 0.6806995451 * linear.g + 0.1073969566 * linear.b;
      float s = 0.0883024619 * linear.r + 0.2817188376 * linear.g + 0.6299787005 * linear.b;
      float lRoot = pow(max(l, 0.0), 1.0 / 3.0);
      float mRoot = pow(max(m, 0.0), 1.0 / 3.0);
      float sRoot = pow(max(s, 0.0), 1.0 / 3.0);

      return vec3(
        0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
        1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
        0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot
      );
    }

    vec3 colorPoint(vec3 color, int colorSpace) {
      return colorSpace == 1 ? srgbToOklab(color) : color;
    }

    float colorDistance(vec3 left, vec3 right) {
      vec3 difference = left - right;
      return dot(difference, difference);
    }
  `;

  const GLOBAL_ASSIGNMENT_SHADER = `#version 300 es
    precision highp float;
    precision highp int;

    uniform sampler2D u_source;
    uniform sampler2D u_palette;
    uniform int u_paletteSize;
    uniform int u_colorSpace;
    out vec4 outputColor;

    ${COLOR_FUNCTIONS}

    void main() {
      ivec2 coordinate = ivec2(gl_FragCoord.xy);
      vec4 sourceColor = texelFetch(u_source, coordinate, 0);

      if (sourceColor.a == 0.0) {
        outputColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec3 sourcePoint = colorPoint(sourceColor.rgb, u_colorSpace);
      int bestIndex = 0;
      vec3 firstColor = texelFetch(u_palette, ivec2(0, 0), 0).rgb;
      float bestDistance = colorDistance(sourcePoint, colorPoint(firstColor, u_colorSpace));

      for (int index = 1; index < 1024; index += 1) {
        if (index >= u_paletteSize) {
          break;
        }

        vec3 paletteColor = texelFetch(u_palette, ivec2(index, 0), 0).rgb;
        float distance = colorDistance(sourcePoint, colorPoint(paletteColor, u_colorSpace));

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      outputColor = vec4(
        float(bestIndex & 255) / 255.0,
        float((bestIndex >> 8) & 255) / 255.0,
        0.0,
        1.0
      );
    }
  `;

  const BLOCK_ENCODING_SHADER = `#version 300 es
    precision highp float;
    precision highp int;

    uniform sampler2D u_source;
    uniform sampler2D u_palette;
    uniform sampler2D u_blockPalettes;
    uniform int u_width;
    uniform int u_blockSize;
    uniform int u_blocksX;
    uniform int u_localColorCount;
    uniform int u_blockPaletteWidth;
    uniform int u_colorSpace;
    uniform int u_dithering;
    layout(location = 0) out vec4 outputPixel;
    layout(location = 1) out vec4 outputIndex;

    const int BAYER_2X2[4] = int[4](0, 2, 3, 1);
    const int BAYER_4X4[16] = int[16](
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5
    );

    ${COLOR_FUNCTIONS}

    int readGlobalIndex(int blockIndex, int localIndex) {
      int linearIndex = blockIndex * u_localColorCount + localIndex;
      ivec2 coordinate = ivec2(
        linearIndex % u_blockPaletteWidth,
        linearIndex / u_blockPaletteWidth
      );
      ivec4 encoded = ivec4(round(texelFetch(u_blockPalettes, coordinate, 0) * 255.0));
      return encoded.r | (encoded.g << 8);
    }

    float patternThreshold(ivec2 coordinate) {
      if (u_dithering == 1) {
        int index = (coordinate.y % 2) * 2 + coordinate.x % 2;
        return ((float(BAYER_2X2[index]) + 0.5) / 4.0 - 0.5) * (48.0 / 255.0);
      }

      if (u_dithering == 2) {
        int index = (coordinate.y % 4) * 4 + coordinate.x % 4;
        return ((float(BAYER_4X4[index]) + 0.5) / 16.0 - 0.5) * (48.0 / 255.0);
      }

      return 0.0;
    }

    void main() {
      ivec2 coordinate = ivec2(gl_FragCoord.xy);
      vec4 sourceColor = texelFetch(u_source, coordinate, 0);

      if (sourceColor.a == 0.0) {
        outputPixel = sourceColor;
        outputIndex = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec3 correctedColor = clamp(
        sourceColor.rgb + vec3(patternThreshold(coordinate)),
        0.0,
        1.0
      );
      vec3 sourcePoint = colorPoint(correctedColor, u_colorSpace);
      int blockX = coordinate.x / u_blockSize;
      int blockY = coordinate.y / u_blockSize;
      int blockIndex = blockY * u_blocksX + blockX;
      int bestLocalIndex = 0;
      int bestGlobalIndex = readGlobalIndex(blockIndex, 0);
      vec3 bestColor = texelFetch(u_palette, ivec2(bestGlobalIndex, 0), 0).rgb;
      float bestDistance = colorDistance(sourcePoint, colorPoint(bestColor, u_colorSpace));

      for (int localIndex = 1; localIndex < 16; localIndex += 1) {
        if (localIndex >= u_localColorCount) {
          break;
        }

        int globalIndex = readGlobalIndex(blockIndex, localIndex);
        vec3 paletteColor = texelFetch(u_palette, ivec2(globalIndex, 0), 0).rgb;
        float distance = colorDistance(sourcePoint, colorPoint(paletteColor, u_colorSpace));

        if (distance < bestDistance) {
          bestDistance = distance;
          bestLocalIndex = localIndex;
          bestGlobalIndex = globalIndex;
          bestColor = paletteColor;
        }
      }

      outputPixel = vec4(bestColor, sourceColor.a);
      outputIndex = vec4(float(bestLocalIndex) / 255.0, 0.0, 0.0, 1.0);
    }
  `;

  function compressImageWebGL(sourcePixels, width, height, settings) {
    const options = settings || {};
    let accelerator = null;

    try {
      accelerator = createWebGLAccelerator(width, height);
      const result = blockPaletteCodec.compressImage(sourcePixels, width, height, {
        ...options,
        accelerator,
      });

      const usesCpuErrorDiffusion = options.dithering === "floyd-steinberg";

      result.algorithm = usesCpuErrorDiffusion ? "webgl-hybrid" : "webgl";
      result.acceleratedStages = usesCpuErrorDiffusion
        ? ["global-assignments"]
        : ["global-assignments", "block-encoding"];

      return result;
    } catch (error) {
      if (options.webglFallback === false) {
        throw error;
      }

      const cpuOptions = { ...options };

      delete cpuOptions.accelerator;
      delete cpuOptions.webglFallback;

      const result = blockPaletteCodec.compressImage(
        sourcePixels,
        width,
        height,
        cpuOptions
      );

      result.algorithm = "cpu-fallback";
      result.acceleratedStages = [];
      result.fallbackReason = error && error.message ? error.message : String(error);

      return result;
    } finally {
      if (accelerator) {
        accelerator.dispose();
      }
    }
  }

  function createWebGLAccelerator(width, height) {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is unavailable");
    }

    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      stencil: false,
    });

    if (!gl) {
      throw new Error("WebGL2 is unavailable");
    }

    const maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    if (width > maximumTextureSize || height > maximumTextureSize) {
      throw new RangeError(`Image exceeds WebGL2 texture limit ${maximumTextureSize}`);
    }

    return {
      mapGlobalAssignments(args) {
        return mapGlobalAssignments(gl, maximumTextureSize, args);
      },
      encodeBlocks(args) {
        return encodeBlocks(gl, maximumTextureSize, args);
      },
      dispose() {
        const loseContext = gl.getExtension("WEBGL_lose_context");

        if (loseContext) {
          loseContext.loseContext();
        }
      },
    };
  }

  function mapGlobalAssignments(gl, maximumTextureSize, args) {
    const { sourcePixels, width, height, palette, colorSpace } = args;

    if (palette.length > maximumTextureSize) {
      throw new RangeError("Global palette exceeds WebGL2 texture width");
    }

    const program = createProgram(gl, GLOBAL_ASSIGNMENT_SHADER);
    const sourceTexture = createTexture(gl, width, height, sourcePixels);
    const paletteTexture = createPaletteTexture(gl, palette);
    const outputTexture = createRenderTexture(gl, width, height);
    const framebuffer = createFramebuffer(gl, [outputTexture]);
    const output = new Uint8Array(width * height * 4);

    try {
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      bindTexture(gl, program, "u_source", sourceTexture, 0);
      bindTexture(gl, program, "u_palette", paletteTexture, 1);
      gl.uniform1i(gl.getUniformLocation(program, "u_paletteSize"), palette.length);
      gl.uniform1i(gl.getUniformLocation(program, "u_colorSpace"), colorSpace === "oklab" ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output);

      const assignments = new Uint16Array(width * height);

      for (let pixel = 0; pixel < assignments.length; pixel += 1) {
        const offset = pixel * 4;

        assignments[pixel] = output[offset] | output[offset + 1] << 8;
      }

      return assignments;
    } finally {
      deleteResources(gl, [sourceTexture, paletteTexture, outputTexture], framebuffer, program);
    }
  }

  function encodeBlocks(gl, maximumTextureSize, args) {
    const {
      sourcePixels,
      width,
      height,
      blockSize,
      blocksX,
      localColorCount,
      blockPaletteIndices,
      palette,
      colorSpace,
      dithering,
    } = args;
    const program = createProgram(gl, BLOCK_ENCODING_SHADER);
    const sourceTexture = createTexture(gl, width, height, sourcePixels);
    const paletteTexture = createPaletteTexture(gl, palette);
    const packedBlockPalette = packIndexTexture(blockPaletteIndices, maximumTextureSize);
    const blockPaletteTexture = createTexture(
      gl,
      packedBlockPalette.width,
      packedBlockPalette.height,
      packedBlockPalette.data
    );
    const pixelTexture = createRenderTexture(gl, width, height);
    const indexTexture = createRenderTexture(gl, width, height);
    const framebuffer = createFramebuffer(gl, [pixelTexture, indexTexture]);
    const pixelBytes = new Uint8Array(width * height * 4);
    const indexBytes = new Uint8Array(width * height * 4);

    try {
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      bindTexture(gl, program, "u_source", sourceTexture, 0);
      bindTexture(gl, program, "u_palette", paletteTexture, 1);
      bindTexture(gl, program, "u_blockPalettes", blockPaletteTexture, 2);
      gl.uniform1i(gl.getUniformLocation(program, "u_width"), width);
      gl.uniform1i(gl.getUniformLocation(program, "u_blockSize"), blockSize);
      gl.uniform1i(gl.getUniformLocation(program, "u_blocksX"), blocksX);
      gl.uniform1i(gl.getUniformLocation(program, "u_localColorCount"), localColorCount);
      gl.uniform1i(gl.getUniformLocation(program, "u_blockPaletteWidth"), packedBlockPalette.width);
      gl.uniform1i(gl.getUniformLocation(program, "u_colorSpace"), colorSpace === "oklab" ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(program, "u_dithering"), getDitheringCode(dithering));
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixelBytes);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, indexBytes);

      const pixelIndices = new Uint8Array(width * height);

      for (let pixel = 0; pixel < pixelIndices.length; pixel += 1) {
        pixelIndices[pixel] = indexBytes[pixel * 4];
      }

      return {
        pixels: new Uint8ClampedArray(pixelBytes),
        pixelIndices,
      };
    } finally {
      deleteResources(
        gl,
        [sourceTexture, paletteTexture, blockPaletteTexture, pixelTexture, indexTexture],
        framebuffer,
        program
      );
    }
  }

  function createProgram(gl, fragmentSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown WebGL2 link error";

      gl.deleteProgram(program);
      throw new Error(message);
    }

    return program;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown WebGL2 shader error";

      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function createTexture(gl, width, height, data) {
    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );

    return texture;
  }

  function createRenderTexture(gl, width, height) {
    return createTexture(gl, width, height, null);
  }

  function createPaletteTexture(gl, palette) {
    const data = new Uint8Array(palette.length * 4);

    for (let index = 0; index < palette.length; index += 1) {
      const offset = index * 4;

      data[offset] = palette[index].r;
      data[offset + 1] = palette[index].g;
      data[offset + 2] = palette[index].b;
      data[offset + 3] = 255;
    }

    return createTexture(gl, palette.length, 1, data);
  }

  function packIndexTexture(indices, maximumTextureSize) {
    const width = Math.min(maximumTextureSize, 2048, Math.max(1, indices.length));
    const height = Math.ceil(indices.length / width);

    if (height > maximumTextureSize) {
      throw new RangeError("Block palettes exceed WebGL2 texture capacity");
    }

    const data = new Uint8Array(width * height * 4);

    for (let index = 0; index < indices.length; index += 1) {
      const offset = index * 4;

      data[offset] = indices[index] & 255;
      data[offset + 1] = indices[index] >> 8 & 255;
      data[offset + 3] = 255;
    }

    return { width, height, data };
  }

  function createFramebuffer(gl, textures) {
    const framebuffer = gl.createFramebuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    for (let index = 0; index < textures.length; index += 1) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + index,
        gl.TEXTURE_2D,
        textures[index],
        0
      );
    }

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      throw new Error("WebGL2 framebuffer is incomplete");
    }

    return framebuffer;
  }

  function bindTexture(gl, program, uniformName, texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, uniformName), unit);
  }

  function deleteResources(gl, textures, framebuffer, program) {
    for (const texture of textures) {
      gl.deleteTexture(texture);
    }

    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(program);
  }

  function getDitheringCode(dithering) {
    if (dithering === "pattern-2x2") {
      return 1;
    }

    if (dithering === "pattern") {
      return 2;
    }

    return 0;
  }

  return {
    compressImageWebGL,
    createWebGLAccelerator,
  };
});
