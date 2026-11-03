/* global window, document, Cesium */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b1-solar-disc-rays";

await runM1BrowserSuite("m2.6.1-b1-solar-disc-rays", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page);
  await installSunProbe(page);
  const setup = await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    const scene = viewer.scene;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(4),
      aspectRatio: viewer.canvas.width / viewer.canvas.height,
      near: 0.1,
      far: 500000000,
    });
    window.__m2Sun.setElevation(400000, 60);
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.atmosphere.show = true;
    scene.sun.show = true;
    scene.sun.glowStrength = 0.08;
    scene.sun.glowRadius = 0.05;
    scene.exposure = 0.5;
    scene._atmosphere.bloomStrength = 0;
    return {
      viewport: [viewer.canvas.width, viewer.canvas.height],
      cameraHeight: viewer.camera.positionCartographic.height,
      time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
      angularRadius: scene.sun.angularRadius,
      adapter: window.__m1.adapterInfo,
    };
  });
  const effects = async (values) => page.evaluate((values) => {
    const renderer = window.__m1.viewer.scene._atmosphere;
    Object.assign(renderer.solarEffects, values);
    window.__m1.viewer.render();
  }, values);
  const capture = async (name) => {
    const png = await page.evaluate(async () => {
      const viewer = window.__m1.viewer;
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      const image = window.__m1.pixels();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d").putImageData(image, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(png, "base64"));
    report.checks.push(`${name}.png: actual WebGPU canvas capture`);
  };

  await effects({ rays: 0, softHalo: 0, wideHalo: 0, corona: 0, tint: 0 });
  await capture("B01-disk-only-1920x1080");
  const diskProfile = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    const state = window.__m2Sun;
    const center = state.centerPixel();
    const projection = viewer.camera.frustum.projectionMatrix;
    const radius = Math.tan(viewer.scene.sun.angularRadius) * viewer.canvas.width * projection[0] * 0.5;
    const points = [0.1, 0.4, 0.7, 0.9, 1.2].map((fraction) => [
      Math.round(center[0] + radius * fraction),
      center[1],
    ]);
    const values = await state.probe(points);
    return {
      center,
      radiusPixels: radius,
      points: points.map((pixel, index) => ({
        pixel,
        radiance: values[index].slice(0, 3),
        coverage: values[index][3],
      })),
    };
  });
  assert.ok(diskProfile.points[0].coverage > 0.99, "Sun center must remain fully covered");
  assert.ok(diskProfile.points[3].coverage > 0.99, "inner disk sample must remain fully covered");
  assert.ok(diskProfile.points[4].coverage < 0.01, "sample outside the physical disk must remain uncovered");
  assert.ok(
    diskProfile.points[0].radiance[0] > diskProfile.points[3].radiance[0] * 1.1,
    "the normalized disk profile must retain a brighter core than its limb",
  );
  report.diskProfile = { ...diskProfile, exposure: 0.5 };

  await page.evaluate(() => {
    window.__m1.viewer.scene.exposure = 1.0;
    const viewer = window.__m1.viewer;
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(24),
      aspectRatio: viewer.canvas.width / viewer.canvas.height,
      near: 0.1,
      far: 500000000,
    });
    viewer.render();
  });
  await effects({ rays: 1, softHalo: 0, wideHalo: 0, corona: 0, tint: 0 });
  await capture("B02-rays-only-1920x1080");
  await effects({ rays: 1, softHalo: 1, wideHalo: 1, corona: 1, tint: 1 });
  await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    viewer.scene.atmosphere.show = true;
    viewer.scene._atmosphere.bloomStrength = 0.35;
  });
  await capture("B01-B02-combined-1920x1080");

  await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    viewer.camera.lookRight(0.012);
    viewer.scene._atmosphere.bloomStrength = 0;
  });
  await capture("B01-B02-off-axis-1920x1080");

  await page.setViewportSize({ width: 1280, height: 720 });
  const resize = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    viewer.resize();
    viewer.render();
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    return [viewer.canvas.width, viewer.canvas.height];
  });
  assert.deepEqual(resize, [1280, 720]);
  await capture("B01-B02-combined-1280x720");

  report.setup = setup;
  report.resize = resize;
  report.checks.push("1920x1080 and 1280x720 actual WebGPU captures completed");
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
});
