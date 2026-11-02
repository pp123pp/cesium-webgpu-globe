import { RuntimeError } from "@cesium/core";
import Request from "../Core/Request.js";
import RequestType from "../Core/RequestType.js";
import TileProviderError from "../Core/TileProviderError.js";
import GlobeSurfaceTile from "./GlobeSurfaceTile.js";
import GlobeSurfaceTileProvider from "./GlobeSurfaceTileProvider.js";
import QuadtreeTileLoadState from "./QuadtreeTileLoadState.js";
import TerrainState from "./TerrainState.js";

// Retain native picking, bounds and imagery associations, with explicit GPU ownership.
class WebGPUSurfaceTile extends GlobeSurfaceTile {
  constructor(owner) {
    super();
    this.owner = owner;
    this.released = false;
    this.gpu = undefined;
    owner._tiles.add(this);
  }

  get renderedMesh() {
    return this.gpu ? this.mesh : undefined;
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
    this.statistics = {
      requests: 0,
      deferred: 0,
      meshes: 0,
      upsampled: 0,
      failed: 0,
    };
  }

  _ensureTile(tile) {
    if (!(tile.data instanceof WebGPUSurfaceTile) || tile.data.released) {
      tile.data = new WebGPUSurfaceTile(this);
    }
    return tile.data;
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
    this._ensureTile(tile);
    return super.computeDistanceToTile(tile, frameState);
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

  beginUpdate() {}
  endUpdate() {}

  canRefine(tile) {
    return tile.level < 30 && super.canRefine(tile);
  }

  canRenderWithoutLosingDetail(tile) {
    return tile.renderable && tile.state === QuadtreeTileLoadState.DONE;
  }

  showTileThisFrame(tile) {
    let source = tile;
    while (source && !source.data?.gpu) {
      source = source.parent;
    }
    if (source) {
      // During rapid pans native traversal can select a not-yet-loaded child.
      // Draw only its rectangle from a ready ancestor, retaining coverage.
      this._renderer.addTile(source, tile.rectangle);
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
            data.gpu = this._renderer.createTile(mesh);
            data.terrainState = TerrainState.READY;
            ++this.statistics.meshes;
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
    tile.renderable = true;
    tile.upsampledFromParent = data.terrainData.wasCreatedByUpsampling();
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

export default WebGPUGlobeTileProvider;
