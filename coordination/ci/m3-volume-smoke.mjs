/* global Cesium, window, document, GPUBufferUsage, GPUMapMode */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  runM1BrowserSuite,
  installM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";
import { assertPhysicalGpu, classifyGpu } from "./m0-browser-config.mjs";
import { enableSolarTiming, trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

process.env.M1_OUTPUT ??= "Build/m3-volume-smoke";
const noon = "2026-03-20T12:00:00Z";
const at = (height, pitch, longitude = 0, latitude = 0, heading = 90) => ({
  height, pitch, longitude, latitude, heading,
});

await runM1BrowserSuite("m3-volume", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 480, height: 270 });
  await enableSolarTiming(page);
  await trackSolarAllocations(page);
  await installM1Scene(page, { baseLayer: false, skyAtmosphere: true });
  const identity = await page.evaluate(() => window.__m1.adapterInfo);
  assertPhysicalGpu(classifyGpu(identity), report.configuration);
  report.adapter = identity;
  await installFixture(page);
  report.fixture = {
    date: noon, viewport: [480, 270], maximumTerrainLevel: 8,
    terrain: "Native bounded ellipsoid terrain, then native 32x32 constant-height test mesh",
    wind: { speedMetersPerSecond: 18, directionRadians: 0.75 },
    capture: "One production viewer render per PNG, same-task swapchain readback. Each sequence has one saved image per scripted camera/time update.",
    timing: "Cloud render-pass timestamps in milliseconds. Configured primary/light step limits are budgets. Separately measured per-ray counts come from three selected native pixels outside the timing window. Resident VRAM is unmeasured.",
    visualReview: "Review ordered frames for shape, lighting, silver lining, flicker, ghosts, banding, polar seams and continuous cross-scale transitions. Pixel changes alone cannot establish visual acceptance.",
  };
  const frame = async (name, options = {}) => {
    const { png, ...row } = await page.evaluate((data) => window.__volume.frame(data), options);
    const bytes = Buffer.from(png, "base64");
    await writeFile(path.join(output, `${name  }.png`), bytes);
    const entry = { name, sha256: createHash("sha256").update(bytes).digest("hex"), ...row };
    report.scenes.push(entry);
    return entry;
  };
  const settle = async (view) => {
    await page.evaluate((v) => window.__m1.settle({ ...v, timeout: 45000 }), view);
  };
  const time = async (name, motion = false) => {
    const row = await measureCloudPass(page, motion);
    report.timings.push({ name, ...row });
    if (row.status === "MEASURED") {
      assert.ok(row.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0));
      assert.ok(row.samplesMs.some((sample) => sample > 0), "nonzero physical GPU duration");
    }
  };
  report.timings = [];
  report.stepProbes = [];
  const steps = async (name) => {
    const probes = await page.evaluate(async () => {
      const { viewer } = window.__m1;
      const { width, height } = viewer.canvas;
      const counts = [];
      for (const [u, v] of [[0.5, 0.5], [0.38, 0.52], [0.52, 0.32]]) {
        const x = Math.floor(width * u);
        const y = Math.floor(height * v);
        const result = await viewer.scene._atmosphere._cloudVolume.measureSteps(x, y);
        counts.push({ x, y, ...result });
      }
      return counts;
    });
    for (const { primarySteps, lightSteps } of probes) {
      assert.ok(Number.isInteger(primarySteps) && primarySteps >= 0);
      assert.ok(Number.isInteger(lightSteps) && lightSteps >= 0);
    }
    report.stepProbes.push({ name, probes });
  };
  const orbit = at(35786000, -90);
  const sea = at(8500, -10);
  const inside = at(4000, 0);
  await settle(orbit);
  const clear = await frame("01-orbit-disabled", { config: { show: false } });
  const cloudy = await frame("01-orbit-global", { config: { show: true, coverage: 0.78 } });
  assert.ok(cloudy.difference.changedPixels > 50, "global volume changes visible pixels");
  await steps("orbit");
  await time("orbit-medium");
  const restored = await frame("01-orbit-restored", { config: { show: false } });
  assert.equal(restored.sha256, clear.sha256, "off restores exactly at the same camera and clock");
  report.checks.push("A11 curved global cloud view and exact disabled output restoration");

  // At GEO the surface tangent is about 8.7 degrees from nadir.
  await settle(at(35786000, -81.3));
  await frame("02-orbital-limb", { config: { show: true } });
  const descent = 36;
  for (let i = 0; i < descent; i++) {
    const t = i / (descent - 1);
    const height = Math.exp(Math.log(35786000) * (1-t) + Math.log(100) * t);
    await frame(`03-descent-${  String(i).padStart(2, "0")}`, { view: at(height, -90 + 98*t) });
  }
  await steps("ground");
  await settle(sea);
  await frame("04-cloud-sea");
  await steps("cloud-sea");

  const tiers = [];
  for (const quality of ["low", "medium", "high"]) {
    const row = await frame(`04-tier-${  quality}`, { config: { quality } });
    tiers.push(row.clouds.primarySteps);
    await time(`cloud-sea-${  quality  }-tier`);
  }
  assert.ok(tiers[0] <= tiers[1] && tiers[1] <= tiers[2], "quality tier primary budgets are ordered");
  await frame("04-local-detail-off", { config: { quality: "medium", localDetail: false } });
  await frame("04-local-detail-on", { config: { localDetail: true } });
  await settle(at(7000, 0));
  for (let i = 0; i <= 24; i++) {
    await frame(`05-traversal-${  String(i).padStart(2, "0")}`, { view: at(7000 - i * 250, 0) });
  }
  await settle(inside);
  await frame("05-cloud-interior");
  await steps("cloud-interior");
  await time("interior-medium");
  await settle(at(4500, 4, 0, 0, 90));
  await frame("06-sunrise", { date: "2026-03-20T06:08:00Z" });
  await settle(at(4500, 4, 0, 0, 270));
  await frame("06-sunset", { date: "2026-03-20T18:03:00Z" });
  await settle(sea);
  for (let i = 0; i < 20; i++) {
    await frame(`07-flight-${  String(i).padStart(2, "0")}`, {
      view: at(10000 + 7500 * Math.cos(i / 4), -9, i * 0.14, 0, 70 + i * 8), date: noon,
    });
  }
  await time("rapid-flight-medium", true);
  await settle(inside);
  for (let i = 0; i < 16; i++) {
    await frame(`08-wind-${  String(i).padStart(2, "0")}`, { date: noon, seconds: i * 12 });
  }
  const moving = await frame("08-wind-advected", { date: noon, seconds: 600 });
  const calm = await frame("08-wind-stationary", { config: { windSpeed: 0 } });
  assert.notEqual(moving.sha256, calm.sha256, "wind changes the volume with identical sunlight/time/camera");

  await settle(orbit);
  for (const [name, coverage] of [["none", 0], ["sparse", 0.2], ["cloudy", 0.7], ["overcast", 1]]) {
    const row = await frame(`09-coverage-${  name}`, { config: { coverage, windSpeed: 18 }, date: noon });
    if (coverage === 0) {
      assert.equal(row.sha256, clear.sha256, "zero coverage reproduces clear sky at the same date and camera");
    }
  }
  await page.evaluate(() => {
    class Raised extends Cesium.CustomHeightmapTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    window.__m1.viewer.terrainProvider = new Raised({
      width: 32, height: 32, callback: () => new Float32Array(32*32).fill(8000),
    });
  });
  await settle(at(10000, -90));
  await frame("10-raised-terrain-disabled", { config: { show: false } });
  const blocked = await frame("10-raised-terrain-enabled", { config: { show: true } });
  assert.equal(blocked.difference.centerMax, 0, "8 km terrain hides entire cloud column at nadir");
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__volume.terrain; });
  await settle(sea);
  await frame("10-exposure-1", { exposure: 1 });
  const exposed = await frame("10-exposure-2", { exposure: 2 });
  assert.ok(exposed.difference.changedPixels > 100, "HDR exposure affects the composite");
  await frame("11-next-day", { date: "2026-03-21T12:00:00Z", exposure: 1 });
  await page.setViewportSize({ width: 512, height: 288 });
  await page.evaluate(() => window.__m1.viewer.resize());
  const resized = await frame("11-resized", { date: noon });
  assert.deepEqual(resized.size, [512, 288]);
  assert.deepEqual([resized.clouds.width, resized.clouds.height], resized.size);
  for (const [name, view] of [
    ["west-seam", at(80000, -90, -179.9999, 12)], ["east-seam", at(80000, -90, 179.9999, 12)],
    ["north-pole", at(250000, -90, 0, 89.9999)], ["south-pole", at(250000, -90, 0, -89.9999)],
  ]) {
    await settle(view);
    await frame(`12-${  name}`);
  }
  report.checks.push("A11–A13 review sequences, real raised-terrain occlusion, native HDR exposure, four coverages, resize and date changes");
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => {
    const cloud = window.__solarAllocations.filter(({ label }) => /cloud|\bM3\b/i.test(label));
    return { cloud, totalCreated: window.__solarAllocations.length, totalDestroyed: window.__solarAllocations.filter((r) => r.destroyed).length };
  });
  assert.ok(report.allocations.cloud.length > 0, "observed native production cloud allocations");
  assert.ok(report.allocations.cloud.every((r) => r.destroyCalls === 1), "every native cloud allocation destroyed exactly once");
  assert.deepEqual(report.browserConsole, []);
});

