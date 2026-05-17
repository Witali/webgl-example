(function (global) {
  "use strict";

  const ZIG_ZAG = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
  ];

  const GPU_VERTEX_SHADER = `
    attribute vec2 aPosition;

    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const GPU_FRAGMENT_SHADER = `
    precision highp float;

    const float PI = 3.141592653589793;

    uniform vec2 uImageSize;
    uniform int uComponentCount;

    uniform sampler2D uCoeff0;
    uniform sampler2D uCoeff1;
    uniform sampler2D uCoeff2;

    uniform vec2 uCoeffSize0;
    uniform vec2 uCoeffSize1;
    uniform vec2 uCoeffSize2;

    uniform vec2 uSampleScale0;
    uniform vec2 uSampleScale1;
    uniform vec2 uSampleScale2;

    float basis(float local, float frequency) {
      return cos(((2.0 * local + 1.0) * frequency * PI) / 16.0);
    }

    float coefficient(
      sampler2D coeffTexture,
      vec2 coeffSize,
      vec2 block,
      float u,
      float v
    ) {
      vec2 texel = block * 8.0 + vec2(u, v);
      return texture2D(coeffTexture, (texel + 0.5) / coeffSize).r;
    }

    float decodeComponentPixel(
      sampler2D coeffTexture,
      vec2 coeffSize,
      vec2 componentPixel
    ) {
      componentPixel = clamp(componentPixel, vec2(0.0), coeffSize - vec2(1.0));

      vec2 block = floor(componentPixel / 8.0);
      vec2 local = mod(componentPixel, 8.0);
      float value = 0.0;

      for (int row = 0; row < 8; row++) {
        for (int column = 0; column < 8; column++) {
          float u = float(column);
          float v = float(row);
          float scaleU = column == 0 ? 0.70710678118 : 1.0;
          float scaleV = row == 0 ? 0.70710678118 : 1.0;
          float dct = coefficient(coeffTexture, coeffSize, block, u, v);

          value += scaleU * scaleV * dct * basis(local.x, u) * basis(local.y, v);
        }
      }

      return 0.25 * value + 128.0;
    }

    float decodeRoundedComponentPixel(
      sampler2D coeffTexture,
      vec2 coeffSize,
      vec2 componentPixel
    ) {
      return clamp(floor(decodeComponentPixel(coeffTexture, coeffSize, componentPixel) + 0.5), 0.0, 255.0);
    }

    float decodeComponent(
      sampler2D coeffTexture,
      vec2 coeffSize,
      vec2 sampleScale,
      vec2 imagePixel
    ) {
      vec2 sourcePixel = floor(imagePixel);
      vec2 componentCoord = (sourcePixel + vec2(0.5)) * sampleScale - vec2(0.5);
      vec2 p0 = floor(componentCoord);
      vec2 p1 = p0 + vec2(1.0);
      vec2 t = componentCoord - p0;

      p0 = clamp(p0, vec2(0.0), coeffSize - vec2(1.0));
      p1 = clamp(p1, vec2(0.0), coeffSize - vec2(1.0));

      if (p0.x == p1.x) {
        t.x = 0.0;
      }

      if (p0.y == p1.y) {
        t.y = 0.0;
      }

      float v00 = decodeRoundedComponentPixel(coeffTexture, coeffSize, p0);
      float v10 = decodeRoundedComponentPixel(coeffTexture, coeffSize, vec2(p1.x, p0.y));
      float v01 = decodeRoundedComponentPixel(coeffTexture, coeffSize, vec2(p0.x, p1.y));
      float v11 = decodeRoundedComponentPixel(coeffTexture, coeffSize, p1);
      float top = mix(v00, v10, t.x);
      float bottom = mix(v01, v11, t.x);

      return mix(top, bottom, t.y);
    }

    void main() {
      vec2 imagePixel = vec2(gl_FragCoord.x - 0.5, uImageSize.y - gl_FragCoord.y);
      float y = decodeComponent(uCoeff0, uCoeffSize0, uSampleScale0, imagePixel);

      if (uComponentCount == 1) {
        float gray = clamp(y / 255.0, 0.0, 1.0);
        gl_FragColor = vec4(gray, gray, gray, 1.0);
        return;
      }

      float cb = decodeComponent(uCoeff1, uCoeffSize1, uSampleScale1, imagePixel) - 128.0;
      float cr = decodeComponent(uCoeff2, uCoeffSize2, uSampleScale2, imagePixel) - 128.0;

      vec3 rgb = vec3(
        y + 1.402 * cr,
        y - 0.344136286201022 * cb - 0.714136285714286 * cr,
        y + 1.772 * cb
      ) / 255.0;

      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
    }
  `;

  class GpuJpegDecoder {
    constructor(gl) {
      this.gl = gl;
      this.floatTextureExtension = gl.getExtension("OES_texture_float");
      this.programInfo = null;
      this.quadBuffer = null;

      if (!this.floatTextureExtension) {
        throw new Error("GpuJpegDecoder requires the OES_texture_float WebGL extension.");
      }
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch JPEG: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    decode(arrayBuffer) {
      const jpeg = JpegBaselineParser.parse(arrayBuffer);
      return this.renderJpeg(jpeg);
    }

    renderJpeg(jpeg) {
      const gl = this.gl;

      if (jpeg.components.length !== 1 && jpeg.components.length !== 3) {
        throw new Error("GpuJpegDecoder supports grayscale and YCbCr baseline JPEG images.");
      }

      this.ensureProgram();

      const wasDepthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
      const wasCullFaceEnabled = gl.isEnabled(gl.CULL_FACE);
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const previousViewport = gl.getParameter(gl.VIEWPORT);
      const coefficientTextures = jpeg.components.map((component) => {
        return this.createCoefficientTexture(component);
      });
      const outputTexture = this.createOutputTexture(jpeg.width, jpeg.height);
      const framebuffer = gl.createFramebuffer();

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        outputTexture,
        0
      );

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("GpuJpegDecoder could not create a complete output framebuffer.");
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.viewport(0, 0, jpeg.width, jpeg.height);
      gl.useProgram(this.programInfo.program);
      this.bindQuad();
      this.bindCoefficientTextures(jpeg, coefficientTextures);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      coefficientTextures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteFramebuffer(framebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(
        previousViewport[0],
        previousViewport[1],
        previousViewport[2],
        previousViewport[3]
      );

      if (wasDepthTestEnabled) {
        gl.enable(gl.DEPTH_TEST);
      }

      if (wasCullFaceEnabled) {
        gl.enable(gl.CULL_FACE);
      }

      return {
        width: jpeg.width,
        height: jpeg.height,
        texture: outputTexture,
        dispose() {
          gl.deleteTexture(outputTexture);
        },
      };
    }

    ensureProgram() {
      if (this.programInfo) {
        return;
      }

      const gl = this.gl;
      const program = createProgram(gl, GPU_VERTEX_SHADER, GPU_FRAGMENT_SHADER);

      this.programInfo = {
        program,
        attributes: {
          position: gl.getAttribLocation(program, "aPosition"),
        },
        uniforms: {
          imageSize: gl.getUniformLocation(program, "uImageSize"),
          componentCount: gl.getUniformLocation(program, "uComponentCount"),
          coeff0: gl.getUniformLocation(program, "uCoeff0"),
          coeff1: gl.getUniformLocation(program, "uCoeff1"),
          coeff2: gl.getUniformLocation(program, "uCoeff2"),
          coeffSize0: gl.getUniformLocation(program, "uCoeffSize0"),
          coeffSize1: gl.getUniformLocation(program, "uCoeffSize1"),
          coeffSize2: gl.getUniformLocation(program, "uCoeffSize2"),
          sampleScale0: gl.getUniformLocation(program, "uSampleScale0"),
          sampleScale1: gl.getUniformLocation(program, "uSampleScale1"),
          sampleScale2: gl.getUniformLocation(program, "uSampleScale2"),
        },
      };

      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
           1,  1,
        ]),
        gl.STATIC_DRAW
      );
    }

    bindQuad() {
      const gl = this.gl;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.programInfo.attributes.position);
      gl.vertexAttribPointer(
        this.programInfo.attributes.position,
        2,
        gl.FLOAT,
        false,
        0,
        0
      );
    }

    bindCoefficientTextures(jpeg, textures) {
      const gl = this.gl;
      const uniforms = this.programInfo.uniforms;
      const fallbackTexture = textures[0];
      const fallbackComponent = jpeg.components[0];

      gl.uniform2f(uniforms.imageSize, jpeg.width, jpeg.height);
      gl.uniform1i(uniforms.componentCount, jpeg.components.length);

      this.bindComponentTexture(0, uniforms.coeff0, textures[0], fallbackTexture);
      this.bindComponentTexture(1, uniforms.coeff1, textures[1], fallbackTexture);
      this.bindComponentTexture(2, uniforms.coeff2, textures[2], fallbackTexture);

      this.setComponentUniforms(0, jpeg, jpeg.components[0], uniforms.coeffSize0, uniforms.sampleScale0);
      this.setComponentUniforms(1, jpeg, jpeg.components[1] || fallbackComponent, uniforms.coeffSize1, uniforms.sampleScale1);
      this.setComponentUniforms(2, jpeg, jpeg.components[2] || fallbackComponent, uniforms.coeffSize2, uniforms.sampleScale2);
    }

    bindComponentTexture(unit, location, texture, fallbackTexture) {
      const gl = this.gl;

      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture || fallbackTexture);
      gl.uniform1i(location, unit);
    }

    setComponentUniforms(unit, jpeg, component, coeffSizeLocation, sampleScaleLocation) {
      const gl = this.gl;

      gl.uniform2f(
        coeffSizeLocation,
        component.blockCountX * 8,
        component.blockCountY * 8
      );
      gl.uniform2f(
        sampleScaleLocation,
        component.horizontalSampling / jpeg.maxHorizontalSampling,
        component.verticalSampling / jpeg.maxVerticalSampling
      );
    }

    createCoefficientTexture(component) {
      const gl = this.gl;
      const texture = gl.createTexture();
      const width = component.blockCountX * 8;
      const height = component.blockCountY * 8;
      const data = new Float32Array(width * height * 4);

      for (let blockY = 0; blockY < component.blockCountY; blockY += 1) {
        for (let blockX = 0; blockX < component.blockCountX; blockX += 1) {
          const blockOffset = (blockY * component.blockCountX + blockX) * 64;

          for (let row = 0; row < 8; row += 1) {
            for (let column = 0; column < 8; column += 1) {
              const sourceIndex = blockOffset + row * 8 + column;
              const targetIndex = ((blockY * 8 + row) * width + blockX * 8 + column) * 4;

              data[targetIndex] = component.blocks[sourceIndex];
              data[targetIndex + 3] = 1;
            }
          }
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.FLOAT,
        data
      );

      return texture;
    }

    createOutputTexture(width, height) {
      const gl = this.gl;
      const texture = gl.createTexture();

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );

      return texture;
    }

    static parse(arrayBuffer) {
      return JpegBaselineParser.parse(arrayBuffer);
    }
  }

  class JpegBaselineParser {
    constructor(bytes) {
      this.bytes = bytes;
      this.offset = 0;
      this.width = 0;
      this.height = 0;
      this.components = [];
      this.componentById = new Map();
      this.quantizationTables = [];
      this.huffmanTables = [[], []];
      this.restartInterval = 0;
      this.maxHorizontalSampling = 1;
      this.maxVerticalSampling = 1;
      this.blockScratch = new Int32Array(64);
    }

    static parse(arrayBuffer) {
      const bytes = arrayBuffer instanceof Uint8Array
        ? arrayBuffer
        : new Uint8Array(arrayBuffer);
      const parser = new JpegBaselineParser(bytes);

      return parser.parse();
    }

    parse() {
      if (this.readUint8() !== 0xff || this.readUint8() !== 0xd8) {
        throw new Error("Invalid JPEG: missing SOI marker.");
      }

      while (this.offset < this.bytes.length) {
        const marker = this.readMarker();

        if (marker === 0xd9) {
          break;
        }

        if (marker >= 0xd0 && marker <= 0xd7) {
          continue;
        }

        const length = this.readUint16();
        const segmentEnd = this.offset + length - 2;

        switch (marker) {
          case 0xc0:
            this.parseStartOfFrame(segmentEnd);
            break;
          case 0xc2:
            throw new Error("Progressive JPEG is not supported by GpuJpegDecoder.");
          case 0xc4:
            this.parseDefineHuffmanTables(segmentEnd);
            break;
          case 0xdb:
            this.parseDefineQuantizationTables(segmentEnd);
            break;
          case 0xdd:
            this.restartInterval = this.readUint16();
            this.offset = segmentEnd;
            break;
          case 0xda:
            this.parseStartOfScan(segmentEnd);
            break;
          default:
            this.offset = segmentEnd;
            break;
        }
      }

      if (!this.width || !this.height || this.components.length === 0) {
        throw new Error("Invalid JPEG: image metadata was not found.");
      }

      return {
        width: this.width,
        height: this.height,
        components: this.components,
        maxHorizontalSampling: this.maxHorizontalSampling,
        maxVerticalSampling: this.maxVerticalSampling,
      };
    }

    parseStartOfFrame(segmentEnd) {
      const precision = this.readUint8();

      if (precision !== 8) {
        throw new Error("Only 8-bit baseline JPEG images are supported.");
      }

      this.height = this.readUint16();
      this.width = this.readUint16();

      const componentCount = this.readUint8();

      if (componentCount !== 1 && componentCount !== 3) {
        throw new Error("Only grayscale and 3-component YCbCr JPEG images are supported.");
      }

      this.components = [];
      this.componentById.clear();
      this.maxHorizontalSampling = 1;
      this.maxVerticalSampling = 1;

      for (let index = 0; index < componentCount; index += 1) {
        const id = this.readUint8();
        const sampling = this.readUint8();
        const component = {
          id,
          horizontalSampling: sampling >> 4,
          verticalSampling: sampling & 15,
          quantizationTableId: this.readUint8(),
          dcTable: null,
          acTable: null,
          previousDc: 0,
          blockCountX: 0,
          blockCountY: 0,
          blocks: null,
        };

        this.maxHorizontalSampling = Math.max(
          this.maxHorizontalSampling,
          component.horizontalSampling
        );
        this.maxVerticalSampling = Math.max(
          this.maxVerticalSampling,
          component.verticalSampling
        );
        this.components.push(component);
        this.componentById.set(component.id, component);
      }

      this.offset = segmentEnd;
    }

    parseDefineQuantizationTables(segmentEnd) {
      while (this.offset < segmentEnd) {
        const info = this.readUint8();
        const precision = info >> 4;
        const tableId = info & 15;
        const table = new Float32Array(64);

        if (precision !== 0) {
          throw new Error("Only 8-bit JPEG quantization tables are supported.");
        }

        for (let index = 0; index < 64; index += 1) {
          table[ZIG_ZAG[index]] = this.readUint8();
        }

        this.quantizationTables[tableId] = table;
      }
    }

    parseDefineHuffmanTables(segmentEnd) {
      while (this.offset < segmentEnd) {
        const info = this.readUint8();
        const tableClass = info >> 4;
        const tableId = info & 15;
        const counts = new Uint8Array(16);
        let symbolCount = 0;

        for (let index = 0; index < 16; index += 1) {
          counts[index] = this.readUint8();
          symbolCount += counts[index];
        }

        const symbols = new Uint8Array(symbolCount);

        for (let index = 0; index < symbolCount; index += 1) {
          symbols[index] = this.readUint8();
        }

        this.huffmanTables[tableClass][tableId] = buildHuffmanTable(counts, symbols);
      }
    }

    parseStartOfScan(segmentEnd) {
      const scanComponentCount = this.readUint8();
      const scanComponents = [];

      for (let index = 0; index < scanComponentCount; index += 1) {
        const id = this.readUint8();
        const tableInfo = this.readUint8();
        const component = this.componentById.get(id);

        if (!component) {
          throw new Error(`Invalid JPEG: unknown scan component ${id}.`);
        }

        component.dcTable = this.huffmanTables[0][tableInfo >> 4];
        component.acTable = this.huffmanTables[1][tableInfo & 15];

        if (!component.dcTable || !component.acTable) {
          throw new Error("Invalid JPEG: scan references a missing Huffman table.");
        }

        scanComponents.push(component);
      }

      this.offset = segmentEnd;
      this.allocateBlocks();

      const spectralStart = this.bytes[segmentEnd - 3];
      const spectralEnd = this.bytes[segmentEnd - 2];
      const successiveApproximation = this.bytes[segmentEnd - 1];

      if (spectralStart !== 0 || spectralEnd !== 63 || successiveApproximation !== 0) {
        throw new Error("Only sequential baseline JPEG scans are supported.");
      }

      const scanStart = this.offset;
      const scanEnd = this.findScanEnd(scanStart);
      const bitReader = new JpegBitReader(this.bytes, scanStart, scanEnd);

      this.decodeScan(bitReader, scanComponents);
      this.offset = scanEnd;
    }

    allocateBlocks() {
      const mcusX = Math.ceil(this.width / (this.maxHorizontalSampling * 8));
      const mcusY = Math.ceil(this.height / (this.maxVerticalSampling * 8));

      this.components.forEach((component) => {
        component.blockCountX = mcusX * component.horizontalSampling;
        component.blockCountY = mcusY * component.verticalSampling;
        component.blocks = new Float32Array(component.blockCountX * component.blockCountY * 64);
        component.previousDc = 0;
      });
    }

    decodeScan(bitReader, scanComponents) {
      const mcusX = Math.ceil(this.width / (this.maxHorizontalSampling * 8));
      const mcusY = Math.ceil(this.height / (this.maxVerticalSampling * 8));
      let mcuIndex = 0;

      for (let mcuY = 0; mcuY < mcusY; mcuY += 1) {
        for (let mcuX = 0; mcuX < mcusX; mcuX += 1) {
          if (
            this.restartInterval > 0 &&
            mcuIndex > 0 &&
            mcuIndex % this.restartInterval === 0
          ) {
            bitReader.alignToByte();
            this.components.forEach((component) => {
              component.previousDc = 0;
            });
          }

          scanComponents.forEach((component) => {
            for (let localY = 0; localY < component.verticalSampling; localY += 1) {
              for (let localX = 0; localX < component.horizontalSampling; localX += 1) {
                const blockX = mcuX * component.horizontalSampling + localX;
                const blockY = mcuY * component.verticalSampling + localY;
                const blockIndex = blockY * component.blockCountX + blockX;

                this.decodeBlock(bitReader, component, blockIndex);
              }
            }
          });

          mcuIndex += 1;
        }
      }
    }

    decodeBlock(bitReader, component, blockIndex) {
      const coefficients = this.blockScratch;
      const quantizationTable = this.quantizationTables[component.quantizationTableId];
      const blockOffset = blockIndex * 64;

      if (!quantizationTable) {
        throw new Error("Invalid JPEG: missing quantization table.");
      }

      coefficients.fill(0);

      const dcLength = decodeHuffmanValue(bitReader, component.dcTable);
      const dcDiff = receiveAndExtend(bitReader, dcLength);
      const dc = component.previousDc + dcDiff;

      component.previousDc = dc;
      coefficients[0] = dc;

      let coefficientIndex = 1;

      while (coefficientIndex < 64) {
        const value = decodeHuffmanValue(bitReader, component.acTable);
        const runLength = value >> 4;
        const size = value & 15;

        if (size === 0) {
          if (runLength === 15) {
            coefficientIndex += 16;
            continue;
          }

          break;
        }

        coefficientIndex += runLength;

        if (coefficientIndex >= 64) {
          throw new Error("Invalid JPEG: AC coefficient run exceeds block size.");
        }

        coefficients[ZIG_ZAG[coefficientIndex]] = receiveAndExtend(bitReader, size);
        coefficientIndex += 1;
      }

      for (let index = 0; index < 64; index += 1) {
        component.blocks[blockOffset + index] = coefficients[index] * quantizationTable[index];
      }
    }

    findScanEnd(start) {
      let index = start;

      while (index < this.bytes.length - 1) {
        if (this.bytes[index] !== 0xff) {
          index += 1;
          continue;
        }

        let markerOffset = index + 1;

        while (this.bytes[markerOffset] === 0xff) {
          markerOffset += 1;
        }

        const marker = this.bytes[markerOffset];

        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
          index = markerOffset + 1;
          continue;
        }

        return index;
      }

      return this.bytes.length;
    }

    readMarker() {
      while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0xff) {
        this.offset += 1;
      }

      while (this.offset < this.bytes.length && this.bytes[this.offset] === 0xff) {
        this.offset += 1;
      }

      if (this.offset >= this.bytes.length) {
        throw new Error("Invalid JPEG: expected marker.");
      }

      return this.readUint8();
    }

    readUint8() {
      if (this.offset >= this.bytes.length) {
        throw new Error("Invalid JPEG: unexpected end of data.");
      }

      const value = this.bytes[this.offset];
      this.offset += 1;
      return value;
    }

    readUint16() {
      return (this.readUint8() << 8) | this.readUint8();
    }
  }

  class JpegBitReader {
    constructor(bytes, start, end) {
      this.bytes = bytes;
      this.offset = start;
      this.end = end;
      this.bitBuffer = 0;
      this.bitCount = 0;
    }

    readBit() {
      if (this.bitCount === 0) {
        this.bitBuffer = this.readByte();
        this.bitCount = 8;
      }

      this.bitCount -= 1;
      return (this.bitBuffer >> this.bitCount) & 1;
    }

    readBits(count) {
      let value = 0;

      for (let index = 0; index < count; index += 1) {
        value = (value << 1) | this.readBit();
      }

      return value;
    }

    readByte() {
      if (this.offset >= this.end) {
        throw new Error("Invalid JPEG: entropy stream ended unexpectedly.");
      }

      const value = this.bytes[this.offset];
      this.offset += 1;

      if (value !== 0xff) {
        return value;
      }

      let marker = this.bytes[this.offset];
      this.offset += 1;

      while (marker === 0xff && this.offset < this.end) {
        marker = this.bytes[this.offset];
        this.offset += 1;
      }

      if (marker === 0x00) {
        return 0xff;
      }

      if (marker >= 0xd0 && marker <= 0xd7) {
        this.alignToByte();
        return this.readByte();
      }

      throw new Error(`Invalid JPEG: unexpected marker 0xff${marker.toString(16)} in entropy data.`);
    }

    alignToByte() {
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  function buildHuffmanTable(counts, symbols) {
    const lookup = new Map();
    let code = 0;
    let symbolIndex = 0;

    for (let length = 1; length <= 16; length += 1) {
      const count = counts[length - 1];

      for (let index = 0; index < count; index += 1) {
        lookup.set((length << 16) | code, symbols[symbolIndex]);
        code += 1;
        symbolIndex += 1;
      }

      code <<= 1;
    }

    return lookup;
  }

  function decodeHuffmanValue(bitReader, table) {
    let code = 0;

    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | bitReader.readBit();

      if (table.has((length << 16) | code)) {
        return table.get((length << 16) | code);
      }
    }

    throw new Error("Invalid JPEG: bad Huffman code.");
  }

  function receiveAndExtend(bitReader, size) {
    if (size === 0) {
      return 0;
    }

    const value = bitReader.readBits(size);
    const threshold = 1 << (size - 1);

    if (value < threshold) {
      return value - (1 << size) + 1;
    }

    return value;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`GpuJpegDecoder shader program link failed: ${message}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`GpuJpegDecoder shader compile failed: ${message}`);
    }

    return shader;
  }

  global.GpuJpegDecoder = GpuJpegDecoder;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { GpuJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
