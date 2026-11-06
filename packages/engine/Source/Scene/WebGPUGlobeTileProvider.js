import {
  BoundingSphere,
  Cartesian3,
  OrientedBoundingBox,
  RuntimeError,
} from "@cesium/core";
import Request from "../Core/Request.js";
import RequestType from "../Core/RequestType.js";
import TileProviderError from "../Core/TileProviderError.js";
import GlobeSurfaceTile from "./GlobeSurfaceTile.js";
import GlobeSurfaceTileProvider from "./GlobeSurfaceTileProvider.js";
import QuadtreeTileLoadState from "./QuadtreeTileLoadState.js";
import TerrainState from "./TerrainState.js";
import ImageryState from "./ImageryState.js";
import TerrainFillMesh from "./TerrainFillMesh.js";

// Retain native picking, bounds and imagery associations, with explicit GPU ownership.
class WebGPUSurfaceTile extends GlobeSurfaceTile {
  constructor(owner, tile) {
    super();
    this.owner = owner;
    this.tile = tile;
    this.released = false;
    this.gpu = undefined;
    owner._tiles.add(this);
  }

  get renderedMesh() {
    return this.gpu ? this.mesh : this.fill?.mesh;
  }

  get gpu() {
    return this.vertexArray;
  }

  set gpu(value) {
    // Native fill propagation uses this field only to identify real geometry.
    // Fill resources remain separate, in fill.vertexArray.
    this.vertexArray = value;
  }

  processImagery(tile, terrainProvider, frameState, skipLoading) {
    return this.owner._imagery?.updateTile(tile, frameState, skipLoading);
  }

  get eligibleForUnloading() {
    // Pending requests can be cancelled; late worker results are guarded below.
    return true;
  }

  freeResources() {
    if (this.released) {
      return;
    }
    this.released = true;
    if (this.tile.data === this) {
      this.tile.renderable = false;
    }
    this.request?.cancel();
    this.request = undefined;
    this.gpu?.destroy();
    this.gpu = undefined;
    super.freeResources();
    this.owner._tiles.delete(this);
  }
}

/**
 * WebGPU's narrow surface adapter. Native quadtree traversal, distance, bounds,
 * horizon culling, layer associations and picking remain in Cesium's CPU code.
 * Native WebGL frame/resource state machines are deliberately not invoked.
 * @private
 */
class WebGPUGlobeTileProvider extends GlobeSurfaceTileProvider {
  constructor({ globe, renderer }) {
    super({
      terrainProvider: globe.terrainProvider,
      imageryLayers: globe.imageryLayers,
      surfaceShaderSet: globe._surfaceShaderSet,
      vectorProvider: globe.vectorProvider,
    });
    this._renderer = renderer;
    this._tiles = new Set();
    this._destroyed = false;
    this._imagery = undefined;
    this._frameTiles = [];
    this.statistics = {
      requests: 0,
      deferred: 0,
      meshes: 0,
      fills: 0,
      upsampled: 0,
      failed: 0,
    };
  }

  _ensureTile(tile) {
    if (!(tile.data instanceof WebGPUSurfaceTile) || tile.data.released) {
      tile.data = new WebGPUSurfaceTile(this, tile);
    }
    // Native traversal's renderable flag means independently loaded terrain.
    // A temporary fill must not replace every real mesh in a pending subtree.
    tile.renderable = !!tile.data.gpu;
    return tile.data;
  }

  _ancestorSource(tile) {
    let source = tile.parent;
    while (source && (!source.data?.gpu || source.data.released)) {
      source = source.parent;
    }
    return source;
  }

  get terrainProvider() {
    return super.terrainProvider;
  }

  set terrainProvider(provider) {
    if (provider !== super.terrainProvider) {
      this._releaseTiles();
      super.terrainProvider = provider;
    }
  }

  _releaseTiles() {
    for (const root of this._quadtree?._levelZeroTiles ?? []) {
      root.freeResources();
    }
    for (const data of this._tiles) {
      data.freeResources();
    }
  }

