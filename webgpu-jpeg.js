(function (global) {
  "use strict";

  const ZIG_ZAG = new Uint32Array([
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
  ]);

  const COMPONENT_STRIDE = 8;
  const SCAN_STRIDE = 3;
  const HUFFMAN_TABLE_SLOTS = 8;
  const HUFFMAN_CODE_LENGTHS = 17;
  const HUFFMAN_SYMBOL_STRIDE = 256;
  const META_PARAM_OFFSET = 0;
  const META_QUANT_OFFSET = 16;
  const META_COMPONENT_OFFSET = META_QUANT_OFFSET + 4 * 64;
  const META_SCAN_OFFSET = META_COMPONENT_OFFSET + 3 * COMPONENT_STRIDE;
  const META_LENGTH = META_SCAN_OFFSET + 3 * SCAN_STRIDE;

  const ENTROPY_SHADER = `
    @group(0) @binding(0) var<storage, read> jpegBytes: array<u32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read> huffMin: array<i32>;
    @group(0) @binding(3) var<storage, read> huffMax: array<i32>;
    @group(0) @binding(4) var<storage, read> huffValOffset: array<i32>;
    @group(0) @binding(5) var<storage, read> huffSymbols: array<i32>;
    @group(0) @binding(6) var<storage, read_write> coeffs: array<i32>;

    const ZIG_ZAG = array<u32, 64>(
      0u, 1u, 8u, 16u, 9u, 2u, 3u, 10u,
      17u, 24u, 32u, 25u, 18u, 11u, 4u, 5u,
      12u, 19u, 26u, 33u, 40u, 48u, 41u, 34u,
      27u, 20u, 13u, 6u, 7u, 14u, 21u, 28u,
      35u, 42u, 49u, 56u, 57u, 50u, 43u, 36u,
      29u, 22u, 15u, 23u, 30u, 37u, 44u, 51u,
      58u, 59u, 52u, 45u, 38u, 31u, 39u, 46u,
      53u, 60u, 61u, 54u, 47u, 55u, 62u, 63u
    );

    var<private> entropyOffset: u32;
    var<private> bitBuffer: u32;
    var<private> bitCount: u32;
    var<private> previousDc0: i32;
    var<private> previousDc1: i32;
    var<private> previousDc2: i32;

    fn param(index: u32) -> u32 {
      return u32(jpegMeta[index]);
    }

    fn quant(index: u32) -> i32 {
      return jpegMeta[16u + index];
    }

    fn component(componentIndex: u32, field: u32) -> i32 {
      return jpegMeta[272u + componentIndex * 8u + field];
    }

    fn scanComponent(scanIndex: u32, field: u32) -> i32 {
      return jpegMeta[296u + scanIndex * 3u + field];
    }

    fn readEntropyByte() -> u32 {
      loop {
        if (entropyOffset >= param(9u)) {
          return 0u;
        }

        let value = jpegBytes[entropyOffset];
        entropyOffset = entropyOffset + 1u;

        if (value != 255u) {
          return value;
        }

        var marker = 255u;

        loop {
          if (entropyOffset >= param(9u)) {
            return 0u;
          }

          marker = jpegBytes[entropyOffset];
          entropyOffset = entropyOffset + 1u;

          if (marker != 255u) {
            break;
          }
        }

        if (marker == 0u) {
          return 255u;
        }

        if (marker >= 208u && marker <= 215u) {
          bitBuffer = 0u;
          bitCount = 0u;
          continue;
        }

        return 0u;
      }
    }

    fn readBit() -> u32 {
      if (bitCount == 0u) {
        bitBuffer = readEntropyByte();
        bitCount = 8u;
      }

      bitCount = bitCount - 1u;
      return (bitBuffer >> bitCount) & 1u;
    }

    fn readBits(count: u32) -> u32 {
      var value = 0u;

      for (var index = 0u; index < count; index = index + 1u) {
        value = (value << 1u) | readBit();
      }

      return value;
    }

    fn decodeHuffman(slot: u32) -> u32 {
      var code = 0i;
      let tableBase = slot * 17u;

      for (var length = 1u; length <= 16u; length = length + 1u) {
        code = code * 2i + i32(readBit());

        let minCode = huffMin[tableBase + length];
        let maxCode = huffMax[tableBase + length];

        if (maxCode >= 0i && code >= minCode && code <= maxCode) {
          let symbolIndex = huffValOffset[tableBase + length] + code;
          if (symbolIndex < 0i || symbolIndex >= 256i) {
            return 0u;
          }
          return u32(huffSymbols[slot * 256u + u32(symbolIndex)]);
        }
      }

      return 0u;
    }

    fn receiveAndExtend(size: u32) -> i32 {
      if (size == 0u) {
        return 0i;
      }

      let value = readBits(size);
      let threshold = 1u << (size - 1u);

      if (value < threshold) {
        return i32(value) - i32((1u << size) - 1u);
      }

      return i32(value);
    }

    fn clearBlock(blockOffset: u32) {
      for (var index = 0u; index < 64u; index = index + 1u) {
        coeffs[blockOffset + index] = 0i;
      }
    }

    fn getPreviousDc(componentIndex: u32) -> i32 {
      if (componentIndex == 0u) {
        return previousDc0;
      }

      if (componentIndex == 1u) {
        return previousDc1;
      }

      return previousDc2;
    }

    fn setPreviousDc(componentIndex: u32, value: i32) {
      if (componentIndex == 0u) {
        previousDc0 = value;
        return;
      }

      if (componentIndex == 1u) {
        previousDc1 = value;
        return;
      }

      previousDc2 = value;
    }

    fn decodeBlock(
      componentIndex: u32,
      blockIndex: u32,
      dcSlot: u32,
      acSlot: u32
    ) {
      let componentBase = componentIndex * 8u;
      let coeffBase = u32(component(componentIndex, 4u));
      let quantTable = u32(component(componentIndex, 5u));
      let blockOffset = coeffBase + blockIndex * 64u;

      clearBlock(blockOffset);

      let dcLength = decodeHuffman(dcSlot);
      let dcDiff = receiveAndExtend(dcLength);
      let dc = getPreviousDc(componentIndex) + dcDiff;

      setPreviousDc(componentIndex, dc);
      coeffs[blockOffset] = dc * quant(quantTable * 64u);

      var coefficientIndex = 1u;

      loop {
        if (coefficientIndex >= 64u) {
          break;
        }

        let value = decodeHuffman(acSlot);
        let runLength = value >> 4u;
        let size = value & 15u;

        if (size == 0u) {
          if (runLength == 15u) {
            coefficientIndex = coefficientIndex + 16u;
            continue;
          }

          break;
        }

        coefficientIndex = coefficientIndex + runLength;

        if (coefficientIndex >= 64u) {
          break;
        }

        let naturalIndex = ZIG_ZAG[coefficientIndex];
        let coefficient = receiveAndExtend(size);
        coeffs[blockOffset + naturalIndex] =
          coefficient * quant(quantTable * 64u + naturalIndex);
        coefficientIndex = coefficientIndex + 1u;
      }
    }

    @compute @workgroup_size(1)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      if (id.x != 0u) {
        return;
      }

      entropyOffset = param(8u);
      bitBuffer = 0u;
      bitCount = 0u;
      previousDc0 = 0i;
      previousDc1 = 0i;
      previousDc2 = 0i;
      let mcuCountX = param(5u);
      let mcuCountY = param(6u);
      let scanComponentCount = param(11u);

      for (var mcuY = 0u; mcuY < mcuCountY; mcuY = mcuY + 1u) {
        for (var mcuX = 0u; mcuX < mcuCountX; mcuX = mcuX + 1u) {
          for (var scanIndex = 0u; scanIndex < scanComponentCount; scanIndex = scanIndex + 1u) {
            let scanBase = scanIndex * 3u;
            let componentIndex = u32(scanComponent(scanIndex, 0u));
            let dcSlot = u32(scanComponent(scanIndex, 1u));
            let acSlot = u32(scanComponent(scanIndex, 2u));
            let horizontalSampling = u32(component(componentIndex, 0u));
            let verticalSampling = u32(component(componentIndex, 1u));
            let blockCountX = u32(component(componentIndex, 2u));

            for (var localY = 0u; localY < verticalSampling; localY = localY + 1u) {
              for (var localX = 0u; localX < horizontalSampling; localX = localX + 1u) {
                let blockX = mcuX * horizontalSampling + localX;
                let blockY = mcuY * verticalSampling + localY;
                let blockIndex = blockY * blockCountX + blockX;

                decodeBlock(
                  componentIndex,
                  blockIndex,
                  dcSlot,
                  acSlot
                );
              }
            }
          }
        }
      }
    }
  `;

  const RENDER_SHADER = `
    const PI = 3.141592653589793;

    @group(0) @binding(0) var<storage, read> coeffs: array<i32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read_write> outputPixels: array<u32>;

    fn param(index: u32) -> u32 {
      return u32(jpegMeta[index]);
    }

    fn component(componentIndex: u32, field: u32) -> i32 {
      return jpegMeta[272u + componentIndex * 8u + field];
    }

    fn basis(local: f32, frequency: f32) -> f32 {
      return cos(((2.0 * local + 1.0) * frequency * PI) / 16.0);
    }

    fn clampI32(value: i32, lower: i32, upper: i32) -> i32 {
      return min(max(value, lower), upper);
    }

    fn decodeComponentPixel(componentIndex: u32, componentPixel: vec2<i32>) -> f32 {
      let blockCountX = component(componentIndex, 2u);
      let blockCountY = component(componentIndex, 3u);
      let coeffBase = u32(component(componentIndex, 4u));
      let componentWidth = blockCountX * 8i;
      let componentHeight = blockCountY * 8i;
      let clampedPixel = vec2<i32>(
        clampI32(componentPixel.x, 0i, componentWidth - 1i),
        clampI32(componentPixel.y, 0i, componentHeight - 1i)
      );
      let blockX = clampedPixel.x / 8i;
      let blockY = clampedPixel.y / 8i;
      let localX = clampedPixel.x % 8i;
      let localY = clampedPixel.y % 8i;
      let blockOffset = coeffBase + u32(blockY * blockCountX + blockX) * 64u;
      var value = 0.0;

      for (var row = 0u; row < 8u; row = row + 1u) {
        for (var column = 0u; column < 8u; column = column + 1u) {
          let scaleU = select(1.0, 0.70710678118, column == 0u);
          let scaleV = select(1.0, 0.70710678118, row == 0u);
          let coefficient = f32(coeffs[blockOffset + row * 8u + column]);

          value = value +
            scaleU *
            scaleV *
            coefficient *
            basis(f32(localX), f32(column)) *
            basis(f32(localY), f32(row));
        }
      }

      return clamp(floor(0.25 * value + 128.0 + 0.5), 0.0, 255.0);
    }

    fn decodeComponent(componentIndex: u32, imagePixel: vec2<u32>) -> f32 {
      let horizontalSampling = f32(component(componentIndex, 0u));
      let verticalSampling = f32(component(componentIndex, 1u));
      let maxHorizontalSampling = f32(param(3u));
      let maxVerticalSampling = f32(param(4u));
      let sampleScale = vec2<f32>(
        horizontalSampling / maxHorizontalSampling,
        verticalSampling / maxVerticalSampling
      );
      let sourcePixel = vec2<f32>(f32(imagePixel.x), f32(imagePixel.y));
      let componentCoord = (sourcePixel + vec2<f32>(0.5, 0.5)) * sampleScale - vec2<f32>(0.5, 0.5);
      let p0 = vec2<i32>(floor(componentCoord));
      let p1 = p0 + vec2<i32>(1, 1);
      let t = componentCoord - vec2<f32>(p0);
      let v00 = decodeComponentPixel(componentIndex, p0);
      let v10 = decodeComponentPixel(componentIndex, vec2<i32>(p1.x, p0.y));
      let v01 = decodeComponentPixel(componentIndex, vec2<i32>(p0.x, p1.y));
      let v11 = decodeComponentPixel(componentIndex, p1);
      let top = mix(v00, v10, t.x);
      let bottom = mix(v01, v11, t.x);

      return mix(top, bottom, t.y);
    }

    fn packByte(value: f32) -> u32 {
      return u32(round(clamp(value, 0.0, 1.0) * 255.0));
    }

    fn storePixel(id: vec2<u32>, rgba: vec4<f32>) {
      let offset = id.y * param(0u) + id.x;
      let r = packByte(rgba.r);
      let g = packByte(rgba.g);
      let b = packByte(rgba.b);
      let a = packByte(rgba.a);

      outputPixels[offset] = r | (g << 8u) | (b << 16u) | (a << 24u);
    }

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let width = param(0u);
      let height = param(1u);

      if (id.x >= width || id.y >= height) {
        return;
      }

      let y = decodeComponent(0u, vec2<u32>(id.x, id.y));
      let componentCount = param(2u);

      if (componentCount == 1u) {
        let gray = y / 255.0;
        storePixel(vec2<u32>(id.x, id.y), vec4<f32>(gray, gray, gray, 1.0));
        return;
      }

      let cb = decodeComponent(1u, vec2<u32>(id.x, id.y)) - 128.0;
      let cr = decodeComponent(2u, vec2<u32>(id.x, id.y)) - 128.0;
      let rgb = vec3<f32>(
        y + 1.402 * cr,
        y - 0.344136286201022 * cb - 0.714136285714286 * cr,
        y + 1.772 * cb
      ) / 255.0;

      storePixel(vec2<u32>(id.x, id.y), vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0));
    }
  `;

  class WebGpuJpegDecoder {
    constructor(device) {
      this.device = device;
      this.entropyPipeline = null;
      this.renderPipeline = null;
    }

    static async create() {
      if (!global.navigator || !global.navigator.gpu) {
        throw new Error("WebGpuJpegDecoder requires WebGPU.");
      }

      const adapter = await global.navigator.gpu.requestAdapter();

      if (!adapter) {
        throw new Error("WebGPU adapter is not available.");
      }

      const device = await adapter.requestDevice();
      return new WebGpuJpegDecoder(device);
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch JPEG: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    prepare(arrayBuffer) {
      const setupStarted = performance.now();
      const jpeg = parseGpuResidentJpeg(arrayBuffer);
      const device = this.device;
      const jpegBytes = expandBytesToUint32(jpeg.bytes);
      const params = new Uint32Array([
        jpeg.width,
        jpeg.height,
        jpeg.components.length,
        jpeg.maxHorizontalSampling,
        jpeg.maxVerticalSampling,
        jpeg.mcuCountX,
        jpeg.mcuCountY,
        jpeg.totalCoefficientCount,
        jpeg.scanStart,
        jpeg.scanEnd,
        jpeg.bytes.length,
        jpeg.scanComponents.length,
      ]);
      const metadata = createMetadata(jpeg, params);
      const coefficientBuffer = device.createBuffer({
        size: align(jpeg.totalCoefficientCount * 4, 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const outputPixelBuffer = device.createBuffer({
        size: align(jpeg.width * jpeg.height * 4, 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const buffers = {
        jpegBytes: createStorageBuffer(device, jpegBytes),
        metadata: createStorageBuffer(device, metadata),
        huffMin: createStorageBuffer(device, jpeg.huffMin),
        huffMax: createStorageBuffer(device, jpeg.huffMax),
        huffValOffset: createStorageBuffer(device, jpeg.huffValOffset),
        huffSymbols: createStorageBuffer(device, jpeg.huffSymbols),
      };

      this.ensurePipelines();
      const entropyBindGroup = device.createBindGroup({
        layout: this.entropyPipeline.getBindGroupLayout(0),
        entries: [
          bufferEntry(0, buffers.jpegBytes),
          bufferEntry(1, buffers.metadata),
          bufferEntry(2, buffers.huffMin),
          bufferEntry(3, buffers.huffMax),
          bufferEntry(4, buffers.huffValOffset),
          bufferEntry(5, buffers.huffSymbols),
          bufferEntry(6, coefficientBuffer),
        ],
      });
      const renderBindGroup = device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          bufferEntry(0, coefficientBuffer),
          bufferEntry(1, buffers.metadata),
          bufferEntry(2, outputPixelBuffer),
        ],
      });

      return {
        device,
        jpeg,
        buffers,
        coefficientBuffer,
        outputPixelBuffer,
        entropyBindGroup,
        renderBindGroup,
        timings: {
          uploadMs: performance.now() - setupStarted,
          gpuDecodeMs: 0,
          decodeMs: 0,
          readbackMs: 0,
        },
      };
    }

    async decodePrepared(prepared) {
      const device = prepared.device || this.device;
      const decodeStarted = performance.now();

      const entropyEncoder = device.createCommandEncoder();
      const entropyPass = entropyEncoder.beginComputePass();

      entropyPass.setPipeline(this.entropyPipeline);
      entropyPass.setBindGroup(0, prepared.entropyBindGroup);
      entropyPass.dispatchWorkgroups(1);
      entropyPass.end();
      device.queue.submit([entropyEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      const encoder = device.createCommandEncoder();

      const renderPass = encoder.beginComputePass();

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, prepared.renderBindGroup);
      renderPass.dispatchWorkgroups(
        Math.ceil(prepared.jpeg.width / 8),
        Math.ceil(prepared.jpeg.height / 8)
      );
      renderPass.end();

      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      const decodeMs = performance.now() - decodeStarted;

      prepared.timings.gpuDecodeMs = decodeMs;
      prepared.timings.decodeMs = decodeMs;

      if (prepared.buffers) {
        Object.values(prepared.buffers).forEach((buffer) => buffer.destroy());
        prepared.buffers = null;
      }

      return {
        width: prepared.jpeg.width,
        height: prepared.jpeg.height,
        gpuBuffer: prepared.outputPixelBuffer,
        timings: prepared.timings,
        async readPixels() {
          const readbackStarted = performance.now();
          const pixels = await readPixelBuffer(
            device,
            prepared.outputPixelBuffer,
            prepared.jpeg.width,
            prepared.jpeg.height
          );

          prepared.timings.readbackMs += performance.now() - readbackStarted;
          return pixels;
        },
        dispose() {
          prepared.coefficientBuffer.destroy();
          prepared.outputPixelBuffer.destroy();
        },
      };
    }

    async decode(arrayBuffer) {
      return this.decodePrepared(this.prepare(arrayBuffer));
    }

    ensurePipelines() {
      if (this.entropyPipeline && this.renderPipeline) {
        return;
      }

      const device = this.device;

      this.entropyPipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: device.createShaderModule({ code: ENTROPY_SHADER }),
          entryPoint: "main",
        },
      });
      this.renderPipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
          module: device.createShaderModule({ code: RENDER_SHADER }),
          entryPoint: "main",
        },
      });
    }

    static parseHeaders(arrayBuffer) {
      return parseGpuResidentJpeg(arrayBuffer);
    }
  }

  class GpuResidentJpegHeaderParser {
    constructor(bytes) {
      this.bytes = bytes;
      this.offset = 0;
      this.width = 0;
      this.height = 0;
      this.components = [];
      this.componentById = new Map();
      this.quantTables = new Int32Array(4 * 64);
      this.huffmanTables = [[], []];
      this.maxHorizontalSampling = 1;
      this.maxVerticalSampling = 1;
      this.restartInterval = 0;
      this.scanStart = 0;
      this.scanEnd = 0;
      this.scanComponents = [];
      this.sawScan = false;
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
            throw new Error("WebGpuJpegDecoder does not support progressive JPEG yet.");
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
            this.offset = this.scanEnd;
            break;
          default:
            this.offset = segmentEnd;
            break;
        }
      }

      if (!this.sawScan) {
        throw new Error("Invalid JPEG: scan data was not found.");
      }

      if (this.restartInterval !== 0) {
        throw new Error("WebGpuJpegDecoder does not support restart intervals yet.");
      }

      return this.createJpegInfo();
    }

    parseStartOfFrame(segmentEnd) {
      const precision = this.readUint8();

      if (precision !== 8) {
        throw new Error("WebGpuJpegDecoder supports only 8-bit JPEG.");
      }

      this.height = this.readUint16();
      this.width = this.readUint16();

      const componentCount = this.readUint8();

      if (componentCount !== 1 && componentCount !== 3) {
        throw new Error("WebGpuJpegDecoder supports grayscale and YCbCr JPEG.");
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
          blockCountX: 0,
          blockCountY: 0,
          coefficientOffset: 0,
        };

        if (component.horizontalSampling < 1 || component.verticalSampling < 1) {
          throw new Error("Invalid JPEG: bad sampling factor.");
        }

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

        if (precision !== 0 || tableId > 3) {
          throw new Error("WebGpuJpegDecoder supports only 8-bit quantization tables 0..3.");
        }

        for (let index = 0; index < 64; index += 1) {
          this.quantTables[tableId * 64 + ZIG_ZAG[index]] = this.readUint8();
        }
      }
    }

    parseDefineHuffmanTables(segmentEnd) {
      while (this.offset < segmentEnd) {
        const info = this.readUint8();
        const tableClass = info >> 4;
        const tableId = info & 15;
        const counts = new Uint8Array(16);
        let symbolCount = 0;

        if (tableClass > 1 || tableId > 3) {
          throw new Error("Invalid JPEG: Huffman table id is out of range.");
        }

        for (let index = 0; index < 16; index += 1) {
          counts[index] = this.readUint8();
          symbolCount += counts[index];
        }

        const symbols = new Uint8Array(symbolCount);

        for (let index = 0; index < symbolCount; index += 1) {
          symbols[index] = this.readUint8();
        }

        this.huffmanTables[tableClass][tableId] = { counts, symbols };
      }
    }

    parseStartOfScan(segmentEnd) {
      if (this.sawScan) {
        throw new Error("WebGpuJpegDecoder supports only one baseline scan.");
      }

      const scanComponentCount = this.readUint8();
      const scanComponents = [];

      if (scanComponentCount !== this.components.length) {
        throw new Error("WebGpuJpegDecoder supports only interleaved baseline scans.");
      }

      for (let index = 0; index < scanComponentCount; index += 1) {
        const id = this.readUint8();
        const tableInfo = this.readUint8();
        const component = this.componentById.get(id);
        const dcTableId = tableInfo >> 4;
        const acTableId = tableInfo & 15;

        if (!component) {
          throw new Error(`Invalid JPEG: unknown scan component ${id}.`);
        }

        if (!this.huffmanTables[0][dcTableId] || !this.huffmanTables[1][acTableId]) {
          throw new Error("Invalid JPEG: scan references a missing Huffman table.");
        }

        scanComponents.push({
          component,
          dcSlot: dcTableId,
          acSlot: 4 + acTableId,
        });
      }

      const spectralStart = this.readUint8();
      const spectralEnd = this.readUint8();
      const successiveApproximation = this.readUint8();

      if (spectralStart !== 0 || spectralEnd !== 63 || successiveApproximation !== 0) {
        throw new Error("WebGpuJpegDecoder supports only sequential baseline scans.");
      }

      this.offset = segmentEnd;
      this.scanStart = this.offset;
      this.scanEnd = this.findScanEnd(this.scanStart);
      this.scanComponents = scanComponents;
      this.sawScan = true;
    }

    createJpegInfo() {
      const mcuCountX = Math.ceil(this.width / (this.maxHorizontalSampling * 8));
      const mcuCountY = Math.ceil(this.height / (this.maxVerticalSampling * 8));
      const componentData = new Int32Array(3 * COMPONENT_STRIDE);
      const scanComponentData = new Int32Array(3 * SCAN_STRIDE);
      const huffman = buildGpuHuffmanTables(this.huffmanTables);
      let coefficientOffset = 0;

      this.components.forEach((component, index) => {
        component.blockCountX = mcuCountX * component.horizontalSampling;
        component.blockCountY = mcuCountY * component.verticalSampling;
        component.coefficientOffset = coefficientOffset;

        const base = index * COMPONENT_STRIDE;

        componentData[base] = component.horizontalSampling;
        componentData[base + 1] = component.verticalSampling;
        componentData[base + 2] = component.blockCountX;
        componentData[base + 3] = component.blockCountY;
        componentData[base + 4] = coefficientOffset;
        componentData[base + 5] = component.quantizationTableId;
        coefficientOffset += component.blockCountX * component.blockCountY * 64;
      });

      this.scanComponents.forEach((scanComponent, index) => {
        const base = index * SCAN_STRIDE;

        scanComponentData[base] = this.components.indexOf(scanComponent.component);
        scanComponentData[base + 1] = scanComponent.dcSlot;
        scanComponentData[base + 2] = scanComponent.acSlot;
      });

      return {
        bytes: this.bytes,
        width: this.width,
        height: this.height,
        components: this.components,
        maxHorizontalSampling: this.maxHorizontalSampling,
        maxVerticalSampling: this.maxVerticalSampling,
        mcuCountX,
        mcuCountY,
        scanStart: this.scanStart,
        scanEnd: this.scanEnd,
        scanComponents: this.scanComponents,
        componentData,
        scanComponentData,
        totalCoefficientCount: coefficientOffset,
        quantTables: this.quantTables,
        huffMin: huffman.min,
        huffMax: huffman.max,
        huffValOffset: huffman.valOffset,
        huffSymbols: huffman.symbols,
      };
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

  function parseGpuResidentJpeg(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer);
    const parser = new GpuResidentJpegHeaderParser(bytes);

    return parser.parse();
  }

  function buildGpuHuffmanTables(tables) {
    const min = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const max = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const valOffset = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const symbols = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_SYMBOL_STRIDE);

    max.fill(-1);

    for (let tableClass = 0; tableClass <= 1; tableClass += 1) {
      for (let tableId = 0; tableId <= 3; tableId += 1) {
        const table = tables[tableClass][tableId];

        if (!table) {
          continue;
        }

        const slot = tableClass * 4 + tableId;
        const base = slot * HUFFMAN_CODE_LENGTHS;
        let code = 0;
        let symbolIndex = 0;

        for (let length = 1; length <= 16; length += 1) {
          const count = table.counts[length - 1];

          if (count > 0) {
            min[base + length] = code;
            max[base + length] = code + count - 1;
            valOffset[base + length] = symbolIndex - code;
            code += count;
            symbolIndex += count;
          }

          code <<= 1;
        }

        for (let index = 0; index < table.symbols.length; index += 1) {
          symbols[slot * HUFFMAN_SYMBOL_STRIDE + index] = table.symbols[index];
        }
      }
    }

    return { min, max, valOffset, symbols };
  }

  function createMetadata(jpeg, params) {
    const metadata = new Int32Array(META_LENGTH);

    for (let index = 0; index < params.length; index += 1) {
      metadata[META_PARAM_OFFSET + index] = params[index];
    }

    metadata.set(jpeg.quantTables, META_QUANT_OFFSET);
    metadata.set(jpeg.componentData, META_COMPONENT_OFFSET);
    metadata.set(jpeg.scanComponentData, META_SCAN_OFFSET);

    return metadata;
  }

  function createStorageBuffer(device, data) {
    const buffer = device.createBuffer({
      size: align(data.byteLength, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    const mappedRange = buffer.getMappedRange(0, data.byteLength);
    const target = new data.constructor(mappedRange);

    target.set(data);
    buffer.unmap();
    return buffer;
  }

  async function readPixelBuffer(device, pixelBuffer, width, height) {
    const byteLength = width * height * 4;
    const readBuffer = device.createBuffer({
      size: align(byteLength, 4),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();

    encoder.copyBufferToBuffer(pixelBuffer, 0, readBuffer, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readBuffer.mapAsync(GPUMapMode.READ);

    const mapped = new Uint8Array(readBuffer.getMappedRange());
    const pixels = new Uint8Array(mapped.slice(0, byteLength));

    readBuffer.unmap();
    readBuffer.destroy();
    return pixels;
  }

  function expandBytesToUint32(bytes) {
    const expanded = new Uint32Array(bytes.length);

    for (let index = 0; index < bytes.length; index += 1) {
      expanded[index] = bytes[index];
    }

    return expanded;
  }

  function bufferEntry(binding, buffer) {
    return {
      binding,
      resource: { buffer },
    };
  }

  function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }

  global.WebGpuJpegDecoder = WebGpuJpegDecoder;

  if (typeof module !== "undefined") {
    module.exports = { WebGpuJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
