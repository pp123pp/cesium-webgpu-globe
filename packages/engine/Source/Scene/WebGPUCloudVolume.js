import { DeveloperError } from "@cesium/core";
import WebGPUCloudLayer from "./WebGPUCloudLayer.js";
import createCloudNoise from "./WebGPUCloudNoise.js";
import WebGPUCloudVolumeShader from "./WebGPUCloudVolumeShader.js";

const budgets = new Map([
  ["low", [16, 2]],
  ["medium", [32, 3]],
  ["high", [56, 5]],
]);

/** Private owner of the opt-in scene-linear cloud pass. @private */
class WebGPUCloudVolume {
  constructor(owner, ellipsoid) {
    this.owner = owner;
    this.device = owner._device;
    this.layer = new WebGPUCloudLayer({ ellipsoid });
    this.values = new Float32Array(32);
    this.module = this.device.createShaderModule({
      label: "M3 volume integration",
      code: WebGPUCloudVolumeShader,
    });
    this.parameters = this.device.createBuffer({
      label: "M3 cloud shell and weather",
      size: this.values.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const { size, data } = createCloudNoise();
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

  update(state, options, irradiance) {
    const budget = budgets.get(options.quality);
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
    const time =
      (state.time.dayNumber - 2451545) * 86400 + state.time.secondsOfDay;
    const angle =
      ((time * options.windSpeed) / state.planet.maximumRadius) % (2 * Math.PI);
    this.values.set(this.layer.update(state).uniformValues);
    this.values.set(
      [
        options.coverage,
        angle,
        Number(options.localDetail),
        options.windDirection,
      ],
      24,
    );
    this.values.set([...budget, irradiance / 10, 0], 28);
    this.device.queue.writeBuffer(this.parameters, 0, this.values);
    Object.assign(this.statistics, {
      primarySteps: budget[0],
      lightSteps: budget[1],
    });
  }

  draw(encoder, target, depth, withAir) {
    let pipeline = this.pipelines.get(withAir);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: "M3 cloud scattering",
        layout: "auto",
        vertex: { module: this.module, entryPoint: "atmosphereVertex" },
        fragment: {
          module: this.module,
          entryPoint: withAir ? "cloudAir" : "cloudVacuum",
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
      this.pipelines.set(withAir, pipeline);
    }
    if (pipeline !== this.boundPipeline || depth !== this.depth) {
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
    }
    this.statistics.width = target.width;
    this.statistics.height = target.height;
    const pass = encoder.beginRenderPass({
      label: "M3 volumetric clouds",
      colorAttachments: [
        { view: target.createView(), loadOp: "load", storeOp: "store" },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindings);
    pass.draw(3);
    pass.end();
  }

  _entries() {
    return [
      { binding: 0, resource: { buffer: this.owner._planetBuffer } },
      { binding: 1, resource: { buffer: this.owner._parametersBuffer } },
      { binding: 6, resource: this.depth.createView() },
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
    this.texture.destroy();
    this.parameters.destroy();
    this.depth = this.bindings = this.boundPipeline = undefined;
    this.statistics.textureBytes = this.statistics.bufferBytes = 0;
  }
}

export default WebGPUCloudVolume;
