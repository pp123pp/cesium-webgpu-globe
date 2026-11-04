/* global Cesium, window */
import assert from "node:assert/strict";
import process from "node:process";
import {
  balanceLongPathAtmosphere,
  terrainSurfaceLighting,
} from "./m2-composite-reference.mjs";
import {
  runM1BrowserSuite,
  installM1Scene,
  captureM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";
import {
  installAtmosphereProbe,
  trackAtmosphereResources,
} from "./m2-atmosphere-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-atmosphere";

function assertPhysical(row, label) {
  assert.ok(row.every(Number.isFinite), `${label}: finite GPU values`);
  for (let channel = 0; channel < 3; ++channel) {
    assert.ok(row[channel] >= 0, `${label}: nonnegative radiance`);
    assert.ok(
      row[channel + 4] >= 0 && row[channel + 4] <= 1.000001,
      `${label}: transmittance in [0, 1]`,
    );
  }
}

const energy = (row) => row[0] + row[1] + row[2];
const near = (actual, expected, absolute, relative = 0) =>
  Math.abs(actual - expected) <= absolute + relative * Math.abs(expected);

async function settleAtmosphereView(page, view) {
  return page.evaluate(async (view) => {
    const state = window.__m1;
    const atmosphere = state.viewer.scene.atmosphere;
    const show = atmosphere.show;
    let settled;
    // Loading is gated by terrain/imagery, not intermediate sky pixels. Keep
    // full-resolution transport for the actual numerical/pixel assertions.
    atmosphere.show = false;
    try {
      settled = await state.settle(view);
    } finally {
      atmosphere.show = show;
    }
    state.viewer.render();
    return { ...settled, atmosphereDuringLoad: false };
  }, view);
}

// Independently reproduce the production display transform. sceneColor is
// RGBA16Float scene-linear HDR (not sRGB); atmosphere transport is composed in
// linear space, then the shared manual-exposure ACES curve and sRGB encoding
// are applied exactly once at the final display output.
const encodeSrgb = (value) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
const toneMapACES = (value, exposure = 1) => {
  const x = Math.max(0, value) * exposure;
  return Math.min(
    1,
    Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)),
  );
};
const displayChannel = (linear, exposure = 1) =>
  Math.round(encodeSrgb(toneMapACES(linear, exposure)) * 255);

function assertComposite(sample, label) {
  assertPhysical(sample.gpu, label);
  const surfaceLighting = sample.surfaceNormal && sample.surfaceLightingEnabled
    ? terrainSurfaceLighting(sample.sunCosine, sample.surfaceHeight ?? sample.pickedHeight, sample.atmosphereEnabled, sample.lightIntensity)
    : [1, 1, 1];
  const atmosphereComposite = [0, 1, 2].map(
    (channel) => sample.gpu[16 + channel] * surfaceLighting[channel] * sample.gpu[4 + channel] + sample.gpu[channel],
  );
  const balanced = balanceLongPathAtmosphere(atmosphereComposite, sample.gpu.slice(4, 7));
  const expected = balanced.map((linear) => displayChannel(linear));
  for (let channel = 0; channel < 3; ++channel) {
    assert.ok(
      Math.abs(sample.displayed[channel] - expected[channel]) <= 3,
      `${label}: canvas channel ${channel} is ${sample.displayed[channel]}, expected ${expected[channel]}`,
    );
  }
  assert.equal(sample.displayed[3], 255, `${label}: opaque composite`);
  sample.expectedComposite = expected;
}

