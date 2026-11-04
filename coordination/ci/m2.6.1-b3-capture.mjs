/* global window, document, Cesium, GPUDevice, GPUBufferUsage, GPUMapMode, requestAnimationFrame, performance */
// Freeze this protocol before collecting BEFORE. Run the identical file on both
// checkouts: B3_PHASE=before|after B3_OUTPUT=<empty directory> node <this file>.
// Capture always retains observations, including failed visual gates. Use the
// companion audit to enforce AFTER gates and compare matched capture states.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { fullEffects, runB2Capture, sha256 } from "./m2.6.1-b2-round2-capture.mjs";
import { trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const protocol = "M2.6.1-B3-v1";
const frameCount = 120;
const size = [1920, 1080];

async function instrument(page) {
  await trackSolarAllocations(page);
  await page.evaluate(() => {
    const create = GPUDevice.prototype.createShaderModule;
    window.__b3Modules = [];
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      const module = create.call(this, descriptor);
      window.__b3Modules.push({ label: descriptor.label ?? "", code: descriptor.code,
        diagnostics: module.getCompilationInfo().then((info) => info.messages.map(({ type, message, lineNum, linePos }) => ({ type, message, lineNum, linePos }))) });
      return module;
    };
  });
}

async function installMeasurements(page) {
  await page.evaluate(() => {
    const originalImage = window.__b2Image;
    window.__b3Images = {};
    window.__b3ImageKey = null;
    window.__b3MotionActive = false;
    let previousMotion;
    window.__b2Image = () => {
      const value = originalImage();
      if (window.__b3ImageKey) { window.__b3Images[window.__b3ImageKey] = value.pixels; }
      if (window.__b3MotionActive) {
        let max = 0, sum = 0, changed = 0;
        if (previousMotion) {
          for (let i = 0; i < value.pixels.data.length; i += 4) {
            let delta = 0;
            for (let c = 0; c < 3; c++) {
              const difference = Math.abs(value.pixels.data[i + c] - previousMotion.data[i + c]);
              delta = Math.max(delta, difference); sum += difference;
            }
            max = Math.max(max, delta);
            if (delta > 0) { changed++; }
          }
        }
        window.__b3Motion = { comparable: Boolean(previousMotion), changedPixels: changed,
          maxByteDifference: max, meanAbsoluteRgbBytes: previousMotion ? sum / (value.pixels.width * value.pixels.height * 3) : null };
        previousMotion = value.pixels;
      }
      return value;
    };

    // Independent double-precision ray/WGS84 classification. Directions need
    // not be normalized for quadratic intersection. A two-pixel grazing band
    // excludes ambiguous receiver pixels without excluding the rest of the sky.
    window.__b3Compare = (a, b, c, d) => {
      const { viewer } = window.__m1;
      const camera = viewer.camera;
      const projection = camera.frustum.projectionMatrix;
      const radii = Cesium.Ellipsoid.WGS84.oneOverRadii;
      const origin = camera.positionWC;
      const ox = origin.x * radii.x, oy = origin.y * radii.y, oz = origin.z * radii.z;
      const constant = ox * ox + oy * oy + oz * oz - 1;
      const hits = (x, y) => {
        const nx = (2 * x / a.width - 1) / projection[0];
        const ny = (1 - 2 * y / a.height) / projection[5];
        const dx = (camera.directionWC.x + nx * camera.rightWC.x + ny * camera.upWC.x) * radii.x;
        const dy = (camera.directionWC.y + nx * camera.rightWC.y + ny * camera.upWC.y) * radii.y;
        const dz = (camera.directionWC.z + nx * camera.rightWC.z + ny * camera.upWC.z) * radii.z;
        const quadratic = dx * dx + dy * dy + dz * dz;
        const halfLinear = ox * dx + oy * dy + oz * dz;
        const discriminant = halfLinear * halfLinear - quadratic * constant;
        return discriminant >= 0 && -halfLinear + Math.sqrt(discriminant) > 0;
      };
      const center = window.__m2Sun.project(window.__m2Sun.nativeSun());
      const diskRadius = Math.tan(viewer.scene.sun.angularRadius) * a.width * projection[0] / 2;
      const blank = () => ({ pixels: 0, changedAbove1Byte: 0, maxByteDifference: 0, absoluteRgbSum: 0, signedRgbSum: [0, 0, 0] });
      const regions = { all: blank(), clearSky: blank(), coveredEarth: blank(), grazing: blank(),
        disk: blank(), outerSky: blank(), farSky: blank() };
      const add = (region, values, maximum, sum) => {
        region.pixels++; region.maxByteDifference = Math.max(region.maxByteDifference, maximum);
        region.absoluteRgbSum += sum;
        if (maximum > 1) { region.changedAbove1Byte++; }
        for (let channel = 0; channel < 3; channel++) { region.signedRgbSum[channel] += values[channel]; }
      };
      const values = [0, 0, 0];
      for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
          const offset = (y * a.width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            values[channel] = a.data[offset + channel] - b.data[offset + channel] - (c ? c.data[offset + channel] - d.data[offset + channel] : 0);
          }
          const red = Math.abs(values[0]), green = Math.abs(values[1]), blue = Math.abs(values[2]);
          const maximum = Math.max(red, green, blue);
          const sum = red + green + blue;
          add(regions.all, values, maximum, sum);
          const distance = Math.hypot(x + 0.5 - center[0], y + 0.5 - center[1]);
          if (distance <= diskRadius) { add(regions.disk, values, maximum, sum); }
          const covered = hits(x + 0.5, y + 0.5);
          const certain = hits(x - 1.5, y + 0.5) === covered && hits(x + 2.5, y + 0.5) === covered &&
            hits(x + 0.5, y - 1.5) === covered && hits(x + 0.5, y + 2.5) === covered;
          add(regions[certain ? covered ? "coveredEarth" : "clearSky" : "grazing"], values, maximum, sum);
          if (certain && !covered && distance > Math.max(8 * diskRadius, 64)) { add(regions.outerSky, values, maximum, sum); }
          if (certain && !covered && distance > Math.min(a.width, a.height) * 0.35) { add(regions.farSky, values, maximum, sum); }
        }
      }
      for (const region of Object.values(regions)) {
        region.meanAbsoluteRgbBytes = region.pixels ? region.absoluteRgbSum / (region.pixels * 3) : null;
      }
      return { resolution: [a.width, a.height], center, diskRadius, regions };
    };

    window.__b3Visibility = async () => {
      const { viewer } = window.__m1;
      const state = window.__m2Sun;
      const center = state.project(state.nativeSun());
      const radius = Math.tan(viewer.scene.sun.angularRadius) * viewer.canvas.width * viewer.camera.frustum.projectionMatrix[0] / 2;
      const samples = [];
      for (let y = -6; y <= 6; y++) {
        for (let x = -6; x <= 6; x++) {
          if (x * x + y * y > 36) { continue; }
          const point = [center[0] + x * radius / 6, center[1] + y * radius / 6];
          const ray = state.rayAt(...point);
          const earth = Boolean(state.earthHit(ray));
          const mesh = Boolean(viewer.scene.globe.pick(ray, viewer.scene));
          samples.push({ point, earth, mesh, hidden: earth || mesh });
        }
      }
      const pixels = [[Math.floor(center[0]), Math.floor(center[1])]];
      for (const scale of [4, 12, 24]) {
        for (let angle = 0; angle < 8; angle++) {
          pixels.push([Math.floor(center[0] + scale * radius * Math.cos(angle * Math.PI / 4)),
            Math.floor(center[1] + scale * radius * Math.sin(angle * Math.PI / 4))]);
        }
      }
      for (let y = 1; y < 6; y++) {
        for (let x = 1; x < 8; x++) { pixels.push([Math.floor(x * viewer.canvas.width / 8), Math.floor(y * viewer.canvas.height / 6)]); }
      }
      const inFrame = pixels.filter(([x, y]) => x >= 0 && x < viewer.canvas.width && y >= 0 && y < viewer.canvas.height);
      const gpu = await state.probe(inFrame);
      return { samples, hiddenFraction: samples.filter((sample) => sample.hidden).length / samples.length,
        terrainOnlySamples: samples.filter((sample) => sample.mesh && !sample.earth).length,
        centerEarth: samples.find((sample) => sample.point[0] === center[0] && sample.point[1] === center[1]).earth,
        centerMesh: samples.find((sample) => sample.point[0] === center[0] && sample.point[1] === center[1]).mesh,
        productionSunProbe: inFrame.map((pixel, index) => ({ pixel, raw: gpu[index] })),
        maxProductionSolarRadiance: Math.max(...gpu.flatMap((row) => row.slice(0, 3))) };
    };

    // Read actual HDR texture samples through a test-only compute pass; the
    // production textures do not have COPY_SRC usage. All owned buffers die in
    // finally. Sources are never substituted or rendered through a fake mask.
    window.__b3Hdr = async () => {
      const { viewer } = window.__m1;
      const renderer = viewer.scene._atmosphere;
      const device = viewer.scene.context._device;
      const points = [];
      const center = window.__m2Sun.project(window.__m2Sun.nativeSun());
      for (const distance of [0, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4]) {
        for (let angle = 0; angle < (distance ? 8 : 1); angle++) {
          points.push([center[0] / viewer.canvas.width + distance * Math.cos(angle * Math.PI / 4),
            center[1] / viewer.canvas.height + distance * Math.sin(angle * Math.PI / 4)]);
        }
      }
      if (!window.__b3HdrPipeline) {
        const module = device.createShaderModule({ label: "B3 actual HDR texture readback", code: `
          @group(0) @binding(0) var source: texture_2d<f32>;
          @group(0) @binding(1) var<storage, read> points: array<vec4f>;
          @group(0) @binding(2) var<storage, read_write> values: array<vec4f>;
          @compute @workgroup_size(1) fn readHdr(@builtin(global_invocation_id) id: vec3u) {
            let dimensions = vec2i(textureDimensions(source));
            let p = clamp(vec2i(points[id.x].xy * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
            values[id.x] = textureLoad(source, p, 0);
          }` });
        window.__b3HdrPipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "readHdr" } });
      }
      const inFrame = points.filter(([x, y]) => x >= 0 && x < 1 && y >= 0 && y < 1);
      const bytes = inFrame.length * 16;
      const buffers = [];
      const make = (usage, values) => {
        const buffer = device.createBuffer({ label: "B3 temporary HDR readback", size: bytes, usage, mappedAtCreation: Boolean(values) });
        buffers.push(buffer);
        if (values) { new Float32Array(buffer.getMappedRange()).set(values); buffer.unmap(); }
        return buffer;
      };
      const textures = [];
      device.pushErrorScope("validation");
      let validation;
      try {
        const input = make(GPUBufferUsage.STORAGE, inFrame.flatMap(([x, y]) => [x, y, 0, 0]));
        const result = make(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const readback = make(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
        for (const [key, texture] of Object.entries(renderer)) {
          if (!(key === "_linearTexture" || /bloom.*texture|texture.*bloom/i.test(key)) || typeof texture?.createView !== "function") { continue; }
          const pipeline = window.__b3HdrPipeline;
          const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: input } }, { binding: 2, resource: { buffer: result } },
          ] });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.dispatchWorkgroups(inFrame.length); pass.end();
          encoder.copyBufferToBuffer(result, 0, readback, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const values = Array.from(new Float32Array(readback.getMappedRange())); readback.unmap();
          textures.push({ key, label: texture.label, format: texture.format, size: [texture.width, texture.height], values });
        }
      } finally {
        for (const buffer of buffers) { buffer.destroy(); }
        validation = await device.popErrorScope();
      }
      if (validation) { throw new Error(validation.message); }
      return { points: inFrame, textures, note: "Raw pre-tone-map samples; linear source and every exposed Bloom texture. Atmospheric radiance may persist with Sun.show=false." };
    };
  });
}

