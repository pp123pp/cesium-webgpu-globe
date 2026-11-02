import console from "node:console";
import { setTimeout, clearTimeout } from "node:timers";
import { Buffer } from "node:buffer";
import process from "node:process";
// M0.5 offline WebGL Globe regression. Build and serve the checkout on :8080.
/* global Cesium, requestAnimationFrame, performance, document, btoa, fetch, AbortSignal */
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  mkdtemp,
  cp,
  rename,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  getBrowserConfiguration,
  classifyGpu,
  assertPhysicalGpu,
} from "./m0-browser-config.mjs";
import { inspectGlobePixels, comparePixels } from "./m0-visual-checks.mjs";

const referenceCommit = "724b5db8f258d0ce00c4f6b774bd38529e24252b";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const referenceDir =
  process.env.M0_REFERENCE_DIR ?? path.join(scriptDir, "references/m0-webgl");
const outputDir = process.env.M0_WEBGL_OUTPUT ?? "Build/m0-baseline";
const base = process.env.M0_BASE_URL ?? "http://localhost:8080";
const update = process.env.M0_UPDATE_WEBGL_REFERENCE === "1";
const negativeControl = process.env.M0_NEGATIVE_CONTROL === "missing-globe";
const fixtures = [
  {
    name: "orbit",
    width: 1280,
    height: 720,
    longitude: -75,
    latitude: 35,
    range: 20000000,
    heading: 0,
    pitch: -90,
  },
  {
    name: "oblique",
    width: 1280,
    height: 720,
    longitude: 110,
    latitude: -20,
    range: 18000000,
    heading: 30,
    pitch: -60,
  },
  {
    name: "resized",
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    range: 25000000,
    heading: 0,
    pitch: -90,
  },
];
const colors = { background: [8, 12, 20, 255], surface: [48, 112, 168, 255] };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fixtureHash = hash(
  JSON.stringify({ fixtures, colors, time: "2026-01-01T12:00:00Z" }),
);
const harnessHash = hash(await readFile(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];
const results = [];
const pendingReferences = [];
let timedOut = false;
let browser;
let page;
let config;
await mkdir(outputDir, { recursive: true });
await rm(path.join(outputDir, "webgl-smoke.json"), { force: true });
const deadline = setTimeout(() => {
  timedOut = true;
  errors.push("Overall WebGL deadline exceeded");
  void browser?.close();
}, 120000);
try {
  config = getBrowserConfiguration();
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (update) {
    assert.equal(
      sourceCommit,
      referenceCommit,
      "Reference must be generated from the pre-WebGPU checkout",
    );
    assert.equal(
      execFileSync(
        "git",
        [
          "diff",
          "HEAD",
          "--",
          "packages",
          "Source",
          "Specs",
          "package.json",
          "gulpfile.js",
          "scripts",
        ],
        { encoding: "utf8" },
      ),
      "",
      "Reference source must be clean",
    );
    await mkdir(referenceDir, { recursive: true });
  }
  // Bind the served bundle to this checkout. Merely checking cwd/HEAD cannot
  // detect a stale server listening at M0_BASE_URL from another build.
  const localBundle = await readFile("Build/CesiumUnminified/Cesium.js");
  const bundleResponse = await fetch(
    `${base}/Build/CesiumUnminified/Cesium.js`,
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  assert.ok(bundleResponse.ok, "Cesium bundle is not served");
  const bundleHash = hash(localBundle);
  assert.equal(
    hash(Buffer.from(await bundleResponse.arrayBuffer())),
    bundleHash,
    "Served bundle does not match the current checkout build",
  );
  browser = await chromium.launch(config.launchOptions);
  page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
    if (message.type() === "warning") {
      warnings.push(message.text());
    }
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${base}/Specs/e2e/cesium.html`, { waitUntil: "load" });
  await page.addScriptTag({ url: `${base}/Build/CesiumUnminified/Cesium.js` });
  const environment = await page.evaluate(
    ({ colors }) => {
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
        skyBox: false,
        skyAtmosphere: false,
        useDefaultRenderLoop: false,
        contextOptions: {
          webgl: { antialias: false, preserveDrawingBuffer: true },
        },
      });
      const scene = viewer.scene;
      scene.rethrowRenderErrors = true;
      if (scene.sun) {
        scene.sun.show = false;
      }
      if (scene.moon) {
        scene.moon.show = false;
      }
      scene.fog.enabled = false;
      scene.highDynamicRange = false;
      scene.postProcessStages.fxaa.enabled = false;
      scene.backgroundColor = Cesium.Color.fromBytes(...colors.background);
      scene.globe.baseColor = Cesium.Color.fromBytes(...colors.surface);
      scene.globe.showGroundAtmosphere = false;
      scene.globe.enableLighting = false;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
        "2026-01-01T12:00:00Z",
      );
      viewer.clock.shouldAnimate = false;
      globalThis.__m0Viewer = viewer;
      const gl = scene.context._gl;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        cesiumVersion: Cesium.VERSION,
        webglVersion: gl.getParameter(gl.VERSION),
        renderer: gl.getParameter(
          debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
        ),
        vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
        sceneMode: scene.mode,
        terrainProvider: scene.globe.terrainProvider.constructor.name,
      };
    },
    { colors },
  );
  assert.equal(environment.cesiumVersion, "1.146.0");
  assert.equal(environment.sceneMode, 3);
  const gpu = classifyGpu(environment);
  assertPhysicalGpu(gpu, config);
  for (const fixture of fixtures) {
    await page.setViewportSize({
      width: fixture.width,
      height: fixture.height,
    });
    const rendered = await page.evaluate(
      async ({ fixture, negativeControl }) => {
        const viewer = globalThis.__m0Viewer;
        const scene = viewer.scene;
        const globe = scene.globe;
        scene.camera.lookAt(
          Cesium.Cartesian3.fromDegrees(fixture.longitude, fixture.latitude),
          new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(fixture.heading),
            Cesium.Math.toRadians(fixture.pitch),
            fixture.range,
          ),
        );
        scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.resize();
        let stableFrames = 0;
        let frames = 0;
        const start = performance.now();
        let readyTiles = 0;
        while (stableFrames < 3) {
          if (performance.now() - start > 30000) {
            throw new Error(
              `Visible Globe readiness timeout (${readyTiles} tiles)`,
            );
          }
          viewer.render();
          frames++;
          const selected = globe._surface._tilesToRender;
          readyTiles = selected.filter(
            (tile) => tile.renderable && tile.data?.vertexArray,
          ).length;
          stableFrames =
            globe.show &&
            globe.tilesLoaded &&
            readyTiles > 0 &&
            readyTiles === selected.length
              ? stableFrames + 1
              : 0;
          await new Promise(requestAnimationFrame);
        }
        if (negativeControl) {
          globe.show = false;
        }
        viewer.render();
        const gl = scene.context._gl;
        if (gl.isContextLost()) {
          throw new Error("WebGL context lost");
        }
        const pixels = scene.context.readPixels({
          width: viewer.canvas.width,
          height: viewer.canvas.height,
        });
        let binary = "";
        for (let i = 0; i < pixels.length; i += 32768) {
          binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
        }
        return {
          pixels: btoa(binary),
          frames,
          readyTiles,
          tilesLoaded: globe.tilesLoaded,
          width: viewer.canvas.width,
          height: viewer.canvas.height,
        };
      },
      { fixture, negativeControl },
    );
    const pixels = Buffer.from(rendered.pixels, "base64");
    delete rendered.pixels;
    // Retain fda7f01's settled-frame repeatability check alongside the
    // independently built, spatial pixel reference comparison.
    const first = await page.locator("#cesiumContainer canvas").screenshot();
    const second = await page.locator("#cesiumContainer canvas").screenshot();
    assert.ok(first.length > 1000, "Globe screenshot unexpectedly small");
    assert.ok(first.equals(second), "Repeated settled screenshots differ");
    await writeFile(path.join(outputDir, `webgl-${fixture.name}.png`), first);
    rendered.repeatCaptureEqual = true;
    rendered.repeatCaptureDifferenceBytes = 0;
    rendered.screenshotSha256 = hash(first);
    await writeFile(
      path.join(outputDir, `${fixture.name}.rgba.gz`),
      gzipSync(pixels),
    );
    const pixelCheck = inspectGlobePixels(
      pixels,
      rendered.width,
      rendered.height,
      colors,
    );
    const metadata = {
      referenceCommit,
      fixtureHash,
      harnessHash,
      bundleHash,
      fixture,
      colors,
      pixelHash: hash(pixels),
      environment,
      browser: browser.version(),
      config,
      gpu,
      pixelCheck,
    };
    let comparison;
    if (update) {
      pendingReferences.push({ name: fixture.name, pixels, metadata });
      comparison = { referenceGenerated: true };
    } else {
      const reference = JSON.parse(
        await readFile(path.join(referenceDir, `${fixture.name}.json`), "utf8"),
      );
      assert.equal(reference.referenceCommit, referenceCommit);
      assert.equal(
        reference.fixtureHash,
        fixtureHash,
        "Reference fixture changed",
      );
      const expected = gunzipSync(
        await readFile(path.join(referenceDir, `${fixture.name}.rgba.gz`)),
      );
      assert.equal(
        hash(expected),
        reference.pixelHash,
        "Reference payload hash mismatch",
      );
      comparison = comparePixels(pixels, expected);
    }
    results.push({
      fixture: fixture.name,
      ...rendered,
      pixelCheck,
      comparison,
    });
  }
  await page.evaluate(() => {
    const viewer = globalThis.__m0Viewer;
    viewer.destroy();
    if (
      !viewer.isDestroyed() ||
      document.querySelector("#cesiumContainer canvas")
    ) {
      throw new Error("WebGL Viewer teardown failed");
    }
  });
  assert.deepEqual(errors, [], "Browser errors during WebGL regression");
  assert.equal(timedOut, false, "Overall WebGL deadline exceeded");
  await browser.close();
  assert.equal(timedOut, false, "Overall WebGL deadline exceeded");
  const report = {
    sourceCommit,
    referenceCommit,
    fixtureHash,
    bundleHash,
    browser: browser.version(),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    config,
    environment,
    gpu,
    results,
    browserErrors: errors,
    browserWarnings: warnings,
  };
  await writeFile(
    path.join(outputDir, "webgl-smoke.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  assert.equal(timedOut, false, "Overall WebGL deadline exceeded");
  // Stage the complete set; no failed fixture/teardown/staging run can replace
  // accepted references. Directory publication is a short rollback-able step.
  if (pendingReferences.length > 0) {
    const candidate = await mkdtemp(`${referenceDir}.candidate-`);
    const backup = `${candidate}.previous`;
    let movedPrevious = false;
    try {
      await cp(referenceDir, candidate, { recursive: true });
      for (const entry of pendingReferences) {
        await writeFile(
          path.join(candidate, `${entry.name}.rgba.gz`),
          gzipSync(entry.pixels),
        );
        await writeFile(
          path.join(candidate, `${entry.name}.json`),
          `${JSON.stringify(entry.metadata, null, 2)}\n`,
        );
      }
      assert.equal(timedOut, false, "Overall WebGL deadline exceeded");
      // All timed validation and staging has passed; publish the accepted set.
      clearTimeout(deadline);
      await rename(referenceDir, backup);
      movedPrevious = true;
      await rename(candidate, referenceDir);
      movedPrevious = false;
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (movedPrevious) {
        await rename(backup, referenceDir);
      }
      throw error;
    } finally {
      await rm(candidate, { recursive: true, force: true });
    }
  }
  assert.equal(timedOut, false, "Overall WebGL deadline exceeded");
  console.log("M0 WEBGL VISUAL PASS", JSON.stringify(report));
} catch (error) {
  await rm(path.join(outputDir, "webgl-smoke.json"), { force: true });
  await writeFile(
    path.join(outputDir, "webgl-smoke-error.json"),
    `${JSON.stringify({ error: String(error), config, results, browserErrors: errors, browserWarnings: warnings }, null, 2)}\n`,
  );
  if (page) {
    await page
      .screenshot({
        path: path.join(outputDir, "webgl-smoke-failure.png"),
        timeout: 5000,
      })
      .catch(() => {});
  }
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
