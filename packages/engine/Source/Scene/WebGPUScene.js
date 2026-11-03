import {
  Clock,
  Color,
  DeveloperError,
  Ellipsoid,
  Event,
  GeographicProjection,
  JulianDate,
} from "@cesium/core";
import RequestScheduler from "../Core/RequestScheduler.js";
import buildModuleUrl from "../Core/buildModuleUrl.js";
import Camera from "./Camera.js";
import FrameState from "./FrameState.js";
import Globe from "./Globe.js";
import ImageryLayer from "./ImageryLayer.js";
import TileMapServiceImageryProvider from "./TileMapServiceImageryProvider.js";
import QuadtreePrimitive from "./QuadtreePrimitive.js";
import SceneMode from "./SceneMode.js";
import ScreenSpaceCameraController from "./ScreenSpaceCameraController.js";
import TweenCollection from "./TweenCollection.js";
import WebGPUGlobeRenderer from "./WebGPUGlobeRenderer.js";
import WebGPUGlobeTileProvider from "./WebGPUGlobeTileProvider.js";
import WebGPUImagery from "./WebGPUImagery.js";
import WebGPUPlanetState from "./WebGPUPlanetState.js";
import WebGPUDepth from "../Renderer/WebGPUDepth.js";
import WebGPUAtmosphereRenderer from "./WebGPUAtmosphereRenderer.js";
import { createAtmosphereParameters } from "./WebGPUAtmosphereModel.js";
import { createSunParameters } from "./WebGPUSun.js";
import { createMoonParameters, createStarParameters } from "./WebGPUSpace.js";
import { DEFAULT_EXPOSURE, validateExposure } from "./WebGPUColorPipeline.js";

// Quadtree roots are created lazily, so their absence does not imply that an
// otherwise fresh Globe has no owner. Weak membership does not retain Globes.
const ownedGlobes = new WeakSet();

// Native center-wheel zoom can compute acos(dot(n,n)) > 0 through rounding
// while cross(n,n) is exactly zero. Only that negligible controller rotation is
// a no-op. Preserve the native Camera API, including errors for invalid public
// rotate calls, and leave the default WebGL controller/prototypes unchanged.
export function updateCameraController(camera, controller) {
  const rotate = camera.rotate;
  const ownRotate = Object.hasOwn(camera, "rotate");
  camera.rotate = function (axis, angle) {
    if (
      Number.isFinite(angle) &&
      Math.abs(angle) < 1e-7 &&
      axis?.x === 0 &&
      axis.y === 0 &&
      axis.z === 0
    ) {
      return;
    }
    return rotate.call(this, axis, angle);
  };
  try {
    controller.update();
  } finally {
    if (ownRotate) {
      camera.rotate = rotate;
    } else {
      delete camera.rotate;
    }
  }
}

/**
 * M1 SCENE3D orchestration using native Globe/Camera/provider CPU contracts.
 * It never constructs the WebGL Scene, Context or shader resource path.
 * @private
 */
