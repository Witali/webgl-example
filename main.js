"use strict";

const canvas = document.getElementById("gl-canvas");
const fpsCounter = document.getElementById("fps-counter");
const gl = canvas.getContext("webgl", { antialias: true });

if (!gl) {
  document.body.textContent = "WebGL is not supported in this browser.";
  throw new Error("WebGL is not supported");
}

const vertexShaderSource = `
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
`;

const fragmentShaderSource = `
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
`;

const positions = new Float32Array([
  // Front
  -1, -1,  1,
   1, -1,  1,
   1,  1,  1,
  -1,  1,  1,

  // Back
   1, -1, -1,
  -1, -1, -1,
  -1,  1, -1,
   1,  1, -1,

  // Top
  -1,  1,  1,
   1,  1,  1,
   1,  1, -1,
  -1,  1, -1,

  // Bottom
  -1, -1, -1,
   1, -1, -1,
   1, -1,  1,
  -1, -1,  1,

  // Right
   1, -1,  1,
   1, -1, -1,
   1,  1, -1,
   1,  1,  1,

  // Left
  -1, -1, -1,
  -1, -1,  1,
  -1,  1,  1,
  -1,  1, -1,
]);

const normals = new Float32Array([
  0,  0,  1,
  0,  0,  1,
  0,  0,  1,
  0,  0,  1,

  0,  0, -1,
  0,  0, -1,
  0,  0, -1,
  0,  0, -1,

  0,  1,  0,
  0,  1,  0,
  0,  1,  0,
  0,  1,  0,

  0, -1,  0,
  0, -1,  0,
  0, -1,  0,
  0, -1,  0,

  1,  0,  0,
  1,  0,  0,
  1,  0,  0,
  1,  0,  0,

 -1,  0,  0,
 -1,  0,  0,
 -1,  0,  0,
 -1,  0,  0,
]);

const textureCoordinates = new Float32Array([
  0, 0,
  1, 0,
  1, 1,
  0, 1,

  0, 0,
  1, 0,
  1, 1,
  0, 1,

  0, 0,
  1, 0,
  1, 1,
  0, 1,

  0, 0,
  1, 0,
  1, 1,
  0, 1,

  0, 0,
  1, 0,
  1, 1,
  0, 1,

  0, 0,
  1, 0,
  1, 1,
  0, 1,
]);

const indices = new Uint16Array([
   0,  1,  2,   0,  2,  3,
   4,  5,  6,   4,  6,  7,
   8,  9, 10,   8, 10, 11,
  12, 13, 14,  12, 14, 15,
  16, 17, 18,  16, 18, 19,
  20, 21, 22,  20, 22, 23,
]);

const program = createProgram(vertexShaderSource, fragmentShaderSource);
gl.useProgram(program);

const locations = {
  position: gl.getAttribLocation(program, "aPosition"),
  normal: gl.getAttribLocation(program, "aNormal"),
  texCoord: gl.getAttribLocation(program, "aTexCoord"),
  model: gl.getUniformLocation(program, "uModel"),
  view: gl.getUniformLocation(program, "uView"),
  projection: gl.getUniformLocation(program, "uProjection"),
  normalMatrix: gl.getUniformLocation(program, "uNormalMatrix"),
  stoneTexture: gl.getUniformLocation(program, "uStoneTexture"),
  lightPosition: gl.getUniformLocation(program, "uLightPosition"),
  lightColor: gl.getUniformLocation(program, "uLightColor"),
  ambientColor: gl.getUniformLocation(program, "uAmbientColor"),
};

const positionBuffer = bindAttribute(locations.position, positions, 3);
const normalBuffer = bindAttribute(locations.normal, normals, 3);
const texCoordBuffer = bindAttribute(locations.texCoord, textureCoordinates, 2);

const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

const view = mat4LookAt([0, 0, 6], [0, 0, 0], [0, 1, 0]);
const model = mat4Create();
const projection = mat4Create();
let stoneTexture = createSolidTexture([120, 120, 120, 255]);
const fpsState = {
  frameCount: 0,
  lastUpdateTime: 0,
};

loadTexture("assets/stone-texture-wic.jpg");

gl.uniformMatrix4fv(locations.view, false, view);
gl.uniform1i(locations.stoneTexture, 0);
gl.uniform3fv(locations.lightPosition, [3.0, 4.0, 5.0]);
gl.uniform3fv(locations.lightColor, [0.92, 0.9, 0.82]);
gl.uniform3fv(locations.ambientColor, [0.22, 0.22, 0.22]);

requestAnimationFrame(render);

