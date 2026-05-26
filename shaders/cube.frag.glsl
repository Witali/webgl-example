/*
 * Purpose: Fragment shader for the rotating cube's textured lighting.
 * Processing blocks:
 * - Offset texture coordinates and normals from the generated height map.
 * - Sample the stone texture and generated specular map for material response.
 * - Combine ambient, diffuse, and glossy or matte highlights into the final color.
 */
precision mediump float;

varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vWorldPosition;
varying vec2 vTexCoord;

uniform sampler2D uStoneTexture;
uniform sampler2D uHeightTexture;
uniform sampler2D uSpecularTexture;
uniform vec2 uHeightTexelSize;
uniform float uHeightStrength;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uViewPosition;
uniform float uSpecularStrength;
uniform float uShininess;

const float HEIGHT_NORMAL_SCALE = 27.0;
const float HEIGHT_PARALLAX_SCALE = 0.165;

vec3 applyHeightNormal(vec2 uv, vec3 normal, vec3 tangent, vec3 bitangent) {
  float heightCenter = texture2D(uHeightTexture, uv).r;
  float heightRight = texture2D(uHeightTexture, uv + vec2(uHeightTexelSize.x, 0.0)).r;
  float heightUp = texture2D(uHeightTexture, uv + vec2(0.0, uHeightTexelSize.y)).r;
  vec2 slope = vec2(heightRight - heightCenter, heightUp - heightCenter) *
    uHeightStrength * HEIGHT_NORMAL_SCALE;
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
  vec2 reliefTexCoord = vTexCoord - viewOffset * (height - 0.5) *
    uHeightStrength * HEIGHT_PARALLAX_SCALE;

  normal = applyHeightNormal(reliefTexCoord, normal, tangent, bitangent);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  vec3 halfVector = normalize(lightDirection + viewDirection);
  float specularMask = texture2D(uSpecularTexture, reliefTexCoord).r;
  float specular = pow(max(dot(normal, halfVector), 0.0), max(uShininess, 1.0)) *
    uSpecularStrength * specularMask;

  vec3 stoneColor = texture2D(uStoneTexture, reliefTexCoord).rgb;
  vec3 color = stoneColor * (uAmbientColor + diffuse * uLightColor) + specular * uLightColor;
  gl_FragColor = vec4(color, 1.0);
}
