/* global Cesium, window, document, GPUDevice, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import currentSun from "../../packages/engine/Source/Scene/WebGPUSunShader.js";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { enableSolarTiming, measureSolarGpu, trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

// Test-only source substitution compiles the historical/candidate WGSL on the
// real device. No production flags, renderer changes, or fabricated pixels.
const base = "5cb8eda655314119fa5567e1b4c023e2c4217906";
const shaderPath = "packages/engine/Source/Scene/WebGPUSunShader.js";
const assetRoot = "packages/engine/Source/Assets/Textures/WebGPU/Solar/GPU";
// A reconstructed historical Sun is valid only while the rest of the runtime
// is identical to the baseline. Fail instead of silently comparing B2 code.
const allowedRuntime = new Set([shaderPath, `${assetRoot}/manifest.json`]);
for (const number of [1, 2, 3]) {
  allowedRuntime.add(`${assetRoot}/radial-rays-0${number}.r8`);
  allowedRuntime.add(`${assetRoot.replace(/GPU$/, "Rays")}/radial-rays-0${number}.svg`);
}
const changedRuntime = execFileSync("git", ["diff", "--name-only", base, "--", "packages", "Source", "Apps"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(changedRuntime.every((file) => allowedRuntime.has(file)), "B1 baseline reconstruction requires all non-B1 runtime files to remain unchanged");
const historical = (file) => execFileSync("git", ["show", `${base}:${file}`], { maxBuffer: 8 * 1024 * 1024 });
const oldModule = historical(shaderPath).toString("utf8");
const oldSun = (await import(`data:text/javascript;base64,${Buffer.from(oldModule).toString("base64")}`)).default;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replaceOnce = (text, from, to) => {
  assert.equal(text.split(from).length, 2, `unique shader fixture: ${from}`);
  return text.replace(from, to);
};
const profile = currentSun.slice(currentSun.indexOf("fn sunDiskProfile("), currentSun.indexOf("fn solarRayUv("));
assert.ok(profile.includes("return") && profile.length < 3000);
const oldDisk = "let disk = sunDiskCoverage(direction, pixelWidth);";
const newDisk = "let disk = vec3f(sunDiskCoverage(direction, pixelWidth)) * sunDiskProfile(chord);";
let diskOnly = replaceOnce(oldSun, "fn sunSkyAtPixel", `${profile}fn sunSkyAtPixel`);
diskOnly = replaceOnce(diskOnly, oldDisk, newDisk);
diskOnly = replaceOnce(diskOnly, "(vec3f(disk) + tint", "(disk + tint");
let raysOnly = replaceOnce(currentSun, profile, "");
raysOnly = replaceOnce(raysOnly, newDisk, oldDisk);
raysOnly = replaceOnce(raysOnly, "(disk + tint", "(vec3f(disk) + tint");
const variants = { baseline: oldSun, B01: diskOnly, B02: raysOnly, combined: currentSun };
const out = path.resolve(process.env.M1_OUTPUT ?? "Build/B1-continuation/comparison");
const comparisons = {};

for (const [variant, shader] of Object.entries(variants)) {
  process.env.M1_OUTPUT = path.join(out, variant);
  await runM1BrowserSuite(`m2-b1-comparison-${variant}`, async ({ page, report, output }) => {
    report.variant = variant;
    report.baselineCommit = base;
    report.solarShaderSha256 = hash(shader);
    report.assets = [];
    const useOldRays = variant === "baseline" || variant === "B01";
    for (const number of [1, 2, 3]) {
      const name = `radial-rays-0${number}.r8`;
      const bytes = useOldRays ? historical(`${assetRoot}/${name}`) : await readFile(`${assetRoot}/${name}`);
      report.assets.push({ name, bytes: bytes.length, sha256: hash(bytes), source: useOldRays ? base : report.source });
      await page.route(`**/Solar/GPU/${name}`, (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: bytes }));
    }
    await page.evaluate(({ current, selected }) => {
      const create = GPUDevice.prototype.createShaderModule;
      window.__b1ShaderReplacements = [];
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        if (descriptor.code.includes("fn sunRadiance(")) {
          if (!descriptor.code.includes(current)) { throw new Error("Browser bundle Sun does not match the source under test"); }
          window.__b1ShaderReplacements.push(descriptor.label ?? "unlabelled");
          return create.call(this, { ...descriptor, code: descriptor.code.replace(current, selected) });
        }
        return create.call(this, descriptor);
      };
    }, { current: currentSun, selected: shader });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await enableSolarTiming(page);
    await trackSolarAllocations(page);
    await installM1Scene(page, { baseLayer: false });
    await installSunProbe(page);
    await page.evaluate(() => {
      const viewer = window.__m1.viewer;
      window.__b1View = (name) => {
        const s = window.__m2Sun;
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
        viewer.clock.shouldAnimate = false;
        viewer.scene.sun.glowStrength = 0.08;
        viewer.scene.sun.glowRadius = 0.05;
        viewer.scene.atmosphere.show = true;
        viewer.scene.atmosphere.lightIntensity = 10;
        viewer.scene._atmosphere.bloomStrength = 0.35;
        Object.assign(viewer.scene._atmosphere.solarEffects, { rays: 1, softHalo: 1, wideHalo: 1, corona: 1, tint: 1 });
        const height = name === "high-orbit" ? 35786000 : 400000;
        viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(24),
          aspectRatio: viewer.canvas.width / viewer.canvas.height, near: 0.1, far: 500000000 });
        s.setElevation(height, name === "high-orbit" ? 60 : s.limbElevation(height) + (name === "limb" ? 0.05 : 2));
        if (name === "off-axis") { viewer.camera.lookRight(0.09); }
        viewer.render();
      };
      window.__b1Png = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").putImageData(image, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      };
    });
    const capture = async (name) => {
      const value = await page.evaluate(async () => {
        const { viewer, errors } = window.__m1;
        let stable = 0;
        for (let i = 0; i < 200; i++) {
          viewer.render();
          if (errors.length) { throw new Error(errors.join(";")); }
          stable = viewer.scene.globe.tilesLoaded && viewer.scene._atmosphere.statistics.solarAssetsLoaded ? stable + 1 : 0;
          if (stable >= 4) { break; }
          await new Promise(requestAnimationFrame);
        }
        if (stable < 4) { throw new Error("Comparison assets/terrain did not settle"); }
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
        const image = window.__m1.pixels();
        const s = window.__m2Sun;
        return { png: window.__b1Png(image), state: {
          time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
          position: { ...viewer.camera.positionWC }, direction: { ...viewer.camera.directionWC }, up: { ...viewer.camera.upWC },
          frustum: { fov: viewer.camera.frustum.fov, aspectRatio: viewer.camera.frustum.aspectRatio },
          viewport: [image.width, image.height], exposure: viewer.scene.exposure,
          sun: { ...viewer.scene.sun }, sunDirection: { ...s.nativeSun() }, projection: s.project(s.nativeSun()),
          terrain: viewer.terrainProvider.constructor.name, imageryLayers: viewer.imageryLayers.length,
        } };
      });
      const bytes = Buffer.from(value.png, "base64");
      const row = { name, state: value.state, pngSha256: hash(bytes) };
      await writeFile(path.join(output, `${name}.png`), bytes);
      report.scenes.push(row);
      return row;
    };
    for (const width of [1920, 1280]) {
      await page.setViewportSize({ width, height: width * 9 / 16 });
      await page.evaluate(() => window.__m1.viewer.resize());
      await page.evaluate(() => window.__b1View("low-orbit"));
      for (const exposure of [0.5, 1, 2]) {
        await page.evaluate((e) => { window.__m1.viewer.scene.exposure = e; }, exposure);
        await capture(`low-orbit-${width}-exposure-${exposure}`);
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => { window.__m1.viewer.resize(); window.__m1.viewer.scene.exposure = 1; });
    for (const name of ["high-orbit", "limb", "off-axis"]) {
      await page.evaluate((name) => window.__b1View(name), name);
      await capture(`${name}-1920-exposure-1`);
    }
    // Same camera/time/exposure for historical vs changed GPU timings.
    if (variant === "baseline" || variant === "combined") {
      await page.evaluate(() => window.__b1View("low-orbit"));
      await capture("timing-state");
      report.performance = await measureSolarGpu(page, 30);
    }
    report.replacements = await page.evaluate(() => window.__b1ShaderReplacements);
    assert.ok(report.replacements.length >= 2, "production and probe shaders must both use the selected variant");
    assert.ok(report.scenes.every(({ state }) => state.sun.angularRadius === 0.00465));
    report.lossPhases = await page.evaluate(async () => {
      const { viewer, errors } = window.__m1;
      const renderer = viewer.scene._atmosphere;
      const device = viewer.scene.context._device;
      const phases = { beforeDrain: renderer.statistics.bloomFrames };
      await device.queue.onSubmittedWorkDone();
      phases.afterDrain = renderer.statistics.bloomFrames;
      viewer.useDefaultRenderLoop = true;
      phases.afterEnable = renderer.statistics.bloomFrames;
      device.destroy();
      phases.afterDestroyCall = renderer.statistics.bloomFrames;
      await device.lost;
      phases.atLossNotification = renderer.statistics.bloomFrames;
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      phases.afterTwoAnimationFrames = renderer.statistics.bloomFrames;
      const stopped = !viewer.useDefaultRenderLoop;
      const observedErrors = [...errors];
      viewer.destroy();
      const rows = window.__solarAllocations;
      return { phases, stopped, errors: observedErrors, created: rows.length,
        destroyed: rows.filter((row) => row.destroyed).length,
        live: rows.filter((row) => !row.destroyed), renderer: { ...renderer.statistics } };
    });
    assert.equal(report.lossPhases.stopped, true);
    assert.equal(report.lossPhases.errors.length, 1);
    assert.match(report.lossPhases.errors[0], /device lost/i);
    assert.equal(report.lossPhases.phases.afterTwoAnimationFrames, report.lossPhases.phases.atLossNotification);
    assert.deepEqual(report.lossPhases.live, []);
    assert.equal(report.lossPhases.created, report.lossPhases.destroyed);
    report.checks.push("matched native-Sun views, unchanged angle, exposure/resolution matrix and balanced native teardown");
    comparisons[variant] = report.scenes;
  });
}
for (const variant of ["B01", "B02", "combined"]) {
  for (const row of comparisons[variant]) {
    const old = comparisons.baseline.find((scene) => scene.name === row.name);
    assert.ok(old, `baseline capture ${row.name}`);
    assert.deepEqual(row.state, old.state, `${variant}/${row.name}: identical camera, time, exposure, viewport and data`);
    assert.notEqual(row.pngSha256, old.pngSha256, `${variant}/${row.name}: real rendered change`);
  }
}
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "matched-state.json"), JSON.stringify({ status: "PASS", baselineCommit: base,
  method: "real browser GPU shader/three-R8 variant substitution, no image composition", comparisons }, null, 2));
