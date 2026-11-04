/* global window, document, Cesium */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";

process.env.M1_OUTPUT ??= "coordination/evidence/M2.6.1/B2";

await runM1BrowserSuite("m2.6.1-b2-halo-corona", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page);
  const sunProbe = await installSunProbe(page);
  const setup = await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    const scene = viewer.scene;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(12),
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
    scene.moon.show = false;
    scene.stars.show = false;
    scene.exposure = 1;
    scene._atmosphere.bloomStrength = 0;
    Object.assign(scene._atmosphere.solarEffects, {
      rays: 0, softHalo: 1, wideHalo: 1, corona: 1, tint: 1,
    });
    viewer.render();
    return {
      viewport: [viewer.canvas.width, viewer.canvas.height],
      cameraHeight: viewer.camera.positionCartographic.height,
      time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
      angularRadius: scene.sun.angularRadius,
      adapter: window.__m1.adapterInfo,
      assetRecords: scene._atmosphere.solarAssetRecords,
      solarAssetBytes: scene._atmosphere.statistics.solarAssetBytes,
    };
  });

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
    await writeFile(path.join(output, name), Buffer.from(png, "base64"));
    report.checks.push(`${name}: actual WebGPU canvas capture`);
  };

  const isolate = async (name, enabled, disabled) => {
    const result = await page.evaluate(({ enabled, disabled }) => {
      const viewer = window.__m1.viewer;
      const renderer = viewer.scene._atmosphere;
      const center = window.__m2Sun.centerPixel();
      const radius = 180;
      const image = () => {
        viewer.render();
        return window.__m1.pixels();
      };
      Object.assign(renderer.solarEffects, enabled);
      const on = image();
      Object.assign(renderer.solarEffects, disabled);
      const off = image();
      let changed = 0;
      let maxDifference = 0;
      for (let y = Math.max(0, center[1] - radius); y < Math.min(on.height, center[1] + radius); y++) {
        for (let x = Math.max(0, center[0] - radius); x < Math.min(on.width, center[0] + radius); x++) {
          const i = (y * on.width + x) * 4;
          let delta = 0;
          for (let c = 0; c < 3; c++) {
            delta = Math.max(delta, Math.abs(on.data[i + c] - off.data[i + c]));
          }
          if (delta > 0) { changed++; }
          maxDifference = Math.max(maxDifference, delta);
        }
      }
      Object.assign(renderer.solarEffects, enabled);
      viewer.render();
      return { center, roiRadius: radius, changedPixels: changed, maxDifference };
    }, { enabled, disabled });
    assert.ok(result.changedPixels > 0 && result.maxDifference > 0, `${name} must visibly affect the solar ROI`);
    report.effectIsolation[name] = result;
    return result;
  };

  report.setup = setup;
  report.shaderDiagnostics = sunProbe.sun.shaderDiagnostics;
  report.effectIsolation = {};
  assert.equal(setup.solarAssetBytes, 3145728, "nine GPU payloads must be uploaded");
  assert.equal(setup.assetRecords.length, 9, "all nine solar assets must load");
  assert.deepEqual(report.shaderDiagnostics.filter((row) => row.type === "error"), []);

  await isolate("halo", { rays: 0, softHalo: 1, wideHalo: 1, corona: 0, tint: 0 }, { rays: 0, softHalo: 0, wideHalo: 0, corona: 0, tint: 0 });
  await capture("halo-only-1920x1080.png");
  await isolate("corona", { rays: 0, softHalo: 0, wideHalo: 0, corona: 1, tint: 0 }, { rays: 0, softHalo: 0, wideHalo: 0, corona: 0, tint: 0 });
  await capture("corona-only-1920x1080.png");

  await page.evaluate(() => {
    const scene = window.__m1.viewer.scene;
    Object.assign(scene._atmosphere.solarEffects, {
      rays: 0, softHalo: 1, wideHalo: 1, corona: 1, tint: 1,
    });
    scene._atmosphere.bloomStrength = 0;
    scene.exposure = 0.5;
    window.__m1.viewer.render();
  });
  await capture("combined-exposure-0.5-1920x1080.png");
  for (const exposure of [1, 2]) {
    await page.evaluate((value) => {
      window.__m1.viewer.scene.exposure = value;
      window.__m1.viewer.render();
    }, exposure);
    await capture(`combined-exposure-${exposure.toFixed(1)}-1920x1080.png`);
  }

  await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    viewer.scene.exposure = 1;
    viewer.resize();
    viewer.render();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const resize = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    viewer.resize();
    viewer.render();
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    return {
      width: viewer.canvas.width,
      height: viewer.canvas.height,
      bloomWidth: viewer.scene._atmosphere.statistics.bloomWidth,
      bloomHeight: viewer.scene._atmosphere.statistics.bloomHeight,
      solarAssetBytes: viewer.scene._atmosphere.statistics.solarAssetBytes,
    };
  });
  assert.equal(resize.width, 1280);
  assert.equal(resize.height, 720);
  assert.equal(resize.solarAssetBytes, 3145728);
  report.resize = resize;
  await capture("combined-resized-1280x720.png");

  report.finalStatistics = await page.evaluate(() => ({
    ...window.__m1.viewer.scene._atmosphere.statistics,
    assetRecords: window.__m1.viewer.scene._atmosphere.solarAssetRecords,
    errors: [...window.__m1.errors],
  }));
  assert.deepEqual(report.finalStatistics.errors, []);
  assert.equal(report.finalStatistics.solarAssetsLoaded, true);
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
});