// Eight aggregate checks cover the new scattering/compositing risks. M2.1 owns
// the exhaustive shared-math boundary cases; this suite reuses that contract.
await runM1BrowserSuite("m2-atmosphere", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await trackAtmosphereResources(page);
  await installM1Scene(page);
  report.setup = await installAtmosphereProbe(page);
  assert.equal(report.setup.settings.show, true);
  assert.equal(report.setup.settings.lightIntensity, 10);
  assert.equal(report.setup.settings.multipleScatteringStrength, 1);
  assert.deepEqual(report.setup.buffers, [272, 112]);
  assert.deepEqual(report.setup.lutFormats, ["rgba16float", "rgba16float"]);
  report.luts = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    state.setView({ ...state.sunLocation(), height: 2, pitch: 90 });
    const coordinates = [];
    for (const v of [0, 0.5, 1]) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        coordinates.push([u, v]);
      }
    }
    const gpu = await state.probe(
      coordinates.map((lutUv) => state.row({ lutUv })),
    );
    return gpu.map((row, index) => ({
      uv: coordinates[index],
      transmittance: row.slice(24, 27),
      multipleScattering: row.slice(28, 31),
    }));
  });
  for (const sample of report.luts) {
    assert.ok(sample.transmittance.every((value) => Number.isFinite(value) && value >= 0 && value <= 1.001));
    assert.ok(sample.multipleScattering.every((value) => Number.isFinite(value) && value >= 0));
  }
  assert.ok(report.luts.some((sample) => sample.transmittance.some((value) => value < 0.95)));
  assert.ok(report.luts.some((sample) => sample.multipleScattering.some((value) => value > 1e-8)));
  report.checks.push("production WGSL compiles and actual transmittance/multiple-scattering LUT values are finite and physical");

  report.extinction = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    state.restore();
    const day = state.sunLocation();
    state.setView({ ...day, height: 2, pitch: 90 });
    const distances = [0, 1000, 10000, -1];
    const rows = distances.map((distance) =>
      state.row({ direction: day.sun, distance }),
    );
    const normal = await state.probe(rows);
    const a = viewer.scene.atmosphere;
    a.rayleighScattering = a.rayleighScattering.map((value) => value * 2);
    a.mieExtinction *= 2;
    viewer.render();
    const stronger = await state.probe(rows);
    state.restore();
    // At the equator, radial ellipsoid height along the outward normal is
    // exactly h0 + t. This supplies an independent analytic meter-unit check
    // across the real shader's uniform packing and nonuniform quadrature.
    state.setView({ longitude: day.longitude, latitude: 0, height: 2, pitch: 90 });
    const longitude = Cesium.Math.toRadians(day.longitude);
    const vertical = (await state.probe([state.row({
      direction: [Math.cos(longitude), Math.sin(longitude), 0],
    })]))[0];
    return { distances, normal, stronger, vertical };
  });
  for (const [index, distance] of report.extinction.distances.entries()) {
    const normal = report.extinction.normal[index];
    const stronger = report.extinction.stronger[index];
    assertPhysical(normal, `normal extinction, ${distance} m`);
    assertPhysical(stronger, `stronger extinction, ${distance} m`);
    for (let channel = 0; channel < 3; ++channel) {
      if (distance === 0) {
        assert.equal(normal[channel], 0, "zero path has no in-scattering");
        assert.equal(normal[channel + 4], 1, "zero path has unit transmittance");
        assert.equal(stronger[channel], 0);
        assert.equal(stronger[channel + 4], 1);
      } else {
        assert.ok(stronger[channel + 4] < normal[channel + 4], "increased extinction decreases transmittance");
        assert.ok(near(stronger[channel + 4], normal[channel + 4] ** 2, 0.003, 0.01), "doubling extinction obeys Beer-Lambert attenuation");
        assert.ok(normal[channel + 4] < report.extinction.normal[index - 1][channel + 4], "longer visible paths attenuate more strongly");
      }
    }
  }
  for (let channel = 0; channel < 3; ++channel) {
    const settings = report.setup.settings;
    const column = (scaleHeight) => scaleHeight * (Math.exp(-2 / scaleHeight) - Math.exp(-100000 / scaleHeight));
    const opticalDepth = settings.rayleighScattering[channel] * column(settings.rayleighScaleHeight) +
      settings.mieExtinction * column(settings.mieScaleHeight);
    assert.ok(near(report.extinction.vertical[channel + 4], Math.exp(-opticalDepth), 0.001), "GPU meter-based vertical extinction matches the independent exponential-column integral");
  }
  report.checks.push("GPU zero-path identity, finite nonnegative scattering, path-length attenuation and increased-extinction response");

  report.solar = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    state.restore();
    const day = state.sunLocation();
    const observations = [];
    for (const [name, offset] of [["day", 0], ["terminator", 90], ["night", 180]]) {
      const location = state.sunLocation(offset);
      if (name === "night") {
        location.latitude = -day.latitude;
      }
      state.setView({ ...location, height: 2, pitch: 90 });
      const gpu = (await state.probe([state.row()]))[0];
      const sample = Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 10000);
      const solarRay = new Cesium.Ray(sample, new Cesium.Cartesian3(...day.sun));
      observations.push({
        name,
        location,
        gpu,
        earthOccludesSun: Cesium.WebGPUPlanetMath.intersectEllipsoid(solarRay) !== undefined,
      });
    }
    return { observations, anisotropy: viewer.scene.atmosphere.mieAnisotropy };
  });
  for (const sample of report.solar.observations) {
    assertPhysical(sample.gpu, sample.name);
  }
  const [daylight, terminator, night] = report.solar.observations;
  assert.equal(daylight.earthOccludesSun, false);
  assert.equal(night.earthOccludesSun, true);
  assert.ok(energy(daylight.gpu) > 1e-4, "daylight atmosphere scatters actual sunlight");
  assert.ok(energy(night.gpu) < energy(daylight.gpu) * 0.02 + 1e-7, "solid Earth suppresses deep-night solar scattering");
  assert.ok(energy(terminator.gpu) > energy(night.gpu) + 1e-7, "terminator differs from Earth's deep shadow");
  const phases = daylight.gpu.slice(20, 24);
  const g = report.solar.anisotropy;
  assert.ok(near(phases[0], 3 / (8 * Math.PI), 1e-7));
  assert.ok(near(phases[1], 3 / (16 * Math.PI), 1e-7));
  assert.ok(g > 0 && phases[2] > phases[3] * 10, "positive Mie g scatters toward the Sun, not away from it");
  assert.ok(near(phases[2] / phases[3], ((1 + g) / (1 - g)) ** 3, 0.01, 0.001), "GPU forward/back phase ratio has the physical sign");
  report.checks.push("GPU Rayleigh/Mie phase direction and real Earth solar occlusion distinguish day, terminator and deep night");

  report.dependencies = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    const renderer = viewer.scene._atmosphere;
    state.restore();
    const day = state.sunLocation();
    const settings = viewer.scene.atmosphere;
    settings.multipleScatteringStrength = 0;
    state.setView({ ...day, height: 2, pitch: 90 });
    const startBuilds = renderer.statistics.lutBuilds;
    const single = (await state.probe([state.row()]))[0];
    settings.multipleScatteringStrength = 1;
    viewer.render();
    const multiple = (await state.probe([state.row()]))[0];
    settings.lightIntensity *= 2;
    viewer.render();
    const doubledLight = (await state.probe([state.row()]))[0];
    viewer.clock.currentTime = Cesium.JulianDate.addHours(state.fixedTime, 1, new Cesium.JulianDate());
    state.setView({ ...day, height: 400000, pitch: -30 });
    const unchangedBuilds = renderer.statistics.lutBuilds;
    state.restore();
    state.setView({ ...day, height: 2, pitch: 90 });
    const beforeMedium = (await state.probe([state.row()]))[0];
    const beforeMediumBuilds = renderer.statistics.lutBuilds;
    settings.rayleighScattering[2] *= 1.25;
    viewer.render();
    const afterMedium = (await state.probe([state.row()]))[0];
    const afterMediumBuilds = renderer.statistics.lutBuilds;
    state.restore();
    viewer.render();
    return { single, multiple, doubledLight, startBuilds, unchangedBuilds, beforeMedium, afterMedium, beforeMediumBuilds, afterMediumBuilds };
  });
  const dependency = report.dependencies;
  for (const key of ["single", "multiple", "doubledLight", "beforeMedium", "afterMedium"]) {
    assertPhysical(dependency[key], key);
  }
  assert.ok(energy(dependency.multiple) > energy(dependency.single) + 1e-7, "approximate multiple scattering adds radiance");
  for (let channel = 0; channel < 3; ++channel) {
    assert.ok(near(dependency.multiple[channel + 4], dependency.single[channel + 4], 1e-7), "multiple scattering does not change extinction");
    assert.ok(near(dependency.doubledLight[channel], 2 * dependency.multiple[channel], 1e-6, 1e-4), "solar intensity scales physical radiance");
  }
  assert.equal(dependency.unchangedBuilds, dependency.startBuilds, "camera, time, light and multiple-scattering strength reuse medium LUTs");
  assert.equal(dependency.afterMediumBuilds, dependency.beforeMediumBuilds + 1, "in-place RGB medium edit rebuilds LUTs once");
  assert.ok(dependency.afterMedium[6] < dependency.beforeMedium[6], "edited medium reaches actual GPU transmittance");
  report.checks.push("multiple scattering and solar intensity affect GPU radiance; medium edits invalidate LUTs while view/time changes reuse them");

  const locations = await page.evaluate(() => {
    const state = window.__m2Atmosphere;
    state.restore();
    const day = state.sunLocation();
    return {
      day,
      terminator: state.sunLocation(90),
      night: { ...state.sunLocation(180), latitude: -day.latitude },
    };
  });
  for (const [name, location, height, pitch, heading] of [
    ["ground-day", locations.day, 2, 0, 0],
    ["ground-terminator", locations.terminator, 2, 0, 270],
    ["ground-night", locations.night, 2, 0, 0],
    ["low-orbit", locations.day, 400000, -30, 0],
    ["high-orbit", locations.day, 35786000, -90, 0],
    ["high-orbit-terminator", locations.terminator, 35786000, -90, 0],
  ]) {
    const view = { ...location, height, pitch, heading, imagery: true };
    const settled = await settleAtmosphereView(page, view);
    const pixels = await page.evaluate(async (highOrbit) => {
      const fractions = highOrbit ? [[0.5, 0.5], [0.1, 0.1]] : [[0.5, 0.2], [0.5, 0.75]];
      return window.__m2Atmosphere.pixelSamples(fractions);
    }, height > 1000000);
    for (const [index, pixel] of pixels.entries()) {
      assertComposite(pixel, `${name}, pixel ${index}`);
    }
    await captureM1Scene(page, report, output, name, { view, settled, pixels });
    if (name === "low-orbit") {
      // Retain the same-view M1 input for visual attribution of inherited
      // coarse NaturalEarth imagery seams, independent of atmosphere blending.
      await page.evaluate(() => { window.__m1.viewer.scene.atmosphere.show = false; });
      await captureM1Scene(page, report, output, "low-orbit-atmosphere-disabled", { view });
      await page.evaluate(() => { window.__m1.viewer.scene.atmosphere.show = true; });
    }
    if (name === "ground-day") {
      report.timeChange = await page.evaluate(async () => {
        const state = window.__m2Atmosphere;
        const { viewer } = window.__m1;
        const before = (await state.pixelSamples([[0.5, 0.2]]))[0];
        const beforeSun = [viewer.scene._planetState.sunDirectionWC.x, viewer.scene._planetState.sunDirectionWC.y, viewer.scene._planetState.sunDirectionWC.z];
        const beforeBuilds = viewer.scene._atmosphere.statistics.lutBuilds;
        viewer.clock.currentTime = Cesium.JulianDate.addHours(state.fixedTime, 12, new Cesium.JulianDate());
        const after = (await state.pixelSamples([[0.5, 0.2]]))[0];
        const afterSun = [viewer.scene._planetState.sunDirectionWC.x, viewer.scene._planetState.sunDirectionWC.y, viewer.scene._planetState.sunDirectionWC.z];
        return { before, after, beforeSun, afterSun, beforeBuilds, afterBuilds: viewer.scene._atmosphere.statistics.lutBuilds };
      });
      const change = report.timeChange;
      assert.equal(change.before.gpu[7], 0, "daytime sky pixel has clear depth");
      assert.equal(change.after.gpu[7], 0, "same ray remains sky twelve hours later");
      assert.equal(change.before.gpu[3], -1, "clear depth is background, not ground");
      assert.ok(energy(change.after.gpu) < energy(change.before.gpu) * 0.1 + 1e-7, "+12 h changes the rendered atmosphere to night");
      assert.ok(change.before.displayed.some((value, channel) => channel < 3 && Math.abs(value - change.after.displayed[channel]) > 5), "time change is visible in actual canvas pixels");
      assert.equal(change.afterBuilds, change.beforeBuilds);
      assertComposite(change.after, "twelve-hour sky change");
      await captureM1Scene(page, report, output, "ground-12h-later", { timeChange: change });
      await page.evaluate(() => window.__m2Atmosphere.restore());
    }
  }
  report.checks.push("actual ground/400 km/35,786 km and day/night/terminator screenshots; fixed camera visibly responds to +12 h scene time");

  report.boundary = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const day = state.sunLocation();
    const longitude = Cesium.Math.toRadians(day.longitude);
    const normal = [Math.cos(longitude), Math.sin(longitude), 0];
    const tangent = [-normal[1], normal[0], 0];
    const direction = normal.map((value, index) => -0.6 * value + 0.8 * tangent[index]);
    const observations = [];
    for (const height of [99900, 99999, 100000, 100001, 100100]) {
      state.setView({ longitude: day.longitude, latitude: 0, height, pitch: -45 });
      observations.push({ height, gpu: (await state.probe([state.row({ direction })]))[0] });
    }
    return observations;
  });
  const boundaryReference = report.boundary[2].gpu;
  for (const observation of report.boundary) {
    assertPhysical(observation.gpu, `${observation.height} m outer boundary`);
    for (let channel = 0; channel < 3; ++channel) {
      assert.ok(near(observation.gpu[channel], boundaryReference[channel], 2e-5, 0.03), "crossing atmosphere boundary does not pop radiance");
      assert.ok(near(observation.gpu[channel + 4], boundaryReference[channel + 4], 0.01), "crossing atmosphere boundary does not pop transmittance");
    }
  }
  for (let channel = 0; channel < 3; ++channel) {
    assert.ok(near(report.boundary[1].gpu[channel], report.boundary[3].gpu[channel], 1e-6, 0.005), "one-meter inside/outside views remain continuous");
  }
  report.checks.push("finite continuous GPU radiance/transmittance across the actual outer atmosphere boundary");

  // A local Gaussian mountain is a real heightmap TerrainProvider. Its depth
  // lies before the ellipsoid and therefore detects ellipsoid-only fog masking.
  await page.evaluate((location) => {
    const state = window.__m2Atmosphere;
    state.restore();
    state.installMountain(location.longitude, location.latitude);
  }, locations.day);
  const mountainView = {
    longitude: locations.day.longitude - 0.4,
    latitude: locations.day.latitude,
    height: 20000,
    pitch: -20,
    heading: 90,
    imagery: true,
  };
  const mountainSettled = await settleAtmosphereView(page, mountainView);
  report.terrain = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    const samples = await state.pixelSamples([[0.5, 0.5], [0.78, 0.55], [0.25, 0.65]], true);
    const unoccluded = await state.probe(samples.map((sample) => state.row({ direction: sample.nativeRay })));
    const framesBeforeDisable = viewer.scene._atmosphere.statistics.frames;
    viewer.scene.atmosphere.show = false;
    const { data, width } = window.__m1.pixels();
    const disabled = samples.map(({ pixel }) => {
      const offset = (pixel[1] * width + pixel[0]) * 4;
      return Array.from(data.slice(offset, offset + 4));
    });
    const framesAfterDisable = viewer.scene._atmosphere.statistics.frames;
    const disabledGpu = await state.probe(samples.map(({ pixel }) => state.row({ pixel })));
    return { samples, unoccluded, disabled, disabledGpu, framesBeforeDisable, framesAfterDisable };
  });
  assert.equal(report.terrain.framesAfterDisable, report.terrain.framesBeforeDisable, "show=false skips atmosphere rendering");
  for (const [index, sample] of report.terrain.samples.entries()) {
    assertComposite(sample, `mountain sample ${index}`);
    assert.ok(sample.pickedDistance !== null && sample.pickedHeight > 500, "actual elevated terrain is visible");
    assert.ok(sample.gpu[7] > 0 && sample.gpu[7] <= 1, "terrain writes real reversed depth");
    assert.ok(sample.rasterPickDistances.every((distance) => distance !== null && Number.isFinite(distance)), "subpixel neighborhood remains on real mountain geometry");
    const pickMin = Math.min(sample.pickedDistance, ...sample.rasterPickDistances);
    const pickMax = Math.max(sample.pickedDistance, ...sample.rasterPickDistances);
    const rounding = 0.01 + 2e-6 * sample.pickedDistance;
    assert.ok(pickMax - pickMin < 25, "fixture has a bounded subpixel depth slope, not a terrain edge");
    assert.ok(sample.gpu[3] >= pickMin - rounding && sample.gpu[3] <= pickMax + rounding, "GPU distance lies within the fixed 1/16-pixel native terrain neighborhood");
    assert.equal(report.terrain.disabledGpu[index][7], sample.gpu[7], "atmosphere composition leaves the original terrain depth unchanged");
    assert.ok(sample.pickedDistance + 1000 < sample.ellipsoidDistance, "mountain occludes before analytic Earth");
    assert.ok(near(sample.gpu[13], sample.gpu[3], 0.01, 2e-6), "atmosphere integration stops at real terrain depth");
    assert.ok(near(sample.gpu[11], sample.cosine, 1e-6), "off-axis GPU ray matches native camera ray");
    assertPhysical(report.terrain.unoccluded[index], `ellipsoid-only control ${index}`);
    assert.ok(sample.gpu[6] > report.terrain.unoccluded[index][6] + 0.005, "real mountain depth materially shortens atmospheric extinction");
    const disabledLighting = sample.surfaceNormal && sample.surfaceLightingEnabled
      ? terrainSurfaceLighting(sample.sunCosine, sample.surfaceHeight, false, sample.lightIntensity)
      : [1, 1, 1];
    for (let channel = 0; channel < 3; ++channel) {
      assert.ok(Math.abs(report.terrain.disabled[index][channel] - displayChannel(sample.gpu[16 + channel] * disabledLighting[channel])) <= 2, "disabled atmosphere preserves the illuminated surface without aerial perspective");
    }
  }
  const offAxis = report.terrain.samples[1];
  assert.ok(Math.abs(offAxis.gpu[3] - offAxis.gpu[3] * offAxis.cosine) > 1000, "off-axis control separates ray meters from axial eye distance");
  assert.ok(report.terrain.samples.some((sample, index) => sample.displayed.some((value, channel) => channel < 3 && Math.abs(value - report.terrain.disabled[index][channel]) > 5)), "aerial perspective visibly changes real terrain pixels");
  await captureM1Scene(page, report, output, "mountain-atmosphere-disabled", { view: mountainView, settled: mountainSettled, measurement: report.terrain });
  await page.evaluate(() => { window.__m1.viewer.scene.atmosphere.show = true; });
  await captureM1Scene(page, report, output, "mountain-aerial-perspective", { view: mountainView });

  report.sunwardSky = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    // Above the mountain but inside the medium, directly toward the actual Sun.
    // Low intensity avoids a saturated pixel hiding an unexpected Sun disk.
    const location = state.sunLocation();
    viewer.scene.atmosphere.lightIntensity = 0.1;
    state.setView({ ...location, height: 20000, pitch: 90 });
    return (await state.pixelSamples([[0.5, 0.5]]))[0];
  });
  assertComposite(report.sunwardSky, "unsaturated sunward sky");
  assert.equal(report.sunwardSky.gpu[7], 0);
  assert.equal(report.sunwardSky.gpu[3], -1);
  assert.ok(report.sunwardSky.gpu[13] > 70000, "clear sky retains the visible atmosphere segment");
  assert.ok(report.sunwardSky.displayed.slice(0, 3).every((value) => value < 245), "no additional Sun disk or saturated glare hides the physical sky result");
  report.checks.push("actual mountain depth, off-axis ray meters and clear sky drive correct linear aerial-perspective pixels; disabled atmosphere restores surface and no Sun disk is added");

  await page.evaluate(() => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    state.restore();
    state.oldDepth = viewer.scene.context.sceneDepthTexture;
    state.oldColor = viewer.scene.context.sceneColorTexture;
    state.renderer = viewer.scene._atmosphere;
  });
  await page.setViewportSize({ width: 768, height: 432 });
  report.resize = await page.evaluate(async () => {
    const state = window.__m2Atmosphere;
    const { viewer } = window.__m1;
    viewer.resize();
    const sample = (await state.pixelSamples([[0.5, 0.5]]))[0];
    const context = viewer.scene.context;
    const destroyed = (resource) => window.__m2AtmosphereAllocations.find((record) => record.resource === resource)?.destroyed;
    return {
      sample,
      replacedDepth: state.oldDepth !== context.sceneDepthTexture,
      replacedColor: state.oldColor !== context.sceneColorTexture,
      oldDepthDestroyed: destroyed(state.oldDepth),
      oldColorDestroyed: destroyed(state.oldColor),
      depthSize: [context.sceneDepthTexture.width, context.sceneDepthTexture.height],
      colorSize: [context.sceneColorTexture.width, context.sceneColorTexture.height],
    };
  });
  assert.equal(report.resize.replacedDepth, true);
  assert.equal(report.resize.replacedColor, true);
  assert.equal(report.resize.oldDepthDestroyed, true);
  assert.equal(report.resize.oldColorDestroyed, true);
  assert.deepEqual(report.resize.depthSize, [768, 432]);
  assert.deepEqual(report.resize.colorSize, [768, 432]);
  assertComposite(report.resize.sample, "resized sky");
  await page.evaluate(async () => {
    await window.__m1.viewer.scene.context._device.queue.onSubmittedWorkDone();
  });
  report.cleanup = await destroyM1Scene(page);
  report.nativeResources = await page.evaluate(() => {
    const records = window.__m2AtmosphereAllocations;
    return {
      created: records.length,
      destroyed: records.filter((record) => record.destroyed).length,
      buffers: records.filter((record) => record.kind === "Buffer").length,
      textures: records.filter((record) => record.kind === "Texture").length,
      live: records.filter((record) => !record.destroyed).map(({ kind, label }) => ({ kind, label })),
      atmosphere: { ...window.__m2Atmosphere.renderer.statistics },
    };
  });
  assert.equal(report.nativeResources.created, report.nativeResources.destroyed);
  assert.deepEqual(report.nativeResources.live, []);
  assert.equal(report.nativeResources.atmosphere.buffersCreated, report.nativeResources.atmosphere.buffersDestroyed);
  assert.equal(report.nativeResources.atmosphere.texturesCreated, report.nativeResources.atmosphere.texturesDestroyed);
  assert.ok(report.nativeResources.atmosphere.frames > 0);
  report.checks.push("resize reacquires readable color/depth; destruction releases every actual GPU buffer/texture including LUTs, intermediate targets and probe readbacks");
  assert.equal(report.checks.length, 8);
});
