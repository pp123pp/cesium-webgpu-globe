/* global Cesium, window, document, GPUDevice, Event, fetch */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { chromium } from "playwright";
import { getBrowserConfiguration, classifyGpu, assertPhysicalGpu } from "./m0-browser-config.mjs";

const output = process.env.M1_OUTPUT ?? "Build/m3-cloud-demo";
const base = process.env.M1_BASE_URL ?? "http://localhost:8067/";
const url = new URL("Apps/WebGPUGlobe.html", base).href;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = await readFile("Apps/WebGPUGlobe.html", "utf8");
const moduleSource = await readFile("Apps/WebGPUCloudGeometry.js", "utf8");
assert.match(original, /id="cloud-controls"/);
const fixture = original.replace('const viewer = new Cesium.Viewer("cesiumContainer", {',
  'const viewer = window.__cloudDemoViewer = new Cesium.Viewer("cesiumContainer", { baseLayer: false, useDefaultRenderLoop: false,')
  .replace("await loadGoogleAndTerrain();", "// Offline control fixture: no external providers.");
assert.notEqual(fixture, original, "inject offline real-Viewer handle");
assert.ok(fixture.includes("window.__cloudDemoViewer = new Cesium.Viewer"));
const bundle = await readFile("Build/CesiumUnminified/Cesium.js");
assert.equal(hash(bundle), hash(new Uint8Array(await (await fetch(new URL("Build/CesiumUnminified/Cesium.js", base))).arrayBuffer())), "served bundle matches this checkout");
assert.equal(hash(moduleSource), hash(await (await fetch(new URL("Apps/WebGPUCloudGeometry.js", base))).text()), "served preview module matches this checkout");
const configuration = getBrowserConfiguration();
const report = {
  scope: "Actual Demo controls and preview module on production Viewer; injected offline provider, manual render loop, bounded native terrain and test handle only.",
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceStatus: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  capturedAt: new Date().toISOString(), demoSourceSha256: hash(original), moduleSourceSha256: hash(moduleSource), bundleSha256: hash(bundle),
  configuration, base, errors: [], warnings: [], checks: [], views: [], screenshots: [],
};
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch(configuration.launchOptions);
  report.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") { report.errors.push(message.text()); }
    if (message.type() === "warning") { report.warnings.push(message.text()); }
  });
  await page.addInitScript(() => {
    window.__cloudDemoResources = [];
    for (const kind of ["Buffer", "Texture"]) {
      const original = GPUDevice.prototype[`create${kind}`];
      GPUDevice.prototype[`create${kind}`] = function (...args) {
        const resource = original.apply(this, args);
        const record = { kind, label: args[0]?.label ?? "", destroyed: false };
        window.__cloudDemoResources.push(record);
        const destroy = resource.destroy;
        resource.destroy = function (...destroyArgs) { record.destroyed = true; return destroy.apply(this, destroyArgs); };
        return resource;
      };
    }
  });
  await page.route("**/*", (route) => {
    const request = route.request().url();
    if (request === url) { return route.fulfill({ contentType: "text/html", body: fixture }); }
    return new URL(request).origin === new URL(base).origin ? route.continue() : route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__cloudDemoViewer && !document.getElementById("cloud-controls").disabled, null, { timeout: 30000 });
  report.environment = await page.evaluate(() => {
    const viewer = window.__cloudDemoViewer;
    const info = viewer.scene.context._adapter.info;
    window.__cloudDemoRenderErrors = [];
    viewer.renderError.addEventListener((...args) => window.__cloudDemoRenderErrors.push(String(args[1])));
    viewer.scene.context._device.addEventListener("uncapturederror", (event) => window.__cloudDemoRenderErrors.push(String(event.error)));
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.scene.atmosphere.show = false;
    viewer.scene.sun.show = false; viewer.scene.moon.show = false; viewer.scene.stars.show = false;
    viewer.scene._atmosphere.bloomStrength = 0;
    viewer.scene._atmosphere.lensFlare.enabled = false;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.baseColor = new Cesium.Color(0.12, 0.22, 0.32, 1);
    class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    viewer.terrainProvider = new BoundedTerrain();
    const images = {};
    window.__cloudDemoCapture = () => {
      viewer.render();
      const canvas = document.createElement("canvas"); canvas.width = viewer.canvas.width; canvas.height = viewer.canvas.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(viewer.canvas, 0, 0);
      return { canvas, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    window.__cloudDemoSnapshot = (name) => {
      const image = window.__cloudDemoCapture(); images[name] = image;
      return { png: image.canvas.toDataURL("image/png").split(",")[1], width: image.canvas.width, height: image.canvas.height };
    };
    window.__cloudDemoCompare = (first, second) => {
      const a = images[first].pixels, b = images[second].pixels;
      let changedPixels = 0, maximumChannelDifference = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (delta > 0) { ++changedPixels; maximumChannelDifference = Math.max(maximumChannelDifference, delta); }
      }
      return { changedPixels, maximumChannelDifference };
    };
    return { adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter }, cesium: Cesium.VERSION, maximumTerrainLevel: 8 };
  });
  assertPhysicalGpu(classifyGpu(report.environment.adapter), configuration);
  assert.equal(await page.locator("#show-cloud-geometry").isChecked(), false, "preview defaults off");
  report.checks.push("real hardware and preview default off");
  for (const [preset, expectedHeight] of [["orbit", 35786000], ["high", 20000], ["near", 2]]) {
    await page.locator(`#cloud-${preset}`).click();
    assert.equal(await page.locator("#show-cloud-geometry").isChecked(), true, `${preset}: preset enables preview`);
    const camera = await page.evaluate(() => {
      const viewer = window.__cloudDemoViewer;
      return { height: viewer.camera.positionCartographic.height, longitude: viewer.camera.positionCartographic.longitude, latitude: viewer.camera.positionCartographic.latitude };
    });
    assert.ok(Math.abs(camera.height - expectedHeight) < 0.01, `${preset}: actual native camera height`);
    assert.ok(Math.abs(camera.longitude) < 1e-8 && Math.abs(camera.latitude) < 1e-8, `${preset}: equatorial geographic preset`);
    await settle(page);
    await page.locator("#show-cloud-geometry").uncheck();
    await saveSnapshot(page, `${preset}-off`);
    await page.locator("#show-cloud-geometry").check();
    await saveSnapshot(page, `${preset}-on`);
    const enabled = await page.evaluate(([a, b]) => window.__cloudDemoCompare(a, b), [`${preset}-off`, `${preset}-on`]);
    assert.ok(enabled.changedPixels > 100, `${preset}: production cloud preview changes displayed canvas`);
    await page.locator("#show-cloud-geometry").uncheck();
    await saveSnapshot(page, `${preset}-restored`);
    const restored = await page.evaluate(([a, b]) => window.__cloudDemoCompare(a, b), [`${preset}-off`, `${preset}-restored`]);
    assert.equal(restored.changedPixels, 0, `${preset}: toggling off exactly restores same-state pixels`);
    await page.locator("#show-cloud-geometry").check();
    await page.evaluate(() => window.__cloudDemoViewer.render());
    const readout = await page.locator("#cloud-readout").innerText();
    assert.ok(readout.trim().length > 0, `${preset}: geometry readout populated`);
    await page.locator("#cloud-controls").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${preset}-controls.png`) });
    report.screenshots.push({ filename: `${preset}-controls.png`, scope: "actual Demo and visible cloud controls" });
    report.views.push({ preset, camera, readout, enabled, restored });
  }
  await page.setViewportSize({ width: 800, height: 600 });
  await page.evaluate(() => { window.__cloudDemoViewer.resize(); window.__cloudDemoViewer.render(); });
  const resized = await saveSnapshot(page, "resized-on");
  assert.equal(resized.width, 800);
  assert.ok(resized.height > 500 && resized.height <= 600, "resized canvas respects Timeline strip");
  report.resize = resized;
  await page.locator("#cloud-orbit").click();
  await page.locator("#show-cloud-volume").check();
  assert.equal(await page.locator("#show-cloud-geometry").isChecked(), false);
  await settle(page);
  await saveSnapshot(page, "volume-orbit");
  assert.match(await page.locator("#cloud-readout").innerText(), /local clouds hidden/);
  await page.locator("#cloud-deck").click();
  await page.waitForFunction(() => {
    const viewer = window.__cloudDemoViewer;
    viewer.render();
    return Math.abs(viewer.camera.positionCartographic.height - 8500) < 1;
  });
  await settle(page);
  await page.locator("#cloud-quality").selectOption("high");
  await page.locator("#cloud-type").selectOption("stratocumulus");
  await page.locator("#cloud-cirrus").check();
  await page.locator("#cloud-local-detail").check();
  await saveSnapshot(page, "volume-deck");
  const settings = await page.evaluate(() => window.__cloudDemoViewer.scene.clouds);
  assert.ok(settings.show && settings.localDetail && settings.quality === "high");
  assert.equal(settings.type, "stratocumulus");
  assert.equal(settings.cirrus, true);
  await page.locator("#show-cloud-volume").uncheck();
  await saveSnapshot(page, "volume-deck-clear");
  const contrast = await page.evaluate(() => window.__cloudDemoCompare("volume-deck", "volume-deck-clear"));
  assert.ok(contrast.changedPixels > 100, "production cloud controls affect local sky");
  await page.locator("#cloud-compare").click();
  const comparePose = () => page.evaluate(() => {
    const viewer = window.__cloudDemoViewer;
    return [viewer.camera.positionWC.x, viewer.camera.positionWC.y, viewer.camera.positionWC.z,
      viewer.camera.heading, viewer.camera.pitch, viewer.camera.roll,
      Cesium.JulianDate.toIso8601(viewer.clock.currentTime), viewer.scene.exposure, viewer.scene.clouds.windSpeed];
  });
  const pose = await comparePose();
  await page.locator("#cloud-type").selectOption("cumulus");
  assert.deepEqual(await comparePose(), pose, "changing low cloud type preserves the comparison view");
  await page.locator("#cloud-growth-view").click();
  assert.deepEqual(await page.evaluate(() => {
    const {scene, clock} = window.__cloudDemoViewer;
    return [scene.clouds.evolution, clock.shouldAnimate, scene.clouds.windSpeed];
  }), [true, true, 18]);
  await page.locator("#cloud-morning-view").click();
  assert.deepEqual(await page.evaluate(() => {
    const {scene, clock} = window.__cloudDemoViewer;
    return [scene.clouds.mist, scene.clouds.evolution, clock.shouldAnimate];
  }), [true, false, false]);
  await page.locator("#cloud-mist").uncheck();
  assert.equal(await page.evaluate(() => window.__cloudDemoViewer.scene.clouds.mist), false);
  report.checks.push("local-volume controls, clear orbit and fly-to-cloud-deck work on the actual Demo");
  report.renderErrors = await page.evaluate(() => window.__cloudDemoRenderErrors);
  assert.deepEqual(report.renderErrors, [], "no native render or uncaptured GPU validation errors");
  report.checks.push("all three controls select intended camera; on output changes, off output restores exactly; resize renders");
  report.cleanup = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const resources = window.__cloudDemoResources;
    const cloud = resources.filter(({ label }) => /cloud|M3/i.test(label));
    return { viewerDestroyed: window.__cloudDemoViewer.isDestroyed(), cloudResources: cloud, created: resources.length, destroyed: resources.filter(({ destroyed }) => destroyed).length };
  });
  assert.equal(report.cleanup.viewerDestroyed, true, "pagehide destroys actual Viewer");
  assert.ok(report.cleanup.cloudResources.length > 0, "observed native cloud preview allocations");
  assert.ok(report.cleanup.cloudResources.every(({ destroyed }) => destroyed), "pagehide releases every cloud preview allocation");
  assert.deepEqual(report.errors, []);
  report.checks.push("pagehide releases preview resources and Viewer without GPU validation errors");
  report.status = "PASS";

  async function saveSnapshot(page, name) {
    const { png, ...size } = await page.evaluate((name) => window.__cloudDemoSnapshot(name), name);
    const bytes = Buffer.from(png, "base64");
    await writeFile(path.join(output, `${name}.png`), bytes);
    report.screenshots.push({ filename: `${name}.png`, sha256: hash(bytes), ...size, scope: "actual displayed WebGPU canvas pixels, excludes overlay panel" });
    return size;
  }
} catch (error) {
  report.status = "FAIL"; report.error = String(error); throw error;
} finally {
  await browser?.close();
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
}

async function settle(page) {
  await page.waitForFunction(() => {
    const viewer = window.__cloudDemoViewer;
    viewer.render();
    const key = viewer.scene._renderer._draws.map(({ tile }) => `${tile.level}/${tile.x}/${tile.y}`).sort().join("|");
    const ready = viewer.scene.globe.tilesLoaded && viewer.scene.debugStatistics.resources.drawCalls > 0;
    window.__cloudDemoStable = ready && key === window.__cloudDemoTileKey ? (window.__cloudDemoStable ?? 0) + 1 : 0;
    window.__cloudDemoTileKey = key;
    return window.__cloudDemoStable >= 3;
  }, null, { timeout: 60000 });
}
