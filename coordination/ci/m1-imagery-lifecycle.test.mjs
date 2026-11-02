// CPU imagery/provider lifecycle checks. Only the GPU upload boundary is fake.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Cartesian4, Event, WebMercatorProjection } from "@cesium/core";
import EllipsoidTerrainProvider from "../../packages/engine/Source/Core/EllipsoidTerrainProvider.js";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";
import RequestType from "../../packages/engine/Source/Core/RequestType.js";
import WebMercatorTilingScheme from "../../packages/engine/Source/Core/WebMercatorTilingScheme.js";
import Imagery from "../../packages/engine/Source/Scene/Imagery.js";
import ImageryLayer from "../../packages/engine/Source/Scene/ImageryLayer.js";
import ImageryLayerCollection from "../../packages/engine/Source/Scene/ImageryLayerCollection.js";
import ImageryState from "../../packages/engine/Source/Scene/ImageryState.js";
import QuadtreePrimitive from "../../packages/engine/Source/Scene/QuadtreePrimitive.js";
import QuadtreeTile from "../../packages/engine/Source/Scene/QuadtreeTile.js";
import QuadtreeTileLoadState from "../../packages/engine/Source/Scene/QuadtreeTileLoadState.js";
import TerrainState from "../../packages/engine/Source/Scene/TerrainState.js";
import TileImagery from "../../packages/engine/Source/Scene/TileImagery.js";
import WebGPUGlobeTileProvider from "../../packages/engine/Source/Scene/WebGPUGlobeTileProvider.js";
import WebGPUImagery from "../../packages/engine/Source/Scene/WebGPUImagery.js";

const frame = {};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function bitmap(name = "image") {
  return {
    name,
    width: 256,
    height: 256,
    closed: 0,
    close() {
      ++this.closed;
    },
  };
}

function imageProvider(requestImage, options = {}) {
  const tilingScheme = options.tilingScheme ?? new GeographicTilingScheme();
  return {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: 256,
    tileHeight: 256,
    minimumLevel: 0,
    maximumLevel: 0,
    hasAlphaChannel: true,
    errorEvent: new Event(),
    requestImage,
    ...options,
  };
}

function fixture(t) {
  const terrainProvider = new EllipsoidTerrainProvider();
  const layers = new ImageryLayerCollection();
  const uploads = [];
  const renderer = {
    createImageryTexture(image) {
      const resource = {
        image,
        texture: {},
        view: {},
        width: image.width,
        height: image.height,
        destroyed: 0,
        destroy() {
          ++this.destroyed;
        },
      };
      uploads.push(resource);
      return resource;
    },
  };
  const adapter = new WebGPUGlobeTileProvider({
    globe: {
      terrainProvider,
      imageryLayers: layers,
      _surfaceShaderSet: {},
      vectorProvider: {},
    },
    renderer,
  });
  const quadtree = new QuadtreePrimitive({ tileProvider: adapter });
  const imagery = new WebGPUImagery(adapter, renderer);
  adapter._imagery = imagery;
  t.after(() => {
    if (!adapter.isDestroyed()) {
      adapter.destroy();
    }
    layers.destroy();
  });
  return {
    adapter,
    imagery,
    layers,
    renderer,
    uploads,
    addLayer(provider) {
      const layer = new ImageryLayer(provider);
      layers.add(layer);
      return layer;
    },
    tile(x = 0, y = 0, level = 0) {
      const tile = new QuadtreeTile({
        tilingScheme: terrainProvider.tilingScheme,
        x,
        y,
        level,
      });
      adapter._ensureTile(tile);
      tile.state = QuadtreeTileLoadState.LOADING;
      quadtree._tileReplacementQueue.markTileRendered(tile);
      return tile;
    },
  };
}

async function settle(f, tile, count = 4) {
  let complete = false;
  for (let i = 0; i < count; ++i) {
    complete = f.imagery.updateTile(tile, frame);
    await setImmediate();
  }
  return complete;
}

