/* global window, Cesium */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, captureB4, hash } from "./m2.6.1-b4-fixtures.mjs";

// Run with cwd at the independently built baseline, using this harness by its absolute path.
assert.ok(process.env.M28_CANDIDATE_REPORT, "M28_CANDIDATE_REPORT must identify the candidate smoke result.json");
const candidate = JSON.parse(await readFile(process.env.M28_CANDIDATE_REPORT, "utf8"));
process.env.M1_OUTPUT ??= "Build/m2-lens-flare-baseline";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare-independent-baseline", async ({ page, report, output }) => {
  report.candidate = { source: candidate.source, sourceStatus: candidate.sourceStatus, bundleSha256: candidate.bundleSha256, reportSha256: hash(await readFile(process.env.M28_CANDIDATE_REPORT)) };
  report.comparison = "Independent M2.6.1 bundle versus candidate Lens Flare disabled; exact native PNG bytes and scene states.";
  const sourceFile = path.resolve("packages/engine/Source/Scene/WebGPUAtmosphereShader.js");
  const { default: shader } = await import(pathToFileURL(sourceFile));
  assert.equal(await page.evaluate(() => Cesium.WebGPUAtmosphereShader), shader);
  report.productionShaderSha256 = hash(shader);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page, { baseLayer: false });
  await page.evaluate(() => {
    class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    const { viewer } = window.__m1;
    viewer.terrainProvider = new BoundedTerrain();
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.scene.globe.enableLighting = true;
  });
  await installSunProbe(page);
  await installB4Probe(page);
  await page.waitForFunction(() => { window.__m1.viewer.render(); return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded; });
  report.matches = [];
  const views = [
    ["high-front", { height: 36000000, elevation: 15, fov: 24 }],
    ["high-offaxis", { height: 36000000, elevation: 15, cameraElevation: 20, fov: 24 }],
    ["orbit-sunrise", { height: 400000, limbOffset: 0.6, fov: 24 }],
    ["earth-partial", { height: 400000, limbOffset: 0, fov: 12 }],
    ["low-orbit", { height: 400000, elevation: 15, fov: 24 }],
    ["near-horizon", { height: 2000, elevation: 0.6, fov: 24 }],
    ["ground-horizon", { height: 2, elevation: 0.6, fov: 24 }],
  ];
  for (const width of [1920, 1280]) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    await page.evaluate(() => window.__m1.viewer.resize());
    for (const [name, settings] of views) {
      await page.evaluate((settings) => window.__b4.view(settings), settings);
      await page.evaluate(async () => {
        const { viewer, settle } = window.__m1;
        const { scene } = viewer;
        if (window.__b4.snapshot().framing.earthRays === 0) {
          viewer.render(); await scene.context._device.queue.onSubmittedWorkDone(); return;
        }
        const saved = [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting];
        scene.atmosphere.show = false; scene.sun.show = false; scene._atmosphere.bloomStrength = 0; scene.globe.enableLighting = false;
        try { await settle({ timeout: 60000 }); }
        finally { [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting] = saved; viewer.render(); }
      });
      for (const exposure of [0.5, 1, 2]) {
        await page.evaluate((exposure) => { window.__m1.viewer.scene.exposure = exposure; }, exposure);
        const key = `${name}-${width}-e${exposure}-off`;
        const comparison = candidate.scenes.find((scene) => scene.name === key);
        assert.ok(comparison, `Candidate has ${key}`);
        const capture = await captureB4(page, report, output, key);
        const differences = [];
        for (const field of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain", "sun", "atmosphere"]) {
          try { assert.deepEqual(capture[field], comparison[field]); } catch { differences.push(field); }
        }
        const match = { name: key, stateDifferences: differences, baselinePngSha256: capture.pngSha256, candidatePngSha256: comparison.pngSha256, identical: capture.pngSha256 === comparison.pngSha256 };
        report.matches.push(match);
        await writeFile(path.join(output, "comparison-progress.json"), JSON.stringify(report, null, 2));
        assert.deepEqual(differences, [], `${key} baseline/candidate state must match`);
        assert.equal(match.identical, true, `${key} baseline/candidate disabled PNG must match exactly`);
      }
    }
  }
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.matches.length, 42);
  assert.deepEqual(report.browserConsole, []);
  report.checks.push("42 independently built M2.6.1/candidate disabled scene pairs, exact state and native PNG equality.");
});
