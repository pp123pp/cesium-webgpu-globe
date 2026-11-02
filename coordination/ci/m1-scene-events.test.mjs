// CPU orchestration regression: native scene methods, camera, frustum, Globe,
// quadtree invalidation, tile lifetime and renderer draws. Only ready terrain
// input, traversal of two prepared regions and the GPU pass are test fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoundingSphere,
  Cartesian3,
  Color,
  Ellipsoid,
  Event,
  GeographicProjection,
  Intersect,
  JulianDate,
} from "@cesium/core";
import EllipsoidTerrainProvider from "../../packages/engine/Source/Core/EllipsoidTerrainProvider.js";
import Camera from "../../packages/engine/Source/Scene/Camera.js";
import FrameState from "../../packages/engine/Source/Scene/FrameState.js";
import Globe from "../../packages/engine/Source/Scene/Globe.js";
import QuadtreePrimitive from "../../packages/engine/Source/Scene/QuadtreePrimitive.js";
import QuadtreeTile from "../../packages/engine/Source/Scene/QuadtreeTile.js";
import QuadtreeTileLoadState from "../../packages/engine/Source/Scene/QuadtreeTileLoadState.js";
import SceneMode from "../../packages/engine/Source/Scene/SceneMode.js";
import TerrainState from "../../packages/engine/Source/Scene/TerrainState.js";
import TweenCollection from "../../packages/engine/Source/Scene/TweenCollection.js";
import WebGPUGlobeRenderer from "../../packages/engine/Source/Scene/WebGPUGlobeRenderer.js";
import WebGPUGlobeTileProvider from "../../packages/engine/Source/Scene/WebGPUGlobeTileProvider.js";
import WebGPUScene from "../../packages/engine/Source/Scene/WebGPUScene.js";

const regions = [
  { name: "south", longitude: 10, latitude: 10, x: 4, y: 1 },
  { name: "north", longitude: 10, latitude: 70, x: 4, y: 0 },
];
const time = JulianDate.fromIso8601("2026-11-02T00:00:00Z");

