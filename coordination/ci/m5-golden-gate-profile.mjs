/* global window, document, performance, requestAnimationFrame, GPUAdapter, GPUBufferUsage, GPUMapMode, Cesium */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import {
  openReferenceDemo,
  selectReferenceScene,
  sourceOf,
} from "./m5-reference-harness.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = process.argv.includes("--record");
const root = path.resolve(
  process.env.M5_GOLDEN_ROOT ?? "Build/golden-gate-profile",
);
const cache = path.join(root, "tiles");
process.env.M1_OUTPUT ??= path.join(root, record ? "A1" : "candidate");

await runM1BrowserSuite("golden-gate-profile", async (context) => {
  const { page, report, output } = context;
  await mkdir(cache, { recursive: true });
  await page.addInitScript(() => {
    const original = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = function (descriptor = {}) {
      const requiredFeatures = new Set(descriptor.requiredFeatures ?? []);
      if (this.features.has("timestamp-query")) {
        requiredFeatures.add("timestamp-query");
      }
      return original.call(this, {
        ...descriptor,
        requiredFeatures: [...requiredFeatures],
      });
    };
  });
  await openReferenceDemo(context, 1280, 720);
  const responses = new Map();
  const writes = [];
  if (record) {
    page.on("response", (response) => {
      const type = sourceOf(response.url());
      if (!type || !response.ok()) {
        return;
      }
      writes.push(
        (async () => {
          const key = sha(response.url());
          const bytes = await response.body();
          await writeFile(path.join(cache, key), bytes);
          responses.set(key, {
            type,
            mime: response.headers()["content-type"],
            sha256: sha(bytes),
          });
        })().catch((error) => {
          return String(error);
        }),
      );
    });
  } else {
    const entries = JSON.parse(
      await readFile(path.join(cache, "index.json"), "utf8"),
    );
    await page.route(
      (url) => !!sourceOf(url.href),
      async (route) => {
        const key = sha(route.request().url());
        const entry = entries[key];
        if (!entry) {
          return route.abort();
        }
        const bytes = await readFile(path.join(cache, key));
        assert.equal(sha(bytes), entry.sha256);
        responses.set(key, entry);
        await route.fulfill({
          status: 200,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": entry.mime,
          },
          body: bytes,
        });
      },
    );
  }
  if (process.argv.includes("--imagery-load")) {
    await page.evaluate(observeImageryLoading);
  }
  await selectReferenceScene(page, "terrain-shadow");
  if (process.argv.includes("--imagery-load")) {
    report.imageryLoading = await page.evaluate(() =>
      window.__stopImageryLoading(),
    );
  }
  await page.bringToFront();
  await page.evaluate(() => {
    const v = window.__referenceViewer;
    v.useDefaultRenderLoop = false;
    v.clock.shouldAnimate = false;
    window.__goldenTileKeys = () =>
      v.scene._renderer._draws.map(({ tile, rectangle }) => ({
        tile: [tile.level, tile.x, tile.y],
        rectangle: [
          rectangle.west,
          rectangle.south,
          rectangle.east,
          rectangle.north,
        ],
        imagery: tile.data.imagery
          .filter(
            (a) =>
              a.readyImagery?.texture &&
              a.readyImagery.imageryLayer.show &&
              a.readyImagery.imageryLayer.alpha !== 0,
          )
          .map((a) => {
            const i = a.readyImagery;
            return [
              i.imageryLayer.imageryProvider.constructor.name,
              i.level,
              i.x,
              i.y,
            ];
          }),
      }));
  });
  report.tiles = await page.evaluate(() => window.__goldenTileKeys());
  report.sourceSnapshot = sha(JSON.stringify(report.tiles));
  const tilePath = path.join(cache, "selection.json");
  if (record) {
    const writeErrors = (await Promise.all(writes)).filter(Boolean);
    report.resourceArchiveReadErrors = writeErrors;
    await writeFile(
      path.join(cache, "index.json"),
      JSON.stringify(Object.fromEntries(responses), null, 2),
    );
    await writeFile(tilePath, JSON.stringify(report.tiles, null, 2));
  } else {
    assert.deepEqual(
      report.tiles,
      JSON.parse(await readFile(tilePath, "utf8")),
      "A/B need identical selected terrain and imagery tiles",
    );
  }
  report.remoteResources = Object.fromEntries(
    ["elevation", "imagery"].map((t) => [
      t,
      [...responses.values()].filter((e) => e.type === t).length,
    ]),
  );
  assert.ok(
    report.remoteResources.elevation > 1 && report.remoteResources.imagery > 1,
    "requires actual Esri tiles",
  );
  report.camera = await page.evaluate(() => {
    const v = window.__referenceViewer,
      c = v.camera,
      toDeg = Cesium.Math.toDegrees;
    return {
      longitude: toDeg(c.positionCartographic.longitude),
      latitude: toDeg(c.positionCartographic.latitude),
      height: c.positionCartographic.height,
      heading: toDeg(c.heading),
      pitch: toDeg(c.pitch),
      utc: Cesium.JulianDate.toIso8601(v.clock.currentTime),
      size: [v.canvas.width, v.canvas.height],
      terrain: v.terrainProvider.constructor.name,
      source: document.getElementById("source").dataset.terrain,
    };
  });
  assert.equal(report.camera.utc, "2026-03-20T20:00:00Z");
  assert.equal(report.camera.terrain, "ArcGISTiledElevationTerrainProvider");
  const cameraPath = path.join(cache, "camera.json");
  if (record) {
    await writeFile(cameraPath, JSON.stringify(report.camera, null, 2));
  } else {
    const data = (await readFile(cameraPath, "utf8")).replace(/^\uFEFF/, "");
    assert.deepEqual(
      report.camera,
      JSON.parse(data),
      "A/B require identical live source, UTC, pose and resolution",
    );
  }
  await page.evaluate(() => {
    const v = window.__referenceViewer;
    const r = v.scene._renderer;
    const original = r._drawImagery;
    const tiles = [...new Set(r._draws.map((d) => d.tile))];
    const images = tiles.map(({ data }) => {
      const all = data.imagery;
      const first = all.find(
        (a) =>
          a.readyImagery?.texture &&
          a.readyImagery.imageryLayer.show &&
          a.readyImagery.imageryLayer.alpha !== 0,
      );
      return { data, all, first: first ? [first] : [] };
    });
    window.__goldenSetMode = (mode) => {
      r._drawImagery = original;
      v.scene.clouds.shadows = mode !== "shadows-off";
      v.scene.clouds.ambientShadows = mode !== "shadows-off";
      if (mode === "imagery-off") {
        r._drawImagery = () => {};
      }
      if (mode === "first-imagery") {
        r._drawImagery = function (pass, scene) {
          for (const row of images) {
            row.data.imagery = row.first;
          }
          try {
            return original.call(this, pass, scene);
          } finally {
            for (const row of images) {
              row.data.imagery = row.all;
            }
          }
        };
      }
    };
  });
  report.measurements = [];
  const modes = process.argv.includes("--reverse")
    ? ["full", "first-imagery", "shadows-off", "full-repeat"]
    : process.argv.includes("--diagnose")
      ? ["full", "shadows-off", "first-imagery", "imagery-off", "full-repeat"]
      : ["full", "shadows-off"];
  for (const mode of modes) {
    await page.evaluate((mode) => window.__goldenSetMode(mode), mode);
    const png = await page.evaluate(captureReferencePng);
    const bytes = Buffer.from(png, "base64");
    await writeFile(path.join(output, `${mode}.png`), bytes);
    if (mode === "shadows-off" && modes.length === 2) {
      report.shadowOffControl = { pngSha256: sha(bytes) };
      continue;
    }
    const measured = await page.evaluate(measureGolden);
    if (mode === "full" && process.argv.includes("--imagery-load")) {
      measured.indexedGeometry = await page.evaluate(measureIndexedGeometry);
      assert.equal(
        measured.indexedGeometry.imagery.length,
        measured.draws.imagery,
      );
      assert.equal(
        measured.indexedGeometry.terrain.length,
        measured.draws.terrain,
      );
    }
    if (mode === "full-repeat") {
      assert.equal(
        sha(bytes),
        report.measurements[0].pngSha256,
        "baseline image must restore",
      );
    }
    assert.equal(
      sha(JSON.stringify(await page.evaluate(() => window.__goldenTileKeys()))),
      report.sourceSnapshot,
    );
    assert.ok(measured.draws.terrain > 0);
    if (mode === "imagery-off") {
      assert.equal(measured.draws.imagery, 0);
    }
    if (mode === "first-imagery") {
      assert.ok(
        measured.draws.imagery > 0 &&
          measured.draws.imagery <= measured.draws.terrain,
      );
    }
    report.measurements.push({ mode, pngSha256: sha(bytes), ...measured });
    await writeFile(
      path.join(output, "progress.json"),
      JSON.stringify(report, null, 2),
    );
  }
  if (process.argv.includes("--imagery-load")) {
    await page.evaluate(() => {
      window.__goldenSetMode("full");
      const v = window.__referenceViewer;
      v.scene.globe.showSkirts = false;
      const layers = [...Array(v.imageryLayers.length).keys()].map((i) =>
        v.imageryLayers.get(i),
      );
      const satellite = layers.find(
        (l) =>
          l.imageryProvider.constructor.name ===
          "ArcGisMapServerImageryProvider",
      );
      satellite.alpha = 0.5;
    });
    const bytes = Buffer.from(
      await page.evaluate(captureReferencePng),
      "base64",
    );
    await writeFile(
      path.join(output, "satellite-half-alpha-no-skirts.png"),
      bytes,
    );
    report.imageryControl = {
      satelliteAlpha: 0.5,
      showSkirts: false,
      pngSha256: sha(bytes),
      indexedGeometry: await page.evaluate(measureIndexedGeometry),
    };
    assert.notEqual(
      report.imageryControl.pngSha256,
      report.measurements[0].pngSha256,
    );
    assert.equal(
      sha(JSON.stringify(await page.evaluate(() => window.__goldenTileKeys()))),
      report.sourceSnapshot,
    );
    report.imageryCleanup = await page.evaluate(() => {
      const viewer = window.__referenceViewer;
      const stats = viewer.scene._renderer.statistics;
      const before = { ...stats };
      viewer.destroy();
      return { before, after: { ...stats } };
    });
    assert.equal(report.imageryCleanup.after.bufferBytes, 0);
    assert.equal(report.imageryCleanup.after.imageryGridBuffers ?? 0, 0);
    assert.equal(report.imageryCleanup.after.imageryGridBytes ?? 0, 0);
  }
  const errors = await page.evaluate(() => window.__m1.errors);
  assert.deepEqual(errors, []);
  report.checks.push(
    "Identical selected terrain and imagery across all samples; fixed Golden Gate camera and UTC; physical hardware; labeled GPU pass timestamps and separate visible rAF cadence.",
  );
});

