/*
 * Purpose: WebGPU JPEG decoder that can keep entropy, IDCT, and rendering work
 * on the GPU for benchmark and comparison paths.
 * Processing blocks:
 * - Pre-scan or parse JPEG metadata and entropy intervals.
 * - Decode Huffman-coded coefficient blocks into GPU storage buffers.
 * - Run IDCT/color conversion and optionally render/read back RGBA pixels.
 */
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
  const ENTROPY_INTERVAL_STRIDE = 4;
  const ENTROPY_BLOCK_TASK_STRIDE = 8;
  const HUFFMAN_TABLE_SLOTS = 8;
  const HUFFMAN_CODE_LENGTHS = 17;
  const HUFFMAN_SYMBOL_STRIDE = 256;
  const HUFFMAN_FAST_BITS = 10;
  const HUFFMAN_FAST_SIZE = 1 << HUFFMAN_FAST_BITS;
  const HUFFMAN_FAST_LENGTH_OFFSET = HUFFMAN_TABLE_SLOTS * HUFFMAN_SYMBOL_STRIDE;
  const HUFFMAN_FAST_SYMBOL_OFFSET =
    HUFFMAN_FAST_LENGTH_OFFSET + HUFFMAN_TABLE_SLOTS * HUFFMAN_FAST_SIZE;
  const HUFFMAN_SYMBOL_BUFFER_LENGTH =
    HUFFMAN_FAST_SYMBOL_OFFSET + HUFFMAN_TABLE_SLOTS * HUFFMAN_FAST_SIZE;
  const META_PARAM_OFFSET = 0;
  const META_QUANT_OFFSET = 16;
  const META_COMPONENT_OFFSET = META_QUANT_OFFSET + 4 * 64;
  const META_SCAN_OFFSET = META_COMPONENT_OFFSET + 3 * COMPONENT_STRIDE;
  const META_LENGTH = META_SCAN_OFFSET + 3 * SCAN_STRIDE;

  // Compute stage that decodes entropy intervals directly on the GPU.
  const ENTROPY_SHADER = `
    @group(0) @binding(0) var<storage, read> jpegBytes: array<u32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read> huffMin: array<i32>;
    @group(0) @binding(3) var<storage, read> huffMax: array<i32>;
    @group(0) @binding(4) var<storage, read> huffValOffset: array<i32>;
    @group(0) @binding(5) var<storage, read> huffSymbols: array<i32>;
    @group(0) @binding(6) var<storage, read_write> coeffs: array<i32>;
    @group(0) @binding(7) var<storage, read> entropyIntervals: array<u32>;

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
    const HUFFMAN_FAST_BITS = 10u;
    const HUFFMAN_FAST_SIZE = 1024u;
    const HUFFMAN_FAST_LENGTH_OFFSET = 2048u;
    const HUFFMAN_FAST_SYMBOL_OFFSET = 10240u;

    var<private> entropyOffset: u32;
    var<private> entropyEnd: u32;
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
        if (entropyOffset >= entropyEnd) {
          return 0u;
        }

        let value = jpegBytes[entropyOffset];
        entropyOffset = entropyOffset + 1u;

        if (value != 255u) {
          return value;
        }

        var marker = 255u;

        loop {
          if (entropyOffset >= entropyEnd) {
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

    fn bitMask(count: u32) -> u32 {
      if (count == 0u) {
        return 0u;
      }

      return (1u << count) - 1u;
    }

    fn ensureBits(count: u32) {
      loop {
        if (bitCount >= count) {
          break;
        }

        bitBuffer = (bitBuffer << 8u) | readEntropyByte();
        bitCount = bitCount + 8u;
      }
    }

    fn peekBits(count: u32) -> u32 {
      ensureBits(count);

      return (bitBuffer >> (bitCount - count)) & bitMask(count);
    }

    fn skipBits(count: u32) {
      bitCount = bitCount - count;
      bitBuffer = bitBuffer & bitMask(bitCount);
    }

    fn readBits(count: u32) -> u32 {
      let value = peekBits(count);

      skipBits(count);

      return value;
    }

    fn readBit() -> u32 {
      return readBits(1u);
    }

    fn decodeHuffman(slot: u32) -> u32 {
      let fastCode = peekBits(HUFFMAN_FAST_BITS);
      let fastBase = slot * HUFFMAN_FAST_SIZE + fastCode;
      let fastLength = u32(huffSymbols[HUFFMAN_FAST_LENGTH_OFFSET + fastBase]);

      if (fastLength > 0u) {
        skipBits(fastLength);
        return u32(huffSymbols[HUFFMAN_FAST_SYMBOL_OFFSET + fastBase]);
      }

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
      if (id.x >= param(12u)) {
        return;
      }

      let intervalBase = id.x * 4u;
      entropyOffset = entropyIntervals[intervalBase];
      entropyEnd = entropyIntervals[intervalBase + 1u];
      let startMcu = entropyIntervals[intervalBase + 2u];
      let mcuCount = entropyIntervals[intervalBase + 3u];
      bitBuffer = 0u;
      bitCount = 0u;
      previousDc0 = 0i;
      previousDc1 = 0i;
      previousDc2 = 0i;
      let mcuCountX = param(5u);
      let scanComponentCount = param(11u);

      for (var mcuOffset = 0u; mcuOffset < mcuCount; mcuOffset = mcuOffset + 1u) {
        let mcuIndex = startMcu + mcuOffset;
        let mcuY = mcuIndex / mcuCountX;
        let mcuX = mcuIndex - mcuY * mcuCountX;

        for (var scanIndex = 0u; scanIndex < scanComponentCount; scanIndex = scanIndex + 1u) {
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
  `;

  // Alternate compute stage for ranges that were pre-scanned on the CPU.
  const PRESCAN_ENTROPY_SHADER = `
    @group(0) @binding(0) var<storage, read> jpegBytes: array<u32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read> huffMin: array<i32>;
    @group(0) @binding(3) var<storage, read> huffMax: array<i32>;
    @group(0) @binding(4) var<storage, read> huffValOffset: array<i32>;
    @group(0) @binding(5) var<storage, read> huffSymbols: array<i32>;
    @group(0) @binding(6) var<storage, read_write> coeffs: array<i32>;
    @group(0) @binding(7) var<storage, read> blockTasks: array<i32>;

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
    const HUFFMAN_FAST_BITS = 10u;
    const HUFFMAN_FAST_SIZE = 1024u;
    const HUFFMAN_FAST_LENGTH_OFFSET = 2048u;
    const HUFFMAN_FAST_SYMBOL_OFFSET = 10240u;

    var<private> entropyOffset: u32;
    var<private> entropyEnd: u32;
    var<private> bitBuffer: u32;
    var<private> bitCount: u32;

    fn param(index: u32) -> u32 {
      return u32(jpegMeta[index]);
    }

    fn quant(index: u32) -> i32 {
      return jpegMeta[16u + index];
    }

    fn component(componentIndex: u32, field: u32) -> i32 {
      return jpegMeta[272u + componentIndex * 8u + field];
    }

    fn task(taskIndex: u32, field: u32) -> i32 {
      return blockTasks[taskIndex * 8u + field];
    }

    fn bitMask(count: u32) -> u32 {
      if (count == 0u) {
        return 0u;
      }

      return (1u << count) - 1u;
    }

    fn initializeReader(byteOffset: u32, bitOffset: u32, endOffset: u32) {
      entropyOffset = byteOffset;
      entropyEnd = endOffset;
      bitBuffer = 0u;
      bitCount = 0u;

      if (bitOffset > 0u && byteOffset < entropyEnd) {
        bitBuffer = jpegBytes[byteOffset] & bitMask(8u - bitOffset);
        entropyOffset = byteOffset + 1u;

        if (bitBuffer == 255u && entropyOffset < entropyEnd && jpegBytes[entropyOffset] == 0u) {
          entropyOffset = entropyOffset + 1u;
        }

        bitCount = 8u - bitOffset;
      }
    }

    fn readEntropyByte() -> u32 {
      loop {
        if (entropyOffset >= entropyEnd) {
          return 0u;
        }

        let value = jpegBytes[entropyOffset];
        entropyOffset = entropyOffset + 1u;

        if (value != 255u) {
          return value;
        }

        var marker = 255u;

        loop {
          if (entropyOffset >= entropyEnd) {
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

    fn ensureBits(count: u32) {
      loop {
        if (bitCount >= count) {
          break;
        }

        bitBuffer = (bitBuffer << 8u) | readEntropyByte();
        bitCount = bitCount + 8u;
      }
    }

    fn peekBits(count: u32) -> u32 {
      ensureBits(count);

      return (bitBuffer >> (bitCount - count)) & bitMask(count);
    }

    fn skipBits(count: u32) {
      bitCount = bitCount - count;
      bitBuffer = bitBuffer & bitMask(bitCount);
    }

    fn readBits(count: u32) -> u32 {
      let value = peekBits(count);

      skipBits(count);

      return value;
    }

    fn readBit() -> u32 {
      return readBits(1u);
    }

    fn decodeHuffman(slot: u32) -> u32 {
      let fastCode = peekBits(HUFFMAN_FAST_BITS);
      let fastBase = slot * HUFFMAN_FAST_SIZE + fastCode;
      let fastLength = u32(huffSymbols[HUFFMAN_FAST_LENGTH_OFFSET + fastBase]);

      if (fastLength > 0u) {
        skipBits(fastLength);
        return u32(huffSymbols[HUFFMAN_FAST_SYMBOL_OFFSET + fastBase]);
      }

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

    fn decodeBlock(
      componentIndex: u32,
      blockIndex: u32,
      dcSlot: u32,
      acSlot: u32,
      previousDc: i32
    ) {
      let coeffBase = u32(component(componentIndex, 4u));
      let quantTable = u32(component(componentIndex, 5u));
      let blockOffset = coeffBase + blockIndex * 64u;

      let dcLength = decodeHuffman(dcSlot);
      let dcDiff = receiveAndExtend(dcLength);
      let dc = previousDc + dcDiff;

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

    @compute @workgroup_size(128)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let taskIndex = id.x;

      if (taskIndex >= param(13u)) {
        return;
      }

      initializeReader(
        u32(task(taskIndex, 0u)),
        u32(task(taskIndex, 1u)),
        u32(task(taskIndex, 2u))
      );
      decodeBlock(
        u32(task(taskIndex, 3u)),
        u32(task(taskIndex, 4u)),
        u32(task(taskIndex, 5u)),
        u32(task(taskIndex, 6u)),
        task(taskIndex, 7u)
      );
    }
  `;

  // Compute stage that turns coefficient buffers into planar Y/Cb/Cr samples.
  const IDCT_SHADER = `
    @group(0) @binding(0) var<storage, read> coeffs: array<i32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read_write> componentPixels: array<i32>;

    const IDCT_BASIS = array<f32, 64>(
      0.7071067812f, 0.9807852804f, 0.9238795325f, 0.8314696123f,
      0.7071067812f, 0.5555702330f, 0.3826834324f, 0.1950903220f,
      0.7071067812f, 0.8314696123f, 0.3826834324f, -0.1950903220f,
      -0.7071067812f, -0.9807852804f, -0.9238795325f, -0.5555702330f,
      0.7071067812f, 0.5555702330f, -0.3826834324f, -0.9807852804f,
      -0.7071067812f, 0.1950903220f, 0.9238795325f, 0.8314696123f,
      0.7071067812f, 0.1950903220f, -0.9238795325f, -0.5555702330f,
      0.7071067812f, 0.8314696123f, -0.3826834324f, -0.9807852804f,
      0.7071067812f, -0.1950903220f, -0.9238795325f, 0.5555702330f,
      0.7071067812f, -0.8314696123f, -0.3826834324f, 0.9807852804f,
      0.7071067812f, -0.5555702330f, -0.3826834324f, 0.9807852804f,
      -0.7071067812f, -0.1950903220f, 0.9238795325f, -0.8314696123f,
      0.7071067812f, -0.8314696123f, 0.3826834324f, 0.1950903220f,
      -0.7071067812f, 0.9807852804f, -0.9238795325f, 0.5555702330f,
      0.7071067812f, -0.9807852804f, 0.9238795325f, -0.8314696123f,
      0.7071067812f, -0.5555702330f, 0.3826834324f, -0.1950903220f
    );

    fn param(index: u32) -> u32 {
      return u32(jpegMeta[index]);
    }

    fn component(componentIndex: u32, field: u32) -> i32 {
      return jpegMeta[272u + componentIndex * 8u + field];
    }

    fn componentPixelCount(componentIndex: u32) -> u32 {
      return u32(component(componentIndex, 2u) * component(componentIndex, 3u)) * 64u;
    }

    fn componentForOffset(offset: u32) -> u32 {
      let componentCount = param(2u);
      let count0 = componentPixelCount(0u);

      if (offset < count0 || componentCount == 1u) {
        return 0u;
      }

      let count1 = componentPixelCount(1u);

      if (offset < count0 + count1 || componentCount == 2u) {
        return 1u;
      }

      return 2u;
    }

    @compute @workgroup_size(128)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let pixelOffset = id.x;

      if (pixelOffset >= param(7u)) {
        return;
      }

      let componentIndex = componentForOffset(pixelOffset);
      let coeffBase = u32(component(componentIndex, 4u));
      let localOffset = pixelOffset - coeffBase;
      let localIndex = localOffset % 64u;
      let localX = localIndex & 7u;
      let localY = localIndex >> 3u;
      let blockOffset = pixelOffset - localIndex;
      var value = 0.0;

      for (var row = 0u; row < 8u; row = row + 1u) {
        let yBasis = IDCT_BASIS[localY * 8u + row];

        for (var column = 0u; column < 8u; column = column + 1u) {
          let xBasis = IDCT_BASIS[localX * 8u + column];
          let coefficient = f32(coeffs[blockOffset + row * 8u + column]);

          value = value + coefficient * xBasis * yBasis;
        }
      }

      componentPixels[pixelOffset] = i32(clamp(floor(0.25 * value + 128.0 + 0.5), 0.0, 255.0));
    }
  `;

  // Render stage that samples decoded planes, upsamples chroma, and writes RGBA.
  const RENDER_SHADER = `
    @group(0) @binding(0) var<storage, read> componentPixels: array<i32>;
    @group(0) @binding(1) var<storage, read> jpegMeta: array<i32>;
    @group(0) @binding(2) var<storage, read_write> outputPixels: array<u32>;

    fn param(index: u32) -> u32 {
      return u32(jpegMeta[index]);
    }

    fn component(componentIndex: u32, field: u32) -> i32 {
      return jpegMeta[272u + componentIndex * 8u + field];
    }

    fn clampI32(value: i32, lower: i32, upper: i32) -> i32 {
      return min(max(value, lower), upper);
    }

    fn sampleComponentPixel(componentIndex: u32, componentPixel: vec2<i32>) -> f32 {
      let blockCountX = component(componentIndex, 2u);
      let blockCountY = component(componentIndex, 3u);
      let componentBase = u32(component(componentIndex, 4u));
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
      let blockOffset = componentBase + u32(blockY * blockCountX + blockX) * 64u;
      let pixelOffset = blockOffset + u32(localY * 8i + localX);

      return f32(componentPixels[pixelOffset]);
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
      let v00 = sampleComponentPixel(componentIndex, p0);
      let v10 = sampleComponentPixel(componentIndex, vec2<i32>(p1.x, p0.y));
      let v01 = sampleComponentPixel(componentIndex, vec2<i32>(p0.x, p1.y));
      let v11 = sampleComponentPixel(componentIndex, p1);
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

  // Public WebGPU decoder facade: owns device resources and schedules decode passes.
  class WebGpuJpegDecoder {
    constructor(device, options = {}) {
      this.device = device;
      this.entropyMode = options.entropyMode || "resident";
      this.entropyPipeline = null;
      this.prescanEntropyPipeline = null;
      this.idctPipeline = null;
      this.renderPipeline = null;
    }

    static async create(options = {}) {
      if (!global.navigator || !global.navigator.gpu) {
        throw new Error("WebGpuJpegDecoder requires WebGPU.");
      }

      const adapter = await global.navigator.gpu.requestAdapter();

      if (!adapter) {
        throw new Error("WebGPU adapter is not available.");
      }

      const device = await adapter.requestDevice();
      return new WebGpuJpegDecoder(device, options);
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
      const preScanStarted = performance.now();
      const blockTasks = this.entropyMode === "prescan"
        ? createEntropyBlockTasks(jpeg)
        : null;
      const preScanMs = blockTasks ? performance.now() - preScanStarted : 0;
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
        jpeg.entropyIntervals.length,
        blockTasks ? blockTasks.count : 0,
      ]);
      const metadata = createMetadata(jpeg, params);
      const coefficientBuffer = device.createBuffer({
        size: align(jpeg.totalCoefficientCount * 4, 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const componentPixelBuffer = device.createBuffer({
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
        entropyIntervals: createStorageBuffer(device, jpeg.entropyIntervalData),
      };

      if (blockTasks) {
        buffers.blockTasks = createStorageBuffer(device, blockTasks.data);
      }

      this.ensurePipelines();
      const entropyPipeline = this.entropyMode === "prescan"
        ? this.prescanEntropyPipeline
        : this.entropyPipeline;
      const entropyBindGroup = device.createBindGroup({
        layout: entropyPipeline.getBindGroupLayout(0),
        entries: [
          bufferEntry(0, buffers.jpegBytes),
          bufferEntry(1, buffers.metadata),
          bufferEntry(2, buffers.huffMin),
          bufferEntry(3, buffers.huffMax),
          bufferEntry(4, buffers.huffValOffset),
          bufferEntry(5, buffers.huffSymbols),
          bufferEntry(6, coefficientBuffer),
          bufferEntry(7, blockTasks ? buffers.blockTasks : buffers.entropyIntervals),
        ],
      });
      const idctBindGroup = device.createBindGroup({
        layout: this.idctPipeline.getBindGroupLayout(0),
        entries: [
          bufferEntry(0, coefficientBuffer),
          bufferEntry(1, buffers.metadata),
          bufferEntry(2, componentPixelBuffer),
        ],
      });
      const renderBindGroup = device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          bufferEntry(0, componentPixelBuffer),
          bufferEntry(1, buffers.metadata),
          bufferEntry(2, outputPixelBuffer),
        ],
      });

      return {
        device,
        jpeg,
        buffers,
        coefficientBuffer,
        componentPixelBuffer,
        outputPixelBuffer,
        entropyBindGroup,
        entropyPipeline,
        idctBindGroup,
        renderBindGroup,
        entropyDispatchCount: blockTasks
          ? Math.ceil(blockTasks.count / 128)
          : jpeg.entropyIntervals.length,
        timings: {
          uploadMs: performance.now() - setupStarted - preScanMs,
          preScanMs,
          setupMs: 0,
          gpuDecodeMs: 0,
          decodeMs: 0,
          readbackMs: 0,
          workMs: 0,
          totalDecoderMs: 0,
          measuresCleanWork: true,
          timedPhase: blockTasks
            ? "CPU pre-scan + WebGPU compute passes"
            : "WebGPU compute passes",
        },
      };
    }

    async decodePrepared(prepared) {
      const device = prepared.device || this.device;
      const decodeStarted = performance.now();

      const encoder = device.createCommandEncoder();

      encoder.clearBuffer(prepared.coefficientBuffer);

      const entropyPass = encoder.beginComputePass();

      entropyPass.setPipeline(prepared.entropyPipeline);
      entropyPass.setBindGroup(0, prepared.entropyBindGroup);
      entropyPass.dispatchWorkgroups(prepared.entropyDispatchCount);
      entropyPass.end();

      const idctPass = encoder.beginComputePass();

      idctPass.setPipeline(this.idctPipeline);
      idctPass.setBindGroup(0, prepared.idctBindGroup);
      idctPass.dispatchWorkgroups(Math.ceil(prepared.jpeg.totalCoefficientCount / 128));
      idctPass.end();

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
      prepared.timings.setupMs = prepared.timings.uploadMs;
      prepared.timings.workMs = prepared.timings.preScanMs + decodeMs;
      prepared.timings.totalDecoderMs = prepared.timings.uploadMs +
        prepared.timings.preScanMs +
        decodeMs;

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
          prepared.componentPixelBuffer.destroy();
          prepared.outputPixelBuffer.destroy();
        },
      };
    }

    async decode(arrayBuffer) {
      return this.decodePrepared(this.prepare(arrayBuffer));
    }

    ensurePipelines() {
      const needsPreScan = this.entropyMode === "prescan";

      if (
        (needsPreScan ? this.prescanEntropyPipeline : this.entropyPipeline) &&
        this.idctPipeline &&
        this.renderPipeline
      ) {
        return;
      }

      const device = this.device;

      if (!needsPreScan && !this.entropyPipeline) {
        this.entropyPipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: device.createShaderModule({ code: ENTROPY_SHADER }),
            entryPoint: "main",
          },
        });
      }

      if (needsPreScan && !this.prescanEntropyPipeline) {
        this.prescanEntropyPipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: device.createShaderModule({ code: PRESCAN_ENTROPY_SHADER }),
            entryPoint: "main",
          },
        });
      }

      if (!this.idctPipeline) {
        this.idctPipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: device.createShaderModule({ code: IDCT_SHADER }),
            entryPoint: "main",
          },
        });
      }

      if (!this.renderPipeline) {
        this.renderPipeline = device.createComputePipeline({
          layout: "auto",
          compute: {
            module: device.createShaderModule({ code: RENDER_SHADER }),
            entryPoint: "main",
          },
        });
      }
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
      const totalMcuCount = mcuCountX * mcuCountY;
      const entropyIntervals = this.createEntropyIntervals(totalMcuCount);

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
        totalMcuCount,
        restartInterval: this.restartInterval,
        scanStart: this.scanStart,
        scanEnd: this.scanEnd,
        entropyIntervals,
        entropyIntervalData: createEntropyIntervalData(entropyIntervals),
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

    createEntropyIntervals(totalMcuCount) {
      if (this.restartInterval === 0) {
        return [{
          start: this.scanStart,
          end: this.scanEnd,
          startMcu: 0,
          mcuCount: totalMcuCount,
        }];
      }

      const intervals = [];
      let intervalStart = this.scanStart;
      let startMcu = 0;
      let index = this.scanStart;

      while (index < this.scanEnd && startMcu < totalMcuCount) {
        if (this.bytes[index] !== 0xff) {
          index += 1;
          continue;
        }

        let markerOffset = index + 1;

        while (markerOffset < this.scanEnd && this.bytes[markerOffset] === 0xff) {
          markerOffset += 1;
        }

        if (markerOffset >= this.scanEnd) {
          break;
        }

        const marker = this.bytes[markerOffset];

        if (marker === 0x00) {
          index = markerOffset + 1;
          continue;
        }

        if (marker >= 0xd0 && marker <= 0xd7) {
          const mcuCount = Math.min(this.restartInterval, totalMcuCount - startMcu);

          intervals.push({
            start: intervalStart,
            end: index,
            startMcu,
            mcuCount,
          });
          intervalStart = markerOffset + 1;
          startMcu += mcuCount;
          index = intervalStart;
          continue;
        }

        break;
      }

      if (startMcu < totalMcuCount) {
        intervals.push({
          start: intervalStart,
          end: this.scanEnd,
          startMcu,
          mcuCount: totalMcuCount - startMcu,
        });
      }

      return intervals;
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

  // Parser builds the compact metadata layout consumed by WebGPU shaders.
  function parseGpuResidentJpeg(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer);
    const parser = new GpuResidentJpegHeaderParser(bytes);

    return parser.parse();
  }

  class EntropyBitReader {
    constructor(bytes, start, end) {
      this.bytes = bytes;
      this.offset = start;
      this.end = end;
      this.bitBuffer = 0;
      this.bitCount = 0;
      this.bitByteOffset = start;
    }

    position() {
      if (this.bitCount === 0) {
        return {
          byteOffset: this.offset,
          bitOffset: 0,
        };
      }

      return {
        byteOffset: this.bitByteOffset,
        bitOffset: 8 - this.bitCount,
      };
    }

    readEntropyByte() {
      while (this.offset < this.end) {
        const byteOffset = this.offset;
        const value = this.bytes[this.offset];

        this.offset += 1;

        if (value !== 0xff) {
          this.bitByteOffset = byteOffset;
          return value;
        }

        let markerOffset = this.offset;

        while (markerOffset < this.end && this.bytes[markerOffset] === 0xff) {
          markerOffset += 1;
        }

        if (markerOffset >= this.end) {
          this.bitByteOffset = byteOffset;
          return 0;
        }

        const marker = this.bytes[markerOffset];

        this.offset = markerOffset + 1;

        if (marker === 0x00) {
          this.bitByteOffset = byteOffset;
          return 0xff;
        }

        if (marker >= 0xd0 && marker <= 0xd7) {
          this.bitBuffer = 0;
          this.bitCount = 0;
          continue;
        }

        this.bitByteOffset = byteOffset;
        return 0;
      }

      this.bitByteOffset = this.offset;
      return 0;
    }

    readBit() {
      if (this.bitCount === 0) {
        this.bitBuffer = this.readEntropyByte();
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
  }

  // Entropy tasks split coefficient decoding into restart-safe blocks for GPU workgroups.
  function createEntropyBlockTasks(jpeg) {
    const previousDc = new Int32Array(3);
    const totalBlocks = jpeg.totalCoefficientCount / 64;
    const taskData = new Int32Array(totalBlocks * ENTROPY_BLOCK_TASK_STRIDE);
    let taskCount = 0;

    jpeg.entropyIntervals.forEach((interval) => {
      const reader = new EntropyBitReader(jpeg.bytes, interval.start, interval.end);

      previousDc.fill(0);

      for (let mcuOffset = 0; mcuOffset < interval.mcuCount; mcuOffset += 1) {
        const mcuIndex = interval.startMcu + mcuOffset;
        const mcuY = Math.floor(mcuIndex / jpeg.mcuCountX);
        const mcuX = mcuIndex - mcuY * jpeg.mcuCountX;

        for (let scanIndex = 0; scanIndex < jpeg.scanComponents.length; scanIndex += 1) {
          const scanBase = scanIndex * SCAN_STRIDE;
          const scan = {
            componentIndex: jpeg.scanComponentData[scanBase],
            dcSlot: jpeg.scanComponentData[scanBase + 1],
            acSlot: jpeg.scanComponentData[scanBase + 2],
          };
          const component = jpeg.components[scan.componentIndex];

          for (let localY = 0; localY < component.verticalSampling; localY += 1) {
            for (let localX = 0; localX < component.horizontalSampling; localX += 1) {
              const blockX = mcuX * component.horizontalSampling + localX;
              const blockY = mcuY * component.verticalSampling + localY;
              const blockIndex = blockY * component.blockCountX + blockX;
              const position = reader.position();
              const base = taskCount * ENTROPY_BLOCK_TASK_STRIDE;

              taskData[base] = position.byteOffset;
              taskData[base + 1] = position.bitOffset;
              taskData[base + 2] = interval.end;
              taskData[base + 3] = scan.componentIndex;
              taskData[base + 4] = blockIndex;
              taskData[base + 5] = scan.dcSlot;
              taskData[base + 6] = scan.acSlot;
              taskData[base + 7] = previousDc[scan.componentIndex];
              taskCount += 1;

              previousDc[scan.componentIndex] += readBlockForPreScan(
                reader,
                jpeg,
                scan.dcSlot,
                scan.acSlot
              );
            }
          }
        }
      }
    });

    if (taskCount !== totalBlocks) {
      throw new Error(`Invalid JPEG pre-scan: expected ${totalBlocks} blocks, got ${taskCount}.`);
    }

    return {
      count: taskCount,
      data: taskData.subarray(0, taskCount * ENTROPY_BLOCK_TASK_STRIDE),
    };
  }

  // CPU pre-scan mirrors Huffman traversal just far enough to find block boundaries.
  function readBlockForPreScan(reader, jpeg, dcSlot, acSlot) {
    const dcLength = decodeCpuHuffman(reader, jpeg, dcSlot);
    const dcDiff = receiveAndExtendCpu(reader, dcLength);
    let coefficientIndex = 1;

    while (coefficientIndex < 64) {
      const value = decodeCpuHuffman(reader, jpeg, acSlot);
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
        break;
      }

      reader.readBits(size);
      coefficientIndex += 1;
    }

    return dcDiff;
  }

  function decodeCpuHuffman(reader, jpeg, slot) {
    let code = 0;
    const tableBase = slot * HUFFMAN_CODE_LENGTHS;

    for (let length = 1; length <= 16; length += 1) {
      code = code * 2 + reader.readBit();

      const minCode = jpeg.huffMin[tableBase + length];
      const maxCode = jpeg.huffMax[tableBase + length];

      if (maxCode >= 0 && code >= minCode && code <= maxCode) {
        const symbolIndex = jpeg.huffValOffset[tableBase + length] + code;

        if (symbolIndex < 0 || symbolIndex >= HUFFMAN_SYMBOL_STRIDE) {
          return 0;
        }

        return jpeg.huffSymbols[slot * HUFFMAN_SYMBOL_STRIDE + symbolIndex];
      }
    }

    return 0;
  }

  function receiveAndExtendCpu(reader, size) {
    if (size === 0) {
      return 0;
    }

    const value = reader.readBits(size);
    const threshold = 1 << (size - 1);

    if (value < threshold) {
      return value - ((1 << size) - 1);
    }

    return value;
  }

  // GPU Huffman tables flatten canonical code ranges into storage-buffer arrays.
  function buildGpuHuffmanTables(tables) {
    const min = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const max = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const valOffset = new Int32Array(HUFFMAN_TABLE_SLOTS * HUFFMAN_CODE_LENGTHS);
    const symbols = new Int32Array(HUFFMAN_SYMBOL_BUFFER_LENGTH);

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

            if (length <= HUFFMAN_FAST_BITS) {
              for (let offset = 0; offset < count; offset += 1) {
                const huffmanCode = code + offset;
                const fastStart = huffmanCode << (HUFFMAN_FAST_BITS - length);
                const fastEnd = fastStart + (1 << (HUFFMAN_FAST_BITS - length));
                const symbol = table.symbols[symbolIndex + offset];

                for (let fastCode = fastStart; fastCode < fastEnd; fastCode += 1) {
                  symbols[
                    HUFFMAN_FAST_LENGTH_OFFSET + slot * HUFFMAN_FAST_SIZE + fastCode
                  ] = length;
                  symbols[
                    HUFFMAN_FAST_SYMBOL_OFFSET + slot * HUFFMAN_FAST_SIZE + fastCode
                  ] = symbol;
                }
              }
            }

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

  // Metadata buffers pack image, quantization, component, and scan descriptors.
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

  function createEntropyIntervalData(intervals) {
    const data = new Uint32Array(intervals.length * ENTROPY_INTERVAL_STRIDE);

    intervals.forEach((interval, index) => {
      const base = index * ENTROPY_INTERVAL_STRIDE;

      data[base] = interval.start;
      data[base + 1] = interval.end;
      data[base + 2] = interval.startMcu;
      data[base + 3] = interval.mcuCount;
    });

    return data;
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

  // Readback is isolated so benchmark modes can separate GPU work from transfer cost.
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