  computeDistanceToTile(tile, frameState) {
    // The native bounds helper otherwise constructs a WebGL-owned surface tile.
    const data = this._ensureTile(tile);
    if (data._fillBounds) {
      data.tileBoundingRegion._orientedBoundingBox = undefined;
      data.tileBoundingRegion._boundingSphere = undefined;
      data.boundingVolumeIsFromMesh = false;
      data._fillBounds = false;
    }
    let distance = super.computeDistanceToTile(tile, frameState);
    if (!data.gpu) {
      const source = this._ancestorSource(tile);
      const region = data.tileBoundingRegion;
      for (const mesh of [source?.data.mesh, data.fill?.mesh]) {
        if (!mesh) {
          continue;
        }
        // A previous fill is rebuilt only after selection. It must not replace
        // the native current/ancestor bounds and cull its own future update.
        region._boundingSphere = region._boundingSphere
          ? BoundingSphere.union(
              region._boundingSphere,
              mesh.boundingSphere3D,
              region._boundingSphere,
            )
          : BoundingSphere.clone(mesh.boundingSphere3D);
        region.minimumHeight = Math.min(
          region.minimumHeight,
          mesh.minimumHeight,
        );
        region.maximumHeight = Math.max(
          region.maximumHeight,
          mesh.maximumHeight,
        );
        region._orientedBoundingBox = undefined;
        data.boundingVolumeSourceTile = source ?? tile;
        data.boundingVolumeIsFromMesh = false;
        // There is no single native horizon point for this union. Its sphere
        // remains available for conservative native frustum culling.
        data.occludeePointInScaledSpace = undefined;
        data._fillBounds = true;
      }
      if (data._fillBounds) {
        distance = Math.min(distance, region.distanceToCamera(frameState));
      }
    }
    return distance;
  }

  _setFillBounds(tile, mesh, source) {
    const data = tile.data;
    const region = data.tileBoundingRegion;
    region.minimumHeight = mesh.minimumHeight;
    region.maximumHeight = mesh.maximumHeight;
    region._orientedBoundingBox = OrientedBoundingBox.clone(
      mesh.orientedBoundingBox,
      region._orientedBoundingBox,
    );
    region._boundingSphere = BoundingSphere.clone(
      mesh.boundingSphere3D,
      region._boundingSphere,
    );
    data.occludeePointInScaledSpace = Cartesian3.clone(
      mesh.occludeePointInScaledSpace,
    );
    data.boundingVolumeSourceTile = source;
    data.boundingVolumeIsFromMesh = false;
    data._fillBounds = true;
  }

  computeTileLoadPriority(tile, frameState) {
    this.computeDistanceToTile(tile, frameState);
    return super.computeTileLoadPriority(tile, frameState);
  }

  initialize() {
    if (this._layerOrderChanged) {
      this._layerOrderChanged = false;
      for (const data of this._tiles) {
        data.imagery.sort((left, right) => {
          const a = left.readyImagery ?? left.loadingImagery;
          const b = right.readyImagery ?? right.loadingImagery;
          return a.imageryLayer._layerIndex - b.imageryLayer._layerIndex;
        });
      }
    }
  }

  beginUpdate() {
    this._frameTiles.length = 0;
  }

  createFillMeshResources(mesh) {
    const gpu = this._renderer.createTile(mesh);
    ++this.statistics.fills;
    return gpu;
  }

  endUpdate(frameState) {
    // Native propagation needs the complete current selection and its neighbor
    // flags. Fill edges then match the real selected meshes, rather than a
    // clipped coarse triangle that has no skirt along an internal child edge.
    for (const tile of this._frameTiles) {
      if (tile.state === QuadtreeTileLoadState.START) {
        // This adapter owns initialization/availability/upsampling. Avoid the
        // WebGL initializer changing unavailable tiles to FAILED before our
        // _requestTerrain can use the native parent upsampler.
        tile.state = QuadtreeTileLoadState.LOADING;
      }
    }
    if (
      this._frameTiles.some((tile) => tile.data.gpu) &&
      this._frameTiles.some((tile) => !tile.data.gpu)
    ) {
      TerrainFillMesh.updateFillTiles(this, this._frameTiles, frameState);
    }
    for (const tile of this._frameTiles) {
      const data = tile.data;
      if (!data.gpu) {
        data.fill ??= new TerrainFillMesh(tile);
        data.fill.update(this, frameState);
        this._setFillBounds(tile, data.fill.mesh, tile);
      }
      this._renderer.addTile(tile, tile.rectangle);
    }
  }

