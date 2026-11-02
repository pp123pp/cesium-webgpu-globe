// M0.5 WebGL visual regression smoke for the pinned CesiumJS 1.146.0 build.
// Uses an offline EllipsoidTerrainProvider: no ion token or remote imagery is required.
// Screenshots are compared against a second capture of the same settled scene. This
// checks deterministic output/repeatability; it is not a cross-version golden image.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

const base = "http://localhost:8080";
const outputDir = "Build/m0-baseline";
const timeoutMs = 60000;
await mkdir(outputDir, { recursive: true });

const errors = [];
const warnings = [];
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + "/Specs/e2e/cesium.html");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "Production Cesium server did not become ready on :8080");

  await page.goto(base + "/Specs/e2e/cesium.html", { waitUntil: "load" });
  await page.addScriptTag({ url: base + "/Build/CesiumUnminified/Cesium.js" });
  const initial = await page.evaluate(() => {
    if (!globalThis.Cesium?.Viewer) throw new Error("Official Cesium bundle not loaded");
    globalThis.CESIUM_BASE_URL = "../../Build/CesiumUnminified/";
    const viewer = new Cesium.Viewer("cesiumContainer", {
      baseLayer: false,
      baseLayerPicker: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      geocoder: false,
      timeline: false,
      animation: false,
      homeButton: false,
      sceneModePicker: false,
      projectionPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      useDefaultRenderLoop: false,
      requestRenderMode: false,
    });
    globalThis.__m0Viewer = viewer;
    viewer.resize();
    return {
      cesiumVersion: Cesium.VERSION,
      sceneMode: viewer.scene.mode,
      globePresent: !!viewer.scene.globe,
      terrainProvider: viewer.scene.globe.terrainProvider.constructor.name,
    };
  });
  assert.equal(initial.cesiumVersion, "1.146.0");
  assert.equal(initial.sceneMode, 3, "WebGL Viewer should start in 3D");
  assert.ok(initial.globePresent, "Globe must be present");
  assert.equal(initial.terrainProvider, "EllipsoidTerrainProvider");

  const scenes = [
    {
      name: "orbit",
      width: 1280,
      height: 720,
      destination: [0, 0, 20000000],
      heading: 0,
      pitch: -Math.PI / 2,
    },
    {
      name: "oblique",
      width: 1280,
      height: 720,
      destination: [-75, 40, 8000000],
      heading: 0.25,
      pitch: -0.85,
    },
    {
      name: "resized",
      width: 1024,
      height: 768,
      destination: [12, 48, 3500000],
      heading: 0.4,
      pitch: -1.0,
    },
  ];

  const evidence = [];
  for (const scene of scenes) {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    const state = await page.evaluate(async (view) => {
      const viewer = globalThis.__m0Viewer;
      viewer.resize();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(...view.destination),
        orientation: {
          heading: view.heading,
          pitch: view.pitch,
          roll: 0,
        },
      });

      const deadline = Date.now() + 60000;
      let frames = 0;
      while (Date.now() < deadline) {
        viewer.resize();
        viewer.render();
        frames++;
        if (viewer.scene.globe.tilesLoaded && frames >= 3) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (!viewer.scene.globe.tilesLoaded) {
        throw new Error("Globe surface tiles did not become ready for " + view.name);
      }
      // Let the last submitted frame reach the browser compositor.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const gl = viewer.scene.context._gl;
      return {
        name: view.name,
        framesUntilReady: frames,
        tilesLoaded: viewer.scene.globe.tilesLoaded,
        renderedTileCount: viewer.scene.globe._surface._tilesToRender.length,
        canvasWidth: viewer.canvas.width,
        canvasHeight: viewer.canvas.height,
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
        webglVersion: gl.getParameter(gl.VERSION),
        glRenderer: gl.getParameter(gl.RENDERER),
        contextLost: gl.isContextLost(),
      };
    }, scene);

    assert.equal(state.tilesLoaded, true, scene.name + ": globe tiles must be loaded");
    assert.ok(state.renderedTileCount > 0, scene.name + ": at least one surface tile must render");
    assert.ok(state.canvasWidth > 0 && state.canvasHeight > 0);
    assert.ok(state.drawingBufferWidth > 0 && state.drawingBufferHeight > 0);
    assert.ok(state.webglVersion.includes("WebGL"));
    assert.equal(state.contextLost, false);

    const first = await page.locator("#cesiumContainer canvas").screenshot();
    const second = await page.locator("#cesiumContainer canvas").screenshot();
    assert.ok(first.length > 1000, scene.name + ": screenshot unexpectedly small");
    assert.ok(first.equals(second), scene.name + ": repeated settled screenshots differ");
    const screenshotPath = outputDir + "/webgl-" + scene.name + ".png";
    await writeFile(screenshotPath, first);
    evidence.push({
      ...state,
      screenshot: screenshotPath,
      screenshotSha256: createHash("sha256").update(first).digest("hex"),
      repeatCaptureEqual: true,
      repeatCaptureDifferenceBytes: 0,
    });
  }

  await page.evaluate(() => globalThis.__m0Viewer.destroy());
  assert.deepEqual(errors, [], "Browser errors during WebGL visual regression");
  const result = {
    cesiumVersion: initial.cesiumVersion,
    browserVersion: browser.version(),
    backend: "WebGL",
    terrainProvider: initial.terrainProvider,
    scenes: evidence,
    browserErrors: errors,
    browserWarnings: warnings,
    comparison: "Two settled screenshots per scene compared byte-for-byte; zero difference. This is same-run repeatability, not a cross-version golden baseline.",
  };
  await writeFile(outputDir + "/webgl-smoke.json", JSON.stringify(result, null, 2) + "\n");
  console.log("M0.5 WEBGL VISUAL REGRESSION PASS", JSON.stringify(result));
} catch (error) {
  await writeFile(
    outputDir + "/webgl-smoke-error.json",
    JSON.stringify({ error: String(error), browserErrors: errors, browserWarnings: warnings }, null, 2) + "\n",
  );
  if (page) {
    await page.screenshot({ path: outputDir + "/webgl-smoke-failure.png", fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
