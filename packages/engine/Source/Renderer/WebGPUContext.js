import { Event, RuntimeError } from "@cesium/core";
import WebGPUDepth from "./WebGPUDepth.js";

// Near RGB triangle first, far magenta triangle second: depth, not draw order,
// must keep the RGB triangle visible. WebGPU clip-space depth is in [0, 1].
const triangleShader = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}
@vertex fn vertexMain(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> VertexOutput {
  let positions = array<vec2f, 3>(vec2f(0.0, 0.7), vec2f(-0.7, -0.7), vec2f(0.7, -0.7));
  let colors = array<vec3f, 3>(vec3f(1, 0, 0), vec3f(0, 1, 0), vec3f(0, 0, 1));
  var output: VertexOutput;
  output.position = vec4f(positions[vertex], select(0.25, 0.75, instance == 1u), 1.0);
  output.color = select(colors[vertex], vec3f(1, 0, 1), instance == 1u);
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}`;

/**
 * Device/canvas owner for the isolated WebGPU backend, not a WebGL Context.
 * @private
 */
class WebGPUContext {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this._globe = options.globe ?? false;
    this.renderError = new Event();
    this._destroyed = false;
    this._ready = false;
    this._error = undefined;
    this._configured = false;
    this._onUncapturedError = (event) => {
      event.preventDefault();
      this._fail(new RuntimeError(`WebGPU ${event.error.message}`));
    };
    this.readyPromise = this._initialize().catch((error) => {
      if (!this._destroyed) {
        this._fail(error);
      }
      this._release();
      throw error;
    });
    // A caller may destroy a Viewer before attaching its readiness handler.
    // Keep the original promise rejected for callers that await it.
    this.readyPromise.catch(() => {});
  }

  _checkAlive() {
    if (this._destroyed) {
      throw new RuntimeError("WebGPU initialization cancelled by destroy().");
    }
    if (this._error) {
      throw this._error;
    }
  }

  async _initialize() {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) {
      throw new RuntimeError(
        "WebGPU is unavailable. Use a supported browser and a secure context.",
      );
    }
    const adapter = await gpu.requestAdapter();
    this._checkAlive();
    if (!adapter) {
      throw new RuntimeError("No WebGPU adapter is available.");
    }
    this._adapter = adapter;
    const device = await adapter.requestDevice();
    if (this._destroyed) {
      device.destroy();
      this._checkAlive();
    }
    this._device = device;
    device.addEventListener("uncapturederror", this._onUncapturedError);
    device.lost.then((info) => {
      if (!this._destroyed && !this._error) {
        this._fail(
          new RuntimeError(
            `WebGPU device lost (${info.reason}): ${info.message}`,
          ),
        );
      }
    });
    this._canvasContext = this.canvas.getContext("webgpu");
    if (!this._canvasContext) {
      throw new RuntimeError("Cannot acquire a WebGPU canvas context.");
    }
    this._format = gpu.getPreferredCanvasFormat();
    device.pushErrorScope("validation");
    let validationError;
    try {
      this._canvasContext.configure({
        device,
        format: this._format,
        alphaMode: "opaque",
      });
      this._configured = true;
      if (!this._globe) {
        const shader = device.createShaderModule({
          label: "M0 triangle WGSL",
          code: triangleShader,
        });
        this._pipeline = await device.createRenderPipelineAsync({
          label: "M0 color and depth proof",
          layout: "auto",
          vertex: { module: shader, entryPoint: "vertexMain" },
          fragment: {
            module: shader,
            entryPoint: "fragmentMain",
            targets: [{ format: this._format }],
          },
          primitive: { topology: "triangle-list" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
          },
        });
      }
      this._checkAlive();
      this.resize(this.canvas.width, this.canvas.height);
    } finally {
      validationError = await device.popErrorScope();
    }
    this._checkAlive();
    if (validationError) {
      throw new RuntimeError(`WebGPU validation: ${validationError.message}`);
    }
    this._ready = true;
  }

  resize(width, height) {
    this._checkAlive();
    if (!this._device) {
      return;
    }
    const max = this._device.limits.maxTextureDimension2D;
    width = Math.max(1, Math.min(max, Math.floor(width)));
    height = Math.max(1, Math.min(max, Math.floor(height)));
    if (
      this._depthTexture &&
      this.canvas.width === width &&
      this.canvas.height === height
    ) {
      return;
    }
    try {
      this._depthTexture?.destroy();
      this._sceneColorTexture?.destroy();
      this._sceneColorTexture = undefined;
      this.canvas.width = width;
      this.canvas.height = height;
      this._depthTexture = this._device.createTexture({
        label: this._globe ? "WGS84 reversed depth" : "M0 depth attachment",
        size: [width, height],
        format: this._globe ? WebGPUDepth.format : "depth24plus",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          (this._globe ? GPUTextureUsage.TEXTURE_BINDING : 0),
      });
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  get drawingBufferWidth() {
    return this.canvas.width;
  }

  get drawingBufferHeight() {
    return this.canvas.height;
  }

  // Acquire again after resize. Read only in a subsequent pass, never while
  // this texture is attached for depth writing. M0's proof is deliberately separate.
  get sceneDepthTexture() {
    return this._globe ? this._depthTexture : undefined;
  }

  get sceneColorTexture() {
    return this._sceneColorTexture;
  }

  // The atmosphere/Sun consumer needs this intermediate. The original direct
  // canvas path (including the M0 proof) retains its format and behavior.
  _getSceneColorTexture() {
    if (!this._sceneColorTexture) {
      this._sceneColorTexture = this._device.createTexture({
        label: "M2 completed terrain color",
        size: [this.canvas.width, this.canvas.height],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
    }
    return this._sceneColorTexture;
  }

  render(draw, backgroundColor, composite) {
    this._checkAlive();
    if (!this._ready) {
      return;
    }
    try {
      const encoder = this._device.createCommandEncoder({
        label: this._globe ? "WGS84 frame" : "M0 frame",
      });
      const target = this._canvasContext.getCurrentTexture().createView();
      const color = composite ? this._getSceneColorTexture() : undefined;
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: color ? color.createView() : target,
            clearValue: backgroundColor
              ? {
                  r: backgroundColor.red,
                  g: backgroundColor.green,
                  b: backgroundColor.blue,
                  a: backgroundColor.alpha,
                }
              : { r: 0.04, g: 0.06, b: 0.1, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: this._depthTexture.createView(),
          depthClearValue: this._globe ? WebGPUDepth.clearValue : 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      if (this._globe) {
        draw?.(pass);
      } else {
        pass.setPipeline(this._pipeline);
        pass.draw(3, 2);
      }
      pass.end();
      // The opaque attachments have finished writing. The atmosphere/Sun pass has
      // a distinct output and no writable depth attachment, avoiding feedback.
      composite?.(encoder, target, color, this._depthTexture);
      this._device.queue.submit([encoder.finish()]);
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  _fail(error) {
    if (this._destroyed || this._error) {
      return;
    }
    this._error = error;
    this._ready = false;
    try {
      this.renderError.raiseEvent(this, error);
    } finally {
      this._release();
    }
  }

  _release() {
    this._depthTexture?.destroy();
    this._depthTexture = undefined;
    this._sceneColorTexture?.destroy();
    this._sceneColorTexture = undefined;
    if (this._configured) {
      this._canvasContext.unconfigure();
      this._configured = false;
    }
    if (this._device) {
      this._device.removeEventListener(
        "uncapturederror",
        this._onUncapturedError,
      );
      this._device.destroy();
      this._device = undefined;
    }
    this._pipeline = undefined;
  }

  destroy() {
    this._destroyed = true;
    this._ready = false;
    this._release();
  }
}

export default WebGPUContext;
