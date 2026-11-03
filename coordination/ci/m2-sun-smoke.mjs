/* global Cesium, window, setTimeout, performance, requestAnimationFrame */
import assert from "node:assert/strict";
import process from "node:process";
import {
  runM1BrowserSuite,
  installM1Scene,
  captureM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";
import { trackAtmosphereResources } from "./m2-atmosphere-fixtures.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-sun";

// The HDR scene attachment and all celestial contributions are scene-linear.
// Reproduce the production display transform independently: exposure, fitted
// ACES, then one IEC sRGB encode. Never decode the RGBA16Float scene attachment.
const encodeSrgb = (value) => value <= 0.0031308
  ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
const toneMapACES = (value, exposure) => {
  const x = Math.max(0, value) * exposure;
  return Math.min(1, Math.max(0,
    (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
};
const displayChannel = (linear, exposure) =>
  Math.round(encodeSrgb(toneMapACES(linear, exposure)) * 255);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Compare physical scene-linear solar contribution, not the difference of
// tone-mapped display pixels (ACES is nonlinear and compresses highlights).
const solarDelta = (sample) => sample.gpu.slice(0, 3).map(
  (radiance, channel) => radiance * sample.gpu[4 + channel],
);

function assertComposite(sample, label) {
  assert.ok(sample.gpu.every(Number.isFinite), `${label}: finite production WGSL values`);
  assert.ok(sample.gpu.slice(0, 3).every((value) => value >= 0), `${label}: nonnegative solar radiance`);
  assert.ok(sample.gpu[3] >= 0 && sample.gpu[3] <= 1.000001, `${label}: bounded disk coverage`);
  assert.ok(sample.gpu.slice(4, 7).every((value) => value >= 0 && value <= 1.000001), `${label}: physical transmittance`);
  assert.ok(Number.isFinite(sample.exposure) && sample.exposure >= 0.01 && sample.exposure <= 16,
    `${label}: valid production exposure`);
  const expected = [];
  for (let channel = 0; channel < 3; ++channel) {
    // The probe supplies linear HDR scene color, solar radiance, transmittance
    // and atmospheric in-scattering from the production WGSL.
    const linear = (sample.gpu[12 + channel] + sample.gpu[channel]) *
      sample.gpu[4 + channel] + sample.gpu[8 + channel];
    expected.push(displayChannel(linear, sample.exposure));
    assert.ok(Math.abs(sample.displayed[channel] - expected[channel]) <= 3,
      `${label}: actual canvas channel ${channel}: ${sample.displayed[channel]} vs ${expected[channel]}`);
    assert.ok(Math.abs(sample.gpu[16 + channel] - sample.nativeRay[channel]) < 1e-6,
      `${label}: production solar ray matches the native camera`);
  }
  assert.equal(sample.displayed[3], 255, `${label}: opaque canvas`);
  sample.expectedComposite = expected;
}

function assertDisk(observation, label) {
  assert.equal(observation.reference.mismatches, 0,
    `${label}: native angular/ellipsoid geometry disagrees: ${JSON.stringify(observation.reference.examples)}`);
  assert.ok(observation.reference.visible > 100 && observation.reference.hidden > 0,
    `${label}: independent reference contains both disk and surrounding sky`);
  assert.ok(observation.mask.count > 300, `${label}: an actual resolved disk is visible`);
  assert.ok(distance(observation.mask.centroid, observation.expectedCenter) <= 1.5,
    `${label}: Sun center follows the native direction projection`);
  assert.ok(observation.mask.diameterDegrees >= 0.50 && observation.mask.diameterDegrees <= 0.57,
    `${label}: observed diameter ${observation.mask.diameterDegrees} degrees is approximately 0.53 degrees`);
  const [left, top, right, bottom] = observation.mask.bounds;
  assert.ok(Math.abs((right - left) - (bottom - top)) <= 2, `${label}: disk is round in square pixels`);
  for (const sample of observation.samples) { assertComposite(sample, label); }
}

// Eight aggregate checks target the new solar risks. M2.1/M2.2 retain their
// numerical, atmosphere and surface coverage; this suite does not repeat them.
await runM1BrowserSuite("m2-sun", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await trackAtmosphereResources(page);
  await installM1Scene(page, { baseLayer: false });
  report.setup = await installSunProbe(page);
  assert.deepEqual(report.setup.coldSun.errors, []);
  assert.ok(report.setup.coldSun.center.slice(0, 3).every((value) => value >= 250),
    "a first real sun-only frame works before any atmosphere LUT is created");
  assert.equal(report.setup.coldSun.center[3], 255);
  assert.deepEqual(report.setup.coldSun.corner, [0, 0, 0, 255], "cold sun-only rendering preserves surrounding sky");

  report.altitudes = [];
  for (const [name, height] of [["ground", 2], ["low-orbit", 400000], ["high-orbit", 35786000]]) {
    const observation = await page.evaluate(async (height) => {
      const state = window.__m2Sun;
      state.reset();
      state.setElevation(height, 60);
      // A sky-facing camera deliberately has no terrain draw requirement.
      return state.observe();
    }, height);
    report.altitudes.push({ name, height, observation });
    assertDisk(observation, name);
    assert.equal(observation.samples[0].gpu[7], 0, `${name}: unobscured Sun has real clear depth`);
    assert.equal(observation.samples[0].ellipsoid, null, `${name}: native ray misses Earth`);
    for (let channel = 0; channel < 3; ++channel) {
      assert.ok(Math.abs(observation.samples[0].gpu[20 + channel] - observation.nativeSun[channel]) < 1e-7,
        `${name}: actual GPU solar direction agrees with native ephemerides`);
    }
    await captureM1Scene(page, report, output, `${name}-sun`, { height, observation });
  }
  const diameters = report.altitudes.map(({ observation }) => observation.mask.diameterDegrees);
  assert.ok(Math.max(...diameters) - Math.min(...diameters) < 0.025,
    "camera translation from ground to high orbit preserves the apparent solar angle");
  report.checks.push("production WGSL and actual canvas show native solar position and a 0.53-degree disk at 2 m, 400 km and 35,786 km");

  report.time = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    const before = await state.observe();
    viewer.clock.currentTime = Cesium.JulianDate.addMinutes(state.fixedTime, 4, new Cesium.JulianDate());
    const after = await state.observe();
    return { before, after };
  });
  assertDisk(report.time.before, "fixed-camera initial time");
  assertDisk(report.time.after, "fixed-camera four minutes later");
  assert.ok(distance(report.time.before.expectedCenter, report.time.after.expectedCenter) > 20,
    "the ephemeris change is large enough to be resolved in the actual canvas");
  assert.ok(distance(report.time.before.mask.centroid, report.time.after.mask.centroid) > 20,
    "advancing scene time actually moves the disk without moving the camera");
  await captureM1Scene(page, report, output, "sun-four-minutes-later", report.time);
  report.checks.push("fixed camera and a four-minute scene-time advance visibly follow independent native solar projection");

  const limb = await page.evaluate(() => {
    const state = window.__m2Sun;
    state.reset();
    return { elevation: state.limbElevation(400000), radius: Cesium.Math.toDegrees(window.__m1.viewer.scene.sun.angularRadius) };
  });
  report.limb = [];
  for (const offset of [1.2, 0.6, 0, -0.6, -1.2]) {
    const observation = await page.evaluate(async ({ elevation, radius, offset }) => {
      const state = window.__m2Sun;
      state.setElevation(400000, elevation + offset * radius);
      return state.observe();
    }, { ...limb, offset });
    report.limb.push({ offset, observation });
    assert.equal(observation.reference.mismatches, 0,
      `limb ${offset}: independent WGS84 per-pixel mask: ${JSON.stringify(observation.reference.examples)}`);
    for (const sample of observation.samples) { assertComposite(sample, `limb ${offset}`); }
    if ([1.2, 0, -1.2].includes(offset)) {
      await captureM1Scene(page, report, output, `limb-${offset}`, { offset, observation });
    }
  }
  const areas = report.limb.map(({ observation }) => observation.mask.count);
  assert.ok(areas[0] > report.altitudes[1].observation.mask.count * 0.85, "first limb view has a complete disk");
  for (let index = 1; index < areas.length; ++index) {
    assert.ok(areas[index - 1] - areas[index] > areas[0] * 0.03, "visible area decreases over each resolved limb step");
  }
  assert.ok(areas[1] > 0 && areas[1] < areas[0] && areas[3] > 0 && areas[3] < areas[2],
    "both sides of the halfway point contain partial disks");
  assert.ok(areas[2] / areas[0] > 0.3 && areas[2] / areas[0] < 0.7, "central limb view contains about half a disk");
  assert.equal(areas[4], 0, "disk fully disappears behind Earth");
  assert.ok(report.limb[4].observation.maxDelta <= 2, "fully hidden Sun changes no actual canvas pixels");
  report.horizon = [];
  for (const offset of [1.2, 0, -1.2]) {
    const observation = await page.evaluate(async (offset) => {
      const state = window.__m2Sun;
      const radius = Cesium.Math.toDegrees(window.__m1.viewer.scene.sun.angularRadius);
      state.setElevation(2, state.limbElevation(2) + offset * radius);
      return state.observe();
    }, offset);
    report.horizon.push({ offset, observation });
    assert.equal(observation.reference.mismatches, 0, `2 m horizon ${offset}: native WGS84 mask agrees`);
    for (const sample of observation.samples) { assertComposite(sample, `ground horizon ${offset}`); }
    if (offset === 0) {
      await captureM1Scene(page, report, output, "ground-horizon-half-sun", { offset, observation });
    }
  }
  const horizonAreas = report.horizon.map(({ observation }) => observation.mask.count);
  assert.ok(horizonAreas[0] > 500 && horizonAreas[1] > horizonAreas[0] * 0.3 && horizonAreas[1] < horizonAreas[0] * 0.7,
    "a camera only 2 m above Earth sees a whole and partially occulted disk without a center visibility switch");
  assert.equal(horizonAreas[2], 0, "Sun disappears below the actual ground horizon");
  report.checks.push("orbital limb and 2 m ground horizon give whole disks, progressive partial occultation and complete disappearance");

  report.terrain = {};
  report.terrain.view = await page.evaluate(() => {
    const state = window.__m2Sun;
    state.reset();
    return state.prepareMountain();
  });
  report.terrain.settled = await page.evaluate(() => window.__m1.settle());
  report.terrain.blocked = await page.evaluate(() => window.__m2Sun.observe({ geometry: false }));
  const mountain = report.terrain.blocked.samples[0];
  assertComposite(mountain, "foreground native heightmap mountain");
  assert.equal(mountain.ellipsoid, null, "the solar ray independently misses analytic WGS84 Earth");
  assert.ok(mountain.pickedDistance > 0 && mountain.pickedHeight > 5000,
    "native rendered-mesh pick intersects the real elevated mountain");
  assert.ok(mountain.gpu[7] > 0 && mountain.gpu[7] <= 1 && mountain.gpu[11] > 0,
    "actual terrain depth supplies a forward occluder");
  assert.ok(mountain.gpu[3] > 0.9, "the occluded sample lies in the solar disk interior");
  assert.ok(mountain.gpu.slice(0, 3).every((value) => value < 1e-7), "production Sun respects actual foreground terrain");
  assert.ok(mountain.displayed.slice(0, 3).every((value, channel) => Math.abs(value - mountain.withoutSun[channel]) <= 2),
    "Sun toggle leaves the actual foreground mountain pixel unchanged");
  await captureM1Scene(page, report, output, "sun-behind-real-mountain", report.terrain);
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain; });
  report.terrain.controlSettled = await page.evaluate(async () => {
    const { viewer, errors } = window.__m1;
    const start = performance.now();
    let stable = 0;
    let frames = 0;
    while (performance.now() - start < 90000) {
      viewer.render();
      ++frames;
      if (errors.length) { throw new Error(errors.join("\n")); }
      // The restored native terrain may leave only sky in a narrow view. Its
      // real load queue must settle, but a draw-call count is not a sky gate.
      stable = viewer.scene.globe.tilesLoaded ? stable + 1 : 0;
      if (stable >= 3) {
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
        return { frames, elapsedMs: performance.now() - start };
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error("Original terrain did not settle after removing the mountain");
  });
  report.terrain.clear = await page.evaluate(() => window.__m2Sun.observe());
  const clearMountain = report.terrain.clear.samples[0];
  assertComposite(clearMountain, "same solar ray after restoring ordinary terrain");
  assert.equal(clearMountain.ellipsoid, null);
  assert.equal(clearMountain.pickedDistance, null, "the original terrain no longer intersects the same solar ray");
  assert.equal(clearMountain.gpu[7], 0);
  assert.ok(clearMountain.gpu[0] > 0.9 && solarDelta(clearMountain)[0] > 0.8,
    "removing only the real elevated terrain restores the visible disk");
  // Regression for a real subpixel ridge: bilinear source-visibility alone
  // borrowed sky outside the hidden disk and produced a 13/255 detached halo.
  await page.setViewportSize({ width: 320, height: 180 });
  report.terrain.haloView = await page.evaluate(() => {
    const { viewer } = window.__m1;
    const state = window.__m2Sun;
    viewer.resize();
    state.reset();
    const view = state.prepareMountain(3500);
    viewer.camera.frustum.fov = Cesium.Math.toRadians(60);
    return view;
  });
  report.terrain.haloSettled = await page.evaluate(() => window.__m1.settle());
  report.terrain.haloPhases = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    const phases = [];
    for (const offset of [-0.5, -0.25, 0, 0.25, 0.45]) {
      const frustum = viewer.camera.frustum;
      frustum.yOffset = offset * 2 * frustum.near * Math.tan(frustum.fovy / 2) / viewer.canvas.height;
      viewer.scene.sun.glowStrength = 0;
      const disk = await state.observe({ geometry: false });
      viewer.scene.sun.glowStrength = 0.25;
      const halo = await state.observe({ geometry: false });
      phases.push({ offset, diskDelta: disk.maxDelta, haloDelta: halo.maxDelta, center: disk.samples[0] });
    }
    return phases;
  });
  const hiddenPhases = report.terrain.haloPhases.filter((phase) => phase.diskDelta === 0);
  assert.ok(hiddenPhases.length > 0, "real mountain completely hides the disk in a resolved subpixel alignment");
  for (const phase of hiddenPhases) {
    assert.equal(phase.center.ellipsoid, null, "this halo regression needs actual mountain depth, not analytic Earth");
    assert.ok(phase.center.gpu[7] > 0 && phase.center.pickedDistance > 0, "real terrain blocks the source");
    assert.equal(phase.haloDelta, 0, "a fully hidden disk cannot borrow adjacent sky to produce a detached halo");
  }
  await page.setViewportSize({ width: 640, height: 360 });
  await page.evaluate(() => {
    window.__m1.viewer.resize();
    window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain;
  });
  report.checks.push("real heightmap depth hides a ray that misses Earth, restoring terrain reveals it, and fully hidden subpixel disks produce no detached halo");

  report.photometry = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { scene } = window.__m1.viewer;
    state.reset();
    scene.atmosphere.show = true;
    scene.atmosphere.lightIntensity = 1;
    state.setElevation(2, 60);
    const high = await state.observe({ geometry: false });
    state.setElevation(2, 5);
    const low = await state.observe({ geometry: false });
    scene.atmosphere.show = false;
    state.setElevation(400000, 60);
    const one = await state.observe({ geometry: false });
    scene.atmosphere.lightIntensity = 2;
    const two = await state.observe({ geometry: false });
    scene.atmosphere.lightIntensity = 0;
    const zero = await state.observe({ geometry: false });
    return { high, low, one, two, zero };
  });
  for (const [name, observation] of Object.entries(report.photometry)) {
    assertComposite(observation.samples[0], `photometry ${name}`);
  }
  const high = report.photometry.high.samples[0];
  const low = report.photometry.low.samples[0];
  assert.ok(high.displayed.slice(0, 3).every((value) => value < 245) && low.displayed.slice(0, 3).every((value) => value < 245),
    "transmittance comparisons use unsaturated actual pixels");
  assert.ok(low.gpu[4] < high.gpu[4] && low.gpu[6] < low.gpu[4] * 0.8,
    "low-elevation production transport attenuates the Sun and removes more blue than red");
  const highDelta = solarDelta(high);
  const lowDelta = solarDelta(low);
  assert.ok(lowDelta.reduce((sum, value) => sum + value, 0) < highDelta.reduce((sum, value) => sum + value, 0) * 0.8,
    "actual low Sun is dimmer after subtracting the same atmosphere without Sun");
  assert.ok(lowDelta[2] < lowDelta[0] * 0.8, "actual atmospheric solar extinction visibly reddens the disk");
  const one = report.photometry.one.samples[0];
  const two = report.photometry.two.samples[0];
  for (let channel = 0; channel < 3; ++channel) {
    assert.ok(Math.abs(two.gpu[channel] - one.gpu[channel] * 2) < 1e-6,
      "one shared solar irradiance controls the actual disk linearly");
    assert.ok(two.displayed[channel] > one.displayed[channel] + 10,
      "changing irradiance visibly changes the unsaturated actual Sun");
  }
  assert.ok(report.photometry.zero.maxDelta <= 1, "zero shared irradiance contributes no solar pixels");
  await page.evaluate(() => {
    const state = window.__m2Sun;
    state.reset();
    window.__m1.viewer.scene.atmosphere.show = true;
    window.__m1.viewer.scene.atmosphere.lightIntensity = 1;
    state.setElevation(2, 5);
  });
  await captureM1Scene(page, report, output, "ground-low-sun-atmosphere", report.photometry.low);
  report.checks.push("actual atmosphere reddens and attenuates the disk; shared irradiance visibly scales it and zero removes it");

  report.controls = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    state.reset();
    state.setElevation(400000, 60);
    viewer.scene.atmosphere.show = true;
    const atmosphereOn = await state.observe({ geometry: false });
    viewer.scene.atmosphere.show = false;
    const sunOnly = await state.observe();
    viewer.scene.sun.show = false;
    const bothOff = window.__m1.pixels();
    const center = state.centerPixel();
    const offset = (center[1] * bothOff.width + center[0]) * 4;
    const disabledPixel = Array.from(bothOff.data.slice(offset, offset + 4));
    const direction = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(state.nativeSun(), Math.cos(0.025), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(viewer.camera.rightWC, Math.sin(0.025), new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    state.look(Cesium.Cartesian3.clone(viewer.camera.positionWC), direction);
    const rotated = await state.observe();
    state.oldDepth = viewer.scene.context.sceneDepthTexture;
    state.oldColor = viewer.scene.context.sceneColorTexture;
    return { atmosphereOn, sunOnly, disabledPixel, rotated };
  });
  assertComposite(report.controls.atmosphereOn.samples[0], "Sun with atmosphere enabled");
  assertDisk(report.controls.sunOnly, "Sun with atmosphere disabled");
  assert.deepEqual(report.controls.disabledPixel, [0, 0, 0, 255], "disabling both effects restores the original black sky");
  assertDisk(report.controls.rotated, "rotated camera");
  assert.ok(distance(report.controls.sunOnly.expectedCenter, report.controls.rotated.expectedCenter) > 50,
    "camera control moves the Sun to a different resolved screen position");
  await page.setViewportSize({ width: 800, height: 450 });
  report.resize = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    viewer.resize();
    const observation = await state.observe();
    const context = viewer.scene.context;
    const destroyed = (resource) => window.__m2AtmosphereAllocations.find((row) => row.resource === resource)?.destroyed;
    return {
      observation,
      replacedDepth: state.oldDepth !== context.sceneDepthTexture,
      replacedColor: state.oldColor !== context.sceneColorTexture,
      oldDepthDestroyed: destroyed(state.oldDepth), oldColorDestroyed: destroyed(state.oldColor),
      depthSize: [context.sceneDepthTexture.width, context.sceneDepthTexture.height],
      colorSize: [context.sceneColorTexture.width, context.sceneColorTexture.height],
    };
  });
  assertDisk(report.resize.observation, "resized solar disk");
  assert.equal(report.resize.replacedDepth, true);
  assert.equal(report.resize.replacedColor, true);
  assert.equal(report.resize.oldDepthDestroyed, true);
  assert.equal(report.resize.oldColorDestroyed, true);
  assert.deepEqual(report.resize.depthSize, [800, 450]);
  assert.deepEqual(report.resize.colorSize, [800, 450]);
  const expectedArea = report.controls.rotated.mask.count * (800 / 640) ** 2;
  assert.ok(Math.abs(report.resize.observation.mask.count - expectedArea) < expectedArea * 0.12,
    "resizing changes raster area by pixel scale while preserving the solar angle");
  await captureM1Scene(page, report, output, "resized-off-axis-sun", report.resize);
  report.checks.push("independent atmosphere/Sun controls, camera rotation and resize preserve position, angular size and current color/depth bindings");

  report.halo = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { scene } = window.__m1.viewer;
    state.reset();
    state.setElevation(400000, 60);
    scene.sun.glowStrength = state.defaults.glowStrength;
    const pixels = [state.centerPixel(), state.pixelAtAngle(scene.sun.angularRadius * 2), state.pixelAtAngle(scene.sun.glowRadius * 1.2)];
    const visible = await state.observe({ geometry: false, pixels });
    scene.atmosphere.lightIntensity = 20;
    const bright = await state.observe({ geometry: false, pixels });
    scene.atmosphere.lightIntensity = 10;
    state.setElevation(400000, state.limbElevation(400000) - Cesium.Math.toDegrees(scene.sun.angularRadius) * 1.5);
    const hidden = await state.observe({ geometry: false });
    return { visible, bright, hidden };
  });
  for (const [name, observation] of Object.entries(report.halo)) {
    for (const sample of observation.samples) { assertComposite(sample, `halo ${name}`); }
  }
  const [core, halo, outside] = report.halo.visible.samples;
  assert.ok(halo.gpu[0] > 0 && halo.gpu[0] < core.gpu[0] * 0.1, "glare outside the disk is finite and restrained");
  assert.ok(halo.displayed[0] > halo.withoutSun[0] + 3, "restrained glare is present in actual canvas pixels");
  assert.ok(outside.gpu.slice(0, 3).every((value) => value < 1e-7), "the declared outer glare radius has compact support");
  assert.ok(outside.displayed.slice(0, 3).every((value, channel) => Math.abs(value - outside.withoutSun[channel]) <= 1),
    "glare leaves actual distant sky pixels unchanged");
  assert.ok(report.halo.bright.samples[0].gpu[0] > 1, "the production path retains finite solar values above one before display encoding");
  assert.ok(report.halo.hidden.maxDelta <= 2 && report.halo.hidden.changedPixels === 0,
    "a completely occulted disk cannot leave an unphysical detached halo");
  report.checks.push("real solar highlights and restrained finite glare have bounded support and vanish when the entire source is occulted");

  report.loss = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer, errors } = window.__m1;
    const beforeErrors = [...errors];
    state.renderer = viewer.scene._atmosphere;
    const device = viewer.scene.context._device;
    await device.queue.onSubmittedWorkDone();
    viewer.useDefaultRenderLoop = true;
    device.destroy();
    await device.lost;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { beforeErrors, errors: [...errors], stopped: !viewer.useDefaultRenderLoop };
  });
  assert.deepEqual(report.loss.beforeErrors, [], "all normal solar rendering has zero scene/GPU errors");
  assert.equal(report.loss.errors.length, 1, "the actual device loss is surfaced exactly once");
  assert.match(report.loss.errors[0], /device lost/i);
  assert.equal(report.loss.stopped, true, "device loss stops the rendering loop");
  report.cleanup = await destroyM1Scene(page);
  report.nativeResources = await page.evaluate(() => {
    const rows = window.__m2AtmosphereAllocations;
    return {
      created: rows.length,
      destroyed: rows.filter((row) => row.destroyed).length,
      buffers: rows.filter((row) => row.kind === "Buffer").length,
      textures: rows.filter((row) => row.kind === "Texture").length,
      live: rows.filter((row) => !row.destroyed).map(({ kind, label }) => ({ kind, label })),
      atmosphere: { ...window.__m2Sun.renderer.statistics },
    };
  });
  assert.ok(report.nativeResources.buffers > 0 && report.nativeResources.textures > 0);
  assert.equal(report.nativeResources.created, report.nativeResources.destroyed);
  assert.deepEqual(report.nativeResources.live, []);
  assert.equal(report.nativeResources.atmosphere.buffersCreated, report.nativeResources.atmosphere.buffersDestroyed);
  assert.equal(report.nativeResources.atmosphere.texturesCreated, report.nativeResources.atmosphere.texturesDestroyed);
  report.checks.push("actual GPU loss stops rendering and teardown releases every native buffer/texture, resized target and probe readback");
  assert.equal(report.checks.length, 8);
});
