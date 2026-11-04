/* global window, document, Cesium, navigator, requestAnimationFrame, performance, fetch */
// B2 round-two matched evidence. Run the identical script on BEFORE and AFTER.
// M1_OUTPUT (or B2_OUTPUT) selects a new output directory; B2_PHASE labels it.
// This entry point captures the baseline matrix. The extended entry point imports
// these exact reset/capture helpers for orbit, occlusion and continuous evidence.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { enableSolarTiming, measureSolarGpu } from "./m2-solar-gpu-timing.mjs";

export const fullEffects = { rays: 1, softHalo: 1, wideHalo: 1, corona: 1, tint: 1 };
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const scriptFile = fileURLToPath(import.meta.url);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const assetRoot = "packages/engine/Source/Assets/Textures/WebGPU/Solar/";

async function provenance(extraScripts = []) {
  const files = git("ls-files", "packages/engine/Source/Scene/WebGPU*.js", assetRoot)
    .split(/\r?\n/).filter(Boolean);
  const helpers = [scriptFile, ...extraScripts, ...[
    "m1-browser-harness.mjs", "m0-browser-config.mjs", "m2-sun-fixtures.mjs",
    "m2-atmosphere-fixtures.mjs", "m2-solar-gpu-timing.mjs",
  ].map((file) => path.join(path.dirname(scriptFile), file))];
  const hashes = {};
  for (const file of [...files, ...helpers]) {
    hashes[path.relative(process.cwd(), path.resolve(file)).replaceAll("\\", "/")] = sha256(await readFile(file));
  }
  return { commit: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"),
    status: git("status", "--porcelain=v1"), trackedDiffSha256: sha256(git("diff", "HEAD", "--binary")),
    node: process.version, platform: process.platform, architecture: process.arch, hashes };
}