test("deferred requests retry with native scheduling and produce one credited texture", async (t) => {
  const f = fixture(t);
  const image = bitmap();
  const requests = [];
  const credit = { html: "tile credit" };
  f.addLayer(
    imageProvider(
      (x, y, level, request) => {
        requests.push({ x, y, level, request });
        return requests.length === 1 ? undefined : Promise.resolve(image);
      },
      { getTileCredits: () => [credit] },
    ),
  );
  const tile = f.tile();
  assert.equal(f.imagery.updateTile(tile, frame), false);
  assert.equal(f.imagery.statistics.deferred, 1);
  assert.equal(f.imagery.updateTile(tile, frame), false);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ x, y, level }) => [x, y, level]),
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  );
  const request = requests[1].request;
  assert.equal(request.type, RequestType.IMAGERY);
  assert.equal(request.throttle, false);
  assert.equal(request.throttleByServer, true);
  await setImmediate();
  assert.equal(f.imagery.updateTile(tile, frame), true);
  const ready = tile.data.imagery[0].readyImagery;
  assert.equal(ready.texture, f.uploads[0]);
  assert.equal(ready.textureWebMercator, ready.texture);
  assert.deepEqual(ready.credits, [credit]);
  assert.equal(image.closed, 1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.imagery.statistics.pendingRequests, 0);
});

test("native skeletons added while terrain loads are reused without duplicate references", async (t) => {
  const f = fixture(t);
  const tile = f.tile();
  f.addLayer(imageProvider(() => Promise.resolve(bitmap())));
  const original = tile.data.imagery[0];
  assert.ok(original instanceof TileImagery);
  assert.equal(await settle(f, tile), true);
  assert.equal(tile.data.imagery.length, 1);
  assert.equal(tile.data.imagery[0], original);
  assert.equal(original.readyImagery.referenceCount, 1);
  assert.equal(f.uploads.length, 1);
});

test("initializing missing layers preserves their collection order around pre-existing skeletons", async (t) => {
  const f = fixture(t);
  const first = f.addLayer(
    imageProvider(() => Promise.resolve(bitmap("bottom"))),
  );
  const tile = f.tile();
  const second = f.addLayer(
    imageProvider(() => Promise.resolve(bitmap("top"))),
  );
  assert.equal(tile.data.imagery.length, 1);
  assert.equal(await settle(f, tile), true);
  assert.deepEqual(
    tile.data.imagery.map(
      (association) => association.readyImagery.imageryLayer,
    ),
    [first, second],
  );
});

test("failed child imagery advances the native parent fallback and its mapping", async (t) => {
  const f = fixture(t);
  const requested = [];
  const provider = imageProvider(
    (x, y, level) => {
      requested.push([x, y, level]);
      return level === 1
        ? Promise.reject(new Error("child unavailable"))
        : Promise.resolve(bitmap("parent"));
    },
    { minimumLevel: 1, maximumLevel: 1 },
  );
  const errors = [];
  provider.errorEvent.addEventListener((error) => errors.push(error));
  f.addLayer(provider);
  const tile = f.tile(0, 0, 1);
  assert.equal(await settle(f, tile, 6), true);
  const association = tile.data.imagery[0];
  assert.deepEqual(requested, [
    [0, 0, 1],
    [0, 0, 0],
  ]);
  assert.equal(errors.length, 1);
  assert.equal(association.loadingImagery.state, ImageryState.FAILED);
  assert.equal(association.readyImagery.level, 0);
  assert.equal(association.readyImagery.texture.image.name, "parent");
  assert.deepEqual(
    association.textureTranslationAndScale,
    new Cartesian4(0, 0.5, 0.5, 0.5),
  );
});

