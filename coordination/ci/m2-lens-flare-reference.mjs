/* global window, Cesium */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runM1BrowserSuite, destroyM1Scene } from "./m1-browser-harness.mjs";
import { captureB4, hash } from "./m2.6.1-b4-fixtures.mjs";
import { installLensFlareFixture, settleLensFlare, finishLensFlareReport } from "./m2-lens-flare-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-lens-flare-reference";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare-reference", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installLensFlareFixture(page, report);
  report.protocol = "M2.8-reference-composition-v2";
  report.harnessSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  report.reference = "Unity HDRP LensFlareSamples2: compare optical hierarchy in a Sun-left, planet-right composition. No reference pixels or assets enter rendering.";
  report.pairs = [];
  report.compactionProfiles = [];
  const baseline = process.env.M2_LENS_COMPACTION_BASELINE
    ? JSON.parse(await readFile(process.env.M2_LENS_COMPACTION_BASELINE, "utf8")) : undefined;
  await page.evaluate(() => {
    window.__lensHeroView = () => {
      const { viewer } = window.__m1;
      const probe = window.__m2Sun;
      const V = Cesium.Cartesian3;
      const sun = probe.nativeSun();
      const origin = probe.originAtElevation(36000000, -61);
      const earth = V.normalize(V.negate(origin, new V()), new V());
      const right = V.normalize(V.subtract(earth,
        V.multiplyByScalar(sun, V.dot(earth, sun), new V()), new V()), new V());
      const up = V.normalize(V.cross(right, sun, new V()), new V());
      const aspect = viewer.canvas.width / viewer.canvas.height;
      const horizontalFov = Cesium.Math.toRadians(36);
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: horizontalFov, aspectRatio: aspect, near: 0.1, far: 500000000,
      });
      // Orient the actual Sun at (0.31 W, 0.35 H), with the inward Earth ray
      // on screen-right. This is a real camera rotation, not an image crop.
      const pitch = Math.atan(0.3 * Math.tan(horizontalFov / 2) / aspect);
      const yaw = Math.atan(0.38 * Math.tan(horizontalFov / 2) * Math.cos(pitch));
      const yawDirection = V.add(V.multiplyByScalar(sun, Math.cos(yaw), new V()),
        V.multiplyByScalar(right, Math.sin(yaw), new V()), new V());
      const direction = V.add(V.multiplyByScalar(yawDirection, Math.cos(pitch), new V()),
        V.multiplyByScalar(up, -Math.sin(pitch), new V()), new V());
      const cameraUp = V.add(V.multiplyByScalar(yawDirection, Math.sin(pitch), new V()),
        V.multiplyByScalar(up, Math.cos(pitch), new V()), new V());
      viewer.camera.setView({ destination: origin, orientation: { direction, up: cameraUp } });
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
      viewer.scene.exposure = 1;
      viewer.scene.atmosphere.show = true;
      window.__b4.mode("all");
      return { sun: probe.project(sun), earthCenter: probe.project(earth),
        framing: window.__b4.snapshot().framing };
    };
  });

  for (const [width, height] of [[1000, 227], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.__m1.viewer.resize());
    const hero = await page.evaluate(() => window.__lensHeroView());
    assert.ok(Math.abs(hero.sun[0] / width - 0.31) < 1e-6);
    assert.ok(Math.abs(hero.sun[1] / height - 0.35) < 1e-6);
    assert.ok(hero.earthCenter[0] > width, "Earth center stays outside the right edge");
    assert.ok(hero.framing.skyRays > 0 && hero.framing.earthRays > 0,
      "Reference composition contains actual sky and Earth");
    await settleLensFlare(page);
    for (const exposure of [0.5, 1, 2]) {
      await page.evaluate((exposure) => { window.__m1.viewer.scene.exposure = exposure; }, exposure);
      await pair(`hero-${width}x${height}-e${exposure}`, { hero });
    }
    for (const [name, settings] of [
      ["centered", { height: 36000000, elevation: 15, fov: 24 }],
      ["offaxis", { height: 36000000, elevation: 15, cameraElevation: width === 1000 ? 16 : 20, fov: 24 }],
      ["sunrise", { height: 400000, limbOffset: 0.6, fov: 24 }],
    ]) {
      await page.evaluate((settings) => window.__b4.view(settings), settings);
      await settleLensFlare(page);
      await pair(`${name}-${width}x${height}-e1`);
    }
  }
  await page.evaluate(() => window.__lensHeroView());
  await settleLensFlare(page);
  for (const layer of ["diffusion", "reflection"]) {
    await page.evaluate((layer) => {
      const flare = window.__m1.viewer.scene._atmosphere.lensFlare;
      Object.assign(flare, { enabled: true, diffusion: Number(layer === "diffusion"), reflection: Number(layer === "reflection") });
    }, layer);
    await captureB4(page, report, output, `hero-layer-${layer}-1920x1080`, { lensFlare: await settings() });
    if (layer === "reflection") {
      await page.evaluate(() => { window.__lensDefaultReflection = window.__m1.pixels(); });
    }
  }
  if (baseline) {
    report.compactionComparison = {
      baselineSource: baseline.source,
      baselineBundleSha256: baseline.bundleSha256,
      ratios: report.compactionProfiles.map((current) => {
        const before = baseline.compactionProfiles.find((row) => row.name === current.name);
        return { name: current.name, core: Math.sqrt(current.whitePixels / before.whitePixels),
          shortRays: current.shortRayRadius / before.shortRayRadius,
          warmShoulder: current.widths[80] / before.widths[80],
          warmSpread: current.widths[20] / before.widths[20] };
      }),
      exactUnchanged: report.scenes.filter((scene) => scene.name.endsWith("-off") || scene.name.includes("layer-reflection"))
        .map((scene) => ({ name: scene.name,
          equal: scene.pngSha256 === baseline.scenes.find((row) => row.name === scene.name)?.pngSha256 })),
    };
    await checkpoint();
    assert.ok(report.compactionComparison.exactUnchanged.every((row) => row.equal),
      "All disabled frames and the isolated reflection/arc layer remain pixel exact");
    for (const ratios of report.compactionComparison.ratios) {
      for (const key of ["core", "shortRays"]) {
        assert.ok(ratios[key] >= 0.5 && ratios[key] <= 0.7,
          `${ratios.name}: ${key} width ratio ${ratios[key]} is within 0.5–0.7`);
      }
      for (const key of ["warmShoulder", "warmSpread"]) {
        assert.ok(ratios[key] >= 0.6 && ratios[key] <= 0.8,
          `${ratios.name}: ${key} width ratio ${ratios[key]} is within 0.6–0.8`);
      }
    }
    report.checks.push("Same-camera e1 compaction: core/short rays 50–70%, warm shoulder/spread 60–80%, preserved saturated peak; disabled and isolated reflection/arc output exact.");
  }
  assert.ok(report.compactionProfiles.every((row) => row.whitePixels > 0 && row.peakRgb.every((value) => value >= 250)),
    "Both native hero views retain a saturated white core peak");
  if (process.env.M2_LENS_DIFFUSION_BASELINE) {
    const compact = JSON.parse(await readFile(process.env.M2_LENS_DIFFUSION_BASELINE, "utf8"));
    report.diffusionSize = { default: await page.evaluate(() => window.__m1.viewer.scene._atmosphere.lensFlare.diffusionSize),
      defaultMatches: [], sizes: [], hidden: [] };
    assert.equal(report.diffusionSize.default, 0.7);
    for (const current of report.scenes) {
      const previous = compact.scenes.find((scene) => scene.name === current.name);
      for (const key of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain", "sun", "atmosphere"]) {
        assert.deepEqual(current[key], previous[key], `${current.name}: prior compact ${key}`);
      }
      report.diffusionSize.defaultMatches.push({ name: current.name, equal: current.pngSha256 === previous.pngSha256 });
    }
    await checkpoint();
    assert.ok(report.diffusionSize.defaultMatches.every((row) => row.equal),
      "The new parameter default reproduces every fixed-size compact reference exactly");
    for (const size of [0.1, 0.3, 0.4, 0.7, 1, 2]) {
      await page.evaluate((size) => {
        Object.assign(window.__m1.viewer.scene._atmosphere.lensFlare,
          { enabled: true, diffusion: 1, reflection: 0, diffusionSize: size });
      }, size);
      const frame = await captureB4(page, report, output, `diffusion-size-${size}-1920x1080`, { lensFlare: await settings() });
      const metrics = await page.evaluate(() => {
        const { viewer, pixels } = window.__m1;
        const flare = viewer.scene._atmosphere.lensFlare;
        flare.enabled = false;
        const off = pixels();
        flare.enabled = true;
        const on = pixels();
        const source = window.__m2Sun.project(window.__m2Sun.nativeSun());
        const widths = { 80: 0, 20: 0 };
        for (let distance = 0; distance < source[0] - 3; distance++) {
          let delta = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const i = (Math.round(source[1] + dy) * on.width + Math.round(source[0] - distance)) * 4;
            for (let c = 0; c < 3; c++) { delta += (on.data[i + c] - off.data[i + c]) / 15; }
          }
          for (const threshold of [80, 20]) { if (delta >= threshold) { widths[threshold] = distance; } }
        }
        const i = (Math.round(source[1]) * on.width + Math.round(source[0])) * 4;
        let retainedShortRayMaximum = 0;
        // This fixed native-pixel annulus lies outside size0.1's warm footprint
        // and inside the accepted short-ray footprint in this 1920px hero view.
        for (let y = Math.floor(source[1] - 109); y <= Math.ceil(source[1] + 109); y++) {
          for (let x = Math.floor(source[0] - 109); x <= Math.ceil(source[0] + 109); x++) {
            const radius = Math.hypot(x - source[0], y - source[1]);
            if (radius < 83 || radius > 109) { continue; }
            const offset = (y * on.width + x) * 4;
            for (let c = 0; c < 3; c++) {
              retainedShortRayMaximum = Math.max(retainedShortRayMaximum, on.data[offset + c] - off.data[offset + c]);
            }
          }
        }
        return { widths, peakRgb: Array.from(on.data.slice(i, i + 3)),
          retainedShortRayMaximum,
          sampledRadius: Math.ceil(source[0] - 3) - 1,
          delta: window.__flareCompare() };
      });
      assert.ok(metrics.peakRgb.every((value) => value === 255), "Size preserves the saturated core peak");
      assert.equal(metrics.delta.restoredMaximum, 0);
      assert.equal(metrics.delta.hiddenMaximum, 0);
      report.diffusionSize.sizes.push({ size, capture: frame.name, ...metrics });
      await checkpoint();
      if (size === 0.1) {
        assert.ok(metrics.retainedShortRayMaximum > 0,
          "Minimum warm size retains fixed short-ray output in the native 83–109px source annulus");
      }
      await page.evaluate(() => {
        Object.assign(window.__m1.viewer.scene._atmosphere.lensFlare, { enabled: true, diffusion: 0, reflection: 1 });
      });
      const reflection = await captureB4(page, report, output, `diffusion-size-${size}-reflection`, { lensFlare: await settings() });
      const arc = await page.evaluate(() => {
        const { viewer, pixels } = window.__m1;
        const flare = viewer.scene._atmosphere.lensFlare;
        flare.enabled = false;
        const off = pixels();
        flare.enabled = true;
        const on = pixels();
        const source = window.__m2Sun.project(window.__m2Sun.nativeSun());
        const profile = [];
        // Down-left avoids the upper-left orange ghost and lower-right cluster.
        for (let radius = 40; radius <= 800; radius++) {
          const x = Math.round(source[0] - radius * Math.SQRT1_2);
          const y = Math.round(source[1] + radius * Math.SQRT1_2);
          const i = (y * on.width + x) * 4;
          const delta = [0, 1, 2].reduce((sum, c) => sum + on.data[i + c] - off.data[i + c], 0) / 3;
          profile.push({ radius, delta });
        }
        const peak = profile.reduce((best, sample) => sample.delta > best.delta ? sample : best);
        const top = peak.delta > 0 ? profile.filter((sample) => sample.delta >= peak.delta * 0.95) : [];
        let ghostPatchMaximum = 0;
        for (let y = 258; y <= 264; y++) {
          for (let x = 329; x <= 335; x++) {
            const i = (y * on.width + x) * 4;
            for (let c = 0; c < 3; c++) {
              ghostPatchMaximum = Math.max(ghostPatchMaximum,
                Math.abs(on.data[i + c] - window.__lensDefaultReflection.data[i + c]));
            }
          }
        }
        return { peakRadius: top.length ? top.reduce((sum, sample) => sum + sample.radius, 0) / top.length : null,
          measurement: top.length ? "MEASURED" : "OUTSIDE_SAMPLED_PROFILE",
          peakMeanByteIncrease: peak.delta, ghostPatchMaximum, profile };
      });
      report.diffusionSize.sizes.at(-1).arc = { capture: reflection.name, ...arc };
      if (size <= 1) { assert.ok(arc.peakMeanByteIncrease > 0, "Linked outer spectral arc remains visible inside the sampled profile"); }
      if ([0.1, 1, 2].includes(size)) {
        assert.equal(arc.ghostPatchMaximum, 0,
          "The original orange ghost patch is exact when the moving arc does not overlap it");
      }
      await page.evaluate(() => { window.__m1.viewer.scene._atmosphere.lensFlare.enabled = false; });
      const disabled = await captureB4(page, report, output, `diffusion-size-${size}-off`, { lensFlare: await settings() });
      assert.equal(disabled.pngSha256, compact.scenes.find((scene) => scene.name === "hero-1920x1080-e1-off").pngSha256,
        "Size leaves disabled output exact");
      if (size === 0.3) {
        await page.evaluate(() => {
          Object.assign(window.__m1.viewer.scene._atmosphere.lensFlare, { enabled: true, diffusion: 1, reflection: 1 });
        });
        await captureB4(page, report, output, "diffusion-size-0.3-combined", { lensFlare: await settings() });
      }
    }
    for (let i = 1; i < report.diffusionSize.sizes.length; i++) {
      for (const threshold of [80, 20]) {
        assert.ok(report.diffusionSize.sizes[i].widths[threshold] > report.diffusionSize.sizes[i - 1].widths[threshold],
          "Increasing size expands the actual rendered warm footprint");
      }
    }
    const defaultArcRadius = report.diffusionSize.sizes.find((row) => row.size === 0.7).arc.peakRadius;
    for (const size of [0.3, 1]) {
      const current = report.diffusionSize.sizes.find((row) => row.size === size);
      const expectedRatio = size / 0.7;
      const actualRatio = current.arc.peakRadius / defaultArcRadius;
      assert.ok(Math.abs(actualRatio / expectedRatio - 1) < 0.1,
        `Linked outer arc size${size} rendered radius follows the size ratio within10%`);
    }
    for (const size of [0.1, 2]) {
      await page.evaluate((size) => {
        window.__b4.view({ height: 400000, limbOffset: -0.6, fov: 12 });
        Object.assign(window.__m1.viewer.scene._atmosphere.lensFlare,
          { enabled: true, diffusion: 1, reflection: 1, diffusionSize: size });
      }, size);
      await settleLensFlare(page);
      const delta = await page.evaluate(() => window.__flareCompare());
      assert.equal(delta.geometry.earthBlocked, delta.geometry.samples);
      assert.equal(delta.maximum, 0, "Size bounds preserve full-source occultation");
      report.diffusionSize.hidden.push({ size, delta });
      await captureB4(page, report, output, `diffusion-size-${size}-hidden`, { lensFlare: await settings() });
    }
    report.checks.push("Diffusion size0.1/0.3/0.4/0.7/1/2: monotonic warm footprint, proportionally linked outer arc, fixed short-ray tail/ghost patches and saturated core, exact disabled output, source/receiver occultation; default matches all26 prior compact reference frames exactly.");
    await checkpoint();
  }
  await finishLensFlareReport(page, report);
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => window.__solarAllocations);
  assert.ok(report.allocations.every((row) => row.destroyed && row.destroyCalls === 1));
  report.checks.push("Physical GPU production shaders; actual Sun-left/Earth-right projection at both aspect ratios; paired off/on and restored-off equality; source metadata and native capture hashes; cleanup.");
  await checkpoint();

  function settings() { return page.evaluate(() => ({ ...window.__m1.viewer.scene._atmosphere.lensFlare })); }
  async function pair(name, details = {}) {
    const captures = [];
    for (const enabled of [false, true]) {
      await page.evaluate((enabled) => {
        Object.assign(window.__m1.viewer.scene._atmosphere.lensFlare, { enabled, diffusion: 1, reflection: 1 });
      }, enabled);
      captures.push(await captureB4(page, report, output, `${name}-${enabled ? "on" : "off"}`,
        { ...details, lensFlare: await settings() }));
    }
    for (const key of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain"]) {
      assert.deepEqual(captures[0][key], captures[1][key], `${name}: matched ${key}`);
    }
    const delta = await page.evaluate(() => window.__flareCompare());
    assert.equal(delta.restoredMaximum, 0, "Disabled output is restored exactly");
    assert.equal(delta.hiddenMaximum, 0, "Foreground receiver masking remains intact");
    report.pairs.push({ name, off: captures[0].name, on: captures[1].name, delta });
    if (name.startsWith("hero-") && name.endsWith("-e1")) {
      report.compactionProfiles.push({ name, ...await page.evaluate(() => {
        const { viewer, pixels } = window.__m1;
        const flare = viewer.scene._atmosphere.lensFlare;
        const saved = { ...flare };
        Object.assign(flare, { enabled: false, diffusion: 1, reflection: 0 });
        const off = pixels();
        flare.enabled = true;
        const on = pixels();
        const center = window.__m2Sun.project(window.__m2Sun.nativeSun());
        const profile = [];
        for (let distance = 0; distance < center[0] - 3; distance++) {
          const rgb = [0, 0, 0], base = [0, 0, 0];
          for (let dy = -2; dy <= 2; dy++) {
            const offset = (Math.round(center[1] + dy) * on.width + Math.round(center[0] - distance)) * 4;
            for (let c = 0; c < 3; c++) { rgb[c] += on.data[offset + c] / 5; base[c] += off.data[offset + c] / 5; }
          }
          profile.push({ distance, rgb, delta: rgb.reduce((sum, value, c) => sum + value - base[c], 0) / 3 });
        }
        let whitePixels = 0;
        const radius = Math.round(on.width * 0.08);
        for (let y = Math.round(center[1]) - radius; y <= Math.round(center[1]) + radius; y++) {
          for (let x = Math.round(center[0]) - radius; x <= Math.round(center[0]) + radius; x++) {
            if (x < 0 || y < 0 || x >= on.width || y >= on.height) { continue; }
            const i = (y * on.width + x) * 4;
            if ([0, 1, 2].every((c) => on.data[i + c] >= 250)) { whitePixels++; }
          }
        }
        Object.assign(flare, saved);
        return { source: center, width: on.width, height: on.height, whitePixels,
          peakRgb: profile[0].rgb,
          shortRayRadius: profile.findLast((sample) => Math.min(...sample.rgb) >= 240)?.distance ?? 0,
          widths: Object.fromEntries([200, 180, 120, 80, 40, 20, 15].map((threshold) =>
            [threshold, profile.findLast((sample) => sample.delta >= threshold)?.distance ?? 0])),
          profile,
          method: "Diffusion-only native output. Core width is sqrt of >=250 all-channel pixel area inside source +/-8% image width. Short-ray radius is last >=240 all-channel sample on the leftward horizontal five-pixel mean profile. Warm shoulder/spread radii are last mean RGB on-minus-off >=80/20 byte samples. Output-space metrics include the unchanged physical Sun and tone mapping; ratios are approximate visual footprints, not radiometric radii." };
      }) });
    }
    if (name === "hero-1000x227-e1") {
      report.referenceReadability = await page.evaluate(() => {
        const { viewer, pixels } = window.__m1;
        const flare = viewer.scene._atmosphere.lensFlare;
        const center = window.__m2Sun.project(window.__m2Sun.nativeSun());
        flare.enabled = false;
        const off = pixels();
        flare.enabled = true;
        const on = pixels();
        const shoulder = [Math.round(center[0] + 0.45 * on.height), Math.round(center[1])];
        const mean = (image) => {
          const rgb = [0, 0, 0];
          for (let y = shoulder[1] - 2; y <= shoulder[1] + 2; y++) {
            for (let x = shoulder[0] - 2; x <= shoulder[0] + 2; x++) {
              const offset = (y * image.width + x) * 4;
              for (let c = 0; c < 3; c++) { rgb[c] += image.data[offset + c] / 25; }
            }
          }
          return rgb;
        };
        const offRgb = mean(off), onRgb = mean(on);
        const patchHalfSize = Math.max(1, Math.round(on.height * 0.025));
        let saturatedWhitePixels = 0, patchPixels = 0;
        for (let y = Math.round(center[1]) - patchHalfSize; y <= Math.round(center[1]) + patchHalfSize; y++) {
          for (let x = Math.round(center[0]) - patchHalfSize; x <= Math.round(center[0]) + patchHalfSize; x++) {
            const offset = (y * on.width + x) * 4;
            patchPixels++;
            if ([0, 1, 2].every((c) => on.data[offset + c] >= 250)) { saturatedWhitePixels++; }
          }
        }
        return { source: center, shoulder, shoulderPatch: "5x5 native output pixels, source +0.45 viewport heights on x",
          offRgb, onRgb, meanByteIncrease: onRgb.reduce((sum, v, c) => sum + v - offRgb[c], 0) / 3,
          corePatchSidePixels: patchHalfSize * 2 + 1, patchPixels, saturatedWhitePixels,
          note: "Legacy far-shoulder diagnostic retained for comparison; compaction is checked through same-camera diffusion profiles, not a minimum far-shoulder brightness." };
      });
      await checkpoint();
      assert.ok(report.referenceReadability.saturatedWhitePixels > 0,
        "The central five-percent-height patch contains a saturated white solar core");
    }
    await checkpoint();
  }
  function checkpoint() { return writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2)); }
});
