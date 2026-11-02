import { RuntimeError } from "@cesium/core";
import WebGPUAtmosphereShader from "./WebGPUAtmosphereShader.js";
import {
  validateAtmosphereParameters,
  atmosphereLutKey,
  generateAtmosphereLuts,
} from "./WebGPUAtmosphereModel.js";

// The LUTs contain nonnegative finite radiance/transmittance. Convert to IEEE
// binary16 with rounding, including subnormals, without an optional GPU feature
// or requiring the newer JavaScript Float16Array API.
function encodeHalf(values) {
  const result = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!(value >= 0) || !Number.isFinite(value) || value > 65504) {
      throw new RuntimeError(
        "Atmosphere LUT exceeds finite RGBA16Float range.",
      );
    }
    if (value < 2 ** -14) {
      result[i] = Math.round(value * 2 ** 24);
    } else {
      const exponent = Math.floor(Math.log2(value));
      result[i] =
        (exponent + 15) * 1024 + Math.round((value / 2 ** exponent - 1) * 1024);
    }
  }
  return result;
}

/** Two medium LUTs and a single depth-aware atmosphere composite. @private */
class WebGPUAtmosphereRenderer {
  constructor(context) {
    this.context = context;
    this._destroyed = false;
    this._parametersValues = new Float32Array(16);
    this.statistics = {
      frames: 0,
      lutBuilds: 0,
      buffersCreated: 0,
      buffersDestroyed: 0,
      texturesCreated: 0,
      texturesDestroyed: 0,
    };
    this.composite = (encoder, target, color, depth) =>
      this._composite(encoder, target, color, depth);
  }

  async initialize() {
    const device = this.context._device;
    this._device = device;
    device.pushErrorScope("validation");
    let error;
    try {
      const module = device.createShaderModule({
        label: "M2 physical atmosphere WGSL",
        code: WebGPUAtmosphereShader,
      });
      this._pipeline = await device.createRenderPipelineAsync({
        label: "M2 sky and terrain aerial perspective",
        layout: "auto",
        vertex: { module, entryPoint: "atmosphereVertex" },
        fragment: {
          module,
          entryPoint: "atmosphereFragment",
          targets: [{ format: this.context._format }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.context._checkAlive();
      if (this._destroyed) {
        throw new RuntimeError(
          "Atmosphere initialization cancelled by destroy().",
        );
      }
      this._planetBuffer = this._createBuffer(192, "M2 planet state");
      this._parametersBuffer = this._createBuffer(
        64,
        "M2 atmosphere parameters",
      );
      this._sampler = device.createSampler({
        label: "M2 bilinear medium LUT sampler",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
    } finally {
      error = await device.popErrorScope();
    }
    this.context._checkAlive();
    if (error) {
      throw new RuntimeError(`WebGPU atmosphere validation: ${error.message}`);
    }
  }

  _createBuffer(size, label) {
    const buffer = this._device.createBuffer({
      size,
      label,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ++this.statistics.buffersCreated;
    return buffer;
  }

  _uploadLut(table, texture, label) {
    const data = encodeHalf(table.data);
    const newlyAllocated = !texture;
    if (!texture) {
      texture = this._device.createTexture({
        label,
        size: [table.width, table.height],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      ++this.statistics.texturesCreated;
    }
    try {
      this._device.queue.writeTexture(
        { texture },
        data,
        { bytesPerRow: table.width * 8 },
        [table.width, table.height],
      );
    } catch (error) {
      // A failed first upload must not leak a texture before it is assigned.
      if (newlyAllocated) {
        texture.destroy();
        ++this.statistics.texturesDestroyed;
      }
      throw error;
    }
    return texture;
  }

  update(state, parameters) {
    if (this._destroyed || !parameters.show) {
      return false;
    }
    validateAtmosphereParameters(parameters);
    const key = atmosphereLutKey(parameters, state.planet);
    if (key !== this._lutKey) {
      const tables = generateAtmosphereLuts(parameters, state.planet);
      this._transmittanceTexture = this._uploadLut(
        tables.transmittance,
        this._transmittanceTexture,
        "M2 optical transmittance LUT",
      );
      this._multipleScatteringTexture = this._uploadLut(
        tables.multipleScattering,
        this._multipleScatteringTexture,
        "M2 isotropic multiple-scattering LUT",
      );
      this._lutKey = key;
      ++this.statistics.lutBuilds;
      this.statistics.maxFeedback = tables.maxFeedback;
    }
    this._parametersValues.set([
      ...parameters.rayleighScattering,
      parameters.rayleighScaleHeight,
      parameters.mieScattering,
      parameters.mieExtinction,
      parameters.mieScaleHeight,
      parameters.mieAnisotropy,
      parameters.lightIntensity,
      parameters.multipleScatteringStrength,
      state.planet.maximumRadius,
      state.planet.atmosphereHeight,
      this.context.drawingBufferWidth,
      this.context.drawingBufferHeight,
      0,
      0,
    ]);
    this._device.queue.writeBuffer(this._planetBuffer, 0, state.uniformValues);
    this._device.queue.writeBuffer(
      this._parametersBuffer,
      0,
      this._parametersValues,
    );
    return true;
  }

  _composite(encoder, target, color, depth) {
    if (this._boundColor !== color || this._boundDepth !== depth) {
      this._bindings = this._device.createBindGroup({
        label: "M2 completed color/depth and medium LUTs",
        layout: this._pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._planetBuffer } },
          { binding: 1, resource: { buffer: this._parametersBuffer } },
          { binding: 2, resource: this._transmittanceTexture.createView() },
          {
            binding: 3,
            resource: this._multipleScatteringTexture.createView(),
          },
          { binding: 4, resource: this._sampler },
          { binding: 5, resource: color.createView() },
          { binding: 6, resource: depth.createView() },
        ],
      });
      this._boundColor = color;
      this._boundDepth = depth;
    }
    const pass = encoder.beginRenderPass({
      label: "M2 physical atmosphere composite",
      colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindings);
    pass.draw(3);
    pass.end();
    ++this.statistics.frames;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    for (const key of ["_planetBuffer", "_parametersBuffer"]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.buffersDestroyed;
        this[key] = undefined;
      }
    }
    for (const key of ["_transmittanceTexture", "_multipleScatteringTexture"]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.texturesDestroyed;
        this[key] = undefined;
      }
    }
    this._bindings = undefined;
    this._pipeline = undefined;
    this._sampler = undefined;
    this._boundColor = undefined;
    this._boundDepth = undefined;
  }
}

export default WebGPUAtmosphereRenderer;