function gate(report, name, passed, details) {
  report.b3Gates.push({ name, passed: Boolean(passed), details });
}

async function pair(context, name, options = {}, dimensions = size) {
  const { page, scene, capture, report, checkpoint } = context;
  await page.evaluate(() => { window.__b3Images = {}; window.__b3ImageKey = "full"; });
  const full = await scene(`${name}-full`, { ...options, bloom: 0.35 }, dimensions);
  await page.evaluate(() => { window.__m1.viewer.scene._atmosphere.bloomStrength = 0; window.__b3ImageKey = "off"; });
  const off = await capture(`${name}-bloom-off`, { intent: { ...options, bloom: 0, pairedWith: full.filename } });
  const delta = await page.evaluate(() => window.__b3Compare(window.__b3Images.full, window.__b3Images.off));
  report.bloomPairs.push({ name, full: full.filename, bloomOff: off.filename, delta });
  gate(report, `${name}: matched exposure and canvas`, full.state.exposure === off.state.exposure &&
    JSON.stringify(full.state.canvas) === JSON.stringify(off.state.canvas));
  gate(report, `${name}: post-blur Earth receivers`, delta.regions.coveredEarth.maxByteDifference <= 1, delta.regions.coveredEarth);
  await page.evaluate(() => { window.__m1.viewer.scene._atmosphere.bloomStrength = 0.35; window.__b3ImageKey = null; window.__b3Images = {}; });
  await checkpoint();
}

