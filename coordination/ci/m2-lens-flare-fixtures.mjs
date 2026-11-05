/* global window, Cesium, GPUDevice */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, hash } from "./m2.6.1-b4-fixtures.mjs";
import { classifyGpu, assertPhysicalGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";
import { trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";
import atmosphereShader from "../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";
import bloomShader from "../../packages/engine/Source/Scene/WebGPUSolarBloomShader.js";

export async function installLensFlareFixture(page, report) {
  report.protocol = "M2.8-B-v1";
  report.visualAcceptance = "AWAITING_REVIEW";
  report.baselineComparison = "Same candidate with Lens Flare disabled; independent M2.6.1 build comparison is a separate gate.";
  report.provenance = report.sourceStatus ? "Dirty source capture: hashes identify preliminary inputs, not committed HEAD." : "Clean source capture";
  const root = "packages/engine/Source/Scene/";
  const files = (await readdir(root)).filter((name) => /^WebGPU(?:Atmosphere|Sun|Solar|Planet|.*LensFlare)/.test(name));
  report.runtimeHashes = Object.fromEntries(await Promise.all(files.map(async (name) => [name, hash(await readFile(root + name))])));
  const harnesses = ["m2-lens-flare-fixtures.mjs", "m2-lens-flare-smoke.mjs", "m2-lens-flare-timing.mjs", "m1-browser-harness.mjs", "m2.6.1-b4-fixtures.mjs", "m2-sun-fixtures.mjs", "m2-solar-gpu-timing.mjs", "m0-browser-config.mjs"];
  report.harnessHashes = Object.fromEntries(await Promise.all(harnesses.map(async (name) => [name, hash(await readFile(`coordination/ci/${name}`))])));
  assert.equal(await page.evaluate(() => Cesium.WebGPUAtmosphereShader), atmosphereShader);
  assert.equal(await page.evaluate(() => Cesium.WebGPUSolarBloomShader), bloomShader);
  await page.evaluate(() => {
    window.__flareShaders = [];
    const create = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      window.__flareShaders.push({ label: descriptor.label ?? "", code: descriptor.code });
      return create.call(this, descriptor);
    };
  });
  await trackSolarAllocations(page);
  await installM1Scene(page, { baseLayer: false });
  report.adapter = await page.evaluate(() => window.__m1.adapterInfo);
  assertPhysicalGpu(classifyGpu(report.adapter), getBrowserConfiguration());
  await page.evaluate(() => {
    class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    const { viewer } = window.__m1;
    viewer.terrainProvider = new BoundedTerrain();
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.scene.globe.enableLighting = true;
    window.__flareErrors = [];
    viewer.scene.context._device.addEventListener("uncapturederror", (event) => window.__flareErrors.push(String(event.error)));
  });
  await installSunProbe(page);
  await installB4Probe(page);
  await page.waitForFunction(() => { window.__m1.viewer.render(); return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded; });
  assert.equal(await page.evaluate(() => window.__m1.viewer.scene._atmosphere.lensFlare.enabled), false, "Flare defaults off");
  report.fixture = { terrain: "bounded native ellipsoid meshes, plus Gaussian real mesh occluder", maximumLevel: 8, imagery: false };
  await page.evaluate(() => {
    window.__flareCompare = () => {
      const { viewer, pixels } = window.__m1;
      const flare = viewer.scene._atmosphere.lensFlare;
      const saved = flare.enabled;
      flare.enabled = false;
      const off = pixels();
      flare.enabled = true;
      const on = pixels();
      flare.enabled = false;
      const restored = pixels();
      let maximum = 0, changedPixels = 0, restoredMaximum = 0, hiddenMaximum = 0, hiddenSamples = 0;
      let cornerMaximum = 0;
      for (let i = 0; i < on.data.length; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; channel++) {
          delta = Math.max(delta, Math.abs(on.data[i + channel] - off.data[i + channel]));
          restoredMaximum = Math.max(restoredMaximum, Math.abs(restored.data[i + channel] - off.data[i + channel]));
        }
        maximum = Math.max(maximum, delta);
        const x = (i / 4) % on.width;
        const y = Math.floor(i / 4 / on.width);
        if ((x < on.width * 0.05 || x >= on.width * 0.95) && (y < on.height * 0.05 || y >= on.height * 0.95)) {
          cornerMaximum = Math.max(cornerMaximum, delta);
        }
        if (delta > 0) { changedPixels++; }
      }
      // Interior analytic Earth and real mesh receivers are sampled separately from the source disk.
      const sun = window.__m2Sun;
      for (let y = 4; y < on.height - 4; y += 16) {
        for (let x = 4; x < on.width - 4; x += 16) {
          const hidden = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) => {
            const ray = sun.rayAt(x + dx + 0.5, y + dy + 0.5);
            return Boolean(sun.earthHit(ray) || viewer.scene.globe.pick(ray, viewer.scene));
          });
          if (!hidden) { continue; }
          hiddenSamples++;
          const i = (y * on.width + x) * 4;
          for (let c = 0; c < 3; c++) { hiddenMaximum = Math.max(hiddenMaximum, Math.abs(on.data[i + c] - off.data[i + c])); }
        }
      }
      flare.enabled = saved;
      return { maximum, changedPixels, restoredMaximum, hiddenMaximum, hiddenSamples, cornerMaximum, geometry: window.__b4.diskGeometry() };
    };
  });
}

export async function settleLensFlare(page) {
  return page.evaluate(async () => {
    const { viewer, settle } = window.__m1;
    const { scene } = viewer;
    if (window.__b4.snapshot().framing.earthRays === 0 && !window.__b4.mountain) {
      viewer.render();
      await scene.context._device.queue.onSubmittedWorkDone();
      return { skyOnly: true };
    }
    const saved = [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting, scene._atmosphere.lensFlare.enabled];
    scene.atmosphere.show = false; scene.sun.show = false; scene._atmosphere.bloomStrength = 0; scene.globe.enableLighting = false; scene._atmosphere.lensFlare.enabled = false;
    try { return await settle({ timeout: 60000 }); }
    finally {
      [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting, scene._atmosphere.lensFlare.enabled] = saved;
      viewer.render();
    }
  });
}

export async function finishLensFlareReport(page, report) {
  report.shaderModules = (await page.evaluate(() => window.__flareShaders)).map(({ label, code }) => ({ label, sha256: hash(code) }));
  report.gpuErrors = await page.evaluate(() => window.__flareErrors);
  report.sceneErrors = await page.evaluate(() => ({ render: window.__m1.errors, provider: window.__m1.providerErrors }));
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(report.sceneErrors, { render: [], provider: [] });
  assert.deepEqual(report.browserConsole, []);
}
