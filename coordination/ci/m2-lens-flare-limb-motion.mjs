/* global window, Cesium, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runM1BrowserSuite, destroyM1Scene } from "./m1-browser-harness.mjs";
import { captureB4, hash } from "./m2.6.1-b4-fixtures.mjs";
import { installLensFlareFixture, settleLensFlare, finishLensFlareReport } from "./m2-lens-flare-fixtures.mjs";

process.env.M1_OUTPUT ??= "Build/m2-lens-flare-limb-motion";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare-limb-motion", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installLensFlareFixture(page, report);
  report.protocol = "M2.8-limb-motion-v1";
  report.harnessSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  await page.evaluate(() => {
    window.__b4.view({ height: 400000, limbOffset: 0.6, fov: 12 });
    window.__m1.viewer.scene._atmosphere.lensFlare.enabled = true;
    window.__flareLimbPrevious = undefined;
  });
  await settleLensFlare(page);
  const directory = path.join(output, "limb-120");
  await mkdir(directory);
  report.motion = { count: 120, frames: [], note: "Each actual frame is captured. PNG capture paces execution; no real-time FPS claim. Camera and time sweep physical Earth limb from clear through partial to fully hidden." };
  for (let index = 0; index < 120; index++) {
    const raw = await page.evaluate(async (index) => {
      await new Promise(requestAnimationFrame);
      const { viewer, pixels } = window.__m1;
      const probe = window.__m2Sun;
      viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1, new Cesium.JulianDate());
      const limbOffset = 0.6 - 1.2 * index / 119;
      probe.setElevation(400000, probe.limbElevation(400000) + limbOffset);
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
      const image = pixels();
      const png = viewer.canvas.toDataURL("image/png");
      const previous = window.__flareLimbPrevious;
      let maximum = 0, total = 0;
      if (previous) {
        for (let i = 0; i < image.data.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const difference = Math.abs(image.data[i + c] - previous.data[i + c]);
            maximum = Math.max(maximum, difference); total += difference;
          }
        }
      }
      window.__flareLimbPrevious = image;
      return { png, state: window.__b4.snapshot(), frame: viewer.scene._frameState.frameNumber,
        geometry: window.__b4.diskGeometry(), limbOffset,
        lensFlare: { ...viewer.scene._atmosphere.lensFlare }, errors: [...window.__m1.errors],
        adjacent: previous ? { maximum, meanAbsoluteRgbBytes: total / (image.width * image.height * 3) } : null };
    }, index);
    const bytes = Buffer.from(raw.png.split(",")[1], "base64");
    delete raw.png;
    const frame = { index, file: `frame-${String(index).padStart(4, "0")}.png`, sha256: hash(bytes), ...raw };
    await writeFile(path.join(directory, frame.file), bytes);
    const previous = report.motion.frames.at(-1);
    report.motion.frames.push(frame);
    assert.deepEqual(frame.errors, []);
    assert.ok(frame.state.terrain.selectedMeshes.every(([level]) => level <= 8));
    if (previous) {
      assert.equal(frame.frame, previous.frame + 1, "Every consecutive rendered frame is saved");
      assert.equal(Date.parse(frame.state.time) - Date.parse(previous.state.time), 1000);
      assert.notDeepEqual(frame.state.camera, previous.state.camera);
      assert.deepEqual(frame.lensFlare, previous.lensFlare);
      assert.equal(frame.state.exposure, previous.state.exposure);
    }
    if (index % 10 === 0) { await checkpoint(); }
  }
  const frames = report.motion.frames;
  assert.ok(frames.some(({ geometry }) => geometry.clear === geometry.samples), "Sequence includes a completely visible Sun");
  assert.ok(frames.some(({ geometry }) => geometry.earthBlocked > 0 && geometry.clear > 0), "Sequence includes partial Earth occultation");
  assert.ok(frames.some(({ geometry }) => geometry.earthBlocked === geometry.samples), "Sequence includes a fully Earth-hidden Sun");
  await writeFile(path.join(directory, "sequence.json"), JSON.stringify(report.motion, null, 2));
  report.controls = [];
  for (const [name, limbOffset] of [["clear", 0.6], ["partial", 0], ["hidden", -0.6]]) {
    await page.evaluate((limbOffset) => window.__b4.view({ height: 400000, limbOffset, fov: 12 }), limbOffset);
    await settleLensFlare(page);
    const captures = [];
    for (const enabled of [false, true]) {
      await page.evaluate((enabled) => { window.__m1.viewer.scene._atmosphere.lensFlare.enabled = enabled; }, enabled);
      captures.push(await captureB4(page, report, output, `${name}-${enabled ? "on" : "off"}`));
    }
    const delta = await page.evaluate(() => window.__flareCompare());
    report.controls.push({ name, off: captures[0].name, on: captures[1].name, delta });
    assert.equal(delta.restoredMaximum, 0);
    assert.equal(delta.hiddenMaximum, 0);
    if (name === "hidden") {
      assert.equal(delta.geometry.earthBlocked, delta.geometry.samples);
      assert.equal(delta.maximum, 0, "Fully hidden solar source leaves exactly zero lens-flare difference");
    } else {
      assert.ok(delta.changedPixels > 0, "Visible solar disk produces lens optics");
      if (name === "partial") { assert.ok(delta.geometry.earthBlocked > 0 && delta.geometry.clear > 0); }
      else { assert.equal(delta.geometry.clear, delta.geometry.samples); }
    }
    await checkpoint();
  }
  await finishLensFlareReport(page, report);
  report.cleanup = await destroyM1Scene(page);
  report.allocations = await page.evaluate(() => window.__solarAllocations);
  assert.ok(report.allocations.every((row) => row.destroyed && row.destroyCalls === 1));
  report.checks.push("120 saved consecutive camera/time frames sweep clear/partial/full physical Earth occultation; native PNG and state records; explicit flare off/on zero residual for full occlusion; native cleanup.");
  await checkpoint();

  function checkpoint() { return writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2)); }
});
