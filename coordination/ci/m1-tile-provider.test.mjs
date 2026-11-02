import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Cartesian3, Event } from "@cesium/core";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";
import ImageryLayerCollection from "../../packages/engine/Source/Scene/ImageryLayerCollection.js";
import QuadtreeTile from "../../packages/engine/Source/Scene/QuadtreeTile.js";
import QuadtreePrimitive from "../../packages/engine/Source/Scene/QuadtreePrimitive.js";
import WebGPUGlobeTileProvider from "../../packages/engine/Source/Scene/WebGPUGlobeTileProvider.js";

const frame = {
  verticalExaggeration: 1,
  verticalExaggerationRelativeHeight: 0,
};
function fixture(requestTileGeometry) {
  const terrainProvider = {
    tilingScheme: new GeographicTilingScheme(),
    errorEvent: new Event(),
    requestTileGeometry,
    getTileDataAvailable: () => true,
    getLevelMaximumGeometricError: (level) => 1000 / 2 ** level,
  };
  const counters = { uploaded: 0, destroyed: 0 };
  const renderer = {
    createTile: () => {
      ++counters.uploaded;
      return { destroy: () => ++counters.destroyed };
    },
    addTile() {},
  };
  const globe = {
    terrainProvider,
    imageryLayers: new ImageryLayerCollection(),
    _surfaceShaderSet: {},
    vectorProvider: {},
  };
  const provider = new WebGPUGlobeTileProvider({ globe, renderer });
  const quadtree = new QuadtreePrimitive({ tileProvider: provider });
  const tile = new QuadtreeTile({
    tilingScheme: terrainProvider.tilingScheme,
    x: 0,
    y: 0,
    level: 0,
  });
  return { provider, terrainProvider, tile, counters, quadtree };
}
const mesh = { center: new Cartesian3(1, 2, 3) };
const terrain = (createMesh = () => Promise.resolve(mesh)) => ({
  createMesh,
  wasCreatedByUpsampling: () => false,
  isChildAvailable: () => true,
});

test("deferred provider requests retry and native mesh deferral does not mark a tile ready", async () => {
  let requests = 0;
  let transforms = 0;
  const data = terrain(() =>
    ++transforms === 1 ? undefined : Promise.resolve(mesh),
  );
  const f = fixture(() =>
    ++requests === 1 ? undefined : Promise.resolve(data),
  );
  f.provider.loadTile(frame, f.tile);
  assert.equal(f.tile.renderable, false);
  f.provider.loadTile(frame, f.tile);
  await setImmediate();
  f.provider.loadTile(frame, f.tile);
  assert.equal(f.counters.uploaded, 0);
  f.provider.loadTile(frame, f.tile);
  await setImmediate();
  f.provider.loadTile(frame, f.tile);
  assert.equal(f.counters.uploaded, 1);
  assert.equal(f.tile.renderable, true);
  assert.equal(f.tile.data.renderedMesh, mesh);
  assert.equal(requests, 2);
  f.provider.destroy();
  assert.equal(f.counters.destroyed, 1);
});

test("destroy cancels pending terrain and ignores late completion", async () => {
  let resolve;
  let request;
  const f = fixture((...args) => {
    request = args[3];
    return new Promise((done) => {
      resolve = done;
    });
  });
  f.provider.loadTile(frame, f.tile);
  f.provider.destroy();
  assert.equal(request.cancelled, true);
  resolve(terrain());
  await setImmediate();
  assert.equal(f.counters.uploaded, 0);
  assert.equal(f.tile.data.terrainData, undefined);
});

test("unavailable child uses the native parent upsampler and retains its child coordinates", async () => {
  const calls = [];
  const f = fixture(() => {
    throw new Error("Unavailable terrain must not be requested");
  });
  const parent = f.provider._ensureTile(f.tile);
  parent.mesh = mesh;
  parent.terrainData = {
    ...terrain(),
    upsample: (...args) => {
      calls.push(args);
      return Promise.resolve({
        ...terrain(),
        wasCreatedByUpsampling: () => true,
      });
    },
  };
  f.terrainProvider.getTileDataAvailable = () => false;
  const child = f.tile.northeastChild;
  f.provider.loadTile(frame, child);
  await setImmediate();
  f.provider.loadTile(frame, child);
  await setImmediate();
  f.provider.loadTile(frame, child);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [0, 0, 0, 1, 0, 1]);
  assert.equal(child.upsampledFromParent, true);
  assert.equal(child.renderable, true);
  child.data.imagery.push({ readyImagery: {}, freeResources() {} });
  f.provider.loadTile(frame, child);
  assert.equal(child.upsampledFromParent, false,
    "Independent imagery must allow native quadtree refinement over upsampled terrain");
  f.provider.destroy();
});

test("eviction frees GPU ownership once and a revisited tile gets a fresh generation", async () => {
  const f = fixture(() => Promise.resolve(terrain()));
  for (let i = 0; i < 3; ++i) {
    f.provider.loadTile(frame, f.tile);
    await setImmediate();
  }
  const oldData = f.tile.data;
  f.tile.freeResources();
  f.tile.freeResources();
  assert.equal(f.counters.destroyed, 1);
  for (let i = 0; i < 3; ++i) {
    f.provider.loadTile(frame, f.tile);
    await setImmediate();
  }
  assert.notEqual(f.tile.data, oldData);
  assert.equal(f.counters.uploaded, 2);
  assert.equal(f.tile.renderable, true);
  f.provider.destroy();
  assert.equal(f.counters.destroyed, 2);
});

for (const outcome of ["resolve", "reject"]) {
  test(`provider replacement cancels old terrain immediately before late ${outcome}`, async () => {
    let resolve;
    let reject;
    let request;
    const f = fixture((...args) => {
      request = args[3];
      return new Promise((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
    });
    const fatal = [];
    f.provider.errorEvent.addEventListener((error) => fatal.push(error));
    f.provider.loadTile(frame, f.tile);
    const oldData = f.tile.data;
    const next = {
      ...f.terrainProvider,
      errorEvent: new Event(),
      requestTileGeometry: () => Promise.resolve(terrain()),
    };
    f.provider.terrainProvider = next;
    assert.equal(request.cancelled, true);
    assert.equal(oldData.released, true);
    if (outcome === "resolve") {
      resolve(terrain());
    } else {
      reject(new Error("old provider failed"));
    }
    await setImmediate();
    assert.deepEqual(fatal, []);
    assert.equal(f.counters.uploaded, 0);
    for (let i = 0; i < 3; ++i) {
      f.provider.loadTile(frame, f.tile);
      await setImmediate();
    }
    assert.equal(f.tile.renderable, true);
    assert.equal(f.counters.uploaded, 1);
    f.provider.destroy();
  });
}