test("an asynchronous layer replaces its placeholder with real native skeletons", async (t) => {
  const f = fixture(t);
  const ready = deferred();
  const layer = ImageryLayer.fromProviderAsync(ready.promise);
  f.layers.add(layer);
  const tile = f.tile();
  assert.equal(f.imagery.updateTile(tile, frame), false);
  assert.equal(tile.data.imagery.length, 1);
  const placeholder = tile.data.imagery[0];
  assert.equal(placeholder.loadingImagery.state, ImageryState.PLACEHOLDER);
  ready.resolve(imageProvider(() => Promise.resolve(bitmap())));
  await setImmediate();
  assert.equal(await settle(f, tile), true);
  assert.equal(tile.data.imagery.length, 1);
  assert.notEqual(tile.data.imagery[0], placeholder);
  assert.equal(placeholder.loadingImagery.referenceCount, 1);
  assert.equal(f.uploads.length, 1);
});

test("discard policy waits for readiness and closes a discarded image without uploading", async (t) => {
  const f = fixture(t);
  let ready = false;
  const image = bitmap();
  f.addLayer(
    imageProvider(() => Promise.resolve(image), {
      tileDiscardPolicy: {
        isReady: () => ready,
        shouldDiscardImage: (candidate) => candidate === image,
      },
    }),
  );
  const tile = f.tile();
  assert.equal(await settle(f, tile), false);
  assert.equal(f.uploads.length, 0);
  assert.equal(image.closed, 0);
  ready = true;
  assert.equal(f.imagery.updateTile(tile, frame), true);
  assert.equal(tile.data.imagery[0].loadingImagery.state, ImageryState.INVALID);
  assert.equal(f.uploads.length, 0);
  assert.equal(image.closed, 1);
  assert.equal(f.imagery.statistics.discarded, 1);
});

test("provider errors honor TileProviderError retries for synchronous and asynchronous failures", async (t) => {
  const f = fixture(t);
  let calls = 0;
  const provider = imageProvider(() => {
    ++calls;
    if (calls === 1) {
      throw new Error("synchronous failure");
    }
    if (calls === 2) {
      return Promise.reject(new Error("asynchronous failure"));
    }
    return Promise.resolve(bitmap());
  });
  const errors = [];
  provider.errorEvent.addEventListener((error) => {
    errors.push([
      error.provider,
      error.x,
      error.y,
      error.level,
      error.timesRetried,
    ]);
    error.retry = true;
  });
  f.addLayer(provider);
  const tile = f.tile();
  assert.equal(await settle(f, tile, 6), true);
  assert.deepEqual(errors, [
    [provider, 0, 0, 0, 0],
    [provider, 0, 0, 0, 1],
  ]);
  assert.equal(calls, 3);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.imagery.statistics.failed, 2);
});

test("a canceled live imagery request retries without reporting a provider failure", async (t) => {
  const f = fixture(t);
  const pending = deferred();
  const requests = [];
  const provider = imageProvider((...args) => {
    requests.push(args[3]);
    return requests.length === 1 ? pending.promise : Promise.resolve(bitmap());
  });
  const errors = [];
  provider.errorEvent.addEventListener((error) => errors.push(error));
  f.addLayer(provider);
  const tile = f.tile();
  f.imagery.updateTile(tile, frame);
  requests[0].cancel();
  pending.reject(new Error("request canceled"));
  await setImmediate();
  assert.equal(await settle(f, tile), true);
  assert.equal(errors.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.imagery.statistics.pendingRequests, 0);
});

test("an upload failure closes the image and reports failure through the native provider event", async (t) => {
  const f = fixture(t);
  const image = bitmap();
  const uploadError = new Error("GPU upload failed");
  f.renderer.createImageryTexture = () => {
    throw uploadError;
  };
  const provider = imageProvider(() => Promise.resolve(image));
  const errors = [];
  provider.errorEvent.addEventListener((error) => errors.push(error));
  f.addLayer(provider);
  const tile = f.tile();
  assert.equal(await settle(f, tile), true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].provider, provider);
  assert.equal(errors[0].error, uploadError);
  assert.equal(tile.data.imagery[0].loadingImagery.state, ImageryState.FAILED);
  assert.equal(image.closed, 1);
  assert.equal(f.imagery.statistics.activeTextures, 0);
});

