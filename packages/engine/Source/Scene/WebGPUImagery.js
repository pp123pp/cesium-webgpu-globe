import { RuntimeError } from "@cesium/core";
import Request from "../Core/Request.js";
import RequestState from "../Core/RequestState.js";
import RequestType from "../Core/RequestType.js";
import TileProviderError from "../Core/TileProviderError.js";
import ImageryState from "./ImageryState.js";

/**
 * Adapts native imagery cache entries without invoking WebGL texture/reprojection
 * paths. TileImagery retains ownership of associations and ancestor fallback.
 * @private
 */
class WebGPUImagery {
  constructor(tileProvider, renderer) {
    this._tileProvider = tileProvider;
    this._renderer = renderer;
    this._records = new Map();
    this._initializedTiles = new WeakSet();
    this._processingAssociations = 0;
    this._destroyed = false;
    this.statistics = {
      requests: 0,
      deferred: 0,
      failed: 0,
      discarded: 0,
      imagesClosed: 0,
      pendingRequests: 0,
      texturesCreated: 0,
      texturesDestroyed: 0,
      activeTextures: 0,
    };
  }

  updateTile(tile, frameState) {
    const data = tile.data;
    if (this._destroyed || data.released) {
      return false;
    }
    const associations = data.imagery;
    if (!this._initializedTiles.has(data)) {
      // Native layer-added handlers can already have created associations while
      // the terrain was loading. Complete only the missing layers.
      const existing = new Set(
        associations.map(
          (entry) => (entry.loadingImagery ?? entry.readyImagery).imageryLayer,
        ),
      );
      const layers = this._tileProvider._imageryLayers;
      for (let i = 0; i < layers.length; ++i) {
        const layer = layers.get(i);
        if (layer.show && !existing.has(layer)) {
          const insertionPoint = associations.findIndex(
            (entry) =>
              (entry.loadingImagery ?? entry.readyImagery).imageryLayer
                ._layerIndex > layer._layerIndex,
          );
          layer._createTileImagerySkeletons(
            tile,
            this._tileProvider.terrainProvider,
            insertionPoint < 0 ? associations.length : insertionPoint,
          );
        }
      }
      this._initializedTiles.add(data);
    }

    let complete = true;
    for (let i = 0; i < associations.length; ++i) {
      const association = associations[i];
      const loading = association.loadingImagery;
      if (loading === undefined) {
        continue;
      }
      if (loading.state === ImageryState.PLACEHOLDER) {
        const layer = loading.imageryLayer;
        if (!layer.ready) {
          complete = false;
          continue;
        }
        association.freeResources();
        associations.splice(i, 1);
        // The collection's ready event can already have asked the native
        // provider to create real associations for this layer.
        const hasSkeletons = associations.some(
          (entry) =>
            (entry.loadingImagery ?? entry.readyImagery).imageryLayer ===
              layer && entry.loadingImagery?.state !== ImageryState.PLACEHOLDER,
        );
        if (!hasSkeletons) {
          layer._createTileImagerySkeletons(
            tile,
            this._tileProvider.terrainProvider,
            i,
          );
        }
        --i;
        continue;
      }
      this._decorate(loading);
      let done;
      ++this._processingAssociations;
      try {
        done = association.processStateMachine(tile, frameState, false);
      } finally {
        --this._processingAssociations;
      }
      complete = complete && done;
    }
    return complete;
  }

  _decorate(imagery) {
    if (this._records.has(imagery)) {
      return;
    }
    if (imagery.parent) {
      this._decorate(imagery.parent);
    }
    const record = {
      imagery,
      provider: imagery.imageryLayer.imageryProvider,
      active: true,
      request: undefined,
      texture: undefined,
      error: undefined,
    };
    this._records.set(imagery, record);
    imagery.processStateMachine = (
      frameState,
      needGeographicProjection,
      skipLoading,
    ) => {
      if (!this._isActive(record)) {
        return;
      }
      if (imagery.state === ImageryState.UNLOADED && !skipLoading) {
        this._request(record);
      }
      if (imagery.state === ImageryState.RECEIVED) {
        this._upload(record);
      }
    };
    const releaseReference = imagery.releaseReference;
    imagery.releaseReference = () => {
      if (imagery.referenceCount === 1) {
        this._release(record);
      }
      return releaseReference.call(imagery);
    };
  }

  _isActive(record) {
    return (
      !this._destroyed &&
      record.active &&
      !record.imagery.imageryLayer.isDestroyed()
    );
  }

  _finishRequest(record, request) {
    if (record.request !== request) {
      return false;
    }
    record.request = undefined;
    record.imagery.request = undefined;
    --this.statistics.pendingRequests;
    return true;
  }

