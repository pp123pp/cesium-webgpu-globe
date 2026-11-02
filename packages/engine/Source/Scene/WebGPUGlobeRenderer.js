import { Matrix4, RuntimeError } from "@cesium/core";
import {
  computeRelativeViewProjection,
  decodeTerrainMesh,
} from "./WebGPUGlobeMath.js";

const shader = `
struct Tile { matrix: mat4x4f, clip: vec4f, color: vec4f }
@group(0) @binding(0) var<uniform> tile: Tile;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) mercatorT: f32,
}
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f,
  @location(2) mercatorT: f32) -> VertexOutput {
  var output: VertexOutput;
  output.position = tile.matrix * vec4f(position, 1.0);
  output.uv = uv;
  output.mercatorT = mercatorT;
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Full tiles include native skirts. Do not clip their interpolated edge UVs:
  // float interpolation can overshoot [0,1] and cut a one-pixel crack in a skirt.
  if (any(tile.clip.xy > vec2f(0.0)) || any(tile.clip.zw < vec2f(1.0))) {
    if (any(input.uv < tile.clip.xy - vec2f(0.000001)) ||
        any(input.uv > tile.clip.zw + vec2f(0.000001))) { discard; }
  }
  return tile.color;
}`;

/** Mesh upload and one opaque Globe pass; deliberately not a general renderer. @private */
class WebGPUGlobeRenderer {
  constructor(context) {
    this.context = context;
    this._draws = [];
    this._destroyed = false;
    this._matrix = new Matrix4();
    this.statistics = {
      buffersCreated: 0,
      buffersDestroyed: 0,
      bufferBytes: 0,
      drawCalls: 0,
      triangles: 0,
    };
  }