async function occultation(context, name, { expected, terrain = false } = {}) {
  const { page, capture, settle, report, checkpoint } = context;
  const settled = await settle();
  const records = {};
  const rawHdr = {};
  await page.evaluate(() => { window.__b3Images = {}; });
  for (const [key, bloom, show] of [["fullOff", 0.35, false], ["fullOn", 0.35, true], ["zeroOff", 0, false], ["zeroOn", 0, true]]) {
    await page.evaluate(({ key, bloom, show }) => {
      window.__m1.viewer.scene._atmosphere.bloomStrength = bloom;
      window.__m1.viewer.scene.sun.show = show;
      window.__b3ImageKey = key;
    }, { key, bloom, show });
    records[key] = (await capture(`${name}-${key}`, { settled, intent: { occultation: name, bloom, sunShow: show } })).filename;
    if (bloom > 0) { rawHdr[key] = await page.evaluate(() => window.__b3Hdr()); }
  }
  const measured = await page.evaluate(async () => {
    const images = window.__b3Images;
    return { visibility: await window.__b3Visibility(),
      fullContribution: window.__b3Compare(images.fullOn, images.fullOff),
      sourceContribution: window.__b3Compare(images.zeroOn, images.zeroOff),
      blurredContribution: window.__b3Compare(images.fullOn, images.fullOff, images.zeroOn, images.zeroOff),
      state: window.__b2State() };
  });
  const hdrDelta = rawHdr.fullOn.textures.map((on) => {
    const off = rawHdr.fullOff.textures.find((texture) => texture.key === on.key);
    assert.ok(off && JSON.stringify(off.size) === JSON.stringify(on.size), "HDR controls must sample the same texture shape");
    const differences = on.values.map((value, index) => index % 4 < 3 ? Math.abs(value - off.values[index]) : 0);
    return { key: on.key, label: on.label, size: on.size, maxAbsoluteRgb: Math.max(...differences),
      meanAbsoluteRgb: differences.reduce((sum, difference) => sum + difference, 0) / (differences.length * 0.75) };
  });
  const value = { name, expected, terrain, records, rawHdr, hdrDelta, ...measured };
  report.occlusion.push(value);
  gate(report, `${name}: clear sky is tested`, measured.fullContribution.regions.clearSky.pixels > 0);
  gate(report, `${name}: Earth receiver mask`, measured.fullContribution.regions.coveredEarth.maxByteDifference <= 1);
  if (terrain) {
    gate(report, `${name}: real mesh above analytic Earth`, !measured.visibility.centerEarth && measured.visibility.centerMesh && measured.visibility.terrainOnlySamples > 0);
  }
  if (expected === "hidden") {
    gate(report, `${name}: independently hidden entire source`, measured.visibility.hiddenFraction === 1, measured.visibility.hiddenFraction);
    gate(report, `${name}: direct production solar radiance`, measured.visibility.maxProductionSolarRadiance <= 1e-5, measured.visibility.maxProductionSolarRadiance);
    for (const key of ["_linearTexture", "_bloomTextureA", "_bloomTextureB"]) {
      const delta = hdrDelta.find((texture) => texture.key === key);
      gate(report, `${name}: no added HDR signal in ${key}`, Boolean(delta) && delta.maxAbsoluteRgb <= 1e-5, delta);
    }
    gate(report, `${name}: no added solar pixels anywhere`, measured.fullContribution.regions.all.maxByteDifference <= 1, measured.fullContribution.regions);
    gate(report, `${name}: no direct solar contribution`, measured.sourceContribution.regions.all.maxByteDifference <= 1);
    gate(report, `${name}: no added blurred solar contribution`, measured.blurredContribution.regions.all.maxByteDifference <= 2, measured.blurredContribution.regions);
  } else if (expected === "partial") {
    gate(report, `${name}: partial source area`, measured.visibility.hiddenFraction > 0 && measured.visibility.hiddenFraction < 1, measured.visibility.hiddenFraction);
    gate(report, `${name}: exposed source stays visible`, measured.fullContribution.regions.all.changedAbove1Byte > 0);
  } else if (expected === "visible") {
    gate(report, `${name}: visible source`, measured.visibility.hiddenFraction < 1 && measured.sourceContribution.regions.all.changedAbove1Byte > 0);
  }
  await page.evaluate(() => { window.__m1.viewer.scene._atmosphere.bloomStrength = 0.35; window.__b3ImageKey = null; window.__b3Images = {}; });
  await checkpoint();
  return value;
}

