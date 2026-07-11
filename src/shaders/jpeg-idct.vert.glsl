/*
 * Purpose: Fullscreen quad vertex shader for the WebGL JPEG IDCT pass.
 * Processing blocks:
 * - Receive prebuilt clip-space quad positions.
 * - Emit positions directly so each fragment maps to one output image pixel.
 */
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
