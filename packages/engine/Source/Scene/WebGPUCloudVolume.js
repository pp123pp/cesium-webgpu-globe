import { DeveloperError } from "@cesium/core";
import WebGPUCloudLayer from "./WebGPUCloudLayer.js";
import decodeCloudNoise from "./WebGPUCloudNoise.js";
import WebGPUCloudVolumeShader from "./WebGPUCloudVolumeShader.js";

const budgets = new Map([
  ["low", [96, 2]],
  ["medium", [192, 4]],
  ["high", [224, 6]],
]);

/** Private owner of the opt-in scene-linear cloud pass. @private */
class WebGPUCloudVolume {
  constructor(owner, ellipsoid) {
    this.owner = owner;
    this.device = owner._device;
    this.layer = new WebGPUCloudLayer({ ellipsoid });
    this.layerWithCirrus = new WebGPUCloudLayer({
      ellipsoid,
      topHeight: 11000,
    });
    this.values = new Float32Array(40);
    this.module = this.device.createShaderModule({
      label: "M3 volume integration",
      code: WebGPUCloudVolumeShader,
    });
    this.parameters = this.device.createBuffer({
      label: "M3 cloud shell and weather",
      size: this.values.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const { size, data } = decodeCloudNoise();
    this.texture = this.device.createTexture({
      label: "M3 periodic cloud noise",
      dimension: "3d",
      size: [size, size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.texture },
      data,
      { bytesPerRow: size * 4, rowsPerImage: size },
      [size, size, size],
    );
    this.noiseView = this.texture.createView();
    this.sampler = this.device.createSampler({
      addressModeU: "repeat",
      addressModeV: "repeat",
      addressModeW: "repeat",
      minFilter: "linear",
      magFilter: "linear",
    });
    this.pipelines = new Map();
    this.statistics = {
      width: 0,
      height: 0,
      primarySteps: 0,
      lightSteps: 0,
      textureBytes: data.byteLength,
      bufferBytes: this.values.byteLength,
    };
  }

  static getStepBudget(options) {
    const budget = budgets.get(options.quality);
    const type = options.type ?? "cumulus";
    const cirrus = options.cirrus ?? false;
    const evolution = options.evolution ?? false;
    const mist = options.mist ?? false;
    if (
      (type !== "cumulus" && type !== "stratocumulus") ||
      typeof cirrus !== "boolean" ||
      typeof evolution !== "boolean" ||
      typeof mist !== "boolean"
    ) {
      throw new DeveloperError(
        "Cloud type must be cumulus or stratocumulus. Cirrus, evolution and mist must be booleans.",
      );
    }
    if (
      !budget ||
      !Number.isFinite(options.coverage) ||
      options.coverage < 0 ||
      options.coverage > 1 ||
      !Number.isFinite(options.windSpeed) ||
      !Number.isFinite(options.windDirection)
    ) {
      throw new DeveloperError(
        "Clouds require a named quality, coverage in [0,1] and finite wind.",
      );
    }
    return budget;
  }

  update(state, options, irradiance, budget) {
    const time =
      (state.time.dayNumber - 2451545) * 86400 + state.time.secondsOfDay;
    const angle =
      ((time * options.windSpeed) / state.planet.maximumRadius) % (2 * Math.PI);
    const layer = options.cirrus ? this.layerWithCirrus : this.layer;
    this.values.set(layer.update(state).uniformValues);
    this.values.set(
      [
        options.coverage,
        angle,
        Number(options.localDetail),
        options.windDirection,
      ],
      24,
    );
    this.divisor = options.quality === "high" ? 1 : 2;
    this.values.set([...budget, irradiance / 10, this.divisor], 28);
    this.values[32] = Number(options.type === "stratocumulus");
    this.values[33] = Number(options.cirrus ?? false);
    // Zero disables evolution. A three-minute phase wraps smoothly across days.
    this.values[34] = options.evolution
      ? 1 + (state.time.secondsOfDay % 180) * ((2 * Math.PI) / 180)
      : 0;
    this.values[35] = Number(options.mist ?? false);
    this.values[36] = Number(options.ambientShadows !== false);
    this.device.queue.writeBuffer(this.parameters, 0, this.values);
    Object.assign(this.statistics, {
      primarySteps: budget[0],
      lightSteps: budget[1],
    });
  }

  draw(encoder, target, depth, withAir) {
    const width = Math.ceil(target.width / this.divisor);
    const height = Math.ceil(target.height / this.divisor);
    const reduced = this.divisor > 1;
    if (
      this.lowTexture &&
      (!reduced ||
        this.lowTexture.width !== width ||
        this.lowTexture.height !== height)
    ) {
      this.lowTexture.destroy();
      this.lowTexture = this.bindings = undefined;
    }
    if (reduced && !this.lowTexture) {
      this.lowTexture = this.device.createTexture({
        label: "M3 cloud radiance and opacity",
        size: [width, height],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.bindings = undefined;
    }
    Object.assign(this.statistics, {
      width,
      height,
      textureBytes:
        this.texture.width ** 3 * 4 + (reduced ? width * height * 8 : 0),
    });
    const pipeline = this._pipeline(withAir ? "cloudAir" : "cloudVacuum");
    if (
      !this.bindings ||
      pipeline !== this.boundPipeline ||
      depth !== this.depth
    ) {
      this.depth = depth;
      this.boundPipeline = pipeline;
      const entries = this._entries();
      if (withAir) {
        entries.push(
          {
            binding: 2,
            resource: this.owner._transmittanceTexture.createView(),
          },
          {
            binding: 3,
            resource: this.owner._multipleScatteringTexture.createView(),
          },
          { binding: 4, resource: this.owner._sampler },
        );
      }
      this.bindings = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries,
      });
      this.resolveBindings = undefined;
      if (reduced) {
        this.resolvePipeline = this._pipeline(
          withAir ? "resolveCloudAir" : "resolveCloudVacuum",
        );
        this.resolveBindings = this.device.createBindGroup({
          layout: this.resolvePipeline.getBindGroupLayout(0),
          entries: [
            ...entries,
            { binding: 23, resource: this.lowTexture.createView() },
          ],
        });
      }
    }
    this._draw(
      encoder,
      this.lowTexture ?? target,
      pipeline,
      this.bindings,
      "M3 volumetric clouds",
      reduced,
    );
    if (reduced) {
      this._draw(
        encoder,
        target,
        this.resolvePipeline,
        this.resolveBindings,
        "M3 cloud reconstruction",
        false,
      );
    }
  }

  _pipeline(entryPoint) {
    let pipeline = this.pipelines.get(entryPoint);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: "M3 cloud scattering",
        layout: "auto",
        vertex: { module: this.module, entryPoint: "atmosphereVertex" },
        fragment: {
          module: this.module,
          entryPoint,
          targets: [
            {
              format: "rgba16float",
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            },
          ],
        },
      });
      this.pipelines.set(entryPoint, pipeline);
    }
    return pipeline;
  }

