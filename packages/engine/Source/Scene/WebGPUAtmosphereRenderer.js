import { RuntimeError } from "@cesium/core";
import WebGPUAtmosphereShader from "./WebGPUAtmosphereShader.js";
import { createSunParameters, sunDisplayRadiance } from "./WebGPUSun.js";
import {
  validateAtmosphereParameters,
  atmosphereLutKey,
  generateAtmosphereLuts,
} from "./WebGPUAtmosphereModel.js";

const hiddenSun = createSunParameters({ show: false });
const hiddenMoon = { show: false, moonlightIntensity: 0 };
const hiddenStars = { show: false, intensity: 0 };

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

/** Shared depth-aware atmosphere/Sun composite and two medium LUTs. @private */
class WebGPUAtmosphereRenderer {
  constructor(context) {
    this.context = context;
    this._destroyed = false;
    this._parametersValues = new Float32Array(20);
    this.statistics = {
      frames: 0,
      sunFrames: 0,
      moonFrames: 0,
      starFrames: 0,
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
      const descriptor = {
        label: "M2 sky, Sun and terrain aerial perspective",
        layout: "auto",
        vertex: { module, entryPoint: "atmosphereVertex" },
        fragment: {
          module,
          entryPoint: "atmosphereFragment",
          targets: [{ format: this.context._format }],
        },
        primitive: { topology: "triangle-list" },
      };
      this._pipeline = await device.createRenderPipelineAsync(descriptor);
      this._sunPipeline = await device.createRenderPipelineAsync({
        ...descriptor,
        label: "M2 Sun without atmospheric transport",
        fragment: { ...descriptor.fragment, entryPoint: "sunOnlyFragment" },
      });
      this.context._checkAlive();
      if (this._destroyed) {
        throw new RuntimeError(
          "Atmosphere initialization cancelled by destroy().",
        );
      }
      this._planetBuffer = this._createBuffer(272, "M2 planet, Moon and inertial star state");
      this._parametersBuffer = this._createBuffer(
        80,
        "M2 atmosphere and Sun parameters",
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

  update(state, parameters, sun = hiddenSun, moon = hiddenMoon, stars = hiddenStars) {
    if (this._destroyed || (!parameters.show && !sun.show && !moon.show && !stars.show)) {
      return false;
    }
    // A hidden medium neither validates unused coefficients nor builds LUTs.
    // The single light intensity still drives the visible Sun in vacuum.
    const solar = sun.show ? sun : hiddenSun;
    const radiance = sun.show
      ? sunDisplayRadiance(sun, parameters.lightIntensity)
      : 0;
    if (parameters.show) {
      validateAtmosphereParameters(parameters);
    }
    const key = parameters.show
      ? atmosphereLutKey(parameters, state.planet)
      : this._lutKey;
    if (parameters.show && key !== this._lutKey) {
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
    // Keep the ABI fixed even during partial edits of a hidden medium. Its
    // unused fields must never shift the visible Sun's viewport/parameter rows.
    this._parametersValues.fill(0, 0, 12);
    if (parameters.show) {
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
      ]);
    }
    this._parametersValues.set(
      [
        this.context.drawingBufferWidth,
        this.context.drawingBufferHeight,
        parameters.show ? 1 : 0,
        sun.show ? 1 : 0,
        solar.angularRadius,
        radiance,
        solar.glowStrength,
        solar.glowRadius,
      ],
      12,
    );
    this._activePipeline = parameters.show ? this._pipeline : this._sunPipeline;
    this._atmosphereShown = parameters.show;
    this._sunShown = sun.show;
    this._moonShown = moon.show;
    this._starsShown = stars.show;
    this._device.queue.writeBuffer(this._planetBuffer, 0, state.uniformValues);
    this._device.queue.writeBuffer(
      this._parametersBuffer,
      0,
      this._parametersValues,
    );
    return true;
  }

  _composite(encoder, target, color, depth) {
    const pipeline = this._activePipeline;
    if (
      this._boundColor !== color ||
      this._boundDepth !== depth ||
      this._boundPipeline !== pipeline
    ) {
      const entries = [
        { binding: 0, resource: { buffer: this._planetBuffer } },
        { binding: 1, resource: { buffer: this._parametersBuffer } },
        { binding: 5, resource: color.createView() },
        { binding: 6, resource: depth.createView() },
      ];
      if (this._atmosphereShown) {
        entries.push(
          { binding: 2, resource: this._transmittanceTexture.createView() },
          {
            binding: 3,
            resource: this._multipleScatteringTexture.createView(),
          },
          { binding: 4, resource: this._sampler },
        );
      }
      this._bindings = this._device.createBindGroup({
        label: "M2 completed color/depth and active sky resources",
        layout: pipeline.getBindGroupLayout(0),
        entries,
      });
      this._boundColor = color;
      this._boundDepth = depth;
      this._boundPipeline = pipeline;
    }
    const pass = encoder.beginRenderPass({
      label: "M2 atmosphere and Sun composite",
      colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this._bindings);
    pass.draw(3);
    pass.end();
    if (this._atmosphereShown) {
      ++this.statistics.frames;
    }
    if (this._sunShown) {
      ++this.statistics.sunFrames;
    }
    if (this._moonShown) {
      ++this.statistics.moonFrames;
    }
    if (this._starsShown) {
      ++this.statistics.starFrames;
    }
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
    this._sunPipeline = undefined;
    this._activePipeline = undefined;
    this._sampler = undefined;
    this._boundColor = undefined;
    this._boundDepth = undefined;
    this._boundPipeline = undefined;
  }
}

export default WebGPUAtmosphereRenderer;
