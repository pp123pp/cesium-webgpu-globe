/* global Cesium, window */
import process from "node:process";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "../../ci/m1-browser-harness.mjs";
import { installAtmosphereProbe } from "../../ci/m2-atmosphere-fixtures.mjs";
import { installSunProbe } from "../../ci/m2-sun-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m25-acceptance";
process.env.M1_BASE_URL ??= "http://127.0.0.1:8090/";

async function measure(page) {
  return page.evaluate(() => {
    const { data, width, height } = window.__m1.pixels();
    const regions = {};
    for (const [name, start, end] of [["whole", 0, height], ["topThird", 0, Math.floor(height / 3)], ["bottomThird", Math.floor(height * 2 / 3), height]]) {
      let sum = 0, white = 0, anyClipped = 0, black = 0;
      const luminances = [];
      for (let y = start; y < end; ++y) {
        for (let x = 0; x < width; ++x) {
          const i = (y * width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          sum += r + g + b;
          white += r >= 254 && g >= 254 && b >= 254;
          anyClipped += Math.max(r, g, b) >= 254;
          black += Math.max(r, g, b) <= 1;
          luminances.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        }
      }
      luminances.sort((a, b) => a - b);
      const count = luminances.length;
      regions[name] = { pixels: count, meanRgb: sum / (count * 3), whiteFraction: white / count, anyChannelClippedFraction: anyClipped / count, blackFraction: black / count,
        displayLumaPercentiles: Object.fromEntries([1, 10, 50, 90, 99].map(p => [p, luminances[Math.min(count - 1, Math.floor(count * p / 100))]])) };
    }
    return { width, height, exposure: window.__m1.viewer.scene.exposure, regions };
  });
}

await runM1BrowserSuite("m25-focused-visual", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await installM1Scene(page);
  report.setup = await installAtmosphereProbe(page);
  report.limitations = ["Default NaturalEarth imagery and ellipsoid surface, not live terrain-provider acceptance", "Top/bottom thirds are image regions, not semantic sky/terrain segmentation", "Display-byte luminance statistics are diagnostics, not a radiometric dynamic-range measurement", "No aesthetic pass is inferred from exposure monotonicity", "Spatial twilight samples do not prove temporal transition continuity"];
  const locations = await page.evaluate(() => {
    const state = window.__m2Atmosphere;
    state.restore();
    const day = state.sunLocation();
    const scene = window.__m1.viewer.scene;
    scene.sun.show = true;
    scene.moon.show = true;
    scene.stars.show = true;
    return { day, twilight: state.sunLocation(90), night: { ...state.sunLocation(180), latitude: -day.latitude } };
  });
  for (const [name, location] of Object.entries(locations)) {
    const view = { ...location, height: 400000, pitch: -25, heading: name === "twilight" ? 270 : 0, imagery: true };
    const settled = await page.evaluate(async view => {
      const scene = window.__m1.viewer.scene;
      scene.atmosphere.show = false;
      try { return await window.__m1.settle(view); }
      finally { scene.atmosphere.show = true; window.__m1.viewer.render(); }
    }, view);
    for (const exposure of [0.5, 1, 2]) {
      await page.evaluate(async exposure => {
        const { viewer } = window.__m1;
        viewer.scene.exposure = exposure;
        viewer.render();
        await viewer.scene.context._device.queue.onSubmittedWorkDone();
      }, exposure);
      const metrics = await measure(page);
      const samples = await page.evaluate(() => window.__m2Atmosphere.pixelSamples([[0.5, 0.1], [0.5, 0.75], [0.25, 0.85]]));
      await captureM1Scene(page, report, output, `${name}-exposure-${exposure}`, { view, settled, metrics, samples, sampleLayout: "gpu[0..2]=atmospheric radiance; [4..6]=transmittance; [7]=depth; [16..18]=linear surface RGB; celestial contributions not included in atmosphere probe" });
    }
  }
  const temporalView = { ...locations.twilight, height: 2, pitch: 0, heading: 270, imagery: true };
  const temporalSetup = await page.evaluate(async view => {
    const { viewer } = window.__m1;
    window.__m2Atmosphere.restore();
    viewer.scene.exposure = 1;
    viewer.scene.sun.show = true;
    viewer.scene.moon.show = true;
    viewer.scene.stars.show = true;
    viewer.scene.atmosphere.show = false;
    let settled;
    try { settled = await window.__m1.settle(view); }
    finally { viewer.scene.atmosphere.show = true; }
    return { settled, baseColor: viewer.scene.globe.baseColor.toString(), exposure: 1, referenceTime: Cesium.JulianDate.toIso8601(window.__m2Atmosphere.fixedTime) };
  }, temporalView);
  report.temporalTwilight = [];
  for (const minutes of [-20, -10, 0, 10, 20]) {
    const state = await page.evaluate(async minutes => {
      const { viewer } = window.__m1;
      viewer.clock.currentTime = Cesium.JulianDate.addMinutes(window.__m2Atmosphere.fixedTime, minutes, new Cesium.JulianDate());
      viewer.render();
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
      return { time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime), camera: [viewer.camera.positionWC.x, viewer.camera.positionWC.y, viewer.camera.positionWC.z], sunDirection: [viewer.scene._planetState.sunDirectionWC.x, viewer.scene._planetState.sunDirectionWC.y, viewer.scene._planetState.sunDirectionWC.z] };
    }, minutes);
    const metrics = await measure(page);
    const samples = await page.evaluate(() => window.__m2Atmosphere.pixelSamples([[0.5, 0.2], [0.5, 0.48], [0.5, 0.8]]));
    report.temporalTwilight.push({ minutes, ...state, metrics });
    await captureM1Scene(page, report, output, `temporal-twilight-${minutes}min`, { view: temporalView, setup: temporalSetup, minutes, ...state, metrics, samples });
  }
  report.limitations = report.limitations.filter(item => !item.startsWith("Spatial twilight"));
  report.limitations.push("Five fixed-camera twilight samples over 40 minutes test sampled transition behavior, not every intervening frame", "Solar probe sets a blue diagnostic globe baseColor and a 12-degree field of view; solar captures are not surface-color comparisons with the preceding NaturalEarth views");
  report.sunSetup = await installSunProbe(page);
  for (const [name, height, elevation, atmosphere] of [["sun-orbit", 400000, 60, false], ["sun-low-elevation", 2, 2, true]]) {
    await page.evaluate(({ height, elevation, atmosphere }) => {
      const state = window.__m2Sun;
      state.reset();
      state.setElevation(height, elevation);
      const scene = window.__m1.viewer.scene;
      scene.atmosphere.show = atmosphere;
      scene.moon.show = false;
      scene.stars.show = false;
    }, { height, elevation, atmosphere });
    for (const exposure of [0.5, 1, 2]) {
      await page.evaluate(exposure => { window.__m1.viewer.scene.exposure = exposure; }, exposure);
      const observation = await page.evaluate(() => window.__m2Sun.observe({ geometry: false }));
      const metrics = await measure(page);
      await captureM1Scene(page, report, output, `${name}-exposure-${exposure}`, { height, elevation, atmosphere, observation, metrics });
    }
  }
  report.checks.push("20 targeted views captured with production renderer, actual pixels and linear GPU probes; visual verdict requires manual review");
  report.cleanup = await destroyM1Scene(page);
});



