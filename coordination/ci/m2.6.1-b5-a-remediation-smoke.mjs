/* global window, Cesium */
import assert from "node:assert/strict";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, captureB4 } from "./m2.6.1-b4-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b5-a-remediation-smoke";
const decode = (byte) => { const v = byte / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => rgb.slice(0, 3).reduce((sum, byte, i) => sum + decode(byte) * [0.2126, 0.7152, 0.0722][i], 0);
const display = (linear) => { const x = Math.max(0, linear); const mapped = Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); return Math.round(255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055)); };
await runM1BrowserSuite("m2.6.1-b5-a-remediation", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page); await installB4Probe(page);
  await page.waitForFunction(() => { window.__m1.viewer.render(); return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded; });
  const failures = [];
  const check = (condition, message) => { if (!condition) { failures.push(message); } else { report.checks.push(message); } };
  for (const settings of [
    { id: "twilight", height: 2, elevation: 1 },
    { id: "night", height: 2, elevation: -8, cameraElevation: 0.5, fov: 30 },
  ]) {
    await page.evaluate((s) => { window.__m1.viewer.scene.globe.enableLighting = true; return window.__b4.view(s); }, settings);
    const settling = await settleAtmosphereView(page);
    const capture = await captureB4(page, report, output, settings.id);
    capture.settling = settling;
    assert.equal(capture.atmosphere.show, true);
    const pixel = await page.evaluate(() => window.__m2Atmosphere.pixelSamples([[0.1, 0.9]]));
    check(pixel[0].gpu[3] >= 0 && pixel[0].gpu[7] > 0, `${settings.id}: night-side brightness is measured on actual terrain depth`);
    check(capture.metrics.surface.displayLinearLuminanceMean < 0.01, `${settings.id}: unlit surface remains below 1% display-linear white`);
    if (settings.id === "twilight") {
      check(capture.metrics.disk.displayLinearLuminanceMean - capture.metrics.annulus.displayLinearLuminanceMean > 0.20,
        "twilight: disk-to-adjacent-sky luminance contrast exceeds 0.20 at exposure one");
    }
  }
  await page.evaluate(() => {
    window.__b4.view({ height: 2000, elevation: 60, groundFacing: true, fov: 30 });
    const { scene } = window.__m1.viewer;
    scene.atmosphere.show = false; scene._atmosphere.bloomStrength = 0;
    scene.sun.show = false; scene.moon.show = false; scene.stars.show = false;
    scene.globe.enableLighting = true; scene.globe.baseColor = new Cesium.Color(0.5, 0.5, 0.5, 1);
  });
  await page.evaluate(() => window.__m1.settle({ timeout: 60000 }));
  report.surfaceIrradiance = [];
  for (const intensity of [0, 5, 10, 20]) {
    const [sample] = await page.evaluate(async (value) => { window.__m1.viewer.scene.atmosphere.lightIntensity = value; return window.__m2Atmosphere.pixelSamples([[0.5, 0.5]]); }, intensity);
    report.surfaceIrradiance.push({ intensity, luminance: luminance(sample.displayed), sample });
  }
  const values = report.surfaceIrradiance;
  check(values.every(({ sample }) => sample.gpu[3] >= 0), "irradiance response uses actual surface pixels, not sky");
  check(values[3].luminance > values[2].luminance + 0.05 && values[2].luminance > values[1].luminance + 0.05,
    "physical surface illumination responds monotonically to shared solar irradiance");
  check(values[0].luminance < 0.01, "zero solar irradiance removes direct surface sunlight");
  const [unlit] = await page.evaluate(async () => { window.__m1.viewer.scene.globe.enableLighting = false; return window.__m2Atmosphere.pixelSamples([[0.5, 0.5]]); });
  report.unlit = unlit;
  check(unlit.displayed.slice(0, 3).every((v, i) => Math.abs(v - display(unlit.gpu[16 + i])) <= 3), "explicit unlit mode preserves linear albedo and the existing ACES/sRGB codec");
  report.failures = failures;
  report.cleanup = await destroyM1Scene(page);
  assert.equal(report.cleanup.destroyed, true);
  assert.deepEqual(failures, [], failures.join("; "));
});

async function settleAtmosphereView(page) {
  return page.evaluate(async () => {
    const { viewer, settle } = window.__m1;
    const atmosphere = viewer.scene.atmosphere;
    const show = atmosphere.show;
    let settled;
    // Terrain readiness does not depend on intermediate sky pixels. Avoid
    // full-resolution transport on every loading frame under SwiftShader.
    atmosphere.show = false;
    try {
      settled = await settle({ timeout: 60000 });
    } finally {
      atmosphere.show = show;
    }
    viewer.render();
    return { ...settled, atmosphereDuringLoad: false };
  });
}
