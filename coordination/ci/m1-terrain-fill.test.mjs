// Native quadtree, bounds, terrain encoding and ray tests; GPU ownership alone
// is a CPU fixture. No Provider data or quadtree selection rule is replaced.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Event,
  GeographicProjection,
  Ray,
  Rectangle,
} from "@cesium/core";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";
import HeightmapTerrainData from "../../packages/engine/Source/Core/HeightmapTerrainData.js";
import TaskProcessor from "../../packages/engine/Source/Core/TaskProcessor.js";
import Camera from "../../packages/engine/Source/Scene/Camera.js";
import FrameState from "../../packages/engine/Source/Scene/FrameState.js";
import ImageryLayerCollection from "../../packages/engine/Source/Scene/ImageryLayerCollection.js";
import QuadtreePrimitive from "../../packages/engine/Source/Scene/QuadtreePrimitive.js";
import QuadtreeTile from "../../packages/engine/Source/Scene/QuadtreeTile.js";
import QuadtreeTileLoadState from "../../packages/engine/Source/Scene/QuadtreeTileLoadState.js";
import SceneMode from "../../packages/engine/Source/Scene/SceneMode.js";
import TerrainState from "../../packages/engine/Source/Scene/TerrainState.js";
import TerrainFillMesh from "../../packages/engine/Source/Scene/TerrainFillMesh.js";
import WebGPUGlobeTileProvider from "../../packages/engine/Source/Scene/WebGPUGlobeTileProvider.js";

