import { RuntimeError } from "@cesium/core";
import buildModuleUrl from "../Core/buildModuleUrl.js";
import WebGPUAtmosphereShader from "./WebGPUAtmosphereShader.js";
import WebGPUSolarBloomShader from "./WebGPUSolarBloomShader.js";
import { createSunParameters, sunDisplayRadiance } from "./WebGPUSun.js";
import { DEFAULT_EXPOSURE, validateExposure } from "./WebGPUColorPipeline.js";
import {
  validateAtmosphereParameters,
  atmosphereLutKey,
  generateAtmosphereLuts,
} from "./WebGPUAtmosphereModel.js";

const hiddenSun = createSunParameters({ show: false });
const hiddenMoon = { show: false, moonlightIntensity: 0 };
const hiddenStars = { show: false, intensity: 0 };
const solarAssets = [
  ["radial-rays-01", "r8", 1],
  ["radial-rays-02", "r8", 1],
  ["radial-rays-03", "r8", 1],
  ["soft-halo", "r8", 1],
  ["wide-halo", "r8", 1],
  ["corona-fine", "r8", 1],
  ["corona-mid", "r8", 1],
  ["radial-noise", "r8", 1],
  ["glow-gradient", "rgba8", 4],
];
const solarAssetSize = 512;

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

