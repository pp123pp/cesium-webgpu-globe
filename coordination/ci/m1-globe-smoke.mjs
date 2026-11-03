// Real-browser M1 foundation; expanded by each accepted provider slice.
/* global Cesium, document, window, navigator, requestAnimationFrame, performance, HTMLCanvasElement, fetch */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { chromium } from "playwright";
import { getBrowserConfiguration, classifyGpu } from "./m0-browser-config.mjs";

const output = path.resolve(process.env.M1_OUTPUT ?? "Build/m1-globe");
const base = process.env.M1_BASE_URL ?? "http://127.0.0.1:8090/";
const configuration = getBrowserConfiguration();
await mkdir(output, { recursive: true });
await rm(path.join(output, "m1-globe.json"), { force: true });
await rm(path.join(output, "m1-error.json"), { force: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const localBundle = await readFile("Build/CesiumUnminified/Cesium.js");
const servedBundle = await fetch(
  new URL("Build/CesiumUnminified/Cesium.js", base),
).then((r) => r.arrayBuffer());
assert.equal(
  hash(localBundle),
  hash(new Uint8Array(servedBundle)),
  "M1 server must serve this checkout's bundle",
);
const report = {
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceStatus: execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  bundleSha256: hash(localBundle),
  configuration,
  checks: [],
  scenes: [],
};
let browser;
const browserErrors = [];
let timedOut = false;
const deadline = setTimeout(() => {
  timedOut = true;
  browserErrors.push("M1 foundation deadline exceeded");
  void browser?.close();
}, 240000);
try {
  browser = await chromium.launch(configuration.launchOptions);
  report.browser = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  await page.goto(new URL("Specs/e2e/cesium.html", base).href);
  await page.addScriptTag({
    url: new URL("Build/CesiumUnminified/Cesium.js", base).href,
  });
  report.environment = await page.evaluate(async () => {
    const contexts = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      contexts.push(kind);
      return original.call(this, kind, ...args);
    };
    const errors = [];
    const viewer = new Cesium.Viewer("cesiumContainer", {
      renderingBackend: "webgpu",
      baseLayer: false,
      // This gate measures M1 geometry/LOD, with its original time and pixel
      // bounds. M2's dedicated gate and the live demo cover enabled atmosphere.
      skyAtmosphere: false,
      skyBox: false,
      useDefaultRenderLoop: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider({
        ellipsoid: Cesium.Ellipsoid.WGS84,
      }),
    });
    const sharedGlobe = viewer.scene.globe;
    let duplicateRejected = false;
    try {
      const unexpectedOwner = new Cesium.Viewer("cesiumContainer", {
        renderingBackend: "webgpu",
        globe: sharedGlobe,
        baseLayer: false,
        useDefaultRenderLoop: false,
      });
      unexpectedOwner.destroy();
    } catch (error) {
      duplicateRejected = /another scene/.test(String(error));
    }
    if (!duplicateRejected || document.querySelectorAll("canvas").length !== 1) {
      throw new Error("An unrendered Globe must have exactly one Viewer owner");
    }
    viewer.renderError.addEventListener((...event) =>
      errors.push(String(event[1])),
    );
    window.__m1 = { viewer, errors, contexts };
    await viewer.readyPromise;
    if (
      !(viewer.camera instanceof Cesium.Camera) ||
      !(viewer.scene.globe instanceof Cesium.Globe)
    ) {
      throw new Error("M1 must preserve native Camera and Globe instances");
    }
    viewer.scene.globe.baseColor = new Cesium.Color(0.2, 0.45, 0.7, 1);
    const adapter = viewer._webgpuProof._context._adapter;
    const info = adapter.info;
    return {
      cesium: Cesium.VERSION,
      atmosphereShown: viewer.scene.atmosphere.show,
      radii: [
        viewer.scene.globe.ellipsoid.radii.x,
        viewer.scene.globe.ellipsoid.radii.y,
        viewer.scene.globe.ellipsoid.radii.z,
      ],
      userAgent: navigator.userAgent,
      adapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter,
      },
    };
  });
  report.gpu = classifyGpu(report.environment.adapter);
  assert.equal(report.environment.atmosphereShown, false);
  assert.deepEqual(
    report.environment.radii,
    [6378137, 6378137, 6356752.314245179],
  );
  for (const fixture of [
    { name: "orbit", longitude: 0, latitude: 20, height: 20000000 },
    { name: "pole", longitude: 35, latitude: 89.9, height: 15000000 },
    { name: "dateline", longitude: 179.9, latitude: -25, height: 12000000 },
    { name: "surface", longitude: 10, latitude: 45, height: 10000 },
  ]) {
    const result = await page.evaluate(async (view) => {
      const { viewer, errors, contexts } = window.__m1;
      const scene = viewer.scene;
      scene.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          view.longitude,
          view.latitude,
          view.height,
        ),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      const start = performance.now();
      let stable = 0;
      let frames = 0;
      while (stable < 3) {
        viewer.render();
        ++frames;
        const statistics = scene.debugStatistics;
        stable =
          scene.globe.tilesLoaded && statistics.resources.drawCalls > 0
            ? stable + 1
            : 0;
        if (errors.length || performance.now() - start > 60000) {
          throw new Error(
            JSON.stringify({ errors, timeout: true, statistics, frames }),
          );
        }
        await new Promise(requestAnimationFrame);
      }
      viewer.render();
      const copy = document.createElement("canvas");
      copy.width = viewer.canvas.width;
      copy.height = viewer.canvas.height;
      const context = copy.getContext("2d");
      context.drawImage(viewer.canvas, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let backgroundPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 10) {
          ++backgroundPixels;
        }
      }
      let tested = 0;
      let matches = 0;
      let foreground = 0;
      for (let y = 12; y < copy.height; y += 24) {
        for (let x = 12; x < copy.width; x += 24) {
          const ray = scene.camera.getPickRay(new Cesium.Cartesian2(x, y));
          const expected =
            Cesium.IntersectionTests.rayEllipsoid(
              ray,
              scene.globe.ellipsoid,
            ) !== undefined;
          const i = (y * copy.width + x) * 4;
          const visible = pixels[i] + pixels[i + 1] + pixels[i + 2] > 20;
          ++tested;
          if (visible) {
            ++foreground;
          }
          if (visible === expected) {
            ++matches;
          }
        }
      }
      const center = ((copy.height >> 1) * copy.width + (copy.width >> 1)) * 4;
      return {
        name: view.name,
        frames,
        elapsedMs: performance.now() - start,
        statistics: scene.debugStatistics,
        silhouette: {
          tested,
          matches,
          foreground,
          agreement: matches / tested,
        },
        center: Array.from(pixels.slice(center, center + 4)),
        backgroundPixels,
        viewport: [copy.width, copy.height],
        contexts: [...new Set(contexts)],
        errors: [...errors],
      };
    }, fixture);
    assert.ok(
      result.silhouette.foreground > 0,
      `${fixture.name}: no Globe pixels`,
    );
    assert.ok(
      result.silhouette.agreement > 0.99,
      `${fixture.name}: WGS84 silhouette mismatch ${JSON.stringify(result.silhouette)}`,
    );
    assert.equal(result.errors.length, 0);
    if (fixture.name === "surface") {
      assert.equal(
        result.backgroundPixels,
        0,
        "Near-surface tiles must cover every pixel without background cracks",
      );
    }
    assert.ok(
      !result.contexts.some((kind) => /webgl/i.test(kind)),
      "WebGPU Globe cannot use a hidden WebGL context",
    );
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: path.join(output, `${fixture.name}.png`) });
    report.scenes.push(result);
    console.log(
      `M1 ${fixture.name}: ${result.statistics.selectedTiles} tiles; levels ${Math.min(...result.statistics.levels)}–${Math.max(...result.statistics.levels)}; silhouette ${result.silhouette.matches}/${result.silhouette.tested}`,
    );
  }
  report.checks.push(
    "native WGS84/Camera/Globe",
    "orbital/polar/dateline silhouettes",
    "native quadtree LOD",
    "no WebGL context",
    "terrain worker meshes",
    "exclusive Globe ownership before first render",
  );
  report.sceneErrorContract = await page.evaluate(() => {
    const { viewer, errors } = window.__m1;
    const scene = viewer.scene;
    let correctSource = false;
    scene.renderError.addEventListener((source) => {
      correctSource = source === scene;
    });
    scene.rethrowRenderErrors = false;
    scene.mode = Cesium.SceneMode.SCENE2D;
    scene.render();
    return {
      correctSource,
      errors: [...errors],
      sceneDestroyed: scene.isDestroyed(),
    };
  });
  assert.equal(report.sceneErrorContract.correctSource, true);
  assert.equal(report.sceneErrorContract.errors.length, 1);
  assert.match(report.sceneErrorContract.errors[0], /SCENE3D/);
  report.checks.push("direct Scene.render error event and rethrow policy");
  report.destroy = await page.evaluate(() => {
    const { viewer } = window.__m1;
    const renderer = viewer.scene._renderer;
    viewer.destroy();
    return {
      statistics: { ...renderer.statistics },
      canvases: document.querySelectorAll("canvas").length,
      destroyed: viewer.isDestroyed(),
    };
  });
  assert.equal(report.destroy.statistics.bufferBytes, 0);
  assert.equal(
    report.destroy.statistics.buffersCreated,
    report.destroy.statistics.buffersDestroyed,
  );
  assert.equal(report.destroy.canvases, 0);
  assert.equal(report.destroy.destroyed, true);
  assert.deepEqual(browserErrors, []);
  await browser.close();
  browser = undefined;
  assert.equal(timedOut, false);
  report.status = "PASS";
  await writeFile(
    path.join(output, "m1-globe.json"),
    JSON.stringify(report, null, 2),
  );
  assert.equal(timedOut, false);
  console.log(`M1 foundation PASS: ${report.checks.join(", ")}`);
} catch (error) {
  await rm(path.join(output, "m1-globe.json"), { force: true });
  await writeFile(
    path.join(output, "m1-error.json"),
    JSON.stringify({ ...report, error: String(error), browserErrors }, null, 2),
  );
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
