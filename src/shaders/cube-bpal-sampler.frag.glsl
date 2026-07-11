/*
 * Purpose: Fragment shader for sampling mipmapped BPAL textures on the cube.
 * Processing blocks:
 * - Reconstruct palette colors through local and global BPAL indices.
 * - Select mip levels from screen-space UV derivatives.
 * - Apply nearest, bilinear, trilinear, or bounded anisotropic filtering.
 * - Light filtered colors in linear RGB and encode the result as sRGB.
 */
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vWorldPosition;
varying vec2 vTexCoord;

uniform sampler2D uStoneTexture;
uniform sampler2D uHeightTexture;
uniform sampler2D uSpecularTexture;
uniform sampler2D uBpalPixelIndices;
uniform sampler2D uBpalBlockPalettes;
uniform sampler2D uBpalGlobalPalette;
uniform float uUseBpalTexture;
uniform float uBpalBlockSize;
uniform float uBpalLocalColorCount;
uniform vec2 uBpalPixelAtlasSize;
uniform vec2 uBpalBlockPaletteAtlasSize;
uniform vec2 uBpalPaletteAtlasSize;
uniform float uBpalMipCount;
uniform float uBpalFilterMode;
uniform float uBpalMaxAnisotropy;
uniform float uBpalLodBias;

uniform vec4 uBpalMipInfo0;
uniform vec4 uBpalMipInfo1;
uniform vec4 uBpalMipInfo2;
uniform vec4 uBpalMipInfo3;
uniform vec4 uBpalMipInfo4;
uniform vec4 uBpalMipInfo5;
uniform vec4 uBpalMipInfo6;
uniform vec4 uBpalMipInfo7;
uniform vec4 uBpalMipInfo8;
uniform vec4 uBpalMipInfo9;
uniform vec4 uBpalMipInfo10;
uniform vec4 uBpalMipInfo11;
uniform vec4 uBpalMipInfo12;
uniform vec4 uBpalMipInfo13;
uniform vec4 uBpalMipInfo14;
uniform vec4 uBpalMipInfo15;
uniform vec2 uBpalMipBlockInfo0;
uniform vec2 uBpalMipBlockInfo1;
uniform vec2 uBpalMipBlockInfo2;
uniform vec2 uBpalMipBlockInfo3;
uniform vec2 uBpalMipBlockInfo4;
uniform vec2 uBpalMipBlockInfo5;
uniform vec2 uBpalMipBlockInfo6;
uniform vec2 uBpalMipBlockInfo7;
uniform vec2 uBpalMipBlockInfo8;
uniform vec2 uBpalMipBlockInfo9;
uniform vec2 uBpalMipBlockInfo10;
uniform vec2 uBpalMipBlockInfo11;
uniform vec2 uBpalMipBlockInfo12;
uniform vec2 uBpalMipBlockInfo13;
uniform vec2 uBpalMipBlockInfo14;
uniform vec2 uBpalMipBlockInfo15;

uniform vec2 uHeightTexelSize;
uniform float uHeightStrength;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uViewPosition;
uniform float uSpecularStrength;
uniform float uShininess;

vec3 srgbToLinear(vec3 color) {
  vec3 low = color / 12.92;
  vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));

  return mix(low, high, step(vec3(0.04045), color));
}

vec3 linearToSrgb(vec3 color) {
  vec3 clamped = clamp(color, 0.0, 1.0);
  vec3 low = clamped * 12.92;
  vec3 high = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;

  return mix(low, high, step(vec3(0.0031308), clamped));
}

vec4 mipInfo(float mip) {
  if (mip < 0.5) return uBpalMipInfo0;
  if (mip < 1.5) return uBpalMipInfo1;
  if (mip < 2.5) return uBpalMipInfo2;
  if (mip < 3.5) return uBpalMipInfo3;
  if (mip < 4.5) return uBpalMipInfo4;
  if (mip < 5.5) return uBpalMipInfo5;
  if (mip < 6.5) return uBpalMipInfo6;
  if (mip < 7.5) return uBpalMipInfo7;
  if (mip < 8.5) return uBpalMipInfo8;
  if (mip < 9.5) return uBpalMipInfo9;
  if (mip < 10.5) return uBpalMipInfo10;
  if (mip < 11.5) return uBpalMipInfo11;
  if (mip < 12.5) return uBpalMipInfo12;
  if (mip < 13.5) return uBpalMipInfo13;
  if (mip < 14.5) return uBpalMipInfo14;
  return uBpalMipInfo15;
}

