import { DeveloperError, Event } from "@cesium/core";
import WebGPUContext from "../Renderer/WebGPUContext.js";
import SceneMode from "../Scene/SceneMode.js";

const supportedOptions = new Set([
  "renderingBackend",
  "sceneMode",
  "useDefaultRenderLoop",
  "useBrowserRecommendedResolution",
]);
const disabledOptions = new Set([
  "globe",
  "baseLayer",
  "skyBox",
  "skyAtmosphere",
  "animation",
  "baseLayerPicker",
  "fullscreenButton",
  "vrButton",
  "geocoder",
  "homeButton",
  "infoBox",
  "sceneModePicker",
  "selectionIndicator",
  "timeline",
  "navigationHelpButton",
  "projectionPicker",
  "shadows",
]);

/**
 * DOM and render-loop owner for the experimental M0 proof. No Cesium Scene.
 * @private
 */
class WebGPUWidget {
  constructor(container, options) {
    if (
      options.sceneMode !== undefined &&
      options.sceneMode !== SceneMode.SCENE3D
    ) {
      throw new DeveloperError(
        "The M0 WebGPU proof supports only SceneMode.SCENE3D.",
      );
    }
    for (const key of Object.keys(options)) {
      if (
        !supportedOptions.has(key) &&
        options[key] !== undefined &&
        !(disabledOptions.has(key) && options[key] === false)
      ) {
        throw new DeveloperError(
          `Option ${key} is not supported by the M0 WebGPU proof.`,
        );
      }
    }
    this.container = container;
    this.renderError = new Event();
    this._destroyed = false;
    this._ready = false;
    this._resolutionScale = 1;
    this._useBrowserRecommendedResolution =
      options.useBrowserRecommendedResolution ?? true;
    this._useDefaultRenderLoop = options.useDefaultRenderLoop ?? true;
    const element = document.createElement("div");
    element.className = "cesium-widget";
    element.style.cssText = "width:100%;height:100%;overflow:hidden";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    canvas.setAttribute(
      "aria-label",
      "Experimental WebGPU triangle and depth proof",
    );
    element.appendChild(canvas);
    container.appendChild(element);
    this._element = element;
    this.canvas = canvas;
    this._context = new WebGPUContext(canvas);
    this._context.renderError.addEventListener((context, error) => {
      this._stop();
      this.renderError.raiseEvent(this, error);
    });
    this._tick = () => {
      this._frameId = undefined;
      if (!this._useDefaultRenderLoop || this._destroyed) {
        return;
      }
      try {
        this.resize();
        this.render();
      } catch (error) {
        this._stop();
        this._context._fail(error);
      }
      this._start();
    };
    this.readyPromise = this._context.readyPromise
      .then(() => {
        if (this._destroyed) {
          throw new DeveloperError(
            "WebGPU initialization cancelled by destroy().",
          );
        }
        this._ready = true;
        this.resize();
        this._start();
      })
      .catch((error) => {
        this._stop();
        this._context._fail(error);
        throw error;
      });
    this.readyPromise.catch(() => {});
  }

  get useDefaultRenderLoop() {
    return this._useDefaultRenderLoop;
  }
  set useDefaultRenderLoop(value) {
    if (value && this._context._error) {
      throw this._context._error;
    }
    this._useDefaultRenderLoop = value;
    if (value) {
      this._start();
    } else {
      this._stop();
    }
  }

  get resolutionScale() {
    return this._resolutionScale;
  }
  set resolutionScale(value) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new DeveloperError(
        "resolutionScale must be a finite number greater than zero.",
      );
    }
    this._resolutionScale = value;
    this.resize();
  }

  get useBrowserRecommendedResolution() {
    return this._useBrowserRecommendedResolution;
  }
  set useBrowserRecommendedResolution(value) {
    this._useBrowserRecommendedResolution = value;
    this.resize();
  }

  _start() {
    if (
      this._ready &&
      !this._destroyed &&
      this._useDefaultRenderLoop &&
      this._frameId === undefined
    ) {
      this._frameId = requestAnimationFrame(this._tick);
    }
  }

  _stop() {
    this._useDefaultRenderLoop = false;
    if (this._frameId !== undefined) {
      cancelAnimationFrame(this._frameId);
      this._frameId = undefined;
    }
  }

  resize() {
    if (!this._ready || this._destroyed) {
      return;
    }
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this._canRender = width > 0 && height > 0;
    if (this._canRender) {
      const ratio = this._useBrowserRecommendedResolution
        ? 1
        : window.devicePixelRatio;
      this._context.resize(
        width * ratio * this._resolutionScale,
        height * ratio * this._resolutionScale,
      );
    }
  }

  render() {
    if (this._canRender) {
      this._context.render();
    }
  }

  destroy() {
    this._destroyed = true;
    this._stop();
    this._context.destroy();
    this._element.remove();
  }
}

export default WebGPUWidget;
