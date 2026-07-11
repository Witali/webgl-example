# ZX Spectrum conversion: volcano

Recommended output: `volcano-zx-spectrum.scr` (6912 bytes).

- Target: ZX Spectrum screen, 256x192, 6144 bitmap bytes + 768 attribute bytes.
- Resize: centered 4:3 cover crop with Lanczos filtering; no geometric distortion.
- Color matching: RGB.
- Dithering: ordered Bayer 4x4.
- Color selection: direct matching from the source to the fixed 15-color ZX Spectrum palette.
- Used hardware colors: 12 of the 15 native colors.
- Averaged 8x8 RGB RMSE: 14.05; full pixel RMSE: 95.83.
- SHA-256: `C8DFA859E06EAC620143CDF987FC998E34192BAC53C3DCFFF27D5FC40B27CF3A`.

`volcano-zx-spectrum-preview.png` is the decoded hardware preview of the recommended file.

When the lowest spatial OKLab-error result differs from the combined-score
winner, the CLI also writes a `-lowest-perceptual.scr` alternative with its PNG
preview.

`volcano-zx-spectrum-report.json` contains measurements for all eight tested
combinations.