vec2 mipBlockInfo(float mip) {
  if (mip < 0.5) return uBpalMipBlockInfo0;
  if (mip < 1.5) return uBpalMipBlockInfo1;
  if (mip < 2.5) return uBpalMipBlockInfo2;
  if (mip < 3.5) return uBpalMipBlockInfo3;
  if (mip < 4.5) return uBpalMipBlockInfo4;
  if (mip < 5.5) return uBpalMipBlockInfo5;
  if (mip < 6.5) return uBpalMipBlockInfo6;
  if (mip < 7.5) return uBpalMipBlockInfo7;
  if (mip < 8.5) return uBpalMipBlockInfo8;
  if (mip < 9.5) return uBpalMipBlockInfo9;
  if (mip < 10.5) return uBpalMipBlockInfo10;
  if (mip < 11.5) return uBpalMipBlockInfo11;
  if (mip < 12.5) return uBpalMipBlockInfo12;
  if (mip < 13.5) return uBpalMipBlockInfo13;
  if (mip < 14.5) return uBpalMipBlockInfo14;
  return uBpalMipBlockInfo15;
}

vec2 atlasTexCoord(float linearIndex, vec2 atlasSize) {
  float x = mod(linearIndex, atlasSize.x);
  float y = floor(linearIndex / atlasSize.x);

  return (vec2(x, y) + 0.5) / atlasSize;
}

vec2 wrapPixel(vec2 pixel, vec2 size) {
  return mod(mod(pixel, size) + size, size);
}

vec3 fetchBpalColor(vec2 pixelCoord, float mip) {
  vec4 info = mipInfo(mip);
  vec2 blockInfo = mipBlockInfo(mip);
  vec2 size = info.xy;
  vec2 pixel = wrapPixel(floor(pixelCoord), size);
  float pixelIndex = info.z + pixel.y * size.x + pixel.x;
  float localIndex = floor(
    texture2D(uBpalPixelIndices, atlasTexCoord(pixelIndex, uBpalPixelAtlasSize)).r * 255.0 + 0.5
  );
  vec2 block = floor(pixel / uBpalBlockSize);
  float blockIndex = block.y * blockInfo.x + block.x;
  float blockPaletteIndex = info.w + blockIndex * uBpalLocalColorCount + localIndex;
  vec2 packedGlobalIndex = texture2D(
    uBpalBlockPalettes,
    atlasTexCoord(blockPaletteIndex, uBpalBlockPaletteAtlasSize)
  ).rg;
  float globalIndex = floor(packedGlobalIndex.r * 255.0 + 0.5) +
    floor(packedGlobalIndex.g * 255.0 + 0.5) * 256.0;
  vec3 srgb = texture2D(
    uBpalGlobalPalette,
    atlasTexCoord(globalIndex, uBpalPaletteAtlasSize)
  ).rgb;

  return srgbToLinear(srgb);
}

vec2 mipSourceCoord(vec2 uv, vec2 size) {
  vec2 wrapped = fract(uv);

  return vec2(wrapped.x, 1.0 - wrapped.y) * size - 0.5;
}

vec3 sampleMipNearest(vec2 uv, float mip) {
  vec2 sourceCoord = mipSourceCoord(uv, mipInfo(mip).xy);

  return fetchBpalColor(floor(sourceCoord + 0.5), mip);
}

vec3 sampleMipBilinear(vec2 uv, float mip) {
  vec2 sourceCoord = mipSourceCoord(uv, mipInfo(mip).xy);
  vec2 topLeft = floor(sourceCoord);
  vec2 blend = fract(sourceCoord);
  vec3 top = mix(
    fetchBpalColor(topLeft, mip),
    fetchBpalColor(topLeft + vec2(1.0, 0.0), mip),
    blend.x
  );
  vec3 bottom = mix(
    fetchBpalColor(topLeft + vec2(0.0, 1.0), mip),
    fetchBpalColor(topLeft + vec2(1.0, 1.0), mip),
    blend.x
  );

  return mix(top, bottom, blend.y);
}

float clampLod(float lod) {
  return clamp(lod + uBpalLodBias, 0.0, max(0.0, uBpalMipCount - 1.0));
}

