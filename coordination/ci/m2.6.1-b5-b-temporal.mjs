/* global window, Cesium, GPUDevice, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import { installSunProbe } from "./m2-sun-fixtures.mjs";
import { installB4Probe, hash } from "./m2.6.1-b4-fixtures.mjs";
import { classifyGpu, assertPhysicalGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";
import { diagnoseB1Canvas, b1TrackedDelta } from "./m2-b1-round2-fixtures.mjs";
import currentAtmosphere from "../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";

process.env.M1_OUTPUT ??= "Build/m2.6.1-b5-b";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
// Each attempt retains its failure report and captures; choose a new output for reruns.
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2.6.1-b5-b-temporal", async ({ page, report, output }) => {
  report.protocol = "B5-B-v1";
  report.visualAcceptance = "AWAITING_REVIEW";
  report.scope = "Fixed repeats, capture-paced contiguous motion, Earth/mesh occultation and resize. No GPU performance or lifecycle acceptance.";
  report.harnessSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const dependencies = ["m1-browser-harness.mjs", "m2-sun-fixtures.mjs", "m2-atmosphere-fixtures.mjs", "m2.6.1-b4-fixtures.mjs", "m0-browser-config.mjs", "m2-b1-round2-fixtures.mjs"];
  report.harnessDependencies = Object.fromEntries(await Promise.all(dependencies.map(async (name) => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  const runtimeFiles = ["WebGPUAtmosphereShader.js", "WebGPUAtmosphereRenderer.js", "WebGPUAtmosphereModel.js", "WebGPUSunShader.js", "WebGPUPlanetShader.js", "WebGPUGlobeRenderer.js"];
  report.runtimeHashes = Object.fromEntries(await Promise.all(runtimeFiles.map(async (name) => [name, hash(await readFile(`packages/engine/Source/Scene/${name}`))])));
  const servedShader = await page.evaluate(() => Cesium.WebGPUAtmosphereShader);
  assert.equal(servedShader, currentAtmosphere, "Served production shader must match current source, not another worktree");
  report.productionShaderSha256 = hash(servedShader);
  report.sequences = [];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    window.__b5Shaders = [];
    const create = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      window.__b5Shaders.push({ label: descriptor.label ?? "", code: descriptor.code });
      return create.call(this, descriptor);
    };
  });
  await installM1Scene(page, { baseLayer: false });
  report.adapter = await page.evaluate(() => window.__m1.adapterInfo);
  assertPhysicalGpu(classifyGpu(report.adapter), getBrowserConfiguration());
  await page.evaluate(() => {
    class BoundedEllipsoidTerrainProvider extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
    }
    window.__m1.viewer.terrainProvider = new BoundedEllipsoidTerrainProvider();
    window.__b5GpuErrors = [];
    window.__m1.viewer.scene.context._device.addEventListener("uncapturederror", (event) => window.__b5GpuErrors.push(String(event.error)));
  });
  report.fixture = { terrain: "native bounded ellipsoid meshes", maximumLevel: 8, externalProviders: false };
  await installSunProbe(page);
  await installB4Probe(page);
  await page.evaluate(() => { window.__m1.viewer.scene.globe.enableLighting = true; });
  await page.waitForFunction(() => { window.__m1.viewer.render(); return window.__m1.viewer.scene._atmosphere.statistics.solarAssetsLoaded; });
  await page.addScriptTag({ content: `window.__b5Diagnose = (${diagnoseB1Canvas.toString()});` });

  await page.evaluate(() => window.__b4.view({ height: 400000, elevation: 15, fov: 24 }));
  report.initialSettling = await settle(page);
  await sequence("fixed-1080", 8, "fixed");
  await sequence("motion-1080", 120, "motion");
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    await page.evaluate(() => { window.__m1.viewer.resize(); });
    await settle(page);
    await sequence(`resize-${width}`, 8, "fixed");
    assert.deepEqual(report.sequences.at(-1).frames[0].state.viewport, [width, width * 9 / 16]);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { window.__m1.viewer.resize(); window.__b4.view({ height: 400000, limbOffset: 0.6, fov: 12 }); });
  await settle(page);
  await sequence("earth-limb-720", 120, "limb");
  const limb = report.sequences.at(-1);
  assert.ok(limb.frames.some((f) => f.geometry.clear === f.geometry.samples), "Limb sequence includes a clear disk");
  assert.ok(limb.frames.some((f) => f.geometry.earthBlocked > 0 && f.geometry.clear > 0), "Limb sequence includes partial occultation");
  assert.ok(limb.frames.some((f) => f.geometry.earthBlocked === f.geometry.samples), "Limb sequence includes a fully Earth-hidden disk");
  report.earthHidden = await page.evaluate(() => window.__b4.occlusion());
  assert.equal(report.earthHidden.changedPixels, 0, "Fully Earth-hidden source leaves no solar artwork or Bloom residue");
  await page.evaluate(() => window.__b4.view({ height: 400000, limbOffset: 0, fov: 12 }));
  await settle(page);
  await sequence("earth-partial-720", 8, "fixed");
  report.earthPartial = await page.evaluate(() => window.__b4.occlusion());
  assert.ok(report.earthPartial.geometry.earthBlocked > 0 && report.earthPartial.geometry.clear > 0);
  assert.ok(report.earthPartial.hiddenSamples > 0);
  assert.ok(report.earthPartial.hiddenMax <= 1, "Partial occultation does not leak into hidden receivers");
  assert.ok(report.earthPartial.changedPixels > 0, "Partially visible source still contributes");
  await page.evaluate(() => {
    window.__m2Sun.prepareMountain(3000);
    window.__b4.mountain = true;
    const provider = window.__m1.viewer.terrainProvider;
    const error = provider.getLevelMaximumGeometricError.bind(provider);
    provider.getLevelMaximumGeometricError = (level) => level >= 8 ? 0 : error(level);
    window.__b4.mode("all");
  });
  report.mountainSettling = await settle(page);
  await sequence("mesh-hidden-720", 8, "fixed");
  report.meshHidden = await page.evaluate(() => window.__b4.occlusion());
  assert.equal(report.meshHidden.geometry.earthBlocked, 0);
  assert.equal(report.meshHidden.geometry.meshBlocked, report.meshHidden.geometry.samples);
  assert.equal(report.meshHidden.changedPixels, 0, "Real mesh hides all solar effects");
  assert.ok(report.meshHidden.gpu.every((row) => row[7] > 0 && row.slice(0, 3).every((v) => Math.abs(v) <= 1e-6)));
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain; window.__b4.mountain = false; });
  await settle(page);
  await sequence("mesh-removed-720", 8, "fixed");
  report.meshRemoved = await page.evaluate(() => window.__b4.occlusion());
  assert.equal(report.meshRemoved.geometry.meshBlocked, 0);
  assert.ok(report.meshRemoved.gpu[0].slice(0, 3).some((v) => v > 0.1), "Removing mesh restores solar radiance");
  report.gpuErrors = await page.evaluate(() => window.__b5GpuErrors);
  report.providerErrors = await page.evaluate(() => window.__m1.providerErrors);
  assert.deepEqual(report.providerErrors, []);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(report.browserConsole, []);
  const shaders = await page.evaluate(() => window.__b5Shaders);
  report.shaderModules = shaders.map(({ label, code }) => ({ label, sha256: hash(code) }));
  report.checks.push("Fixed-state repeats <=1 byte; 120 contiguous camera/time frames; 120 Earth-limb frames; both resolutions; real-mesh negative/positive controls; zero browser/GPU errors.");
  await checkpoint();

  async function sequence(name, count, kind) {
    const dir = path.join(output, name);
    await mkdir(dir, { recursive: true });
    await page.evaluate(() => { window.__b5Previous = null; });
    const record = { name, kind, count, frames: [], note: "PNG encoding paces capture. Every actual render is saved; no FPS claim." };
    report.sequences.push(record);
    let previousSamples;
    for (let index = 0; index < count; index++) {
      const raw = await page.evaluate(async ({ kind, index, count }) => {
        await new Promise(requestAnimationFrame);
        const { viewer } = window.__m1;
        const { scene } = viewer;
        const sun = window.__m2Sun;
        if (kind === "motion") {
          viewer.camera.lookRight(Cesium.Math.toRadians(0.015));
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1, new Cesium.JulianDate());
        } else if (kind === "limb") {
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 1, new Cesium.JulianDate());
          sun.setElevation(400000, sun.limbElevation(400000) + 0.6 - 1.2 * index / (count - 1));
        }
        viewer.camera.update(Cesium.SceneMode.SCENE3D);
        const image = window.__m1.pixels();
        const png = viewer.canvas.toDataURL("image/png");
        const previous = window.__b5Previous;
        let maximum = 0, total = 0;
        if (previous) {
          for (let i = 0; i < image.data.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
              const difference = Math.abs(image.data[i + channel] - previous.data[i + channel]);
              maximum = Math.max(maximum, difference); total += difference;
            }
          }
        }
        window.__b5Previous = image;
        const direction = sun.nativeSun();
        const axis = Math.abs(direction.z) < 0.9 ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.UNIT_Y;
        const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, axis, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const up = Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3());
        const rayPoints = [];
        for (let ring = 0; ring < 12; ring++) {
          const radius = Math.tan(scene.sun.glowRadius) * (0.2 + 0.65 * ring / 11);
          for (let angle = 0; angle < 128; angle++) {
            const theta = angle / 128 * 2 * Math.PI;
            rayPoints.push(sun.project(new Cesium.Cartesian3(
              direction.x + radius * (right.x * Math.cos(theta) + up.x * Math.sin(theta)),
              direction.y + radius * (right.y * Math.cos(theta) + up.y * Math.sin(theta)),
              direction.z + radius * (right.z * Math.cos(theta) + up.z * Math.sin(theta)))));
          }
        }
        const scale = image.width * viewer.camera.frustum.projectionMatrix[0] / 2;
        const diagnostics = window.__b5Diagnose(image, { center: sun.project(direction), diskRadiusPixels: Math.tan(scene.sun.angularRadius) * scale,
          glowRadiusPixels: Math.tan(scene.sun.glowRadius) * scale, rayPoints });
        return { png, state: window.__b4.snapshot(), frame: scene._frameState.frameNumber,
          geometry: window.__b4.diskGeometry(), diagnostics, errors: [...window.__m1.errors],
          adjacent: previous ? { maxByteDifference: maximum, meanAbsoluteRgbBytes: total / (image.width * image.height * 3) } : null };
      }, { kind, index, count });
      const png = Buffer.from(raw.png.split(",")[1], "base64");
      delete raw.png;
      const samples = raw.diagnostics.trackedRayLuminance;
      if (kind === "motion") { assert.equal(raw.diagnostics.validTrackedSamples, 1536, "Entire tracked solar region stays on canvas"); }
      const trackedDelta = previousSamples ? b1TrackedDelta(previousSamples, samples) : null;
      previousSamples = samples;
      const frame = { index, filename: `frame-${String(index).padStart(4, "0")}.png`, sha256: hash(png), ...raw, trackedDelta };
      await writeFile(path.join(dir, frame.filename), png);
      record.frames.push(frame);
      await checkpoint();
      assert.deepEqual(frame.errors, []);
      assert.ok(frame.state.terrain.selectedMeshes.every(([level]) => level <= 8));
      if (index) {
        const prior = record.frames[index - 1];
        assert.equal(frame.frame, prior.frame + 1, "No unsaved renders in sequence");
        assert.equal(frame.state.exposure, prior.state.exposure);
        assert.equal(frame.state.bloomStrength, prior.state.bloomStrength);
        assert.deepEqual(frame.state.solarEffects, prior.state.solarEffects);
        if (kind === "fixed") {
          assert.deepEqual(frame.state.camera, prior.state.camera);
          assert.equal(frame.state.time, prior.state.time);
          assert.deepEqual(frame.state.viewport, prior.state.viewport);
          assert.ok(frame.adjacent.maxByteDifference <= 1, "Fixed state must repeat within one byte");
        }
        else {
          assert.notEqual(frame.state.time, prior.state.time);
          assert.notDeepEqual(frame.state.camera, prior.state.camera);
          if (kind === "motion") { assert.ok(trackedDelta.mean < 0.03 && trackedDelta.p99 < 0.2, "Aligned solar region meets existing B1 continuity bounds"); }
        }
      }
    }
    await writeFile(path.join(dir, "sequence.json"), JSON.stringify(record, null, 2));
    await writeFile(path.join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{background:#111;color:#eee;font:16px system-ui}img{max-width:100%}input{width:70%}</style><h1>${name}</h1><p>Original WebGPU captures; playback speed is an inspection aid.</p><button id="play">Play / pause</button><input id="seek" type="range" min="0" max="${count - 1}" value="0"><p id="label"></p><img id="image"><script>let i=0,t;const frames=${JSON.stringify(record.frames.map(({ filename, index }) => ({ filename, index })))};function show(){document.getElementById('image').src=frames[i].filename;document.getElementById('seek').value=i;document.getElementById('label').textContent='Frame '+i}document.getElementById('seek').oninput=e=>{i=+e.target.value;show()};document.getElementById('play').onclick=()=>{if(t){clearInterval(t);t=null}else{t=setInterval(()=>{i=(i+1)%frames.length;show()},100)}};show()</script>`);
  }
  async function checkpoint() { await writeFile(path.join(output, "capture-progress.json"), JSON.stringify(report, null, 2)); }
});

async function settle(page) {
  return page.evaluate(async () => {
    const { viewer, settle } = window.__m1;
    const { scene } = viewer;
    // A sky-only view cannot satisfy the terrain helper's nonzero draw gate.
    if (window.__b4.snapshot().framing.earthRays === 0) {
      viewer.render();
      await scene.context._device.queue.onSubmittedWorkDone();
      return { skyOnly: true, solarAssetsLoaded: scene._atmosphere.statistics.solarAssetsLoaded };
    }
    const settings = [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting];
    scene.atmosphere.show = false; scene.sun.show = false; scene._atmosphere.bloomStrength = 0; scene.globe.enableLighting = false;
    try { return await settle({ timeout: 60000 }); }
    finally {
      [scene.atmosphere.show, scene.sun.show, scene._atmosphere.bloomStrength, scene.globe.enableLighting] = settings;
      viewer.render();
    }
  });
}
