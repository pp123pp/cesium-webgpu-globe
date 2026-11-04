/* global window, document, Cesium, performance, requestAnimationFrame */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "./m2.6.1-b4-fixtures.mjs";
import { assertPhysicalGpu, classifyGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";

export async function runB5CLifecycle(page, report, output) {
  report.lifecycle = [];
  await mkdir(path.join(output, "lifecycle"), { recursive: true });
  for (let cycle = 0; cycle < 3; cycle++) {
    const row = await page.evaluate(async (cycle) => {
      const allocations = window.__solarAllocations;
      if (!allocations) { throw new Error("Install trackSolarAllocations before creating Viewers"); }
      const firstAllocation = allocations.length;
      const priorLive = allocations.filter((item) => !item.destroyed).length;
      const container = document.createElement("div");
      Object.assign(container.style, { position: "absolute", left: "0", top: "0", width: "1920px", height: "1080px" });
      document.body.appendChild(container);
      class BoundedEllipsoidTerrainProvider extends Cesium.EllipsoidTerrainProvider {
        getLevelMaximumGeometricError(level) { return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level); }
      }
      const viewer = new Cesium.Viewer(container, { renderingBackend: "webgpu", useDefaultRenderLoop: false,
        baseLayer: false, skyBox: false, skyAtmosphere: false, terrainProvider: new BoundedEllipsoidTerrainProvider() });
      const result = { cycle, captures: [], errors: [], gpuErrors: [], priorLive,
        fixture: { maximumLevel: 8, provider: "native ellipsoid", externalProviders: false, probes: false } };
      viewer.renderError.addEventListener((...args) => result.errors.push(String(args[1])));
      let renderer;
      const native = () => {
        const rows = allocations.slice(firstAllocation);
        const live = rows.filter((item) => !item.destroyed);
        return { created: rows.length, destroyed: rows.length - live.length, live: live.length,
          buffers: live.filter((item) => item.kind === "Buffer").length,
          textures: live.filter((item) => item.kind === "Texture").length,
          logicalBytes: live.reduce((sum, item) => sum + item.bytes, 0) };
      };
      try {
        await viewer.readyPromise;
        const scene = viewer.scene;
        renderer = scene._atmosphere;
        const device = scene.context._device;
        const info = scene.context._adapter.info;
        result.adapter = { vendor: info.vendor, architecture: info.architecture,
          device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
        device.addEventListener("uncapturederror", (event) => result.gpuErrors.push(String(event.error)));
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000),
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
        scene.globe.maximumScreenSpaceError = 3;
        scene.globe.enableLighting = true;
        scene.exposure = 1;
        scene.sun.show = true;
        scene.atmosphere.show = true;
        renderer.bloomStrength = 0.35;
        result.effects = { ...renderer.solarEffects };
        for (const [width, height] of [[1920, 1080], [1280, 720], [1920, 1080]]) {
          container.style.width = `${width}px`; container.style.height = `${height}px`;
          viewer.resize();
          viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(60),
            aspectRatio: width / height, near: 0.1, far: 500000000 });
          let stable = 0, lastKey = "";
          const start = performance.now();
          // Terrain loading does not need the expensive solar/atmosphere passes.
          scene.atmosphere.show = false; scene.sun.show = false; renderer.bloomStrength = 0;
          try {
            while (stable < 4 && performance.now() - start < 60000) {
              viewer.render();
              const key = scene._renderer._draws.map(({ tile }) => `${tile.level}/${tile.x}/${tile.y}`).sort().join("|");
              const ready = scene.globe.tilesLoaded && key.length > 0 && renderer.statistics.solarAssetsLoaded;
              stable = ready && key === lastKey ? stable + 1 : 0;
              lastKey = key;
              await new Promise(requestAnimationFrame);
            }
          } finally { scene.atmosphere.show = true; scene.sun.show = true; renderer.bloomStrength = 0.35; }
          if (stable < 4) { throw new Error("Lifecycle native terrain/assets did not settle"); }
          for (let frame = 0; frame < 4; frame++) { viewer.render(); await new Promise(requestAnimationFrame); }
          await device.queue.onSubmittedWorkDone();
          const before = native();
          for (let frame = 0; frame < 16; frame++) {
            viewer.resize();
            viewer.render();
            await new Promise(requestAnimationFrame);
          }
          await device.queue.onSubmittedWorkDone();
          const after = native();
          viewer.render();
          const image = document.createElement("canvas"); image.width = viewer.canvas.width; image.height = viewer.canvas.height;
          const context = image.getContext("2d", { willReadFrequently: true });
          context.drawImage(viewer.canvas, 0, 0);
          const png = image.toDataURL("image/png").split(",")[1];
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          const colors = new Set();
          for (let offset = 0; offset < pixels.length; offset += 4 * 137) {
            colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
          }
          result.captures.push({ intended: [width, height], canvas: [image.width, image.height], png,
            nativeBeforeRepeatedRendering: before, nativeAfterRepeatedRendering: after,
            rendererStatistics: { ...renderer.statistics }, selectedLevels: scene._renderer._draws.map(({ tile }) => tile.level),
            assetRecords: renderer.solarAssetRecords, bloomStrength: renderer.bloomStrength,
            solarEffects: { ...renderer.solarEffects }, sampledColors: colors.size });
        }
        result.beforeDestroy = native();
        result.rendererBeforeDestroy = { ...renderer.statistics };
        await device.queue.onSubmittedWorkDone();
      } catch (error) { result.failure = String(error); }
      finally {
        viewer.destroy();
        result.viewerDestroyed = viewer.isDestroyed();
        if (renderer) { result.rendererAfterDestroy = { ...renderer.statistics }; renderer.destroy(); }
        result.afterDestroy = native();
        result.allocations = allocations.slice(firstAllocation);
        result.globalLiveAfterDestroy = allocations.filter((item) => !item.destroyed).length;
        container.remove();
      }
      return result;
    }, cycle);
    for (let index = 0; index < row.captures.length; index++) {
      const capture = row.captures[index];
      const png = Buffer.from(capture.png, "base64"); delete capture.png;
      capture.filename = `lifecycle/cycle-${cycle}-resize-${index}.png`;
      capture.sha256 = hash(png);
      await writeFile(path.join(output, capture.filename), png);
    }
    report.lifecycle.push(row);
    await writeFile(path.join(output, "lifecycle", "result.json"), JSON.stringify(report.lifecycle, null, 2));
    assert.equal(row.failure, undefined);
    assertPhysicalGpu(classifyGpu(row.adapter), getBrowserConfiguration());
    assert.deepEqual(row.errors, []); assert.deepEqual(row.gpuErrors, []);
    assert.equal(row.captures.length, 3);
    for (const capture of row.captures) {
      assert.deepEqual(capture.canvas, capture.intended);
      assert.deepEqual(capture.nativeAfterRepeatedRendering, capture.nativeBeforeRepeatedRendering,
        "Repeated render and same-size resize must not allocate or retain resources");
      assert.ok(capture.selectedLevels.length > 0 && capture.selectedLevels.every((level) => level <= 8));
      assert.ok(capture.assetRecords.length > 0 && capture.assetRecords.every((asset) => asset.status === "LOADED"));
      assert.equal(capture.bloomStrength, 0.35);
      assert.ok(Object.values(capture.solarEffects).every((value) => value > 0));
      assert.ok(capture.sampledColors > 4, "Lifecycle capture contains rendered scene output");
    }
    const first = row.captures[0].nativeAfterRepeatedRendering;
    const restored = row.captures[2].nativeAfterRepeatedRendering;
    for (const key of ["live", "buffers", "textures", "logicalBytes"]) {
      assert.equal(restored[key], first[key], `Restored resolution retains same native ${key}`);
    }
    assert.equal(row.viewerDestroyed, true);
    assert.ok(row.allocations.length > 0);
    assert.equal(row.afterDestroy.live, 0, "All cycle native buffers/textures explicitly destroyed");
    assert.ok(row.allocations.every((item) => item.destroyed && item.destroyCalls === 1));
    assert.equal(row.globalLiveAfterDestroy, row.priorLive, "Cycles do not grow retained native resources");
  }
  report.checks.push("Three create/render/resize/destroy cycles: stable native buffer/texture counts, all owned allocations destroyed once, no retained growth.");
}
