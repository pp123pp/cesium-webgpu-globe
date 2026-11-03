/* global window, GPUAdapter, GPUDevice, GPUBufferUsage, GPUMapMode, performance */

// Benchmark-only feature negotiation. The shipping renderer does not require
// optional timestamp support and keeps working on adapters without it.
export async function enableSolarTiming(page) {
  await page.evaluate(() => {
    const original = GPUAdapter.prototype.requestDevice;
    window.__solarRestoreRequestDevice = () => { GPUAdapter.prototype.requestDevice = original; };
    GPUAdapter.prototype.requestDevice = function (descriptor = {}) {
      window.__solarAdapterFeatures = Array.from(this.features);
      const requiredFeatures = new Set(descriptor.requiredFeatures ?? []);
      if (this.features.has("timestamp-query")) { requiredFeatures.add("timestamp-query"); }
      return original.call(this, { ...descriptor, requiredFeatures: [...requiredFeatures] });
    };
  });
}

export async function measureSolarGpu(page, samples = 30) {
  return page.evaluate(async (samples) => {
    const { viewer } = window.__m1;
    const device = viewer.scene.context._device;
    const renderer = viewer.scene._atmosphere;
    const adapterFeatures = Array.from(viewer.scene.context._adapter.features);
    if (!device.features.has("timestamp-query")) {
      return { status: "UNVERIFIED", adapterFeatures, deviceFeatures: Array.from(device.features),
        reason: "timestamp-query was unavailable to the benchmark device" };
    }
    const original = device.createCommandEncoder;
    const saved = { bloom: renderer.bloomStrength, effects: { ...renderer.solarEffects } };
    const queries = device.createQuerySet({ type: "timestamp", count: 32 });
    const resolved = device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let names = [];
    device.createCommandEncoder = function (descriptor) {
      const encoder = original.call(this, descriptor);
      const begin = encoder.beginRenderPass;
      const finish = encoder.finish;
      encoder.beginRenderPass = function (passDescriptor) {
        const index = names.length;
        if (index >= 16) { throw new Error("Solar timing query capacity exceeded"); }
        names.push(passDescriptor.label ?? "opaque terrain");
        return begin.call(this, { ...passDescriptor, timestampWrites: {
          querySet: queries, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1,
        } });
      };
      encoder.finish = function (finishDescriptor) {
        const count = names.length * 2;
        encoder.resolveQuerySet(queries, 0, count, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, readback, 0, count * 8);
        return finish.call(this, finishDescriptor);
      };
      return encoder;
    };
    const before = { ...renderer.statistics };
    const results = { baseline: [], solarWithoutBloom: [], allEnabled: [] };
    const configure = (mode) => {
      renderer.bloomStrength = mode === "allEnabled" ? saved.bloom : 0;
      for (const key of Object.keys(renderer.solarEffects)) {
        renderer.solarEffects[key] = mode === "baseline" ? 0 : saved.effects[key];
      }
    };
    const one = async () => {
      names = [];
      const start = performance.now();
      viewer.render();
      await readback.mapAsync(GPUMapMode.READ);
      const stamps = new BigUint64Array(readback.getMappedRange()).slice(0, names.length * 2);
      readback.unmap();
      const passes = names.map((name, i) => ({ name, gpuMs: Number(stamps[i * 2 + 1] - stamps[i * 2]) / 1e6 }));
      if (passes.some((pass) => !Number.isFinite(pass.gpuMs) || pass.gpuMs < 0)) {
        throw new Error("Invalid GPU timestamp interval");
      }
      return { passes, gpuPassSumMs: passes.reduce((sum, pass) => sum + pass.gpuMs, 0),
        gpuFrameSpanMs: Number(stamps.at(-1) - stamps[0]) / 1e6,
        wallRenderAndMapMs: performance.now() - start };
    };
    try {
      // Alternate modes to reduce warm-up/thermal/order bias. GPU durations come
      // from pass timestamps, not performance.now() or queue completion latency.
      for (let iteration = -6; iteration < samples; iteration++) {
        const modes = iteration % 2 ? ["baseline", "solarWithoutBloom", "allEnabled"] : ["allEnabled", "solarWithoutBloom", "baseline"];
        for (const mode of modes) {
          configure(mode);
          const value = await one();
          if (iteration >= 0) { results[mode].push(value); }
        }
      }
    } finally {
      device.createCommandEncoder = original;
      renderer.bloomStrength = saved.bloom;
      Object.assign(renderer.solarEffects, saved.effects);
      queries.destroy(); resolved.destroy(); readback.destroy();
    }
    const summarize = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)] };
    };
    const summaries = Object.fromEntries(Object.entries(results).map(([mode, values]) => [mode, {
      gpuPassSumMs: summarize(values.map((v) => v.gpuPassSumMs)),
      gpuFrameSpanMs: summarize(values.map((v) => v.gpuFrameSpanMs)),
      wallRenderAndMapMs: summarize(values.map((v) => v.wallRenderAndMapMs)),
      passCount: values[0].passes.length,
    }]));
    return { status: "MEASURED", adapterFeatures, deviceFeatures: Array.from(device.features),
      resolution: [viewer.canvas.width, viewer.canvas.height], samplesPerMode: samples,
      summaries, samples: results,
      incrementalBloomGpuMs: summaries.allEnabled.gpuPassSumMs.mean - summaries.solarWithoutBloom.gpuPassSumMs.mean,
      incrementalAllEffectsGpuMs: summaries.allEnabled.gpuPassSumMs.mean - summaries.baseline.gpuPassSumMs.mean,
      rendererAllocationsDuringMeasurement: {
        textures: renderer.statistics.texturesCreated - before.texturesCreated,
        buffers: renderer.statistics.buffersCreated - before.buffersCreated,
      },
      profilingResources: { querySetsCreated: 1, querySetsDestroyed: 1, buffersCreated: 2, buffersDestroyed: 2 },
      allocatedTexturePayloadBytes: renderer.statistics.solarAssetBytes + renderer.statistics.bloomTextureBytes,
      physicalResidentVram: "UNVERIFIED: WebGPU exposes no portable resident VRAM counter",
    };
  }, samples);
}

// Count actual native allocations, not just the renderer's self-reported
// counters. Byte estimates are logical payload sizes, never resident VRAM.
export async function trackSolarAllocations(page) {
  await page.evaluate(() => {
    window.__solarAllocations = [];
    for (const kind of ["Texture", "Buffer"]) {
      const method = `create${  kind}`;
      const original = GPUDevice.prototype[method];
      GPUDevice.prototype[method] = function (descriptor) {
        const resource = original.call(this, descriptor);
        const bytes = kind === "Buffer" ? resource.size : resource.width * resource.height * resource.depthOrArrayLayers *
          ({ r8unorm: 1, rgba16float: 8, rgba32float: 16 }[resource.format] ?? 4);
        const row = { kind, label: descriptor.label ?? "", bytes, destroyed: false, destroyCalls: 0 };
        window.__solarAllocations.push(row);
        const destroy = resource.destroy;
        resource.destroy = function () {
          row.destroyCalls++;
          row.destroyed = true;
          return destroy.call(this);
        };
        return resource;
      };
    }
  });
}