function fixture(t) {
  const scheme = new GeographicTilingScheme();
  const terrain = {
    tilingScheme: scheme,
    errorEvent: new Event(),
    requestTileGeometry: () => undefined,
    getTileDataAvailable: () => true,
    getLevelMaximumGeometricError: (level) => (level < 2 ? 100000 : 1),
  };
  const draws = [];
  const destroyed = [];
  const resources = [];
  function createGpu() {
    let released = false;
    const gpu = {
      isDestroyed: () => released,
      destroy() {
        if (!released) {
          released = true;
          destroyed.push(gpu);
        }
      },
    };
    resources.push(gpu);
    return gpu;
  }
  const adapter = new WebGPUGlobeTileProvider({
    globe: {
      terrainProvider: terrain,
      imageryLayers: new ImageryLayerCollection(),
      _surfaceShaderSet: {},
      vectorProvider: {},
    },
    renderer: {
      addTile: (tile, rectangle) => draws.push({ tile, rectangle }),
      createTile: createGpu,
    },
  });
  const surface = new QuadtreePrimitive({ tileProvider: adapter });
  const context = { drawingBufferWidth: 1280, drawingBufferHeight: 720 };
  const scene = {
    ...context,
    mode: SceneMode.SCENE3D,
    scene3DOnly: true,
    mapProjection: new GeographicProjection(),
    ellipsoid: Ellipsoid.WGS84,
  };
  const camera = new Camera(scene);
  camera.setView({
    destination: Cartesian3.fromDegrees(-67.5, 22.5, 10000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  camera.update(SceneMode.SCENE3D);
  const frame = new FrameState(context, { addCreditToNextFrame() {} });
  Object.assign(frame, {
    camera,
    mapProjection: scene.mapProjection,
    frameNumber: 1,
    pixelRatio: 1,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    globeTranslucencyState: { translucent: false },
    cullingVolume: camera.frustum.computeCullingVolume(
      camera.positionWC,
      camera.directionWC,
      camera.upWC,
    ),
  });
  frame.fog.enabled = false;
  frame.passes.render = true;
  // Create the actual native roots/traversal scratch before installing fixtures.
  surface.render(frame);
  const root = surface._levelZeroTiles.find((tile) => tile.x === 0);
  function ready(tile, height = 1000) {
    const data = adapter._ensureTile(tile);
    data.terrainData = new HeightmapTerrainData({
      buffer: new Float32Array(9).fill(height),
      width: 3,
      height: 3,
    });
    data.mesh = data.terrainData._createMeshSync({
      tilingScheme: scheme,
      x: tile.x,
      y: tile.y,
      level: tile.level,
    });
    data.terrainState = TerrainState.READY;
    data.fill = data.fill?.destroy();
    data.gpu = createGpu();
    tile.state = QuadtreeTileLoadState.DONE;
    tile.renderable = true;
    return data;
  }
  // TerrainPicker's CPU intersection remains real; skip only its optional
  // asynchronous acceleration-worker transport in this Node environment.
  const schedule = TaskProcessor.prototype.scheduleTask;
  TaskProcessor.prototype.scheduleTask = () => undefined;
  t.after(() => {
    adapter.destroy();
    TaskProcessor.prototype.scheduleTask = schedule;
  });
  return {
    adapter,
    surface,
    terrain,
    scheme,
    root,
    ready,
    frame,
    draws,
    destroyed,
    resources,
  };
}

test("an entirely unloaded child subtree keeps its real parent mesh", (t) => {
  const f = fixture(t);
  f.ready(f.root, 7000);
  f.surface.beginFrame(f.frame);
  f.surface.render(f.frame);
  assert.ok(f.draws.some(({ tile }) => tile === f.root));
  assert.ok(f.draws.every(({ tile }) => tile.data.gpu));
  assert.ok(
    f.surface._tileLoadQueueHigh.length +
      f.surface._tileLoadQueueMedium.length >
      0,
    "Keeping the parent must still load the needed children",
  );
});

test("native selection retains a ready fine descendant beside pending siblings", (t) => {
  const f = fixture(t);
  f.ready(f.root, 7000);
  const branch = f.root.northeastChild;
  const fine = branch.southwestChild;
  f.ready(fine, 5000);
  f.surface.beginFrame(f.frame);
  f.surface.render(f.frame);
  assert.ok(
    f.draws.some(({ tile }) => tile === fine),
    "Pending siblings must not kick a ready fine mesh back to the coarse root",
  );
  const filled = f.draws.filter(
    ({ tile }) => !tile.data.gpu && tile.data.fill?.vertexArray,
  );
  assert.ok(
    filled.length > 0,
    "Unready siblings receive native connected fill meshes",
  );
  assert.ok(
    f.surface._debug.tilesVisited < 30,
    "Known availability must not expand wholly unloaded branches",
  );
  assert.ok(
    f.surface._tileLoadQueueHigh.length +
      f.surface._tileLoadQueueMedium.length +
      f.surface._tileLoadQueueLow.length <
      40,
  );
  assert.equal(branch.data.terrainState, TerrainState.UNLOADED);
  assert.notEqual(branch.state, QuadtreeTileLoadState.DONE);
  assert.ok(f.surface._tileReplacementQueue.count > 0);
});

test("previous fills do not survive as a disconnected all-fill selection after eviction", (t) => {
  const f = fixture(t);
  f.ready(f.root, 7000);
  const fine = f.root.northeastChild.southwestChild;
  f.ready(fine, 5000);
  f.surface.beginFrame(f.frame);
  f.surface.render(f.frame);
  assert.ok(f.draws.some(({ tile }) => tile === fine));
  assert.ok(f.draws.some(({ tile }) => tile.data.fill));
  fine.freeResources();
  f.draws.length = 0;
  ++f.frame.frameNumber;
  f.surface.beginFrame(f.frame);
  f.surface.render(f.frame);
  assert.ok(f.draws.some(({ tile }) => tile === f.root));
  assert.ok(f.draws.every(({ tile }) => tile.data.gpu));
});

test("fill resources have independent ownership and are released exactly once", (t) => {
  const f = fixture(t);
  const source = f.ready(f.root);
  const child = f.root.northeastChild;
  f.adapter.computeDistanceToTile(child, f.frame);
  assert.equal(
    child.renderable,
    false,
    "A fill is not independently loaded terrain",
  );
  f.adapter.beginUpdate();
  f.adapter.showTileThisFrame(child, f.frame);
  f.adapter.endUpdate(f.frame);
  assert.notEqual(child.data.renderedMesh, source.mesh);
  assert.equal(
    child.data.mesh,
    undefined,
    "Fill must not pretend to be loaded provider data",
  );
  const fillGpu = child.data.fill.vertexArray;
  assert.equal(child.data.vertexArray, undefined);
  child.freeResources();
  child.freeResources();
  assert.equal(fillGpu.isDestroyed(), true);
  assert.equal(source.gpu.isDestroyed(), false);
  assert.equal(f.destroyed.length, 1);
  f.adapter.destroy();
  assert.equal(f.destroyed.length, f.resources.length);
});

test("native fill matches a loaded near-ground neighbor edge within one centimetre", (t) => {
  const f = fixture(t);
  const coordinate = Cartographic.fromDegrees(-67.48, 22.52);
  f.terrain.getLevelMaximumGeometricError = (level) =>
    level < 12 ? 100000 : 0.001;
  f.ready(f.root, 7000);
  let fine = f.root;
  while (fine.level < 12) {
    fine = [
      fine.southwestChild,
      fine.southeastChild,
      fine.northwestChild,
      fine.northeastChild,
    ].find((tile) => Rectangle.contains(tile.rectangle, coordinate));
  }
  f.ready(fine, 5000);
  f.frame.camera.setView({
    destination: Cartesian3.fromRadians(
      coordinate.longitude,
      coordinate.latitude,
      10000,
    ),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  f.frame.camera.update(SceneMode.SCENE3D);
  f.frame.cullingVolume = f.frame.camera.frustum.computeCullingVolume(
    f.frame.camera.positionWC,
    f.frame.camera.directionWC,
    f.frame.camera.upWC,
  );
  f.surface.beginFrame(f.frame);
  f.surface.render(f.frame);
  assert.ok(f.draws.some(({ tile }) => tile === fine));
  const neighbor = fine.findTileToNorth(f.surface._levelZeroTiles);
  assert.ok(
    neighbor.data.fill?.mesh,
    "The loaded tile's actual north neighbor must be a native fill",
  );
  const sourceMesh = fine.data.mesh;
  const fillMesh = neighbor.data.renderedMesh;
  const edge = (mesh, name) =>
    mesh[name].map((index) =>
      mesh.encoding.decodePosition(mesh.vertices, index),
    );
  const sourcePositions = edge(sourceMesh, "northIndicesWestToEast");
  const fillPositions = edge(fillMesh, "southIndicesEastToWest");
  for (const point of sourcePositions) {
    assert.ok(
      fillPositions.some((other) => Cartesian3.distance(point, other) < 0.01),
      "Native fill must preserve the real near-ground Cartesian edge",
    );
  }
  assert.ok(
    f.surface._debug.tilesVisited < 100,
    "Loading a cached level-12 path must leave other empty subtrees bounded",
  );
});

test("selection bounds retain current terrain and ancestors despite a lower previous fill", (t) => {
  const f = fixture(t);
  const source = f.ready(f.root.northeastChild, 9000);
  const child = f.root.northeastChild.southwestChild;
  const data = f.adapter._ensureTile(child);
  data.terrainData = { _minimumHeight: -1000, _maximumHeight: 0 };
  data.terrainState = TerrainState.RECEIVED;
  data.fill = new TerrainFillMesh(child);
  data.fill.mesh = new HeightmapTerrainData({
    buffer: new Float32Array(9).fill(-1000),
    width: 3,
    height: 3,
  })._createMeshSync({
    tilingScheme: f.scheme,
    x: child.x,
    y: child.y,
    level: child.level,
  });
  f.adapter.computeDistanceToTile(child, f.frame);
  const sphere = data.tileBoundingRegion.boundingSphere;
  const ancestor = source.mesh.boundingSphere3D;
  assert.ok(
    Cartesian3.distance(sphere.center, ancestor.center) + ancestor.radius <=
      sphere.radius + 1e-6,
    "Culling and picking bounds must contain the GPU geometry, not only pending child data",
  );
  assert.notEqual(sphere, ancestor);
  assert.equal(data.terrainData._maximumHeight, 0);
  const own = f.ready(child, 3000);
  f.adapter.computeDistanceToTile(child, f.frame);
  assert.ok(
    BoundingSphere.equals(
      data.tileBoundingRegion.boundingSphere,
      own.mesh.boundingSphere3D,
    ),
  );
});

test("native fill picking includes its child and excludes neighboring rectangles", (t) => {
  const f = fixture(t);
  const tile = new QuadtreeTile({
    tilingScheme: f.scheme,
    x: 15,
    y: 11,
    level: 5,
  });
  f.ready(tile, 3000);
  const child = tile.northeastChild;
  f.adapter.computeDistanceToTile(child, f.frame);
  f.adapter.beginUpdate();
  f.adapter.showTileThisFrame(child, f.frame);
  f.adapter.endUpdate(f.frame);
  for (const [rectangle, inside] of [
    [child.rectangle, true],
    [tile.southwestChild.rectangle, false],
  ]) {
    const coordinate = Rectangle.center(rectangle);
    const origin = Cartesian3.fromRadians(
      coordinate.longitude,
      coordinate.latitude,
      100000,
    );
    const direction = Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
    Cartesian3.negate(direction, direction);
    const ray = new Ray(origin, direction);
    const actual = child.data.pick(
      ray,
      SceneMode.SCENE3D,
      f.frame.mapProjection,
      false,
    );
    if (inside) {
      assert.ok(actual);
      assert.ok(
        Rectangle.contains(
          child.rectangle,
          Ellipsoid.WGS84.cartesianToCartographic(actual),
        ),
      );
    } else {
      assert.equal(actual, undefined);
    }
  }
});

test("unavailable terrain can generate a fill before native upsampling supplies its own mesh", async (t) => {
  const f = fixture(t);
  f.ready(f.root.northeastChild, 5000);
  const child = f.root.northeastChild.southwestChild;
  f.terrain.getTileDataAvailable = () => false;
  const originalCreateMesh = HeightmapTerrainData.prototype.createMesh;
  HeightmapTerrainData.prototype.createMesh = function (options) {
    return Promise.resolve(this._createMeshSync(options));
  };
  t.after(() => {
    HeightmapTerrainData.prototype.createMesh = originalCreateMesh;
  });
  f.adapter.computeDistanceToTile(child, f.frame);
  f.adapter.beginUpdate();
  f.adapter.showTileThisFrame(child, f.frame);
  f.adapter.endUpdate(f.frame);
  const oldFill = child.data.fill;
  const oldGpu = oldFill.vertexArray;
  assert.equal(child.data.terrainState, TerrainState.UNLOADED);
  for (let i = 0; i < 3; ++i) {
    f.adapter.loadTile(f.frame, child);
    await setImmediate();
  }
  assert.equal(f.adapter.statistics.upsampled, 1);
  assert.equal(child.data.terrainData.wasCreatedByUpsampling(), true);
  assert.equal(child.data.terrainState, TerrainState.READY);
  assert.equal(child.state, QuadtreeTileLoadState.DONE);
  assert.ok(child.data.mesh && child.data.gpu);
  assert.equal(child.data.fill, undefined);
  assert.equal(oldGpu.isDestroyed(), true);
  assert.equal(f.destroyed.filter((gpu) => gpu === oldGpu).length, 1);
});
