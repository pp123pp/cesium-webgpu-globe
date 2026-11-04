/* global window, Cesium, requestAnimationFrame */
// Companion to the frozen baseline script: orbit/limb, actual terrain depth,
// deterministic repeats and every frame of one continuous capture sequence.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runB2Capture } from "./m2.6.1-b2-round2-capture.mjs";

const frameCount = Number(process.env.B2_FRAMES ?? 120);
assert.ok(Number.isInteger(frameCount) && frameCount >= 120 && frameCount <= 600, "B2_FRAMES must be 120–600");

await runB2Capture("extended", async ({ page, report, output, scene, capture, settle, checkpoint }) => {
  report.extendedProtocol = { frames: frameCount, description: "all actual manually rendered frames are retained, paced by requestAnimationFrame; PNG encoding makes this a capture sequence, not an FPS benchmark" };
  for (const [name, options] of [
    ["high-orbit-sunrise-limb", { height: 35786000, limbOffset: 0.05, fov: 60, time: "2026-03-20T06:00:00Z" }],
    ["high-orbit-visible", { height: 35786000, limbOffset: 2, fov: 60 }],
    ["low-orbit-sunrise-limb", { height: 400000, limbOffset: 0.05, fov: 60, time: "2026-03-20T06:00:00Z" }],
    ["low-orbit-low-sun", { height: 400000, elevation: 0.5, fov: 60 }],
    ["near-ground-low-sun", { height: 2, elevation: 0.5, fov: 60 }],
  ]) {
    await scene(name, options);
  }

  // Reuse the M2.6 independent WGS84 mask and native mesh/depth fixtures.
  await page.evaluate(() => {
    window.__b2ObserveOcclusion = () => {
      const { viewer } = window.__m1;
      const state = window.__m2Sun;
      viewer.scene.sun.show = false;
      const off = window.__m1.pixels();
      viewer.scene.sun.show = true;
      const on = window.__m1.pixels();
      let changed = 0, energy = 0, hiddenMax = 0, blocked = 0;
      const center = state.centerPixel();
      const radius = Math.ceil(Math.tan(viewer.scene.sun.glowRadius) * on.width * viewer.camera.frustum.projectionMatrix[0] / 2) + 24;
      for (let y = Math.max(0, center[1] - radius); y < Math.min(on.height, center[1] + radius); y++) {
        for (let x = Math.max(0, center[0] - radius); x < Math.min(on.width, center[0] + radius); x++) {
          const i = (y * on.width + x) * 4;
          const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(on.data[i + c] - off.data[i + c])));
          energy += delta;
          if (delta > 2) { changed++; }
          // Same explicit two-pixel grazing uncertainty band as M2.6.
          const covered = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
            Boolean(state.earthHit(state.rayAt(x + dx + 0.5, y + dy + 0.5))));
          if (covered) { blocked++; hiddenMax = Math.max(hiddenMax, delta); }
        }
      }
      const i = (center[1] * on.width + center[0]) * 4;
      return { changed, energy, blocked, hiddenMax, centerDelta: [0, 1, 2].map((c) => on.data[i + c] - off.data[i + c]), center, radius };
    };
  });
  report.occlusion = { sourceFixture: "coordination/ci/m2-solar-occlusion-smoke.mjs", limb: [] };
  for (const fraction of [1.5, 0.4, 0, -0.4, -1.5]) {
    const options = await page.evaluate((fraction) => {
      const radius = Cesium.Math.toDegrees(window.__m1.viewer.scene.sun.angularRadius);
      return { fov: 12, height: 400000, limbOffset: fraction * radius };
    }, fraction);
    const row = await scene(`earth-occultation-${fraction}`, options);
    const observation = await page.evaluate(() => window.__b2ObserveOcclusion());
    row.occlusion = observation;
    report.occlusion.limb.push({ fraction, ...observation, filename: row.filename });
    await checkpoint();
  }

  const mountain = await page.evaluate(() => {
    window.__b2Reset({ fov: 12, height: 20000 });
    return window.__m2Sun.prepareMountain(5500);
  });
  const mountainSettle = await settle();
  report.occlusion.mountain = await page.evaluate(async () => {
    const state = window.__m2Sun;
    const { viewer } = window.__m1;
    const observation = window.__b2ObserveOcclusion();
    const center = state.centerPixel();
    const [gpu] = await state.probe([center]);
    const ray = state.rayAt(center[0] + 0.5, center[1] + 0.5);
    const mesh = viewer.scene.globe.pick(ray, viewer.scene);
    return { observation, gpu, analyticEarthHit: Boolean(state.earthHit(ray)), realMeshHit: Boolean(mesh),
      meshPosition: mesh ? [mesh.x, mesh.y, mesh.z] : null, state: window.__b2State() };
  });
  const mountainRow = await capture("real-mountain-occluder", { settled: mountainSettle, intent: { ...mountain, fixture: "actual Gaussian heightmap mesh" } });
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain; });
  const removedSettle = await settle();
  report.occlusion.mountainRemoved = await page.evaluate(() => window.__b2ObserveOcclusion());
  const removedRow = await capture("real-mountain-removed", { settled: removedSettle, intent: { ...mountain, fixture: "same camera/time; original terrain restored" } });
  const beforeCamera = mountainRow.state.camera;
  const afterCamera = removedRow.state.camera;
  // Camera.update re-normalizes basis vectors: the unchanged baseline produced
  // 1.11e-16 component drift. Compare that basis at double-precision roundoff,
  // while still requiring exactly equal position and projection parameters.
  const basisDelta = Math.max(...["directionWC", "upWC", "rightWC"].flatMap((key) =>
    beforeCamera[key].map((value, i) => Math.abs(value - afterCamera[key][i]))));
  report.occlusion.mountainCameraBasisDelta = basisDelta;
  report.occlusion.mountainCameraBasisTolerance = 32 * Number.EPSILON;
  report.occlusion.identicalMountainPair = {
    sameCamera: JSON.stringify(beforeCamera.positionWC) === JSON.stringify(afterCamera.positionWC) &&
      ["fov", "aspectRatio", "near", "far"].every((key) => beforeCamera[key] === afterCamera[key]) &&
      basisDelta <= report.occlusion.mountainCameraBasisTolerance,
    sameTime: mountainRow.state.time === removedRow.state.time,
    sameLayers: JSON.stringify(mountainRow.state.solarEffects) === JSON.stringify(removedRow.state.solarEffects),
    sameBloom: mountainRow.state.bloomStrength === removedRow.state.bloomStrength,
  };
  await checkpoint();

  report.determinism = [];
  for (const fov of [60, 12]) {
    const first = await scene(`fixed-${fov}-repeat-0`, { fov });
    const repeats = [first];
    for (let repeat = 1; repeat < 4; repeat++) {
      repeats.push(await capture(`fixed-${fov}-repeat-${repeat}`, { intent: { fov, repeat, cameraTimeExposureUnchanged: true } }));
    }
    report.determinism.push({ fov, byteIdentical: new Set(repeats.map((row) => row.sha256)).size === 1,
      captures: repeats.map(({ filename, sha256, state }) => ({ filename, sha256, frame: state.frame })) });
  }

  await scene("continuous-initial-state", { fov: 60 });
  await mkdir(path.join(output, "continuous"));
  await page.evaluate(() => {
    const originalImage = window.__b2Image;
    let previous;
    window.__b2Image = () => {
      const result = originalImage();
      const image = result.pixels;
      let changedPixels = 0, maxDifference = 0, sum = 0;
      const comparable = previous && previous.width === image.width && previous.height === image.height;
      if (comparable) {
        for (let i = 0; i < image.data.length; i += 4) {
          let delta = 0;
          for (let c = 0; c < 3; c++) {
            const difference = Math.abs(image.data[i + c] - previous.data[i + c]);
            delta = Math.max(delta, difference);
            sum += difference;
          }
          if (delta > 0) { changedPixels++; }
          maxDifference = Math.max(maxDifference, delta);
        }
      }
      window.__b2Motion = { comparable: Boolean(comparable), changedPixels, maxDifference,
        meanRgbDifference: comparable ? sum / (image.width * image.height * 3 * 255) : null };
      previous = image;
      return result;
    };
  });
  const events = {
    0: "fixed state begins", 20: "camera lookRight ramp begins (0.05 deg/frame)",
    50: "camera stops; native clock advances 10 sec/frame", 80: "clock stops; exposure ramps 1 to 2",
    100: "exposure returns to 1; actual resize to 1280x720", 110: "actual resize to 1920x1080",
    111: "fixed state after resize; all remaining frames retained",
  };
  const sequence = [];
  for (let index = 0; index < frameCount; index++) {
    if (index === 100) { await page.setViewportSize({ width: 1280, height: 720 }); }
    if (index === 110) { await page.setViewportSize({ width: 1920, height: 1080 }); }
    await page.evaluate(async (index) => {
      await new Promise(requestAnimationFrame);
      const { viewer } = window.__m1;
      if (index >= 20 && index < 50) { viewer.camera.lookRight(Cesium.Math.toRadians(0.05)); }
      if (index >= 50 && index < 80) {
        viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 10, new Cesium.JulianDate());
      }
      if (index >= 80 && index < 100) { viewer.scene.exposure = 1 + (index - 80) / 19; }
      if (index === 100) { viewer.scene.exposure = 1; }
      if (index === 100 || index === 110) { viewer.resize(); }
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
    }, index);
    const row = await capture(`continuous/frame-${String(index).padStart(4, "0")}`, {
      intent: { sequenceIndex: index, event: events[index] ?? null, allFramesRetained: true },
    });
    row.motion = await page.evaluate(() => window.__b2Motion);
    sequence.push({ index, filename: path.basename(row.filename), sha256: row.sha256, frame: row.state.frame,
      time: row.state.time, canvas: row.state.canvas, event: events[index] ?? null, motion: row.motion });
  }
  report.continuous = { count: sequence.length, events, firstFrame: sequence[0].frame, lastFrame: sequence.at(-1).frame,
    contiguousRenderFrameNumbers: sequence.every((row, index) => index === 0 || row.frame === sequence[index - 1].frame + 1),
    staticPrefixByteIdentical: new Set(sequence.slice(0, 20).map((row) => row.sha256)).size === 1,
    largestMeanDifference: Math.max(...sequence.map((row) => row.motion.meanRgbDifference ?? 0)),
    viewer: "continuous/index.html", manifest: "continuous/sequence.json", observations: sequence };
  await writeFile(path.join(output, "continuous", "sequence.json"), JSON.stringify(report.continuous, null, 2));
  await writeFile(path.join(output, "continuous", "index.html"), `<!doctype html><meta charset="utf-8"><title>B2 ${report.phase} continuous actual WebGPU frames</title>
<style>body{margin:16px;background:#111;color:#eee;font:16px system-ui}img{display:block;max-width:100%;height:auto;margin-top:12px}input{width:65vw}button{padding:6px 15px}pre{white-space:pre-wrap}</style>
<h1>B2 ${report.phase}: ${frameCount} consecutive captured frames</h1><p>Actual WebGPU frames, one image for every render in this sequence. Playback is an inspection aid and does not report rendering FPS. Resize and deliberate exposure changes are labelled.</p>
<button id="play">Play / pause</button><input id="position" type="range" min="0" max="${frameCount - 1}" value="0"><pre id="label"></pre><img id="image" alt="Actual WebGPU frame">
<script>const frames=${JSON.stringify(sequence)};let current=0,timer;const show=()=>{const row=frames[current];document.querySelector('#position').value=current;document.querySelector('#label').textContent=JSON.stringify(row,null,2);document.querySelector('#image').src=row.filename};document.querySelector('#position').oninput=e=>{current=+e.target.value;show()};document.querySelector('#play').onclick=()=>{if(timer){clearInterval(timer);timer=null}else timer=setInterval(()=>{current=(current+1)%frames.length;show()},125)};show();</script>`);
  await checkpoint();

  // Evaluate gates only after every requested image has been retained.
  const limb = report.occlusion.limb;
  assert.ok(limb.every((row) => row.blocked > 0 && row.hiddenMax <= 1), "Earth-blocked pixels must be unchanged");
  assert.ok(limb[0].energy > limb[2].energy && limb[2].energy > limb.at(-1).energy, "partial visibility must attenuate source area");
  assert.equal(limb.at(-1).changed, 0, "fully Earth-hidden Sun must leave no artificial glow");
  assert.ok(limb.slice(1, 4).every((row) => row.energy > 0));
  assert.equal(report.occlusion.mountain.analyticEarthHit, false);
  assert.equal(report.occlusion.mountain.realMeshHit, true);
  assert.ok(report.occlusion.mountain.gpu[7] > 0);
  assert.ok(report.occlusion.mountain.observation.centerDelta.every((v) => Math.abs(v) <= 1));
  assert.ok(report.occlusion.mountainRemoved.centerDelta.some((v) => v > 20));
  assert.ok(Object.values(report.occlusion.identicalMountainPair).every(Boolean));
  assert.ok(report.determinism.every((row) => row.byteIdentical), "fixed-state repeats differ; all issue frames retained");
  assert.equal(report.continuous.contiguousRenderFrameNumbers, true, "render frame gap; inspect retained manifest");
  assert.equal(report.continuous.staticPrefixByteIdentical, true, "fixed continuous prefix differs; all frames retained");
  report.checks.push("high/low orbit and low Sun; visible/partial/full Earth mask; real mesh depth/remove pair; fixed repeats; all continuous PNGs with events and viewer");
}, { extraScripts: [fileURLToPath(import.meta.url)] });
