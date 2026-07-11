/*
 * Purpose: WebGPU compute shader that reconstructs JPEG pixels from
 * dequantized coefficient buffers.
 * Processing blocks:
 * - Evaluate the 8x8 inverse DCT for component samples.
 * - Upsample subsampled chroma components in component space.
 * - Convert grayscale or YCbCr samples into packed RGBA pixels.
 */
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

@group(0) @binding(0) var<storage, read> coeff0: array<f32>;
@group(0) @binding(1) var<storage, read> coeff1: array<f32>;
@group(0) @binding(2) var<storage, read> coeff2: array<f32>;
@group(0) @binding(3) var<storage, read> jpegMeta: array<u32>;
@group(0) @binding(4) var<storage, read_write> outputPixels: array<u32>;

fn imageWidth() -> u32 {
  return jpegMeta[0];
}

fn imageHeight() -> u32 {
  return jpegMeta[1];
}

fn componentCount() -> u32 {
  return jpegMeta[2];
}

fn coeffSizeX(component: u32) -> u32 {
  if (component == 0u) {
    return jpegMeta[3];
  }

  if (component == 1u) {
    return jpegMeta[5];
  }

  return jpegMeta[7];
}

fn coeffSizeY(component: u32) -> u32 {
  if (component == 0u) {
    return jpegMeta[4];
  }

  if (component == 1u) {
    return jpegMeta[6];
  }

  return jpegMeta[8];
}

fn maxHorizontalSampling() -> u32 {
  return jpegMeta[9];
}

fn maxVerticalSampling() -> u32 {
  return jpegMeta[10];
}

fn horizontalSampling(component: u32) -> u32 {
  if (component == 0u) {
    return jpegMeta[11];
  }

  if (component == 1u) {
    return jpegMeta[13];
  }

  return jpegMeta[15];
}

fn verticalSampling(component: u32) -> u32 {
  if (component == 0u) {
    return jpegMeta[12];
  }

  if (component == 1u) {
    return jpegMeta[14];
  }

  return jpegMeta[16];
}

fn blockCountX(component: u32) -> u32 {
  return coeffSizeX(component) / 8u;
}

fn readCoefficient(component: u32, index: u32) -> f32 {
  if (component == 0u) {
    return coeff0[index];
  }

  if (component == 1u) {
    return coeff1[index];
  }

  return coeff2[index];
}

fn decodeComponentPixel(component: u32, componentPixel: vec2<i32>) -> f32 {
  let maxPixel = vec2<i32>(
    i32(coeffSizeX(component)) - 1,
    i32(coeffSizeY(component)) - 1
  );
  let pixel = clamp(componentPixel, vec2<i32>(0, 0), maxPixel);
  let pixelX = u32(pixel.x);
  let pixelY = u32(pixel.y);
  let blockX = pixelX / 8u;
  let blockY = pixelY / 8u;
  let blockOffset = (blockY * blockCountX(component) + blockX) * 64u;
  var value = 0.0;

  for (var row = 0u; row < 8u; row += 1u) {
    let yBasis = IDCT_BASIS[(pixelY % 8u) * 8u + row];

    for (var column = 0u; column < 8u; column += 1u) {
      let xBasis = IDCT_BASIS[(pixelX % 8u) * 8u + column];
      let coefficient = readCoefficient(component, blockOffset + row * 8u + column);

      value += coefficient * xBasis * yBasis;
    }
  }

  return clamp(floor(0.25 * value + 128.0 + 0.5), 0.0, 255.0);
}

fn decodeComponent(component: u32, imagePixel: vec2<f32>) -> f32 {
  let sampleScale = vec2<f32>(
    f32(horizontalSampling(component)) / f32(maxHorizontalSampling()),
    f32(verticalSampling(component)) / f32(maxVerticalSampling())
  );
  let componentCoord = (floor(imagePixel) + vec2<f32>(0.5, 0.5)) * sampleScale
    - vec2<f32>(0.5, 0.5);
  let rawP0 = vec2<i32>(floor(componentCoord));
  let rawP1 = rawP0 + vec2<i32>(1, 1);
  let rawT = componentCoord - vec2<f32>(rawP0);
  let maxPixel = vec2<i32>(
    i32(coeffSizeX(component)) - 1,
    i32(coeffSizeY(component)) - 1
  );
  let p0 = clamp(rawP0, vec2<i32>(0, 0), maxPixel);
  let p1 = clamp(rawP1, vec2<i32>(0, 0), maxPixel);
  var tx = rawT.x;
  var ty = rawT.y;

  if (p0.x == p1.x) {
    tx = 0.0;
  }

  if (p0.y == p1.y) {
    ty = 0.0;
  }

  let v00 = decodeComponentPixel(component, p0);
  let v10 = decodeComponentPixel(component, vec2<i32>(p1.x, p0.y));
  let v01 = decodeComponentPixel(component, vec2<i32>(p0.x, p1.y));
  let v11 = decodeComponentPixel(component, p1);
  let top = mix(v00, v10, tx);
  let bottom = mix(v01, v11, tx);

  return mix(top, bottom, ty);
}

fn packChannel(value: f32) -> u32 {
  return u32(clamp(floor(value + 0.5), 0.0, 255.0));
}

fn packRgba(red: f32, green: f32, blue: f32) -> u32 {
  let r = packChannel(red);
  let g = packChannel(green);
  let b = packChannel(blue);

  return r | (g << 8u) | (b << 16u) | (255u << 24u);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= imageWidth() || id.y >= imageHeight()) {
    return;
  }

  let imagePixel = vec2<f32>(f32(id.x), f32(id.y));
  let y = decodeComponent(0u, imagePixel);
  let pixelIndex = id.y * imageWidth() + id.x;

  if (componentCount() == 1u) {
    outputPixels[pixelIndex] = packRgba(y, y, y);
    return;
  }

  let cb = decodeComponent(1u, imagePixel) - 128.0;
  let cr = decodeComponent(2u, imagePixel) - 128.0;
  let red = y + 1.402 * cr;
  let green = y - 0.344136286201022 * cb - 0.714136285714286 * cr;
  let blue = y + 1.772 * cb;

  outputPixels[pixelIndex] = packRgba(red, green, blue);
}
