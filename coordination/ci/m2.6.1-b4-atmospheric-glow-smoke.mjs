/* global window */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, captureB4, fileHashes } from "./m2.6.1-b4-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b4-round2";
const harnessRoot = fileURLToPath(new URL("../../", import.meta.url));
const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

await runM1BrowserSuite("m2.6.1-b4-round2", async ({ page, report, output }) => {
  report.provenance = {
    role: process.env.B4_ROLE ?? "candidate",
    runtimeCommit: report.source,
    runtimeTree: git(process.cwd(), ["rev-parse", "HEAD:packages/engine/Source"]),
    runtimeStatus: report.sourceStatus,
    harnessCommit: git(harnessRoot, ["rev-parse", "HEAD"]),
    harnessStatus: git(harnessRoot, ["status", "--porcelain"]),
    runtimeFiles: await fileHashes(process.cwd(), [
      "packages/engine/Source/Scene/WebGPUSunShader.js",
      "packages/engine/Source/Scene/WebGPUAtmosphereShader.js",
      "packages/engine/Source/Scene/WebGPUSolarBloomShader.js",
      "package.json",
    ]),
    harnessFiles: await fileHashes(harnessRoot, [
      "coordination/ci/m2.6.1-b4-atmospheric-glow-smoke.mjs",
      "coordination/ci/m2.6.1-b4-fixtures.mjs",
      "coordination/ci/m2-sun-fixtures.mjs",
      "coordination/ci/m2-atmosphere-fixtures.mjs",
      "coordination/ci/m1-browser-harness.mjs",
      "coordination/ci/m0-browser-config.mjs",
    ]),
    buildCommand: "npm run build", node: process.version, platform: process.platform,
    captureMethod: "unmodified 1920x1080 WebGPU canvas PNG, synchronously exported after rendering",
    imagery: "none; deterministic ellipsoid base color, real heightmap mesh for terrain case",
  };
  assert.equal(report.sourceStatus, "", "Capture runtime must be a clean committed checkout");
  assert.equal(report.provenance.harnessStatus, "", "Capture harness must be committed");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page);
  await installB4Probe(page);
  await page.waitForFunction(() => {
    window.__m1.viewer.render();
    return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded;
  });
  const assets = await page.evaluate(() => window.__m1.viewer.scene._atmosphere.solarAssetRecords);
  assert.ok(assets.length === 9 && assets.every((asset) => asset.status === "LOADED"), "Authored assets must actually load");
  report.solarAssets = assets;
  const settle = async () => {
    const framing = await page.evaluate(() => window.__b4.snapshot().framing);
    if (framing.earthRays > 0) { return page.evaluate(() => window.__m1.settle({ timeout: 60000 })); }
    return page.evaluate(async () => {
      window.__m1.viewer.render();
      await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
    });
  };
  const view = async (settings) => {
    const geometry = await page.evaluate((settings) => window.__b4.view(settings), settings);
    await settle();
    return geometry;
  };
  const mode = (name) => page.evaluate((name) => window.__b4.mode(name), name);
  const capture = async (name, details = {}) => {
    const result = await captureB4(page, report, output, name, details);
    assert.deepEqual(result.errors, []);
    console.log(`B4 captured ${  name}`);
    return result;
  };
  const horizon = (result) => {
    assert.ok(result.framing.skyRays > 0 && result.framing.earthRays > 0,
      `${result.name  } must contain sky and Earth, not an empty Sun-only or underground view`);
    assert.ok(result.terrain.selectedMeshes.length > 0 && result.terrain.tilesLoaded);
  };
  const belowHorizonControl = async (name) => {
    const observation = await page.evaluate(async () => {
      const value = await window.__b4.occlusion();
      const visibleSkyPixels = [[960, 250], [960, 500]];
      return { ...value, visibleSkyPixels, visibleSky: await window.__m2Sun.probe(visibleSkyPixels) };
    });
    assert.ok(observation.maxDelta <= 1, "Hidden Sun must not leave decorative light in the night/twilight frame");
    assert.ok(observation.visibleSky.every((row) => row.slice(0, 3).every((v) => Math.abs(v) <= 1e-6)));
    await mode("sun-off");
    await capture(name);
    await mode("all");
    return observation;
  };
  // Preserve failure evidence for the old camera setups without publishing
  // their invalid views as new acceptance images.
  report.reproducedFramingDefects = [];
  for (const old of [
    { name: "old-orbital-limb", height: 400000, elevation: 0.5 },
    { name: "old-ground-night", height: 2, elevation: -8 },
  ]) {
    await page.evaluate((settings) => window.__b4.view(settings), old);
    const snapshot = await page.evaluate(() => window.__b4.snapshot());
    report.reproducedFramingDefects.push({ name: old.name, ...snapshot });
  }
  assert.equal(report.reproducedFramingDefects[0].framing.earthRays, 0);
  assert.equal(report.reproducedFramingDefects[1].framing.skyRays, 0);
  report.checks.push("Old exposure and night framing failures reproduced geometrically.");

  const cases = [
    { name: "high-orbit-direct-36000km", height: 36000000, elevation: 60 },
    { name: "high-orbit-limb-36000km", height: 36000000, limbOffset: 0.35, fov: 30, horizon: true },
    { name: "low-orbit-sunrise-400km", height: 400000, limbOffset: 0.35, horizon: true },
    { name: "low-orbit-low-sun-400km", height: 400000, limbOffset: 1, horizon: true },
    { name: "near-ground-low-sun-2km", height: 2000, elevation: 3, fov: 30, horizon: true },
    { name: "ground-day-2m", height: 2, elevation: 45 },
    { name: "ground-twilight-2m", height: 2, elevation: 1, horizon: true },
    { name: "ground-night-2m", height: 2, elevation: -8, cameraElevation: 0.5, fov: 30, horizon: true },
    { name: "ground-facing-day-2km", height: 2000, elevation: 45, groundFacing: true, fov: 60 },
    { name: "ground-facing-terminator-2km", height: 2000, elevation: 0, groundFacing: true, fov: 60 },
    { name: "ground-facing-night-2km", height: 2000, elevation: -8, groundFacing: true, fov: 60 },
  ];
  for (const sceneCase of cases) {
    const geometry = await view(sceneCase);
    for (const atmosphere of [false, true]) {
      await page.evaluate((show) => { window.__m1.viewer.scene.atmosphere.show = show; }, atmosphere);
      const result = await capture(`${sceneCase.name  }-atmosphere-${  atmosphere ? "on" : "off"}`, { geometry });
      assert.ok(Math.abs(result.camera.heightMeters - sceneCase.height) < 0.01);
      if (sceneCase.horizon) { horizon(result); }
      if (sceneCase.name === "ground-night-2m") {
        assert.ok(result.sun.elevationDegrees < -7.99 && result.camera.elevationDegrees > 0);
      }
    }
    if (sceneCase.name === "ground-night-2m") {
      report.nightResidual = await belowHorizonControl("ground-night-2m-sun-off");
    }
  }
  report.checks.push("Distinct 36000 km/400 km/2 km/2 m views; valid night horizon and downward day/terminator/night; atmosphere off/on.");

  const limb = await view({ height: 400000, limbOffset: 0.35 });
  let exposureIdentity;
  for (const exposure of [0.5, 1, 2]) {
    await page.evaluate((value) => { window.__m1.viewer.scene.exposure = value; }, exposure);
    const result = await capture(`orbital-limb-exposure-${  exposure}`, { geometry: limb });
    horizon(result);
    assert.ok(result.sun.projectedCenter[0] > 0 && result.sun.projectedCenter[0] < result.viewport[0]);
    assert.ok(result.sun.projectedCenter[1] > 0 && result.sun.projectedCenter[1] < result.viewport[1]);
    const identity = { camera: result.camera, time: result.time, sun: result.sun, atmosphere: result.atmosphere,
      solarEffects: result.solarEffects, bloomStrength: result.bloomStrength };
    if (exposureIdentity) { assert.deepEqual(identity, exposureIdentity); }
    exposureIdentity = identity;
  }
  report.checks.push("Limb exposure 0.5/1/2: same camera/time/settings, Sun + sky + real Earth pixels.");

  // Independent camera directions retain the same below-horizon Sun state.
  for (const elevation of [-1, -4]) {
    const geometry = await view({ height: 2, elevation, cameraElevation: 0.5, fov: 30 });
    const result = await capture(`ground-transition-sun-${  elevation}`, { geometry });
    horizon(result);
    if (elevation === -4) {
      report.twilightResidual = await belowHorizonControl("ground-transition-sun--4-sun-off");
    }
  }

  const twilight = await view({ height: 2, elevation: 1 });
  report.twilight = {};
  for (const effectMode of ["all", "physical-only", "bloom-off", "physical-no-bloom"]) {
    await mode(effectMode);
    const result = await capture(`twilight-${  effectMode}`, { geometry: twilight });
    const samples = await page.evaluate(async () => {
      const sun = window.__m2Sun;
      const center = sun.centerPixel();
      const radius = window.__b4.diskGeometry().radiusPixels;
      const pixels = [center, [Math.floor(center[0] + 2 * radius), center[1]], [200, 150], [200, 950]];
      return { pixels, rows: await sun.probe(pixels) };
    });
    report.twilight[effectMode] = { camera: result.camera, time: result.time, exposure: result.exposure,
      metrics: result.metrics, samples };
  }
  const twilightReference = report.twilight.all;
  for (const row of Object.values(report.twilight)) {
    assert.deepEqual(row.camera, twilightReference.camera);
    assert.equal(row.time, twilightReference.time);
    assert.equal(row.exposure, twilightReference.exposure);
  }
  report.checks.push("Matched twilight all / artwork-off / Bloom-off / artwork-and-Bloom-off with production-WGSL component readback.");

  const partial = await view({ height: 400000, limbOffset: 0 });
  report.partialEarth = await page.evaluate(() => window.__b4.occlusion());
  assert.ok(report.partialEarth.geometry.earthBlocked > 0 && report.partialEarth.geometry.clear > 0);
  assert.ok(report.partialEarth.hiddenSamples > 0 && report.partialEarth.hiddenMax <= 1);
  assert.ok(report.partialEarth.changedPixels > 0);
  for (const effectMode of ["all", "physical-only", "bloom-off", "sun-off"]) {
    await mode(effectMode);
    await capture(`earth-partial-${  effectMode}`, { geometry: partial });
  }

  await mode("all");
  const mountain = await page.evaluate(() => {
    const fixture = window.__m2Sun.prepareMountain(3000);
    window.__b4.mountain = true;
    window.__m1.viewer.scene.atmosphere.show = true;
    return fixture;
  });
  await settle();
  report.terrainFull = await page.evaluate(() => window.__b4.occlusion());
  const terrain = report.terrainFull;
  assert.equal(terrain.geometry.earthBlocked, 0, "The WGS84 mask must not be the mountain occluder");
  assert.equal(terrain.geometry.meshBlocked, terrain.geometry.samples, "The real mesh must cover the entire sampled disk");
  assert.ok(terrain.gpu.every((row) => row[7] > 0 && row.slice(0, 3).every((v) => Math.abs(v) <= 1e-6)),
    "Native terrain depth must suppress the production solar radiance at every probe");
  assert.equal(terrain.changedPixels, 0, "A fully hidden solar source must leave no artwork or Bloom residue");
  for (const effectMode of ["all", "physical-only", "bloom-off", "sun-off"]) {
    await mode(effectMode);
    await capture(`terrain-full-${  effectMode}`, { geometry: mountain });
  }
  await page.evaluate(() => {
    window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain;
    window.__b4.mountain = false;
    window.__b4.mode("all");
  });
  await settle();
  report.terrainRemoved = await page.evaluate(() => window.__b4.occlusion());
  assert.equal(report.terrainRemoved.geometry.earthBlocked, 0);
  assert.equal(report.terrainRemoved.geometry.meshBlocked, 0);
  assert.ok(report.terrainRemoved.gpu[0].slice(0, 3).some((v) => v > 0.1));
  await capture("terrain-removed-all", { geometry: mountain });
  report.checks.push("Partial Earth disk; all sampled disk rays blocked by actual terrain but not WGS84; matched effect controls and mesh-removal positive control.");

  report.visualAcceptance = "AWAITING_USER_REVIEW";
  report.knownIssues = ["Physical twilight color/contrast and other visual limitations require manual source-attributed review; no final visual acceptance is inferred from this technical suite."];
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.cleanup.destroyed, true);
  console.log(`B4 round2 capture complete: ${  report.scenes.length  } raw PNGs.`);
});