  _draw(encoder, target, pipeline, bindings, label, clear) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: clear ? "clear" : "load",
          clearValue: [0, 0, 0, 0],
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindings);
    pass.draw(3);
    pass.end();
  }

  _entries() {
    return [
      { binding: 0, resource: { buffer: this.owner._planetBuffer } },
      { binding: 1, resource: { buffer: this.owner._parametersBuffer } },
      { binding: 6, resource: this.depth.createView() },
      ...this.fieldEntries(),
    ];
  }

  fieldEntries() {
    return [
      { binding: 17, resource: { buffer: this.parameters } },
      { binding: 18, resource: this.noiseView },
      { binding: 19, resource: this.sampler },
    ];
  }

  // Replay one production ray outside the timed frame to observe early exits.
  async measureSteps(x, y) {
    const device = this.device;
    this.probePipeline ??= device.createComputePipeline({
      layout: "auto",
      compute: { module: this.module, entryPoint: "countCloudSteps" },
    });
    const pixel = device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const result = device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      device.queue.writeBuffer(pixel, 0, new Uint32Array([x, y]));
      const bindings = device.createBindGroup({
        layout: this.probePipeline.getBindGroupLayout(0),
        entries: [
          ...this._entries(),
          { binding: 20, resource: { buffer: pixel } },
          { binding: 21, resource: { buffer: result } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.probePipeline);
      pass.setBindGroup(0, bindings);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(result, 0, readback, 0, 8);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const [primarySteps, lightSteps] = new Uint32Array(
        readback.getMappedRange(),
      );
      return { primarySteps, lightSteps };
    } finally {
      readback.destroy();
      result.destroy();
      pixel.destroy();
    }
  }

  destroy() {
    this.lowTexture?.destroy();
    this.texture.destroy();
    this.parameters.destroy();
    this.depth = this.bindings = this.boundPipeline = undefined;
    this.statistics.textureBytes = this.statistics.bufferBytes = 0;
  }
}

export default WebGPUCloudVolume;
