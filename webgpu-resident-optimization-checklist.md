# WebGPU Resident JPEG Optimization Checklist

Date: 2026-05-25

Scope: `GPU-Huff+GPU-IDCT resident` in `webgpu-jpeg.js`.

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

- [ ] Pack JPEG bytes into `u32` words instead of expanding one byte per `u32`.
  - Idea: replace `expandBytesToUint32()` with packed storage and add a WGSL byte loader.
  - Expected benefit: reduces upload size and storage-buffer bandwidth for entropy reads.
  - Result: not tested yet.

- [ ] Add a fast Huffman prefix table in WGSL.
  - Idea: build `fastLength` and `fastSymbol` tables, then use `peekBits`/`skipBits` before falling back to canonical length search.
  - Expected benefit: fewer bit-by-bit loops and fewer `huffMin`/`huffMax` storage reads in serial entropy decode.
  - Result: not tested yet.

- [ ] Explore GPU-resident prescan.
  - Idea: build block tasks on GPU, then reuse the parallel per-block decode shape from the prescan shader.
  - Expected benefit: attacks the main serial bottleneck when JPEG files have no restart markers.
  - Result: not tested yet.

- [ ] Rewrite IDCT as one workgroup per 8x8 block.
  - Idea: load block coefficients into workgroup memory, run separable IDCT, and write 64 component samples.
  - Expected benefit: less repeated global memory traffic than one invocation per output sample.
  - Result: not tested yet.

- [ ] Specialize the render shader for common 4:2:0 images.
  - Idea: directly sample Y when it matches output resolution and keep bilinear sampling only for Cb/Cr.
  - Expected benefit: removes unnecessary bilinear work from the luma path in benchmark images.
  - Result: not tested yet.
