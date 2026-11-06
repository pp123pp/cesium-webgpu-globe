/* global Cesium, window, document, URL, console, Event */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  getBrowserConfiguration,
  classifyGpu,
  assertPhysicalGpu,
} from "./m0-browser-config.mjs";

const base = "http://localhost:8067";
const url = `${base}/Apps/WebGPUCloudShadows.html`;
const source = await readFile("Apps/WebGPUCloudShadows.html", "utf8");
const fixture = source
  .replace("viewer = new Cesium.Viewer", "viewer = window.__timelineViewer = new Cesium.Viewer")
  .replace('renderingBackend: "webgpu",', 'renderingBackend: "webgpu", baseLayer: false, useDefaultRenderLoop: false,')
  .replace(/await Cesium\.ArcGISTiledElevationTerrainProvider\.fromUrl\([\s\S]*?\);/, "new Cesium.EllipsoidTerrainProvider();")
  .replace("void addSatelliteImagery();", "// Offline fixture.");
const configuration = getBrowserConfiguration();
const browser = await chromium.launch(configuration.launchOptions);
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/*", (route) => {
    const request = route.request().url();
    if (request === url) {
      return route.fulfill({ contentType: "text/html", body: fixture });
    }
    return new URL(request).origin === base ? route.continue() : route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById("controls").disabled);
  const adapter = await page.evaluate(async () => {
    const viewer = window.__timelineViewer;
    const { scene } = viewer;
    const info = scene.context._adapter.info;
    scene.context._device.addEventListener("uncapturederror", (event) => {
      window.__timelineErrors.push(String(event.error));
    });
    window.__timelineErrors = [];
    viewer.renderError.addEventListener((...args) => window.__timelineErrors.push(String(args[1])));
    class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) {
        return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
      }
    }
    viewer.terrainProvider = new BoundedTerrain();
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    scene.clouds.quality = "low";
    await Cesium.CelestialFrameTransforms.preloadIcrfFixed(new Cesium.TimeInterval({
      start: Cesium.JulianDate.addDays(viewer.clock.startTime, -3, new Cesium.JulianDate()),
      stop: Cesium.JulianDate.addDays(viewer.clock.stopTime, 3, new Cesium.JulianDate()),
    }));
    return { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
  });
  assertPhysicalGpu(classifyGpu(adapter), configuration);
  for (const [width, expectedWidth, expectedHeight] of [
    [640, 136, 90],
    [901, 169, 112],
    [900, 136, 90],
    [600, 136, 90],
    [599, 106, 70],
    [375, 106, 70],
    [1280, 169, 112],
  ]) {
    await page.setViewportSize({ width, height: 360 });
    await page.waitForFunction(([expectedWidth, expectedHeight]) => {
      const container = document.getElementById("animation");
      const svg = container.lastElementChild;
      return container.clientWidth === expectedWidth &&
        container.clientHeight === expectedHeight &&
        svg.clientWidth === expectedWidth && svg.clientHeight === expectedHeight;
    }, [expectedWidth, expectedHeight], { timeout: 5000 });
    const dial = await page.evaluate(() => {
      const container = document.getElementById("animation");
      const svg = container.lastElementChild;
      const scale = svg.firstElementChild.transform.baseVal.consolidate().matrix;
      return { width: container.clientWidth, height: container.clientHeight, x: scale.a, y: scale.d };
    });
    assert.ok(Math.abs(dial.height - dial.width * 132 / 200) <= 1, "dial retains its native aspect ratio");
    assert.ok(Math.abs(dial.x - dial.y) < 0.01, "dial scales uniformly on initial layout and resize");
  }
  await page.setViewportSize({ width: 640, height: 360 });
  const sample = () => page.evaluate(() => {
    const viewer = window.__timelineViewer;
    viewer.render();
    const state = viewer.scene._planetState;
    return {
      time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
      frameTime: Cesium.JulianDate.toIso8601(state.time),
      sun: [state.sunDirectionWC.x, state.sunDirectionWC.y, state.sunDirectionWC.z],
      moon: [state.moonDirectionWC.x, state.moonDirectionWC.y, state.moonDirectionWC.z],
      paused: !viewer.clock.shouldAnimate,
    };
  });
  const initial = await sample();
  const bar = await page.locator(".cesium-timeline-bar").boundingBox();
  assert.ok(bar, "native Timeline is visible");
  await page.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.8, bar.y + bar.height * 0.5, { steps: 6 });
  await page.mouse.up();
  const dragged = await sample();
  console.log(JSON.stringify({ adapter, initial, dragged }, null, 2));
  assert.equal(dragged.time, dragged.frameTime, "render consumes the scrubbed clock time");
  assert.equal(dragged.paused, true, "scrubbing pauses playback");
  const dot = initial.sun.reduce((sum, value, i) => sum + value * dragged.sun[i], 0);
  assert.ok(Math.acos(Math.min(1, dot)) > Math.PI / 6, "dragging the default timeline visibly moves the Sun by more than 30 degrees");
  assert.notDeepEqual(dragged.moon, initial.moon, "Moon follows scrubbed time");
  const unbounded = await page.evaluate(() => {
    const viewer = window.__timelineViewer;
    viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
    viewer.clock.multiplier = 600;
    viewer.clock.shouldAnimate = true;
    viewer.clock.currentTime = Cesium.JulianDate.addDays(viewer.clock.stopTime, 2, new Cesium.JulianDate());
    viewer.render();
    const after = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, viewer.clock.stopTime);
    viewer.clock.multiplier = -600;
    viewer.clock.currentTime = Cesium.JulianDate.addDays(viewer.clock.startTime, -2, new Cesium.JulianDate());
    viewer.render();
    const before = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, viewer.clock.startTime);
    viewer.clock.shouldAnimate = false;
    return { after, before, range: viewer.clock.clockRange };
  });
  assert.ok(unbounded.after > 2 * 86400, "forward playback continues beyond the initial window");
  assert.ok(unbounded.before < -2 * 86400, "reverse playback continues before the initial window");
  await page.locator("#reset").click();
  assert.deepEqual(await sample(), initial, "reset restores the original time and ephemeris");
  assert.deepEqual(await page.evaluate(() => window.__timelineErrors), []);
  assert.deepEqual(errors, []);
  await mkdir("Build/m4-cloud-shadow-timeline", { recursive: true });
  await writeFile("Build/m4-cloud-shadow-timeline/result.json", JSON.stringify({ status: "PASS", adapter, initial, dragged }, null, 2));
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
} finally {
  await browser.close();
}
