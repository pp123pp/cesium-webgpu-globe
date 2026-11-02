// M0.2 reproducible WebGL smoke. No Cesium engine/source changes.
// Run after `npm run build` with `npm run start -- --production` serving :8080.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = "http://localhost:8080";
const outputDir = "Build/m0-baseline";
await mkdir(outputDir, { recursive: true });

const errors = [];
const warnings = [];
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
  const result = await page.evaluate(async () => {
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
    });
    viewer.resize();
    viewer.render();
    await new Promise((resolve) => setTimeout(resolve, 400));
    viewer.resize();
    viewer.render();

    const canvas = viewer.canvas;
    const gl = viewer.scene.context._gl;
    const response = {
      cesiumVersion: Cesium.VERSION,
      webglVersion: gl?.getParameter(gl.VERSION),
      glRenderer: gl?.getParameter(gl.RENDERER),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      sceneMode: viewer.scene.mode,
      globePresent: !!viewer.scene.globe,
      contextLost: gl?.isContextLost(),
      drawingBufferWidth: gl?.drawingBufferWidth,
      drawingBufferHeight: gl?.drawingBufferHeight,
    };
    // Keep the Viewer alive until the screenshot has been taken.
    globalThis.__m0Viewer = viewer;
    return response;
  });
  assert.equal(result.cesiumVersion, "1.146");
  assert.ok(result.webglVersion?.includes("WebGL"), "WebGL was not initialized");
  assert.ok(result.canvasWidth > 0 && result.canvasHeight > 0);
  assert.equal(result.sceneMode, 3, "WebGL Viewer should start in 3D");
  assert.ok(result.globePresent);
  assert.equal(result.contextLost, false);
  assert.ok(result.drawingBufferWidth > 0 && result.drawingBufferHeight > 0);
  // Ignore predictable failed remote requests? This run uses local ellipsoid and no remote imagery.
  assert.deepEqual(errors, [], "Browser errors during WebGL Viewer smoke");

  await page.screenshot({ path: outputDir + "/webgl-smoke.png", fullPage: true });
  await writeFile(
    outputDir + "/webgl-smoke.json",
    JSON.stringify({ result, browserErrors: errors, browserWarnings: warnings }, null, 2) + "\n",
  );
  console.log("M0 WEBGL SMOKE PASS", JSON.stringify(result));
} catch (error) {
  await writeFile(
    outputDir + "/webgl-smoke-error.json",
    JSON.stringify({ error: String(error), browserErrors: errors, browserWarnings: warnings }, null, 2) + "\n",
  );
  if (page) await page.screenshot({ path: outputDir + "/webgl-smoke-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
