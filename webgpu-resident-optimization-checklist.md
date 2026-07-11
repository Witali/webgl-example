# WebGPU Resident JPEG Optimization Checklist

Date: 2026-05-25

Scope: `GPU-Huff+GPU-IDCT resident` in `src/decoders/webgpu-jpeg.js`.

Rule for keeping a feature: retain an experiment only when measured resident decode speed improves by more than `1.3x` against the current resident baseline.

Current measurement mode: installed Chrome with `BROWSER=chrome`, `EDGE_HEADLESS=0`, `EDGE_SWIFTSHADER=0`, `WEBGPU_JPEG=1`, and `BROWSER_ENABLE_WEBGPU=1`.

Baseline before this checklist:

- resident GPU decode: `146.90 ms` total across 20 benchmark JPEGs
- resident median: `7.80 ms`

## Checklist

- [x] Move coefficient zero-fill out of the entropy shader.
  - Idea: add `COPY_DST` to `coefficientBuffer`, call `encoder.clearBuffer(coefficientBuffer)` before the entropy pass, and remove per-block `clearBlock()`.
  - Expected benefit: removes 64 serial storage writes per block from the resident Huffman invocation.
  - Result: applied. Resident GPU decode improved from `146.90 ms` to `57.00 ms` across 20 JPEGs, about `2.58x`.

- [x] Pack JPEG bytes into `u32` words instead of expanding one byte per `u32`.
  - Idea: replace `expandBytesToUint32()` with packed storage and add a WGSL byte loader.
  - Expected benefit: reduces upload size and storage-buffer bandwidth for entropy reads.
  - Result: tried, not applied. Resident GPU decode changed from `57.00 ms` to `59.70 ms`, so it was slightly slower instead of `>1.3x` faster.
  - Second pass with GPU warmup: tried again on 2026-05-26, not applied. Output stayed correct, but resident total regressed to `247.90 ms` and median stayed at `5.90 ms`.

- [x] Add a fast Huffman prefix table in WGSL.
  - Idea: build `fastLength` and `fastSymbol` tables, then use `peekBits`/`skipBits` before falling back to canonical length search.
  - Expected benefit: fewer bit-by-bit loops and fewer `huffMin`/`huffMax` storage reads in serial entropy decode.
  - Result: tried twice, not applied. The second pass briefly looked promising (`81.80 ms`, median `3.90 ms`), but repeat runs regressed to `253.90 ms` and `134.40 ms` with median `12.40 ms` and `4.60 ms`; the gain was not stable enough to clear the `1.3x` threshold.

- [x] Explore GPU-resident prescan.
  - Idea: build block tasks on GPU, then reuse the parallel per-block decode shape from the prescan shader.
  - Expected benefit: attacks the main serial bottleneck when JPEG files have no restart markers.
  - Result: not applied. The existing CPU pre-scan plus parallel GPU block decode path was measured as a proxy and stayed slower than resident after coefficient clearing (`~67 ms` versus `57 ms`). A fully GPU-resident task-builder would add another serial entropy traversal before the parallel decode pass, so it is unlikely to clear the `>1.3x` threshold as a quick feature.
  - Second pass with GPU warmup: not applied. During the fast-Huffman attempt, the existing CPU pre-scan proxy measured `70.20 ms` versus resident `81.80 ms`, only about `1.16x`.

- [x] Rewrite IDCT as one workgroup per 8x8 block.
  - Idea: load block coefficients into workgroup memory, run separable IDCT, and write 64 component samples.
  - Expected benefit: less repeated global memory traffic than one invocation per output sample.
  - Result: tried, not applied. The output matched the smoke-test tolerance, but resident GPU decode regressed from `57.00 ms` to `182.90 ms`, so the extra workgroup synchronization and per-block dispatch shape were slower than the current per-sample shader.
  - Second pass with GPU warmup: tried again after fast Huffman, not applied. Output stayed correct, but resident total regressed to `231.70 ms` and median to `10.50 ms`.

- [x] Specialize the render shader for common 4:2:0 images.
  - Idea: directly sample Y when it matches output resolution and keep bilinear sampling only for Cb/Cr.
  - Expected benefit: removes unnecessary bilinear work from the luma path in benchmark images.
  - Result: tried, not applied. A direct luma path passed the visual smoke test, but resident GPU decode regressed from `57.00 ms` to `175.80 ms`, likely because the extra branch/function shape made the shader compile to a slower path than the uniform bilinear code.
  - Second pass with GPU warmup: tried again after fast Huffman, not applied. Output stayed correct, but resident total regressed to `255.30 ms` and median to `13.60 ms`.