for (const failureStage of ["request", "upload"]) {
  for (const mutation of [
    "remove layer",
    "replace terrain",
    "destroy adapter",
  ]) {
    test(`${failureStage} error callback can ${mutation} while a READY terrain tile advances native imagery`, async (t) => {
      const f = fixture(t);
      const failure = new Error(`${failureStage} outage`);
      const image = bitmap("callback-owned image");
      const provider = imageProvider(
        () => {
          if (failureStage === "request") {
            throw failure;
          }
          return Promise.resolve(image);
        },
        { maximumLevel: 4 },
      );
      if (failureStage === "upload") {
        f.renderer.createImageryTexture = () => {
          throw failure;
        };
      }
      const layer = f.addLayer(provider);

      // Keep a real parent chain and replacement queue so native collection
      // callbacks and provider invalidation own this tile exactly as in a tree.
      const root = f.tile();
      f.adapter.quadtree._levelZeroTiles = [root];
      let tile = root;
      for (let level = 0; level < 4; ++level) {
        tile = tile.northwestChild;
      }
      const data = f.adapter._ensureTile(tile);
      tile.state = QuadtreeTileLoadState.LOADING;
      f.adapter.quadtree._tileReplacementQueue.markTileRendered(tile);
      data.terrainData = await f.adapter.terrainProvider.requestTileGeometry(
        tile.x,
        tile.y,
        tile.level,
      );
      data.terrainState = TerrainState.READY;
      let destroyedTerrain = 0;
      data.gpu = { destroy: () => ++destroyedTerrain };
      const reported = [];
      const replacement = new EllipsoidTerrainProvider();
      provider.errorEvent.addEventListener((error) => {
        reported.push(error.error);
        if (mutation === "remove layer") {
          f.layers.remove(layer);
        } else if (mutation === "replace terrain") {
          f.adapter.terrainProvider = replacement;
        } else {
          f.adapter.destroy();
        }
      });

      if (failureStage === "upload") {
        f.adapter.loadTile(frame, tile);
        await setImmediate();
        assert.equal(
          tile.data.imagery[0].loadingImagery.state,
          ImageryState.RECEIVED,
        );
      }
      assert.doesNotThrow(() => f.adapter.loadTile(frame, tile));
      await setImmediate();
      assert.deepEqual(reported, [failure]);
      assert.equal(f.imagery.statistics.pendingRequests, 0);
      assert.equal(f.imagery.statistics.activeTextures, 0);
      assert.equal(image.closed, failureStage === "upload" ? 1 : 0);
      assert.equal(f.uploads.length, 0);

      if (mutation === "remove layer") {
        assert.equal(layer.isDestroyed(), true);
        assert.equal(data.released, false);
        assert.equal(data.imagery.length, 0);
        assert.equal(destroyedTerrain, 0);
        assert.doesNotThrow(() => f.adapter.loadTile(frame, tile));
        assert.equal(tile.state, QuadtreeTileLoadState.DONE);
        assert.equal(tile.renderable, true);
      } else {
        assert.equal(data.released, true);
        assert.equal(data.terrainData, undefined);
        assert.equal(data.gpu, undefined);
        assert.equal(destroyedTerrain, 1);
        assert.equal(
          tile.renderable,
          false,
          "Released data cannot be republished as renderable",
        );
        assert.notEqual(tile.state, QuadtreeTileLoadState.DONE);
        if (mutation === "replace terrain") {
          assert.equal(f.adapter.terrainProvider, replacement);
        } else {
          assert.equal(f.adapter.isDestroyed(), true);
        }
      }
    });
  }
}