async function installFixture(page) {
  await page.evaluate(() => {
    const { viewer } = window.__m1;
    const { scene } = viewer;
    class Bounded extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    viewer.terrainProvider = new Bounded();
    scene.globe.baseColor = new Cesium.Color(0.12, 0.22, 0.32, 1);
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.camera.frustum.near = 0.1;
    viewer.camera.frustum.far = 500000000;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    // installM1Scene disables astronomical sources for ordinary terrain tests.
    scene.sun.show = true;
    scene.stars.show = true;
    Object.assign(scene.clouds, { quality: "medium", coverage: 0.78, localDetail: true, windSpeed: 18, windDirection: 0.75 });
    const copy = document.createElement("canvas");
    const ctx = copy.getContext("2d");
    let previous;
    const setView = ({ longitude, latitude, height, heading, pitch }) => viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: { heading: Cesium.Math.toRadians(heading), pitch: Cesium.Math.toRadians(pitch), roll: 0 },
    });
    window.__volume = {
      terrain: viewer.terrainProvider, setView,
      frame({ view, config, date, seconds = 0, exposure }) {
        if (view) { setView(view); }
        if (config) { Object.assign(scene.clouds, config); }
        if (date) {
          const start = Cesium.JulianDate.fromIso8601(date);
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(start, seconds, start);
        }
        if (exposure !== undefined) { scene.exposure = exposure; }
        const image = window.__m1.pixels();
        if (window.__m1.errors.length) { throw new Error(window.__m1.errors.join("\n")); }
        const { width, height, data } = image;
        let changedPixels = 0, sum = 0, centerMax = 0, max = 0;
        if (previous && previous.width === width && previous.height === height) {
          for (let i = 0; i < data.length; i += 4) {
            const delta = Math.max(
              Math.abs(data[i] - previous.data[i]),
              Math.abs(data[i + 1] - previous.data[i + 1]),
              Math.abs(data[i + 2] - previous.data[i + 2]),
            );
            if (delta > 0) { changedPixels++; }
            max = Math.max(max, delta);
            sum += delta;
            const pixel = i/4;
            if (Math.abs(pixel % width - width/2) < 8 && Math.abs(Math.floor(pixel/width)-height/2) < 8) {
              centerMax = Math.max(centerMax, delta);
            }
          }
        }
        copy.width = width; copy.height = height;
        ctx.putImageData(image, 0, 0);
        previous = image;
        const pose = viewer.camera.positionCartographic;
        return {
          png: copy.toDataURL("image/png").split(",")[1], size: [width,height],
          frame: scene._frameState.frameNumber, date: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
          view: { longitude: Cesium.Math.toDegrees(pose.longitude), latitude: Cesium.Math.toDegrees(pose.latitude), height: pose.height, heading: Cesium.Math.toDegrees(viewer.camera.heading), pitch: Cesium.Math.toDegrees(viewer.camera.pitch) },
          exposure: scene.exposure, config: { ...scene.clouds }, clouds: { ...scene._atmosphere.statistics.clouds },
          difference: { changedPixels, meanMaxChannelDelta: sum/(width*height), max, centerMax },
        };
      },
    };
  });
}

