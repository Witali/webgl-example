# Pure JavaScript JPEG Decoder Optimization Notes

Date: 2026-05-25

Scope: `src/decoders/jpeg-js-decoder.js`, the CPU-only JPEG decoder path. The changes below do not use WebGL, WebGPU, WebAssembly, browser image decoding, or extra runtime libraries.

## Research Inputs

I used these JavaScript performance references as a guide:

- [MDN typed arrays](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Typed_arrays): prefer typed binary buffers for numeric image data instead of generic arrays.
- [V8 elements kinds](https://v8.dev/blog/elements-kinds): keep hot arrays predictable and avoid transitions between array element representations.
- [V8 hidden classes](https://v8.dev/docs/hidden-classes): keep repeatedly used objects structurally stable.
- [web.dev V8 performance tips](https://web.dev/articles/speed-v8): keep hot loops simple, avoid polymorphic shapes, and avoid needless allocation in tight paths.

## Applied Techniques

### 1. Separable IDCT

The largest win was replacing the previous direct 2D IDCT with two 1D passes:

- vertical pass over the 8 coefficient columns;
- horizontal pass over the 8 output rows.

This cuts the amount of repeated cosine work in the hot block reconstruction path and makes the loop structure more cache-friendly.

Relevant code:

- `runVerticalIdct`
- `runHorizontalIdct`

### 2. DC-only block fast path

Many JPEG blocks contain only the DC coefficient after dequantization. For those blocks the whole 8x8 output is a constant value, so the decoder skips the full IDCT and fills the block directly.

Relevant code:

- `isDcOnly`
- `fillDcBlock`

### 3. Reused typed arrays in the decode loop

The decode loop now reuses a single temporary `Float64Array(64)` buffer for IDCT work instead of allocating new temporary arrays per block. Pixel planes stay in typed arrays as well:

- component planes: `Uint8Array`
- final RGBA output: `Uint8ClampedArray`
- temporary IDCT buffer: `Float64Array`

This reduces garbage collection pressure and keeps numeric storage predictable.

### 4. Precomputed component sampling maps

The color composition step previously had to do coordinate scaling, flooring, and clamping while writing every output pixel. The optimized path builds per-axis sampling maps once per component:

- `xMap`
- `yMap`
- direct sampling flags when the component already matches the output size

The per-pixel loop can then use typed-array lookups instead of recalculating the same coordinate mapping repeatedly.

Relevant code:

- `createAxisSampleMap`
- `createComponentSampler`

### 5. Split hot paths

The compositor now separates common cases instead of routing every pixel through one generic path:

- grayscale output;
- RGB/YCbCr output;
- direct component access;
- mapped component access.

This keeps the innermost loops simpler and avoids per-pixel branching where the image layout is already known.

Relevant code:

- `composeGrayscalePixels`
- `composeColorPixels`

### 6. Stable sampler object shape

Component sampler objects are created with the same fields in the same order. This follows the V8 hidden-class guidance and helps the engine optimize repeated property reads in the pixel composition path.

### 7. Less work inside pixel loops

The optimized code moves work out of the innermost loops where practical:

- no repeated `Math.floor` for sampling;
- less per-pixel clamping;
- no per-pixel helper callbacks;
- no `.map()` allocation for component decode results.

## Benchmark

Benchmark command:

```powershell
$env:WEBGPU_JPEG='0'; node tools\run-jpeg-benchmark.js /assets/benchmark-jpegs/manifest.json 20 1 /wasm/jpeg-idct.wasm
```

The `WEBGPU_JPEG=0` environment variable forces the benchmark to measure the pure JavaScript decoder path.

| Metric | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Total benchmark time | 51.10 ms | 18.70 ms | 2.73x |
| JS decoder core time | 40.50 ms | 10.30 ms | 3.93x |
| Average per image | 2.55 ms | 0.935 ms | 2.73x |
| Median per image | 2.40 ms | 0.80 ms | 3.00x |

Visual smoke check:

```powershell
node tools\run-visual-compare-smoke.js /assets/stone-texture-small.jpg jpeg-js
```

Result after optimization:

- size: `64 x 64`
- mismatched pixels: `318 / 4096 (7.76%)`
- max channel diff: `3`
- mean channel diff: `0.034`

The optimization improved speed without introducing a large visual regression on the smoke image.

## Remaining Ideas Checklist

Follow-up baseline after committing the first optimization:

- total benchmark time: `20.80 ms`
- JS decoder core time: `12.30 ms`
- success threshold for a new idea: more than `1.5x` speedup, roughly `13.87 ms` total or better

- [x] Fixed-point integer IDCT instead of floating-point IDCT.
  Tried an integer-scaled separable IDCT table with the same two-pass structure. Visual output remained close, but performance got worse: `29.40 ms` total and `17.50 ms` core. Not applied.

- [x] More specialized sampling paths for common JPEG chroma modes like 4:2:0 and 4:4:4.
  The benchmark set is entirely 4:2:0 (`Y 2x2`, `Cb/Cr 1x1`), so I tried a dedicated 4:2:0 color composition path. It was slower in practice: `29.40 ms` total and `17.10 ms` core. Not applied.

- [x] Reduce Huffman decode overhead with tighter bit-buffer handling.
  Tried canonical Huffman tables, a fast prefix lookup, and wider `readBits()` buffering. The best observed pure JS total was `16.40 ms`, about `1.27x` faster than the follow-up baseline, below the `1.5x` threshold. The parse portion alone improved, but not enough to justify changing the shared parser. Not applied.

- [x] Move decode work into a Web Worker to keep the UI responsive.
  Evaluated as a responsiveness improvement rather than a raw decoder speed improvement. It would add message passing and buffer transfer overhead, so it does not satisfy the `>1.5x` decode-speed criterion for the pure JS decoder. Not applied.

- [x] Use WebAssembly SIMD for another decoder variant, while keeping the current pure JS path as the no-dependency baseline.
  Evaluated as out of scope for the pure JavaScript decoder because it creates or changes a WASM runtime path. The repository already has a scalar WASM JPEG path; a SIMD variant may be useful separately, but it would not be a pure JS decoder optimization. Not applied.
