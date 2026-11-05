/* global window, document, Event */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";
import { chromium } from "playwright";
import { getBrowserConfiguration, classifyGpu, assertPhysicalGpu } from "./m0-browser-config.mjs";

const output = process.env.M1_OUTPUT ?? "Build/m2-lens-compaction-parameter/demo";
const base = process.env.M1_BASE_URL ?? "http://127.0.0.1:8090/";
const url = new URL("Apps/WebGPUGlobe.html", base).href;
const original = await readFile("Apps/WebGPUGlobe.html", "utf8");
const fixture = original.replace('const viewer = new Cesium.Viewer("cesiumContainer", {',
  'const viewer = window.__lensDemoViewer = new Cesium.Viewer("cesiumContainer", { baseLayer: false, useDefaultRenderLoop: false,')
  .replace("await loadGoogleAndTerrain();", "// Offline control fixture: no external providers.");
assert.notEqual(fixture, original);
const configuration = getBrowserConfiguration();
const browser = await chromium.launch(configuration.launchOptions);
const report = { scope: "Real Demo HTML and production Viewer; only offline/no-loop startup and a test viewer handle are injected. The actual slider markup/listener are unchanged.",
  demoSourceSha256: createHash("sha256").update(original).digest("hex"),
  bundleSha256: createHash("sha256").update(await readFile("Build/CesiumUnminified/Cesium.js")).digest("hex"),
  browser: browser.version(), configuration, values: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.route("**/*", (route) => {
    const request = route.request().url();
    if (request === url) { return route.fulfill({ contentType: "text/html", body: fixture }); }
    return new URL(request).origin === new URL(base).origin ? route.continue() : route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__lensDemoViewer && !document.getElementById("lens-controls").disabled);
  report.adapter = await page.evaluate(() => {
    const info = window.__lensDemoViewer.scene.context._adapter.info;
    return { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
  });
  assertPhysicalGpu(classifyGpu(report.adapter), configuration);
  report.slider = await page.locator("#lens-diffusion-size").evaluate((slider) =>
    ({ min: slider.min, max: slider.max, step: slider.step, value: slider.valueAsNumber }));
  assert.deepEqual(report.slider, { min: "0.1", max: "2", step: "0.05", value: 0.7 });
  for (const size of [0.1, 0.4, 0.7, 1, 2]) {
    const value = await page.locator("#lens-diffusion-size").evaluate((slider, size) => {
      slider.valueAsNumber = size;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return { input: slider.valueAsNumber, production: window.__lensDemoViewer.scene._atmosphere.lensFlare.diffusionSize,
        readout: document.getElementById("lens-diffusion-size-value").value };
    }, size);
    assert.deepEqual(value, { input: size, production: size, readout: size.toFixed(2) });
    report.values.push(value);
  }
  await page.evaluate(() => window.__lensDemoViewer.destroy());
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
} finally {
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
}
