(function (global) {
  "use strict";

  const DC_Q_BASE64 = "BAAFAAYABwAIAAkACgAKAAsADAANAA4ADwAQABEAEQASABMAFAAUABUAFQAWABYAFwAXABgAGQAZABoAGwAcAB0AHgAfACAAIQAiACMAJAAlACUAJgAnACgAKQAqACsALAAtAC4ALgAvADAAMQAyADMANAA1ADYANwA4ADkAOgA7ADwAPQA+AD8AQABBAEIAQwBEAEUARgBHAEgASQBKAEsATABMAE0ATgBPAFAAUQBSAFMAVABVAFYAVwBYAFkAWwBdAF8AYABiAGQAZQBmAGgAagBsAG4AcAByAHQAdgB6AHwAfgCAAIIAhACGAIgAigCMAI8AkQCUAJcAmgCdAA==";
  const AC_Q_BASE64 = "BAAFAAYABwAIAAkACgALAAwADQAOAA8AEAARABIAEwAUABUAFgAXABgAGQAaABsAHAAdAB4AHwAgACEAIgAjACQAJQAmACcAKAApACoAKwAsAC0ALgAvADAAMQAyADMANAA1ADYANwA4ADkAOgA8AD4AQABCAEQARgBIAEoATABOAFAAUgBUAFYAWABaAFwAXgBgAGIAZABmAGgAagBsAG4AcAByAHQAdwB6AH0AgACDAIYAiQCMAI8AkgCVAJgAmwCeAKEApACnAKoArQCxALUAuQC9AMEAxQDJAM0A0QDVANkA3QDhAOUA6gDvAPUA+QD+AAMBCAENARIBFwEcAQ==";
  const BMODE_PROBS_BASE64 = "53gwWXNxeJhwmLNAfqp2LkZfr0WPUFVSSJtnODoKq9q9EQ2YkEcKJqvVkCIachoRoyzDFQqteRhQwxo+LEBVqi43E4igIc5HPxQIcnLQDAniUSgLYLZUHRAkhrdZiWJlaqWUSLtkgp1vIEtQQmanY0o+KOqAKTUJsvGNGghraE8MG9n/VxEHSisakkmmMRedQSZpoDM0H3OAV0RHLHIzD7oXLykObra3FRHCQi0ZZsW9FxIWWFiTliouLcTNK2G3dVUmI7M9JzXIVxoVK+irOCIzaHJmHV1NazYgGjMBUSsfJxxVqzqlWmJAIhZ0zhciK6ZJRBlqFkCrJOFyIhMVZoS8EEx8PhJOX1U5MjAzwWUjn9dvWS5vPJQfrNvkFRJvcHFNVbP/JnhyKCoBxPXRChltZFAIK5oBMxpHWCsdjKbVJSuaPT8em0MtRAHRjk5OEP+AIsWrKSgFZtO3BAHdMzIRqNHAFxlSfWIqWGhVda9SX1Q1WYBkcWUtS097LzOAUasBOREFR2Y5NSkxcxUCCmb/phcGJiENeTlJGgFVKQpDik1uWi9yZR0QClWAZcQaORIKZmbVIhQrdRQPJKOARAEaih8kqxumJizlQ1c6qVJzGjuzPztatDumXUmaKCgVdI/RIievOS4WGIABNhElLw8QtyLfMS23LhEhtwZiDyC3QSBJcxyAF4DNKAMJczPAEgbfVyUJcztNQBUvaDcs2gk2NYLiQFpGzSgpFxo5NjlwuAUpJqbVHiIahZh0CiCGSyAMM8D/oCszJxM13RpyIEn/HwlB6gIPAXZJWB8jQ2ZVN7pVOBUXbzvNLSXANyZGfElmASJiZj1HJSI1H/PARTxHJkl3HN4lRC2AIgEvC/WrPhETRpJVNz5GSw8JCUD/uHcQJSslmmSjVaABPwlciBxAIMlVVgYcBUD/GfgBOAgRhIn/N3SAOg8UUoc5GnkopDIfiZqFGSPaM2csg4N7HwaeVihAh5TgLbeAFhoRg/CaDgHRUwwNNsD/RC8cLRAVW0DeBwHFOBUnmzyKF2bVVRpVVYCAIJKrEgsHP5CrBAT2IxsKkq6rDBqAvlAjY7RQfjYtVX4vV7AzKRQgZUuAi3aSdIBVOCkPsOxVJQk+kiQTHqv/YRsURx4Rd3b/ERKKZSY8ijdGKxqOii09PtsBUbxAICkUdZeOFBWjcBMMPcOAMAQY";
  const COEFF_UPDATE_PROBS_BASE64 = "////////////////////////////////////////////sPb////////////f8fz///////////n9/f////////////T8///////////q/v7///////////3///////////////b+///////////v/f7///////////7//v////////////j+///////////7//7///////////////////////////3+///////////7/v7///////////7//v////////////79//7////////6//7//v////////7/////////////////////////////////////////////////////////2f/////////////h/PH9///+/////+r68fr9//3+//////7////////////f/v7//////////+79/v7///////////j+///////////5/v////////////////////////////3////////////3/v////////////////////////////3+///////////8//////////////////////////////7+///////////9//////////////////////////////79///////////6//////////////7/////////////////////////////////////////////////////////uvv6///////////q+/T+//////////v78/3+//7///////3+///////////s/f7///////////v9/f7+//////////7+///////////+/v7///////////////////////////7////////////+/v////////////7////////////////////////////+////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+P/////////////6/vz+//////////j++f3///////////39///////////2/f3///////////z++/7+//////////78///////////4/v3///////////3//v7///////////v+///////////1+/7///////////39/v////////////v9///////////8/f7////////////+//////////////z////////////5//7//////////////v/////////////9///////////6///////////////////////////////////////////+////////////////////////////";
  const DEFAULT_COEFF_PROBS_BASE64 = "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/Yj+/+TbgICAgIC9gfL/49X/24CAgGp+4/zW0f//gICAAWL4/+zi//+AgIC1he7+3er/moCAgE6GyvfGtP/bgICAAbn5//P/gICAgIC4lvf/7OCAgICAgE1u2P/s5oCAgICAAWX7//H/gICAgICqi/H87NH//4CAgCV0xPPk////gICAAcz+//X/gICAgIDPoPr/7oCAgICAgGZn5//Tq4CAgICAAZj8//D/gICAgICxh/P/6uGAgICAgFCB0//C4ICAgICAAQH/gICAgICAgID2Af+AgICAgICAgP+AgICAgICAgICAxiPt38G7oqCRmz6DLcbdrLDcnfzdAUQvktCVp92i/9+AAZXx/93g//+AgIC4jer93tz/x4CAgFFjtfKwvvnK//+AAYHo/dbF8sT//4BjedL6ycb/yoCAgBdbo/Kqu/fS//+AAcj2/+r/gICAgIBtsvH/5/X//4CAgCyCyf3NwP//gICAAYTv+9vR/6WAgIBeiOH72r7//4CAgBZkrvW6of/HgICAAbb5/+jrgICAgIB8j/H/4+qAgICAgCNNtfvB0//NgICAAZ33/+zn//+AgIB5jev/4eP//4CAgC1jvPvD2f/ggICAAQH7/9X/gICAgIDLAfj//4CAgICAgIkBsf/g/4CAgICA/Qn4+8/Q/8CAgICvDeDzwbn5xv//gEkRq92hs+yn/+qAAV/3/dS3//+AgIDvWvT609H//4CAgJtNw/i8w///gICAARjv+9rb/82AgIDJM9v/xLqAgICAgEUuvu/J2v/kgICAAb/7//+AgICAgIDfpfn/1f+AgICAgI18+P//gICAgICAARD4//+AgICAgIC+JOb/7P+AgICAgJUB/4CAgICAgICAAeL/gICAgICAgID3wP+AgICAgICAgPCA/4CAgICAgICAAYb8//+AgICAgIDVPvr//4CAgICAgDdd/4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAyhjV67q/3KDwr/9+Jrboqbjkrv+7gD0uituXsvCq/9iAAXDm+se/95///4CmbeT809f/roCAgCdNouistPWy//+AATTc9sbH+dz//4B8Sr/zt8H63f//gBhHgtuaqvO2//+AAbbh+dvw/+CAgICVluL82M3/q4CAgBxsqvK3wv7f//+AAVHm/MzL/8CAgIB7ZtH3vMT/6YCAgBRfmfOkrf/LgICAAd74/9jVgICAgICor/b8683//4CAgC901//T1P//gICAAXns/dTW//+AgICNVNX8ycr/24CAgCpQoPCiuf/NgICAAQH/gICAgICAgID0Af+AgICAgICAgO4B/4CAgICAgICA";

  const DC_Q = decodeBase64Uint16(DC_Q_BASE64);
  const AC_Q = decodeBase64Uint16(AC_Q_BASE64);
  const KfBmodeProbs = decodeBase64Bytes(BMODE_PROBS_BASE64);
  const CoeffUpdateProbs = decodeBase64Bytes(COEFF_UPDATE_PROBS_BASE64);
  const DefaultCoeffProbs = decodeBase64Bytes(DEFAULT_COEFF_PROBS_BASE64);

  const Y_MODE_TREE = [-4, 2, 4, 6, 0, -1, -2, -3];
  const UV_MODE_TREE = [0, 2, -1, 4, -2, -3];
  const SEGMENT_TREE = [2, 4, 0, -1, -2, -3];
  const B_MODE_TREE = [
    0, 2, -1, 4, -2, 6, 8, 12, -3, 10, -5, -6, -4, 14, -7, 16, -8, -9,
  ];
  const COEFF_TREE = [
    0, 2, -1, 4, -2, 6, 8, 12, -3, 10, -4, -5, 14, 16, -6, -7, 18, 20, -8, -9, -10, -11,
  ];
  const COEFF_BANDS = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7];
  const ZIG_ZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
  const EXTRA_PROBS = [
    [159],
    [165, 145],
    [173, 148, 140],
    [176, 155, 140, 135],
    [180, 157, 141, 134, 130],
    [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129],
  ];
  const EXTRA_BASE = [5, 7, 11, 19, 35, 67];

  const DC_PRED = 0;
  const V_PRED = 1;
  const H_PRED = 2;
  const TM_PRED = 3;
  const B_PRED = 4;

  const B_DC_PRED = 0;
  const B_TM_PRED = 1;
  const B_VE_PRED = 2;
  const B_HE_PRED = 3;
  const B_LD_PRED = 4;
  const B_RD_PRED = 5;
  const B_VR_PRED = 6;
  const B_VL_PRED = 7;
  const B_HD_PRED = 8;
  const B_HU_PRED = 9;

  class PureJsWebpDecoder {
    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch WebP: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    decode(arrayBuffer) {
      const parseStarted = now();
      const container = parseWebpContainer(arrayBuffer);
      const vp8 = parseVp8Frame(container.vp8);
      const parseMs = now() - parseStarted;
      const decodeStarted = now();
      const decoder = new Vp8KeyFrameDecoder(vp8);
      const decoded = decoder.decode();
      const decodeMs = now() - decodeStarted;
      const convertStarted = now();
      const pixels = convertYuvToRgba(decoded);
      const convertMs = now() - convertStarted;

      return {
        width: decoded.width,
        height: decoded.height,
        pixels,
        timings: {
          parseMs,
          decodeMs,
          convertMs,
          setupMs: parseMs,
          workMs: parseMs + decodeMs + convertMs,
          readbackMs: 0,
          totalDecoderMs: parseMs + decodeMs + convertMs,
          measuresCleanWork: true,
          timedPhase: "Pure JS WebP VP8 decode",
        },
      };
    }
  }

  class Vp8KeyFrameDecoder {
    constructor(frame) {
      this.frame = frame;
      this.width = frame.width;
      this.height = frame.height;
      this.mbWidth = Math.ceil(frame.width / 16);
      this.mbHeight = Math.ceil(frame.height / 16);
      this.yStride = this.mbWidth * 16;
      this.uvStride = this.mbWidth * 8;
      this.yHeight = this.mbHeight * 16;
      this.uvHeight = this.mbHeight * 8;
      this.y = new Uint8Array(this.yStride * this.yHeight);
      this.u = new Uint8Array(this.uvStride * this.uvHeight);
      this.v = new Uint8Array(this.uvStride * this.uvHeight);
      this.coeffProbs = DefaultCoeffProbs.slice();
      this.segment = {
        enabled: false,
        updateMap: false,
        abs: false,
        probs: [255, 255, 255],
        quant: [0, 0, 0, 0],
        filter: [0, 0, 0, 0],
      };
      this.filter = {
        simple: false,
        level: 0,
        sharpness: 0,
        useLfDelta: false,
        refLfDelta: [0, 0, 0, 0],
        modeLfDelta: [0, 0, 0, 0],
        params: [],
      };
      this.quantHeader = null;
      this.dequants = null;
      this.macroblockFilters = new Array(this.mbWidth * this.mbHeight);
      this.mbNoSkipCoeff = 0;
      this.probSkipFalse = 0;
      this.aboveY = new Uint8Array(this.mbWidth * 4);
      this.aboveU = new Uint8Array(this.mbWidth * 2);
      this.aboveV = new Uint8Array(this.mbWidth * 2);
      this.aboveY2 = new Uint8Array(this.mbWidth);
    }

    decode() {
      const modeReader = this.frame.modeReader;

      this.decodeFrameHeader(modeReader);

      for (let mbY = 0; mbY < this.mbHeight; mbY += 1) {
        const leftCoeffY = new Uint8Array(4);
        const leftCoeffU = new Uint8Array(2);
        const leftCoeffV = new Uint8Array(2);
        const leftBModes = new Uint8Array(4);
        let leftY2 = 0;
        const tokenReader = this.frame.tokenReaders[mbY & (this.frame.tokenReaders.length - 1)];

        for (let mbX = 0; mbX < this.mbWidth; mbX += 1) {
          this.decodeMacroblock(
            modeReader,
            tokenReader,
            mbX,
            mbY,
            leftCoeffY,
            leftCoeffU,
            leftCoeffV,
            leftBModes,
            leftY2
          );
          leftY2 = this.currentLeftY2;
        }
      }

      this.applyLoopFilter();

      return {
        width: this.width,
        height: this.height,
        y: this.y,
        u: this.u,
        v: this.v,
        yStride: this.yStride,
        uvStride: this.uvStride,
      };
    }

    decodeFrameHeader(reader) {
      reader.readBool(128); // color space: only YUV is expected for WebP VP8.
      reader.readBool(128); // clamping type.

      this.segment.enabled = Boolean(reader.readBool(128));

      if (this.segment.enabled) {
        this.decodeSegmentationHeader(reader);
      }

      this.decodeFilterHeader(reader);

      const logTokenPartitions = reader.readLiteral(2);

      if ((1 << logTokenPartitions) !== this.frame.tokenReaders.length) {
        throw new Error("VP8 token partition count mismatch.");
      }

      this.quantHeader = {
        qIndex: reader.readLiteral(7),
        yDcDelta: readDelta(reader),
        y2DcDelta: readDelta(reader),
        y2AcDelta: readDelta(reader),
        uvDcDelta: readDelta(reader),
        uvAcDelta: readDelta(reader),
      };
      reader.readBool(128); // refresh entropy probabilities.
      this.decodeCoeffProbabilityUpdates(reader);
      this.mbNoSkipCoeff = reader.readBool(128);

      if (this.mbNoSkipCoeff) {
        this.probSkipFalse = reader.readLiteral(8);
      }

      this.dequants = this.createDequantTables();
      this.filter.params = this.createFilterParams();
    }

    decodeSegmentationHeader(reader) {
      this.segment.updateMap = Boolean(reader.readBool(128));

      if (reader.readBool(128)) {
        this.segment.abs = Boolean(reader.readBool(128));

        for (let index = 0; index < 4; index += 1) {
          this.segment.quant[index] = reader.readBool(128) ? readSignedMagnitude(reader, 7) : 0;
        }

        for (let index = 0; index < 4; index += 1) {
          this.segment.filter[index] = reader.readBool(128) ? readSignedMagnitude(reader, 6) : 0;
        }
      }

      if (this.segment.updateMap) {
        for (let index = 0; index < 3; index += 1) {
          this.segment.probs[index] = reader.readBool(128) ? reader.readLiteral(8) : 255;
        }
      }
    }

    decodeFilterHeader(reader) {
      this.filter.simple = Boolean(reader.readBool(128));
      this.filter.level = reader.readLiteral(6);
      this.filter.sharpness = reader.readLiteral(3);
      this.filter.useLfDelta = Boolean(reader.readBool(128));

      if (this.filter.useLfDelta && reader.readBool(128)) {
        for (let index = 0; index < 4; index += 1) {
          this.filter.refLfDelta[index] = reader.readBool(128) ? readSignedMagnitude(reader, 6) : 0;
        }

        for (let index = 0; index < 4; index += 1) {
          this.filter.modeLfDelta[index] = reader.readBool(128) ? readSignedMagnitude(reader, 6) : 0;
        }
      }
    }

    decodeCoeffProbabilityUpdates(reader) {
      for (let index = 0; index < this.coeffProbs.length; index += 1) {
        if (reader.readBool(CoeffUpdateProbs[index])) {
          this.coeffProbs[index] = reader.readLiteral(8);
        }
      }
    }

    createDequantTables() {
      const segmentCount = this.segment.enabled ? 4 : 1;
      const tables = [];

      for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
        let q = this.quantHeader.qIndex;

        if (this.segment.enabled) {
          q = this.segment.abs ? this.segment.quant[segmentId] : q + this.segment.quant[segmentId];
        }

        const y1 = [
          dcQ(q + this.quantHeader.yDcDelta),
          acQ(q),
        ];
        const uv = [
          Math.min(dcQ(q + this.quantHeader.uvDcDelta), 132),
          acQ(q + this.quantHeader.uvAcDelta),
        ];
        const y2 = [
          dcQ(q + this.quantHeader.y2DcDelta) * 2,
          Math.max(Math.floor((acQ(q + this.quantHeader.y2AcDelta) * 155) / 100), 8),
        ];

        tables.push({ y1, y2, uv });
      }

      return tables;
    }

    createFilterParams() {
      const segmentCount = this.segment.enabled ? 4 : 1;
      const params = [];

      for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
        let baseLevel = this.filter.level;

        if (this.segment.enabled) {
          baseLevel = this.segment.filter[segmentId];

          if (!this.segment.abs) {
            baseLevel += this.filter.level;
          }
        }

        params[segmentId] = [];

        for (let modeIndex = 0; modeIndex < 2; modeIndex += 1) {
          params[segmentId][modeIndex] = createFilterParam(baseLevel, modeIndex, this.filter);
        }
      }

      return params;
    }

    decodeMacroblock(modeReader, tokenReader, mbX, mbY, leftCoeffY, leftCoeffU, leftCoeffV, leftBModes, leftY2) {
      const segmentId = this.segment.updateMap
        ? readTree(modeReader, SEGMENT_TREE, this.segment.probs)
        : 0;
      const skipCoeff = this.mbNoSkipCoeff ? modeReader.readBool(this.probSkipFalse) : 0;
      const yMode = readTree(modeReader, Y_MODE_TREE, [145, 156, 163, 128]);
      const bModes = new Uint8Array(16);
      let hasCoeff = false;

      if (yMode === B_PRED) {
        this.decodeSubblockModes(modeReader, mbX, mbY, bModes, leftBModes);
      } else {
        bModes.fill(yModeToBMode(yMode));
      }

      const uvMode = readTree(modeReader, UV_MODE_TREE, [142, 114, 183]);
      const dequant = this.dequants[segmentId] || this.dequants[0];
      const macroblock = createEmptyMacroblock();

      if (yMode !== B_PRED) {
        predictLuma(this.y, this.yStride, mbX, mbY, yMode, bModes);
      }

      predictChroma(this.u, this.uvStride, mbX, mbY, uvMode);
      predictChroma(this.v, this.uvStride, mbX, mbY, uvMode);

      if (!skipCoeff) {
        const residuals = this.decodeMacroblockResiduals(
          tokenReader,
          mbX,
          mbY,
          yMode,
          dequant,
          macroblock,
          leftCoeffY,
          leftCoeffU,
          leftCoeffV,
          leftY2
        );
        leftY2 = residuals.leftY2;
        hasCoeff = residuals.hasCoeff;
      } else {
        clearMacroblockContexts(mbX, leftCoeffY, leftCoeffU, leftCoeffV, this.aboveY, this.aboveU, this.aboveV);
        if (yMode !== B_PRED) {
          this.aboveY2[mbX] = 0;
          leftY2 = 0;
        }
      }

      if (yMode === B_PRED) {
        reconstructLumaSubblocks(this.y, this.yStride, mbX, mbY, bModes, macroblock.y);
      } else {
        addLumaResiduals(this.y, this.yStride, mbX, mbY, macroblock.y);
      }

      addChromaResiduals(this.u, this.uvStride, mbX, mbY, macroblock.u);
      addChromaResiduals(this.v, this.uvStride, mbX, mbY, macroblock.v);

      updateBModeContexts(mbX, bModes, this.frame.aboveBModes, leftBModes);
      this.macroblockFilters[mbY * this.mbWidth + mbX] = this.createMacroblockFilter(segmentId, yMode, hasCoeff);
      this.currentLeftY2 = leftY2;
    }

    createMacroblockFilter(segmentId, yMode, hasCoeff) {
      const modeIndex = yMode === B_PRED ? 1 : 0;
      const base = (this.filter.params[segmentId] || this.filter.params[0] || [])[modeIndex];

      if (!base) {
        return null;
      }

      return {
        level: base.level,
        ilevel: base.ilevel,
        hlevel: base.hlevel,
        inner: base.inner || hasCoeff,
      };
    }

    decodeSubblockModes(reader, mbX, mbY, bModes, leftBModes) {
      for (let blockY = 0; blockY < 4; blockY += 1) {
        for (let blockX = 0; blockX < 4; blockX += 1) {
          const aboveMode = blockY > 0
            ? bModes[(blockY - 1) * 4 + blockX]
            : mbY > 0
            ? this.frame.aboveBModes[mbX * 4 + blockX]
            : B_DC_PRED;
          const leftMode = blockX > 0
            ? bModes[blockY * 4 + blockX - 1]
            : leftBModes[blockY];
          const probs = getBModeProbs(aboveMode, leftMode);

          bModes[blockY * 4 + blockX] = readTree(reader, B_MODE_TREE, probs);
        }
      }
    }

    decodeMacroblockResiduals(reader, mbX, mbY, yMode, dequant, macroblock, leftY, leftU, leftV, leftY2) {
      const y2Dc = new Int16Array(16);
      let hasCoeff = false;

      if (yMode !== B_PRED) {
        const y2Coeffs = decodeCoeffBlock({
          reader,
          coeffProbs: this.coeffProbs,
          blockType: 1,
          dequant: dequant.y2,
          left: { array: null, value: leftY2 },
          above: { array: this.aboveY2, index: mbX },
          startCoeff: 0,
        });

        inverseWalsh(y2Coeffs.coeffs, y2Dc);
        leftY2 = y2Coeffs.hasCoeff ? 1 : 0;
        this.aboveY2[mbX] = leftY2;
        hasCoeff = hasCoeff || y2Coeffs.hasCoeff;
      }

      for (let index = 0; index < 16; index += 1) {
        const blockX = index & 3;
        const blockY = index >> 2;
        const decoded = decodeCoeffBlock({
          reader,
          coeffProbs: this.coeffProbs,
          blockType: yMode === B_PRED ? 3 : 0,
          dequant: dequant.y1,
          left: { array: leftY, index: blockY },
          above: { array: this.aboveY, index: mbX * 4 + blockX },
          startCoeff: yMode === B_PRED ? 0 : 1,
        });

        if (yMode !== B_PRED) {
          decoded.coeffs[0] = y2Dc[index];
        }

        inverseDct(decoded.coeffs, macroblock.y[index]);
        hasCoeff = hasCoeff || decoded.hasCoeff;
      }

      for (let index = 0; index < 4; index += 1) {
        const blockX = index & 1;
        const blockY = index >> 1;
        const decodedU = decodeCoeffBlock({
          reader,
          coeffProbs: this.coeffProbs,
          blockType: 2,
          dequant: dequant.uv,
          left: { array: leftU, index: blockY },
          above: { array: this.aboveU, index: mbX * 2 + blockX },
          startCoeff: 0,
        });

        inverseDct(decodedU.coeffs, macroblock.u[index]);
        hasCoeff = hasCoeff || decodedU.hasCoeff;
      }

      for (let index = 0; index < 4; index += 1) {
        const blockX = index & 1;
        const blockY = index >> 1;
        const decodedV = decodeCoeffBlock({
          reader,
          coeffProbs: this.coeffProbs,
          blockType: 2,
          dequant: dequant.uv,
          left: { array: leftV, index: blockY },
          above: { array: this.aboveV, index: mbX * 2 + blockX },
          startCoeff: 0,
        });

        inverseDct(decodedV.coeffs, macroblock.v[index]);
        hasCoeff = hasCoeff || decodedV.hasCoeff;
      }

      return { leftY2, hasCoeff };
    }

    applyLoopFilter() {
      if (this.filter.level === 0) {
        return;
      }

      for (let mbY = 0; mbY < this.mbHeight; mbY += 1) {
        for (let mbX = 0; mbX < this.mbWidth; mbX += 1) {
          const filter = this.macroblockFilters[mbY * this.mbWidth + mbX];

          if (!filter || filter.level === 0) {
            continue;
          }

          const yIndex = mbY * this.yStride * 16 + mbX * 16;
          const cIndex = mbY * this.uvStride * 8 + mbX * 8;

          if (this.filter.simple) {
            applySimpleLoopFilter(this.y, this.yStride, yIndex, mbX, mbY, filter);
          } else {
            applyNormalLoopFilter(this.y, this.u, this.v, this.yStride, this.uvStride, yIndex, cIndex, mbX, mbY, filter);
          }
        }
      }
    }
  }

  class BoolDecoder {
    constructor(bytes, start, end) {
      this.bytes = bytes;
      this.pos = start + 2;
      this.end = end;
      this.range = 255;
      this.value = ((bytes[start] || 0) << 8) | (bytes[start + 1] || 0);
      this.bitCount = 0;
    }

    readBool(probability) {
      const split = 1 + (((this.range - 1) * probability) >> 8);
      const splitScaled = split << 8;
      let bit;

      if (this.value >= splitScaled) {
        bit = 1;
        this.range -= split;
        this.value -= splitScaled;
      } else {
        bit = 0;
        this.range = split;
      }

      while (this.range < 128) {
        this.value = (this.value << 1) & 0xffffff;
        this.range <<= 1;

        if (++this.bitCount === 8) {
          this.bitCount = 0;
          this.value |= this.pos < this.end ? this.bytes[this.pos++] : 0;
        }
      }

      return bit;
    }

    readLiteral(bits) {
      let value = 0;

      while (bits-- > 0) {
        value = (value << 1) | this.readBool(128);
      }

      return value;
    }
  }

  function parseWebpContainer(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer);

    if (readFourCc(bytes, 0) !== "RIFF" || readFourCc(bytes, 8) !== "WEBP") {
      throw new Error("Invalid WebP RIFF container.");
    }

    let offset = 12;
    let vp8 = null;

    while (offset + 8 <= bytes.length) {
      const id = readFourCc(bytes, offset);
      const size = readUint32LE(bytes, offset + 4);
      const payloadOffset = offset + 8;
      const nextOffset = payloadOffset + size + (size & 1);

      if (payloadOffset + size > bytes.length) {
        throw new Error(`Invalid WebP chunk size for ${id}.`);
      }

      if (id === "VP8 ") {
        vp8 = bytes.subarray(payloadOffset, payloadOffset + size);
      } else if (id === "VP8L") {
        throw new Error("Pure JS WebP decoder does not support lossless VP8L yet.");
      } else if (id === "ANIM" || id === "ANMF") {
        throw new Error("Pure JS WebP decoder does not support animated WebP.");
      }

      offset = nextOffset;
    }

    if (!vp8) {
      throw new Error("WebP container does not contain a VP8 lossy chunk.");
    }

    return { vp8 };
  }

  function parseVp8Frame(bytes) {
    if (bytes.length < 10) {
      throw new Error("Truncated VP8 key frame.");
    }

    const tag = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
    const keyFrame = (tag & 1) === 0;
    const version = (tag >> 1) & 7;
    const showFrame = (tag >> 4) & 1;
    const firstPartitionSize = tag >> 5;

    if (!keyFrame) {
      throw new Error("WebP decoder only supports VP8 key frames.");
    }

    if (version > 3) {
      throw new Error(`Unsupported VP8 bitstream version ${version}.`);
    }

    if (!showFrame) {
      throw new Error("VP8 frame is marked as not displayable.");
    }

    if (bytes[3] !== 0x9d || bytes[4] !== 0x01 || bytes[5] !== 0x2a) {
      throw new Error("Invalid VP8 key-frame start code.");
    }

    const width = readUint16LE(bytes, 6) & 0x3fff;
    const height = readUint16LE(bytes, 8) & 0x3fff;
    const firstPartitionOffset = 10;
    const firstPartitionEnd = firstPartitionOffset + firstPartitionSize;

    if (firstPartitionEnd > bytes.length) {
      throw new Error("Truncated VP8 first partition.");
    }

    const modeReader = new BoolDecoder(bytes, firstPartitionOffset, firstPartitionEnd);
    const tokenPartitionCount = peekTokenPartitionCount(bytes, firstPartitionOffset, firstPartitionEnd);
    const tokenReaders = createTokenReaders(bytes, firstPartitionEnd, tokenPartitionCount);

    return {
      bytes,
      width,
      height,
      modeReader,
      tokenReaders,
      aboveBModes: new Uint8Array(Math.ceil(width / 16) * 4),
    };
  }

  function peekTokenPartitionCount(bytes, firstPartitionOffset, firstPartitionEnd) {
    const reader = new BoolDecoder(bytes, firstPartitionOffset, firstPartitionEnd);

    reader.readBool(128);
    reader.readBool(128);

    if (reader.readBool(128)) {
      const updateMap = reader.readBool(128);

      if (reader.readBool(128)) {
        reader.readBool(128);

        for (let index = 0; index < 4; index += 1) {
          if (reader.readBool(128)) {
            readSignedMagnitude(reader, 7);
          }
        }

        for (let index = 0; index < 4; index += 1) {
          if (reader.readBool(128)) {
            readSignedMagnitude(reader, 6);
          }
        }
      }

      if (updateMap) {
        for (let index = 0; index < 3; index += 1) {
          if (reader.readBool(128)) {
            reader.readLiteral(8);
          }
        }
      }
    }

    reader.readBool(128);
    reader.readLiteral(6);
    reader.readLiteral(3);

    if (reader.readBool(128)) {
      if (reader.readBool(128)) {
        for (let index = 0; index < 8; index += 1) {
          if (reader.readBool(128)) {
            readSignedMagnitude(reader, 6);
          }
        }
      }
    }

    return 1 << reader.readLiteral(2);
  }

  function createTokenReaders(bytes, offset, partitionCount) {
    const starts = new Array(partitionCount);
    const ends = new Array(partitionCount);
    let partitionDataOffset = offset + Math.max(0, partitionCount - 1) * 3;

    for (let index = 0; index < partitionCount - 1; index += 1) {
      const size = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

      starts[index] = partitionDataOffset;
      ends[index] = partitionDataOffset + size;
      partitionDataOffset += size;
      offset += 3;
    }

    starts[partitionCount - 1] = partitionDataOffset;
    ends[partitionCount - 1] = bytes.length;

    return starts.map((start, index) => new BoolDecoder(bytes, start, ends[index]));
  }

  function decodeCoeffBlock(options) {
    const coeffs = new Int16Array(16);
    const leftValue = options.left.array ? options.left.array[options.left.index] : options.left.value;
    const aboveValue = options.above.array[options.above.index];
    let context = leftValue + aboveValue;
    let previousZero = false;
    let hasCoeff = false;

    for (let coeffIndex = options.startCoeff; coeffIndex < 16; coeffIndex += 1) {
      const probOffset = coeffProbOffset(options.blockType, COEFF_BANDS[coeffIndex], context);
      const token = readTreeAt(
        options.reader,
        COEFF_TREE,
        options.coeffProbs,
        probOffset,
        previousZero ? 2 : 0
      );

      if (token === 0) {
        break;
      }

      let absValue = 0;

      if (token !== 1) {
        absValue = tokenToAbsValue(options.reader, token);
        hasCoeff = true;
        coeffs[ZIG_ZAG[coeffIndex]] = (
          options.reader.readBool(128) ? -absValue : absValue
        ) * (coeffIndex === 0 ? options.dequant[0] : options.dequant[1]);
      }

      context = absValue === 0 ? 0 : absValue === 1 ? 1 : 2;
      previousZero = absValue === 0;
    }

    if (options.left.array) {
      options.left.array[options.left.index] = hasCoeff ? 1 : 0;
    }

    options.above.array[options.above.index] = hasCoeff ? 1 : 0;

    return { coeffs, hasCoeff };
  }

  function inverseWalsh(input, output) {
    const temp = new Int32Array(16);

    for (let index = 0; index < 4; index += 1) {
      const a1 = input[index] + input[index + 12];
      const b1 = input[index + 4] + input[index + 8];
      const c1 = input[index + 4] - input[index + 8];
      const d1 = input[index] - input[index + 12];

      temp[index] = a1 + b1;
      temp[index + 4] = c1 + d1;
      temp[index + 8] = a1 - b1;
      temp[index + 12] = d1 - c1;
    }

    for (let row = 0; row < 4; row += 1) {
      const offset = row * 4;
      const a1 = temp[offset] + temp[offset + 3];
      const b1 = temp[offset + 1] + temp[offset + 2];
      const c1 = temp[offset + 1] - temp[offset + 2];
      const d1 = temp[offset] - temp[offset + 3];

      output[offset] = (a1 + b1 + 3) >> 3;
      output[offset + 1] = (c1 + d1 + 3) >> 3;
      output[offset + 2] = (a1 - b1 + 3) >> 3;
      output[offset + 3] = (d1 - c1 + 3) >> 3;
    }
  }

  function inverseDct(input, output) {
    const temp = new Int32Array(16);
    const cospi8sqrt2 = 85627;
    const sinpi8sqrt2 = 35468;

    for (let column = 0; column < 4; column += 1) {
      const a1 = input[column] + input[column + 8];
      const b1 = input[column] - input[column + 8];
      const c1 = mulShift16(input[column + 4], sinpi8sqrt2)
        - mulShift16(input[column + 12], cospi8sqrt2);
      const d1 = mulShift16(input[column + 4], cospi8sqrt2)
        + mulShift16(input[column + 12], sinpi8sqrt2);

      temp[column] = a1 + d1;
      temp[column + 12] = a1 - d1;
      temp[column + 4] = b1 + c1;
      temp[column + 8] = b1 - c1;
    }

    for (let row = 0; row < 4; row += 1) {
      const offset = row * 4;
      const a1 = temp[offset] + temp[offset + 2];
      const b1 = temp[offset] - temp[offset + 2];
      const c1 = mulShift16(temp[offset + 1], sinpi8sqrt2)
        - mulShift16(temp[offset + 3], cospi8sqrt2);
      const d1 = mulShift16(temp[offset + 1], cospi8sqrt2)
        + mulShift16(temp[offset + 3], sinpi8sqrt2);

      output[offset] = (a1 + d1 + 4) >> 3;
      output[offset + 3] = (a1 - d1 + 4) >> 3;
      output[offset + 1] = (b1 + c1 + 4) >> 3;
      output[offset + 2] = (b1 - c1 + 4) >> 3;
    }
  }

  function mulShift16(value, multiplier) {
    return Math.floor((value * multiplier) / 65536);
  }

  function predictLuma(plane, stride, mbX, mbY, mode, bModes) {
    const x = mbX * 16;
    const y = mbY * 16;

    if (mode === B_PRED) {
      for (let blockY = 0; blockY < 4; blockY += 1) {
        for (let blockX = 0; blockX < 4; blockX += 1) {
          predictSubblock(plane, stride, x + blockX * 4, y + blockY * 4, bModes[blockY * 4 + blockX]);
        }
      }

      return;
    }

    predictBlock(plane, stride, x, y, 16, 16, mode);
  }

  function predictChroma(plane, stride, mbX, mbY, uvMode) {
    predictBlock(plane, stride, mbX * 8, mbY * 8, 8, 8, uvMode);
  }

  function predictBlock(plane, stride, x, y, width, height, mode) {
    const hasTop = y > 0;
    const hasLeft = x > 0;
    const above = new Array(width);
    const left = new Array(height);

    for (let index = 0; index < width; index += 1) {
      above[index] = hasTop ? plane[y * stride - stride + x + index] : 127;
    }

    for (let index = 0; index < height; index += 1) {
      left[index] = hasLeft ? plane[(y + index) * stride + x - 1] : 129;
    }

    const topLeft = hasTop ? (hasLeft ? plane[y * stride - stride + x - 1] : 129) : 127;
    let dc = 128;

    if (mode === DC_PRED) {
      if (hasTop && hasLeft) {
        dc = (sumArray(above) + sumArray(left) + width) >> (width === 16 ? 5 : 4);
      } else if (hasTop) {
        dc = (sumArray(above) + (width >> 1)) >> (width === 16 ? 4 : 3);
      } else if (hasLeft) {
        dc = (sumArray(left) + (height >> 1)) >> (height === 16 ? 4 : 3);
      }
    }

    for (let row = 0; row < height; row += 1) {
      const offset = (y + row) * stride + x;

      for (let column = 0; column < width; column += 1) {
        let value = dc;

        if (mode === V_PRED) {
          value = above[column];
        } else if (mode === H_PRED) {
          value = left[row];
        } else if (mode === TM_PRED) {
          value = clampByte(left[row] + above[column] - topLeft);
        }

        plane[offset + column] = value;
      }
    }
  }

  function predictSubblock(plane, stride, x, y, mode) {
    const A = new Array(9);
    const L = new Array(4);
    const block = new Array(16);
    const hasTop = y > 0;
    const hasLeft = x > 0;
    const mbBaseX = Math.floor(x / 16) * 16;
    const mbBaseY = Math.floor(y / 16) * 16;
    const blockXInMb = (x - mbBaseX) >> 2;

    A[-1] = hasTop ? (hasLeft ? plane[(y - 1) * stride + x - 1] : 129) : 127;

    for (let index = 0; index < 8; index += 1) {
      A[index] = readSubblockAbovePixel(plane, stride, x, y, mbBaseX, mbBaseY, blockXInMb, index);
    }

    for (let index = 0; index < 4; index += 1) {
      L[index] = hasLeft ? plane[(y + index) * stride + x - 1] : 129;
    }

    fillSubblockPrediction(block, mode, A, L);

    for (let row = 0; row < 4; row += 1) {
      const offset = (y + row) * stride + x;

      for (let column = 0; column < 4; column += 1) {
        plane[offset + column] = block[row * 4 + column];
      }
    }
  }

  function readSubblockAbovePixel(plane, stride, x, y, mbBaseX, mbBaseY, blockXInMb, index) {
    if (y === 0) {
      return 127;
    }

    if (blockXInMb === 3 && index >= 4) {
      const row = mbBaseY - 1;
      const column = mbBaseX + 16 + index - 4;

      if (row < 0) {
        return 127;
      }

      return plane[row * stride + Math.min(column, stride - 1)];
    }

    return plane[(y - 1) * stride + Math.min(x + index, stride - 1)];
  }

  function fillSubblockPrediction(B, mode, A, L) {
    const set = (row, column, value) => {
      B[row * 4 + column] = value;
    };
    const X = A[-1];
    const A0 = A[0];
    const A1 = A[1];
    const A2 = A[2];
    const A3 = A[3];
    const L0 = L[0];
    const L1 = L[1];
    const L2 = L[2];
    const L3 = L[3];

    if (mode === B_DC_PRED) {
      const value = (A[0] + A[1] + A[2] + A[3] + L[0] + L[1] + L[2] + L[3] + 4) >> 3;

      B.fill(value);
      return;
    }

    if (mode === B_TM_PRED) {
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          set(row, column, clampByte(L[row] + A[column] - A[-1]));
        }
      }

      return;
    }

    if (mode === B_VE_PRED) {
      for (let column = 0; column < 4; column += 1) {
        const value = avg3(A[column - 1], A[column], A[column + 1]);

        for (let row = 0; row < 4; row += 1) {
          set(row, column, value);
        }
      }

      return;
    }

    if (mode === B_HE_PRED) {
      for (let row = 0; row < 4; row += 1) {
        const value = row === 3 ? avg3(L[2], L[3], L[3]) : avg3(L[row - 1] ?? A[-1], L[row], L[row + 1]);

        for (let column = 0; column < 4; column += 1) {
          set(row, column, value);
        }
      }

      return;
    }

    if (mode === B_LD_PRED) {
      set(0, 0, avg3(A[0], A[1], A[2]));
      set(0, 1, avg3(A[1], A[2], A[3])); set(1, 0, B[1]);
      set(0, 2, avg3(A[2], A[3], A[4])); set(1, 1, B[2]); set(2, 0, B[2]);
      set(0, 3, avg3(A[3], A[4], A[5])); set(1, 2, B[3]); set(2, 1, B[3]); set(3, 0, B[3]);
      set(1, 3, avg3(A[4], A[5], A[6])); set(2, 2, B[7]); set(3, 1, B[7]);
      set(2, 3, avg3(A[5], A[6], A[7])); set(3, 2, B[11]);
      set(3, 3, avg3(A[6], A[7], A[7]));
      return;
    }

    if (mode === B_RD_PRED) {
      set(0, 0, avg3(A0, X, L0));
      set(0, 1, avg3(X, A0, A1));
      set(0, 2, avg3(A0, A1, A2));
      set(0, 3, avg3(A1, A2, A3));
      set(1, 0, avg3(L1, L0, X));
      set(1, 1, B[0]);
      set(1, 2, B[1]);
      set(1, 3, B[2]);
      set(2, 0, avg3(L2, L1, L0));
      set(2, 1, B[4]);
      set(2, 2, B[5]);
      set(2, 3, B[6]);
      set(3, 0, avg3(L3, L2, L1));
      set(3, 1, B[8]);
      set(3, 2, B[9]);
      set(3, 3, B[10]);
      return;
    }

    if (mode === B_VR_PRED) {
      set(0, 0, avg2(X, A0));
      set(0, 1, avg2(A0, A1));
      set(0, 2, avg2(A1, A2));
      set(0, 3, avg2(A2, A3));
      set(1, 0, avg3(L0, X, A0));
      set(1, 1, avg3(X, A0, A1));
      set(1, 2, avg3(A0, A1, A2));
      set(1, 3, avg3(A1, A2, A3));
      set(2, 0, avg3(X, L0, L1));
      set(2, 1, B[0]);
      set(2, 2, B[1]);
      set(2, 3, B[2]);
      set(3, 0, avg3(L2, L1, L0));
      set(3, 1, B[4]);
      set(3, 2, B[5]);
      set(3, 3, B[6]);
      return;
    }

    if (mode === B_VL_PRED) {
      set(0, 0, avg2(A[0], A[1]));
      set(1, 0, avg3(A[0], A[1], A[2]));
      set(2, 0, avg2(A[1], A[2])); set(0, 1, B[8]);
      set(1, 1, avg3(A[1], A[2], A[3])); set(3, 0, B[5]);
      set(2, 1, avg2(A[2], A[3])); set(0, 2, B[9]);
      set(3, 1, avg3(A[2], A[3], A[4])); set(1, 2, B[13]);
      set(2, 2, avg2(A[3], A[4])); set(0, 3, B[10]);
      set(3, 2, avg3(A[3], A[4], A[5])); set(1, 3, B[14]);
      set(2, 3, avg3(A[4], A[5], A[6]));
      set(3, 3, avg3(A[5], A[6], A[7]));
      return;
    }

    if (mode === B_HD_PRED) {
      set(0, 0, avg2(X, L0));
      set(0, 1, avg3(L0, X, A0));
      set(0, 2, avg3(X, A0, A1));
      set(0, 3, avg3(A0, A1, A2));
      set(1, 0, avg2(L0, L1));
      set(1, 1, avg3(X, L0, L1));
      set(1, 2, B[0]);
      set(1, 3, B[1]);
      set(2, 0, avg2(L1, L2));
      set(2, 1, avg3(L0, L1, L2));
      set(2, 2, B[4]);
      set(2, 3, B[5]);
      set(3, 0, avg2(L2, L3));
      set(3, 1, avg3(L1, L2, L3));
      set(3, 2, B[8]);
      set(3, 3, B[9]);
      return;
    }

    if (mode === B_HU_PRED) {
      set(0, 0, avg2(L[0], L[1]));
      set(0, 1, avg3(L[0], L[1], L[2]));
      set(0, 2, avg2(L[1], L[2])); set(1, 0, B[2]);
      set(0, 3, avg3(L[1], L[2], L[3])); set(1, 1, B[3]);
      set(1, 2, avg2(L[2], L[3])); set(2, 0, B[6]);
      set(1, 3, avg3(L[2], L[3], L[3])); set(2, 1, B[7]);
      set(2, 2, L[3]); set(2, 3, L[3]); set(3, 0, L[3]); set(3, 1, L[3]); set(3, 2, L[3]); set(3, 3, L[3]);
    }
  }

  function addLumaResiduals(plane, stride, mbX, mbY, blocks) {
    const baseX = mbX * 16;
    const baseY = mbY * 16;

    for (let index = 0; index < 16; index += 1) {
      addBlock(plane, stride, baseX + (index & 3) * 4, baseY + (index >> 2) * 4, blocks[index]);
    }
  }

  function reconstructLumaSubblocks(plane, stride, mbX, mbY, bModes, blocks) {
    const baseX = mbX * 16;
    const baseY = mbY * 16;

    for (let index = 0; index < 16; index += 1) {
      const x = baseX + (index & 3) * 4;
      const y = baseY + (index >> 2) * 4;

      predictSubblock(plane, stride, x, y, bModes[index]);
      addBlock(plane, stride, x, y, blocks[index]);
    }
  }

  function addChromaResiduals(plane, stride, mbX, mbY, blocks) {
    const baseX = mbX * 8;
    const baseY = mbY * 8;

    for (let index = 0; index < 4; index += 1) {
      addBlock(plane, stride, baseX + (index & 1) * 4, baseY + (index >> 1) * 4, blocks[index]);
    }
  }

  function addBlock(plane, stride, x, y, residual) {
    for (let row = 0; row < 4; row += 1) {
      const offset = (y + row) * stride + x;

      for (let column = 0; column < 4; column += 1) {
        plane[offset + column] = clampByte(plane[offset + column] + residual[row * 4 + column]);
      }
    }
  }

  function convertYuvToRgba(decoded) {
    const output = new Uint8ClampedArray(decoded.width * decoded.height * 4);
    const uvWidth = Math.ceil(decoded.width / 2);
    const uvHeight = Math.ceil(decoded.height / 2);
    let out = 0;

    for (let y = 0; y < decoded.height; y += 1) {
      const yOffset = y * decoded.yStride;

      for (let x = 0; x < decoded.width; x += 1) {
        const yy = decoded.y[yOffset + x];
        const u = sampleChroma(decoded.u, decoded.uvStride, uvWidth, uvHeight, x, y) - 128;
        const v = sampleChroma(decoded.v, decoded.uvStride, uvWidth, uvHeight, x, y) - 128;

        output[out++] = clampByte(1.164383 * (yy - 16) + 1.596027 * v);
        output[out++] = clampByte(1.164383 * (yy - 16) - 0.391762 * u - 0.812968 * v);
        output[out++] = clampByte(1.164383 * (yy - 16) + 2.017232 * u);
        output[out++] = 255;
      }
    }

    return output;
  }

  function sampleChroma(plane, stride, width, height, x, y) {
    const fx = x / 2 - 0.25;
    const fy = y / 2 - 0.25;
    const x0 = clampInt(Math.floor(fx), 0, width - 1);
    const y0 = clampInt(Math.floor(fy), 0, height - 1);
    const x1 = clampInt(x0 + 1, 0, width - 1);
    const y1 = clampInt(y0 + 1, 0, height - 1);
    const tx = clampNumber(fx - x0, 0, 1);
    const ty = clampNumber(fy - y0, 0, 1);
    const a = plane[y0 * stride + x0];
    const b = plane[y0 * stride + x1];
    const c = plane[y1 * stride + x0];
    const d = plane[y1 * stride + x1];

    return a * (1 - tx) * (1 - ty)
      + b * tx * (1 - ty)
      + c * (1 - tx) * ty
      + d * tx * ty;
  }

  function createEmptyMacroblock() {
    return {
      y: Array.from({ length: 16 }, () => new Int16Array(16)),
      u: Array.from({ length: 4 }, () => new Int16Array(16)),
      v: Array.from({ length: 4 }, () => new Int16Array(16)),
    };
  }

  function clearMacroblockContexts(mbX, leftY, leftU, leftV, aboveY, aboveU, aboveV) {
    leftY.fill(0);
    leftU.fill(0);
    leftV.fill(0);
    aboveY.fill(0, mbX * 4, mbX * 4 + 4);
    aboveU.fill(0, mbX * 2, mbX * 2 + 2);
    aboveV.fill(0, mbX * 2, mbX * 2 + 2);
  }

  function updateBModeContexts(mbX, bModes, aboveBModes, leftBModes) {
    for (let index = 0; index < 4; index += 1) {
      aboveBModes[mbX * 4 + index] = bModes[12 + index];
      leftBModes[index] = bModes[index * 4 + 3];
    }
  }

  function createFilterParam(baseLevel, modeIndex, filter) {
    let level = baseLevel;

    if (filter.useLfDelta) {
      level += filter.refLfDelta[0];

      if (modeIndex !== 0) {
        level += filter.modeLfDelta[0];
      }
    }

    if (level <= 0) {
      return { level: 0, ilevel: 0, hlevel: 0, inner: modeIndex !== 0 };
    }

    level = Math.min(level, 63);

    let innerLevel = level;

    if (filter.sharpness > 0) {
      innerLevel >>= filter.sharpness > 4 ? 2 : 1;
      innerLevel = Math.min(innerLevel, 9 - filter.sharpness);
    }

    innerLevel = Math.max(innerLevel, 1);

    return {
      level: 2 * level + innerLevel,
      ilevel: innerLevel,
      hlevel: level < 15 ? 0 : level < 40 ? 1 : 2,
      inner: modeIndex !== 0,
    };
  }

  function applySimpleLoopFilter(y, stride, yIndex, mbX, mbY, filter) {
    const level = filter.level;

    if (mbX > 0) {
      filter2(y, level + 4, yIndex, stride, 1, 16);
    }

    if (filter.inner) {
      filter2(y, level, yIndex + 4, stride, 1, 16);
      filter2(y, level, yIndex + 8, stride, 1, 16);
      filter2(y, level, yIndex + 12, stride, 1, 16);
    }

    if (mbY > 0) {
      filter2(y, level + 4, yIndex, 1, stride, 16);
    }

    if (filter.inner) {
      filter2(y, level, yIndex + stride * 4, 1, stride, 16);
      filter2(y, level, yIndex + stride * 8, 1, stride, 16);
      filter2(y, level, yIndex + stride * 12, 1, stride, 16);
    }
  }

  function applyNormalLoopFilter(y, u, v, yStride, uvStride, yIndex, cIndex, mbX, mbY, filter) {
    const level = filter.level;
    const innerLevel = filter.ilevel;
    const highEdgeVarianceLevel = filter.hlevel;

    if (mbX > 0) {
      filter246(y, 16, level + 4, innerLevel, highEdgeVarianceLevel, yIndex, yStride, 1, false);
      filter246(u, 8, level + 4, innerLevel, highEdgeVarianceLevel, cIndex, uvStride, 1, false);
      filter246(v, 8, level + 4, innerLevel, highEdgeVarianceLevel, cIndex, uvStride, 1, false);
    }

    if (filter.inner) {
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + 4, yStride, 1, true);
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + 8, yStride, 1, true);
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + 12, yStride, 1, true);
      filter246(u, 8, level, innerLevel, highEdgeVarianceLevel, cIndex + 4, uvStride, 1, true);
      filter246(v, 8, level, innerLevel, highEdgeVarianceLevel, cIndex + 4, uvStride, 1, true);
    }

    if (mbY > 0) {
      filter246(y, 16, level + 4, innerLevel, highEdgeVarianceLevel, yIndex, 1, yStride, false);
      filter246(u, 8, level + 4, innerLevel, highEdgeVarianceLevel, cIndex, 1, uvStride, false);
      filter246(v, 8, level + 4, innerLevel, highEdgeVarianceLevel, cIndex, 1, uvStride, false);
    }

    if (filter.inner) {
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + yStride * 4, 1, yStride, true);
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + yStride * 8, 1, yStride, true);
      filter246(y, 16, level, innerLevel, highEdgeVarianceLevel, yIndex + yStride * 12, 1, yStride, true);
      filter246(u, 8, level, innerLevel, highEdgeVarianceLevel, cIndex + uvStride * 4, 1, uvStride, true);
      filter246(v, 8, level, innerLevel, highEdgeVarianceLevel, cIndex + uvStride * 4, 1, uvStride, true);
    }
  }

  function filter2(pixels, level, index, iStep, jStep, count) {
    for (let n = 0; n < count; n += 1, index += iStep) {
      const p1 = pixels[index - 2 * jStep];
      const p0 = pixels[index - jStep];
      const q0 = pixels[index];
      const q1 = pixels[index + jStep];

      if (Math.abs(p0 - q0) * 2 + (Math.abs(p1 - q1) >> 1) > level) {
        continue;
      }

      const a = 3 * (q0 - p0) + clamp127(p1 - q1);
      const a1 = clamp15((a + 4) >> 3);
      const a2 = clamp15((a + 3) >> 3);
      pixels[index - jStep] = clamp255(p0 + a2);
      pixels[index] = clamp255(q0 - a1);
    }
  }

  function filter246(pixels, count, level, innerLevel, highEdgeVarianceLevel, index, iStep, jStep, fourNotSix) {
    for (let n = 0; n < count; n += 1, index += iStep) {
      const p3 = pixels[index - 4 * jStep];
      const p2 = pixels[index - 3 * jStep];
      const p1 = pixels[index - 2 * jStep];
      const p0 = pixels[index - jStep];
      const q0 = pixels[index];
      const q1 = pixels[index + jStep];
      const q2 = pixels[index + 2 * jStep];
      const q3 = pixels[index + 3 * jStep];

      if (Math.abs(p0 - q0) * 2 + (Math.abs(p1 - q1) >> 1) > level) {
        continue;
      }

      if (
        Math.abs(p3 - p2) > innerLevel ||
        Math.abs(p2 - p1) > innerLevel ||
        Math.abs(p1 - p0) > innerLevel ||
        Math.abs(q1 - q0) > innerLevel ||
        Math.abs(q2 - q1) > innerLevel ||
        Math.abs(q3 - q2) > innerLevel
      ) {
        continue;
      }

      if (Math.abs(p1 - p0) > highEdgeVarianceLevel || Math.abs(q1 - q0) > highEdgeVarianceLevel) {
        const a = 3 * (q0 - p0) + clamp127(p1 - q1);
        const a1 = clamp15((a + 4) >> 3);
        const a2 = clamp15((a + 3) >> 3);
        pixels[index - jStep] = clamp255(p0 + a2);
        pixels[index] = clamp255(q0 - a1);
      } else if (fourNotSix) {
        const a = 3 * (q0 - p0);
        const a1 = clamp15((a + 4) >> 3);
        const a2 = clamp15((a + 3) >> 3);
        const a3 = (a1 + 1) >> 1;
        pixels[index - 2 * jStep] = clamp255(p1 + a3);
        pixels[index - jStep] = clamp255(p0 + a2);
        pixels[index] = clamp255(q0 - a1);
        pixels[index + jStep] = clamp255(q1 - a3);
      } else {
        const a = clamp127(3 * (q0 - p0) + clamp127(p1 - q1));
        const a1 = (27 * a + 63) >> 7;
        const a2 = (18 * a + 63) >> 7;
        const a3 = (9 * a + 63) >> 7;
        pixels[index - 3 * jStep] = clamp255(p2 + a3);
        pixels[index - 2 * jStep] = clamp255(p1 + a2);
        pixels[index - jStep] = clamp255(p0 + a1);
        pixels[index] = clamp255(q0 - a1);
        pixels[index + jStep] = clamp255(q1 - a2);
        pixels[index + 2 * jStep] = clamp255(q2 - a3);
      }
    }
  }

  function tokenToAbsValue(reader, token) {
    if (token >= 2 && token <= 5) {
      return token - 1;
    }

    const category = token - 6;
    let extra = 0;

    for (const probability of EXTRA_PROBS[category]) {
      extra = (extra << 1) | reader.readBool(probability);
    }

    return EXTRA_BASE[category] + extra;
  }

  function readTree(reader, tree, probs) {
    let index = 0;

    while (true) {
      const next = tree[index + reader.readBool(probs[index >> 1])];

      if (next <= 0) {
        return -next;
      }

      index = next;
    }
  }

  function readTreeAt(reader, tree, probs, probOffset, startIndex) {
    let index = startIndex;

    while (true) {
      const next = tree[index + reader.readBool(probs[probOffset + (index >> 1)])];

      if (next <= 0) {
        return -next;
      }

      index = next;
    }
  }

  function coeffProbOffset(blockType, band, context) {
    return (((blockType * 8 + band) * 3 + context) * 11);
  }

  function readDelta(reader) {
    return reader.readBool(128) ? readSignedMagnitude(reader, 4) : 0;
  }

  function readSignedMagnitude(reader, bits) {
    const magnitude = reader.readLiteral(bits);

    return reader.readBool(128) ? -magnitude : magnitude;
  }

  function yModeToBMode(mode) {
    if (mode === V_PRED) {
      return B_VE_PRED;
    }

    if (mode === H_PRED) {
      return B_HE_PRED;
    }

    if (mode === TM_PRED) {
      return B_TM_PRED;
    }

    return B_DC_PRED;
  }

  function getBModeProbs(aboveMode, leftMode) {
    return KfBmodeProbs.subarray((aboveMode * 10 + leftMode) * 9, (aboveMode * 10 + leftMode + 1) * 9);
  }

  function dcQ(q) {
    return DC_Q[clampQ(q)];
  }

  function acQ(q) {
    return AC_Q[clampQ(q)];
  }

  function clampQ(value) {
    return value < 0 ? 0 : value > 127 ? 127 : value;
  }

  function clampInt(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function clampNumber(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function avg2(a, b) {
    return (a + b + 1) >> 1;
  }

  function avg3(a, b, c) {
    return (a + b + b + c + 2) >> 2;
  }

  function sumArray(values) {
    let sum = 0;

    for (const value of values) {
      sum += value;
    }

    return sum;
  }

  function clampByte(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value + 0.5 | 0;
  }

  function clamp15(value) {
    return value < -16 ? -16 : value > 15 ? 15 : value;
  }

  function clamp127(value) {
    return value < -128 ? -128 : value > 127 ? 127 : value;
  }

  function clamp255(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }

  function readFourCc(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  function readUint16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readUint32LE(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function decodeBase64Bytes(value) {
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      return bytes;
    }

    return new Uint8Array(Buffer.from(value, "base64"));
  }

  function decodeBase64Uint16(value) {
    const bytes = decodeBase64Bytes(value);
    const output = new Uint16Array(bytes.length / 2);

    for (let index = 0; index < output.length; index += 1) {
      output[index] = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    }

    return output;
  }

  function now() {
    return global.performance && typeof global.performance.now === "function"
      ? global.performance.now()
      : Date.now();
  }

  global.PureJsWebpDecoder = PureJsWebpDecoder;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PureJsWebpDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
