# WebGL Image Decode Demo

**[Open the live demo on GitHub Pages](https://witali.github.io/webgl-example/)**

A WebGL image decoding demo that renders a textured rotating cube and
experiments with custom JPEG/WebP decoding paths. It includes GPU-assisted JPEG
decoding, WASM JPEG/WebP decoders, visual comparison against the browser
decoder, upload support, diff contrast controls, and benchmark pages with
readable timing tables.

This project renders a textured rotating cube and includes a small standalone
GPU-assisted JPEG decoder in `src/decoders/gpu-jpeg.js`, a pure JavaScript JPEG
decoder in `src/decoders/jpeg-js-decoder.js`, a WebGPU/WGSL JPEG reconstruction
variant in `src/decoders/webgpu-wgsl-jpeg.js`, a pure JavaScript lossy WebP/VP8
decoder in `src/decoders/WebP-dec.js`, and a WASM/libwebp WebP decoder wrapper
in `src/decoders/webp-decoder.js`.

Open `index.html` through a local server to choose between:

- `cube.html` for the textured rotating cube, including local BPAL texture
  upload and decoding into a regular WebGL RGBA texture
- `image-decoding.html` for browser-vs-library JPEG comparison with URL and
  local file upload inputs
- `palette.html` for weighted OKLab or RGB k-means palette reduction with a
  selectable color count, optional Bayer or Floyd-Steinberg dithering, local
  image uploads, and PNG export
- `block-palette.html` for block-based indexed color compression with one
  shared RGB565 or RGB888 image palette, selectable block sizes, and per-block
  local palettes; the implementation and BPAL workflow are documented in
  [`BLOCK_PALETTE_README.md`](./BLOCK_PALETTE_README.md)
- `retro.html` for ZX Spectrum 256x192 `.scr` export and PC VGA Mode X
  320x240 four-plane image data with a separate 6-bit DAC palette; source
  images can be rotated by 90, 180, or 270 degrees before fitting
- `benchmarks.html` for native browser, JS-only, WASM, WASM+GPU, GPU, WebGPU
  WGSL, optional WebGPU resident, and WebP decode timings
- `browser-specs.html` for WebGPU, WebGL, and WebAssembly capability checks

Browser runtime sources are organized under `src/`:

- `src/core/` for shared rendering code
- `src/decoders/` for JPEG, WebP, WASM, WebGL, and WebGPU decoders
- `src/pages/` for page entry points
- `src/palette/` for palette quantization and its worker
- `src/retro/` for retro-format conversion and its worker
- `src/shaders/` for GLSL and WGSL shader sources

Node utilities, browser harnesses, and automated checks remain in `tools/` and
`tests/`; vendored third-party runtime files remain in `assets/vendor/`.

## Optimized ZX Spectrum export

The CLI optimizer converts any FFmpeg-readable image to a hardware-sized
ZX Spectrum `.scr`. It maps the source directly to the 15 unique colors of the
fixed hardware palette and tests RGB and OKLab matching with no dithering,
Bayer 2x2, Bayer 4x4, and Floyd-Steinberg output. Attribute pairs are selected
by the color produced after spatially averaging their dithered mixture, rather
than by the nearest endpoint alone. The winner balances multi-scale OKLab error
with RGB RMSE averaged over 8x8 blocks.

The ZX Spectrum mode on `retro.html` exposes the same algorithm through the
enabled-by-default **Auto optimize ZX** control. Manual color-space and
dithering controls become available when auto optimization is switched off.

FFmpeg must be available on `PATH`:

```powershell
npm run optimize:zx -- input.png --output zx-output --name landscape --fit cover
```

`--fit` accepts `cover` (the default), `contain`, or `stretch`. The command
writes the recommended `.scr`, its decoded PNG preview, the prepared source
PNG, a JSON report for all eight candidates, and the lowest-perceptual-error
alternative when it differs from the recommendation.

## `GpuJpegDecoder`

The decoder supports 8-bit sequential baseline and progressive JPEG images with
one grayscale component or three YCbCr components. It performs JPEG marker
parsing and Huffman entropy decoding on the CPU, then uses WebGL to run
dequantized DCT blocks through IDCT and YCbCr-to-RGB conversion into a WebGL
texture.

```js
const decoder = await GpuJpegDecoder.create(gl);
const result = await decoder.decodeUrl("assets/stone-texture-wic.jpg");

gl.bindTexture(gl.TEXTURE_2D, result.texture);
```

The WebGL shader sources are loaded from `src/shaders/jpeg-idct.vert.glsl` and
`src/shaders/jpeg-idct.frag.glsl`, so run the demo through a local server instead
of opening the HTML files directly from disk.

The returned object has:

- `width`
- `height`
- `texture`
- `dispose()`

## `JsJpegDecoder`

`src/decoders/jpeg-js-decoder.js` is the CPU-only JPEG reconstruction path. It reuses the
existing JavaScript JPEG marker and Huffman parser from `GpuJpegDecoder.parse()`,
then performs IDCT, chroma upsampling, grayscale or YCbCr-to-RGBA conversion,
and byte output entirely in JavaScript.

```js
const decoder = await JsJpegDecoder.create();
const result = await decoder.decodeUrl("assets/stone-texture-small.jpg");
console.log(result.pixels); // Uint8ClampedArray RGBA pixels
```

## `WasmWebpDecoder`

`src/decoders/webp-decoder.js` wraps `@jsquash/webp`, which is a libwebp WebAssembly decoder.
It returns RGBA pixels so the visual comparison page can compare browser WebP
decode against an independent WASM decode path.
The browser runtime files needed by this decoder are checked in under
`assets/vendor/jsquash-webp`, so the demo does not need to serve files directly
from `node_modules`.

```js
const decoder = await WasmWebpDecoder.create();
const result = await decoder.decodeUrl("assets/benchmark-webps/bench-000.webp");
```

## `PureJsWebpDecoder`

`src/decoders/WebP-dec.js` is a standalone JavaScript WebP decoder path used by
`src/decoders/webp-js-decoder.js`. It parses RIFF/WebP containers and decodes lossy `VP8 `
key frames directly in JavaScript without `Image`, `createImageBitmap`,
`ImageDecoder`, canvas image draw/readback, WASM, or third-party libraries.

The current implementation covers the still-image lossy VP8 subset used by the
checked-in WebP fixtures, including segmentation, token probability updates,
intra prediction, coefficient decoding, inverse WHT/IDCT, and YUV-to-RGBA
conversion. It does not yet implement VP8L lossless WebP, alpha, animation, or
the VP8 deblocking loop filter, so it is useful as a readable independent decode
path rather than a bit-exact replacement for libwebp.

## `WebGpuJpegDecoder`

`src/decoders/webgpu-jpeg.js` is an experimental GPU-resident baseline JPEG decoder. It
uploads the JPEG byte stream to a WebGPU storage buffer and runs Huffman entropy
decode, dequantization, IDCT, YCbCr upsampling, and RGBA output in GPU compute
passes. JavaScript still parses JPEG headers and tables so the browser can
allocate the required GPU buffers.

For timing, use `result.timings.gpuDecodeMs` or its alias
`result.timings.decodeMs`. That value starts after JPEG data and metadata have
already been prepared in GPU buffers and stops before any `readPixels()`
download. Upload/setup time is reported separately as `uploadMs`, and output
readback is accumulated separately as `readbackMs`.

```js
const prepared = decoder.prepare(arrayBuffer);
const result = await decoder.decodePrepared(prepared);
console.log(result.timings.gpuDecodeMs); // decode passes only
```

The first implementation supports one interleaved 8-bit SOF0 scan with one or
three components and no restart interval. Progressive JPEGs, restart markers,
CMYK/YCCK, arithmetic coding, and multi-scan baseline JPEGs are still handled by
the existing CPU/WASM/GPU-assisted paths instead.

## `WebGpuWgslJpegDecoder`

`src/decoders/webgpu-wgsl-jpeg.js` is a WebGPU compute-shader sibling of the WebGL
`GpuJpegDecoder` path. It reuses `GpuJpegDecoder.parse()` for JPEG markers,
Huffman entropy decoding, progressive scan handling, and dequantization, then
uploads component coefficient buffers to `src/shaders/jpeg-idct-compute.wgsl`.

The WGSL shader runs direct 8x8 IDCT, center-aligned chroma upsampling, grayscale
or YCbCr-to-RGBA conversion, and writes packed pixels to a storage buffer. This
keeps the compatibility profile close to the CPU-parsed WebGL path while moving
the reconstruction step from a WebGL fragment shader into a WebGPU compute pass.

## Limits

Baseline and progressive Huffman JPEGs are supported. Arithmetic-coded JPEG,
CMYK/YCCK JPEG, and 12-bit precision JPEG are not supported. WebP is supported
through libwebp WASM rather than the JPEG GPU pipeline. The WebGPU-resident
decoder proves that entropy and reconstruction can run from GPU buffers, but it
is still a narrower experimental baseline subset.

## IDCT Optimization Notes

The current shader still uses a direct 64-term IDCT sum for every output pixel.
That is intentionally simple, but it is not the algorithm used by production
JPEG decoders.

Good next optimizations:

- Done for the WASM decoder: use separable 2D IDCT, running an 8-point 1D IDCT
  over one axis into a 64-value temporary block, then over the other axis.
- Done for quality: use center-aligned bilinear chroma upsampling and round
  component samples after IDCT before final YCbCr-to-RGB conversion.
- Implement a Loeffler/Ligtenberg/Moschytz-style 1D IDCT. IJG/libjpeg's accurate
  integer IDCT is based on that family of algorithms.
- Consider an AAN-scaled IDCT path. Its scaling factors can be folded into
  dequantization, reducing the number of runtime multiplications.
- For WebAssembly, use fixed-point arithmetic and eventually WASM SIMD.
- For WebGL, avoid per-output-pixel recomputation of all 64 basis products.
  A two-pass block pipeline or pre-expanded intermediate texture should reduce
  fragment shader work.

References:

- Loeffler, Ligtenberg, Moschytz, "Practical fast 1-D DCT algorithms with 11 multiplications"
- IJG/libjpeg `jidctint.c`
- AAN-derived fixed-point IDCT papers
- libjpeg-turbo SIMD coverage notes

## Comparison Test

The bytewise comparison harness decodes a JPEG through `GpuJpegDecoder`, reads
the output texture with `readPixels()`, decodes the same file with the browser's
native JPEG decoder, and compares RGBA bytes.

```powershell
$env:EDGE_HEADLESS='0'
$env:EDGE_SWIFTSHADER='0'
node tools\run-jpeg-compare.js /assets/stone-texture-small.jpg
```

The current decoder is not bit-exact against the browser decoder, but the tuned
WASM and GPU paths are now very close. On the 64x64 fixture the visual compare
reports a maximum channel difference of 3 and mean byte difference near 0.034.
On the original progressive 1100x734 stone texture, GPU and WASM+GPU report a
maximum channel difference of 8 and mean byte difference near 0.028.
The WebGPU-resident baseline path currently reports a maximum channel difference
of 2 and mean byte difference near 0.030 on `bench-000.jpg`.

## Visual Compare

Run a local server and open the visual comparison page:

```powershell
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/tests/visual-jpeg-compare.html
```

The page shows the browser-decoded image, the library-decoded image, and an
amplified diff map. Use the decoder selector to switch between `JS-only`, `GPU`,
`WebGPU WGSL`, `WebGPU resident`, `WASM`, `WASM+GPU`, and WebP paths. The upload
input accepts JPEG and WebP files. The built-in image list includes a WebP copy
of the first stone texture plus WebP copies of the public-domain landscape
fixtures; choosing a WebP asset automatically switches the decoder to a WebP
path.

Latest visual comparison results:

- 64x64 fixture, GPU/WASM+GPU: 313 mismatched pixels out of 4096, max diff 3,
  mean byte diff 0.034
- 64x64 fixture, WASM: 325 mismatched pixels out of 4096, max diff 3, mean byte
  diff 0.035
- 1100x734 texture, WASM: 54,632 mismatched pixels out of 807,400, max diff 3,
  mean byte diff 0.028
- 64x64 fixture `bench-000.jpg`, WebGPU resident: 317 mismatched pixels out of
  4096, max diff 2, mean byte diff 0.030
- 32x32 WebP fixture, WASM WebP: 0 mismatched pixels out of 1024, max diff 0,
  mean byte diff 0.000

## Decode Benchmark

Generate 100 local baseline JPEG fixtures:

```powershell
.\tools\generate-benchmark-fixtures.ps1 -Count 100 -Size 64
```

Build the WASM IDCT module from WAT:

```powershell
npm run build:wasm
```

Regenerate the checked-in WebP texture and landscape assets:

```powershell
npm run encode:webp-assets
```

Regenerate the checked-in height and specular maps for the cube texture:

```powershell
$env:BROWSER='chrome'
npm run generate:material-maps
```

The JPEG manifest also includes five public-domain clipart JPEG fixtures and
five public-domain landscape JPEG fixtures. Their source pages are listed in
`assets/benchmark-jpegs/clipart-sources.json` and
`assets/benchmark-jpegs/landscape-sources.json`.

Run the JPEG benchmark with native browser, WASM, WASM+GPU, and GPU decoders:

```powershell
$env:BROWSER='edge'
$env:EDGE_HEADLESS='0'
$env:EDGE_SWIFTSHADER='0'
$env:BROWSER_TIMEOUT_MS='600000'
node tools\run-jpeg-benchmark.js /assets/benchmark-jpegs/manifest.json 110 3 /wasm/jpeg-idct.wasm
```

The browser runner does not pass `--disable-gpu-sandbox` by default. If a
specific machine needs that workaround, opt in explicitly:

```powershell
$env:BROWSER_DISABLE_GPU_SANDBOX='1'
```

To try the Windows default browser instead of the explicit Edge path:

```powershell
$env:BROWSER='default'
```

The harness resolves the default HTTP browser from the Windows registry and
launches it with the same DevTools arguments. This requires a Chromium-compatible
default browser with remote debugging allowed. In the current environment the
default browser resolves to Edge, but that launch mode is blocked by policy with
`DevTools remote debugging is disallowed by the system admin`; explicit
`BROWSER='edge'` still works.

The benchmark fetches all image files before timing and reports clean work time
as the main `Work total` metric. Setup/upload and readback are shown separately
and are not included in the reference speedups. The native path measures only the
`createImageBitmap()` decode API around a prebuilt `Blob`. The JS-only JPEG path
uses JPEG entropy parse plus JavaScript IDCT/color conversion as clean work. The
WASM JPEG path uses JPEG entropy parse plus WASM IDCT/color conversion as clean
work and reports copying coefficient blocks into WASM memory as setup. The
WASM+GPU, GPU, and WebGPU WGSL paths use JPEG entropy parse plus GPU
reconstruction as clean work; texture or storage-buffer setup, upload, and
readback stay in separate columns. The result page uses both native browser
decode and WASM decode as reference columns in the speedup table. The JPEG
benchmark also tries the experimental WebGPU-resident decoder by default. If
WebGPU is unavailable, or if a JPEG falls outside that decoder's current SOF0
baseline subset, the row stays visible and reports skipped images instead of
failing the whole run.

To force-enable WebGPU in the browser runner, set the browser feature flag:

```powershell
$env:BROWSER_ENABLE_WEBGPU='1'
node tools\run-jpeg-benchmark.js /assets/benchmark-jpegs/manifest.json 1 1 /wasm/jpeg-idct.wasm
```

To disable the WebGPU rows, set `$env:WEBGPU_JPEG='0'`.

The benchmark page runs a small visible WebGL cube before timed decoder work to
raise GPU clocks. The default is `3000` ms with `256` draw passes per frame.
Tune or disable it from the CLI with:

```powershell
$env:GPU_WARMUP_MS='0'
$env:GPU_WARMUP_PASSES='128'
```

For these decoders, benchmark timings use `gpuDecodeMs`, so upload/setup and
`readPixels()` readback are reported separately and do not count as clean work
time.

Latest 100-image 64x64 run after the quality-focused upsampling update:

- Native total: 306.2 ms, median: 1.3 ms, trimmed avg: 1.62 ms
- WASM total: 241.9 ms, median: 2.0 ms, trimmed avg: 2.14 ms
- Speedup values below 1 mean the tested path is slower than the reference.
  The native browser decoder remained fastest by trimmed average in this run.

Run a WebP benchmark through the browser page:

```text
http://127.0.0.1:8000/benchmarks.html?format=webp&manifest=/assets/benchmark-webps/manifest.json&limit=12&warmup=1
```

Or through the browser runner:

```powershell
$env:BENCHMARK_FORMAT='webp'
node tools\run-jpeg-benchmark.js /assets/benchmark-webps/manifest.json 12 1 /wasm/jpeg-idct.wasm
```

The WebP benchmark compares native browser decode against `WasmWebpDecoder`.

Run the demo through a local server so `fetch()` can read image and WASM files:

```powershell
python -m http.server 8000
```