function observeImageryLoading() {
  const scene = window.__referenceViewer.scene;
  const renderer = scene._renderer;
  const original = scene.render;
  const stats = renderer.statistics;
  const initial = { ...stats };
  const frames = [];
  const acquired = [];
  const acquire = renderer._acquireImageryGrid;
  if (acquire) {
    renderer._acquireImageryGrid = function (...args) {
      const before = stats.imageryGridBuildMs;
      const grid = acquire.apply(this, args);
      if (grid) {
        acquired.push(stats.imageryGridBuildMs - before);
      }
      return grid;
    };
  }
  scene.render = function (...args) {
    const beforeMs = stats.imageryGridBuildMs ?? 0;
    const beforeBuffers = stats.imageryGridBuffers ?? 0;
    const start = performance.now();
    const value = original.apply(this, args);
    const cpuRenderMs = performance.now() - start;
    frames.push({
      cpuRenderMs,
      imageryGridBuildMs: (stats.imageryGridBuildMs ?? 0) - beforeMs,
      imageryGridBuffersDelta: (stats.imageryGridBuffers ?? 0) - beforeBuffers,
      imageryDraws: stats.imageryDrawCalls,
      terrainDraws: stats.drawCalls,
    });
    return value;
  };
  window.__stopImageryLoading = () => {
    scene.render = original;
    if (acquire) {
      renderer._acquireImageryGrid = acquire;
    }
    return {
      initial,
      settled: { ...stats },
      frames,
      acquiredTileGridBuildMs: acquired,
      method:
        "Terrain/imagery loading uses archived responses. CPU duration is synchronous Scene.render only; serialized I/O wait or elapsed scene-settle time is excluded. Grid-build duration comes from the production CPU preparation counter.",
    };
  };
}

