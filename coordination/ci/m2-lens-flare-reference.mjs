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
  report.protocol = "M2.8-reference-composition-v1";
  report.harnessSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  report.reference = "Unity HDRP LensFlareSamples2: compare optical hierarchy in a Sun-left, planet-right composition. No reference pixels or assets enter rendering.";
  report.pairs = [];
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
          note: "Output-level lower bound for the requested broad optical shoulder; not a substitute for reference-image visual review." };
      });
      await checkpoint();
      assert.ok(report.referenceReadability.meanByteIncrease >= 40,
        "Reference-strength broad shoulder brightens native output by at least 40 mean RGB bytes");
      assert.ok(report.referenceReadability.saturatedWhitePixels > 0,
        "The central five-percent-height patch contains a saturated white solar core");
    }
    await checkpoint();
  }
  function checkpoint() { return writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2)); }
});
