/* global window, Cesium */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { enableSolarTiming, measureSolarGpu, trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b4-atmospheric-glow";

await runM1BrowserSuite("m2.6.1-b4-atmospheric-glow", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await enableSolarTiming(page);
  await trackSolarAllocations(page);
  await installM1Scene(page);
  await installSunProbe(page);
  const state = await page.evaluate(() => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    viewer.clock.shouldAnimate = false;
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.sun.show = true;
    scene.sun.glowStrength = 0.08;
    scene.sun.glowRadius = 0.05;
    scene._atmosphere.bloomStrength = 0.35;
    return {
      adapter: window.__m1.adapterInfo,
      viewport: [viewer.canvas.width, viewer.canvas.height],
      source: window.__m1.source,
      exposure: scene.exposure,
      bloomStrength: scene._atmosphere.bloomStrength,
      solarEffects: { ...scene._atmosphere.solarEffects },
      angularRadius: scene.sun.angularRadius,
    };
  });
  report.setup = state;
  const capture = async (name, details = {}) => {
    await page.evaluate(async () => {
      const { viewer } = window.__m1;
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
    });
    await captureM1Scene(page, report, output, name, details);
  };
  const scenes = [
    { name: "high-orbit-direct", height: 400000, elevation: 60 },
    { name: "orbital-sunrise", height: 400000, limb: true, offset: 0.35 },
    { name: "low-orbit-low-sun", height: 400000, limb: true, offset: 1.0 },
    { name: "near-ground-low-sun", height: 2000, elevation: 3 },
    { name: "ground-day", height: 2, elevation: 45 },
    { name: "ground-twilight", height: 2, elevation: 1 },
    { name: "ground-night", height: 2, elevation: -8 },
  ];
  for (const sceneCase of scenes) {
    const elevation = sceneCase.limb
      ? await page.evaluate((height) => window.__m2Sun.limbElevation(height), sceneCase.height) + sceneCase.offset
      : sceneCase.elevation;
    await page.evaluate(({ height, elevation }) => {
      const { viewer } = window.__m1;
      window.__m2Sun.setElevation(height, elevation);
      viewer.scene.atmosphere.show = false;
      viewer.scene.exposure = 1;
      viewer.render();
    }, { height: sceneCase.height, elevation });
    await capture(`${sceneCase.name}-atmosphere-off`, { scene: sceneCase.name, elevation, atmosphere: false });
    await page.evaluate(() => {
      const { viewer } = window.__m1;
      viewer.scene.atmosphere.show = true;
      viewer.render();
    });
    await capture(`${sceneCase.name}-atmosphere-on`, { scene: sceneCase.name, elevation, atmosphere: true });
  }
  for (const exposure of [0.5, 1, 2]) {
    await page.evaluate((value) => {
      const { viewer } = window.__m1;
      window.__m2Sun.setElevation(400000, 0.5);
      viewer.scene.atmosphere.show = true;
      viewer.scene.exposure = value;
      viewer.render();
    }, exposure);
    await capture(`orbital-limb-exposure-${exposure}`, { exposure, atmosphere: true });
  }
  report.checks.push("Actual WebGPU canvas captures: high orbit, orbital sunrise, low orbit, near-ground low Sun, ground day/twilight/night; atmosphere off/on controls; exposure 0.5/1/2.");
  await page.evaluate(() => { window.__m1.viewer.scene.exposure = 1; window.__m1.viewer.scene.atmosphere.show = true; window.__m2Sun.setElevation(400000, 0.5); });
  report.gpuTiming = await measureSolarGpu(page, 15);
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.cleanup.destroyed, true);
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
});