  async initialize() {
    const device = this.context._device;
    this._device = device;
    this._uniformStride =
      Math.ceil(96 / device.limits.minUniformBufferOffsetAlignment) *
      device.limits.minUniformBufferOffsetAlignment;
    device.pushErrorScope("validation");
    let validationError;
    try {
      this._tileLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: 96,
            },
          },
        ],
      });
      const module = device.createShaderModule({
        label: "WGS84 RTC and reversed-depth WGSL",
        code: shader,
      });
      const descriptor = {
        label: "WGS84 opaque terrain",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this._tileLayout],
        }),
        vertex: {
          module,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 24,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x2" },
                { shaderLocation: 2, offset: 20, format: "float32" },
              ],
            },
          ],
        },
        fragment: {
          module,
          entryPoint: "fragmentMain",
          targets: [{ format: this.context._format }],
        },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: {
          format: "depth32float",
          depthWriteEnabled: true,
          depthCompare: "greater",
        },
      };
      this._pipeline = await device.createRenderPipelineAsync(descriptor);
      this._pipelineNoCull = await device.createRenderPipelineAsync({
        ...descriptor,
        label: "WGS84 two-sided terrain",
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
    } finally {
      validationError = await device.popErrorScope();
    }
    this.context._checkAlive();
    if (validationError) {
      throw new RuntimeError(
        `WebGPU Globe validation: ${validationError.message}`,
      );
    }
  }

  _createBuffer(size, usage, contents, label) {
    const buffer = this._device.createBuffer({
      size: Math.ceil(size / 4) * 4,
      usage,
      mappedAtCreation: contents !== undefined,
      label,
    });
    ++this.statistics.buffersCreated;
    this.statistics.bufferBytes += buffer.size;
    try {
      if (contents !== undefined) {
        new Uint8Array(buffer.getMappedRange()).set(
          new Uint8Array(
            contents.buffer,
            contents.byteOffset,
            contents.byteLength,
          ),
        );
        buffer.unmap();
      }
    } catch (error) {
      this._destroyBuffer(buffer);
      throw error;
    }
    return buffer;
  }

  _destroyBuffer(buffer) {
    if (buffer) {
      buffer.destroy();
      ++this.statistics.buffersDestroyed;
      this.statistics.bufferBytes -= buffer.size;
    }
  }

  createTile(mesh) {
    const decoded = decodeTerrainMesh(mesh);
    let indices = decoded.indices;
    if (indices instanceof Uint8Array) {
      indices = new Uint16Array(indices);
    }
    const vertex = this._createBuffer(
      decoded.vertices.byteLength,
      GPUBufferUsage.VERTEX,
      decoded.vertices,
      "Globe RTC vertices",
    );
    let index;
    try {
      index = this._createBuffer(
        indices.byteLength,
        GPUBufferUsage.INDEX,
        indices,
        "Globe terrain indices and skirts",
      );
    } catch (error) {
      this._destroyBuffer(vertex);
      throw error;
    }
    let destroyed = false;
    return {
      vertex,
      index,
      indexFormat: indices instanceof Uint32Array ? "uint32" : "uint16",
      indexCount: indices.length,
      indexCountWithoutSkirts: mesh.indexCountWithoutSkirts,
      destroy: () => {
        if (!destroyed) {
          destroyed = true;
          this._destroyBuffer(vertex);
          this._destroyBuffer(index);
        }
      },
    };
  }

  beginFrame() {
    this._draws.length = 0;
    this.statistics.drawCalls = 0;
    this.statistics.triangles = 0;
  }

  addTile(tile, rectangle) {
    this._draws.push({ tile, rectangle });
  }

  render(scene) {
    this.context.render(
      (pass) => this._draw(pass, scene),
      scene.backgroundColor,
    );
  }

  _draw(pass, scene) {
    const count = this._draws.length;
    if (count === 0) {
      return;
    }
    if (
      !this._uniformBuffer ||
      this._uniformBuffer.size < count * this._uniformStride
    ) {
      const capacity = 2 ** Math.ceil(Math.log2(count));
      const replacement = this._createBuffer(
        capacity * this._uniformStride,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        undefined,
        "Globe per-draw uniforms",
      );
      try {
        const values = new Float32Array(replacement.size / 4);
        const bindings = this._device.createBindGroup({
          layout: this._tileLayout,
          entries: [
            { binding: 0, resource: { buffer: replacement, size: 96 } },
          ],
        });
        this._destroyBuffer(this._uniformBuffer);
        this._uniformBuffer = replacement;
        this._uniformValues = values;
        this._tileBindings = bindings;
      } catch (error) {
        this._destroyBuffer(replacement);
        throw error;
      }
    }
    const color = scene.globe.baseColor;
    for (let i = 0; i < count; ++i) {
      const { tile, rectangle } = this._draws[i];
      const offset = (i * this._uniformStride) / 4;
      const matrix = computeRelativeViewProjection(
        scene.camera,
        tile.data.mesh.center,
        this._matrix,
      );
      for (let j = 0; j < 16; ++j) {
        this._uniformValues[offset + j] = matrix[j];
      }
      this._uniformValues.set(
        [
          (rectangle.west - tile.rectangle.west) / tile.rectangle.width,
          (rectangle.south - tile.rectangle.south) / tile.rectangle.height,
          (rectangle.east - tile.rectangle.west) / tile.rectangle.width,
          (rectangle.north - tile.rectangle.south) / tile.rectangle.height,
          color.red,
          color.green,
          color.blue,
          color.alpha,
        ],
        offset + 16,
      );
    }
    this._device.queue.writeBuffer(
      this._uniformBuffer,
      0,
      this._uniformValues.buffer,
      0,
      count * this._uniformStride,
    );
    pass.setPipeline(
      scene.globe.backFaceCulling && !scene.cameraUnderground
        ? this._pipeline
        : this._pipelineNoCull,
    );
    for (let i = 0; i < count; ++i) {
      const gpu = this._draws[i].tile.data.gpu;
      pass.setBindGroup(0, this._tileBindings, [i * this._uniformStride]);
      pass.setVertexBuffer(0, gpu.vertex);
      pass.setIndexBuffer(gpu.index, gpu.indexFormat);
      const indexCount = scene.globe.showSkirts
        ? gpu.indexCount
        : gpu.indexCountWithoutSkirts;
      pass.drawIndexed(indexCount);
      ++this.statistics.drawCalls;
      this.statistics.triangles += indexCount / 3;
    }
  }

  destroy() {
    if (!this._destroyed) {
      this._destroyed = true;
      this._destroyBuffer(this._uniformBuffer);
      this._uniformBuffer = undefined;
      this._tileBindings = undefined;
      this._pipeline = undefined;
      this._pipelineNoCull = undefined;
      this._draws.length = 0;
    }
  }
}

export default WebGPUGlobeRenderer;
