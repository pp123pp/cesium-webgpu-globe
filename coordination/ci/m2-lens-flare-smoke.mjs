/* global window, Cesium, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, destroyM1Scene } from "./m1-browser-harness.mjs";
import { captureB4, hash } from "./m2.6.1-b4-fixtures.mjs";
import { installLensFlareFixture, settleLensFlare, finishLensFlareReport } from "./m2-lens-flare-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-lens-flare-smoke";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installLensFlareFixture(page, report);
  report.pairs = [];
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
      await settleLensFlare(page);
      for (const exposure of [0.5, 1, 2]) {
        await page.evaluate((exposure) => { window.__m1.viewer.scene.exposure = exposure; }, exposure);
        await pair(`${name}-${width}-e${exposure}`);
      }
    }
  }
  await page.evaluate(() => {
    window.__b4.view({ height: 36000000, elevation: 15, fov: 24 });
    window.__flareSavedIrradiance = window.__m1.viewer.scene.atmosphere.lightIntensity;
    window.__m1.viewer.scene.atmosphere.lightIntensity = 0;
  });
  await settleLensFlare(page);
  report.zeroIrradiance = await pair("sun-visible-zero-irradiance-1280");
  assert.equal(report.zeroIrradiance.delta.maximum, 0, "A visible Sun with zero irradiance produces no flare");
  await page.evaluate(() => { window.__m1.viewer.scene.atmosphere.lightIntensity = window.__flareSavedIrradiance; });
  await page.evaluate(() => window.__b4.view({ height: 400000, limbOffset: -0.6, fov: 12 }));
  await settleLensFlare(page);
  report.earthHidden = await pair("earth-hidden-1280");
  assert.equal(report.earthHidden.delta.geometry.earthBlocked, report.earthHidden.delta.geometry.samples);
  assert.equal(report.earthHidden.delta.maximum, 0, "Fully Earth-hidden source leaves no Lens Flare");

  await page.evaluate(() => {
    window.__m2Sun.prepareMountain(3000);
    window.__b4.mountain = true;
    const provider = window.__m1.viewer.terrainProvider;
    const error = provider.getLevelMaximumGeometricError.bind(provider);
    provider.getLevelMaximumGeometricError = (level) => level >= 8 ? 0 : error(level);
    window.__b4.mode("all");
  });
  await settleLensFlare(page);
  report.meshHidden = await pair("mesh-hidden-1280");
  assert.equal(report.meshHidden.delta.geometry.earthBlocked, 0);
  assert.equal(report.meshHidden.delta.geometry.meshBlocked, report.meshHidden.delta.geometry.samples);
  assert.equal(report.meshHidden.delta.maximum, 0, "Fully real-mesh-hidden source leaves no Lens Flare");
  report.meshDepth = await page.evaluate(() => window.__m2Sun.probe([window.__m2Sun.centerPixel()]));
  assert.ok(report.meshDepth[0][7] > 0, "Occluding mesh writes production depth");
  await page.evaluate(() => {
    window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain;
    window.__b4.mountain = false;
  });
  await settleLensFlare(page);
  report.meshRemoved = await pair("mesh-removed-1280");
  assert.equal(report.meshRemoved.delta.geometry.meshBlocked, 0);
  assert.ok(report.meshRemoved.delta.changedPixels > 0, "Removing occluding mesh restores flare");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    window.__m1.viewer.resize();
    window.__b4.view({ height: 36000000, elevation: 15, cameraElevation: 20, fov: 24 });
  });
  await settleLensFlare(page);
  await pair("resized-back-1920");
  for (const layer of ["diffusion", "reflection"]) {
    await page.evaluate((layer) => {
      const flare = window.__m1.viewer.scene._atmosphere.lensFlare;
      flare.enabled = true;
      flare.diffusion = layer === "diffusion" ? 1 : 0;
      flare.reflection = layer === "reflection" ? 1 : 0;
    }, layer);
    await captureB4(page, report, output, `layer-${layer}-1920`, { lensFlare: await flareSettings() });
  }
  await page.evaluate(() => {
    const renderer = window.__m1.viewer.scene._atmosphere;
    Object.assign(renderer.lensFlare, { enabled: true, diffusion: 1, reflection: 1 });
    renderer.bloomStrength = 0;
  });
  const noBloom = await pair("flare-without-bloom-1920");
  assert.ok(noBloom.delta.changedPixels > 0, "Flare operates independently of Bloom strength");
  await page.evaluate(() => { window.__m1.viewer.scene._atmosphere.bloomStrength = 0.35; });
  await sequence();
  await finishLensFlareReport(page, report);
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => window.__solarAllocations);
  assert.ok(report.allocations.every((row) => row.destroyed && row.destroyCalls === 1), "All native textures/buffers released once");
  report.checks.push("Matched off/on, restored-off equality, exposure/resolution/resize, Earth and native-mesh occultation, independent layers, 120 contiguous camera/time frames, physical GPU, native resource cleanup.");
  await checkpoint();

  async function flareSettings() { return page.evaluate(() => ({ ...window.__m1.viewer.scene._atmosphere.lensFlare })); }
  async function pair(name) {
    const captures = [];
    for (const enabled of [false, true]) {
      await page.evaluate((enabled) => { window.__m1.viewer.scene._atmosphere.lensFlare.enabled = enabled; }, enabled);
      captures.push(await captureB4(page, report, output, `${name}-${enabled ? "on" : "off"}`, { lensFlare: await flareSettings() }));
    }
    const [off, on] = captures;
    for (const key of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain"]) {
      assert.deepEqual(off[key], on[key], `${name}: matched ${key}`);
    }
    const delta = await page.evaluate(() => window.__flareCompare());
    const row = { name, off: off.name, on: on.name, delta };
    report.pairs.push(row);
    await checkpoint();
    assert.equal(delta.restoredMaximum, 0, "Disabling flare restores exact candidate off pixels");
    assert.equal(delta.hiddenMaximum, 0, "Flare does not paint hidden Earth/terrain receiver samples");
    if (name.startsWith("high-front")) { assert.equal(delta.cornerMaximum, 0, "Centered-source optical support does not reach screen corners"); }
    if (name.startsWith("earth-partial")) {
      assert.ok(delta.geometry.earthBlocked > 0 && delta.geometry.clear > 0);
      assert.ok(delta.hiddenSamples > 0);
      assert.ok(delta.changedPixels > 0, "Partial Sun still produces visible flare");
    }
    return row;
  }
  async function sequence() {
    await page.evaluate(() => {
      window.__b4.view({ height: 400000, elevation: 15, fov: 24 });
      window.__m1.viewer.scene._atmosphere.lensFlare.enabled = true;
      window.__flarePrevious = undefined;
    });
    await settleLensFlare(page);
    const directory = path.join(output, "motion-120");
    await mkdir(directory);
    report.motion = { count: 120, frames: [], note: "Each actual render captured; PNG encoding paces capture, not a real-time FPS measurement. Visual temporal review remains required." };
    for (let index = 0; index < 120; index++) {
      const raw = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        const { viewer, pixels } = window.__m1;
        viewer.camera.lookRight(Cesium.Math.toRadians(0.015));
        viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1, new Cesium.JulianDate());
        viewer.camera.update(Cesium.SceneMode.SCENE3D);
        const image = pixels();
        const png = viewer.canvas.toDataURL("image/png");
        let max = 0, total = 0;
        const previous = window.__flarePrevious;
        if (previous) {
          for (let i = 0; i < image.data.length; i += 4) {
            for (let c = 0; c < 3; c++) { const d = Math.abs(image.data[i + c] - previous.data[i + c]); max = Math.max(max, d); total += d; }
          }
        }
        window.__flarePrevious = image;
        return { png, state: window.__b4.snapshot(), frame: viewer.scene._frameState.frameNumber,
          lensFlare: { ...viewer.scene._atmosphere.lensFlare }, errors: [...window.__m1.errors],
          adjacent: previous ? { maximum: max, meanAbsoluteRgbBytes: total / (image.width * image.height * 3) } : null };
      });
      const bytes = Buffer.from(raw.png.split(",")[1], "base64");
      delete raw.png;
      const frame = { index, file: `frame-${String(index).padStart(4, "0")}.png`, sha256: hash(bytes), ...raw };
      await writeFile(path.join(directory, frame.file), bytes);
      const previous = report.motion.frames.at(-1);
      report.motion.frames.push(frame);
      assert.deepEqual(frame.errors, []);
      if (previous) {
        assert.equal(frame.frame, previous.frame + 1);
        assert.notEqual(frame.state.time, previous.state.time);
        assert.notDeepEqual(frame.state.camera, previous.state.camera);
        assert.deepEqual(frame.lensFlare, previous.lensFlare);
      }
      if (index % 10 === 0) { await checkpoint(); }
    }
    await writeFile(path.join(directory, "sequence.json"), JSON.stringify(report.motion, null, 2));
  }
  async function checkpoint() { await writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2)); }
});