/** Shared depth-aware atmosphere/Sun, solar asset and HDR post-process owner. @private */
class WebGPUAtmosphereRenderer {
  constructor(context) {
    this.context = context;
    this._destroyed = false;
    this._parametersValues = new Float32Array(28);
    this.solarEffects = {
      rays: 1,
      softHalo: 1,
      wideHalo: 1,
      corona: 1,
      tint: 1,
    };
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
      solarAssetBytes: 0,
      solarAssetsLoaded: false,
      bloomFrames: 0,
      bloomPasses: 0,
      bloomTextureBytes: 0,
      bloomWidth: 0,
      bloomHeight: 0,
    };
    this.bloomStrength = 0.35;
    this._postParametersValues = new Float32Array(4);
    this.composite = (encoder, target, color, depth) =>
      this._composite(encoder, target, color, depth);
  }

  initialize() {
    if (!this._initializePromise) {
      this._initializePromise = this._initialize().catch((error) => {
        this.destroy();
        throw error;
      });
    }
    return this._initializePromise;
  }

  async _initialize() {
    if (this._destroyed) {
      throw new RuntimeError(
        "Atmosphere initialization cancelled by destroy().",
      );
    }
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
          entryPoint: "atmosphereLinearFragment",
          targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list" },
      };
      this._pipeline = await device.createRenderPipelineAsync(descriptor);
      this._sunPipeline = await device.createRenderPipelineAsync({
        ...descriptor,
        label: "M2 Sun without atmospheric transport",
        fragment: {
          ...descriptor.fragment,
          entryPoint: "sunOnlyLinearFragment",
        },
      });
      const bloomModule = device.createShaderModule({
        label: "M2.6 linear HDR bloom WGSL",
        code: WebGPUSolarBloomShader,
      });
      const bloomDescriptor = {
        layout: "auto",
        vertex: { module: bloomModule, entryPoint: "bloomVertex" },
        fragment: { module: bloomModule, targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      };
      this._bloomExtractPipeline = await device.createRenderPipelineAsync({
        ...bloomDescriptor,
        label: "M2.6 HDR bloom threshold and quarter-resolution downsample",
        fragment: { ...bloomDescriptor.fragment, entryPoint: "bloomExtract" },
      });
      this._bloomBlurPipeline = await device.createRenderPipelineAsync({
        ...bloomDescriptor,
        label: "M2.6 HDR bloom low-cost diagonal Kawase blur",
        fragment: { ...bloomDescriptor.fragment, entryPoint: "bloomBlur" },
      });
      this._bloomFinalPipeline = await device.createRenderPipelineAsync({
        ...bloomDescriptor,
        label: "M2.6 HDR bloom composition and ACES/sRGB output",
        fragment: {
          module: bloomModule,
          entryPoint: "bloomFinal",
          targets: [{ format: this.context._format }],
        },
      });
      this.context._checkAlive();
      if (this._destroyed) {
        throw new RuntimeError(
          "Atmosphere initialization cancelled by destroy().",
        );
      }
      this._planetBuffer = this._createBuffer(
        272,
        "M2 planet, Moon and inertial star state",
      );
      this._parametersBuffer = this._createBuffer(
        112,
        "M2 atmosphere, Sun and solar effect controls",
      );
      this._postParametersBuffer = this._createBuffer(
        16,
        "M2.6 HDR bloom exposure and strength",
      );
      this._sampler = device.createSampler({
        label: "M2 bilinear medium and solar asset sampler",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      await this._loadSolarAssets();
      if (this._destroyed) {
        throw new RuntimeError(
          "Atmosphere initialization cancelled by destroy().",
        );
      }
    } finally {
      error = await device.popErrorScope();
    }
    this.context._checkAlive();
    if (error) {
      throw new RuntimeError(`WebGPU atmosphere validation: ${error.message}`);
    }
  }

  _releaseSolarTextures() {
    for (const texture of this._solarTextures ?? []) {
      texture.destroy();
      ++this.statistics.texturesDestroyed;
    }
    this._solarTextures = [];
    this.statistics.solarAssetBytes = 0;
    this.statistics.solarAssetsLoaded = false;
    this._solarAssetsLoaded = false;
  }

  async _loadSolarAssets() {
    this._solarAbort = new AbortController();
    this._solarTextures = [];
    this.solarAssetRecords = [];
    let assetFailure;
    const createAndUpload = (name, channels, bytes, size) => {
      const format = channels === 1 ? "r8unorm" : "rgba8unorm-srgb";
      const texture = this._device.createTexture({
        label: `M2.6 solar ${name}`,
        size: [size, size],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      // Register ownership before upload: even a synchronous GPU failure must
      // release and count this allocation, rather than masquerade as a 404.
      this._solarTextures.push(texture);
      ++this.statistics.texturesCreated;
      this._device.queue.writeTexture(
        { texture },
        bytes,
        { bytesPerRow: size * channels, rowsPerImage: size },
        [size, size],
      );
      return format;
    };
    try {
      for (const [name, extension, channels] of solarAssets) {
        let bytes;
        const started = performance.now();
        try {
          const response = await fetch(
            buildModuleUrl(
              `Assets/Textures/WebGPU/Solar/GPU/${name}.${extension}`,
            ),
            { signal: this._solarAbort.signal },
          );
          if (this._destroyed) {
            return;
          }
          this.context._checkAlive();
          if (!response.ok) {
            throw new RuntimeError(
              `Solar texture ${name} returned HTTP ${response.status}.`,
            );
          }
          bytes = await response.arrayBuffer();
          if (this._destroyed) {
            return;
          }
          this.context._checkAlive();
          const expected = solarAssetSize * solarAssetSize * channels;
          if (bytes.byteLength !== expected) {
            throw new RuntimeError(
              `Solar texture ${name} has ${bytes.byteLength} bytes; expected ${
                expected
              }.`,
            );
          }
        } catch (error) {
          if (this._destroyed) {
            return;
          }
          // Device loss is not an optional-artwork failure. The context owns
          // shutdown and no new fallback allocations may use a lost device.
          this.context._checkAlive();
          assetFailure = error;
          this.solarAssetRecords.push({
            name,
            status: "FAILED",
            error: error.message,
          });
          break;
        }
        const format = createAndUpload(name, channels, bytes, solarAssetSize);
        this.statistics.solarAssetBytes += bytes.byteLength;
        this.solarAssetRecords.push({
          name,
          format,
          width: solarAssetSize,
          height: solarAssetSize,
          byteLength: bytes.byteLength,
          status: "LOADED",
          loadAndUploadMs: performance.now() - started,
        });
      }
      if (assetFailure) {
        this._releaseSolarTextures();
        this._solarAssetError = assetFailure.message;
        for (const [name, , channels] of solarAssets) {
          createAndUpload(
            `fallback ${name}`,
            channels,
            channels === 1
              ? new Uint8Array([0])
              : new Uint8Array([255, 255, 255, 255]),
            1,
          );
        }
      } else {
        this._solarAssetsLoaded = true;
        this.statistics.solarAssetsLoaded = true;
      }
    } catch (error) {
      this._releaseSolarTextures();
      throw error;
    } finally {
      this._solarAbort = undefined;
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

  update(
    state,
    parameters,
    sun = hiddenSun,
    moon = hiddenMoon,
    stars = hiddenStars,
    exposure = DEFAULT_EXPOSURE,
  ) {
    if (this._destroyed) {
      return false;
    }
    validateExposure(exposure);
    if (
      !Number.isFinite(this.bloomStrength) ||
      this.bloomStrength < 0 ||
      this.bloomStrength > 2
    ) {
      throw new RuntimeError(
        "Bloom strength must be finite and within [0, 2].",
      );
    }
    for (const [name, value] of Object.entries(this.solarEffects)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RuntimeError(
          `Solar effect ${name} must be finite and within [0, 1].`,
        );
      }
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
    this._parametersValues.set([exposure, 0, 0, this.solarEffects.tint], 20);
    this._parametersValues.set(
      [
        this.solarEffects.rays,
        this.solarEffects.softHalo,
        this.solarEffects.wideHalo,
        this.solarEffects.corona,
      ],
      24,
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
    if (this._postParametersBuffer) {
      this._postParametersValues.set([exposure, this.bloomStrength, 0, 0]);
      this._device.queue.writeBuffer(
        this._postParametersBuffer,
        0,
        this._postParametersValues,
      );
    }
    return true;
  }

  _ensurePostProcessTargets() {
    const width = this.context.drawingBufferWidth;
    const height = this.context.drawingBufferHeight;
    if (this._postWidth === width && this._postHeight === height) {
      return;
    }
    for (const key of ["_linearTexture", "_bloomTextureA", "_bloomTextureB"]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.texturesDestroyed;
      }
    }
    const bloomWidth = Math.max(1, Math.ceil(width / 4));
    const bloomHeight = Math.max(1, Math.ceil(height / 4));
    const create = (size, label) => {
      const texture = this._device.createTexture({
        label,
        size,
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      ++this.statistics.texturesCreated;
      return texture;
    };
    this._linearTexture = create(
      [width, height],
      "M2.6 scene-linear HDR composite",
    );
    this._bloomTextureA = create(
      [bloomWidth, bloomHeight],
      "M2.6 quarter-resolution HDR bloom A",
    );
    this._bloomTextureB = create(
      [bloomWidth, bloomHeight],
      "M2.6 quarter-resolution HDR bloom B",
    );
    this._postWidth = width;
    this._postHeight = height;
    this.statistics.bloomWidth = bloomWidth;
    this.statistics.bloomHeight = bloomHeight;
    this.statistics.bloomTextureBytes =
      (width * height + 2 * bloomWidth * bloomHeight) * 8;
    this._bloomExtractBindings = this._device.createBindGroup({
      layout: this._bloomExtractPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this._linearTexture.createView() }],
    });
    this._bloomBlurBindings = this._device.createBindGroup({
      layout: this._bloomBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._bloomTextureA.createView() },
        { binding: 1, resource: this._sampler },
      ],
    });
    this._bloomFinalDepth = undefined;
    this._boundColor = undefined;
    this._boundDepth = undefined;
  }

  _drawFullscreenPass(encoder, target, pipeline, bindings, label) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [
        { view: target.createView(), loadOp: "clear", storeOp: "store" },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindings);
    pass.draw(3);
    pass.end();
  }

  _composite(encoder, target, color, depth) {
    this._ensurePostProcessTargets();
    if (this._bloomFinalDepth !== depth) {
      this._bloomFinalBindings = this._device.createBindGroup({
        layout: this._bloomFinalPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this._linearTexture.createView() },
          { binding: 1, resource: this._sampler },
          { binding: 2, resource: this._bloomTextureB.createView() },
          { binding: 3, resource: { buffer: this._postParametersBuffer } },
          { binding: 4, resource: depth.createView() },
          { binding: 5, resource: { buffer: this._planetBuffer } },
        ],
      });
      this._bloomFinalDepth = depth;
    }
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
      for (let i = 0; i < this._solarTextures.length; i++) {
        entries.push({
          binding: 7 + i,
          resource: this._solarTextures[i].createView(),
        });
      }
      entries.push({ binding: 16, resource: this._sampler });
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
    this._drawFullscreenPass(
      encoder,
      this._linearTexture,
      pipeline,
      this._bindings,
      "M2 atmosphere and Sun scene-linear HDR composite",
    );
    if (this.bloomStrength > 0) {
      this._drawFullscreenPass(
        encoder,
        this._bloomTextureA,
        this._bloomExtractPipeline,
        this._bloomExtractBindings,
        "M2.6 HDR bloom threshold and downsample",
      );
      this._drawFullscreenPass(
        encoder,
        this._bloomTextureB,
        this._bloomBlurPipeline,
        this._bloomBlurBindings,
        "M2.6 HDR bloom diagonal blur",
      );
      this.statistics.bloomPasses += 2;
    }
    const finalPass = encoder.beginRenderPass({
      label: "M2.6 HDR bloom composition, ACES and sRGB output",
      colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store" }],
    });
    finalPass.setPipeline(this._bloomFinalPipeline);
    finalPass.setBindGroup(0, this._bloomFinalBindings);
    finalPass.draw(3);
    finalPass.end();
    ++this.statistics.bloomFrames;
    ++this.statistics.bloomPasses;
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
    this._solarAbort?.abort();
    for (const key of [
      "_planetBuffer",
      "_parametersBuffer",
      "_postParametersBuffer",
    ]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.buffersDestroyed;
        this[key] = undefined;
      }
    }
    this._releaseSolarTextures();
    for (const key of ["_transmittanceTexture", "_multipleScatteringTexture"]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.texturesDestroyed;
        this[key] = undefined;
      }
    }
    for (const key of ["_linearTexture", "_bloomTextureA", "_bloomTextureB"]) {
      if (this[key]) {
        this[key].destroy();
        ++this.statistics.texturesDestroyed;
        this[key] = undefined;
      }
    }
    this.statistics.bloomTextureBytes = 0;
    this.statistics.bloomWidth = 0;
    this.statistics.bloomHeight = 0;
    this._bindings = undefined;
    this._bloomExtractBindings = undefined;
    this._bloomBlurBindings = undefined;
    this._bloomFinalBindings = undefined;
    this._bloomFinalDepth = undefined;
    this._pipeline = undefined;
    this._sunPipeline = undefined;
    this._bloomExtractPipeline = undefined;
    this._bloomBlurPipeline = undefined;
    this._bloomFinalPipeline = undefined;
    this._activePipeline = undefined;
    this._sampler = undefined;
    this._boundColor = undefined;
    this._boundDepth = undefined;
    this._boundPipeline = undefined;
  }
}

export default WebGPUAtmosphereRenderer;
