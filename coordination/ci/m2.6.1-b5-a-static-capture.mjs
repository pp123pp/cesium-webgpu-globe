/* global window, console */
import assert from "node:assert/strict";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, captureB4 } from "./m2.6.1-b4-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b5-a-static";
await runM1BrowserSuite("m2.6.1-b5-a-static", async ({ page, report, output }) => {
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
    const result = await captureB4(page, report, output, sceneCase.name, { sceneId: sceneCase.id, geometry });
    assert.deepEqual(result.errors, []);
    assert.ok(Math.abs(result.camera.heightMeters - sceneCase.height) < 0.01);
    assert.equal(result.exposure, 1);
    assert.equal(result.atmosphere.show, true);
    console.log("B5-A captured", sceneCase.id, sceneCase.name);
  }
  report.checks.push("Eight unique static views captured from this clean main-derived WebGPU build; authored solar assets loaded.");
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.cleanup.destroyed, true);
});