async function continuous(context) {
  const { page, scene, capture, report, output, checkpoint } = context;
  await scene("motion-initial", { fov: 60, exposure: 1, bloom: 0.35 });
  await mkdir(path.join(output, "motion"));
  await page.evaluate(() => { window.__b3MotionActive = true; });
  const frames = [];
  for (let index = 0; index < frameCount; index++) {
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const { viewer } = window.__m1;
      viewer.camera.lookRight(Cesium.Math.toRadians(0.015));
      viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.currentTime, 10, new Cesium.JulianDate());
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
    });
    const row = await capture(`motion/frame-${String(index).padStart(4, "0")}`, { intent: { index, cameraDegreesPerFrame: 0.015, timeSecondsPerFrame: 10, fixedExposure: 1, fixedBloom: 0.35, fixedResolution: size } });
    const motion = await page.evaluate(() => window.__b3Motion);
    frames.push({ index, filename: path.basename(row.filename), sha256: row.sha256, frame: row.state.frame,
      time: row.state.time, cameraDirection: row.state.camera.directionWC, motion });
    gate(report, `motion ${index}: fixed settings`, row.state.exposure === 1 && row.state.bloomStrength === 0.35 &&
      JSON.stringify(row.state.canvas) === JSON.stringify(size) && JSON.stringify(row.state.solarEffects) === JSON.stringify(fullEffects));
  }
  await page.evaluate(() => { window.__b3MotionActive = false; });
  report.continuous = { count: frames.length, frames, fixedExposure: 1, fixedBloom: 0.35, fixedResolution: size,
    fixedEffects: fullEffects, cameraDegreesPerFrame: 0.015, timeSecondsPerFrame: 10,
    contiguous: frames.every((row, index) => !index || row.frame === frames[index - 1].frame + 1),
    note: "Every actual render is saved. PNG encoding paces this sequence; this is not an FPS measurement." };
  gate(report, "120 uninterrupted camera and time frames", frames.length === frameCount && report.continuous.contiguous &&
    frames.every((row, index) => !index || row.time !== frames[index - 1].time && JSON.stringify(row.cameraDirection) !== JSON.stringify(frames[index - 1].cameraDirection)));
  await writeFile(path.join(output, "motion", "sequence.json"), JSON.stringify(report.continuous, null, 2));
  await writeFile(path.join(output, "motion", "index.html"), `<!doctype html><meta charset="utf-8"><title>B3 ${report.phase} motion</title>
<style>body{background:#111;color:#eee;font:16px system-ui;margin:20px}img{display:block;max-width:100%;height:auto}input{width:65vw}pre{white-space:pre-wrap}</style>
<h1>B3 ${report.phase}: 120 consecutive moving camera/time frames</h1><p>Exposure 1, Bloom 0.35, 1920×1080 and all effects stay fixed. Playback is an inspection aid.</p>
<button id="play">Play / pause</button><input id="position" type="range" min="0" max="119" value="0"><pre id="label"></pre><img id="image" alt="Actual WebGPU frame">
<script>const frames=${JSON.stringify(frames)};let current=0,timer;const show=()=>{const row=frames[current];document.querySelector('#position').value=current;document.querySelector('#label').textContent=JSON.stringify(row,null,2);document.querySelector('#image').src=row.filename};document.querySelector('#position').oninput=e=>{current=+e.target.value;show()};document.querySelector('#play').onclick=()=>{if(timer){clearInterval(timer);timer=null}else{timer=setInterval(()=>{current=(current+1)%frames.length;show()},125)}};show();</script>`);
  await checkpoint();
}

