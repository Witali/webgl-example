/*
 * Purpose: Shared WebGL textured cube renderer used by the main demo and the
 * benchmark GPU warm-up panel.
 * Processing blocks:
 * - Load the cube GLSL shaders and upload the shared cube geometry.
 * - Maintain model/view/projection matrices, lighting uniforms, and texture state.
 * - Draw one or many passes of the same lit rotating stone cube.
 */
(function (global) {
  "use strict";

  const SCRIPT_URL = resolveScriptUrl();
  const DEFAULT_SHADER_URLS = {
    vertex: resolveProjectUrl("shaders/cube.vert.glsl"),
    fragment: resolveProjectUrl("shaders/cube.frag.glsl"),
  };
  const CUBE_GEOMETRY = {
    positions: new Float32Array([
      -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,  1,
       1, -1, -1, -1, -1, -1, -1,  1, -1,  1,  1, -1,
      -1,  1,  1,  1,  1,  1,  1,  1, -1, -1,  1, -1,
      -1, -1, -1,  1, -1, -1,  1, -1,  1, -1, -1,  1,
       1, -1,  1,  1, -1, -1,  1,  1, -1,  1,  1,  1,
      -1, -1, -1, -1, -1,  1, -1,  1,  1, -1,  1, -1,
    ]),
    normals: new Float32Array([
       0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
       0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
       0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
       0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
       1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,
      -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
    ]),
    texCoords: new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]),
    indices: new Uint16Array([
       0,  1,  2,   0,  2,  3,
       4,  5,  6,   4,  6,  7,
       8,  9, 10,   8, 10, 11,
      12, 13, 14,  12, 14, 15,
      16, 17, 18,  16, 18, 19,
      20, 21, 22,  20, 22, 23,
    ]),
  };

  class TexturedCubeRenderer {
    static async create(gl, options) {
      const rendererOptions = options || {};
      const shaderUrls = rendererOptions.shaderUrls || DEFAULT_SHADER_URLS;
      const shaderSources = await loadShaderPair(shaderUrls);

      return new TexturedCubeRenderer(gl, shaderSources, rendererOptions);
    }

    constructor(gl, shaderSources, options) {
      this.gl = gl;
      this.options = options || {};
      this.program = createProgram(gl, shaderSources.vertex, shaderSources.fragment);
      this.locations = createLocations(gl, this.program);
      this.positionBuffer = bindAttribute(gl, this.locations.position, CUBE_GEOMETRY.positions, 3);
      this.normalBuffer = bindAttribute(gl, this.locations.normal, CUBE_GEOMETRY.normals, 3);
      this.texCoordBuffer = bindAttribute(gl, this.locations.texCoord, CUBE_GEOMETRY.texCoords, 2);
      this.indexBuffer = createIndexBuffer(gl, CUBE_GEOMETRY.indices);
      this.indexCount = CUBE_GEOMETRY.indices.length;
      this.view = mat4LookAt(
        this.options.eye || [0, 0, 6],
        this.options.target || [0, 0, 0],
        this.options.up || [0, 1, 0]
      );
      this.model = mat4Create();
      this.projection = mat4Create();
      this.texture = createSolidTexture(gl, this.options.placeholderColor || [120, 120, 120, 255]);

      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.locations.view, false, this.view);
      gl.uniform1i(this.locations.stoneTexture, 0);
      gl.uniform3fv(this.locations.lightPosition, this.options.lightPosition || [3.0, 4.0, 5.0]);
      gl.uniform3fv(this.locations.lightColor, this.options.lightColor || [0.92, 0.9, 0.82]);
      gl.uniform3fv(this.locations.ambientColor, this.options.ambientColor || [0.22, 0.22, 0.22]);
    }

    async loadTexture(url, options) {
      const textureOptions = options || {};
      const textureUrl = resolveProjectUrl(url);

      if (textureOptions.preferGpuJpeg !== false && global.GpuJpegDecoder) {
        try {
          const decoder = await global.GpuJpegDecoder.create(this.gl);
          const decoded = await decoder.decodeUrl(textureUrl);

          this.replaceTexture(decoded.texture);
          return;
        } catch (error) {
          console.warn("GPU JPEG decode failed, falling back to browser image decode.", error);
        }
      }

      try {
        await this.loadTextureWithBrowserDecoder(textureUrl);
      } catch (error) {
        console.warn("Browser texture decode failed, keeping placeholder texture.", error);
      }
    }

    async loadTextureWithBrowserDecoder(url) {
      const image = await loadImage(resolveProjectUrl(url));
      const gl = this.gl;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    replaceTexture(texture) {
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
      }

      this.texture = texture;
    }

    resizeToDisplaySize(devicePixelRatio) {
      const pixelRatio = Number.isFinite(devicePixelRatio)
        ? devicePixelRatio
        : global.devicePixelRatio || 1;
      const canvas = this.gl.canvas;
      const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    draw(options) {
      const drawOptions = options || {};
      const gl = this.gl;
      const width = drawOptions.width || gl.drawingBufferWidth;
      const height = drawOptions.height || gl.drawingBufferHeight;
      const drawPasses = drawOptions.drawPasses || 1;
      const clearColor = drawOptions.clearColor || [0.07, 0.08, 0.1, 1.0];

      if (drawOptions.resizeToDisplaySize) {
        this.resizeToDisplaySize(drawOptions.devicePixelRatio);
      }

      mat4Perspective(
        this.projection,
        drawOptions.fovY || Math.PI / 4,
        width / Math.max(1, height),
        drawOptions.near || 0.1,
        drawOptions.far || 100
      );
      mat4Identity(this.model);
      mat4RotateY(this.model, this.model, drawOptions.angleY || 0);
      mat4RotateX(this.model, this.model, drawOptions.angleX || 0);

      gl.useProgram(this.program);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.depthFunc(gl.LEQUAL);
      gl.viewport(0, 0, width, height);

      if (drawOptions.clear !== false) {
        gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }

      this.bindGeometry();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniformMatrix4fv(this.locations.projection, false, this.projection);
      gl.uniformMatrix4fv(this.locations.model, false, this.model);
      gl.uniformMatrix3fv(this.locations.normalMatrix, false, mat3FromMat4(this.model));

      for (let pass = 0; pass < drawPasses; pass += 1) {
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
      }
    }

    bindGeometry() {
      const gl = this.gl;

      bindAttributeBuffer(gl, this.locations.position, this.positionBuffer, 3);
      bindAttributeBuffer(gl, this.locations.normal, this.normalBuffer, 3);
      bindAttributeBuffer(gl, this.locations.texCoord, this.texCoordBuffer, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    }
  }

  async function loadShaderPair(urls) {
    const [vertex, fragment] = await Promise.all([
      loadText(urls.vertex),
      loadText(urls.fragment),
    ]);

    return { vertex, fragment };
  }

  async function loadText(url) {
    const response = await fetch(resolveProjectUrl(url));

    if (!response.ok) {
      throw new Error(`Failed to fetch shader ${url}: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  function createLocations(gl, program) {
    return {
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
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const shaderProgram = gl.createProgram();

    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(shaderProgram);

      gl.deleteProgram(shaderProgram);
      throw new Error(`Textured cube program link failed: ${message}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return shaderProgram;
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);

      gl.deleteShader(shader);
      throw new Error(`Textured cube shader compile failed: ${message}`);
    }

    return shader;
  }

  function bindAttribute(gl, location, data, size) {
    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    bindAttributeBuffer(gl, location, buffer, size);

    return buffer;
  }

  function bindAttributeBuffer(gl, location, buffer, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  function createIndexBuffer(gl, indices) {
    const indexBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return indexBuffer;
  }

  function createSolidTexture(gl, color) {
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

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => {
        reject(new Error(`Failed to load cube texture ${url}`));
      }, { once: true });
      image.src = url;
    });
  }

  function resolveProjectUrl(path) {
    if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("blob:") || path.startsWith("data:")) {
      return path;
    }

    if (path.startsWith("/")) {
      return new URL(path.slice(1), SCRIPT_URL).href;
    }

    return new URL(path, SCRIPT_URL).href;
  }

  function resolveScriptUrl() {
    if (global.document && global.document.currentScript && global.document.currentScript.src) {
      return global.document.currentScript.src;
    }

    if (global.location && global.location.href) {
      return global.location.href;
    }

    return "";
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

  global.TexturedCubeRenderer = TexturedCubeRenderer;
})(typeof globalThis !== "undefined" ? globalThis : window);