class WebGPUScene {
  constructor(context, options, creditDisplay, renderError) {
    if (
      options.globe !== undefined &&
      options.globe !== true &&
      !(options.globe instanceof Globe)
    ) {
      throw new DeveloperError(
        "WebGPU globe must be a new Globe, true, or false for the M0 proof.",
      );
    }
    const globe =
      options.globe instanceof Globe
        ? options.globe
        : new Globe(Ellipsoid.WGS84);
    if (
      options.terrainProvider !== undefined &&
      (!options.terrainProvider?.tilingScheme ||
        !globe.ellipsoid.equals(options.terrainProvider.tilingScheme.ellipsoid))
    ) {
      throw new DeveloperError(
        "WebGPU terrain must use the Globe ellipsoid and a ready TerrainProvider.",
      );
    }
    if (
      globe.isDestroyed() ||
      ownedGlobes.has(globe) ||
      globe._surface._levelZeroTiles !== undefined
    ) {
      throw new DeveloperError(
        "WebGPU requires a new Globe that is not owned by another scene.",
      );
    }
    if (options.clock !== undefined && !(options.clock instanceof Clock)) {
      throw new DeveloperError("WebGPU clock must be a Cesium Clock.");
    }
    if (
      options.baseLayer !== undefined &&
      options.baseLayer !== false &&
      !(options.baseLayer instanceof ImageryLayer)
    ) {
      throw new DeveloperError(
        "WebGPU baseLayer must be an ImageryLayer or false.",
      );
    }
    this._globe = globe;
    this.context = context;
    this.canvas = context.canvas;
    this.ellipsoid = globe.ellipsoid;
    this.mapProjection = new GeographicProjection(this.ellipsoid);
    this.mode = SceneMode.SCENE3D;
    this.scene3DOnly = true;
    this.morphTime = 1;
    this.pixelRatio = 1;
    this.verticalExaggeration = 1;
    this.verticalExaggerationRelativeHeight = 0;
    this.pickPositionSupported = false;
    this.cameraUnderground = false;
    this.globeHeight = undefined;
    this.backgroundColor = Color.clone(Color.BLACK);
    this.exposure = validateExposure(options.exposure ?? DEFAULT_EXPOSURE);
    this.clock = options.clock ?? new Clock();
    this.tweens = new TweenCollection();
    this.preUpdate = new Event();
    this.postUpdate = new Event();
    this.preRender = new Event();
    this.postRender = new Event();
    this.renderError = renderError;
    this.rethrowRenderErrors = true;
    this._destroyed = false;
    this._ready = false;
    this.creditDisplay = creditDisplay;
    this.camera = new Camera(this);
    this.camera.frustum.near = WebGPUDepth.defaultNear;
    this.camera.frustum.far = WebGPUDepth.defaultFar;
    this._planetState = new WebGPUPlanetState(this.ellipsoid);
    this.atmosphere = createAtmosphereParameters({
      show: options.skyAtmosphere !== false,
    });
    // Viewer already defines skyBox:false as hiding the Sun as well. This is
    // WebGPU settings, not an instance of the separate native WebGL Sun class.
    this.sun = createSunParameters({ show: options.skyBox !== false });
    this.moon = createMoonParameters({ show: options.skyBox !== false });
    this.stars = createStarParameters({ show: options.skyBox !== false });
    this._atmosphere = new WebGPUAtmosphereRenderer(context);
    this.screenSpaceCameraController = new ScreenSpaceCameraController(this);
    this._renderer = new WebGPUGlobeRenderer(context);
    const baseColor = Color.clone(globe.baseColor);
    globe._surface.destroy();
    this._tileProvider = new WebGPUGlobeTileProvider({
      globe,
      renderer: this._renderer,
    });
    this._tileProvider.baseColor = baseColor;
    globe._surface = new QuadtreePrimitive({
      tileProvider: this._tileProvider,
    });
    this._imagery = new WebGPUImagery(this._tileProvider, this._renderer);
    this._tileProvider._imagery = this._imagery;
    if (options.baseLayer !== false) {
      const layer =
        options.baseLayer ??
        ImageryLayer.fromProviderAsync(
          TileMapServiceImageryProvider.fromUrl(
            buildModuleUrl("Assets/Textures/NaturalEarthII"),
            { credit: "Natural Earth" },
          ),
        );
      globe.imageryLayers.add(layer, 0);
    }
    this._tileProvider.errorEvent.addEventListener((error) =>
      context._fail(error),
    );
    this._removeTerrainChanged = globe.terrainProviderChanged.addEventListener(
      (provider) => {
        if (
          !provider?.tilingScheme ||
          !this.ellipsoid.equals(provider.tilingScheme.ellipsoid)
        ) {
          throw new DeveloperError(
            "WebGPU terrain replacement must preserve the Globe ellipsoid.",
          );
        }
        this._tileProvider.terrainProvider = provider;
      },
    );
    if (options.terrainProvider !== undefined) {
      this.terrainProvider = options.terrainProvider;
    }
    this._frameState = new FrameState(context, creditDisplay, undefined);
    Object.assign(this._frameState, {
      camera: this.camera,
      mapProjection: this.mapProjection,
      globeTranslucencyState: { translucent: false },
      verticalExaggeration: 1,
      verticalExaggerationRelativeHeight: 0,
      pixelRatio: 1,
    });
    this._frameState.fog.enabled = false;
    this._frameState.passes.render = true;
    ownedGlobes.add(globe);
  }

  get globe() {
    return this._globe;
  }
  get drawingBufferWidth() {
    return this.canvas.width;
  }
  get drawingBufferHeight() {
    return this.canvas.height;
  }
  get frameState() {
    return this._frameState;
  }
  get imageryLayers() {
    return this.globe.imageryLayers;
  }
  get terrainProvider() {
    return this.globe.terrainProvider;
  }
  set terrainProvider(value) {
    if (
      !value?.tilingScheme ||
      !this.ellipsoid.equals(value.tilingScheme.ellipsoid)
    ) {
      throw new DeveloperError(
        "WebGPU terrain must use the Globe ellipsoid and a ready TerrainProvider.",
      );
    }
    this.globe.terrainProvider = value;
  }

  async initialize() {
    await this._renderer.initialize();
    await this._atmosphere.initialize();
    this.context._checkAlive();
    this._ready = true;
  }

  resize() {
    if (this.camera.frustum.aspectRatio !== undefined) {
      this.camera.frustum.aspectRatio =
        this.drawingBufferWidth / this.drawingBufferHeight;
    }
    this.pixelRatio =
      this.canvas.clientWidth > 0
        ? this.canvas.width / this.canvas.clientWidth
        : 1;
  }