async function measureCloudPass(page, motion) {
  return page.evaluate(async (motion) => {
    const { viewer } = window.__m1;
    const { scene } = viewer;
    const device = scene.context._device;
    if (!device.features.has("timestamp-query")) {
      return { status: "UNVERIFIED", reason: "timestamp-query unavailable on the physical device" };
    }
    const querySet = device.createQuerySet({ type: "timestamp", count: 2 });
    const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const original = device.createCommandEncoder;
    let seen = 0;
    device.createCommandEncoder = function (descriptor) {
      const encoder = original.call(this, descriptor);
      const begin = encoder.beginRenderPass;
      encoder.beginRenderPass = function (pass) {
        if (pass.label !== "M3 volumetric clouds") { return begin.call(this, pass); }
        seen++;
        return begin.call(this, { ...pass, timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
      };
      return encoder;
    };
    const samplesMs = [];
    try {
      for (let i = -2; i < 10; i++) {
        if (motion) { window.__volume.setView({ longitude: (i+2)*0.14, latitude: 0, height: 8000+5000*Math.sin(i/3), pitch: -9, heading: 60+i*8 }); }
        seen = 0;
        viewer.render();
        if (seen !== 1) { throw new Error(`Expected exactly one M3 volumetric clouds pass, observed ${  seen}`); }
        const encoder = original.call(device);
        encoder.resolveQuerySet(querySet, 0, 2, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, readback, 0, 16);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const stamps = new BigUint64Array(readback.getMappedRange());
        const delta = Number(stamps[1]-stamps[0])/1e6;
        readback.unmap();
        if (i >= 0) { samplesMs.push(delta); }
      }
      const sorted = [...samplesMs].sort((a,b) => a-b);
      return { status: "MEASURED", samplesMs, meanMs: samplesMs.reduce((s,v)=>s+v,0)/samplesMs.length, p95Ms: sorted[Math.ceil(sorted.length*0.95)-1], clouds: { ...scene._atmosphere.statistics.clouds } };
    } finally {
      device.createCommandEncoder = original;
      querySet.destroy(); resolved.destroy(); readback.destroy();
    }
  }, motion);
}