export async function runB2Capture(suite, run, { extraScripts = [], beforeInstall } = {}) {
  const phase = process.env.B2_PHASE;
  assert.ok(["before", "after"].includes(phase), "Set B2_PHASE=before or after");
  process.env.M0_GPU_MODE ??= "hardware";
  process.env.M0_REQUIRE_PHYSICAL_GPU = "1";
  process.env.M1_OUTPUT = process.env.B2_OUTPUT ?? process.env.M1_OUTPUT ?? `Build/b2-round2/${phase}/${suite}`;
  const output = path.resolve(process.env.M1_OUTPUT);
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, "Choose an empty output directory; evidence is never overwritten");
  const source = await provenance(extraScripts);
  await runM1BrowserSuite(`b2-round2-${suite}`, async (context) => {
    const { page, report, base } = context;
    report.phase = phase;
    report.captureProtocol = "B2-round2-v1";
    report.provenance = source;
    report.networkFailures = [];
    page.on("requestfailed", (request) => report.networkFailures.push({ url: request.url(), error: request.failure() }));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await enableSolarTiming(page);
    await beforeInstall?.(page);
    await installM1Scene(page);
    report.productionDefaults = await page.evaluate(() => {
      const scene = window.__m1.viewer.scene;
      window.__b2GpuErrors = [];
      scene.context._device.addEventListener("uncapturederror", (event) => window.__b2GpuErrors.push(String(event.error)));
      return { bloomStrength: scene._atmosphere.bloomStrength, solarEffects: { ...scene._atmosphere.solarEffects } };
    });
    assert.equal(report.productionDefaults.bloomStrength, 0.35, "Production Bloom default changed");
    assert.deepEqual(report.productionDefaults.solarEffects, fullEffects);
    const probe = await installSunProbe(page);
    report.shaderDiagnostics = { sun: probe.sun.shaderDiagnostics, atmosphere: probe.atmosphere.shaderDiagnostics };
    assert.deepEqual(Object.values(report.shaderDiagnostics).flat().filter((row) => row.type === "error"), []);
    report.servedAssets = [];
    for (const file of Object.keys(source.hashes).filter((file) => file.startsWith(`${assetRoot}GPU/`))) {
      const response = await fetch(new URL(`Build/CesiumUnminified/Assets/Textures/WebGPU/Solar/GPU/${path.basename(file)}`, base));
      assert.equal(response.ok, true, `Asset did not serve: ${file}`);
      const hash = sha256(new Uint8Array(await response.arrayBuffer()));
      report.servedAssets.push({ file, sha256: hash });
      assert.equal(hash, source.hashes[file], `Served asset differs from this checkout: ${file}`);
    }
    await page.evaluate((fullEffects) => {
      const { viewer } = window.__m1;
      const scene = viewer.scene;
      const vector = (v) => [v.x, v.y, v.z];
      const originalTerrain = window.__m2Sun.originalTerrain;
      const atmosphereDefaults = { ...window.__m2Atmosphere.defaults };
      window.__b2Reset = (options = {}) => {
        // Every independent case starts from all five layers and Bloom enabled.
        // No diagnostic or previous scene can leak settings into the next case.
        if (viewer.terrainProvider !== originalTerrain) { viewer.terrainProvider = originalTerrain; }
        Object.assign(scene.sun, window.__m2Sun.defaults, { show: true, glowStrength: 0.08, glowRadius: 0.05 });
        Object.assign(scene.atmosphere, atmosphereDefaults, { show: true });
        Object.assign(scene._atmosphere.solarEffects, fullEffects);
        scene._atmosphere.bloomStrength = 0.35;
        scene.exposure = 1;
        scene.moon.show = true;
        scene.stars.show = true;
        scene.globe.show = true;
        scene.backgroundColor = Cesium.Color.clone(Cesium.Color.BLACK);
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(options.time ?? "2026-03-20T12:00:00Z");
        viewer.resize();
        viewer.camera.frustum = new Cesium.PerspectiveFrustum({
          fov: Cesium.Math.toRadians(options.fov ?? 60), aspectRatio: viewer.canvas.width / viewer.canvas.height,
          near: 0.1, far: 500000000,
        });
        const height = options.height ?? 400000;
        const elevation = options.limbOffset !== undefined
          ? window.__m2Sun.limbElevation(height) + options.limbOffset : options.elevation ?? 60;
        window.__m2Sun.setElevation(height, elevation);
        if (options.offAxis) { viewer.camera.lookRight(Cesium.Math.toRadians(options.offAxis)); }
        viewer.camera.update(Cesium.SceneMode.SCENE3D);
        scene.exposure = options.exposure ?? 1;
        Object.assign(scene._atmosphere.solarEffects, options.effects ?? {});
        scene._atmosphere.bloomStrength = options.bloom ?? 0.35;
        window.__b2Intent = { ...options, height, elevation, reset: "all-components-1-bloom-0.35" };
        viewer.render();
      };
      window.__b2State = () => {
        const camera = viewer.camera;
        const renderer = scene._atmosphere;
        const imagery = [];
        for (let i = 0; i < viewer.imageryLayers.length; i++) {
          const layer = viewer.imageryLayers.get(i);
          const provider = layer.imageryProvider;
          imagery.push({ type: provider?.constructor.name, url: provider?.url ?? provider?._url,
            ready: provider?.ready, show: layer.show, alpha: layer.alpha });
        }
        return { frame: scene._frameState.frameNumber, browser: navigator.userAgent,
          viewport: [window.innerWidth, window.innerHeight], canvas: [viewer.canvas.width, viewer.canvas.height],
          resolutionScale: viewer.resolutionScale, devicePixelRatio: window.devicePixelRatio,
          time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime), clockShouldAnimate: viewer.clock.shouldAnimate,
          camera: { positionWC: vector(camera.positionWC), directionWC: vector(camera.directionWC),
            upWC: vector(camera.upWC), rightWC: vector(camera.rightWC), height: camera.positionCartographic.height,
            cartographic: [camera.positionCartographic.longitude, camera.positionCartographic.latitude, camera.positionCartographic.height],
            heading: camera.heading, pitch: camera.pitch, roll: camera.roll,
            fov: camera.frustum.fov, fovDegrees: Cesium.Math.toDegrees(camera.frustum.fov),
            fovy: camera.frustum.fovy, aspectRatio: camera.frustum.aspectRatio, near: camera.frustum.near, far: camera.frustum.far },
          sun: { ...scene.sun }, solarEffects: { ...renderer.solarEffects }, bloomStrength: renderer.bloomStrength,
          exposure: scene.exposure, atmosphere: { ...scene.atmosphere }, moon: { ...scene.moon }, stars: { ...scene.stars },
          nativeSun: vector(window.__m2Sun.nativeSun()), sunProjection: window.__m2Sun.project(window.__m2Sun.nativeSun()),
          sunInFront: Cesium.Cartesian3.dot(camera.directionWC, window.__m2Sun.nativeSun()) > 0,
          adapter: window.__m1.adapterInfo, adapterIsFallback: scene.context._adapter.info.isFallbackAdapter ?? scene.context._adapter.isFallbackAdapter ?? null,
          deviceFeatures: Array.from(scene.context._device.features), adapterFeatures: Array.from(scene.context._adapter.features),
          providers: { terrain: { type: viewer.terrainProvider?.constructor.name, ready: viewer.terrainProvider?.ready }, imagery },
          loadState: { tilesLoaded: scene.globe.tilesLoaded, statistics: scene.debugStatistics,
            solarAssetRecords: renderer.solarAssetRecords, solarAssetError: renderer._solarAssetError ?? null,
            solarStatistics: { ...renderer.statistics }, providerErrors: [...window.__m1.providerErrors] },
          contexts: [...new Set(window.__m1.contexts)], renderErrors: [...window.__m1.errors], gpuErrors: [...window.__b2GpuErrors] };
      };
      window.__b2Image = () => {
        // Render and copy the current swap texture in one task, before discard.
        viewer.render();
        const canvas = document.createElement("canvas");
        canvas.width = viewer.canvas.width;
        canvas.height = viewer.canvas.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(viewer.canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { canvas, pixels };
      };
    }, fullEffects);
    report.scenes = [];
    const checkpoint = async () => writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2));
    const settle = async () => page.evaluate(async () => {
      const { viewer } = window.__m1;
      let stable = 0;
      const started = performance.now();
      for (let frame = 0; frame < 360; frame++) {
        viewer.render();
        const stats = viewer.scene.debugStatistics;
        stable = viewer.scene.globe.tilesLoaded && stats.imagery.pendingRequests === 0 ? stable + 1 : 0;
        if (stable >= 4) {
          await viewer.scene.context._device.queue.onSubmittedWorkDone();
          return { frames: frame + 1, elapsedMs: performance.now() - started, settled: true };
        }
        await new Promise(requestAnimationFrame);
      }
      // Save an unsettled frame and flag it instead of silently dropping it.
      return { frames: 360, elapsedMs: performance.now() - started, settled: false };
    });
    const capture = async (name, { intent = {}, settled, extra = {} } = {}) => {
      const result = await page.evaluate(() => {
        const { canvas, pixels } = window.__b2Image();
        const state = window.__b2State();
        let clipped = 0, white = 0, luma = 0;
        for (let i = 0; i < pixels.data.length; i += 4) {
          const [r, g, b] = pixels.data.subarray(i, i + 3);
          if (r >= 254 || g >= 254 || b >= 254) { clipped++; }
          if (r >= 250 && g >= 250 && b >= 250) { white++; }
          luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        return { png: canvas.toDataURL("image/png").split(",")[1], state,
          photometry: { clippedChannelFraction: clipped / (pixels.width * pixels.height),
            whiteFraction: white / (pixels.width * pixels.height), meanLuma: luma / (pixels.width * pixels.height * 255) } };
      });
      const png = Buffer.from(result.png, "base64");
      const filename = `${name}.png`;
      await writeFile(path.join(output, filename), png);
      delete result.png;
      const row = { name, filename, sha256: sha256(png), bytes: png.length, intent, settled, ...result, ...extra };
      report.scenes.push(row);
      await checkpoint();
      assert.deepEqual(row.state.renderErrors, [], `${name}: render errors`);
      assert.deepEqual(row.state.gpuErrors, [], `${name}: GPU errors`);
      assert.equal(row.state.loadState.solarAssetError, null, `${name}: fallback assets are not accepted`);
      assert.equal(row.state.loadState.solarAssetRecords.length, 9);
      assert.ok(row.state.loadState.solarAssetRecords.every((asset) => asset.status === "LOADED"));
      assert.ok(!row.state.contexts.some((kind) => /webgl/i.test(kind)));
      if (settled) { assert.equal(settled.settled, true, `${name}: unsettled frame retained for investigation`); }
      return row;
    };
    const scene = async (name, options = {}, size = [1920, 1080]) => {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.evaluate((options) => window.__b2Reset(options), options);
      const row = await capture(name, { intent: options, settled: await settle() });
      assert.deepEqual(row.state.canvas, size, `${name}: actual drawing buffer size`);
      assert.ok(Math.abs(row.state.camera.fovDegrees - (options.fov ?? 60)) < 1e-10, `${name}: actual FOV`);
      assert.equal(row.state.exposure, options.exposure ?? 1);
      assert.deepEqual(row.state.solarEffects, { ...fullEffects, ...options.effects });
      assert.equal(row.state.bloomStrength, options.bloom ?? 0.35);
      return row;
    };
    await run({ ...context, scene, capture, settle, checkpoint });
    await scene("gpu-timing-state-full-60", { fov: 60 });
    report.gpuTiming = await measureSolarGpu(page, 30);
    report.provenanceEnd = await provenance(extraScripts);
    assert.deepEqual(report.provenanceEnd.hashes, source.hashes, "Source or capture scripts changed during capture");
    report.checks.push("explicit state reset for each case; production Bloom=0.35; actual WebGPU PNG hashes; matched served assets");
    await checkpoint();
  });
}

