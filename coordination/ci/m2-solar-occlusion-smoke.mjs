/* global window, Cesium */
import assert from "node:assert/strict";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";

await runM1BrowserSuite("m2-solar-occlusion", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page);
  await page.evaluate(() => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    state.reset();
    Object.assign(viewer.scene.sun, { glowStrength: 0.08, glowRadius: 0.05 });
    viewer.scene._atmosphere.bloomStrength = 0.35;
    window.__m26ObserveOcclusion = () => {
      const scene = viewer.scene;
      // Same JavaScript task, same tiles/time/camera; only the Sun is toggled.
      scene.sun.show = false;
      const off = window.__m1.pixels();
      scene.sun.show = true;
      const on = window.__m1.pixels();
      let changed = 0, energy = 0, hiddenMax = 0, blocked = 0;
      const center = state.centerPixel();
      const radius = Math.ceil(Math.tan(scene.sun.glowRadius) * on.width * viewer.camera.frustum.projectionMatrix[0] / 2) + 24;
      for (let y = Math.max(0, center[1] - radius); y < Math.min(on.height, center[1] + radius); y++) {
        for (let x = Math.max(0, center[0] - radius); x < Math.min(on.width, center[0] + radius); x++) {
          const i = (y * on.width + x) * 4;
          const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(on.data[i + c] - off.data[i + c])));
          energy += delta;
          if (delta > 2) { changed++; }
          // Independent double-precision WGS84 with an explicit two-pixel
          // grazing uncertainty band, consistent with the existing M2.3 gate.
          const covered = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
            Boolean(state.earthHit(state.rayAt(x + dx + 0.5, y + dy + 0.5))));
          if (covered) { blocked++; hiddenMax = Math.max(hiddenMax, delta); }
        }
      }
      const i = (center[1] * on.width + center[0]) * 4;
      const centerDelta = [0, 1, 2].map((c) => on.data[i + c] - off.data[i + c]);
      return { changed, energy, blocked, hiddenMax, centerDelta, center };
    };
  });
  const stages = [];
  for (const fraction of [1.5, 0.4, 0, -0.4, -1.5]) {
    await page.evaluate((fraction) => {
      const state = window.__m2Sun;
      const radius = Cesium.Math.toDegrees(window.__m1.viewer.scene.sun.angularRadius);
      state.setElevation(400000, state.limbElevation(400000) + fraction * radius);
    }, fraction);
    await page.evaluate(() => window.__m1.settle());
    const value = await page.evaluate(() => window.__m26ObserveOcclusion());
    stages.push({ fraction, ...value });
    await captureM1Scene(page, report, output, `limb-${fraction}`, value);
    assert.ok(value.blocked > 0, "the fixture must contain actual Earth pixels");
    assert.ok(value.hiddenMax <= 1, "all enabled solar effects must leave blocked Earth pixels unchanged");
  }
  report.limb = stages;
  assert.ok(stages[0].energy > stages[2].energy && stages[2].energy > stages.at(-1).energy,
    "partial source-area visibility attenuates the composite, not just a center-point switch");
  assert.equal(stages.at(-1).changed, 0, "a fully Earth-hidden Sun leaves no artificial glow");
  assert.ok(stages.slice(1, 4).every((row) => row.energy > 0), "partly exposed disks retain visible energy");

  const mountain = await page.evaluate(() => window.__m2Sun.prepareMountain(5500));
  await page.evaluate(() => window.__m1.settle({ timeout: 60000 }));
  report.mountain = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const observation = window.__m26ObserveOcclusion();
    const center = state.centerPixel();
    const [gpu] = await state.probe([center]);
    const ray = state.rayAt(center[0] + 0.5, center[1] + 0.5);
    const mesh = window.__m1.viewer.scene.globe.pick(ray, window.__m1.viewer.scene);
    return { observation, gpu, analyticEarthHit: Boolean(state.earthHit(ray)), realMeshHit: Boolean(mesh) };
  });
  await captureM1Scene(page, report, output, "real-mountain-occluder", mountain);
  assert.equal(report.mountain.analyticEarthHit, false, "mountain fixture must exercise real mesh depth, not the analytic Earth mask");
  assert.equal(report.mountain.realMeshHit, true);
  assert.ok(report.mountain.gpu[7] > 0, "real terrain depth covers the solar center");
  assert.ok(report.mountain.observation.centerDelta.every((v) => Math.abs(v) <= 1), "Bloom cannot leak across a real mountain");

  await page.evaluate(() => {
    window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain;
  });
  await page.evaluate(() => window.__m1.settle());
  report.mountainRemoved = await page.evaluate(() => window.__m26ObserveOcclusion());
  assert.ok(report.mountainRemoved.centerDelta.some((v) => v > 20), "removing the mountain reveals the same native solar ray");
  await captureM1Scene(page, report, output, "mountain-removed", report.mountainRemoved);
  report.checks.push("actual partial/full Earth occultation and real terrain depth constrain Rays/Halo/Corona/Bloom together");
  report.cleanup = await destroyM1Scene(page);
});
