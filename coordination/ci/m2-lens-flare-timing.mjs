/* global window, GPUBufferUsage, GPUMapMode */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, destroyM1Scene } from "./m1-browser-harness.mjs";
import { enableSolarTiming } from "./m2-solar-gpu-timing.mjs";
import { captureB4 } from "./m2.6.1-b4-fixtures.mjs";
import { installLensFlareFixture, settleLensFlare, finishLensFlareReport } from "./m2-lens-flare-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-lens-flare-timing";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare-timing", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await enableSolarTiming(page);
  await installLensFlareFixture(page, report);
  await page.evaluate(() => window.__b4.view({ height: 400000, limbOffset: 0.6, fov: 24 }));
  await settleLensFlare(page);
  report.timing = [];
  for (const width of [1920, 1280, 1920]) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    await page.evaluate(() => { window.__m1.viewer.resize(); window.__m1.viewer.scene._atmosphere.lensFlare.enabled = true; });
    await settleLensFlare(page);
    await captureB4(page, report, output, `timing-${width}-${report.timing.length}`);
    const row = await measureFlareGpu(page, 600);
    report.timing.push(row);
    assert.equal(row.status, "MEASURED", "Real timestamp-query measurements required");
    assert.ok(row.summary.on.gpuPassSumMs.mean > 0);
    assert.deepEqual(row.allocationChanges, { textures: 0, buffers: 0 });
    assert.equal(row.flareTextureBytes, 8, "Source visibility/HDR record occupies one rgba16float texel");
    assert.ok(row.incrementalMeanMs <= 0.5, "Incremental GPU mean meets the 0.5 ms architecture budget");
    assert.ok(row.incrementalP95Ms <= 1, "Incremental GPU p95 meets the 1 ms architecture budget");
  }
  await finishLensFlareReport(page, report);
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => window.__solarAllocations);
  assert.ok(report.allocations.length > 0);
  assert.ok(report.allocations.every((row) => row.destroyed && row.destroyCalls === 1), "All native textures and buffers released once after resize/measurement");
  report.logicalAllocations = {
    buffers: report.allocations.filter((row) => row.kind === "Buffer").length,
    textures: report.allocations.filter((row) => row.kind === "Texture").length,
    cumulativePayloadBytes: report.allocations.reduce((sum, row) => sum + row.bytes, 0),
    retainedPayloadBytes: report.allocations.filter((row) => !row.destroyed).reduce((sum, row) => sum + row.bytes, 0),
    residentVram: "UNVERIFIED: WebGPU does not expose portable resident VRAM counters",
  };
  report.checks.push("Alternating 600 timestamps per mode/resolution after 60 warmup pairs, 1080 to 720 to 1080 resize, no steady-state renderer allocations, all native resources released once.");
});

async function measureFlareGpu(page, samples) {
  return page.evaluate(async (samples) => {
    const { viewer } = window.__m1;
    const device = viewer.scene.context._device;
    const renderer = viewer.scene._atmosphere;
    if (!device.features.has("timestamp-query")) { return { status: "UNVERIFIED", reason: "Physical adapter lacks timestamp-query" }; }
    const original = device.createCommandEncoder;
    const saved = renderer.lensFlare.enabled;
    const queries = device.createQuerySet({ type: "timestamp", count: 32 });
    const resolved = device.createBuffer({ label: "M2.8 benchmark resolve", size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ label: "M2.8 benchmark readback", size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let names = [];
    device.createCommandEncoder = function (descriptor) {
      const encoder = original.call(this, descriptor);
      const begin = encoder.beginRenderPass;
      const finish = encoder.finish;
      encoder.beginRenderPass = function (passDescriptor) {
        const index = names.length;
        if (index >= 16) { throw new Error("Lens Flare timestamp capacity exceeded"); }
        names.push(passDescriptor.label ?? "opaque terrain");
        return begin.call(this, { ...passDescriptor, timestampWrites: { querySet: queries, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 } });
      };
      encoder.finish = function (descriptor) {
        const count = names.length * 2;
        encoder.resolveQuerySet(queries, 0, count, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, readback, 0, count * 8);
        return finish.call(this, descriptor);
      };
      return encoder;
    };
    const before = { ...renderer.statistics };
    const results = { off: [], on: [] };
    try {
      // A full alternating warmup lets the integrated GPU settle after resize
      // and pipeline creation before comparing the unchanged pass-sum budget.
      for (let iteration = -60; iteration < samples; iteration++) {
        for (const mode of iteration % 2 ? ["off", "on"] : ["on", "off"]) {
          renderer.lensFlare.enabled = mode === "on";
          names = [];
          viewer.render();
          await readback.mapAsync(GPUMapMode.READ);
          const stamps = new BigUint64Array(readback.getMappedRange()).slice(0, names.length * 2);
          readback.unmap();
          const passes = names.map((name, i) => ({ name, gpuMs: Number(stamps[2 * i + 1] - stamps[2 * i]) / 1e6 }));
          if (passes.some((pass) => !Number.isFinite(pass.gpuMs) || pass.gpuMs < 0)) { throw new Error("Invalid GPU timestamps"); }
          if (iteration >= 0) {
            results[mode].push({ passes, gpuPassSumMs: passes.reduce((sum, pass) => sum + pass.gpuMs, 0), gpuFrameSpanMs: Number(stamps.at(-1) - stamps[0]) / 1e6 });
          }
        }
      }
    } finally {
      device.createCommandEncoder = original;
      renderer.lensFlare.enabled = saved;
      queries.destroy(); resolved.destroy(); readback.destroy();
    }
    const summarize = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.floor(sorted.length * 0.95)] };
    };
    const summary = Object.fromEntries(Object.entries(results).map(([mode, rows]) => [mode, {
      gpuPassSumMs: summarize(rows.map((row) => row.gpuPassSumMs)),
      gpuFrameSpanMs: summarize(rows.map((row) => row.gpuFrameSpanMs)),
      passCount: rows[0].passes.length,
    }]));
    const allocations = window.__solarAllocations.filter((row) => !row.destroyed);
    return { status: "MEASURED", resolution: [viewer.canvas.width, viewer.canvas.height], samplesPerMode: samples, warmupPerMode: 60, samples: results, summary,
      incrementalMeanMs: summary.on.gpuPassSumMs.mean - summary.off.gpuPassSumMs.mean,
      incrementalP95Ms: summary.on.gpuPassSumMs.p95 - summary.off.gpuPassSumMs.p95,
      allocationChanges: { textures: renderer.statistics.texturesCreated - before.texturesCreated, buffers: renderer.statistics.buffersCreated - before.buffersCreated },
      flareTextureBytes: renderer.statistics.lensFlareTextureBytes,
      logicalLive: { buffers: allocations.filter((row) => row.kind === "Buffer").length, textures: allocations.filter((row) => row.kind === "Texture").length, payloadBytes: allocations.reduce((sum, row) => sum + row.bytes, 0) },
      comparison: "Same M2.8 candidate, flare off/on; independent M2.6.1 baseline cost requires separately rebuilt baseline." };
  }, samples);
}
