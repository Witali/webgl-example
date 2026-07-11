/*
 * Purpose: Fragment shader for the rotating cube's textured lighting.
 * Processing blocks:
 * - Offset texture coordinates and normals from the generated height map.
 * - Sample the stone texture and generated specular map for material response.
 * - Combine ambient, diffuse, and glossy or matte highlights into the final color.
 */
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
uniform vec2 uBpalImageSize;
uniform float uBpalBlockSize;
uniform float uBpalBlocksX;
uniform float uBpalLocalColorCount;
uniform vec2 uBpalPixelAtlasSize;
uniform vec2 uBpalBlockPaletteAtlasSize;
uniform vec2 uBpalPaletteAtlasSize;
uniform vec2 uHeightTexelSize;
uniform float uHeightStrength;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uViewPosition;
uniform float uSpecularStrength;
uniform float uShininess;

vec2 atlasTexCoord(float linearIndex, vec2 atlasSize) {
  float x = mod(linearIndex, atlasSize.x);
  float y = floor(linearIndex / atlasSize.x);

  return (vec2(x, y) + 0.5) / atlasSize;
}

vec3 fetchBpalColor(vec2 pixelCoord) {
  vec2 pixel = clamp(pixelCoord, vec2(0.0), uBpalImageSize - 1.0);
  float pixelIndex = pixel.y * uBpalImageSize.x + pixel.x;
  float localIndex = floor(
    texture2D(uBpalPixelIndices, atlasTexCoord(pixelIndex, uBpalPixelAtlasSize)).r * 255.0 + 0.5
  );
  vec2 block = floor(pixel / uBpalBlockSize);
  float blockIndex = block.y * uBpalBlocksX + block.x;
  float blockPaletteIndex = blockIndex * uBpalLocalColorCount + localIndex;
  vec2 packedGlobalIndex = texture2D(
    uBpalBlockPalettes,
    atlasTexCoord(blockPaletteIndex, uBpalBlockPaletteAtlasSize)
  ).rg;
  float globalIndex = floor(packedGlobalIndex.r * 255.0 + 0.5) +
    floor(packedGlobalIndex.g * 255.0 + 0.5) * 256.0;

  return texture2D(
    uBpalGlobalPalette,
    atlasTexCoord(globalIndex, uBpalPaletteAtlasSize)
  ).rgb;
}

vec3 sampleBpalTexture(vec2 uv) {
  vec2 sourceCoord = vec2(uv.x, 1.0 - uv.y) * uBpalImageSize - 0.5;
  vec2 topLeft = floor(sourceCoord);
  vec2 blend = fract(sourceCoord);
  vec3 top = mix(
    fetchBpalColor(topLeft),
    fetchBpalColor(topLeft + vec2(1.0, 0.0)),
    blend.x
  );
  vec3 bottom = mix(
    fetchBpalColor(topLeft + vec2(0.0, 1.0)),
    fetchBpalColor(topLeft + vec2(1.0, 1.0)),
    blend.x
  );

  return mix(top, bottom, blend.y);
}

vec3 applyHeightNormal(vec2 uv, vec3 normal, vec3 tangent, vec3 bitangent) {
  float heightCenter = texture2D(uHeightTexture, uv).r;
  float heightRight = texture2D(uHeightTexture, uv + vec2(uHeightTexelSize.x, 0.0)).r;
  float heightUp = texture2D(uHeightTexture, uv + vec2(0.0, uHeightTexelSize.y)).r;
  vec2 slope = vec2(heightRight - heightCenter, heightUp - heightCenter) * uHeightStrength * 9.0;
  vec3 tangentSpaceNormal = normalize(vec3(-slope.x, -slope.y, 1.0));
  mat3 tbn = mat3(tangent, bitangent, normal);

  return normalize(tbn * tangentSpaceNormal);
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
    : texture2D(uStoneTexture, reliefTexCoord).rgb;
  vec3 color = stoneColor * (uAmbientColor + diffuse * uLightColor) + specular * uLightColor;
  gl_FragColor = vec4(color, 1.0);
}
