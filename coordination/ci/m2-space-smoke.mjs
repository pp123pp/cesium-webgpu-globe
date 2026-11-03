/* global Cesium, window, requestAnimationFrame */
import assert from "node:assert/strict";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { trackAtmosphereResources } from "./m2-atmosphere-fixtures.mjs";

await runM1BrowserSuite("m2-space", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await trackAtmosphereResources(page);
  await installM1Scene(page, { baseLayer: false });
  report.sky = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-03T11:30:00Z");
    scene.atmosphere.show = false;
    scene.sun.show = false;
    scene.moon.show = true;
    scene.moon.moonlightIntensity = 0;
    scene.stars.show = true;
    const time = viewer.clock.currentTime;
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(time);
    const moonPosition = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, new Cesium.Cartesian3());
    const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(time, new Cesium.Matrix3());
    Cesium.Matrix3.multiplyByVector(rotation, moonPosition, moonPosition);
    const origin = Cesium.Cartesian3.multiplyByScalar(sun, -(Cesium.Ellipsoid.WGS84.maximumRadius + 400000), new Cesium.Cartesian3());
    const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(moonPosition, origin, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(right) < 1e-5) { right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Y, right); }
    Cesium.Cartesian3.normalize(right, right);
    const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(12), aspectRatio: 800 / 450, near: 0.1, far: 1e9 });
    viewer.camera.setView({ destination: origin, orientation: { direction, up } });
    viewer.camera.update(Cesium.SceneMode.SCENE3D);
    for (let i = 0; i < 4; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await scene.context._device.queue.onSubmittedWorkDone();
    const pixels = window.__m1.pixels();
    const center = ((pixels.height >> 1) * pixels.width + (pixels.width >> 1)) * 4;
    const starPixels = [];
    for (let y = 0; y < pixels.height; ++y) {
      for (let x = 0; x < pixels.width; ++x) {
        if ((x - pixels.width / 2) ** 2 + (y - pixels.height / 2) ** 2 < 32 ** 2) { continue; }
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset] > 24 || pixels.data[offset + 1] > 24 || pixels.data[offset + 2] > 24) { starPixels.push(y * pixels.width + x); }
      }
    }
    return {
      center: Array.from(pixels.data.slice(center, center + 4)),
      width: pixels.width,
      height: pixels.height,
      starPixels,
      moonDistance: scene._planetState.moonDistance,
      moonAngularRadius: scene._planetState.moonAngularRadius,
      moonIllumination: scene._planetState.moonIllumination,
      errors: [...window.__m1.errors],
    };
  });
  assert.deepEqual(report.sky.errors, []);
  assert.ok(Math.max(...report.sky.center.slice(0, 3)) > 35, "actual lunar disk is visible in the night-sky canvas");
  assert.ok(report.sky.moonDistance > 3.4e8 && report.sky.moonDistance < 4.1e8);
  assert.ok(report.sky.moonAngularRadius > 0.0035 && report.sky.moonAngularRadius < 0.0055);
  assert.ok(report.sky.moonIllumination > 0.8, "full-Moon date produces a mostly illuminated lunar disk");
  assert.ok(report.sky.starPixels.length >= 8, "actual canvas contains resolved procedural stars");
  await captureM1Scene(page, report, output, "night-sky-moon-stars", report.sky);
  report.checks.push("real WebGPU night sky displays the native-ephemeris Moon and procedural stars");

  report.altitudes = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    const time = viewer.clock.currentTime;
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(time);
    const moonPosition = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, new Cesium.Cartesian3());
    const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(time, new Cesium.Matrix3());
    Cesium.Matrix3.multiplyByVector(rotation, moonPosition, moonPosition);
    const views = [];
    for (const [name, height] of [["ground", 2], ["low-orbit", 400000], ["high-orbit", 35786000]]) {
      const origin = Cesium.Cartesian3.multiplyByScalar(sun,
        -(Cesium.Ellipsoid.WGS84.maximumRadius + height), new Cesium.Cartesian3());
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(moonPosition, origin, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitude(right) < 1e-5) { right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Y, right); }
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      viewer.camera.setView({ destination: origin, orientation: { direction, up } });
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
      for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
      await scene.context._device.queue.onSubmittedWorkDone();
      const pixels = window.__m1.pixels();
      const center = ((pixels.height >> 1) * pixels.width + (pixels.width >> 1)) * 4;
      views.push({
        name, height, center: Array.from(pixels.data.slice(center, center + 4)),
        moonDistance: scene._planetState.moonDistance,
        moonAngularRadius: scene._planetState.moonAngularRadius,
        moonIllumination: scene._planetState.moonIllumination,
      });
    }
    return views;
  });
  for (const view of report.altitudes) {
    assert.ok(Math.max(...view.center.slice(0, 3)) > 35, `${view.name}: Moon remains visible in the real browser`);
    assert.ok(view.moonDistance > 3.4e8 && view.moonDistance < 4.1e8);
    assert.ok(view.moonAngularRadius > 0.0035 && view.moonAngularRadius < 0.0055);
    await captureM1Scene(page, report, output, `moon-stars-${view.name}`, view);
  }
  report.checks.push("ground, low-orbit and high-orbit browser views preserve lunar visibility and angular size");

  report.translation = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const camera = viewer.camera;
    const direction = Cesium.Cartesian3.clone(camera.directionWC);
    const up = Cesium.Cartesian3.clone(camera.upWC);
    const destination = Cesium.Cartesian3.add(camera.positionWC,
      Cesium.Cartesian3.multiplyByScalar(direction, 100000, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    camera.setView({ destination, orientation: { direction, up } });
    camera.update(Cesium.SceneMode.SCENE3D);
    for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    const pixels = window.__m1.pixels();
    const starPixels = [];
    for (let y = 0; y < pixels.height; ++y) {
      for (let x = 0; x < pixels.width; ++x) {
        if ((x - pixels.width / 2) ** 2 + (y - pixels.height / 2) ** 2 < 32 ** 2) continue;
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset] > 24 || pixels.data[offset + 1] > 24 || pixels.data[offset + 2] > 24) starPixels.push(y * pixels.width + x);
      }
    }
    return { starPixels, moonIllumination: viewer.scene._planetState.moonIllumination };
  });
  const movedSet = new Set(report.translation.starPixels);
  const stableStars = report.sky.starPixels.filter((pixel) => movedSet.has(pixel)).length;
  assert.ok(stableStars / report.sky.starPixels.length > 0.9,
    "100 km camera translation with fixed orientation preserves star screen positions");
  report.checks.push("100 km camera translation does not introduce star-field parallax");

  report.phase = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const before = viewer.scene._planetState.moonIllumination;
    viewer.clock.currentTime = Cesium.JulianDate.addDays(viewer.clock.currentTime, 7, new Cesium.JulianDate());
    for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    return { before, after: viewer.scene._planetState.moonIllumination };
  });
  assert.ok(Math.abs(report.phase.after - report.phase.before) > 0.15, "lunar illumination changes with scene time");
  report.checks.push("lunar phase responds to native ephemeris time progression");

  await page.setViewportSize({ width: 960, height: 540 });
  report.resize = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    viewer.resize();
    for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    const pixels = window.__m1.pixels();
    const center = ((pixels.height >> 1) * pixels.width + (pixels.width >> 1)) * 4;
    return {
      size: [pixels.width, pixels.height],
      center: Array.from(pixels.data.slice(center, center + 4)),
      depthSize: [viewer.scene.context.sceneDepthTexture.width, viewer.scene.context.sceneDepthTexture.height],
      colorSize: [viewer.scene.context.sceneColorTexture.width, viewer.scene.context.sceneColorTexture.height],
    };
  });
  assert.deepEqual(report.resize.size, [960, 540]);
  assert.deepEqual(report.resize.depthSize, [960, 540]);
  assert.deepEqual(report.resize.colorSize, [960, 540]);
  report.checks.push("Moon and star compositor follows resized scene color/depth targets");

  report.cleanup = await destroyM1Scene(page);
  report.nativeResources = await page.evaluate(() => {
    const rows = window.__m2AtmosphereAllocations;
    return { created: rows.length, destroyed: rows.filter((row) => row.destroyed).length,
      live: rows.filter((row) => !row.destroyed).map(({ kind, label }) => ({ kind, label })) };
  });
  assert.equal(report.nativeResources.created, report.nativeResources.destroyed);
  assert.deepEqual(report.nativeResources.live, []);
  report.checks.push("all native GPU resources are released on scene destruction");
});
