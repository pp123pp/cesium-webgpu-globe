// Exercise the actual Context pass routing/lifetime at the device boundary.
// Rendering and GPU validation are independently exercised by the browser gate.
import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUContext from "../../packages/engine/Source/Renderer/WebGPUContext.js";

function fixture(t) {
  const previous = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = {
    RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1,
  };
  t.after(() => { globalThis.GPUTextureUsage = previous; });
  const textures = [];
  const events = [];
  const target = { createView: () => ({ target: true }) };
  const device = {
    limits: { maxTextureDimension2D: 4096 },
    createTexture(descriptor) {
      const texture = {
        descriptor, destroyed: false,
        createView() { return { texture: this }; },
        destroy() { this.destroyed = true; },
      };
      textures.push(texture);
      return texture;
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor) {
          events.push({ kind: "begin", descriptor });
          return { end() { events.push({ kind: "end" }); } };
        },
        finish() { return {}; },
      };
    },
    queue: { submit() { events.push({ kind: "submit" }); } },
    removeEventListener() {},
    destroy() {},
  };
  const context = Object.assign(Object.create(WebGPUContext.prototype), {
    _globe: true, _ready: true, _format: "bgra8unorm", _device: device,
    canvas: { width: 1, height: 1 },
    _canvasContext: { getCurrentTexture() { return target; } },
    renderError: { raiseEvent() {} },
  });
  context.resize(800, 600);
  t.after(() => context.destroy());
  return { context, textures, events };
}

test("atmosphere reads completed color/depth after the opaque pass; disabled path stays direct", (t) => {
  const { context, events } = fixture(t);
  let composite;
  context.render(() => {}, undefined, (encoder, view, color, depth) => {
    assert.equal(typeof encoder.beginRenderPass, "function");
    composite = { view, color, depth };
    assert.equal(events.at(-1).kind, "end", "attachment writes ended before sampling");
    assert.notEqual(color, depth);
  });
  assert.ok(composite, "the real Context must execute the atmosphere consumer");
  assert.equal(composite.color, context.sceneColorTexture);
  assert.equal(composite.depth, context.sceneDepthTexture);
  assert.equal(events[0].descriptor.colorAttachments[0].view.texture, composite.color);
  assert.ok(composite.view.target);
  assert.equal(events.at(-1).kind, "submit");
  events.length = 0;
  context.render(() => {});
  assert.ok(events[0].descriptor.colorAttachments[0].view.target);
});

test("resize and failure release the atmosphere color attachment with scene depth", (t) => {
  const { context, textures } = fixture(t);
  context.render(() => {}, undefined, () => {});
  const color = context.sceneColorTexture;
  assert.ok(color, "composition allocates a readable color attachment");
  assert.equal(color.descriptor.format, "rgba16float", "scene composition retains linear HDR precision");
  assert.equal(color.descriptor.usage & 4, 4);
  const depth = context.sceneDepthTexture;
  context.resize(640, 480);
  assert.ok(color.destroyed && depth.destroyed);
  context.render(() => {}, undefined, () => {});
  assert.notEqual(context.sceneColorTexture, color);
  const count = textures.length;
  context.resize(640, 480);
  context.render(() => {}, undefined, () => {});
  assert.equal(textures.length, count, "unchanged dimensions reuse attachments");
  assert.throws(() => context.render(() => {}, undefined, () => { throw new Error("composite failure"); }), /composite failure/);
  assert.ok(textures.every((texture) => texture.destroyed));
});
