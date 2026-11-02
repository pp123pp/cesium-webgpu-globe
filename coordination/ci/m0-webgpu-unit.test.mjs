// Exceptional GPU lifecycle paths, using a small device boundary double.
// Real drawing and browser API validation are covered by m0-webgpu-smoke.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUContext from "../../packages/engine/Source/Renderer/WebGPUContext.js";
import WebGPUWidget from "../../packages/engine/Source/Widget/WebGPUWidget.js";

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture(t, overrides = {}) {
  const lost = deferred();
  const textures = [];
  const device = Object.assign(new EventTarget(), {
    lost: lost.promise,
    limits: { maxTextureDimension2D: 4096 },
    destroyed: false,
    destroy() {
      this.destroyed = true;
      lost.resolve({ reason: "destroyed", message: "test" });
    },
    pushErrorScope() {},
    popErrorScope: async () => null,
    createShaderModule: () => ({}),
    createRenderPipelineAsync: async () => ({}),
    createTexture() {
      const texture = {
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
    ...overrides,
  });
  const canvasContext = {
    configured: false,
    configure() {
      this.configured = true;
    },
    unconfigure() {
      this.configured = false;
    },
  };
  const canvas = { width: 300, height: 150, getContext: () => canvasContext };
  const gpu = {
    requestAdapter: async () => ({ requestDevice: async () => device }),
    getPreferredCanvasFormat: () => "bgra8unorm",
  };
  const previous = Object.getOwnPropertyDescriptor(navigator, "gpu");
  Object.defineProperty(navigator, "gpu", { configurable: true, value: gpu });
  const previousUsage = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16 };
  t.after(() => {
    if (previous) Object.defineProperty(navigator, "gpu", previous);
    else delete navigator.gpu;
    if (previousUsage) globalThis.GPUTextureUsage = previousUsage;
    else delete globalThis.GPUTextureUsage;
  });
  return { device, gpu, canvas, canvasContext, textures };
}

test("destroy while an adapter is pending never requests a device", async (t) => {
  const f = fixture(t);
  const pending = deferred();
  f.gpu.requestAdapter = () => pending.promise;
  const context = new WebGPUContext(f.canvas);
  context.destroy();
  let requests = 0;
  pending.resolve({
    requestDevice() {
      requests++;
      return f.device;
    },
  });
  await assert.rejects(context.readyPromise, /cancelled/);
  assert.equal(requests, 0);
});

test("destroy while a device is pending disposes the late device", async (t) => {
  const f = fixture(t);
  const pending = deferred();
  const started = deferred();
  f.gpu.requestAdapter = async () => ({
    requestDevice() {
      started.resolve();
      return pending.promise;
    },
  });
  const context = new WebGPUContext(f.canvas);
  await started.promise;
  context.destroy();
  pending.resolve(f.device);
  await assert.rejects(context.readyPromise, /cancelled/);
  assert.equal(f.device.destroyed, true);
  assert.equal(f.canvasContext.configured, false);
});

test("destroy while a pipeline is pending never recreates attachments", async (t) => {
  const pipeline = deferred();
  const started = deferred();
  const f = fixture(t, {
    createRenderPipelineAsync() {
      started.resolve();
      return pipeline.promise;
    },
  });
  const context = new WebGPUContext(f.canvas);
  await started.promise;
  context.destroy();
  pipeline.resolve({});
  await assert.rejects(context.readyPromise, /cancelled/);
  assert.equal(f.device.destroyed, true);
  assert.equal(f.canvasContext.configured, false);
  assert.equal(f.textures.length, 0);
});

test("pipeline rejection reports failure and releases the device", async (t) => {
  const f = fixture(t, {
    createRenderPipelineAsync: async () => {
      throw new Error("pipeline invalid");
    },
  });
  const context = new WebGPUContext(f.canvas);
  const errors = [];
  context.renderError.addEventListener((source, error) => errors.push(error));
  await assert.rejects(context.readyPromise, /pipeline invalid/);
  assert.equal(errors.length, 1);
  assert.equal(f.device.destroyed, true);
  assert.equal(f.canvasContext.configured, false);
});

test("scoped validation errors reject readiness and dispose attachments", async (t) => {
  const f = fixture(t, {
    popErrorScope: async () => ({ message: "invalid attachment" }),
  });
  const context = new WebGPUContext(f.canvas);
  await assert.rejects(context.readyPromise, /invalid attachment/);
  assert.equal(f.device.destroyed, true);
  assert.ok(f.textures.every((texture) => texture.destroyed));
});

test("missing canvas context does not leak the acquired device", async (t) => {
  const f = fixture(t);
  f.canvas.getContext = () => null;
  const context = new WebGPUContext(f.canvas);
  await assert.rejects(context.readyPromise, /canvas context/);
  assert.equal(f.device.destroyed, true);
});

test("resize allocation failure is observable and releases GPU resources", async (t) => {
  const f = fixture(t);
  const context = new WebGPUContext(f.canvas);
  await context.readyPromise;
  const errors = [];
  context.renderError.addEventListener((source, error) => errors.push(error));
  f.device.createTexture = () => {
    throw new Error("resize allocation failed");
  };
  assert.throws(() => context.resize(640, 360), /resize allocation failed/);
  assert.equal(
    errors.length,
    1,
    "Resize errors must be emitted, not only caught by the loop",
  );
  assert.equal(f.device.destroyed, true);
  assert.equal(f.canvasContext.configured, false);
});

test("resize clamps texture dimensions and destroys replaced attachments", async (t) => {
  const f = fixture(t);
  const context = new WebGPUContext(f.canvas);
  await context.readyPromise;
  context.resize(9000, 5000);
  assert.deepEqual([f.canvas.width, f.canvas.height], [4096, 4096]);
  assert.equal(f.textures[0].destroyed, true);
  context.destroy();
  assert.ok(f.textures.every((texture) => texture.destroyed));
});

test("initial widget resize failure rejects readiness and releases resources", async (t) => {
  const f = fixture(t);
  const previousDocument = globalThis.document;
  const element = () => ({
    style: {},
    appendChild() {},
    remove() {},
    setAttribute() {},
  });
  globalThis.document = {
    createElement: (name) =>
      name === "canvas" ? Object.assign(f.canvas, element()) : element(),
  };
  t.after(() => {
    if (previousDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  });
  const container = {
    appendChild() {},
    get clientWidth() {
      throw new Error("layout unavailable");
    },
  };
  const widget = new WebGPUWidget(container, { useDefaultRenderLoop: false });
  const errors = [];
  widget.renderError.addEventListener((source, error) => errors.push(error));
  await assert.rejects(widget.readyPromise, /layout unavailable/);
  assert.equal(errors.length, 1);
  assert.equal(f.device.destroyed, true);
  assert.equal(f.canvasContext.configured, false);
  widget.destroy();
});
