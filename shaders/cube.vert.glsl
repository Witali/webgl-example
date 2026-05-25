/*
 * Purpose: Vertex shader for the rotating textured cube demo.
 * Processing blocks:
 * - Transform object-space positions through model, view, and projection matrices.
 * - Transform normals for lighting in the fragment shader.
 * - Pass world position and texture coordinates to the fragment stage.
 */
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vTexCoord;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vTexCoord = aTexCoord;
  gl_Position = uProjection * uView * worldPosition;
}
