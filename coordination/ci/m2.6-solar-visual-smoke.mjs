/* global window, Cesium, navigator */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6-solar-visual";

await runM1BrowserSuite("m2.6-solar-visual", async ({ page, report, output }) => {
  const initializationStarted = performance.now();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page);
  const evidence = path.join(output, "evidence");
  for (const folder of ["A07", "A08", "A09", "A10"]) {
    await mkdir(path.join(evidence, folder), { recursive: true });
  }

  const render = async (name, directory) => {
    const result = await page.evaluate(async () => {
      const { viewer } = window.__m1;
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      return {
        frame: viewer.scene._frameState.frameNumber,
        atmosphere: { ...viewer.scene._atmosphere.statistics },
        exposure: viewer.scene.exposure,
        cameraHeight: viewer.camera.positionCartographic.height,
        time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
        nativeSun: window.__m2Sun.nativeSun(),
        sunProjection: window.__m2Sun.project(window.__m2Sun.nativeSun()),
      };
    });
    const filename = `${name}.png`;
    await page.locator("canvas").first().screenshot({ path: path.join(evidence, directory, filename) });
    report.checks.push(`${directory}/${filename}: actual WebGPU frame ${result.frame}`);
    report.scenes.push({ name, directory, ...result });
    return result;
  };

  const initializationMs = performance.now() - initializationStarted;
  const setup = await page.evaluate(() => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    scene.atmosphere.show = true;
    scene.sun.show = true;
    scene.sun.glowStrength = 0.025;
    scene.sun.glowRadius = 0.025;
    scene._atmosphere.bloomStrength = 0.16;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T06:00:00Z");
    window.__m2SolarView = (height, elevation, aimAtEarth = false) => {
      const sun = window.__m2Sun.nativeSun();
      const axis = Math.abs(sun.z) < 0.9 ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.UNIT_Y;
      const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(sun, axis, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const angle = Cesium.Math.toRadians(elevation);
      const normal = Cesium.Cartesian3.normalize(Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(sun, Math.sin(angle), new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(right, Math.cos(angle), new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      ), new Cesium.Cartesian3());
      const tangent = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(
        sun,
        Cesium.Cartesian3.multiplyByScalar(normal, Math.sin(angle), new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      ), new Cesium.Cartesian3());
      const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
      const position = Cesium.Cartesian3.multiplyByScalar(normal, radius + height, new Cesium.Cartesian3());
      let direction;
      let up;
      if (aimAtEarth) {
        direction = Cesium.Cartesian3.negate(normal, new Cesium.Cartesian3());
        up = tangent;
      } else {
        direction = sun;
        up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(
          normal,
          Cesium.Cartesian3.multiplyByScalar(sun, Cesium.Cartesian3.dot(normal, sun), new Cesium.Cartesian3()),
          new Cesium.Cartesian3(),
        ), new Cesium.Cartesian3());
      }
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: Cesium.Math.toRadians(90), aspectRatio: viewer.canvas.width / viewer.canvas.height,
        near: 0.1, far: 500000000,
      });
      viewer.camera.setView({ destination: position, orientation: { direction, up } });

    };
    window.__m2SolarView(400000, 0.5);
    return {
      adapter: window.__m1.adapterInfo,
      viewport: [viewer.canvas.width, viewer.canvas.height],
      browser: navigator.userAgent,
    };
  });
  report.environment = setup;

  await render("orbital-sunrise", "A07");

  await page.evaluate(() => {
    window.__m2SolarView(400000, 0.5);
  });
  for (const [name, iso] of [
    ["morning", "2026-03-20T06:00:00Z"],
    ["noon", "2026-03-20T12:00:00Z"],
    ["evening", "2026-03-20T18:00:00Z"],
    ["night", "2026-03-20T23:00:00Z"],
  ]) {
    await page.evaluate((time) => {
      window.__m1.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(time);
    }, iso);
    await render(name, "A08");
  }
  const dayNight = report.scenes.filter((scene) => scene.directory === "A08");
  const directionDot = (a, b) => a.nativeSun.x * b.nativeSun.x + a.nativeSun.y * b.nativeSun.y + a.nativeSun.z * b.nativeSun.z;
  assert.ok(directionDot(dayNight[0], dayNight[1]) < 0.99, "native solar direction must change between morning and noon");
  assert.ok(directionDot(dayNight[1], dayNight[2]) < 0.99, "native solar direction must change between noon and evening");

  await page.evaluate(() => {
    window.__m1.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
  });
  for (const [name, height] of [["high-orbit", 35786000], ["low-orbit", 400000], ["near-ground", 2]]) {
    await page.evaluate((value) => window.__m2SolarView(value, 0.5, value > 10000000), height);
    await render(name, "A09");
  }

  await page.evaluate(() => {
    const { viewer } = window.__m1;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T06:00:00Z");
    window.__m2SolarView(400000, 0.5);
    viewer.scene.exposure = 1.0;
    viewer.scene._atmosphere.bloomStrength = 0;
  });
  await render("bloom-disabled", "A10");
  const bloomOff = await page.locator("canvas").first().screenshot();
  await page.evaluate(() => {
    window.__m1.viewer.scene._atmosphere.bloomStrength = 0.16;
  });
  await render("bloom-enabled", "A10");
  const bloomOn = await page.locator("canvas").first().screenshot();
  const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
  assert.notEqual(hash(bloomOn), hash(bloomOff), "HDR Bloom must change the actual canvas");
  const effectIsolation = {};
  for (const effect of ["rays", "softHalo", "wideHalo", "corona", "tint"]) {
    await page.evaluate(async (name) => {
      const viewer = window.__m1.viewer;
      viewer.scene._atmosphere.solarEffects[name] = 0;
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
    }, effect);
    const capture = await page.locator("canvas").first().screenshot({
      path: path.join(evidence, "A10", `without-${effect}.png`),
    });
    const digest = hash(capture);
    assert.notEqual(digest, hash(bloomOn), `${effect} must be independently switchable and visibly affect the canvas`);
    effectIsolation[effect] = { disabledScreenshotSha256: digest, differsFromEnabled: true };
    await page.evaluate((name) => {
      window.__m1.viewer.scene._atmosphere.solarEffects[name] = 1;
    }, effect);
  }

  const exposureResults = [];
  for (const exposure of [0.5, 1.0, 2.0]) {
    await page.evaluate((value) => {
      window.__m1.viewer.scene.exposure = value;
    }, exposure);
    exposureResults.push(await render(`exposure-${exposure.toFixed(1)}`, "A10"));
  }
  assert.ok(exposureResults.every((result) => result.atmosphere.solarAssetsLoaded));
  assert.ok(exposureResults.every((result) => result.atmosphere.bloomFrames > 0));
  const stats = exposureResults.at(-1).atmosphere;
  assert.equal(stats.solarAssetBytes, 2883584);
  assert.equal(stats.bloomWidth, 480);
  assert.equal(stats.bloomHeight, 270);
  assert.equal(stats.bloomTextureBytes, (1920 * 1080 + 2 * 480 * 270) * 8);

  const timing = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const measure = async (strength) => {
      viewer.scene._atmosphere.bloomStrength = strength;
      for (let i = 0; i < 8; i++) {
        viewer.render();
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
      }
      const samples = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        viewer.render();
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return {
        meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p50Ms: samples[Math.floor(samples.length * 0.50)],
        p95Ms: samples[Math.floor(samples.length * 0.95)],
        samples: samples.length,
      };
    };
    return { bloomDisabled: await measure(0), bloomEnabled: await measure(0.16) };
  });
  report.performance = {
    resolution: "1920x1080",
    endToEndRenderAndQueueCompletionMs: timing,
    initializationMs,
    gpuTimestampQueries: "UNVERIFIED; wall-clock queue completion is not a GPU timestamp",
  };
  report.effectIsolation = effectIsolation;
  report.bloom = {
    enabledScreenshotSha256: hash(bloomOn),
    disabledScreenshotSha256: hash(bloomOff),
    enabledDiffersFromDisabled: true,
    exposure: exposureResults.map((result) => result.exposure),
    lastFrameStatistics: stats,
    gpuFrameTime: "UNVERIFIED: browser queue completion is not a GPU timestamp query",
  };
  await writeFile(path.join(output, "environment.json"), JSON.stringify({ ...setup, initializationMs }, null, 2));

  await page.setViewportSize({ width: 1280, height: 720 });
  const resized = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    viewer.resize();
    viewer.render();
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    return {
      width: viewer.scene.context.drawingBufferWidth,
      height: viewer.scene.context.drawingBufferHeight,
      bloomWidth: viewer.scene._atmosphere.statistics.bloomWidth,
      bloomHeight: viewer.scene._atmosphere.statistics.bloomHeight,
    };
  });
  assert.equal(resized.width, 1280);
  assert.equal(resized.height, 720);
  assert.equal(resized.bloomWidth, 320);
  assert.equal(resized.bloomHeight, 180);
  report.resize = resized;
  report.checks.push("HDR and bloom render targets are recreated at 1280x720 after viewport resize");

  const lifecycle = await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    const atmosphere = viewer.scene._atmosphere;
    viewer.destroy();
    return {
      destroyed: viewer.isDestroyed(),
      ...atmosphere.statistics,
    };
  });
  assert.equal(lifecycle.destroyed, true);
  assert.equal(lifecycle.buffersCreated, lifecycle.buffersDestroyed);
  assert.equal(lifecycle.texturesCreated, lifecycle.texturesDestroyed);
  assert.equal(lifecycle.solarAssetBytes, 0);
  assert.equal(lifecycle.bloomTextureBytes, 0);
  report.lifecycle = lifecycle;
  report.checks.push("solar asset and HDR bloom GPU resources are balanced after viewer destruction");
});