float implicitLod(vec2 uv) {
  vec2 baseSize = uBpalMipInfo0.xy;
  vec2 dx = dFdx(uv) * baseSize;
  vec2 dy = dFdy(uv) * baseSize;
  float footprint = max(length(dx), length(dy));

  return clampLod(log2(max(footprint, 1.0)));
}

vec3 sampleTrilinearAtLod(vec2 uv, float lod) {
  float clampedLod = clamp(lod, 0.0, max(0.0, uBpalMipCount - 1.0));
  float firstMip = floor(clampedLod);
  float secondMip = min(firstMip + 1.0, uBpalMipCount - 1.0);

  return mix(
    sampleMipBilinear(uv, firstMip),
    sampleMipBilinear(uv, secondMip),
    fract(clampedLod)
  );
}

vec3 sampleBpalAnisotropic(vec2 uv) {
  vec2 baseSize = uBpalMipInfo0.xy;
  vec2 dxUv = dFdx(uv);
  vec2 dyUv = dFdy(uv);
  float dxLength = length(dxUv * baseSize);
  float dyLength = length(dyUv * baseSize);
  vec2 majorUv = dxLength >= dyLength ? dxUv : dyUv;
  float majorLength = max(dxLength, dyLength);
  float minorLength = max(1.0, min(dxLength, dyLength));
  float sampleCount = ceil(clamp(
    majorLength / minorLength,
    1.0,
    max(1.0, uBpalMaxAnisotropy)
  ));
  float lod = clampLod(log2(minorLength));
  vec3 color = vec3(0.0);

  for (int index = 0; index < 8; index += 1) {
    if (float(index) < sampleCount) {
      float offset = (float(index) + 0.5) / sampleCount - 0.5;

      color += sampleTrilinearAtLod(uv + majorUv * offset, lod);
    }
  }

  return color / sampleCount;
}

vec3 sampleBpalTexture(vec2 uv) {
  float lod = implicitLod(uv);

  if (uBpalFilterMode < 0.5) {
    return sampleMipNearest(uv, floor(lod + 0.5));
  }

  if (uBpalFilterMode < 1.5) {
    return sampleMipBilinear(uv, floor(lod + 0.5));
  }

  if (uBpalFilterMode < 2.5) {
    return sampleTrilinearAtLod(uv, lod);
  }

  return sampleBpalAnisotropic(uv);
}

vec3 applyHeightNormal(vec2 uv, vec3 normal, vec3 tangent, vec3 bitangent) {
  float heightCenter = texture2D(uHeightTexture, uv).r;
  float heightRight = texture2D(uHeightTexture, uv + vec2(uHeightTexelSize.x, 0.0)).r;
  float heightUp = texture2D(uHeightTexture, uv + vec2(0.0, uHeightTexelSize.y)).r;
  vec2 slope = vec2(heightRight - heightCenter, heightUp - heightCenter) * uHeightStrength * 9.0;
  vec3 tangentSpaceNormal = normalize(vec3(-slope.x, -slope.y, 1.0));

  return normalize(mat3(tangent, bitangent, normal) * tangentSpaceNormal);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 tangent = normalize(vTangent - normal * dot(vTangent, normal));
  vec3 bitangent = normalize(vBitangent - normal * dot(vBitangent, normal));
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 viewDirection = normalize(uViewPosition - vWorldPosition);
  vec2 viewOffset = vec2(dot(viewDirection, tangent), dot(viewDirection, bitangent));
  float height = texture2D(uHeightTexture, vTexCoord).r;
  vec2 reliefTexCoord = vTexCoord - viewOffset * (height - 0.5) * uHeightStrength * 0.055;

  normal = applyHeightNormal(reliefTexCoord, normal, tangent, bitangent);

  float diffuse = max(dot(normal, lightDirection), 0.0);
  vec3 halfVector = normalize(lightDirection + viewDirection);
  float specularMask = texture2D(uSpecularTexture, reliefTexCoord).r;
  float specular = pow(max(dot(normal, halfVector), 0.0), max(uShininess, 1.0)) *
    uSpecularStrength * specularMask;
  vec3 stoneColor = uUseBpalTexture > 0.5
    ? sampleBpalTexture(reliefTexCoord)
    : srgbToLinear(texture2D(uStoneTexture, reliefTexCoord).rgb);
  vec3 color = stoneColor * (uAmbientColor + diffuse * uLightColor) + specular * uLightColor;

  gl_FragColor = vec4(linearToSrgb(color), 1.0);
}
