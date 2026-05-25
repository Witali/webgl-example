precision highp float;

const float PI = 3.141592653589793;

uniform vec2 uImageSize;
uniform int uComponentCount;

uniform sampler2D uCoeff0;
uniform sampler2D uCoeff1;
uniform sampler2D uCoeff2;

uniform vec2 uCoeffSize0;
uniform vec2 uCoeffSize1;
uniform vec2 uCoeffSize2;

uniform vec2 uSampleScale0;
uniform vec2 uSampleScale1;
uniform vec2 uSampleScale2;

float basis(float local, float frequency) {
  return cos(((2.0 * local + 1.0) * frequency * PI) / 16.0);
}

float coefficient(
  sampler2D coeffTexture,
  vec2 coeffSize,
  vec2 block,
  float u,
  float v
) {
  vec2 texel = block * 8.0 + vec2(u, v);
  return texture2D(coeffTexture, (texel + 0.5) / coeffSize).r;
}

float decodeComponentPixel(
  sampler2D coeffTexture,
  vec2 coeffSize,
  vec2 componentPixel
) {
  componentPixel = clamp(componentPixel, vec2(0.0), coeffSize - vec2(1.0));

  vec2 block = floor(componentPixel / 8.0);
  vec2 local = mod(componentPixel, 8.0);
  float value = 0.0;

  for (int row = 0; row < 8; row++) {
    for (int column = 0; column < 8; column++) {
      float u = float(column);
      float v = float(row);
      float scaleU = column == 0 ? 0.70710678118 : 1.0;
      float scaleV = row == 0 ? 0.70710678118 : 1.0;
      float dct = coefficient(coeffTexture, coeffSize, block, u, v);

      value += scaleU * scaleV * dct * basis(local.x, u) * basis(local.y, v);
    }
  }

  return 0.25 * value + 128.0;
}

float decodeRoundedComponentPixel(
  sampler2D coeffTexture,
  vec2 coeffSize,
  vec2 componentPixel
) {
  return clamp(floor(decodeComponentPixel(coeffTexture, coeffSize, componentPixel) + 0.5), 0.0, 255.0);
}

float decodeComponent(
  sampler2D coeffTexture,
  vec2 coeffSize,
  vec2 sampleScale,
  vec2 imagePixel
) {
  vec2 sourcePixel = floor(imagePixel);
  vec2 componentCoord = (sourcePixel + vec2(0.5)) * sampleScale - vec2(0.5);
  vec2 p0 = floor(componentCoord);
  vec2 p1 = p0 + vec2(1.0);
  vec2 t = componentCoord - p0;

  p0 = clamp(p0, vec2(0.0), coeffSize - vec2(1.0));
  p1 = clamp(p1, vec2(0.0), coeffSize - vec2(1.0));

  if (p0.x == p1.x) {
    t.x = 0.0;
  }

  if (p0.y == p1.y) {
    t.y = 0.0;
  }

  float v00 = decodeRoundedComponentPixel(coeffTexture, coeffSize, p0);
  float v10 = decodeRoundedComponentPixel(coeffTexture, coeffSize, vec2(p1.x, p0.y));
  float v01 = decodeRoundedComponentPixel(coeffTexture, coeffSize, vec2(p0.x, p1.y));
  float v11 = decodeRoundedComponentPixel(coeffTexture, coeffSize, p1);
  float top = mix(v00, v10, t.x);
  float bottom = mix(v01, v11, t.x);

  return mix(top, bottom, t.y);
}

void main() {
  vec2 imagePixel = vec2(gl_FragCoord.x - 0.5, uImageSize.y - gl_FragCoord.y);
  float y = decodeComponent(uCoeff0, uCoeffSize0, uSampleScale0, imagePixel);

  if (uComponentCount == 1) {
    float gray = clamp(y / 255.0, 0.0, 1.0);
    gl_FragColor = vec4(gray, gray, gray, 1.0);
    return;
  }

  float cb = decodeComponent(uCoeff1, uCoeffSize1, uSampleScale1, imagePixel) - 128.0;
  float cr = decodeComponent(uCoeff2, uCoeffSize2, uSampleScale2, imagePixel) - 128.0;

  vec3 rgb = vec3(
    y + 1.402 * cr,
    y - 0.344136286201022 * cb - 0.714136285714286 * cr,
    y + 1.772 * cb
  ) / 255.0;

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
