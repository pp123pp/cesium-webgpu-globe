/* global Cesium, window, document, GPUDevice, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import currentSun from "../../packages/engine/Source/Scene/WebGPUSunShader.js";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import {
  applyB1Controls, assertB1Pair, b1CaptureConfig, b1StaticCaptures,
  b1MotionCapture, diagnoseB1Canvas, b1TrackedDelta,
} from "./m2-b1-round2-fixtures.mjs";

// Deliberately a NEW evidence run. Historical B1/M2.6 evidence is never removed
// or rewritten, and a caller-selected existing output directory is rejected.
// --preview saves the compact shape/exposure/layer set and skips motion.
const preview = process.argv.includes("--preview") || process.env.B1_PREVIEW === "1";
assert.ok(process.argv.slice(2).every((argument) => argument === "--preview"), "only --preview is supported");
const beforeCommit = "f92e2a3f769a3bf64a28626496a20142d27020d9";
const b1RuntimeCommit = "59f6089bfa63212f74a2913c6d11a6d13ec0a5d9";
const shaderPath = "packages/engine/Source/Scene/WebGPUSunShader.js";
const solarRoot = "packages/engine/Source/Assets/Textures/WebGPU/Solar";
const manifestPath = `${solarRoot}/GPU/manifest.json`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
const historical = (file) => execFileSync("git", ["show", `${beforeCommit}:${file}`], { maxBuffer: 8 * 1024 * 1024 });
const allowed = new Set([shaderPath, manifestPath]);
for (const number of ["01", "02", "03"]) {
  allowed.add(`${solarRoot}/Rays/radial-rays-${number}.svg`);
  allowed.add(`${solarRoot}/GPU/radial-rays-${number}.r8`);
}
assert.equal(git("diff", "--name-only", b1RuntimeCommit, beforeCommit, "--", "packages", "Source", "Apps"), "",
  "before must be the previous B1 runtime, not the old M2.6 implementation");
assert.equal(git("ls-files", "--others", "--exclude-standard", "--", "packages", "Source", "Apps"), "",
  "before replay cannot conceal untracked runtime source");
const runtimeChanges = git("diff", "--name-only", beforeCommit, "--", "packages", "Source", "Apps").split(/\r?\n/).filter(Boolean);
assert.ok(runtimeChanges.every((file) => allowed.has(file)),
  `before replay requires unchanged non-B1 runtime: ${runtimeChanges.filter((file) => !allowed.has(file)).join(", ")}`);
const runtimeDeltaSha256 = hash(execFileSync("git", ["diff", "--binary", beforeCommit, "--", "packages", "Source", "Apps"], { maxBuffer: 32 * 1024 * 1024 }));
const oldModule = historical(shaderPath);
const oldSun = (await import(`data:text/javascript;base64,${oldModule.toString("base64")}`)).default;
const harnessFiles = await Promise.all([
  "coordination/ci/m2-b1-round2-capture.mjs", "coordination/ci/m2-b1-round2-fixtures.mjs",
  "coordination/ci/m1-browser-harness.mjs", "coordination/ci/m2-sun-fixtures.mjs",
].map(async (file) => ({ path: file, sha256: hash(await readFile(file)) })));
const sources = {};
for (const variant of ["before", "after"]) {
  const read = variant === "before" ? historical : readFile;
  const manifestBytes = await read(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const files = [{ path: shaderPath, sha256: hash(await read(shaderPath)) },
    { path: manifestPath, sha256: hash(manifestBytes) }];
  const payloads = [{ name: "manifest.json", bytes: manifestBytes, contentType: "application/json" }];
  for (const asset of manifest.assets) {
    const source = `${solarRoot}/${asset.source}`;
    const payload = `${solarRoot}/${asset.payload}`;
    const bytes = await read(payload);
    assert.equal(bytes.length, asset.byteLength, `${variant}/${payload} payload length`);
    files.push({ path: source, sha256: hash(await read(source)) }, { path: payload, sha256: hash(bytes) });
    payloads.push({ name: path.basename(payload), bytes, contentType: "application/octet-stream" });
  }
  sources[variant] = { files, payloads, shader: variant === "before" ? oldSun : currentSun };
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(process.env.M1_OUTPUT ?? `Build/B1-round2/${preview ? "preview" : "final"}-${stamp}`);
await mkdir(path.dirname(outputRoot), { recursive: true });
await mkdir(outputRoot);
const comparisons = {};

for (const variant of ["before", "after"]) {
  process.env.M1_OUTPUT = path.join(outputRoot, variant);
  await runM1BrowserSuite(`m2-b1-round2-${variant}`, async ({ page, report, output }) => {
    const source = sources[variant];
    const provenance = {
      variant, effectiveRuntimeCommit: variant === "before" ? beforeCommit : report.sourceStatus ? null : report.source,
      beforeRuntimeCommit: beforeCommit, previousB1ImplementationCommit: b1RuntimeCommit,
      renderHostCommit: report.source, renderHostSourceStatus: report.sourceStatus,
      renderHostIsDirty: Boolean(report.sourceStatus),
      bundleSha256: report.bundleSha256, shaderWgslSha256: hash(source.shader),
      runtimeChanges, runtimeDeltaSha256, sourceFiles: source.files, harnessFiles,
      browser: report.browser, browserConfiguration: report.configuration,
      method: "Actual WebGPU canvas; exact previous-B1 WGSL and solar payload replay in the same verified host bundle. No image composition.",
    };
    report.preview = preview;
    report.provenance = provenance;
    for (const payload of source.payloads) {
      await page.route(`**/Solar/GPU/${payload.name}`, (route) => route.fulfill({ status: 200,
        contentType: payload.contentType, body: payload.bytes }));
    }
    await page.evaluate(({ current, selected }) => {
      const create = GPUDevice.prototype.createShaderModule;
      window.__b1ShaderReplacements = [];
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        if (descriptor.code.includes("fn sunRadiance(")) {
          if (descriptor.code.split(current).length !== 2) {
            throw new Error("Browser bundle must contain the exact unique candidate Sun WGSL");
          }
          window.__b1ShaderReplacements.push(descriptor.label ?? "unlabelled");
          return create.call(this, { ...descriptor, code: descriptor.code.replace(current, selected) });
        }
        return create.call(this, descriptor);
      };
    }, { current: currentSun, selected: source.shader });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await installM1Scene(page, { baseLayer: false });
    await installSunProbe(page);
    await page.addScriptTag({ content: `window.__b1ApplyControls = ${applyB1Controls.toString()};\nwindow.__b1Diagnostics = ${diagnoseB1Canvas.toString()};` });
    await page.evaluate(() => {
      window.__b1Capture = async ({ config, settle }) => {
        const { viewer, errors } = window.__m1;
        const scene = viewer.scene;
        const sun = window.__m2Sun;
        viewer.useDefaultRenderLoop = false;
        viewer.clock.shouldAnimate = config.shouldAnimate;
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(config.time);
        viewer.resolutionScale = config.resolutionScale;
        viewer.useBrowserRecommendedResolution = config.useBrowserRecommendedResolution;
        viewer.resize();
        window.__b1ApplyControls(scene, config.controls);
        scene.backgroundColor = new Cesium.Color(0, 0, 0, 1);
        scene.globe.baseColor = new Cesium.Color(0.2, 0.45, 0.7, 1);
        scene.screenSpaceCameraController.enableCollisionDetection = false;
        scene.globe.maximumScreenSpaceError = 3;
        viewer.camera.frustum = new Cesium.PerspectiveFrustum({
          fov: Cesium.Math.toRadians(config.camera.fovDegrees),
          aspectRatio: config.viewport.width / config.viewport.height,
          near: config.camera.near, far: config.camera.far,
        });
        const elevation = config.camera.view === "high-orbit" ? 60 :
          sun.limbElevation(config.camera.height) + (config.camera.view === "limb" ? config.camera.elevationOffset : 2);
        sun.setElevation(config.camera.height, elevation);
        if (config.camera.yaw) { viewer.camera.lookRight(config.camera.yaw); }
        if (config.camera.pitch) { viewer.camera.lookUp(config.camera.pitch); }
        viewer.camera.update(Cesium.SceneMode.SCENE3D);
        if (settle) {
          let stable = 0;
          for (let attempt = 0; attempt < 200; attempt++) {
            viewer.render();
            if (errors.length) { throw new Error(errors.join("; ")); }
            stable = scene.globe.tilesLoaded && scene._atmosphere.statistics.solarAssetsLoaded ? stable + 1 : 0;
            if (stable >= 4) { break; }
            await new Promise(requestAnimationFrame);
          }
          if (stable < 4) { throw new Error("Solar assets/terrain did not settle"); }
        }
        // pixels() renders once and copies synchronously before the WebGPU swap
        // texture expires. Every saved sequence PNG is a newly rendered frame.
        const image = window.__m1.pixels();
        await scene.context._device.queue.onSubmittedWorkDone();
        if (errors.length) { throw new Error(errors.join("; ")); }
        const nativeSun = sun.nativeSun();
        const axis = Math.abs(nativeSun.z) < 0.9 ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.UNIT_Y;
        const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(nativeSun, axis, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const up = Cesium.Cartesian3.cross(right, nativeSun, new Cesium.Cartesian3());
        const rayPoints = [];
        for (let ring = 0; ring < 12; ring++) {
          const radius = Math.tan(scene.sun.glowRadius) * (0.2 + 0.65 * ring / 11);
          for (let angle = 0; angle < 128; angle++) {
            const theta = angle / 128 * 2 * Math.PI;
            const direction = new Cesium.Cartesian3(
              nativeSun.x + radius * (right.x * Math.cos(theta) + up.x * Math.sin(theta)),
              nativeSun.y + radius * (right.y * Math.cos(theta) + up.y * Math.sin(theta)),
              nativeSun.z + radius * (right.z * Math.cos(theta) + up.z * Math.sin(theta)));
            rayPoints.push(sun.project(direction));
          }
        }
        const scale = image.width * viewer.camera.frustum.projectionMatrix[0] / 2;
        const geometry = { center: sun.project(nativeSun), nativeSun: { ...nativeSun },
          diskRadiusPixels: Math.tan(scene.sun.angularRadius) * scale,
          glowRadiusPixels: Math.tan(scene.sun.glowRadius) * scale, elevation,
          rayPoints };
        const state = {
          time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime), shouldAnimate: viewer.clock.shouldAnimate,
          viewport: { width: image.width, height: image.height },
          resolutionScale: viewer.resolutionScale, useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
          controls: { exposure: scene.exposure, bloomStrength: scene._atmosphere.bloomStrength,
            solarEffects: { ...scene._atmosphere.solarEffects }, sun: { ...scene.sun },
            atmosphere: { ...scene.atmosphere, rayleighScattering: [...scene.atmosphere.rayleighScattering] },
            moon: { ...scene.moon }, stars: { ...scene.stars } },
          camera: { position: { ...viewer.camera.positionWC }, direction: { ...viewer.camera.directionWC },
            up: { ...viewer.camera.upWC }, right: { ...viewer.camera.rightWC },
            frustum: { fov: viewer.camera.frustum.fov, aspectRatio: viewer.camera.frustum.aspectRatio,
              near: viewer.camera.frustum.near, far: viewer.camera.frustum.far } },
          environment: { background: { ...scene.backgroundColor }, globeBaseColor: { ...scene.globe.baseColor },
            maximumScreenSpaceError: scene.globe.maximumScreenSpaceError,
            terrain: viewer.terrainProvider.constructor.name, imageryLayers: viewer.imageryLayers.length,
            mode: scene.mode, devicePixelRatio: window.devicePixelRatio },
        };
        const diagnostics = window.__b1Diagnostics(image, geometry);
        delete geometry.rayPoints;
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").putImageData(image, 0, 0);
        return { state, geometry, diagnostics,
          readiness: { tilesLoaded: scene.globe.tilesLoaded,
            solarAssetsLoaded: scene._atmosphere.statistics.solarAssetsLoaded,
            renderErrors: [...errors], renderErrorCount: errors.length,
            providerErrors: [...window.__m1.providerErrors],
            providerErrorCount: window.__m1.providerErrors.length,
            terrainProvider: viewer.terrainProvider.constructor.name },
          rendererFrame: scene._atmosphere.statistics.frames,
          rendererStatistics: { ...scene._atmosphere.statistics },
          adapter: window.__m1.adapterInfo,
          png: canvas.toDataURL("image/png").split(",")[1] };
      };
    });
    let viewport;
    let previousRendererFrame = -1;
    const capture = async (row, settle = true) => {
      if (!viewport || viewport.width !== row.config.viewport.width || viewport.height !== row.config.viewport.height) {
        await page.setViewportSize(row.config.viewport);
        viewport = row.config.viewport;
      }
      const value = await page.evaluate((input) => window.__b1Capture(input), { config: row.config, settle });
      assert.deepEqual(value.state.controls, row.config.controls, `${row.id}: exact full control reset`);
      assert.deepEqual(value.state.viewport, row.config.viewport, `${row.id}: exact canvas resolution`);
      assert.equal(value.state.shouldAnimate, false);
      assert.equal(Date.parse(value.state.time), Date.parse(row.config.time));
      assert.equal(value.readiness.renderErrorCount, 0, `${row.id}: no render errors`);
      assert.equal(value.readiness.providerErrorCount, 0, `${row.id}: no provider errors`);
      assert.equal(value.readiness.solarAssetsLoaded, true, `${row.id}: solar assets ready`);
      if (settle) { assert.equal(value.readiness.tilesLoaded, true, `${row.id}: static terrain ready`); }
      assert.ok(value.rendererFrame > previousRendererFrame, `${row.id}: a newly rendered canvas frame`);
      previousRendererFrame = value.rendererFrame;
      const bytes = Buffer.from(value.png, "base64");
      delete value.png;
      const metadata = { ...row, ...value, png: `${row.id}.png`, pngSha256: hash(bytes), provenance };
      await writeFile(path.join(output, `${row.id}.png`), bytes);
      await writeFile(path.join(output, `${row.id}.json`), JSON.stringify(metadata, null, 2));
      const summary = { id: row.id, png: metadata.png, metadata: `${row.id}.json`, pngSha256: metadata.pngSha256,
        config: row.config, state: value.state, geometry: value.geometry,
        readiness: value.readiness,
        rendererFrame: value.rendererFrame, regionalDiagnostics: value.diagnostics.regions };
      report.scenes.push(summary);
      return { ...summary, tracked: value.diagnostics.trackedRayLuminance,
        statistics: value.rendererStatistics };
    };
    const staticRows = [];
    for (const row of b1StaticCaptures(preview)) {
      staticRows.push(await capture(row));
      console.log(`B1 round2 ${variant}: ${row.id}`);
    }
    const byId = (id) => staticRows.find((row) => row.id === id);
    if (!preview) {
      assertB1Pair(byId("combined-low-1080-e1").state, byId("combined-low-720-e1").state, "resolution");
      assertB1Pair(byId("rays-low-1080-e1").state, byId("rays-low-720-e1").state, "resolution");
      assertB1Pair(byId("combined-low-1080-e1").state, byId("combined-off-axis-1080-e1").state, "orientation");
      for (const exposure of [0.5, 2]) {
        assertB1Pair(byId("combined-low-1080-e1").state, byId(`combined-low-1080-e${exposure}`).state, "exposure");
      }
    }
    comparisons[variant] = staticRows.map((row) => {
      const summary = { ...row };
      delete summary.tracked;
      delete summary.statistics;
      return summary;
    });
    if (!preview && variant === "after") {
      report.fixedState = [];
      let prior;
      for (let frame = 0; frame < 3; frame++) {
        const row = await capture({ id: `repeat-${frame}`, config: b1CaptureConfig({ view: "high-orbit" }) }, frame === 0);
        const delta = prior ? b1TrackedDelta(prior.tracked, row.tracked) : null;
        if (prior) { assertB1Pair(prior.state, row.state); assert.ok(delta.max <= 1 / 255, "fixed-state solar region must not flicker"); }
        report.fixedState.push({ id: row.id, delta });
        prior = row;
      }
      report.motion = { frames: [], method: "120 sequential saved camera/time frames at fixed exposure/resolution, then a separately settled scene transition and 40 Earth-limb samples with labelled exposure/resize controls. Every PNG is a newly rendered canvas frame; renderer frame IDs expose any intervening setup frames. Solar-tangent aligned samples exclude the disc." };
      prior = undefined;
      for (let frame = 0; frame < 160; frame++) {
        const request = b1MotionCapture(frame);
        const row = await capture(request, frame === 0 || frame === 120);
        assert.ok(row.tracked.every((value) => value !== null), "motion solar ROI must remain in the canvas");
        const delta = prior ? b1TrackedDelta(prior.tracked, row.tracked) : null;
        const continuityEligible = prior !== undefined && request.intentionalDiscontinuities.length === 0;
        report.motion.frames.push({ frame, id: row.id, rendererFrame: row.rendererFrame,
          intentionalDiscontinuities: request.intentionalDiscontinuities,
          continuityEligible, delta, statistics: row.statistics });
        prior = row;
        if (frame % 20 === 0 || frame === 159) { console.log(`B1 round2 after: saved motion frame ${frame}/159`); }
      }
      const steady = report.motion.frames.filter((row) => row.frame < 120 && row.continuityEligible);
      report.motion.steadyAlignedRegion = { transitions: steady.length,
        maximumMeanDelta: Math.max(...steady.map((row) => row.delta.mean)),
        maximumP99Delta: Math.max(...steady.map((row) => row.delta.p99)),
        previousB1Bounds: { mean: 0.03, p99: 0.2 } };
      assert.equal(steady.length, 119);
      assert.ok(steady.every((row) => row.delta.mean < 0.03 && row.delta.p99 < 0.2), "steady tracked ray region must remain within previous B1 continuity bounds");
    }
    report.replacements = await page.evaluate(() => window.__b1ShaderReplacements);
    assert.ok(report.replacements.length >= 2, "both production and probe shader modules use the chosen runtime");
    report.checks.push("complete independent state reset per image; exact before/after controls; previous B1 source replay; PNG and source provenance");
    await page.evaluate(() => window.__m1.viewer.destroy());
  });
}
const pairs = [];
for (const after of comparisons.after) {
  const before = comparisons.before.find((row) => row.id === after.id);
  assert.ok(before, `matching previous B1 image for ${after.id}`);
  assert.deepEqual(after.config, before.config);
  assertB1Pair(after.state, before.state);
  pairs.push({ id: after.id, identicalControls: true,
    before: `before/${before.png}`, after: `after/${after.png}`,
    beforeMetadata: `before/${before.metadata}`, afterMetadata: `after/${after.metadata}`,
    beforePngSha256: before.pngSha256, afterPngSha256: after.pngSha256,
    pixelFileIdentical: before.pngSha256 === after.pngSha256 });
}
for (const file of sources.after.files) {
  assert.equal(hash(await readFile(file.path)), file.sha256, `capture source changed while running: ${file.path}`);
}
await writeFile(path.join(outputRoot, "matched-state.json"), JSON.stringify({ status: "PASS", preview,
  beforeCommit, b1RuntimeCommit, outputRoot, pairs,
  limitation: "Automated evidence checks do not constitute visual acceptance. Disc pairs may be identical; B01 is allowed to remain unchanged. Rays-only retains the physical analytic disc."
}, null, 2));
console.log(`B1 round2 ${preview ? "preview" : "complete capture"}: ${outputRoot}`);
