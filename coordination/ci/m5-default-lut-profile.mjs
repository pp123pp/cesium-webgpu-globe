/* global Cesium, document, window, performance, crypto */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import express from "express";
import { chromium } from "playwright";
import {
  assertPhysicalGpu,
  classifyGpu,
  getBrowserConfiguration,
} from "./m0-browser-config.mjs";

const root = path.resolve(
  process.env.M5_LUT_ROOT ?? "Build/default-lut-performance",
);
const output = path.join(root, process.env.M5_LUT_RESULT ?? "samples.json");
const order = process.env.M5_LUT_ORDER ?? "ABBAABBA";
const configuration = getBrowserConfiguration();
const samples = [];
const builds = {};

// Timing starts at navigation. A new browser/context starts with an empty
// HTTP cache; a second new page shares only that context's warmed cache.
async function firstAtmosphere() {
  const scriptReady = performance.now();
  const viewer = new Cesium.Viewer("globe", {
    renderingBackend: "webgpu",
    useDefaultRenderLoop: false,
    skyBox: false,
  });
  await viewer.readyPromise;
  const scene = viewer.scene;
  viewer.clock.shouldAnimate = false;
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
    "2026-03-20T12:00:00Z",
  );
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 30000),
    orientation: { heading: 0, pitch: 0, roll: 0 },
  });
  scene.globe.show = false;
  scene.atmosphere.show = true;
  const atmosphere = scene._atmosphere;
  let updateCpuMs = 0;
  const update = atmosphere.update;
  atmosphere.update = function (...args) {
    const start = performance.now();
    const result = update.apply(this, args);
    updateCpuMs += performance.now() - start;
    return result;
  };
  const start = performance.now();
  viewer.render();
  const submitted = performance.now();
  await scene.context._device.queue.onSubmittedWorkDone();
  const finished = performance.now();
  atmosphere.update = update;
  window.viewer = viewer;
  const info = scene.context._adapter.info;
  const resource = performance
    .getEntriesByType("resource")
    .find((entry) => entry.name.endsWith("/Cesium.js"));
  return {
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: info.isFallbackAdapter,
    },
    scriptReadyMs: scriptReady,
    firstVisibleQueueMs: finished,
    renderCpuMs: submitted - start,
    renderToQueueMs: finished - start,
    updateCpuMs,
    transferSize: resource.transferSize,
    encodedBodySize: resource.encodedBodySize,
    lutBuilds: atmosphere.statistics.lutBuilds,
    prebakedLoads: atmosphere.statistics.prebakedLutLoads ?? 0,
    atmosphereFrames: atmosphere.statistics.frames,
  };
}

async function verifyRestore() {
  const viewer = window.viewer;
  const medium = viewer.scene.atmosphere;
  const canvas = document.createElement("canvas");
  canvas.width = viewer.canvas.width;
  canvas.height = viewer.canvas.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const rows = [];
  const height = medium.rayleighScaleHeight;
  for (const setting of [height, height * 1.5, height]) {
    medium.rayleighScaleHeight = setting;
    viewer.render();
    context.drawImage(viewer.canvas, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels));
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 40) {
      colors.add(
        pixels[index] * 65536 + pixels[index + 1] * 256 + pixels[index + 2],
      );
    }
    rows.push({
      setting,
      hash: Array.from(hash, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join(""),
      sampledColors: colors.size,
      prebakedLoads: viewer.scene._atmosphere.statistics.prebakedLutLoads ?? 0,
    });
  }
  return rows;
}

for (const version of new Set(order)) {
  assert.ok(version === "A" || version === "B");
  const bytes = await readFile(path.join(root, version, "Cesium.js"));
  const gzip = gzipSync(bytes);
  builds[version] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    gzipBytes: gzip.length,
    gzip,
  };
}
const app = express();
app.get("/:version/Cesium.js", (req, res) => {
  const build = builds[req.params.version];
  res
    .set({
      "Content-Type": "text/javascript",
      "Content-Encoding": "gzip",
      "Cache-Control": "public, max-age=3600",
    })
    .send(build.gzip);
});
app.get("/:version/view", (req, res) => {
  assert.ok(builds[req.params.version]);
  res.type("html")
    .send(`<!DOCTYPE html><style>*{margin:0}#globe{width:640px;height:360px}</style><div id="globe"></div>
  <script>window.CESIUM_BASE_URL="/Build/CesiumUnminified/";</script>
  <script src="Cesium.js"></script><script>window.result=(${firstAtmosphere.toString()})();</script>`);
});
app.use(express.static(process.cwd()));
const server = await new Promise((ready) => {
  const handle = app.listen(0, "127.0.0.1", () => ready(handle));
});
try {
  await mkdir(root, { recursive: true });
  for (const version of order) {
    const browser = await chromium.launch(configuration.launchOptions);
    try {
      const context = await browser.newContext({
        viewport: { width: 640, height: 360 },
      });
      for (const cache of ["cold", "warm"]) {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(
          `http://127.0.0.1:${server.address().port}/${version}/view`,
        );
        const row = await page.evaluate(() => window.result);
        assertPhysicalGpu(classifyGpu(row.adapter), configuration);
        assert.equal(row.lutBuilds, 1);
        assert.equal(row.prebakedLoads, version === "B" ? 1 : 0);
        assert.equal(row.atmosphereFrames, 1);
        assert.equal(row.transferSize > 0, cache === "cold");
        assert.equal(row.encodedBodySize, builds[version].gzipBytes);
        assert.deepEqual(errors, []);
        const sample = { version, cache, browser: browser.version(), ...row };
        if (
          cache === "warm" &&
          !samples.some((s) => s.version === version && s.restore)
        ) {
          sample.restore = await page.evaluate(verifyRestore);
          const [first, custom, restored] = sample.restore;
          assert.ok(first.sampledColors > 5);
          assert.notEqual(first.hash, custom.hash);
          assert.equal(first.hash, restored.hash);
          assert.equal(restored.prebakedLoads, version === "B" ? 2 : 0);
        }
        samples.push(sample);
        await page.close();
        const metadata = Object.fromEntries(
          Object.entries(builds).map(([key, { sha256, bytes, gzipBytes }]) => [
            key,
            { sha256, bytes, gzipBytes },
          ]),
        );
        await writeFile(
          output,
          JSON.stringify({ order, builds: metadata, samples }, null, 2),
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
