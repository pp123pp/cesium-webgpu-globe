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
import {
  enableSolarTiming,
  trackSolarAllocations,
} from "./m2-solar-gpu-timing.mjs";

process.env.M1_OUTPUT ??= "Build/m3-volume-smoke";
const noon = "2026-03-20T12:00:00Z";
const at = (height, pitch, longitude = 0, latitude = 0, heading = 90) => ({
  height,
  pitch,
  longitude,
  latitude,
  heading,
});

await runM1BrowserSuite("m3-volume", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 480, height: 270 });
  await enableSolarTiming(page);
  await trackSolarAllocations(page);
  await installM1Scene(page, { baseLayer: false });
  const identity = await page.evaluate(() => window.__m1.adapterInfo);
  assertPhysicalGpu(classifyGpu(identity), report.configuration);
  report.adapter = identity;
  await installFixture(page);
  report.fixture = {
    date: noon,
    viewport: [480, 270],
    maximumTerrainLevel: 8,
    terrain:
      "Native bounded ellipsoid terrain, then native 32x32 constant-height test mesh",
    wind: { speedMetersPerSecond: 18, directionRadians: 0.75 },
    capture:
      "One production viewer render per PNG, same-task swapchain readback. Each sequence has one saved image per scripted camera/time update.",
    timing:
      "Production cloud tracing and reconstruction pass timestamps, reported individually and as a paired per-frame sum in milliseconds. Configured step limits and three independently replayed native-pixel step counts are recorded separately. Resident VRAM is unmeasured.",
    visualReview:
      "Review ordered frames for shape, lighting, silver lining, flicker, ghosts, banding, polar seams and continuous cross-scale transitions. Pixel changes alone cannot establish visual acceptance.",
  };
  const frame = async (name, options = {}) => {
    const { png, ...row } = await page.evaluate(
      (data) => window.__volume.frame(data),
      options,
    );
    const bytes = Buffer.from(png, "base64");
    await writeFile(path.join(output, `${name}.png`), bytes);
    const entry = {
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...row,
    };
    report.scenes.push(entry);
    return entry;
  };
  const settle = async (view) => {
    await page.evaluate(
      (v) => window.__m1.settle({ ...v, timeout: 45000 }),
      view,
    );
  };
  const time = async (name, motion = false) => {
    const row = await measureCloudPass(page, motion);
    report.timings.push({ name, ...row });
    if (process.argv.includes("--profile")) {
      assert.equal(row.status, "MEASURED", row.reason);
      assert.equal(row.count, 120);
    }
    if (row.status === "MEASURED") {
      assert.ok(
        row.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0),
      );
      assert.ok(
        row.samplesMs.some((sample) => sample > 0),
        "nonzero physical GPU duration",
      );
    }
  };
  report.timings = [];
  if (process.argv.includes("--clear-coverage")) {
    await settle(at(9500, -9, 0, 0, 247));
    const off = await frame("clouds-off", { config: { show: false } });
    const clear = await frame("zero-coverage", {
      config: { show: true, coverage: 0, mist: true },
    });
    assert.equal(clear.cloudPasses, 0);
    assert.equal(clear.reconstructionPasses, 0);
    assert.equal(clear.sha256, off.sha256);
    assert.equal(
      await page.evaluate(
        () => !!window.__m1.viewer.scene._atmosphere._cloudVolume,
      ),
      false,
      "initial clear sky does not allocate a cloud volume",
    );
    const visible = await frame("restored", { config: { coverage: 0.58 } });
    assert.equal(visible.cloudPasses, 1);
    assert.equal(visible.reconstructionPasses, 1);
    assert.notEqual(visible.sha256, clear.sha256);
    const cleared = await frame("cleared-again", { config: { coverage: 0 } });
    assert.equal(cleared.cloudPasses, 0);
    assert.equal(cleared.reconstructionPasses, 0);
    assert.equal(cleared.sha256, off.sha256);
    const restored = await frame("restored-again", {
      config: { coverage: 0.58 },
    });
    assert.equal(restored.sha256, visible.sha256);
    await checkRaisedTerrain(page, settle, frame);
    report.checks.push(
      "Zero coverage skips cloud allocation and both passes; restoring coverage redraws the same clouds. Raised terrain occludes the cloud column.",
    );
    report.cleanup = await destroyM1Scene(page);
    return;
  }
  if (process.argv.includes("--motion-and-mist")) {
    const baseline = process.argv.includes("--accepted-baseline");
    await page.setViewportSize({ width: 640, height: 360 });
    await page.evaluate(() => window.__m1.viewer.resize());
    Object.assign(report.fixture, {
      viewport: [640, 360],
      terrain: "Native bounded ellipsoid terrain",
      capture: "Matched fixed-view growth, flyby, morning pan and gap closure sequences",
    });
    const render = async (name, view, config, date, seconds = 0) => {
      const row = await frame(name, { view, config, date, seconds, exposure: 1, lens: false });
      assert.equal(row.cloudPasses, 1);
      assert.equal(row.reconstructionPasses, 1);
      return row;
    };
    const afternoon = "2026-03-20T16:30:00Z";
    const fixed = at(6900, -8, 0, 0, 247);
    await settle(fixed);
    const cloud = { show: true, coverage: 0.58, quality: "medium", windSpeed: 18 };
    if (process.argv.includes("--phase-wrap")) {
      const start = "2026-03-20T16:32:23Z";
      const rows = [];
      for (let i = -6; i <= 6; i++) {
        const pose = { ...fixed, longitude: i * 0.00002 };
        const row = await render(`wrap-${i + 6}`, pose, { ...cloud, evolution: true }, start, i / 30);
        row.phaseUniform = await page.evaluate(
          () => window.__m1.viewer.scene._atmosphere._cloudVolume.values[34],
        );
        rows.push(row);
      }
      assert.ok(rows[5].phaseUniform > 7 && rows[6].phaseUniform < 1.01);
      const neighbors = [...rows.slice(1, 6), ...rows.slice(7)];
      assert.ok(rows[6].difference.meanMaxChannelDelta <= 2 * Math.max(...neighbors.map((r) => r.difference.meanMaxChannelDelta)),
        "the phase wrap stays within neighboring moving-frame changes");
      report.cleanup = await destroyM1Scene(page);
      return;
    }
    for (const moving of [false, true]) {
      const prefix = moving ? "fly" : "fixed";
      for (let i = 0; i <= 20; i++) {
        const view = moving ? at(6900 - i * 58, -8, i * 0.0025, 0, 247) : fixed;
        const name = `${prefix}-${String(i).padStart(2, "0")}`;
        await render(name, view, baseline ? cloud : { ...cloud, evolution: true }, afternoon, i * 3);
      }
    }
    await time("360p-moving-cloud");
    const dawn = "2026-03-20T07:10:00Z";
    const view = at(600, 7, 0, 0, 20);
    const low = { ...cloud, windSpeed: 0 };
    await settle(view);
    for (let i = 0; i <= 20; i++) {
      const pose = { ...view, longitude: (i - 10) * 0.0025 };
      const name = `pan-${String(i).padStart(2, "0")}`;
      await render(name, pose, baseline ? low : { ...low, evolution: false, mist: true }, dawn);
    }
    await time("360p-dawn-pan");
    for (let i = 0; i <= 10; i++) {
      const config = { ...low, coverage: 0.15 + 0.085 * i };
      await render(`gap-${String(i).padStart(2, "0")}`, view,
        baseline ? config : { ...config, mist: true }, dawn);
    }
    if (!baseline) {
      await render("fixed-off-control", fixed, { ...cloud, evolution: false, mist: false }, afternoon);
      await render("pan-off-control", view, { ...low, evolution: false, mist: false }, dawn);
      const clear = await frame("coverage-zero", { config: { coverage: 0, mist: true } });
      const off = await frame("clouds-off", { config: { show: false } });
      assert.equal(clear.sha256, off.sha256, "zero coverage with mist reproduces clear sky");
    }
    assert.deepEqual(report.browserConsole, []);
    report.cleanup = await destroyM1Scene(page);
    return;
  }
  if (process.argv.includes("--cloud-types")) {
    const baseline = process.argv.includes("--step-one-baseline");
    const cloud = { show: true, coverage: 0.58, windSpeed: 0 };
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.__m1.viewer.resize());
    Object.assign(report.fixture, {
      viewport: [1280, 720],
      terrain: "Native bounded ellipsoid terrain",
      wind: { speedMetersPerSecond: 0, directionRadians: 0.75 },
      capture: "Matched cloud-type, aerial-perspective and twilight views",
    });
    const capture = async (name, config, date) => {
      const row = await frame(name, { config, date, exposure: 1, lens: false });
      assert.equal(row.cloudPasses, 1);
      assert.equal(row.reconstructionPasses, 1);
      return row;
    };
    const afternoon = "2026-03-20T16:30:00Z";
    await settle(at(9500, -9, 0, 0, 247));
    const cumulus = await capture("cumulus", cloud, afternoon);
    if (!baseline) {
      assert.equal(cumulus.config.type, "cumulus");
      assert.equal(cumulus.config.cirrus, false);
      const banks = await capture(
        "stratocumulus",
        { type: "stratocumulus" },
        afternoon,
      );
      assert.deepEqual(banks.view, cumulus.view);
      assert.notEqual(cumulus.sha256, banks.sha256);
      assert.ok(banks.difference.changedPixels > 1000);
      await time("720p-medium-stratocumulus");
    }
    await settle(at(4500, 14, 0, 0, 250));
    const gap = await capture(
      "low-cloud-gap",
      baseline ? { coverage: 0.35 } : { type: "cumulus", coverage: 0.35 },
      afternoon,
    );
    if (!baseline) {
      const cirrus = await capture(
        "gap-with-cirrus",
        { cirrus: true },
        afternoon,
      );
      assert.deepEqual(gap.view, cirrus.view);
      assert.ok(cirrus.difference.changedPixels > 200);
      await time("720p-medium-with-cirrus");
    }
    await settle(at(8000, -3, 0, 0, 265));
    await capture(
      "horizontal-cloud-sea",
      baseline ? cloud : { ...cloud, cirrus: false },
      afternoon,
    );
    await time("720p-medium-horizontal");
    const sea = await recordOptics(page, report, "horizontal-cloud-sea");
    assert.ok(
      sea.representativeDistanceMeters.p90 > sea.representativeDistanceMeters.p10,
    );
    const dusk = "2026-03-20T18:18:00Z";
    await capture("twilight-low-clouds", { coverage: 0.48 }, dusk);
    if (!baseline) {
      const lowLight = await recordOptics(page, report, "twilight-low-clouds");
      const high = await capture("twilight-high-layer", { cirrus: true }, dusk);
      assert.ok(high.difference.changedPixels > 200);
      const highLight = await recordOptics(page, report, "twilight-high-layer");
      assert.ok(highLight.direct.max > lowLight.direct.max);
    }
    await frame("twilight-clouds-off", { config: { show: false } });
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "Matched native 720p cloud type, clear gap, horizontal distance and dusk views.",
    );
    report.cleanup = await destroyM1Scene(page);
    return;
  }
  if (process.argv.includes("--sky-lighting")) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.__m1.viewer.resize());
    await settle(at(9500, -9, 0, 0, 247));
    report.fixture.viewport = [1280, 720];
    report.fixture.wind.speedMetersPerSecond = 0;
    report.fixture.terrain = "Native bounded ellipsoid terrain";
    report.fixture.capture =
      "Fixed camera, cloud field and exposure, changing only the solar time.";
    const config = { show: true, coverage: 0.58, windSpeed: 0 };
    for (const [name, date] of [
      ["noon", noon],
      ["afternoon", "2026-03-20T16:30:00Z"],
      ["sunset", "2026-03-20T17:55:00Z"],
    ]) {
      const row = await frame(name, { config, date, exposure: 1, lens: false });
      assert.equal(row.cloudPasses, 1);
      assert.equal(row.reconstructionPasses, 1);
      await recordOptics(page, report, name);
    }
    await time("720p-medium-sunset");
    await frame("sunset-clouds-off", { config: { show: false } });
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "Three fixed-field solar elevations with one production cloud draw and reconstruction each.",
    );
    report.cleanup = await destroyM1Scene(page);
    return;
  }
  report.stepProbes = [];
  const steps = async (name) => {
    const probes = await page.evaluate(async () => {
      const { viewer } = window.__m1;
      const { width, height } = viewer.canvas;
      const counts = [];
      for (const [u, v] of [
        [0.5, 0.5],
        [0.38, 0.52],
        [0.52, 0.32],
      ]) {
        const x = Math.floor(width * u);
        const y = Math.floor(height * v);
        const result = await viewer.scene._atmosphere._cloudVolume.measureSteps(
          x,
          y,
        );
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
  const sea = at(11500, -18);
  let inside = at(4000, -3);
  await settle(orbit);
  const clear = await frame("01-orbit-disabled", { config: { show: false } });
  const far = await frame("01-orbit-enabled", {
    config: { show: true, coverage: 1 },
  });
  assert.equal(
    far.sha256,
    clear.sha256,
    "far-orbit output matches clouds disabled",
  );
  assert.equal(
    far.cloudPasses,
    0,
    "no production cloud pass at GEO, even at full coverage",
  );
  assert.equal(far.reconstructionPasses, 0);
  report.timings.push({
    name: "orbit",
    status: "CULLED",
    observedPasses: far.cloudPasses,
    reconstructionPasses: far.reconstructionPasses,
  });
  const restored = await frame("01-orbit-restored", {
    config: { show: false },
  });
  assert.equal(
    restored.sha256,
    clear.sha256,
    "off restores exactly at the same camera and clock",
  );
  report.checks.push(
    "User-revised A11: far orbit clear at full coverage, with zero cloud passes",
  );

  // At GEO the surface tangent is about 8.7 degrees from nadir.
  await settle(at(35786000, -81.3));
  const limbOff = await frame("02-orbital-limb-disabled", {
    config: { show: false },
  });
  const limb = await frame("02-orbital-limb", {
    config: { show: true, coverage: 0.58 },
  });
  assert.equal(limb.sha256, limbOff.sha256);
  assert.equal(limb.cloudPasses, 0);
  assert.equal(limb.reconstructionPasses, 0);
  const transition = [];
  for (let h = 260000; h >= 70000; h -= 10000) {
    const view = at(h, -55);
    await settle(view);
    await frame(`02-fade-${h}-off`, { config: { show: false } });
    const row = await frame(`02-fade-${h}-on`, { config: { show: true } });
    transition.push({
      height: h,
      passCount: row.cloudPasses,
      ...row.difference,
    });
  }
  report.heightTransition = transition;
  assert.equal(transition[0].changedPixels, 0, "fully clear above 250 km");
  assert.equal(transition[0].passCount, 0);
  assert.ok(
    transition.at(-1).changedPixels > 50,
    "cloud area visible below 80 km",
  );
  const descent = 36;
  for (let i = 0; i < descent; i++) {
    const t = i / (descent - 1);
    const height = Math.exp(Math.log(35786000) * (1 - t) + Math.log(100) * t);
    await frame(`03-descent-${String(i).padStart(2, "0")}`, {
      view: at(height, -90 + 98 * t),
    });
  }
  await steps("ground");
  report.regions = [];
  // Match the local examples/clouds camera and art settings in a WGS84 frame.
  const localReferenceView = at(8, 2, 0, 0, 125);
  await settle(localReferenceView);
  await frame("03-reference-ground", {
    config: { show: true, coverage: 0.49, windSpeed: 12, localDetail: false },
    exposure: 0.55,
    date: "2026-03-20T14:00:00Z",
  });
  await recordOptics(page, report, "03-reference-ground");
  await frame("03-reference-ground-default-exposure", { exposure: 1 });
  await frame("03-reference-clear", {
    config: { show: false, windSpeed: 18, localDetail: true },
    date: noon,
  });
  const sites = [
    { name: "equator", view: at(1200, 11, 0, 0) },
    { name: "north-atlantic", view: at(1200, 11, -29, 37) },
    { name: "south-indian", view: at(1200, 11, 49, -32) },
  ];
  for (const { name, view } of sites) {
    await settle(view);
    await frame(`03-local-${name}-off`, {
      config: { show: false, coverage: 0.58 },
    });
    const local = await frame(`03-local-${name}-on`, {
      config: { show: true },
    });
    assert.ok(
      local.difference.changedPixels > 50,
      `visible low-altitude volume at ${name}`,
    );
    report.regions.push({ name, sha256: local.sha256, ...local.difference });
  }
  await settle(sites[0].view);
  const replay = await frame("03-local-equator-revisited");
  assert.equal(
    replay.sha256,
    report.regions[0].sha256,
    "return to fixed position and clock reproduces cloud placement",
  );
  // Sparse input stresses the close-view art control at one fixed site.
  await frame("03-sparse-site-no-local", {
    config: { coverage: 0.13, localDetail: false },
  });
  await recordOptics(page, report, "03-sparse-site-no-local");
  const sparse = await frame("03-sparse-site-local", {
    config: { localDetail: true },
  });
  await recordOptics(page, report, "03-sparse-site-local");
  assert.ok(
    sparse.difference.changedPixels > 50,
    "local detail restores visible clouds in sparse weather",
  );
  await frame("03-sparse-site-zero", { config: { coverage: 0 } });
  const sparseOff = await frame("03-sparse-site-disabled", {
    config: { show: false },
  });
  assert.equal(
    sparseOff.difference.changedPixels,
    0,
    "coverage zero disables even close-view enrichment",
  );
  await settle(sea);
  await frame("04-cloud-sea", { config: { coverage: 0.58, show: true } });
  await recordOptics(page, report, "04-cloud-sea");
  await steps("cloud-sea");

  const tiers = [];
  for (const quality of ["low", "medium", "high"]) {
    const row = await frame(`04-tier-${quality}`, { config: { quality } });
    const divider = quality === "high" ? 1 : 2;
    assert.deepEqual(
      [row.clouds.width, row.clouds.height],
      row.size.map((axis) => Math.ceil(axis / divider)),
      `${quality} trace target dimensions`,
    );
    assert.equal(row.cloudPasses, 1);
    assert.equal(row.reconstructionPasses, divider === 2 ? 1 : 0);
    tiers.push(row.clouds.primarySteps);
    await time(`cloud-sea-${quality}-tier`);
  }
  assert.ok(
    tiers[0] <= tiers[1] && tiers[1] <= tiers[2],
    "quality tier primary budgets are ordered",
  );
  await frame("04-local-detail-off", {
    config: { quality: "medium", localDetail: false },
  });
  await frame("04-local-detail-on", { config: { localDetail: true } });
  await settle(at(7000, 0));
  for (let i = 0; i <= 24; i++) {
    await frame(`05-traversal-${String(i).padStart(2, "0")}`, {
      view: at(7000 - i * 250, 0),
    });
  }
  // Save all fixed candidates. Rank by measured opacity variation across the
  // field so the selected interior shows both denser material and openings.
  let bestContrast = -1;
  for (const [i, view] of [
    at(3400, -4),
    at(3900, 4, 0.18),
    at(4300, 8, -0.22),
  ].entries()) {
    await settle(view);
    const name = `05-interior-candidate-${i}`;
    await frame(name);
    const optics = await recordOptics(page, report, name);
    const contrast = optics.opacity.p90 - optics.opacity.p10;
    if (contrast > bestContrast) {
      inside = view;
      bestContrast = contrast;
    }
  }
  await settle(inside);
  await frame("05-cloud-interior");
  const interior = await recordOptics(page, report, "05-cloud-interior");
  report.interiorHasStructure =
    interior.opacity.p90 - interior.opacity.p10 > 0.05;
  await steps("cloud-interior");
  await time("interior-medium");
  for (const [name, view, date] of [
    ["06-sunrise", at(9500, -9, 0, 0, 112), "2026-03-20T06:27:00Z"],
    ["06-sunset", at(9500, -9, 0, 0, 247), "2026-03-20T17:39:00Z"],
    ["06-side-lit-high", at(30000, -12, 0, 0, 237), "2026-03-20T17:27:00Z"],
  ]) {
    await settle(view);
    await frame(name, { date });
    await recordOptics(page, report, name);
  }
  await frame("06-lens-enabled", { lens: true });
  await frame("06-lens-disabled", { lens: false });
  await frame("06-atmosphere-disabled", { atmosphere: false });
  const air = await frame("06-atmosphere-enabled", { atmosphere: true });
  assert.ok(
    air.difference.changedPixels > 0,
    "both atmosphere variants run with active volume",
  );
  await settle(sea);
  for (let i = 0; i < 20; i++) {
    await frame(`07-flight-${String(i).padStart(2, "0")}`, {
      view: at(10000 + 7500 * Math.cos(i / 4), -9, i * 0.14, 0, 70 + i * 8),
      date: noon,
    });
  }
  await time("rapid-flight-medium", true);
  await settle(inside);
  for (let i = 0; i < 16; i++) {
    await frame(`08-wind-${String(i).padStart(2, "0")}`, {
      date: noon,
      seconds: i * 12,
    });
  }
  const moving = await frame("08-wind-advected", { date: noon, seconds: 600 });
  const calm = await frame("08-wind-stationary", { config: { windSpeed: 0 } });
  assert.notEqual(
    moving.sha256,
    calm.sha256,
    "wind changes the volume with identical sunlight/time/camera",
  );

  await settle(sea);
  const seaClear = await frame("09-coverage-disabled", {
    config: { show: false },
    date: noon,
  });
  for (const [name, coverage] of [
    ["none", 0],
    ["sparse", 0.2],
    ["cloudy", 0.7],
    ["overcast", 1],
  ]) {
    const row = await frame(`09-coverage-${name}`, {
      config: { show: true, coverage, windSpeed: 18 },
      date: noon,
    });
    if (coverage === 0) {
      assert.equal(
        row.sha256,
        seaClear.sha256,
        "zero coverage reproduces clear sky at the same date and camera",
      );
    }
  }
  await checkRaisedTerrain(page, settle, frame);
  await settle(sea);
  await frame("10-exposure-1", { exposure: 1 });
  const exposed = await frame("10-exposure-2", { exposure: 2 });
  assert.ok(
    exposed.difference.changedPixels > 100,
    "HDR exposure affects the composite",
  );
  await frame("11-next-day", { date: "2026-03-21T12:00:00Z", exposure: 1 });
  await page.setViewportSize({ width: 512, height: 288 });
  await page.evaluate(() => window.__m1.viewer.resize());
  const resized = await frame("11-resized", { date: noon });
  assert.deepEqual(resized.size, [512, 288]);
  assert.deepEqual(
    [resized.clouds.width, resized.clouds.height],
    resized.size.map((axis) => Math.ceil(axis / 2)),
  );
  for (const [name, view] of [
    ["west-seam", at(80000, -90, -179.9999, 12)],
    ["east-seam", at(80000, -90, 179.9999, 12)],
    ["north-pole", at(50000, -90, 0, 89.9999)],
    ["south-pole", at(50000, -90, 0, -89.9999)],
  ]) {
    await settle(view);
    await frame(`12-${name}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.__m1.viewer.resize());
  await settle(sea);
  const large = await frame("13-cloud-sea-720p", {
    date: noon,
    config: { quality: "medium", coverage: 0.58, localDetail: true },
  });
  assert.deepEqual(large.size, [1280, 720]);
  assert.deepEqual([large.clouds.width, large.clouds.height], [640, 360]);
  await time("cloud-sea-medium-1280x720");
  await settle(localReferenceView);
  await frame("13-ground-afternoon-720p", {
    date: "2026-03-20T14:00:00Z",
    exposure: 0.55,
    config: {
      coverage: 0.49,
      quality: "medium",
      localDetail: true,
      windSpeed: 12,
    },
  });
  report.checks.push(
    "Revised A11 and A12–A13 review sequences, real raised-terrain occlusion, native HDR exposure, four coverages, resize and date changes",
  );
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => {
    const cloud = window.__solarAllocations.filter(({ label }) =>
      /cloud|\bM3\b/i.test(label),
    );
    return {
      cloud,
      totalCreated: window.__solarAllocations.length,
      totalDestroyed: window.__solarAllocations.filter((r) => r.destroyed)
        .length,
    };
  });
  assert.ok(
    report.allocations.cloud.length > 0,
    "observed native production cloud allocations",
  );
  assert.ok(
    report.allocations.cloud.every((r) => r.destroyCalls === 1),
    "every native cloud allocation destroyed exactly once",
  );
  assert.deepEqual(report.browserConsole, []);
  assert.ok(
    report.interiorHasStructure,
    "selected interior has distinct translucent and dense sightlines",
  );
});

async function checkRaisedTerrain(page, settle, frame) {
  await page.evaluate(() => {
    class Raised extends Cesium.CustomHeightmapTerrainProvider {
      getLevelMaximumGeometricError(level) {
        return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
      }
    }
    window.__m1.viewer.terrainProvider = new Raised({
      width: 32,
      height: 32,
      callback: () => new Float32Array(32 * 32).fill(8000),
    });
  });
  await settle(at(10000, -90));
  await frame("10-raised-terrain-disabled", { config: { show: false } });
  const blocked = await frame("10-raised-terrain-enabled", {
    config: { show: true },
  });
  assert.equal(
    blocked.difference.centerMax,
    0,
    "8 km terrain hides entire cloud column at nadir",
  );
  await page.evaluate(() => {
    window.__m1.viewer.terrainProvider = window.__volume.terrain;
  });
}

async function installFixture(page) {
  await page.evaluate(() => {
    const { viewer } = window.__m1;
    const { scene } = viewer;
    class Bounded extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) {
        return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
      }
    }
    viewer.terrainProvider = new Bounded();
    scene.globe.baseColor = new Cesium.Color(0.12, 0.22, 0.32, 1);
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.camera.frustum.near = 0.1;
    viewer.camera.frustum.far = 500000000;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
      "2026-03-20T12:00:00Z",
    );
    // installM1Scene disables astronomical sources for ordinary terrain tests.
    scene.atmosphere.show = true;
    scene.globe.enableLighting = true;
    scene.sun.show = true;
    scene.stars.show = true;
    Object.assign(scene.clouds, {
      quality: "medium",
      coverage: 0.78,
      localDetail: true,
      windSpeed: 18,
      windDirection: 0.75,
    });
    const copy = document.createElement("canvas");
    const ctx = copy.getContext("2d");
    let previous;
    const device = scene.context._device;
    const original = device.createCommandEncoder;
    let cloudPasses = 0;
    let reconstructionPasses = 0;
    device.createCommandEncoder = function (descriptor) {
      const encoder = original.call(this, descriptor);
      const begin = encoder.beginRenderPass;
      encoder.beginRenderPass = function (pass) {
        if (pass.label === "M3 volumetric clouds") {
          cloudPasses++;
        } else if (pass.label === "M3 cloud reconstruction") {
          reconstructionPasses++;
        }
        return begin.call(this, pass);
      };
      return encoder;
    };
    const setView = ({ longitude, latitude, height, heading, pitch }) =>
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0,
        },
      });
    window.__volume = {
      terrain: viewer.terrainProvider,
      setView,
      frame({ view, config, date, seconds = 0, exposure, lens, atmosphere }) {
        if (view) {
          setView(view);
        }
        if (config) {
          Object.assign(scene.clouds, config);
        }
        if (date) {
          const start = Cesium.JulianDate.fromIso8601(date);
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
            start,
            seconds,
            start,
          );
        }
        if (exposure !== undefined) {
          scene.exposure = exposure;
        }
        if (lens !== undefined) {
          scene._atmosphere.lensFlare.enabled = lens;
        }
        if (atmosphere !== undefined) {
          scene.atmosphere.show = atmosphere;
        }
        cloudPasses = 0;
        reconstructionPasses = 0;
        const image = window.__m1.pixels();
        if (window.__m1.errors.length) {
          throw new Error(window.__m1.errors.join("\n"));
        }
        const { width, height, data } = image;
        let changedPixels = 0,
          sum = 0,
          centerMax = 0,
          max = 0;
        if (
          previous &&
          previous.width === width &&
          previous.height === height
        ) {
          for (let i = 0; i < data.length; i += 4) {
            const delta = Math.max(
              Math.abs(data[i] - previous.data[i]),
              Math.abs(data[i + 1] - previous.data[i + 1]),
              Math.abs(data[i + 2] - previous.data[i + 2]),
            );
            if (delta > 0) {
              changedPixels++;
            }
            max = Math.max(max, delta);
            sum += delta;
            const pixel = i / 4;
            if (
              Math.abs((pixel % width) - width / 2) < 8 &&
              Math.abs(Math.floor(pixel / width) - height / 2) < 8
            ) {
              centerMax = Math.max(centerMax, delta);
            }
          }
        }
        copy.width = width;
        copy.height = height;
        ctx.putImageData(image, 0, 0);
        previous = image;
        const pose = viewer.camera.positionCartographic;
        return {
          png: copy.toDataURL("image/png").split(",")[1],
          size: [width, height],
          frame: scene._frameState.frameNumber,
          date: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
          view: {
            longitude: Cesium.Math.toDegrees(pose.longitude),
            latitude: Cesium.Math.toDegrees(pose.latitude),
            height: pose.height,
            heading: Cesium.Math.toDegrees(viewer.camera.heading),
            pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
          },
          cloudPasses,
          reconstructionPasses,
          atmosphere: scene.atmosphere.show,
          lens: scene._atmosphere.lensFlare.enabled,
          exposure: scene.exposure,
          config: { ...scene.clouds },
          clouds: { ...scene._atmosphere.statistics.clouds },
          difference: {
            changedPixels,
            meanMaxChannelDelta: sum / (width * height),
            max,
            centerMax,
          },
        };
      },
    };
  });
}

// Sample exactly the same transport and depth functions as the active scene.
// The grid replay runs outside timed rendering and never changes the canvas.
async function recordOptics(page, report, name) {
  const samples = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const volume = viewer.scene._atmosphere._cloudVolume;
    const device = viewer.scene.context._device;
    let pipeline = window.__volume.opticsPipeline;
    if (!pipeline) {
      const module = device.createShaderModule({
        code: `${Cesium.WebGPUCloudVolumeShader}
          @group(0) @binding(22) var<storage, read_write> opticalSamples: array<vec4f>;
          @compute @workgroup_size(8, 1)
          fn sampleCloudOptics(@builtin(global_invocation_id) id: vec3u) {
            let size = vec2f(textureDimensions(sceneDepth));
            let pixel = floor((vec2f(id.xy) + vec2f(0.5)) * size / vec2f(32.0, 18.0)) + vec2f(0.5);
            let trace = cloudTrace(cloudViewDirection(pixel), pixel);
            opticalSamples[id.y * 32u + id.x] = vec4f(1.0 - trace.transmission,
              trace.direct, trace.ambient, trace.distanceMoment);
          }`,
      });
      pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "sampleCloudOptics" },
      });
      window.__volume.opticsPipeline = pipeline;
    }
    const size = 32 * 18 * 16;
    const output = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          ...volume._entries(),
          { binding: 22, resource: { buffer: output } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(4, 18);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, size);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(readback.getMappedRange()));
    } finally {
      readback.destroy();
      output.destroy();
    }
  });
  const opacity = [],
    direct = [],
    edgeLight = [],
    coreLight = [],
    distance = [];
  for (let i = 0; i < samples.length; i += 4) {
    const a = samples[i],
      sun = samples[i + 1],
      moment = samples[i + 3];
    assert.ok(Number.isFinite(a) && a >= 0 && a <= 1);
    assert.ok(Number.isFinite(sun) && sun >= 0);
    opacity.push(a);
    if (a > 0.01) {
      direct.push(sun);
      distance.push(moment / a);
    }
    if (a > 0.12 && a < 0.8) {
      edgeLight.push(sun / a);
    }
    if (a >= 0.9) {
      coreLight.push(sun / a);
    }
  }
  const distribution = (values) => {
    if (!values.length) {
      return { count: 0 };
    }
    values.sort((a, b) => a - b);
    const q = (p) => values[Math.floor((values.length - 1) * p)];
    return {
      count: values.length,
      min: values[0],
      p10: q(0.1),
      p50: q(0.5),
      p90: q(0.9),
      max: values.at(-1),
    };
  };
  const row = {
    name,
    grid: [32, 18],
    opacity: distribution(opacity),
    clearRays: opacity.filter((a) => a < 0.1).length,
    denseRays: opacity.filter((a) => a > 0.9).length,
    direct: distribution(direct),
    partiallyOpaqueDirectPerOpacity: distribution(edgeLight),
    denseDirectPerOpacity: distribution(coreLight),
    representativeDistanceMeters: distribution(distance),
  };
  (report.optics ??= []).push(row);
  return row;
}

async function measureCloudPass(page, motion) {
  const profile = process.argv.includes("--profile");
  return page.evaluate(async ({ motion, warmup, samples }) => {
    const { viewer } = window.__m1;
    const { scene } = viewer;
    const device = scene.context._device;
    if (!device.features.has("timestamp-query")) {
      return {
        status: "UNVERIFIED",
        reason: "timestamp-query unavailable on the physical device",
      };
    }
    const querySet = device.createQuerySet({ type: "timestamp", count: 4 });
    const resolved = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const original = device.createCommandEncoder;
    let traceCount = 0;
    let reconstructionCount = 0;
    device.createCommandEncoder = function (descriptor) {
      const encoder = original.call(this, descriptor);
      const begin = encoder.beginRenderPass;
      encoder.beginRenderPass = function (pass) {
        let index;
        if (pass.label === "M3 volumetric clouds") {
          traceCount++;
          index = 0;
        } else if (pass.label === "M3 cloud reconstruction") {
          reconstructionCount++;
          index = 2;
        } else {
          return begin.call(this, pass);
        }
        return begin.call(this, {
          ...pass,
          timestampWrites: {
            querySet,
            beginningOfPassWriteIndex: index,
            endOfPassWriteIndex: index + 1,
          },
        });
      };
      return encoder;
    };
    const samplesMs = [];
    const traceMs = [];
    const reconstructionMs = [];
    try {
      for (let i = -warmup; i < samples; i++) {
        if (motion) {
          window.__volume.setView({
            longitude: (i + warmup) * 0.14,
            latitude: 0,
            height: 8000 + 5000 * Math.sin(i / 3),
            pitch: -9,
            heading: 60 + i * 8,
          });
        }
        traceCount = 0;
        reconstructionCount = 0;
        viewer.render();
        if (
          traceCount !== 1 ||
          reconstructionCount !== (scene.clouds.quality === "high" ? 0 : 1)
        ) {
          throw new Error(
            `Unexpected cloud pass counts for ${scene.clouds.quality}: trace=${traceCount}, reconstruction=${reconstructionCount}`,
          );
        }
        const encoder = original.call(device);
        const queryCount = 2 + 2 * reconstructionCount;
        encoder.resolveQuerySet(querySet, 0, queryCount, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, readback, 0, queryCount * 8);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const stamps = new BigUint64Array(readback.getMappedRange());
        const trace = Number(stamps[1] - stamps[0]) / 1e6;
        const reconstruction = reconstructionCount
          ? Number(stamps[3] - stamps[2]) / 1e6
          : 0;
        readback.unmap();
        if (trace < 0 || reconstruction < 0) {
          throw new Error("Invalid cloud GPU timestamp interval");
        }
        if (i >= 0) {
          traceMs.push(trace);
          if (reconstructionCount) {
            reconstructionMs.push(reconstruction);
          }
          samplesMs.push(trace + reconstruction);
        }
      }
      const distribution = (values) => {
        if (!values.length) {
          return { status: "NO_PASS", count: 0 };
        }
        const sorted = [...values].sort((a, b) => a - b);
        return {
          count: values.length,
          samplesMs: values,
          meanMs: values.reduce((s, v) => s + v, 0) / values.length,
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        };
      };
      return {
        status: "MEASURED",
        warmup,
        ...distribution(samplesMs),
        passes: {
          trace: distribution(traceMs),
          reconstruction: distribution(reconstructionMs),
        },
        viewport: [viewer.canvas.width, viewer.canvas.height],
        clouds: { ...scene._atmosphere.statistics.clouds },
      };
    } finally {
      device.createCommandEncoder = original;
      querySet.destroy();
      resolved.destroy();
      readback.destroy();
    }
  }, { motion, warmup: profile ? 20 : 2, samples: profile ? 120 : 10 });
}
