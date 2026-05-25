/*
 * Purpose: Fragment shader for the rotating cube's textured lighting.
 * Processing blocks:
 * - Normalize interpolated normals and compute a diffuse light term.
 * - Sample the stone texture.
 * - Combine ambient and diffuse light into the final color.
 */
precision mediump float;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vTexCoord;

uniform sampler2D uStoneTexture;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  float diffuse = max(dot(normal, lightDirection), 0.0);

  vec3 stoneColor = texture2D(uStoneTexture, vTexCoord).rgb;
  vec3 color = stoneColor * (uAmbientColor + diffuse * uLightColor);
  gl_FragColor = vec4(color, 1.0);
}
