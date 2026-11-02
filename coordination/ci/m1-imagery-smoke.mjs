/* global Cesium, window, document, requestAnimationFrame, createImageBitmap */
import assert from "node:assert/strict";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";

await runM1BrowserSuite("imagery", async ({ page, report, output }) => {
  await installM1Scene(page);
  report.provider = await page.evaluate(async () => {
    const layer = window.__m1.viewer.imageryLayers.get(0);
    while (!layer.ready) { await new Promise(requestAnimationFrame); }
    const provider = layer.imageryProvider;
    window.__m1.watchImagery(provider, "NaturalEarthII");
    return { nativeTms: provider instanceof Cesium.TileMapServiceImageryProvider,
      minimumLevel: provider.minimumLevel, maximumLevel: provider.maximumLevel,
      projection: provider.tilingScheme.projection.constructor.name };
  });
  assert.equal(report.provider.nativeTms, true);
  assert.equal(report.provider.maximumLevel, 2);
  for (const view of [
    { name: "natural-earth-orbit", longitude: 20, latitude: 20, height: 40000000 },
    { name: "natural-earth-dateline", longitude: 179.9, latitude: -20, height: 12000000 },
    { name: "natural-earth-close", longitude: 86.925, latitude: 27.988, height: 200000 },
  ]) {
    const settled = await page.evaluate((view) => window.__m1.settle({ ...view, imagery: true }), view);
    const result = await captureM1Scene(page, report, output, view.name, { view, settled });
    assert.ok(result.distinctSampledColors > 40, "Actual provider imagery must contain spatial variation");
    assert.ok(result.statistics.resources.imageryDrawCalls > 0);
  }
  report.naturalEarthRequests = await page.evaluate(() => window.__m1.imageryRequests);
  const levels = new Set(report.naturalEarthRequests.map((r) => r.level));
  assert.ok(levels.size > 1 && levels.has(2), "Native imagery LOD must request different provider levels");
  assert.ok(new Set(report.naturalEarthRequests.map((r) => `${r.level}/${r.x}/${r.y}`)).size > 4);
  report.checks.push("real tiled Natural Earth and dynamic native imagery LOD");

  await page.evaluate(() => {
    const state = window.__m1;
    state.diagnosticProvider = (mercator, color, rectangle, pending = false) => {
      const tilingScheme = mercator ? new Cesium.WebMercatorTilingScheme() : new Cesium.GeographicTilingScheme();
      const provider = {
        tilingScheme, rectangle: rectangle ?? tilingScheme.rectangle,
        tileWidth: 128, tileHeight: 128, minimumLevel: 0, maximumLevel: 5,
        tileDiscardPolicy: undefined, errorEvent: new Cesium.Event(), hasAlphaChannel: true,
        credit: new Cesium.Credit("M1 coordinate test fixture"),
        getTileCredits: () => [], pending: [],
        requestImage(x, y, level) {
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
          const context = canvas.getContext("2d");
          const pixels = context.createImageData(128, 128);
          const bounds = tilingScheme.tileXYToRectangle(x, y, level);
          const native = tilingScheme.tileXYToNativeRectangle(x, y, level);
          for (let row = 0; row < 128; ++row) {
            const v = 1 - (row + 0.5) / 128;
            const latitude = mercator ? Cesium.WebMercatorProjection.mercatorAngleToGeodeticLatitude(
              (native.south + v * native.height) / tilingScheme.ellipsoid.maximumRadius) : bounds.south + v * bounds.height;
            for (let column = 0; column < 128; ++column) {
              const longitude = bounds.west + (column + 0.5) / 128 * bounds.width;
              const rgb = color ?? [40 + 175 * (longitude + Math.PI) / (2 * Math.PI),
                30 + 195 * (latitude + Math.PI / 2) / Math.PI, 60];
              const offset = (row * 128 + column) * 4;
              pixels.data.set([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), 255], offset);
            }
          }
          context.putImageData(pixels, 0, 0);
          if (pending) { return new Promise((resolve) => this.pending.push(() => resolve(canvas))); }
          return mercator ? createImageBitmap(canvas, { imageOrientation: "flipY", premultiplyAlpha: "none" }) : Promise.resolve(canvas);
        },
      };
      state.watchImagery(provider, mercator ? "diagnostic-mercator" : "diagnostic-geographic");
      return provider;
    };
    state.checkCoordinates = (mercator) => {
      const { viewer } = state;
      const pixels = state.pixels();
      const errors = [];
      let checked = 0;
      let maximum = 0;
      for (let y = 60; y < pixels.height - 60; y += 40) {
        for (let x = 60; x < pixels.width - 60; x += 40) {
          const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(x + 0.5, y + 0.5));
          const hit = Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84);
          if (!hit) { continue; }
          const point = Cesium.Ray.getPoint(ray, hit.start);
          const coordinate = Cesium.Cartographic.fromCartesian(point);
          if (Math.abs(coordinate.latitude) > Cesium.Math.toRadians(87)) { continue; }
          const latitude = mercator ? Cesium.Math.clamp(coordinate.latitude,
            -Cesium.WebMercatorProjection.MaximumLatitude, Cesium.WebMercatorProjection.MaximumLatitude) : coordinate.latitude;
          const expected = [40 + 175 * (coordinate.longitude + Math.PI) / (2 * Math.PI),
            30 + 195 * (latitude + Math.PI / 2) / Math.PI, 60];
          const offset = (y * pixels.width + x) * 4;
          // Ignore the analytic silhouette's final two dark pixels; this gate
          // measures texture placement rather than coarse mesh limb coverage.
          if (pixels.data[offset + 2] < 50) { continue; }
          const delta = Math.max(...expected.map((value, c) => Math.abs(value - pixels.data[offset + c])));
          maximum = Math.max(maximum, delta); ++checked;
          if (delta > 5) { errors.push({ x, y, delta, expected, actual: Array.from(pixels.data.slice(offset, offset + 3)) }); }
        }
      }
      return { checked, maximum, errors: errors.slice(0, 12), failures: errors.length };
    };
  });

  for (const mercator of [false, true]) {
    const result = await page.evaluate(async (mercator) => {
      const state = window.__m1;
      state.viewer.imageryLayers.removeAll();
      const provider = state.diagnosticProvider(mercator);
      state.baseDiagnostic = state.viewer.imageryLayers.addImageryProvider(provider);
      const settled = await state.settle({ longitude: 30, latitude: mercator ? 74 : 40, height: 16000000, imagery: true });
      const modes = { geographic: 0, mercator: 0 };
      for (const { tile } of state.viewer.scene._renderer._draws) {
        for (const item of tile.data.imagery) { ++modes[item.useWebMercatorT ? "mercator" : "geographic"]; }
      }
      return { settled, modes, coordinates: state.checkCoordinates(mercator) };
    }, mercator);
    assert.ok(result.coordinates.checked > 70);
    assert.equal(result.coordinates.failures, 0, JSON.stringify(result.coordinates));
    if (mercator) {
      assert.ok(result.modes.geographic > 0,
        `Exercise polar reprojection: ${JSON.stringify(result.modes)}`);
    }
    await captureM1Scene(page, report, output, mercator ? "mercator-polar-coordinates" : "geographic-coordinates", result);
  }
  const nativeMercator = await page.evaluate(async () => {
    const state = window.__m1;
    await state.settle({ longitude: 30, latitude: 35, height: 4000000, imagery: true });
    let nativeAssociations = 0;
    for (const { tile } of state.viewer.scene._renderer._draws) {
      nativeAssociations += tile.data.imagery.filter((item) => item.useWebMercatorT).length;
    }
    const coordinates = state.checkCoordinates(true);
    const changed = [];
    for (const { tile } of state.viewer.scene._renderer._draws) {
      if (tile.data.mesh.encoding.hasWebMercatorT && !changed.includes(tile.data)) {
        const data = tile.data;
        changed.push(data);
        data.gpu.destroy();
        data.mesh.encoding.hasWebMercatorT = false;
        data.gpu = state.viewer.scene._renderer.createTile(data.mesh);
      }
    }
    const withoutOptionalAttribute = state.checkCoordinates(true);
    for (const data of changed) {
      data.gpu.destroy(); data.mesh.encoding.hasWebMercatorT = true;
      data.gpu = state.viewer.scene._renderer.createTile(data.mesh);
    }
    return { nativeAssociations, coordinates, withoutOptionalAttribute, replacedMeshes: changed.length };
  });
  report.nativeMercator = nativeMercator;
  assert.ok(nativeMercator.nativeAssociations > 0 && nativeMercator.replacedMeshes > 0);
  assert.equal(nativeMercator.coordinates.failures, 0, JSON.stringify(nativeMercator.coordinates));
  assert.equal(nativeMercator.withoutOptionalAttribute.failures, 0, JSON.stringify(nativeMercator.withoutOptionalAttribute));
  await captureM1Scene(page, report, output, "mercator-native-coordinates", nativeMercator);
  report.checks.push("geographic and Mercator placement, north/south orientation and polar reprojection");

  report.layers = await page.evaluate(async () => {
    const state = window.__m1;
    const layers = state.viewer.imageryLayers;
    await state.settle({ longitude: 30, latitude: 40, height: 16000000, imagery: true });
    const center = () => { const p = state.pixels(); const o = ((p.height >> 1) * p.width + (p.width >> 1)) * 4; return Array.from(p.data.slice(o, o + 3)); };
    const base = center();
    const before = state.pixels();
    const red = layers.addImageryProvider(state.diagnosticProvider(false, [240, 20, 10], Cesium.Rectangle.fromDegrees(-20, -80, 120, 80)));
    red.alpha = 0.5;
    await state.settle({ imagery: true });
    const half = center();
    const after = state.pixels();
    let overblendPixels = 0;
    for (let i = 2; i < before.data.length; i += 4) {
      // The diagnostic base has constant blue=60. One red alpha=0.5 pass
      // gives blue=35; outside its rectangle remains 60. Repeated alpha along
      // neighboring imagery associations produces a third value.
      if (before.data[i] >= 59 && before.data[i] <= 61 &&
          Math.abs(after.data[i] - 35) > 1 && Math.abs(after.data[i] - 60) > 1) {
        ++overblendPixels;
      }
    }
    let outsideChecked = 0; let outsideChanged = 0;
    for (let y = 80; y < before.height - 80; y += 32) {
      for (let x = 80; x < before.width - 80; x += 32) {
        const ray = state.viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
        const hit = Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84);
        if (!hit) { continue; }
        const c = Cesium.Cartographic.fromCartesian(Cesium.Ray.getPoint(ray, hit.start));
        if (c.longitude > Cesium.Math.toRadians(-22) && c.longitude < Cesium.Math.toRadians(122) && Math.abs(c.latitude) < Cesium.Math.toRadians(82)) { continue; }
        const o = (y * before.width + x) * 4;
        ++outsideChecked;
        if ([0, 1, 2].some((channel) => Math.abs(before.data[o + channel] - after.data[o + channel]) > 2)) { ++outsideChanged; }
      }
    }
    red.alpha = 0;
    await state.settle({ imagery: true }); const zero = center();
    red.alpha = 0.5; red.show = false;
    await state.settle({ imagery: true }); const hidden = center();
    red.show = true;
    await state.settle({ imagery: true }); const shown = center();
    const blue = layers.addImageryProvider(state.diagnosticProvider(false, [10, 40, 235]));
    await state.settle({ imagery: true }); const top = center();
    layers.lowerToBottom(blue);
    await state.settle({ imagery: true }); const bottom = center();
    layers.raiseToTop(blue);
    await state.settle({ imagery: true }); const raised = center();
    const created = state.viewer.scene.debugStatistics.imagery.texturesCreated;
    layers.remove(blue); layers.remove(red);
    await state.settle({ imagery: true }); const removed = center();
    const delayedProvider = state.diagnosticProvider(false, [255, 255, 255], undefined, true);
    const delayedLayer = layers.addImageryProvider(delayedProvider);
    for (let i = 0; i < 30 && delayedProvider.pending.length === 0; ++i) {
      state.viewer.render(); await new Promise(requestAnimationFrame);
    }
    const pending = delayedProvider.pending.length;
    const uploadsBefore = state.viewer.scene.debugStatistics.imagery.texturesCreated;
    layers.remove(delayedLayer);
    for (const complete of delayedProvider.pending) { complete(); }
    await state.settle({ imagery: true });
    return { base, half, zero, hidden, shown, top, bottom, raised, removed,
      outsideChecked, outsideChanged, overblendPixels, pending, uploadsBefore,
      uploadsAfter: state.viewer.scene.debugStatistics.imagery.texturesCreated,
      created, imagery: state.viewer.scene.debugStatistics.imagery };
  });
  const close = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 2);
  const layer = report.layers;
  assert.ok(close(layer.half, layer.base.map((value, i) => (value + [240, 20, 10][i]) / 2)), JSON.stringify(layer));
  for (const value of [layer.zero, layer.hidden, layer.removed]) { assert.ok(close(value, layer.base)); }
  for (const value of [layer.shown, layer.bottom]) { assert.ok(close(value, layer.half)); }
  for (const value of [layer.top, layer.raised]) { assert.ok(close(value, [10, 40, 235])); }
  assert.ok(layer.outsideChecked > 5);
  assert.equal(layer.outsideChanged, 0);
  assert.equal(layer.overblendPixels, 0, "Each imagery layer must blend once at shared image-tile boundaries");
  assert.ok(layer.pending > 0);
  assert.equal(layer.uploadsAfter, layer.uploadsBefore, "Removed late imagery cannot upload a GPU texture");
  assert.ok(layer.imagery.texturesDestroyed > 0);
  report.checks.push("layer rectangle, alpha, show, ordering and removal", "late imagery cancellation and texture release");
  report.providerErrors = await page.evaluate(() => window.__m1.providerErrors);
  assert.deepEqual(report.providerErrors, []);
  report.destroy = await destroyM1Scene(page);
  report.checks.push("balanced GPU buffer/texture lifetimes");
});