  canRefine(tile) {
    // Availability alone must not expand an entirely unloaded subtree. Keep
    // paths to cached fine meshes even when intermediate meshes were evicted.
    return (
      tile.level < 30 &&
      super.canRefine(tile) &&
      (tile.data?.gpu !== undefined || hasLoadedDescendant(tile))
    );
  }

  canRenderWithoutLosingDetail(tile) {
    return tile.renderable && tile.state === QuadtreeTileLoadState.DONE;
  }

  canRenderWithFills(tiles, firstIndex) {
    // A real selected descendant anchors native edge propagation. Retain that
    // detail and fill its pending neighbors. With no real descendant, keep the
    // native parent fallback instead of selecting unrelated flat fill meshes.
    for (let i = firstIndex; i < tiles.length; ++i) {
      if (tiles[i].data?.gpu) {
        return true;
      }
    }
    return false;
  }

  showTileThisFrame(tile, frameState) {
    this._ensureTile(tile);
    this._frameTiles.push(tile);
    const source = tile.data.gpu ? tile : this._ancestorSource(tile);
    if (source) {
      // Match native GlobeSurfaceTileProvider: dataset credits belong to the
      // terrain data used for coverage, including the ancestor of a fill.
      for (const credit of source.data.terrainData.credits ?? []) {
        frameState.creditDisplay.addCreditToNextFrame(credit);
      }
    }
  }

  loadTile(frameState, tile) {
    if (this._destroyed) {
      return;
    }
    const data = this._ensureTile(tile);
    tile.state = QuadtreeTileLoadState.LOADING;
    if (data.terrainState === TerrainState.UNLOADED) {
      this._requestTerrain(tile, data, frameState);
    }
    if (data.terrainState === TerrainState.RECEIVED) {
      const promise = data.terrainData.createMesh({
        tilingScheme: this.tilingScheme,
        x: tile.x,
        y: tile.y,
        level: tile.level,
        exaggeration: 1,
        exaggerationRelativeHeight: 0,
        throttle: true,
      });
      if (promise !== undefined) {
        data.terrainState = TerrainState.TRANSFORMING;
        Promise.resolve(promise)
          .then((mesh) => {
            if (data.released || this._destroyed) {
              return;
            }
            if (!mesh) {
              data.terrainState = TerrainState.RECEIVED;
              return;
            }
            data.mesh = mesh;
            data.gpu = this._renderer.createTile(mesh, data.terrainData);
            data.fill = data.fill?.destroy();
            data.terrainState = TerrainState.READY;
            ++this.statistics.meshes;
            // Native getHeight can observe renderedMesh as soon as gpu exists.
            // Initialize imagery fallback and renderability in the same turn,
            // before the next camera collision query and quadtree selection.
            this.loadTile(frameState, tile);
          })
          .catch((error) => this._terrainFailure(tile, data, error));
      }
    }
    if (data.terrainState !== TerrainState.READY) {
      return;
    }
    const imageryReady = this._imagery
      ? this._imagery.updateTile(tile, frameState)
      : true;
    if (data.released || this._destroyed) {
      return;
    }
    tile.renderable = true;
    // Match native GlobeSurfaceTile.processImagery: independent or still-loading
    // imagery can justify finer quadtree LOD even when terrain is upsampled.
    tile.upsampledFromParent =
      data.terrainData.wasCreatedByUpsampling() &&
      data.imagery.every(
        ({ loadingImagery }) =>
          loadingImagery &&
          (loadingImagery.state === ImageryState.FAILED ||
            loadingImagery.state === ImageryState.INVALID),
      );
    if (imageryReady) {
      tile.state = QuadtreeTileLoadState.DONE;
      for (const [key, callback] of Object.entries(tile._loadedCallbacks)) {
        if (callback(tile)) {
          delete tile._loadedCallbacks[key];
        }
      }
    }
  }