for (const teardown of ["tile", "layer", "provider", "manager"]) {
  for (const completion of ["resolve", "reject"]) {
    test(`${teardown} teardown cancels imagery and ignores late ${completion}`, async (t) => {
      const f = fixture(t);
      const pending = deferred();
      const image = bitmap("late");
      let request;
      const provider = imageProvider((...args) => {
        request = args[3];
        return pending.promise;
      });
      const errors = [];
      provider.errorEvent.addEventListener((error) => errors.push(error));
      const layer = f.addLayer(provider);
      const tile = f.tile();
      f.imagery.updateTile(tile, frame);
      assert.ok(request, "the provider request started");
      if (teardown === "tile") {
        tile.freeResources();
      } else if (teardown === "layer") {
        f.layers.remove(layer);
      } else if (teardown === "provider") {
        f.adapter.destroy();
      } else {
        f.imagery.destroy();
      }
      assert.equal(request.cancelled, true);
      if (completion === "resolve") {
        pending.resolve(image);
      } else {
        pending.reject(new Error("late request failure"));
      }
      await setImmediate();
      assert.equal(f.uploads.length, 0);
      assert.equal(errors.length, 0);
      assert.equal(image.closed, completion === "resolve" ? 1 : 0);
      assert.equal(f.imagery.statistics.pendingRequests, 0);
    });
  }
}

test("shared native imagery uploads once and survives until its final tile reference is released", async (t) => {
  const f = fixture(t);
  let requests = 0;
  f.addLayer(
    imageProvider(() => {
      ++requests;
      return Promise.resolve(bitmap());
    }),
  );
  const first = f.tile(0, 0, 1);
  const second = f.tile(1, 0, 1);
  f.imagery.updateTile(first, frame);
  f.imagery.updateTile(second, frame);
  await setImmediate();
  assert.equal(f.imagery.updateTile(first, frame), true);
  assert.equal(f.imagery.updateTile(second, frame), true);
  assert.equal(requests, 1);
  assert.equal(f.uploads.length, 1);
  const shared = first.data.imagery[0].readyImagery;
  assert.equal(second.data.imagery[0].readyImagery, shared);
  assert.equal(shared.referenceCount, 2);
  first.freeResources();
  assert.equal(f.uploads[0].destroyed, 0);
  second.freeResources();
  assert.equal(f.imagery._records.size, 0);
  assert.deepEqual(Object.keys(f.layers.get(0)._imageryCache), []);
  f.imagery.destroy();
  f.imagery.destroy();
  assert.equal(f.uploads[0].destroyed, 1);
  assert.equal(f.imagery.statistics.texturesCreated, 1);
  assert.equal(f.imagery.statistics.texturesDestroyed, 1);
  assert.equal(f.imagery.statistics.activeTextures, 0);
});

test("polar Mercator imagery keeps its native texture despite geographic skeleton coordinates", async (t) => {
  const f = fixture(t);
  const provider = imageProvider(() => Promise.resolve(bitmap()), {
    tilingScheme: new WebMercatorTilingScheme(),
  });
  f.addLayer(provider);
  const tile = f.tile();
  assert.equal(await settle(f, tile), true);
  const association = tile.data.imagery[0];
  assert.equal(association.useWebMercatorT, false);
  assert.ok(provider.tilingScheme.projection instanceof WebMercatorProjection);
  assert.equal(association.readyImagery.texture, f.uploads[0]);
  assert.equal(association.readyImagery.textureWebMercator, f.uploads[0]);
});

test("WebGPU imagery adaptation leaves the native imagery and tile-imagery prototypes untouched", async (t) => {
  const processImagery = Imagery.prototype.processStateMachine;
  const releaseImagery = Imagery.prototype.releaseReference;
  const processTile = TileImagery.prototype.processStateMachine;
  const f = fixture(t);
  f.addLayer(imageProvider(() => Promise.resolve(bitmap())));
  const tile = f.tile();
  assert.equal(await settle(f, tile), true);
  assert.equal(Imagery.prototype.processStateMachine, processImagery);
  assert.equal(Imagery.prototype.releaseReference, releaseImagery);
  assert.equal(TileImagery.prototype.processStateMachine, processTile);
});