function render(time) {
  updateFpsCounter(time);
  resizeCanvasToDisplaySize();

  const aspect = canvas.width / canvas.height;
  mat4Perspective(projection, Math.PI / 4, aspect, 0.1, 100);

  mat4Identity(model);
  mat4RotateY(model, model, time * 0.001);
  mat4RotateX(model, model, time * 0.0007);

  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.07, 0.08, 0.1, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  bindCubeGeometry();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stoneTexture);
  gl.uniformMatrix4fv(locations.projection, false, projection);
  gl.uniformMatrix4fv(locations.model, false, model);
  gl.uniformMatrix3fv(locations.normalMatrix, false, mat3FromMat4(model));

  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  requestAnimationFrame(render);
}

function updateFpsCounter(time) {
  fpsState.frameCount += 1;

  if (fpsState.lastUpdateTime === 0) {
    fpsState.lastUpdateTime = time;
    return;
  }

  const elapsed = time - fpsState.lastUpdateTime;

  if (elapsed >= 500) {
    const fps = Math.round((fpsState.frameCount * 1000) / elapsed);
    fpsCounter.textContent = `${fps} FPS`;
    fpsState.frameCount = 0;
    fpsState.lastUpdateTime = time;
  }
}

function createProgram(vertexSource, fragmentSource) {
  const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const shaderProgram = gl.createProgram();

  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(shaderProgram);
    gl.deleteProgram(shaderProgram);
    throw new Error(`Program link failed: ${message}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return shaderProgram;
}

function createShader(type, source) {
  const shader = gl.createShader(type);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${message}`);
  }

  return shader;
}

function bindAttribute(location, data, size) {
  const buffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  bindAttributeBuffer(location, buffer, size);

  return buffer;
}

function bindAttributeBuffer(location, buffer, size) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function bindCubeGeometry() {
  bindAttributeBuffer(locations.position, positionBuffer, 3);
  bindAttributeBuffer(locations.normal, normalBuffer, 3);
  bindAttributeBuffer(locations.texCoord, texCoordBuffer, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
}

function createSolidTexture(color) {
  const texture = gl.createTexture();

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(color)
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return texture;
}

async function loadTexture(url) {
  if (window.GpuJpegDecoder) {
    try {
      const decoder = new window.GpuJpegDecoder(gl);
      const decoded = await decoder.decodeUrl(url);

      gl.deleteTexture(stoneTexture);
      stoneTexture = decoded.texture;
      return;
    } catch (error) {
      console.warn("GPU JPEG decode failed, falling back to browser image decode.", error);
    }
  }

  loadTextureWithBrowserDecoder(url);
}

function loadTextureWithBrowserDecoder(url) {
  const image = new Image();

  image.addEventListener("load", () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stoneTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  });

  image.src = url;
}

function resizeCanvasToDisplaySize() {
  const width = Math.floor(canvas.clientWidth * window.devicePixelRatio);
  const height = Math.floor(canvas.clientHeight * window.devicePixelRatio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function mat4Create() {
  return new Float32Array(16);
}

function mat4Identity(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

function mat4Perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);

  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;

  return out;
}

function mat4LookAt(eye, target, up) {
  const z = normalize([
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = mat4Create();

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;

  return out;
}

function mat4RotateX(out, matrix, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];

  if (matrix !== out) {
    out[0] = matrix[0];
    out[1] = matrix[1];
    out[2] = matrix[2];
    out[3] = matrix[3];
    out[12] = matrix[12];
    out[13] = matrix[13];
    out[14] = matrix[14];
    out[15] = matrix[15];
  }

  out[4] = a10 * c + a20 * s;
  out[5] = a11 * c + a21 * s;
  out[6] = a12 * c + a22 * s;
  out[7] = a13 * c + a23 * s;
  out[8] = a20 * c - a10 * s;
  out[9] = a21 * c - a11 * s;
  out[10] = a22 * c - a12 * s;
  out[11] = a23 * c - a13 * s;

  return out;
}

function mat4RotateY(out, matrix, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];

  if (matrix !== out) {
    out[4] = matrix[4];
    out[5] = matrix[5];
    out[6] = matrix[6];
    out[7] = matrix[7];
    out[12] = matrix[12];
    out[13] = matrix[13];
    out[14] = matrix[14];
    out[15] = matrix[15];
  }

  out[0] = a00 * c - a20 * s;
  out[1] = a01 * c - a21 * s;
  out[2] = a02 * c - a22 * s;
  out[3] = a03 * c - a23 * s;
  out[8] = a00 * s + a20 * c;
  out[9] = a01 * s + a21 * c;
  out[10] = a02 * s + a22 * c;
  out[11] = a03 * s + a23 * c;

  return out;
}

function mat3FromMat4(matrix) {
  return new Float32Array([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[8],
    matrix[9],
    matrix[10],
  ]);
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);

  if (length === 0) {
    return [0, 0, 0];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
