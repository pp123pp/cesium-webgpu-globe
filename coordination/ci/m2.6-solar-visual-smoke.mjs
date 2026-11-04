/* global window, document, Cesium, navigator, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { enableSolarTiming, measureSolarGpu, trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6-solar-visual";

await runM1BrowserSuite("m2.6-solar-visual", async ({ page, report, output }) => {
  const initializationStarted = performance.now();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await enableSolarTiming(page);
  await trackSolarAllocations(page);
  await installM1Scene(page);
  await installSunProbe(page);
  await page.evaluate(() => {
    window.__m26Png = (image) => {
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      copy.getContext("2d").putImageData(image, 0, 0);
      return copy.toDataURL("image/png").split(",")[1];
    };
  });
  const capture = async (filename) => {
    // A Playwright screenshot can observe a later, discarded swap texture.
    const png = Buffer.from(await page.evaluate(() => window.__m26Png(window.__m1.pixels())), "base64");
    if (filename) { await writeFile(filename, png); }
    return png;
  };
  const evidence = path.join(output, "evidence");
  for (const folder of ["A07", "A08", "A09", "A10"]) {
    await mkdir(path.join(evidence, folder), { recursive: true });
  }

  const render = async (name, directory) => {
    await page.evaluate(async () => {
      const { viewer } = window.__m1;
      let stable = 0;
      for (let frame = 0; frame < 180; frame++) {
        viewer.render();
        if (window.__m1.errors.length) { throw new Error(window.__m1.errors.join("; ")); }
        const stats = viewer.scene.debugStatistics;
        stable = viewer.scene.globe.tilesLoaded && stats.imagery.pendingRequests === 0 ? stable + 1 : 0;
        if (stable >= 4) { return; }
        await new Promise(requestAnimationFrame);
      }
      throw new Error("Capture scene did not finish tile/imagery loading");
    });
    const result = await page.evaluate(async () => {
      const { viewer } = window.__m1;
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      const image = window.__m1.pixels();
      let white = 0, clipped = 0, luminance = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
        if (r >= 250 && g >= 250 && b >= 250) { white++; }
        if (r >= 254 || g >= 254 || b >= 254) { clipped++; }
        luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const pixels = image.width * image.height;
      return {
        png: window.__m26Png(image),
        photometry: { whiteFraction: white / pixels, clippedChannelFraction: clipped / pixels, meanLuma: luminance / pixels / 255 },
        frame: viewer.scene._frameState.frameNumber,
        atmosphere: { ...viewer.scene._atmosphere.statistics },
        exposure: viewer.scene.exposure,
        cameraHeight: viewer.camera.positionCartographic.height,
        time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
        nativeSun: window.__m2Sun.nativeSun(),
        sunProjection: window.__m2Sun.project(window.__m2Sun.nativeSun()),
        sunInFront: Cesium.Cartesian3.dot(viewer.camera.directionWC, window.__m2Sun.nativeSun()) > 0,
      };
    });
    const filename = `${name}.png`;
    await writeFile(path.join(evidence, directory, filename), Buffer.from(result.png, "base64"));
    delete result.png;
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
    scene.moon.show = true;
    scene.stars.show = true;
    scene.sun.glowStrength = 0.08;
    scene.sun.glowRadius = 0.05;
    scene._atmosphere.bloomStrength = 0.35;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T06:00:00Z");
    window.__m2SolarView = (height, elevation, aimAtEarth = false) => {
      const state = window.__m2Sun;
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: Cesium.Math.toRadians(aimAtEarth ? 70 : 24), aspectRatio: viewer.canvas.width / viewer.canvas.height,
        near: 0.1, far: 500000000,
      });
      const origin = state.originAtElevation(height, elevation);
      if (aimAtEarth) {
        state.look(origin, Cesium.Cartesian3.normalize(Cesium.Cartesian3.negate(origin, new Cesium.Cartesian3()), new Cesium.Cartesian3()));
      } else {
        state.look(origin);
      }
    };
    window.__m2SolarView(400000, window.__m2Sun.limbElevation(400000) + 0.05);
    return {
      adapter: window.__m1.adapterInfo,
      deviceFeatures: Array.from(scene.context._device.features),
      timestampQuerySupported: scene.context._adapter.features.has("timestamp-query"),
      timestampQueryEnabled: scene.context._device.features.has("timestamp-query"),
      adapterFeatures: Array.from(scene.context._adapter.features),
      limits: {
        maxTextureDimension2D: scene.context._device.limits.maxTextureDimension2D,
        maxBufferSize: scene.context._device.limits.maxBufferSize,
      },
      viewport: [viewer.canvas.width, viewer.canvas.height],
      browser: navigator.userAgent,
    };
  });
  report.solarEnvironment = setup;
  report.assetLoads = await page.evaluate(() => window.__m1.viewer.scene._atmosphere.solarAssetRecords);

  const sunrise = await render("orbital-sunrise", "A07");
  assert.ok(sunrise.sunInFront && sunrise.sunProjection[0] > 0 && sunrise.sunProjection[0] < 1920 && sunrise.sunProjection[1] > 0 && sunrise.sunProjection[1] < 1080, "the orbital sunrise capture must contain the native Sun");

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
    await page.evaluate((value) => window.__m2SolarView(value, value > 10000000 ? 60 : value === 400000 ? window.__m2Sun.limbElevation(value) + 2 : 0.5, value > 10000000), height);
    await render(name, "A09");
  }
  report.aerialPerspective = [];
  for (const view of [
    { name: "land-oblique", height: 20000, pitch: -12, heading: 90, fov: 24 },
    { name: "land-regional", height: 200000, pitch: -30, heading: 180, fov: 70 },
  ]) {
    await page.evaluate((view) => {
      const viewer = window.__m1.viewer;
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: Cesium.Math.toRadians(view.fov), aspectRatio: viewer.canvas.width / viewer.canvas.height,
        near: 0.1, far: 500000000,
      });
      window.__m2Atmosphere.setView({ longitude: 11, latitude: 46, ...view });
      viewer.scene.atmosphere.show = false;
    }, view);
    await render(`${view.name}-without-atmosphere`, "A09");
    await page.evaluate(() => { window.__m1.viewer.scene.atmosphere.show = true; });
    await render(view.name, "A09");
    const terrain = await page.evaluate(async () => {
      const viewer = window.__m1.viewer;
      const pixel = [Math.floor(viewer.canvas.width / 2), Math.floor(viewer.canvas.height / 2)];
      const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(...pixel));
      const hit = viewer.scene.globe.pick(ray, viewer.scene);
      const [gpu] = await window.__m2Sun.probe([pixel]);
      return { nativeTerrainDistance: hit ? Cesium.Cartesian3.distance(hit, ray.origin) : null,
        gpuTerrainDistance: gpu[11], transmittance: gpu.slice(4, 7), inscatter: gpu.slice(8, 11),
        surfaceLinearRgb: gpu.slice(12, 15) };
    });
    assert.ok(terrain.nativeTerrainDistance > 0, "aerial perspective must contain actual terrain");
    assert.ok(terrain.transmittance.every((value) => value > 0 && value < 1), "terrain must retain attenuated surface light");
    report.aerialPerspective.push({ ...view, ...terrain });
  }

  await page.evaluate(() => {
    const { viewer } = window.__m1;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T06:00:00Z");
    window.__m2SolarView(400000, 0.5);
    viewer.scene.exposure = 1.0;
    viewer.scene._atmosphere.bloomStrength = 0;
  });
  const solarView = await render("bloom-disabled", "A10");
  assert.ok(solarView.sunInFront && solarView.sunProjection[0] > 0 && solarView.sunProjection[0] < 1920 && solarView.sunProjection[1] > 0 && solarView.sunProjection[1] < 1080, "effect isolation must contain the native Sun");
  const bloomOff = await capture();
  await page.evaluate(() => {
    window.__m1.viewer.scene._atmosphere.bloomStrength = 0.35;
  });
  await render("bloom-enabled", "A10");
  const bloomOn = await capture();
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
    const disabledCapture = await capture(path.join(evidence, "A10", `without-${effect}.png`));
    const digest = hash(disabledCapture);
    assert.notEqual(digest, hash(bloomOn), `${effect} must be independently switchable and visibly affect the canvas`);
    const paired = await page.evaluate((name) => {
      const renderer = window.__m1.viewer.scene._atmosphere;
      renderer.solarEffects[name] = 1;
      const on = window.__m1.pixels();
      renderer.solarEffects[name] = 0;
      const off = window.__m1.pixels();
      const repeat = window.__m1.pixels();
      const center = window.__m2Sun.centerPixel();
      let changed = 0, maxDifference = 0, stationaryNoise = 0;
      for (let y = center[1] - 100; y < center[1] + 100; y++) {
        for (let x = center[0] - 100; x < center[0] + 100; x++) {
          if (x < 0 || y < 0 || x >= on.width || y >= on.height) { continue; }
          const i = (y * on.width + x) * 4;
          let delta = 0;
          for (let c = 0; c < 3; c++) {
            delta = Math.max(delta, Math.abs(on.data[i + c] - off.data[i + c]));
            stationaryNoise = Math.max(stationaryNoise, Math.abs(off.data[i + c] - repeat.data[i + c]));
          }
          if (delta > 0) { changed++; }
          maxDifference = Math.max(maxDifference, delta);
        }
      }
      return { changed, maxDifference, stationaryNoise };
    }, effect);
    assert.ok(paired.changed > 0 && paired.maxDifference >= 1, `${effect  } must change solar ROI pixels, not just unrelated terrain loading`);
    assert.ok(paired.stationaryNoise <= 1, "repeated fixed-state solar pixels must be stable");
    effectIsolation[effect] = { disabledScreenshotSha256: digest, differsFromEnabled: true, paired };
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

  report.exposureMatrix = [];
  for (const scenario of ["orbital-sunrise", "horizon", "day", "terminator"]) {
    await page.evaluate((name) => {
      const viewer = window.__m1.viewer;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
      if (name === "orbital-sunrise") { window.__m2SolarView(400000, window.__m2Sun.limbElevation(400000) + 0.05); }
      else if (name === "horizon") { window.__m2SolarView(2, 1); }
      else { window.__m2SolarView(35786000, name === "day" ? 60 : 0, true); }
    }, scenario);
    const observations = [];
    for (const exposure of [0.5, 1, 2]) {
      await page.evaluate((value) => { window.__m1.viewer.scene.exposure = value; }, exposure);
      const value = await render(`${scenario  }-exposure-${  exposure.toFixed(1)}`, "A10");
      assert.ok(value.photometry.whiteFraction < 0.05, "solar exposure must not wash out a large area of the frame");
      observations.push(value);
    }
    assert.ok(observations[1].photometry.meanLuma >= observations[0].photometry.meanLuma);
    assert.ok(observations[2].photometry.meanLuma > observations[0].photometry.meanLuma);
    report.exposureMatrix.push({ scenario, observations });
  }

  await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    viewer.scene.exposure = 1;
    window.__m2SolarView(400000, window.__m2Sun.limbElevation(400000) + 0.6);
  });
  await render("profile-orbital-sunrise", "A10");
  report.performance = await measureSolarGpu(page);
  report.performance.initializationMs = initializationMs;
  if (setup.timestampQuerySupported) {
    assert.equal(report.performance.status, "MEASURED");
    assert.ok(report.performance.summaries.allEnabled.gpuPassSumMs.p50 > 0);
    assert.deepEqual(report.performance.rendererAllocationsDuringMeasurement, { textures: 0, buffers: 0 });
  }
  report.effectIsolation = effectIsolation;
  report.bloom = {
    enabledScreenshotSha256: hash(bloomOn),
    disabledScreenshotSha256: hash(bloomOff),
    enabledDiffersFromDisabled: true,
    exposure: exposureResults.map((result) => result.exposure),
    lastFrameStatistics: stats,
    gpuFrameTime: report.performance.status,
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

  report.continuous = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const renderer = viewer.scene._atmosphere;
    const before = { ...renderer.statistics };
    const assets = [...renderer._solarTextures];
    const start = Cesium.JulianDate.clone(viewer.clock.currentTime);
    const memory = [];
    const frames = [];
    const captures = [];
    let previous;
    for (let frame = 0; frame < 120; frame++) {
      viewer.clock.currentTime = Cesium.JulianDate.addSeconds(start, frame * 10, new Cesium.JulianDate());
      viewer.scene.exposure = 0.5 + 1.5 * (0.5 - 0.5 * Math.cos(frame / 119 * Math.PI * 2));
      viewer.camera.lookRight(0.00005);
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      const image = window.__m1.pixels();
      const repeat = window.__m1.pixels();
      const sampled = [];
      let repeatDifference = 0;
      for (let y = 8; y < image.height; y += 24) {
        for (let x = 8; x < image.width; x += 24) {
          const i = (y * image.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            sampled.push(image.data[i + c]);
            repeatDifference += Math.abs(image.data[i + c] - repeat.data[i + c]);
          }
        }
      }
      const previousFrame = previous;
      frames.push({ frame, sunProjection: window.__m2Sun.project(window.__m2Sun.nativeSun()),
        meanIntensity: sampled.reduce((sum, value) => sum + value, 0) / sampled.length / 255,
        meanFrameDifference: previousFrame ? sampled.reduce((sum, value, i) => sum + Math.abs(value - previousFrame[i]), 0) / sampled.length / 255 : 0,
        meanStationaryDifference: repeatDifference / sampled.length / 255 });
      previous = sampled;
      if (frame === 0 || frame === 60 || frame === 119) {
        captures.push({ frame, png: window.__m26Png(image) });
      }
      if (frame % 20 === 0) {
        const live = window.__solarAllocations.filter((row) => !row.destroyed);
        memory.push({ frame, nativeLiveResources: live.length, nativePayloadBytes: live.reduce((sum, row) => sum + row.bytes, 0),
          solarTextures: renderer.statistics.texturesCreated - renderer.statistics.texturesDestroyed,
          solarPayloadBytes: renderer.statistics.solarAssetBytes + renderer.statistics.bloomTextureBytes });
      }
    }
    const after = { ...renderer.statistics };
    await Promise.all([renderer.initialize(), renderer.initialize()]);
    return { frames: 120, observations: frames, captures, memory, errors: [...window.__m1.errors],
      newTextures: after.texturesCreated - before.texturesCreated,
      newBuffers: after.buffersCreated - before.buffersCreated,
      assetsReused: assets.every((texture, i) => texture === renderer._solarTextures[i]),
      reinitializationAllocations: renderer.statistics.texturesCreated - after.texturesCreated };
  });
  assert.deepEqual(report.continuous.errors, []);
  assert.equal(report.continuous.newTextures, 0);
  assert.equal(report.continuous.newBuffers, 0);
  assert.equal(report.continuous.assetsReused, true);
  assert.equal(report.continuous.reinitializationAllocations, 0);
  assert.equal(new Set(report.continuous.memory.map((row) => row.solarPayloadBytes)).size, 1);
  const motion = report.continuous.observations;
  assert.ok(motion.every((row) => row.meanFrameDifference < 0.08), "small time/camera/exposure steps must not flash the whole frame");
  assert.ok(motion.every((row) => row.meanStationaryDifference < 1 / 255), "fixed-state repeat frames must remain stable");
  assert.ok(Math.hypot(...motion[0].sunProjection.map((value, i) => value - motion.at(-1).sunProjection[i])) > 5, "continuous test must move the projected Sun");
  assert.ok(Math.max(...motion.map((row) => row.meanIntensity)) - Math.min(...motion.map((row) => row.meanIntensity)) > 1 / 255, "time/exposure animation must visibly change the frame");
  for (const frame of report.continuous.captures) {
    await writeFile(path.join(evidence, "A08", `continuous-${frame.frame}.png`), Buffer.from(frame.png, "base64"));
  }
  delete report.continuous.captures;
  report.loss = await page.evaluate(async () => {
    const { viewer, errors } = window.__m1;
    const context = viewer.scene.context;
    const device = context._device;
    const before = viewer.scene._atmosphere.statistics.bloomFrames;
    await device.queue.onSubmittedWorkDone();
    viewer.useDefaultRenderLoop = true;
    device.destroy();
    await device.lost;
    const bloomFramesAtLoss = viewer.scene._atmosphere.statistics.bloomFrames;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return { errors: [...errors], stopped: !viewer.useDefaultRenderLoop,
      inFlightBloomFrames: bloomFramesAtLoss - before,
      newBloomFrames: viewer.scene._atmosphere.statistics.bloomFrames - bloomFramesAtLoss };
  });
  assert.equal(report.loss.errors.length, 1);
  assert.match(report.loss.errors[0], /device lost/i);
  assert.equal(report.loss.stopped, true);
  assert.equal(report.loss.newBloomFrames, 0);

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
  report.nativeLifecycle = await page.evaluate(() => ({
    created: window.__solarAllocations.length,
    destroyed: window.__solarAllocations.filter((row) => row.destroyed).length,
    live: window.__solarAllocations.filter((row) => !row.destroyed),
  }));
  assert.deepEqual(report.nativeLifecycle.live, []);
  assert.equal(report.nativeLifecycle.created, report.nativeLifecycle.destroyed);
  report.recreatedScenes = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    await installM1Scene(page, { baseLayer: false });
    const cycle = await page.evaluate(async () => {
      const viewer = window.__m1.viewer;
      viewer.scene.atmosphere.show = true;
      viewer.scene.sun.show = true;
      for (let frame = 0; frame < 4; frame++) { viewer.render(); }
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      const renderer = viewer.scene._atmosphere;
      const errors = [...window.__m1.errors];
      viewer.destroy();
      return { errors, statistics: { ...renderer.statistics },
        live: window.__solarAllocations.filter((row) => !row.destroyed) };
    });
    assert.deepEqual(cycle.errors, []);
    assert.deepEqual(cycle.live, []);
    assert.equal(cycle.statistics.texturesCreated, cycle.statistics.texturesDestroyed);
    assert.equal(cycle.statistics.buffersCreated, cycle.statistics.buffersDestroyed);
    report.recreatedScenes.push(cycle);
  }
  report.checks.push("solar asset and HDR bloom GPU resources are balanced after viewer destruction");
});