function captureReferencePng() {
  const pixels = window.__referenceCapture();
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext("2d").putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

// Count actual submissions on one settled frame, outside the timed loops.
function measureIndexedGeometry() {
  const viewer = window.__referenceViewer;
  const renderer = viewer.scene._renderer;
  const device = viewer.scene.context._device;
  const original = device.createCommandEncoder;
  const terrain = [],
    imagery = [];
  const imageryBuffers = new Set();
  device.createCommandEncoder = function (descriptor) {
    const encoder = original.call(this, descriptor);
    const begin = encoder.beginRenderPass;
    encoder.beginRenderPass = function (descriptor) {
      const pass = begin.call(this, descriptor);
      if (!descriptor.depthStencilAttachment) {
        return pass;
      }
      const setPipeline = pass.setPipeline;
      const setIndices = pass.setIndexBuffer;
      const setBindings = pass.setBindGroup;
      const draw = pass.drawIndexed;
      let pipeline, buffer, drawIndex;
      pass.setPipeline = function (active) {
        pipeline = active;
        return setPipeline.call(this, active);
      };
      pass.setIndexBuffer = function (active, ...args) {
        buffer = active;
        return setIndices.call(this, active, ...args);
      };
      pass.setBindGroup = function (slot, group, ...args) {
        if (slot === 0 && args[0]?.length) {
          drawIndex = args[0][0] / renderer._uniformStride;
        }
        return setBindings.call(this, slot, group, ...args);
      };
      pass.drawIndexed = function (count, ...args) {
        const isImagery =
          pipeline === renderer._imagePipeline ||
          pipeline === renderer._imagePipelineNoCull;
        if (isImagery) {
          imageryBuffers.add(buffer);
        }
        (isImagery ? imagery : terrain).push({
          drawIndex,
          count,
          firstIndex: args[1] ?? 0,
        });
        return draw.call(this, count, ...args);
      };
      return pass;
    };
    return encoder;
  };
  try {
    viewer.render();
  } finally {
    device.createCommandEncoder = original;
  }
  return {
    terrain,
    imagery,
    imageryGridDrawCalls: renderer.statistics.imageryGridDrawCalls ?? 0,
    imageryGridBuffers: renderer.statistics.imageryGridBuffers ?? 0,
    imageryGridBytes: renderer.statistics.imageryGridBytes ?? 0,
    imageryGridBuildMs: renderer.statistics.imageryGridBuildMs ?? 0,
    terrainIndices: terrain.reduce((sum, d) => sum + d.count, 0),
    imageryIndices: imagery.reduce((sum, d) => sum + d.count, 0),
    uniqueBoundImageryIndexBufferBytes: [...imageryBuffers].reduce(
      (sum, b) => sum + b.size,
      0,
    ),
    globeRendererBufferBytes: renderer.statistics.bufferBytes,
    globeRendererTextureBytes: renderer.statistics.textureBytes,
    reportedImageryTriangles: renderer.statistics.imageryTriangles,
  };
}

async function measureGolden() {
  const v = window.__referenceViewer,
    scene = v.scene,
    dev = scene.context._device;
  if (document.hidden || !dev.features.has("timestamp-query")) {
    throw Error("Requires visible page and physical GPU timestamp-query");
  }
  const distribution = (values) => {
    const sorted = [...values].sort((a, b) => a - b),
      mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      samples: values.length,
      meanMs: mean,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      fps: 1000 / mean,
      values,
    };
  };
  const warmup = 20,
    samples = 120,
    ticks = [],
    returned = [],
    completed = [],
    observers = [];
  await dev.queue.onSubmittedWorkDone();
  for (let i = -warmup; i <= samples; i++) {
    const tick = await new Promise(requestAnimationFrame);
    if (document.hidden) {
      throw Error("Hidden page during cadence");
    }
    v.render();
    if (i >= 0) {
      ticks.push(tick);
      returned.push(performance.now());
      observers.push(
        dev.queue.onSubmittedWorkDone().then(() => {
          completed[i] = performance.now();
        }),
      );
    }
  }
  await Promise.all(observers);
  const intervals = (ts) => distribution(ts.slice(1).map((t, i) => t - ts[i]));
  const stats = scene.debugStatistics.resources;
  const draws = {
    terrain: stats.drawCalls,
    imagery: stats.imageryDrawCalls,
    triangles: stats.triangles,
  };
  const original = dev.createCommandEncoder;
  const count = 32,
    qs = dev.createQuerySet({ type: "timestamp", count });
  const resolve = dev.createBuffer({
    size: count * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const buffer = dev.createBuffer({
    size: count * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let labels = [];
  dev.createCommandEncoder = function (descriptor) {
    const enc = original.call(this, descriptor);
    const begin = enc.beginRenderPass;
    enc.beginRenderPass = function (pass) {
      const i = labels.length;
      if (i * 2 + 2 > count) {
        throw Error("Pass count exceeded");
      }
      labels.push(pass.label ?? "terrain and imagery");
      return begin.call(this, {
        ...pass,
        timestampWrites: {
          querySet: qs,
          beginningOfPassWriteIndex: i * 2,
          endOfPassWriteIndex: i * 2 + 1,
        },
      });
    };
    return enc;
  };
  const byPass = {},
    span = [],
    cpu = [],
    wall = [];
  try {
    for (let i = -10; i < 60; i++) {
      labels = [];
      const start = performance.now();
      v.render();
      const cpuMs = performance.now() - start;
      await dev.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - start;
      const enc = original.call(dev);
      enc.resolveQuerySet(qs, 0, labels.length * 2, resolve, 0);
      enc.copyBufferToBuffer(resolve, 0, buffer, 0, labels.length * 16);
      dev.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const stamps = new BigUint64Array(buffer.getMappedRange()).slice(
        0,
        labels.length * 2,
      );
      buffer.unmap();
      if (i < 0) {
        continue;
      }
      cpu.push(cpuMs);
      wall.push(wallMs);
      span.push(Number(stamps.at(-1) - stamps[0]) / 1e6);
      labels.forEach((label, j) =>
        (byPass[label] ??= []).push(
          Number(stamps[2 * j + 1] - stamps[2 * j]) / 1e6,
        ),
      );
    }
  } finally {
    dev.createCommandEncoder = original;
    qs.destroy();
    resolve.destroy();
    buffer.destroy();
  }
  return {
    draws,
    cadence: {
      rAF: intervals(ticks),
      renderReturn: intervals(returned),
      queueCompletion: intervals(completed),
    },
    serialized: {
      cpu: distribution(cpu),
      wall: distribution(wall),
      gpuSpan: distribution(span),
      passes: Object.fromEntries(
        Object.entries(byPass).map(([k, v]) => [k, distribution(v)]),
      ),
    },
  };
}