  _requestTerrain(tile, data, frameState) {
    const provider = this.terrainProvider;
    data._provider = provider;
    const parent = tile.parent;
    const parentData = parent?.data?.terrainData;
    let available = provider.getTileDataAvailable(tile.x, tile.y, tile.level);
    if (available === undefined && parentData) {
      available = parentData.isChildAvailable(
        parent.x,
        parent.y,
        tile.x,
        tile.y,
      );
    }
    let promise;
    if (available === false || data._useParent) {
      if (!parent) {
        this._terrainFailure(
          tile,
          data,
          new RuntimeError("Terrain provider has no root tile."),
        );
        return;
      }
      if (!parentData || !parent.data.mesh) {
        this.loadTile(frameState, parent);
        return;
      }
      promise = parentData.upsample(
        this.tilingScheme,
        parent.x,
        parent.y,
        parent.level,
        tile.x,
        tile.y,
        tile.level,
      );
      if (promise !== undefined) {
        ++this.statistics.upsampled;
      }
    } else {
      const request = new Request({
        throttle: false,
        throttleByServer: true,
        type: RequestType.TERRAIN,
      });
      data.request = request;
      try {
        promise = provider.requestTileGeometry(
          tile.x,
          tile.y,
          tile.level,
          request,
        );
      } catch (error) {
        this._terrainFailure(tile, data, error);
        return;
      }
      if (promise !== undefined) {
        ++this.statistics.requests;
      }
    }
    if (promise === undefined) {
      data.request = undefined;
      ++this.statistics.deferred;
      return;
    }
    data.terrainState = TerrainState.RECEIVING;
    Promise.resolve(promise)
      .then((terrainData) => {
        if (data.released || this._destroyed) {
          return;
        }
        data.request = undefined;
        data.terrainData = terrainData;
        data.terrainState = terrainData
          ? TerrainState.RECEIVED
          : TerrainState.UNLOADED;
      })
      .catch((error) => this._terrainFailure(tile, data, error));
  }

  _terrainFailure(tile, data, error) {
    if (data.released || this._destroyed) {
      return;
    }
    if (data.request?.cancelled) {
      data.request = undefined;
      data.terrainState = TerrainState.UNLOADED;
      return;
    }
    data.request = undefined;
    ++this.statistics.failed;
    const provider = data._provider;
    this._requestError = TileProviderError.reportError(
      this._requestError,
      provider,
      provider.errorEvent,
      `WebGPU terrain tile ${tile.level}/${tile.x}/${tile.y} failed.`,
      tile.x,
      tile.y,
      tile.level,
      error,
    );
    // Provider listeners may replace the terrain or destroy this scene while
    // reportError is on the stack. A released generation cannot retry or fail
    // the newly installed provider after that callback returns.
    if (data.released || this._destroyed) {
      return;
    }
    if (this._requestError.retry) {
      data.terrainState = TerrainState.UNLOADED;
    } else if (tile.parent && !data._useParent) {
      data._useParent = true;
      data.terrainData = undefined;
      data.terrainState = TerrainState.UNLOADED;
    } else {
      data.terrainState = TerrainState.FAILED;
      tile.state = QuadtreeTileLoadState.FAILED;
      this._errorEvent.raiseEvent(error);
    }
  }

  destroy() {
    this._destroyed = true;
    this._releaseTiles();
    for (let i = 0; i < this._imageryLayers.length; ++i) {
      const layer = this._imageryLayers.get(i);
      if (layer.ready) {
        layer.imageryProvider._reload = undefined;
      }
    }
    this._imagery?.destroy();
    return super.destroy();
  }
}

function hasLoadedDescendant(tile) {
  for (const child of [
    tile._southwestChild,
    tile._southeastChild,
    tile._northwestChild,
    tile._northeastChild,
  ]) {
    if (
      child &&
      ((child.data?.gpu && !child.data.released) || hasLoadedDescendant(child))
    ) {
      return true;
    }
  }
  return false;
}

export default WebGPUGlobeTileProvider;