function setView(camera, region) {
  camera.setView({
    destination: Cartesian3.fromDegrees(
      region.longitude,
      region.latitude,
      1000,
    ),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
}

function fixture(t) {
  const errors = [];
  const submitted = [];
  const resources = [];
  let vertex;
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer(...args) {
      vertex = args[1];
    },
    setIndexBuffer() {},
    drawIndexed(count) {
      submitted.push({ vertex, count });
    },
  };
  const context = {
    canvas: { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720 },
    _checkAlive() {},
    _fail(error) {
      errors.push(error);
    },
    render(draw) {
      submitted.length = 0;
      draw(pass);
    },
  };
  const globe = new Globe(Ellipsoid.WGS84);
  globe._surface.destroy();
  const renderer = new WebGPUGlobeRenderer(context);
  renderer._uniformStride = 256;
  renderer._uniformBuffer = { size: 512, destroy() {} };
  renderer._uniformValues = new Float32Array(128);
  renderer._device = { queue: { writeBuffer() {} } };
  const adapter = new WebGPUGlobeTileProvider({ globe, renderer });
  const surface = new QuadtreePrimitive({ tileProvider: adapter });
  globe._surface = surface;

  // Avoid DOM input and asynchronous GPU initialization. The render entry point,
  // frame orchestration, resize, terrain setter and destroy methods stay real.
  const scene = Object.assign(Object.create(WebGPUScene.prototype), {
    context,
    canvas: context.canvas,
    _globe: globe,
    ellipsoid: globe.ellipsoid,
    mapProjection: new GeographicProjection(globe.ellipsoid),
    _renderer: renderer,
    _tileProvider: adapter,
    _ready: true,
    _destroyed: false,
    mode: SceneMode.SCENE3D,
    scene3DOnly: true,
    morphTime: 1,
    pixelRatio: 1,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    cameraUnderground: false,
    backgroundColor: Color.BLACK,
    preUpdate: new Event(),
    postUpdate: new Event(),
    preRender: new Event(),
    postRender: new Event(),
    rethrowRenderErrors: true,
    tweens: new TweenCollection(),
    screenSpaceCameraController: { destroy() {} },
    initializeFrame() {
      this.camera.update(SceneMode.SCENE3D);
    },
  });
  scene.camera = new Camera(scene);
  scene.camera.frustum.near = 0.1;
  scene.camera.frustum.far = 500000000;
  scene._frameState = new FrameState(context, undefined, undefined);
  scene._frameState.camera = scene.camera;
  scene._frameState.passes.render = true;
  scene._removeTerrainChanged = globe.terrainProviderChanged.addEventListener(
    (provider) => {
      adapter.terrainProvider = provider;
    },
  );

  function readyTile(region) {
    const tile = new QuadtreeTile({
      tilingScheme: adapter.tilingScheme,
      x: region.x,
      y: region.y,
      level: 2,
    });
    const data = adapter._ensureTile(tile);
    const center = Cartesian3.fromDegrees(region.longitude, region.latitude);
    data.terrainData = { credits: [], wasCreatedByUpsampling: () => false };
    data.terrainState = TerrainState.READY;
    data.mesh = { center, boundingSphere3D: new BoundingSphere(center, 10) };
    const gpu = {
      vertex: { name: region.name, provider: adapter.terrainProvider },
      index: {},
      indexFormat: "uint16",
      indexCount: 3,
      indexCountWithoutSkirts: 3,
      destroyed: 0,
      destroy() {
        ++this.destroyed;
      },
    };
    data.gpu = gpu;
    resources.push(gpu);
    tile.renderable = true;
    tile.state = QuadtreeTileLoadState.DONE;
    surface._tileReplacementQueue.markTileRendered(tile);
    return tile;
  }

  // Keep native beginFrame, which consumes provider invalidation and releases
  // old roots. This deterministic dataset immediately supplies a new generation
  // after invalidation; it never submits a previously released fixture tile.
  surface.render = (frame) => {
    surface._levelZeroTiles ??= regions.map(readyTile);
    surface._tilesToRender.length = 0;
    for (const tile of surface._levelZeroTiles) {
      if (
        frame.cullingVolume.computeVisibility(
          tile.data.mesh.boundingSphere3D,
        ) !== Intersect.OUTSIDE
      ) {
        surface._tilesToRender.push(tile);
        adapter.showTileThisFrame(tile, frame);
      }
    }
  };
  surface.endFrame = () => {};
  setView(scene.camera, regions[0]);
  t.after(() => scene.destroy());
  return { scene, surface, adapter, renderer, submitted, errors, resources };
}

for (const eventName of ["postUpdate", "preRender"]) {
  test(`${eventName} can replace terrain before same-frame tile selection and drawing`, (t) => {
    const f = fixture(t);
    f.scene.render(time);
    assert.deepEqual(
      f.submitted.map(({ vertex }) => vertex.name),
      ["south"],
    );
    const oldData = f.surface._levelZeroTiles.map((tile) => tile.data);
    const oldResources = [...f.resources];
    const replacement = new EllipsoidTerrainProvider();
    const remove = f.scene[eventName].addEventListener(
      (scene, callbackTime) => {
        remove();
        assert.equal(scene, f.scene);
        assert.ok(JulianDate.equals(callbackTime, time));
        scene.terrainProvider = replacement;
      },
    );

    assert.doesNotThrow(() => f.scene.render(time));
    assert.deepEqual(f.errors, []);
    assert.equal(f.adapter.terrainProvider, replacement);
    assert.ok(oldData.every((data) => data.released));
    assert.ok(oldResources.every((resource) => resource.destroyed === 1));
    assert.equal(f.submitted.length, 1);
    assert.equal(f.submitted[0].vertex.provider, replacement);
    assert.ok(
      f.renderer._draws.every(
        ({ tile }) => !tile.data.released && tile.data.gpu,
      ),
    );
  });

  test(`${eventName} camera.setView updates same-frame culling and selected draws`, (t) => {
    const f = fixture(t);
    f.scene.render(time);
    assert.deepEqual(
      f.submitted.map(({ vertex }) => vertex.name),
      ["south"],
    );
    const remove = f.scene[eventName].addEventListener((scene) => {
      remove();
      setView(scene.camera, regions[1]);
    });

    assert.doesNotThrow(() => f.scene.render(time));
    assert.deepEqual(f.errors, []);
    assert.deepEqual(
      f.submitted.map(({ vertex }) => vertex.name),
      ["north"],
      "Draw selection must use the camera position established by the scene callback",
    );
    const [south, north] = f.surface._levelZeroTiles.map(
      (tile) => tile.data.mesh.boundingSphere3D,
    );
    assert.equal(
      f.scene.frameState.cullingVolume.computeVisibility(south),
      Intersect.OUTSIDE,
    );
    assert.notEqual(
      f.scene.frameState.cullingVolume.computeVisibility(north),
      Intersect.OUTSIDE,
    );
  });
}
