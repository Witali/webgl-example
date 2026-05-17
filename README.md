# WebGL Image Decode Demo

This project renders a textured rotating cube and includes a small standalone
GPU-assisted JPEG decoder in `gpu-jpeg.js` plus a WASM/libwebp WebP decoder
wrapper in `webp-decoder.js`.

Open `index.html` through a local server to choose between:

- `cube.html` for the textured rotating cube
- `image-decoding.html` for browser-vs-library JPEG comparison with URL and
  local file upload inputs
- `benchmarks.html` for native browser, JPEG WASM/WASM+GPU/GPU, and WebP WASM
  decode timings

## `GpuJpegDecoder`

The decoder supports 8-bit sequential baseline and progressive JPEG images with
one grayscale component or three YCbCr components. It performs JPEG marker
parsing and Huffman entropy decoding on the CPU, then uses WebGL to run
dequantized DCT blocks through IDCT and YCbCr-to-RGB conversion into a WebGL
texture.

```js
const decoder = new GpuJpegDecoder(gl);
const result = await decoder.decodeUrl("assets/stone-texture-wic.jpg");

gl.bindTexture(gl.TEXTURE_2D, result.texture);
```

The returned object has:

- `width`
- `height`
- `texture`
- `dispose()`

## `WasmWebpDecoder`

`webp-decoder.js` wraps `@jsquash/webp`, which is a libwebp WebAssembly decoder.
It returns RGBA pixels so the visual comparison page can compare browser WebP
decode against an independent WASM decode path.

```js
const decoder = await WasmWebpDecoder.create();
const result = await decoder.decodeUrl("assets/benchmark-webps/bench-000.webp");
```

## Limits

Baseline and progressive Huffman JPEGs are supported. Arithmetic-coded JPEG,
CMYK/YCCK JPEG, and 12-bit precision JPEG are not supported. WebP is supported
through libwebp WASM rather than the JPEG GPU pipeline. WebGL fragment shaders
are a poor fit for variable-length entropy bitstreams, so the project keeps
those stages on CPU/WASM and offloads regular per-pixel reconstruction work
where practical.

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
amplified diff map. Use the decoder selector to switch between `GPU`, `WASM`,
`WASM+GPU`, and `WASM WebP`. The upload input accepts JPEG and WebP files.

Latest visual comparison results:

- 64x64 fixture, GPU/WASM+GPU: 313 mismatched pixels out of 4096, max diff 3,
  mean byte diff 0.034
- 64x64 fixture, WASM: 325 mismatched pixels out of 4096, max diff 3, mean byte
  diff 0.035
- 1100x734 texture, WASM: 54,632 mismatched pixels out of 807,400, max diff 3,
  mean byte diff 0.028
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

Run the native-browser-vs-WASM-vs-WASM+GPU-vs-GPU JPEG benchmark:

```powershell
$env:BROWSER='edge'
$env:EDGE_HEADLESS='0'
$env:EDGE_SWIFTSHADER='0'
$env:BROWSER_TIMEOUT_MS='600000'
node tools\run-jpeg-benchmark.js /assets/benchmark-jpegs/manifest.json 100 3 /wasm/jpeg-idct.wasm
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

The benchmark fetches all JPEG files before timing. The native path measures
`createImageBitmap()` decode time. The WASM path measures `WasmJpegDecoder.decode()`,
which includes shared JS JPEG parsing/Huffman decode plus WASM IDCT and YCbCr to
RGBA. The WASM+GPU path uses WASM to pack GPU coefficient atlases and WebGL for
IDCT/color conversion. The GPU path measures `GpuJpegDecoder.decode()` plus
`gl.finish()`, so it includes CPU JPEG parsing/Huffman decode and GPU IDCT.

Latest 100-image 64x64 run after the quality-focused upsampling update:

- Native total: 306.2 ms, median: 1.3 ms, trimmed avg: 1.62 ms
- WASM total: 241.9 ms, median: 2.0 ms, trimmed avg: 2.14 ms
- WASM+GPU total: 370.4 ms, median: 3.3 ms, trimmed avg: 3.41 ms
- GPU total: 518.0 ms, median: 3.9 ms, trimmed avg: 4.57 ms
- Speedup values below 1 mean the tested path is slower than the reference.
  WASM+GPU was 1.34x faster than the GPU path by trimmed average in this run,
  while the native browser decoder remained fastest by trimmed average.

Run a WebP benchmark through the browser page:

```text
http://127.0.0.1:8000/benchmarks.html?format=webp&manifest=/assets/benchmark-webps/manifest.json&limit=12&warmup=1
```

The WebP benchmark compares native browser decode against `WasmWebpDecoder`.

Run the demo through a local server so `fetch()` can read image and WASM files:

```powershell
python -m http.server 8000
```
