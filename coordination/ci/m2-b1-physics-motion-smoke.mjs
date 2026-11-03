/* global Cesium, window, document */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

process.env.M1_OUTPUT ??= "Build/B1-continuation/physics-motion";
await runM1BrowserSuite("m2-b1-physics-motion", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await trackSolarAllocations(page);
  await installM1Scene(page, { baseLayer: false });
  await installSunProbe(page);
  report.diskEnergy = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    const s = window.__m2Sun;
    s.reset();
    s.setElevation(35786000, 60);
    viewer.camera.frustum.fov = Cesium.Math.toRadians(4);
    viewer.scene.sun.glowStrength = 0;
    viewer.render();
    const sun = s.nativeSun();
    const right = viewer.camera.rightWC;
    const up = viewer.camera.upWC;
    const pixels = [];
    // Equal projected solid-angle cells: q = sin(theta)^2 / sin(alpha)^2.
    // The same cosine-weighted measure defines E = pi L sin(alpha)^2.
    for (let ring = 0; ring < 128; ring++) {
      const sinTheta = Math.sqrt((ring + 0.5) / 128) * Math.sin(viewer.scene.sun.angularRadius);
      const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
      for (let i = 0; i < 32; i++) {
        const angle = (i + 0.5) / 32 * 2 * Math.PI;
        const d = new Cesium.Cartesian3(
          sun.x * cosTheta + sinTheta * (right.x * Math.cos(angle) + up.x * Math.sin(angle)),
          sun.y * cosTheta + sinTheta * (right.y * Math.cos(angle) + up.y * Math.sin(angle)),
          sun.z * cosTheta + sinTheta * (right.z * Math.cos(angle) + up.z * Math.sin(angle)));
        pixels.push(s.project(d).map(Math.floor));
      }
    }
    const rows = await s.probe(pixels);
    const meanY = rows.reduce((sum, row) => sum + 0.2126 * row[0] + 0.7152 * row[1] + 0.0722 * row[2], 0) / rows.length;
    const expected = viewer.scene.atmosphere.lightIntensity * viewer.scene.sun.displayScale /
      (Math.PI * Math.sin(viewer.scene.sun.angularRadius) ** 2);
    return { samples: rows.length, meanY, expected, relativeError: Math.abs(meanY / expected - 1),
      angularRadius: viewer.scene.sun.angularRadius, showAtmosphere: viewer.scene.atmosphere.show,
      sourceOnly: viewer.scene.sun.glowStrength === 0, profileSamples: [rows[0].slice(0, 4), rows.at(-1).slice(0, 4)] };
  });
  assert.equal(report.diskEnergy.angularRadius, 0.00465);
  assert.equal(report.diskEnergy.sourceOnly, true);
  assert.equal(report.diskEnergy.showAtmosphere, false);
  assert.ok(report.diskEnergy.relativeError < 0.01, "GPU disk-integrated luminance preserves irradiance normalization within 1% pixel quadrature error");
  assert.ok(report.diskEnergy.profileSamples[0][0] > report.diskEnergy.profileSamples[1][0], "actual GPU core is brighter than limb");
  report.checks.push("4096 actual production-WGSL samples preserve disk-integrated normalized luminance and physical radius");

  await page.setViewportSize({ width: 1280, height: 720 });
  report.motion = await page.evaluate(async () => {
    const { viewer, errors } = window.__m1;
    viewer.resize();
    viewer.camera.frustum.fov = Cesium.Math.toRadians(24);
    window.__m2Sun.setElevation(35786000, 60);
    viewer.scene.sun.glowStrength = 0.08;
    viewer.scene.sun.glowRadius = 0.05;
    viewer.scene._atmosphere.bloomStrength = 0.35;
    viewer.scene.exposure = 1;
    const start = Cesium.JulianDate.clone(viewer.clock.currentTime);
    const renderer = viewer.scene._atmosphere;
    // Exclude the intentional resize allocation from steady-state motion.
    viewer.render();
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    const before = { ...renderer.statistics };
    const textures = [...renderer._solarTextures];
    const frames = [], captures = [];
    let previous;
    for (let frame = 0; frame < 120; frame++) {
      viewer.clock.currentTime = Cesium.JulianDate.addSeconds(start, frame * 0.5, new Cesium.JulianDate());
      viewer.camera.lookRight(0.00015);
      const image = window.__m1.pixels();
      const repeat = window.__m1.pixels();
      const center = window.__m2Sun.project(window.__m2Sun.nativeSun());
      const radius = Math.tan(viewer.scene.sun.glowRadius) * viewer.canvas.width * viewer.camera.frustum.projectionMatrix[0] / 2;
      const sample = (x, y, data) => {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const lum = (px, py) => { const k = (py * image.width + px) * 4; return (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255; };
        return (1 - fy) * ((1 - fx) * lum(ix, iy) + fx * lum(ix + 1, iy)) + fy * ((1 - fx) * lum(ix, iy + 1) + fx * lum(ix + 1, iy + 1));
      };
      const values = [];
      let repeatMax = 0;
      // Track the projected Sun, not the whole frame: 1536 ray-region samples
      // exclude the disk/core so unrelated black sky cannot dilute shimmer.
      for (let ring = 0; ring < 12; ring++) {
        const r = radius * (0.2 + 0.65 * ring / 11);
        for (let i = 0; i < 128; i++) {
          const x = center[0] + r * Math.cos(i / 128 * 2 * Math.PI);
          const y = center[1] + r * Math.sin(i / 128 * 2 * Math.PI);
          if (x < 1 || y < 1 || x >= image.width - 2 || y >= image.height - 2) { throw new Error("Solar ROI left the viewport"); }
          const value = sample(x, y, image.data);
          values.push(value);
          repeatMax = Math.max(repeatMax, Math.abs(value - sample(x, y, repeat.data)));
        }
      }
      const priorFrame = previous;
      const deltas = priorFrame ? values.map((value, i) => Math.abs(value - priorFrame[i])).sort((a, b) => a - b) : [0];
      frames.push({ frame, time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime), center,
        meanDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
        p99Delta: deltas[Math.floor(deltas.length * 0.99)], repeatMax });
      previous = values;
      if ([0, 60, 119].includes(frame)) {
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").putImageData(image, 0, 0);
        captures.push({ frame, png: canvas.toDataURL("image/png").split(",")[1] });
      }
      await viewer.scene.context._device.queue.onSubmittedWorkDone();
    }
    return { frames, captures, errors: [...errors], exposure: viewer.scene.exposure,
      newTextures: renderer.statistics.texturesCreated - before.texturesCreated,
      newBuffers: renderer.statistics.buffersCreated - before.buffersCreated,
      assetsReused: textures.every((texture, i) => texture === renderer._solarTextures[i]) };
  });
  assert.equal(report.motion.frames.length, 120);
  assert.deepEqual(report.motion.errors, []);
  assert.ok(report.motion.frames.every((f) => f.repeatMax <= 1 / 255), "fixed-state solar ROI must not randomly flicker");
  assert.ok(report.motion.frames.every((f) => f.meanDelta < 0.03 && f.p99Delta < 0.2), "tracked ray-region motion must not cause abrupt intensity changes");
  const first = report.motion.frames[0].center, last = report.motion.frames.at(-1).center;
  assert.ok(Math.hypot(last[0] - first[0], last[1] - first[1]) > 10, "actual projected Sun must move");
  assert.equal(report.motion.newTextures, 0); assert.equal(report.motion.newBuffers, 0);
  assert.equal(report.motion.assetsReused, true);
  for (const { frame, png } of report.motion.captures) {
    await writeFile(path.join(output, `motion-${frame}.png`), Buffer.from(png, "base64"));
  }
  delete report.motion.captures;
  report.lifecycle = await page.evaluate(() => {
    window.__m1.viewer.destroy();
    const rows = window.__solarAllocations;
    return { created: rows.length, destroyed: rows.filter((r) => r.destroyed).length, live: rows.filter((r) => !r.destroyed) };
  });
  assert.deepEqual(report.lifecycle.live, []);
  assert.equal(report.lifecycle.created, report.lifecycle.destroyed);
  report.checks.push("120 frames: fixed-exposure native-Sun-tracked rays ROI, camera and time motion, repeat stability and balanced resources");
});
