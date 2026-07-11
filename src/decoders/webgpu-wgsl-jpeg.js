/*
 * Purpose: WebGPU/WGSL JPEG decoder variant that keeps JPEG entropy parsing in
 * JavaScript and reconstructs pixels in a compute shader.
 * Processing blocks:
 * - Parse JPEG markers, Huffman streams, and dequantized coefficients through GpuJpegDecoder.
 * - Upload component coefficient buffers and compact metadata to WebGPU storage buffers.
 * - Dispatch a WGSL compute shader for IDCT, chroma upsampling, YCbCr conversion, and readback.
 */
(function (global) {
  "use strict";

  const WORKGROUP_SIZE = 8;
  const SHADER_URL = resolveShaderUrl("../shaders/jpeg-idct-compute.wgsl");
  let shaderSourcePromise = null;

  // Public WebGPU facade: CPU entropy decode plus WGSL compute pixel reconstruction.
  class WebGpuWgslJpegDecoder {
    constructor(device, shaderSource) {
      this.device = device;
      this.shaderSource = shaderSource;
      this.pipeline = null;
    }

    static async create() {
      if (!global.navigator || !global.navigator.gpu) {
        throw new Error("WebGpuWgslJpegDecoder requires WebGPU.");
      }

      const adapter = await global.navigator.gpu.requestAdapter();

      if (!adapter) {
        throw new Error("WebGpuWgslJpegDecoder could not acquire a WebGPU adapter.");
      }

      const [device, shaderSource] = await Promise.all([
        adapter.requestDevice(),
        loadShaderSource(),
      ]);
      const decoder = new WebGpuWgslJpegDecoder(device, shaderSource);

      await decoder.initializePipeline();
      return decoder;
    }

    async decodeUrl(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch JPEG: ${response.status} ${response.statusText}`);
      }

      return this.decode(await response.arrayBuffer());
    }

    // Decode flow: parse JPEG, upload buffers, run WGSL compute, copy RGBA pixels back.
    async decode(arrayBuffer) {
      if (!global.GpuJpegDecoder || typeof global.GpuJpegDecoder.parse !== "function") {
        throw new Error("GpuJpegDecoder.parse is required before WebGpuWgslJpegDecoder.");
      }

      const parseStarted = performance.now();
      const jpeg = global.GpuJpegDecoder.parse(arrayBuffer);
      const parseMs = performance.now() - parseStarted;

      if (jpeg.components.length !== 1 && jpeg.components.length !== 3) {
        throw new Error("WebGpuWgslJpegDecoder supports grayscale and YCbCr JPEG images.");
      }

      const setupStarted = performance.now();
      const resources = this.createResources(jpeg);
      const setupMs = performance.now() - setupStarted;
      const gpuStarted = performance.now();

      this.dispatchDecode(jpeg, resources);
      await this.device.queue.onSubmittedWorkDone();
      const gpuDecodeMs = performance.now() - gpuStarted;
      const readbackStarted = performance.now();
      const pixels = await this.readPixels(jpeg, resources);
      const readbackMs = performance.now() - readbackStarted;

      destroyResources(resources);

      return {
        width: jpeg.width,
        height: jpeg.height,
        pixels,
        timings: {
          parseMs,
          setupMs,
          uploadMs: setupMs,
          gpuDecodeMs,
          coreDecodeMs: gpuDecodeMs,
          readbackMs,
          workMs: parseMs + gpuDecodeMs,
          totalDecoderMs: parseMs + setupMs + gpuDecodeMs + readbackMs,
          measuresCleanWork: true,
          timedPhase: "JPEG entropy parse + WebGPU WGSL IDCT/color",
        },
      };
    }

    createResources(jpeg) {
      const device = this.device;
      const c0 = jpeg.components[0];
      const c1 = jpeg.components[1] || c0;
      const c2 = jpeg.components[2] || c0;
      const outputByteLength = jpeg.width * jpeg.height * 4;
      const outputBuffer = device.createBuffer({
        size: align(outputByteLength, 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const readbackBuffer = device.createBuffer({
        size: align(outputByteLength, 4),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const resources = {
        componentBuffers: [
          createStorageBuffer(device, c0.blocks),
          createStorageBuffer(device, c1.blocks),
          createStorageBuffer(device, c2.blocks),
        ],
        metaBuffer: createStorageBuffer(device, createMeta(jpeg, c0, c1, c2)),
        outputBuffer,
        readbackBuffer,
      };

      resources.bindGroup = device.createBindGroup({
        layout: this.ensurePipeline().getBindGroupLayout(0),
        entries: [
          bufferEntry(0, resources.componentBuffers[0]),
          bufferEntry(1, resources.componentBuffers[1]),
          bufferEntry(2, resources.componentBuffers[2]),
          bufferEntry(3, resources.metaBuffer),
          bufferEntry(4, resources.outputBuffer),
        ],
      });

      return resources;
    }

    dispatchDecode(jpeg, resources) {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();

      pass.setPipeline(this.ensurePipeline());
      pass.setBindGroup(0, resources.bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(jpeg.width / WORKGROUP_SIZE),
        Math.ceil(jpeg.height / WORKGROUP_SIZE)
      );
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    async readPixels(jpeg, resources) {
      const byteLength = jpeg.width * jpeg.height * 4;
      const encoder = this.device.createCommandEncoder();

      encoder.copyBufferToBuffer(
        resources.outputBuffer,
        0,
        resources.readbackBuffer,
        0,
        align(byteLength, 4)
      );
      this.device.queue.submit([encoder.finish()]);
      await resources.readbackBuffer.mapAsync(GPUMapMode.READ);

      try {
        const mapped = resources.readbackBuffer.getMappedRange(0, byteLength);

        return new Uint8ClampedArray(mapped.slice(0));
      } finally {
        resources.readbackBuffer.unmap();
      }
    }

    ensurePipeline() {
      if (!this.pipeline) {
        this.pipeline = this.device.createComputePipeline(this.createPipelineDescriptor());
      }

      return this.pipeline;
    }

    async initializePipeline() {
      if (this.pipeline) {
        return this.pipeline;
      }

      const descriptor = this.createPipelineDescriptor();

      if (typeof this.device.createComputePipelineAsync === "function") {
        this.pipeline = await this.device.createComputePipelineAsync(descriptor);
      } else {
        this.pipeline = this.device.createComputePipeline(descriptor);
      }

      return this.pipeline;
    }

    createPipelineDescriptor() {
      const module = this.device.createShaderModule({
        code: this.shaderSource,
      });

      return {
        layout: "auto",
        compute: {
          module,
          entryPoint: "main",
        },
      };
    }
  }

  function createMeta(jpeg, c0, c1, c2) {
    return new Uint32Array([
      jpeg.width,
      jpeg.height,
      jpeg.components.length,
      c0.blockCountX * 8,
      c0.blockCountY * 8,
      c1.blockCountX * 8,
      c1.blockCountY * 8,
      c2.blockCountX * 8,
      c2.blockCountY * 8,
      jpeg.maxHorizontalSampling,
      jpeg.maxVerticalSampling,
      c0.horizontalSampling,
      c0.verticalSampling,
      c1.horizontalSampling,
      c1.verticalSampling,
      c2.horizontalSampling,
      c2.verticalSampling,
    ]);
  }

  function createStorageBuffer(device, data) {
    const buffer = device.createBuffer({
      size: align(data.byteLength, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  function bufferEntry(binding, buffer) {
    return {
      binding,
      resource: { buffer },
    };
  }

  function destroyResources(resources) {
    [
      ...resources.componentBuffers,
      resources.metaBuffer,
      resources.outputBuffer,
      resources.readbackBuffer,
    ].forEach((buffer) => {
      if (buffer && typeof buffer.destroy === "function") {
        buffer.destroy();
      }
    });
  }

  function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }

  async function loadShaderSource() {
    if (!shaderSourcePromise) {
      shaderSourcePromise = fetch(SHADER_URL).then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch WGSL shader: ${response.status} ${response.statusText}`);
        }

        return response.text();
      }).catch((error) => {
        shaderSourcePromise = null;
        throw error;
      });
    }

    return shaderSourcePromise;
  }

  function resolveShaderUrl(path) {
    if (global.document && global.document.currentScript && global.document.currentScript.src) {
      return new URL(path, global.document.currentScript.src).toString();
    }

    if (global.location && global.location.href) {
      return new URL(path, global.location.href).toString();
    }

    return path;
  }

  global.WebGpuWgslJpegDecoder = WebGpuWgslJpegDecoder;

  if (typeof module !== "undefined") {
    module.exports = { WebGpuWgslJpegDecoder };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