async function lifecycle(context) {
  const { page, report, output, checkpoint } = context;
  report.lifecycle = [];
  await mkdir(path.join(output, "lifecycle"));
  for (let cycle = 0; cycle < 3; cycle++) {
    const value = await page.evaluate(async (cycle) => {
      const reference = window.__m1.viewer;
      const firstAllocation = window.__solarAllocations.length;
      const container = document.createElement("div");
      Object.assign(container.style, { position: "absolute", left: "0", top: "0", width: "1920px", height: "1080px" });
      document.body.appendChild(container);
      const viewer = new Cesium.Viewer(container, { renderingBackend: "webgpu", useDefaultRenderLoop: false, skyAtmosphere: false, skyBox: false });
      const errors = [], gpuErrors = [], captures = [];
      viewer.renderError.addEventListener((...event) => errors.push(String(event[1])));
      let renderer, device, beforeDestroy, afterDestroy;
      try {
        await viewer.readyPromise;
        renderer = viewer.scene._atmosphere;
        device = viewer.scene.context._device;
        device.addEventListener("uncapturederror", (event) => gpuErrors.push(String(event.error)));
        viewer.scene.globe.maximumScreenSpaceError = 3;
        Object.assign(viewer.scene.sun, reference.scene.sun, { show: true });
        Object.assign(viewer.scene.atmosphere, reference.scene.atmosphere, { show: true });
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = Cesium.JulianDate.clone(reference.clock.currentTime);
        viewer.scene.exposure = 1;
        viewer.camera.setView({ destination: Cesium.Cartesian3.clone(reference.camera.positionWC), orientation: {
          direction: Cesium.Cartesian3.clone(reference.camera.directionWC), up: Cesium.Cartesian3.clone(reference.camera.upWC),
        } });
        for (const [width, height] of [[1920, 1080], [1280, 720], [1920, 1080]]) {
          container.style.width = `${width}px`; container.style.height = `${height}px`;
          viewer.resize();
          viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(60), aspectRatio: width / height, near: 0.1, far: 500000000 });
          let stable = 0;
          const started = performance.now();
          while (stable < 4 && performance.now() - started < 60000) {
            viewer.render();
            stable = viewer.scene.globe.tilesLoaded && viewer.scene.debugStatistics.imagery.pendingRequests === 0 ? stable + 1 : 0;
            await new Promise(requestAnimationFrame);
          }
          await device.queue.onSubmittedWorkDone();
          viewer.render();
          const image = document.createElement("canvas"); image.width = viewer.canvas.width; image.height = viewer.canvas.height;
          image.getContext("2d").drawImage(viewer.canvas, 0, 0);
          captures.push({ canvas: [image.width, image.height], intended: [width, height], settled: stable >= 4,
            png: image.toDataURL("image/png").split(",")[1], stats: { ...renderer.statistics }, bloomStrength: renderer.bloomStrength,
            solarEffects: { ...renderer.solarEffects }, assetRecords: renderer.solarAssetRecords });
        }
        beforeDestroy = { ...renderer.statistics };
        await device.queue.onSubmittedWorkDone();
      } finally {
        viewer.destroy();
        if (renderer) { afterDestroy = { ...renderer.statistics }; renderer.destroy(); }
        container.remove();
      }
      const allocations = window.__solarAllocations.slice(firstAllocation).filter((row) => /^M2(?:[ .]|$)/.test(row.label));
      return { cycle, captures, errors, gpuErrors, destroyed: viewer.isDestroyed(), beforeDestroy, afterDestroy, allocations,
        liveSolarAllocations: allocations.filter((row) => !row.destroyed),
        extraDestroyCalls: allocations.filter((row) => row.destroyCalls !== 1) };
    }, cycle);
    for (let index = 0; index < value.captures.length; index++) {
      const capture = value.captures[index];
      const png = Buffer.from(capture.png, "base64"); delete capture.png;
      capture.filename = `lifecycle/cycle-${cycle}-resize-${index}.png`;
      capture.sha256 = sha256(png); capture.bytes = png.length;
      await writeFile(path.join(output, capture.filename), png);
    }
    report.lifecycle.push(value);
    gate(report, `lifecycle ${cycle}: real resize and restore`, value.captures.every((row) => row.settled && JSON.stringify(row.canvas) === JSON.stringify(row.intended)));
    gate(report, `lifecycle ${cycle}: renderer resources balanced`, value.destroyed && value.afterDestroy.texturesCreated === value.afterDestroy.texturesDestroyed &&
      value.afterDestroy.buffersCreated === value.afterDestroy.buffersDestroyed && value.afterDestroy.bloomTextureBytes === 0 && value.afterDestroy.solarAssetBytes === 0);
    gate(report, `lifecycle ${cycle}: native solar resources destroyed once`, value.allocations.length > 0 && value.liveSolarAllocations.length === 0 && value.extraDestroyCalls.length === 0);
    gate(report, `lifecycle ${cycle}: no render or GPU errors`, value.errors.length === 0 && value.gpuErrors.length === 0);
    await checkpoint();
  }
}