  _request(record) {
    const { imagery, provider } = record;
    const request = new Request({
      throttle: false,
      throttleByServer: true,
      type: RequestType.IMAGERY,
    });
    record.request = request;
    imagery.request = request;
    imagery.state = ImageryState.TRANSITIONING;
    ++this.statistics.pendingRequests;
    let promise;
    try {
      promise = provider.requestImage(
        imagery.x,
        imagery.y,
        imagery.level,
        request,
      );
    } catch (error) {
      this._finishRequest(record, request);
      this._failure(record, error);
      return;
    }
    if (promise === undefined) {
      this._finishRequest(record, request);
      if (this._isActive(record)) {
        imagery.state = ImageryState.UNLOADED;
      }
      ++this.statistics.deferred;
      return;
    }
    ++this.statistics.requests;
    Promise.resolve(promise).then(
      (image) => {
        const current = this._finishRequest(record, request);
        if (
          !current ||
          !this._isActive(record) ||
          request.cancelled ||
          request.state === RequestState.CANCELLED
        ) {
          this._closeImage(image);
          if (current && this._isActive(record)) {
            imagery.state = ImageryState.UNLOADED;
          }
          return;
        }
        if (image === undefined) {
          this._failure(
            record,
            new RuntimeError("Imagery request returned no image."),
          );
          return;
        }
        imagery.image = image;
        try {
          imagery.credits = provider.getTileCredits?.(
            imagery.x,
            imagery.y,
            imagery.level,
          );
          imagery.state = ImageryState.RECEIVED;
          TileProviderError.reportSuccess(record.error);
        } catch (error) {
          this._releaseImage(imagery);
          this._failure(record, error);
        }
      },
      (error) => {
        if (!this._finishRequest(record, request) || !this._isActive(record)) {
          return;
        }
        if (request.cancelled || request.state === RequestState.CANCELLED) {
          imagery.state = ImageryState.UNLOADED;
          return;
        }
        this._failure(record, error);
      },
    );
  }

  _failure(record, error) {
    if (!this._isActive(record)) {
      return;
    }
    if (this._processingAssociations > 0) {
      // A synchronous request/upload failure is still inside TileImagery's
      // native state machine. Its error listener may remove the layer or
      // destroy the provider. Finish that stack before notifying the listener,
      // and keep this tile loading so a listener-requested retry is not lost.
      record.imagery.state = ImageryState.TRANSITIONING;
      queueMicrotask(() => this._failure(record, error));
      return;
    }
    const { imagery, provider } = record;
    imagery.state = ImageryState.FAILED;
    ++this.statistics.failed;
    record.error = TileProviderError.reportError(
      record.error,
      provider,
      provider.errorEvent,
      `WebGPU imagery tile ${imagery.level}/${imagery.x}/${imagery.y} failed.`,
      imagery.x,
      imagery.y,
      imagery.level,
      error,
    );
    if (this._isActive(record) && record.error.retry) {
      imagery.state = ImageryState.UNLOADED;
    }
  }

  _upload(record) {
    const { imagery, provider } = record;
    try {
      const policy = provider.tileDiscardPolicy;
      if (policy && !policy.isReady()) {
        return;
      }
      if (policy?.shouldDiscardImage(imagery.image)) {
        imagery.state = ImageryState.INVALID;
        ++this.statistics.discarded;
      } else {
        const texture = this._renderer.createImageryTexture(imagery.image);
        ++this.statistics.texturesCreated;
        ++this.statistics.activeTextures;
        if (this._isActive(record)) {
          record.texture = texture;
          // Both properties describe the same native-projection texture. The
          // renderer must inspect provider projection, even when a polar
          // TileImagery has useWebMercatorT=false. No geographic reproject runs.
          imagery.texture = texture;
          imagery.textureWebMercator = texture;
          imagery.state = ImageryState.READY;
        } else {
          this._destroyTexture(texture);
        }
      }
    } catch (error) {
      this._failure(record, error);
    }
    this._releaseImage(imagery);
  }

  _closeImage(image) {
    if (typeof image?.close === "function") {
      image.close();
      ++this.statistics.imagesClosed;
    } else if (typeof image?.destroy === "function") {
      image.destroy();
    }
  }

  _releaseImage(imagery) {
    const image = imagery.image;
    imagery.image = undefined;
    this._closeImage(image);
  }

  _destroyTexture(texture) {
    texture.destroy();
    ++this.statistics.texturesDestroyed;
    --this.statistics.activeTextures;
  }

  _release(record) {
    if (!record.active) {
      return;
    }
    record.active = false;
    this._records.delete(record.imagery);
    if (record.request) {
      record.request.cancel();
      this._finishRequest(record, record.request);
    }
    this._releaseImage(record.imagery);
    if (record.texture) {
      this._destroyTexture(record.texture);
      record.texture = undefined;
    }
    record.imagery.texture = undefined;
    record.imagery.textureWebMercator = undefined;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    for (const record of this._records.values()) {
      this._release(record);
    }
  }
}

export default WebGPUImagery;