  initializeFrame() {
    this.tweens.update();
    this.globeHeight = this.globe.getHeight(this.camera.positionCartographic);
    this.cameraUnderground =
      this.globeHeight !== undefined &&
      this.camera.positionCartographic.height < this.globeHeight;
    updateCameraController(this.camera, this.screenSpaceCameraController);
    this.camera.update(SceneMode.SCENE3D);
    this.camera._updateCameraChanged();
  }

  render(time) {
    try {
      this.context._checkAlive();
      if (time === undefined) {
        time = this.clock.tick();
      }
      this._renderFrame(time);
    } catch (error) {
      this.context._fail(error);
      if (this.rethrowRenderErrors) {
        throw error;
      }
    }
  }

  _renderFrame(time) {
    if (!this._ready || this._destroyed) {
      return;
    }
    if (
      this.mode !== SceneMode.SCENE3D ||
      this.verticalExaggeration !== 1 ||
      this.verticalExaggerationRelativeHeight !== 0
    ) {
      throw new DeveloperError(
        "M1 WebGPU supports SCENE3D with unexaggerated terrain.",
      );
    }
    const globe = this.globe;
    if (
      globe.material ||
      globe.clippingPlanes ||
      globe.clippingPolygons ||
      globe.translucency.enabled
    ) {
      throw new DeveloperError(
        "Globe materials, clipping and translucency are outside M1 WebGPU.",
      );
    }
    this.preUpdate.raiseEvent(this, time);
    this.initializeFrame();
    this.resize();
    // Match native Scene: supported event callbacks can change the camera or
    // replace a Provider before culling, tile selection and draw preparation.
    this.postUpdate.raiseEvent(this, time);
    this.preRender.raiseEvent(this, time);
    if (this._destroyed) {
      return;
    }
    const frame = this._frameState;
    ++frame.frameNumber;
    frame.newFrame = true;
    frame.time = JulianDate.clone(time, frame.time);
    this._planetState.update(this.camera, frame.time, this.moon, this.stars);
    frame.pixelRatio = this.pixelRatio;
    frame.cameraUnderground = this.cameraUnderground;
    frame.cullingVolume = this.camera.frustum.computeCullingVolume(
      this.camera.positionWC,
      this.camera.directionWC,
      this.camera.upWC,
    );
    const surface = globe._surface;
    if (!this.ellipsoid.equals(globe.terrainProvider.tilingScheme.ellipsoid)) {
      throw new DeveloperError(
        "WebGPU terrain replacement must preserve the Globe ellipsoid.",
      );
    }
    this._tileProvider.terrainProvider = globe.terrainProvider;
    this._tileProvider.backFaceCulling = globe.backFaceCulling;
    this._tileProvider.showSkirts = globe.showSkirts;
    for (const property of [
      "maximumScreenSpaceError",
      "tileCacheSize",
      "loadingDescendantLimit",
      "preloadAncestors",
      "preloadSiblings",
    ]) {
      surface[property] = globe[property];
    }
    this.creditDisplay?.beginFrame();
    if (this.terrainProvider.credit) {
      this.creditDisplay?.addCreditToNextFrame(this.terrainProvider.credit);
    }
    this._renderer.beginFrame();
    if (globe.show) {
      surface.update(frame);
      surface.beginFrame(frame);
      surface.render(frame);
    }
    this._renderer.render(this);
    if (globe.show) {
      surface.endFrame(frame);
    }
    RequestScheduler.update();
    for (const callback of frame.afterRender.splice(0)) {
      callback();
    }
    this.creditDisplay?.endFrame();
    this.creditDisplay?.update();
    this.postRender.raiseEvent(this, time);
  }

  get debugStatistics() {
    const surface = this.globe._surface;
    return {
      frame: this._frameState.frameNumber,
      selectedTiles: surface._tilesToRender.length,
      levels: this._renderer._draws.map(({ tile }) => tile.level),
      cacheTiles: surface._tileReplacementQueue.count,
      loadedTiles: this._tileProvider._tiles.size,
      terrain: { ...this._tileProvider.statistics },
      imagery: { ...this._imagery.statistics },
      resources: { ...this._renderer.statistics },
      atmosphere: { ...this._atmosphere?.statistics },
    };
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (!this._destroyed) {
      this._destroyed = true;
      this._removeTerrainChanged();
      this.camera.cancelFlight();
      this.tweens.removeAll();
      this.screenSpaceCameraController.destroy();
      const layers = this.globe.imageryLayers;
      this.globe.destroy();
      layers.destroy();
      this._renderer.destroy();
      this._atmosphere?.destroy();
      RequestScheduler.update();
    }
  }
}

export default WebGPUScene;