export async function captureB3(context) {
  const { page, report, scene, output, checkpoint } = context;
  report.captureProtocol = protocol;
  report.b3Gates = []; report.bloomPairs = []; report.occlusion = [];
  report.requirements = { defaultBloom: 0.35, exposures: [0.5, 1, 2], normalFov: 60, resolution: size, frames: frameCount,
    occlusionMethod: "Sun.show on/off at unchanged camera/time; whole-frame and clear-sky differences plus direct production solar and actual HDR texture samples" };
  await installMeasurements(page);
  for (const [placement, offAxis] of [["center", 0], ["offaxis", 15], ["edge", 29.5]]) {
    for (const exposure of placement === "edge" ? [1] : [0.5, 1, 2]) { await pair(context, `normal-60-${placement}-exposure-${exposure}`, { fov: 60, offAxis, exposure }); }
  }
  await pair(context, "resize-720", { fov: 60 }, [1280, 720]);
  await pair(context, "resize-restored-1080", { fov: 60 });
  for (const [name, options] of [
    ["high-orbit-sunrise", { height: 35786000, limbOffset: 0.05, time: "2026-03-20T06:00:00Z" }],
    ["low-orbit-low-sun", { height: 400000, elevation: 0.5 }],
    ["near-ground-low-sun", { height: 2, elevation: 0.5 }],
  ]) { await pair(context, name, { ...options, fov: 60 }); }

  for (const [name, fraction, expected, fov] of [["earth-visible", 1.5, "visible", 12], ["earth-partial", 0, "partial", 12],
    ["earth-hidden", -1.5, "hidden", 12], ["earth-hidden-normal-fov", -1.5, "hidden", 60]]) {
    await page.evaluate(({ fraction, fov }) => {
      window.__b2Reset({ fov, height: 400000, limbOffset: fraction * Cesium.Math.toDegrees(window.__m1.viewer.scene.sun.angularRadius) });
    }, { fraction, fov });
    await occultation(context, name, { expected });
  }
  for (const [name, minimum, expected] of [["terrain-partial", 5500, "partial"], ["terrain-hidden", 1000, "hidden"]]) {
    const fixture = await page.evaluate((minimum) => { window.__b2Reset({ fov: 12, height: 20000 }); return window.__m2Sun.prepareMountain(minimum); }, minimum);
    const observation = await occultation(context, name, { expected, terrain: true });
    observation.fixture = { ...fixture, type: "actual CustomHeightmapTerrainProvider Gaussian mesh" };
  }
  const hiddenTerrain = report.occlusion.at(-1);
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__m2Sun.originalTerrain; });
  const removed = await occultation(context, "terrain-removed", { expected: "visible" });
  const cameraFields = ["positionWC", "directionWC", "upWC", "rightWC"];
  const basisDelta = Math.max(...cameraFields.flatMap((key) => hiddenTerrain.state.camera[key].map((value, index) => Math.abs(value - removed.state.camera[key][index]))));
  gate(report, "mountain removal preserves camera and time", basisDelta <= 32 * Number.EPSILON && hiddenTerrain.state.time === removed.state.time, basisDelta);
  gate(report, "mountain removal removes the real mesh", !removed.visibility.centerMesh && !removed.visibility.centerEarth);

  await continuous(context);
  await scene("lifecycle-reference", { fov: 60 });
  await lifecycle(context);
  const modules = await page.evaluate(async () => Promise.all(window.__b3Modules.map(async (module) => ({ label: module.label, code: module.code, diagnostics: await module.diagnostics }))));
  await mkdir(path.join(output, "shaders"));
  report.compiledShaders = [];
  const saved = new Set();
  for (const module of modules) {
    const digest = sha256(module.code);
    if (!saved.has(digest)) { await writeFile(path.join(output, "shaders", `${digest}.wgsl`), module.code); saved.add(digest); }
    report.compiledShaders.push({ label: module.label, sha256: digest, filename: `shaders/${digest}.wgsl`, diagnostics: module.diagnostics });
  }
  gate(report, "all compiled shader diagnostics", modules.every((module) => module.diagnostics.every((diagnostic) => diagnostic.type !== "error")));
  report.knownIssues = report.b3Gates.filter((check) => !check.passed).map((check) => check.name);
  report.checks.push("B3 matched full/Bloom-off pairs; whole-frame Sun-toggle occlusion controls; actual HDR readbacks; every moving camera/time frame retained; three native create/resize/destroy cycles");
  await checkpoint();
}

async function main() {
  assert.ok(["before", "after"].includes(process.env.B3_PHASE), "Set B3_PHASE=before or after");
  process.env.B2_PHASE = process.env.B3_PHASE;
  process.env.B2_OUTPUT = process.env.B3_OUTPUT ?? `Build/b3-evidence/${process.env.B3_PHASE}`;
  await runB2Capture("b3", captureB3, { extraScripts: [scriptFile, fileURLToPath(new URL("./m2.6.1-b3-audit.mjs", import.meta.url))], beforeInstall: instrument });
  const output = path.resolve(process.env.B2_OUTPUT);
  const report = JSON.parse(await readFile(path.join(output, "result.json"), "utf8"));
  await writeFile(path.join(output, "gpu-timing-raw.json"), JSON.stringify({ state: report.scenes.find((row) => row.name === "gpu-timing-state-full-60").state, ...report.gpuTiming }, null, 2));
  await writeFile(path.join(output, "b3-gates.json"), JSON.stringify({ phase: report.phase, gates: report.b3Gates, failed: report.knownIssues, note: "Capture completeness does not grant visual acceptance. Audit AFTER and inspect all PNGs." }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) { await main(); }
