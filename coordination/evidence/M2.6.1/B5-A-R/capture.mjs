/* global window, console, Cesium */
import assert from "node:assert/strict";
import process from "node:process";
import { createHash } from "node:crypto";
import WebGPUAtmosphereShader from "../../../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "../../../ci/m1-browser-harness.mjs";
import { installSunProbe } from "../../../ci/m2-sun-fixtures.mjs";
import { installB4Probe, captureB4 } from "../../../ci/m2.6.1-b4-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b5-a-r-diagnostic";
await runM1BrowserSuite("m2.6.1-b5-a-r-diagnostic", async ({ page, report, output }) => {
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const loadedShader = await page.evaluate(() => Cesium.WebGPUAtmosphereShader);
  report.productionShaderSha256 = sha(loadedShader);
  assert.equal(report.productionShaderSha256, sha(WebGPUAtmosphereShader),
    "The served bundle must contain the shader from this checkout, not another worktree");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page);
  await installB4Probe(page);
  await page.waitForFunction(() => {
    window.__m1.viewer.render();
    return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded;
  });
  const assets = await page.evaluate(() => window.__m1.viewer.scene._atmosphere.solarAssetRecords);
  assert.ok(assets.length === 9 && assets.every((asset) => asset.status === "LOADED"));
  report.solarAssets = assets;
  const cases = [
    { id: "A01", name: "high-orbit-direct-36000km-atmosphere-on", height: 36000000, elevation: 60 },
    { id: "A02", name: "high-orbit-limb-36000km-atmosphere-on", height: 36000000, limbOffset: 0.35, fov: 30 },
    { id: "A03", name: "low-orbit-sunrise-400km-atmosphere-on", height: 400000, limbOffset: 0.35 },
    { id: "A04", name: "low-orbit-low-sun-400km-atmosphere-on", height: 400000, limbOffset: 1 },
    { id: "A05", name: "near-ground-low-sun-2km-atmosphere-on", height: 2000, elevation: 3, fov: 30 },
    { id: "A06", name: "ground-day-2m-atmosphere-on", height: 2, elevation: 45 },
    { id: "A07", name: "ground-twilight-2m-atmosphere-on", height: 2, elevation: 1 },
    { id: "A08", name: "ground-night-2m-atmosphere-on", height: 2, elevation: -8, cameraElevation: 0.5, fov: 30 },
  ];
  for (const sceneCase of cases) {
    const geometry = await page.evaluate((settings) => window.__b4.view(settings), sceneCase);
    const framing = await page.evaluate(() => window.__b4.snapshot().framing);
    if (framing.earthRays > 0) {
      await page.evaluate(() => window.__m1.settle({ timeout: 60000 }));
    } else {
      await page.evaluate(async () => {
        window.__m1.viewer.render();
        await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
      });
    }
    const result = await captureB4(page, report, output, `${sceneCase.id.toLowerCase()}-all`, {
      sceneId: sceneCase.id, control: "all", geometry,
    });
    assert.deepEqual(result.errors, []);
    assert.ok(Math.abs(result.camera.heightMeters - sceneCase.height) < 0.01);
    assert.equal(result.exposure, 1);
    assert.equal(result.atmosphere.show, true);
    result.surfaceLightingEnabled = await page.evaluate(() => window.__m1.viewer.scene.globe.enableLighting);
    assert.equal(result.surfaceLightingEnabled, true);
    if (sceneCase.id === "A07") {
      assert.ok(result.metrics.surface.displayLinearLuminanceMean < 0.02,
        "A07 twilight terrain must fall toward the night ambient floor");
    }
    if (sceneCase.id === "A08") {
      assert.ok(result.metrics.surface.displayLinearLuminanceMean < 0.01,
        "A08 night-side terrain must not render at daytime base-color brightness");
    }
    for (const mode of ["physical-only", "bloom-off", "physical-no-bloom"]) {
      await page.evaluate(async (selectedMode) => {
        window.__b4.mode(selectedMode);
        await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
      }, mode);
      await captureB4(page, report, output, `${sceneCase.id.toLowerCase()}-${mode}`, { sceneId: sceneCase.id, control: mode, geometry });
    }
    if (sceneCase.id === "A01") {
      for (const effect of ["rays", "corona"]) {
        await page.evaluate(async (disabledEffect) => {
          const { viewer } = window.__m1;
          const renderer = viewer.scene._atmosphere;
          Object.assign(renderer.solarEffects, window.__b4.effects);
          renderer.solarEffects[disabledEffect] = 0;
          viewer.scene.sun.glowStrength = 0.08;
          renderer.bloomStrength = 0.35;
          viewer.render();
          await viewer.scene.context._device.queue.onSubmittedWorkDone();
        }, effect);
        await captureB4(page, report, output, `a01-effect-off-${effect}`, {
          sceneId: "A01", control: `effect-off-${effect}`, geometry,
        });
      }
      await page.evaluate(() => window.__b4.mode("all"));
    }
    if (sceneCase.id === "A02") {
      await page.evaluate(async () => {
        const { viewer } = window.__m1;
        viewer.scene.atmosphere.show = false;
        viewer.scene._atmosphere.bloomStrength = 0;
        viewer.scene.sun.glowStrength = 0;
        viewer.render();
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
      });
      await captureB4(page, report, output, "a02-atmosphere-off", {
        sceneId: "A02", control: "atmosphere-off", geometry,
      });
      await page.evaluate(async () => {
        window.__m2Atmosphere.restore();
        window.__b4.mode("all");
        await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
      });
      for (const effect of ["rays", "softHalo", "wideHalo", "corona", "tint"]) {
        await page.evaluate(async (disabledEffect) => {
          const { viewer } = window.__m1;
          const renderer = viewer.scene._atmosphere;
          Object.assign(renderer.solarEffects, window.__b4.effects);
          renderer.solarEffects[disabledEffect] = 0;
          viewer.scene.sun.glowStrength = 0.08;
          renderer.bloomStrength = 0.35;
          viewer.render();
          await viewer.scene.context._device.queue.onSubmittedWorkDone();
        }, effect);
        await captureB4(page, report, output, `a02-effect-off-${effect}`, {
          sceneId: "A02", control: `effect-off-${effect}`, geometry,
        });
      }
    }
    if (["A03", "A05", "A06", "A07"].includes(sceneCase.id)) {
      const variants = [
        ["multiple-scattering-0.5", { multipleScatteringStrength: 0.5 }],
        ["legacy-mie-80-percent", { mieScattering: 3.1968e-6, mieExtinction: 3.552e-6 }],
        ["legacy-anisotropy-0.8", { mieAnisotropy: 0.8 }],
        ["legacy-mie-70-percent-g065", { mieScattering: 2.7972e-6, mieExtinction: 3.108e-6, mieAnisotropy: 0.65 }],
        ["legacy-hazy-medium", { mieScattering: 3.996e-6, mieExtinction: 4.44e-6, mieAnisotropy: 0.8 }],
      ];
      // Each attribution image starts from the same all-effects state; do not
      // compare the first medium variant against the prior physical-no-bloom control.
      await page.evaluate(() => { window.__m2Atmosphere.restore(); window.__b4.mode("all"); });
      for (const [name, parameters] of variants) {
        await page.evaluate(async (settings) => {
          const { viewer } = window.__m1;
          Object.assign(viewer.scene.atmosphere, settings);
          viewer.render();
          await viewer.scene.context._device.queue.onSubmittedWorkDone();
        }, parameters);
        await captureB4(page, report, output, `${sceneCase.id.toLowerCase()}-${name}`, {
          sceneId: sceneCase.id, control: name, geometry, atmosphereVariant: parameters,
        });
        await page.evaluate(async () => {
          window.__m2Atmosphere.restore();
          window.__b4.mode();
          await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
        });
      }
    }
    await page.evaluate(() => window.__b4.mode("all"));
    if (["A02", "A03", "A05", "A06", "A07"].includes(sceneCase.id)) {
      for (const exposure of [0.5, 2]) {
        await page.evaluate((value) => { window.__m1.viewer.scene.exposure = value; }, exposure);
        await captureB4(page, report, output, `${sceneCase.id.toLowerCase()}-exposure-${String(exposure).replace(".", "p")}`, {
          sceneId: sceneCase.id, control: "exposure", geometry, requestedExposure: exposure,
        });
      }
      await page.evaluate(() => { window.__m1.viewer.scene.exposure = 1; });
    }
    console.log("B5-A-R diagnostic captured", sceneCase.id);
  }
  report.checks.push("Matched physical-only, Bloom-off, physical-no-Bloom and multiple-scattering diagnostic captures recorded for B5-A-R attribution.");
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.cleanup.destroyed, true);
});
