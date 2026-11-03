/* global Cesium, window, requestAnimationFrame */
import assert from "node:assert/strict";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installAtmosphereProbe, trackAtmosphereResources } from "./m2-atmosphere-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-space";

await runM1BrowserSuite("m2-space", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await trackAtmosphereResources(page);
  await installM1Scene(page, { baseLayer: false });
  await page.evaluate(() => {
    window.__m1.setSpaceView = ({ destination, direction, up }) => {
      const camera = window.__m1.viewer.camera;
      // Keep exact ECEF rays: setView's heading/roll conversion snaps near zenith.
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      Cesium.Cartesian3.clone(destination, camera.position);
      Cesium.Cartesian3.clone(direction, camera.direction);
      Cesium.Cartesian3.clone(up, camera.up);
      Cesium.Cartesian3.cross(direction, up, camera.right);
      Cesium.Cartesian3.normalize(camera.right, camera.right);
      camera.update(Cesium.SceneMode.SCENE3D);
    };
  });
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
    // Freeze the reference transform before aiming; its first call otherwise
    // falls back to TEME while the ICRF samples load asynchronously.
    await Cesium.CelestialFrameTransforms.preloadIcrfFixed(new Cesium.TimeInterval({
      start: time,
      stop: Cesium.JulianDate.addDays(time, 8, new Cesium.JulianDate()),
    }));
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
    window.__m1.setSpaceView({ destination: origin, direction, up });
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
      aimError: Cesium.Cartesian3.angleBetween(viewer.camera.directionWC, scene._planetState.moonDirectionWC),
      errors: [...window.__m1.errors],
    };
  });
  assert.deepEqual(report.sky.errors, []);
  assert.ok(report.sky.aimError < report.sky.moonAngularRadius, "camera remains aimed inside the lunar disk after ICRF data loads");
  assert.ok(Math.max(...report.sky.center.slice(0, 3)) > 35, "actual lunar disk is visible in the night-sky canvas");
  assert.ok(report.sky.moonDistance > 3.0e8 && report.sky.moonDistance < 4.5e8);
  assert.ok(report.sky.moonAngularRadius > 0.0035 && report.sky.moonAngularRadius < 0.0055);
  assert.ok(report.sky.moonIllumination > 0.8, "full-Moon date produces a mostly illuminated lunar disk");
  assert.ok(report.sky.starPixels.length >= 8, "actual canvas contains resolved procedural stars");
  await captureM1Scene(page, report, output, "night-sky-moon-stars", report.sky);
  report.checks.push("real WebGPU night sky displays the native-ephemeris Moon and procedural stars");

  // Exercise both completed scene depth and the analytic WGS84 ellipsoid
  // occluder. A camera on the far side looks through Earth toward the Moon;
  // toggling the Moon must not change that center pixel. The near-side
  // control proves the same ephemeris disk becomes visible when unobstructed.
  report.earthOccultation = await page.evaluate(async () => {
    const { viewer, setSpaceView, pixels } = window.__m1;
    const scene = viewer.scene;
    const time = viewer.clock.currentTime;
    const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(time, new Cesium.Matrix3());
    const moon = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, new Cesium.Cartesian3());
    Cesium.Matrix3.multiplyByVector(rotation, moon, moon);
    const moonAxis = Cesium.Cartesian3.normalize(moon, new Cesium.Cartesian3());
    const radius = Cesium.Ellipsoid.WGS84.maximumRadius + 400000;
    const directionToMoon = (origin) => Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(moon, origin, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const orient = (origin, direction) => {
      let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitude(right) < 1e-5) {
        right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Y, right);
      }
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      setSpaceView({ destination: origin, direction, up });
    };
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(12), aspectRatio: 800 / 450, near: 0.1, far: 1e9,
    });
    scene.atmosphere.show = false;
    scene.sun.show = false;
    scene.stars.show = false;
    scene.moon.show = true;
    scene.moon.moonlightIntensity = 0;
    const farOrigin = Cesium.Cartesian3.multiplyByScalar(moonAxis, -radius, new Cesium.Cartesian3());
    orient(farOrigin, directionToMoon(farOrigin));
    const renderCenter = async () => {
      for (let i = 0; i < 4; ++i) {
        await new Promise(requestAnimationFrame);
        viewer.render();
      }
      await scene.context._device.queue.onSubmittedWorkDone();
      const frame = pixels();
      const offset = ((frame.height >> 1) * frame.width + (frame.width >> 1)) * 4;
      return Array.from(frame.data.slice(offset, offset + 4));
    };
    scene.globe.show = true;
    const terrainOccluded = await renderCenter();
    scene.moon.show = false;
    const terrainWithoutMoon = await renderCenter();
    scene.moon.show = true;
    scene.globe.show = false;
    const ellipsoidOccluded = await renderCenter();
    scene.moon.show = false;
    const ellipsoidWithoutMoon = await renderCenter();
    scene.moon.show = true;
    const nearOrigin = Cesium.Cartesian3.multiplyByScalar(moonAxis, radius, new Cesium.Cartesian3());
    orient(nearOrigin, directionToMoon(nearOrigin));
    const unobstructed = await renderCenter();
    const result = {
      terrainOccluded, terrainWithoutMoon, ellipsoidOccluded, ellipsoidWithoutMoon,
      unobstructed, moonDistance: scene._planetState.moonDistance,
      moonAngularRadius: scene._planetState.moonAngularRadius,
    };
    scene.globe.show = true;
    return result;
  });
  assert.deepEqual(report.earthOccultation.terrainOccluded, report.earthOccultation.terrainWithoutMoon,
    "completed Earth/terrain depth prevents Moon pixels on the far side");
  assert.deepEqual(report.earthOccultation.ellipsoidOccluded, report.earthOccultation.ellipsoidWithoutMoon,
    "analytic WGS84 ellipsoid prevents Moon pixels when terrain rendering is disabled");
  assert.ok(Math.max(...report.earthOccultation.unobstructed.slice(0, 3)) > 35,
    "the same Moon is visible from the unobstructed near side");
  report.checks.push("actual Moon pixels are rejected by both completed Earth depth and analytic WGS84 occultation, then reappear on the near side");

  // The occultation fixture disables the star layer to isolate Moon pixels.
  // Restore it before the altitude and translation checks so they measure the
  // actual inertial star field rather than a deliberately starless frame.
  await page.evaluate(async () => {
    const { viewer } = window.__m1;
    viewer.scene.stars.show = true;
    for (let i = 0; i < 4; ++i) {
      await new Promise(requestAnimationFrame);
      viewer.render();
    }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
  });

  report.altitudes = [];
  for (const [name, height] of [["ground", 2], ["low-orbit", 400000], ["high-orbit", 35786000]]) {
    const view = await page.evaluate(async ({ name, height }) => {
      const { viewer } = window.__m1;
      const scene = viewer.scene;
      const time = viewer.clock.currentTime;
      const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(time);
      const moonPosition = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, new Cesium.Cartesian3());
      const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(time, new Cesium.Matrix3());
      Cesium.Matrix3.multiplyByVector(rotation, moonPosition, moonPosition);
      const origin = Cesium.Cartesian3.fromRadians(
        Math.atan2(-sun.y, -sun.x), Math.asin(-sun.z), height);
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(moonPosition, origin, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitude(right) < 1e-5) { right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Y, right); }
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      window.__m1.setSpaceView({ destination: origin, direction, up });
      for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
      await scene.context._device.queue.onSubmittedWorkDone();
      const pixels = window.__m1.pixels();
      const center = ((pixels.height >> 1) * pixels.width + (pixels.width >> 1)) * 4;
      return {
        name, height, center: Array.from(pixels.data.slice(center, center + 4)),
        cameraHeight: scene._planetState.cameraHeight,
        moonDistance: scene._planetState.moonDistance,
        moonAngularRadius: scene._planetState.moonAngularRadius,
        moonIllumination: scene._planetState.moonIllumination,
      };
    }, { name, height });
    report.altitudes.push(view);
    assert.ok(Math.abs(view.cameraHeight - height) < 0.01,
      `${name}: camera remains at the requested WGS84 geodetic height`);
    assert.ok(Math.max(...view.center.slice(0, 3)) > 35, `${view.name}: Moon remains visible in the real browser`);
    assert.ok(view.moonDistance > 3.0e8 && view.moonDistance < 4.5e8);
    assert.ok(view.moonAngularRadius > 0.0035 && view.moonAngularRadius < 0.0055);
    await captureM1Scene(page, report, output, `moon-stars-${view.name}`, view);
  }
  report.checks.push("ground, low-orbit and high-orbit browser views preserve lunar visibility and angular size");

  report.translation = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const camera = viewer.camera;
    const before = window.__m1.pixels();
    const baselineStars = [];
    for (let y = 0; y < before.height; ++y) {
      for (let x = 0; x < before.width; ++x) {
        if ((x - before.width / 2) ** 2 + (y - before.height / 2) ** 2 < 32 ** 2) { continue; }
        const offset = (y * before.width + x) * 4;
        if (before.data[offset] > 24 || before.data[offset + 1] > 24 || before.data[offset + 2] > 24) { baselineStars.push(y * before.width + x); }
      }
    }
    const direction = Cesium.Cartesian3.clone(camera.directionWC);
    const up = Cesium.Cartesian3.clone(camera.upWC);
    const destination = Cesium.Cartesian3.add(camera.positionWC,
      Cesium.Cartesian3.multiplyByScalar(direction, 100000, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    window.__m1.setSpaceView({ destination, direction, up });
    for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    const pixels = window.__m1.pixels();
    const starPixels = [];
    for (let y = 0; y < pixels.height; ++y) {
      for (let x = 0; x < pixels.width; ++x) {
        if ((x - pixels.width / 2) ** 2 + (y - pixels.height / 2) ** 2 < 32 ** 2) { continue; }
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset] > 24 || pixels.data[offset + 1] > 24 || pixels.data[offset + 2] > 24) { starPixels.push(y * pixels.width + x); }
      }
    }
    return { baselineStars, starPixels, moonIllumination: viewer.scene._planetState.moonIllumination };
  });
  const movedSet = new Set(report.translation.starPixels);
  assert.ok(report.translation.baselineStars.length >= 8, "translation starts with resolved stars");
  const stableStars = report.translation.baselineStars.filter((pixel) => movedSet.has(pixel)).length;
  assert.ok(stableStars / report.translation.baselineStars.length > 0.9,
    "100 km camera translation with fixed orientation preserves star screen positions");
  report.checks.push("100 km camera translation does not introduce star-field parallax");

  report.dayNight = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    viewer.clock.currentTime = Cesium.JulianDate.addHours(viewer.clock.currentTime, 12, new Cesium.JulianDate());
    for (let i = 0; i < 3; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    const pixels = window.__m1.pixels();
    let stars = 0;
    for (let y = 0; y < pixels.height; ++y) {
      for (let x = 0; x < pixels.width; ++x) {
        if ((x - pixels.width / 2) ** 2 + (y - pixels.height / 2) ** 2 < 32 ** 2) { continue; }
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset] > 24 || pixels.data[offset + 1] > 24 || pixels.data[offset + 2] > 24) { ++stars; }
      }
    }
    const observer = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3());
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(viewer.clock.currentTime);
    return { stars, solarElevation: Cesium.Cartesian3.dot(observer, sun) };
  });
  assert.ok(report.dayNight.solarElevation > 0, "the fixed ground track has advanced into daylight");
  assert.ok(report.dayNight.stars < report.sky.starPixels.length * 0.2,
    "procedural stars fade out as the local sky enters daylight");
  report.checks.push("star visibility transitions smoothly from night to day with the native solar direction");

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

  report.atmosphereMoonlightSetup = await installAtmosphereProbe(page);
  report.atmosphereMoonlight = await page.evaluate(async () => {
    const { viewer, setSpaceView } = window.__m1;
    const scene = viewer.scene;
    const probe = window.__m2Atmosphere;
    const time = Cesium.JulianDate.fromIso8601("2026-03-03T11:30:00Z");
    viewer.clock.currentTime = time;
    viewer.clock.shouldAnimate = false;
    await Cesium.CelestialFrameTransforms.preloadIcrfFixed(new Cesium.TimeInterval({
      start: time, stop: Cesium.JulianDate.addHours(time, 1, new Cesium.JulianDate()),
    }));
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(time);
    const nightNormal = Cesium.Cartesian3.negate(sun, new Cesium.Cartesian3());
    const origin = Cesium.Cartesian3.multiplyByScalar(
      nightNormal, Cesium.Ellipsoid.WGS84.maximumRadius + 2, new Cesium.Cartesian3());
    let right = Cesium.Cartesian3.cross(nightNormal, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(right) < 1e-5) {
      right = Cesium.Cartesian3.cross(nightNormal, Cesium.Cartesian3.UNIT_Y, right);
    }
    Cesium.Cartesian3.normalize(right, right);
    const up = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(right, nightNormal, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(8), aspectRatio: 800 / 450, near: 0.1, far: 1e9,
    });
    setSpaceView({ destination: origin, direction: nightNormal, up });
    scene.atmosphere.show = true;
    scene.sun.show = false;
    scene.stars.show = false;
    scene.moon.show = true;
    scene.moon.moonlightIntensity = 0;
    for (let i = 0; i < 4; ++i) {
      await new Promise(requestAnimationFrame);
      viewer.render();
    }
    await scene.context._device.queue.onSubmittedWorkDone();
    const row = probe.row({ direction: [nightNormal.x, nightNormal.y, nightNormal.z], distance: -1 });
    const withoutMoon = await probe.probe([row]);
    scene.moon.moonlightIntensity = 0.0025;
    viewer.render();
    await scene.context._device.queue.onSubmittedWorkDone();
    const withMoon = await probe.probe([row]);
    const moonElevation = Cesium.Cartesian3.dot(
      Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin, new Cesium.Cartesian3()),
      scene._planetState.moonDirectionWC);
    return {
      withoutMoon: withoutMoon[0].slice(0, 3),
      withMoon: withMoon[0].slice(0, 3),
      moonElevation,
      illumination: scene._planetState.moonIllumination,
      defaultIntensity: scene.moon.moonlightIntensity,
    };
  });
  report.atmosphereMoonlight.delta = report.atmosphereMoonlight.withMoon.map(
    (value, channel) => value - report.atmosphereMoonlight.withoutMoon[channel]);
  assert.ok(report.atmosphereMoonlight.moonElevation > 0.8,
    "Moon is above the night-side atmospheric sample");
  assert.equal(report.atmosphereMoonlight.defaultIntensity, 0.0025);
  assert.ok(report.atmosphereMoonlight.delta.every(Number.isFinite));
  assert.ok(report.atmosphereMoonlight.delta.some((value) => value > 1e-10),
    "production atmosphereIntegrate WGSL receives a measurable lunar-scattering contribution at default intensity");
  report.checks.push("production atmospheric integration includes a nonzero lunar-scattering contribution at default moonlight intensity");

  report.moonlight = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-03T11:30:00Z");
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(viewer.clock.currentTime);
    const longitude = Math.atan2(-sun.y, -sun.x);
    const latitude = Math.asin(-sun.z);
    const origin = Cesium.Cartesian3.fromRadians(longitude, latitude, 2);
    const direction = Cesium.Cartesian3.clone(sun);
    let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(right) < 1e-5) { right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Y, right); }
    Cesium.Cartesian3.normalize(right, right);
    const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(8), aspectRatio: 800 / 450, near: 0.1, far: 1000000 });
    window.__m1.setSpaceView({ destination: origin, direction, up });
    scene.globe.baseColor = new Cesium.Color(0.2, 0.2, 0.2, 1);
    scene.atmosphere.show = false;
    scene.sun.show = false;
    scene.stars.show = false;
    scene.moon.show = true;
    scene.moon.moonlightIntensity = 0;
    await window.__m1.settle({ timeout: 60000 });
    const off = window.__m1.pixels();
    scene.moon.moonlightIntensity = 0.0025;
    for (let i = 0; i < 4; ++i) { await new Promise(requestAnimationFrame); viewer.render(); }
    await scene.context._device.queue.onSubmittedWorkDone();
    const on = window.__m1.pixels();
    const offset = ((on.height >> 1) * on.width + (on.width >> 1)) * 4;
    return {
      off: Array.from(off.data.slice(offset, offset + 4)),
      on: Array.from(on.data.slice(offset, offset + 4)),
      intensity: scene.moon.moonlightIntensity,
      cameraHeight: scene._planetState.cameraHeight,
      moonElevation: Cesium.Cartesian3.dot(Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin, new Cesium.Cartesian3()), scene._planetState.moonDirectionWC),
      tilesLoaded: scene.globe.tilesLoaded,
      statistics: scene.debugStatistics,
    };
  });
  assert.ok(report.moonlight.cameraHeight > 0 && report.moonlight.cameraHeight < 20,
    "night-side browser fixture is at ground level");
  assert.ok(report.moonlight.moonElevation > 0.8, "full Moon is above the night-side horizon");
  assert.equal(report.moonlight.intensity, 0.0025);
  assert.ok(report.moonlight.on.slice(0, 3).some((value, channel) => value > report.moonlight.off[channel]),
    "default moonlight intensity measurably brightens actual night-side terrain pixels");
  report.checks.push("default 0.0025 moonlight intensity measurably brightens actual night-side terrain pixels");

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