export async function captureBaseline({ scene, report }) {
  for (const offAxis of [0, 15]) {
    for (const exposure of [0.5, 1, 2]) {
      await scene(`normal-60-${offAxis ? "offaxis" : "centered"}-exposure-${exposure}`, { fov: 60, offAxis, exposure });
    }
  }
  const diagnostics = [
    ["halo-only", { rays: 0, softHalo: 1, wideHalo: 1, corona: 0, tint: 0 }, 0],
    ["corona-only", { rays: 0, softHalo: 0, wideHalo: 0, corona: 1, tint: 0 }, 0],
    ["halo-corona", { rays: 0, softHalo: 1, wideHalo: 1, corona: 1, tint: 1 }, 0],
    ["full", fullEffects, 0.35],
    ["corona-off", { corona: 0 }, 0.35],
    ["halo-off", { softHalo: 0, wideHalo: 0 }, 0.35],
    ["bloom-off", {}, 0],
  ];
  for (const [name, effects, bloom] of diagnostics) {
    await scene(`diagnostic-12-${name}`, { fov: 12, effects, bloom });
  }
  await scene("actual-resize-1280x720-full", { fov: 60 }, [1280, 720]);
  await scene("actual-resize-restored-1920x1080-full", { fov: 60 });
  report.checks.push("6 normal 60-degree full frames; 7 matched 12-degree diagnostics; actual 1280x720 resize and restoration");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  await runB2Capture("baseline", captureBaseline);
}
