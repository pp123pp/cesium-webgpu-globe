/* global window, document, Cesium, GPUDevice */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import { trackSolarAllocations } from "./m2-solar-gpu-timing.mjs";
import { hash } from "./m2.6.1-b4-fixtures.mjs";
import { assertPhysicalGpu, classifyGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";

process.env.M1_OUTPUT ??= "Build/m2-lens-flare-lifecycle";
await mkdir(path.dirname(path.resolve(process.env.M1_OUTPUT)), { recursive: true });
await mkdir(path.resolve(process.env.M1_OUTPUT));
await runM1BrowserSuite("m2-lens-flare-lifecycle", async ({ page, report }) => {
  await trackSolarAllocations(page);
  report.runtimeHashes = Object.fromEntries(await Promise.all(["WebGPUAtmosphereRenderer.js", "WebGPUSolarBloomShader.js", "WebGPULensFlareShader.js"].map(async (name) => [name, hash(await readFile(`packages/engine/Source/Scene/${name}`))])));
  report.cases = [];
  const asset = "**/Assets/Textures/WebGPU/Solar/GPU/glow-gradient.rgba8";
  for (const kind of ["resize", "asset-corrupt", "device-loss", "recreate-after-loss", "pipeline-rejection"]) {
    if (kind === "asset-corrupt") {
      await page.route(asset, (route) => route.fulfill({ status: 200, body: "intentional corrupt M2.8 payload" }));
    }
    const result = await page.evaluate(async (kind) => {
      const first = window.__solarAllocations.length;
      const priorLive = window.__solarAllocations.filter((item) => !item.destroyed).length;
      const container = document.createElement("div");
      container.style.cssText = "position:absolute;left:0;top:0;width:1280px;height:720px";
      document.body.appendChild(container);
      const result = { kind, priorLive, errors: [], gpuErrors: [], captures: [] };
      const originalPipeline = GPUDevice.prototype.createRenderPipelineAsync;
      if (kind === "pipeline-rejection") {
        GPUDevice.prototype.createRenderPipelineAsync = function (descriptor) {
          if (descriptor.label === "M2.8 lens optics and ACES/sRGB output") { return Promise.reject(new Error("Intentional M2.8 lens pipeline rejection")); }
          return originalPipeline.call(this, descriptor);
        };
      }
      class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
        getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
      }
      let viewer, renderer;
      const native = () => {
        const rows = window.__solarAllocations.slice(first);
        const live = rows.filter((row) => !row.destroyed);
        return { created: rows.length, live: live.length, textures: live.filter((row) => row.kind === "Texture").length,
          buffers: live.filter((row) => row.kind === "Buffer").length, payloadBytes: live.reduce((sum, row) => sum + row.bytes, 0) };
      };
      try {
        viewer = new Cesium.Viewer(container, { renderingBackend: "webgpu", useDefaultRenderLoop: false, baseLayer: false,
          skyBox: false, skyAtmosphere: false, terrainProvider: new BoundedTerrain() });
        renderer = viewer.scene._atmosphere;
        renderer.lensFlare.enabled = true;
        viewer.renderError.addEventListener((...args) => result.errors.push(String(args[1])));
        try { await viewer.readyPromise; } catch (error) {
          result.initializationRejection = String(error);
          if (kind !== "pipeline-rejection") { throw error; }
        }
        if (kind === "pipeline-rejection") { return result; }
        const scene = viewer.scene;
        const device = scene.context._device;
        const info = scene.context._adapter.info;
        result.adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
        window.__m1 = { adapterInfo: result.adapter };
        device.addEventListener("uncapturederror", (event) => result.gpuErrors.push(String(event.error)));
        const beforeInitialize = native();
        await Promise.all([renderer.initialize(), renderer.initialize()]);
        result.idempotentInitialization = { before: beforeInitialize, after: native() };
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
        scene.sun.show = true;
        scene.atmosphere.show = false;
        // Source in empty sky exercises the actual flare shaders without a terrain loading dependency.
        const sun = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime, new Cesium.Cartesian3());
        const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(viewer.clock.currentTime, new Cesium.Matrix3());
        Cesium.Matrix3.multiplyByVector(rotation, sun, sun);
        Cesium.Cartesian3.normalize(sun, sun);
        const position = Cesium.Cartesian3.multiplyByScalar(sun, 42000000, new Cesium.Cartesian3());
        const axis = Math.abs(sun.z) < 0.9 ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.UNIT_Y;
        const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(sun, axis, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const up = Cesium.Cartesian3.cross(right, sun, new Cesium.Cartesian3());
        viewer.camera.setView({ destination: position, orientation: { direction: sun, up } });
        viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(24), aspectRatio: 16 / 9, near: 0.1, far: 500000000 });
        for (const [width, height] of kind === "resize" ? [[1280, 720], [1920, 1080], [1280, 720]] : [[1280, 720]]) {
          container.style.width = `${width}px`; container.style.height = `${height}px`;
          viewer.resize(); viewer.render();
          await device.queue.onSubmittedWorkDone();
          const before = native();
          const startPasses = renderer.statistics.lensFlarePasses;
          for (let frame = 0; frame < 8; frame++) { viewer.resize(); viewer.render(); }
          await device.queue.onSubmittedWorkDone();
          result.captures.push({ size: [viewer.canvas.width, viewer.canvas.height], before, after: native(),
            lensFlarePasses: renderer.statistics.lensFlarePasses - startPasses, lensFlareTextureBytes: renderer.statistics.lensFlareTextureBytes });
        }
        result.asset = { loaded: renderer.statistics.solarAssetsLoaded, error: renderer._solarAssetError, records: renderer.solarAssetRecords };
        if (kind === "device-loss") {
          result.beforeLoss = native();
          device.destroy();
          const loss = await device.lost;
          result.deviceLoss = { reason: loss.reason, message: loss.message };
          await Promise.resolve();
          result.afterLoss = native();
          result.rendererDestroyedByLoss = renderer._destroyed;
          result.contextError = String(scene.context._error);
        }
      } catch (error) { result.failure = String(error); }
      finally {
        GPUDevice.prototype.createRenderPipelineAsync = originalPipeline;
        if (viewer) { viewer.destroy(); result.viewerDestroyed = viewer.isDestroyed(); }
        if (renderer) { renderer.destroy(); result.rendererAfterDestroy = { ...renderer.statistics }; }
        result.afterDestroy = native();
        result.allocations = window.__solarAllocations.slice(first);
        result.globalLiveAfterDestroy = window.__solarAllocations.filter((item) => !item.destroyed).length;
        container.remove();
      }
      return result;
    }, kind);
    if (kind === "asset-corrupt") { await page.unroute(asset); }
    report.cases.push(result);
    assert.equal(result.failure, undefined);
    assert.equal(result.viewerDestroyed, true);
    assert.equal(result.afterDestroy.live, 0);
    assert.equal(result.globalLiveAfterDestroy, result.priorLive);
    assert.ok(result.allocations.every((row) => row.destroyed && row.destroyCalls === 1));
    if (kind === "pipeline-rejection") {
      assert.match(result.initializationRejection, /Intentional M2.8 lens pipeline rejection/);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /Intentional M2.8 lens pipeline rejection/);
      continue;
    }
    assertPhysicalGpu(classifyGpu(result.adapter), getBrowserConfiguration());
    assert.deepEqual(result.idempotentInitialization.after, result.idempotentInitialization.before);
    assert.deepEqual(result.gpuErrors, []);
    for (const capture of result.captures) {
      assert.deepEqual(capture.after, capture.before, "Same-size resize and repeated rendering allocate nothing");
      assert.equal(capture.lensFlarePasses, 8);
      assert.equal(capture.lensFlareTextureBytes, 8);
    }
    if (kind === "device-loss") {
      assert.equal(result.deviceLoss.reason, "destroyed");
      assert.equal(result.rendererDestroyedByLoss, true);
      assert.equal(result.afterLoss.live, 0, "Loss callback releases all owned native resources");
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /WebGPU device lost/);
    } else { assert.deepEqual(result.errors, []); }
    if (kind === "asset-corrupt") { assert.equal(result.asset.loaded, false); assert.match(result.asset.error, /glow-gradient.*bytes; expected/); }
    else { assert.equal(result.asset.loaded, true); }
    if (kind === "resize") {
      for (const key of ["live", "textures", "buffers", "payloadBytes"]) {
        assert.equal(result.captures[0].after[key], result.captures[2].after[key], `Restored resolution has stable ${key}`);
      }
    }
  }
  assert.deepEqual(report.browserConsole, []);
  report.checks.push("Flare enabled during repeated initialization, resize, corrupt optional assets, real device loss, explicit recreate, and lens pipeline initialization rejection; no native resource retention.");
});
