/* global window, Cesium */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath, URL } from "node:url";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, captureB4, hash } from "./m2.6.1-b4-fixtures.mjs";
import { enableSolarTiming, measureSolarGpu, trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";
import { classifyGpu, assertPhysicalGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";
import { runB5CLifecycle } from "./m2.6.1-b5-c-lifecycle.mjs";

const phase = process.env.B5C_PHASE ?? "candidate";
assert.ok(["baseline", "candidate"].includes(phase));
process.env.M1_OUTPUT ??= `Build/b5-c-${phase}`;
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
const { default: sourceShader } = await import(pathToFileURL(path.resolve("packages/engine/Source/Scene/WebGPUAtmosphereShader.js")));
await runM1BrowserSuite("m2.6.1-b5-c", async ({ page, report, output }) => {
  report.phase = phase;
  report.protocol = "B5-C-v1";
  report.networkFailures = [];
  report.consoleLocations = [];
  page.on("requestfailed", (request) => report.networkFailures.push({ url: request.url(), error: request.failure() }));
  page.on("console", (message) => { if (message.type() === "error") { report.consoleLocations.push(message.location()); } });
  report.harnessSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const dependencies = ["m2.6.1-b5-c-lifecycle.mjs", "m1-browser-harness.mjs", "m2-sun-fixtures.mjs", "m2-atmosphere-fixtures.mjs", "m2.6.1-b4-fixtures.mjs", "m2-solar-gpu-timing.mjs", "m0-browser-config.mjs"];
  report.harnessDependencies = Object.fromEntries(await Promise.all(dependencies.map(async (name) => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const served = await page.evaluate(() => Cesium.WebGPUAtmosphereShader);
  assert.equal(served, sourceShader, "Browser shader must match the selected checkout");
  report.productionShaderSha256 = hash(served);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await enableSolarTiming(page);
  await trackSolarAllocations(page);
  await installM1Scene(page, { baseLayer: false });
  report.adapter = await page.evaluate(() => window.__m1.adapterInfo);
  assertPhysicalGpu(classifyGpu(report.adapter), getBrowserConfiguration());
  await page.evaluate(() => {
    class BoundedEllipsoidTerrainProvider extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    window.__m1.viewer.terrainProvider = new BoundedEllipsoidTerrainProvider();
    window.__b5cGpuErrors = [];
    window.__m1.viewer.scene.context._device.addEventListener("uncapturederror", (event) => window.__b5cGpuErrors.push(String(event.error)));
  });
  await installSunProbe(page);
  await installB4Probe(page);
  await page.evaluate(() => {
    const { viewer } = window.__m1;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    window.__b4.view({ height: 400000, limbOffset: 0.6, fov: 24 });
    viewer.scene.moon.show = true;
    viewer.scene.stars.show = true;
    viewer.scene.globe.enableLighting = true;
  });
  report.fixture = { provider: "bounded native ellipsoid", maximumLevel: 8, imagery: "none", exposure: 1,
    height: 400000, limbOffsetDegrees: 0.6, fovDegrees: 24, time: "2026-03-20T12:00:00Z",
    comparison: "Fresh M2.6 versus candidate on the same bounded scene. Historical M2.6 NaturalEarth scene timings are context only." };
  report.settling = await page.evaluate(async () => {
    const { viewer, settle } = window.__m1;
    const { scene } = viewer;
    scene.atmosphere.show = false; scene.sun.show = false; scene._atmosphere.bloomStrength = 0; scene.globe.enableLighting = false;
    try { return await settle({ timeout: 60000 }); }
    finally { scene.atmosphere.show = true; scene.sun.show = true; scene._atmosphere.bloomStrength = 0.35; scene.globe.enableLighting = true; viewer.render(); }
  });
  await page.waitForFunction(() => { window.__m1.viewer.render(); return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded; });
  report.timingScene = await captureB4(page, report, output, "timing-scene");
  assert.ok(report.timingScene.terrain.selectedMeshes.length > 0);
  assert.ok(report.timingScene.terrain.selectedMeshes.every(([level]) => level <= 8));
  report.measurements = [];
  for (let batch = 0; batch < 3; batch++) {
    const timing = await measureSolarGpu(page, 30);
    report.measurements.push({ batch, ...timing });
    await writeFile(path.join(output, "timing-progress.json"), JSON.stringify(report, null, 2));
    assert.equal(timing.status, "MEASURED", "B5-C needs real GPU timestamps");
    assert.ok(timing.summaries.allEnabled.gpuPassSumMs.mean > 0);
    assert.deepEqual(timing.rendererAllocationsDuringMeasurement, { textures: 0, buffers: 0 });
  }
  report.checks.push("Three alternating 30-sample GPU timestamp batches per mode; zero renderer allocations during measurement");
  report.sceneErrors = await page.evaluate(() => ({ render: window.__m1.errors, provider: window.__m1.providerErrors }));
  assert.deepEqual(report.sceneErrors, { render: [], provider: [] });
  report.timingCleanup = await destroyM1Scene(page);
  report.timingNativeAllocations = await page.evaluate(() => window.__solarAllocations);
  assert.ok(report.timingNativeAllocations.length > 0);
  assert.ok(report.timingNativeAllocations.every((row) => row.destroyed && row.destroyCalls === 1), "Timing scene releases all native buffers/textures once");
  if (phase === "candidate") { await runB5CLifecycle(page, report, output); }
  report.gpuErrors = await page.evaluate(() => window.__b5cGpuErrors);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(report.browserConsole, []);
  report.residentVram = { value: null, reason: "WebGPU exposes no portable physical resident VRAM counter; allocation payload is not resident VRAM." };
  report.checks.push("Hardware only; exact source shader and bundle; zero browser/GPU errors; native resource cleanup");
});
