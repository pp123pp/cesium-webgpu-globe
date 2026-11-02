import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUGlobeRenderer from "../../packages/engine/Source/Scene/WebGPUGlobeRenderer.js";
import TextureMinificationFilter from "../../packages/engine/Source/Renderer/TextureMinificationFilter.js";
import TextureMagnificationFilter from "../../packages/engine/Source/Renderer/TextureMagnificationFilter.js";

function fixture(t, failCopy = false) {
  const usage = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
  t.after(() => { globalThis.GPUTextureUsage = usage; });
  let destroys = 0;
  const copies = [];
  const texture = { createView: () => ({}), destroy() { ++destroys; } };
  const renderer = new WebGPUGlobeRenderer({});
  renderer._device = {
    limits: { maxTextureDimension2D: 4096 },
    createTexture: () => texture,
    queue: { copyExternalImageToTexture(...args) {
      if (failCopy) { throw new Error("image upload failed"); }
      copies.push(args);
    } },
  };
  return { renderer, copies, destroys: () => destroys };
}

test("image upload failure destroys its texture and restores memory accounting", (t) => {
  const { renderer, destroys } = fixture(t, true);
  assert.throws(() => renderer.createImageryTexture({ width: 256, height: 256 }), /upload failed/);
  assert.equal(destroys(), 1);
  assert.equal(renderer.statistics.textureBytes, 0);
  assert.equal(renderer.statistics.texturesCreated, renderer.statistics.texturesDestroyed);
  renderer.destroy();
  assert.equal(destroys(), 1);
});

test("native layer minification and magnification filters select a shared matching sampler", () => {
  const renderer = new WebGPUGlobeRenderer({});
  let created = 0;
  renderer._device = { createSampler: (descriptor) => ({ ...descriptor, id: ++created }) };
  const layer = { minificationFilter: TextureMinificationFilter.NEAREST,
    magnificationFilter: TextureMagnificationFilter.LINEAR };
  const mixed = renderer._getSampler(layer);
  assert.equal(mixed.minFilter, "nearest");
  assert.equal(mixed.magFilter, "linear");
  assert.equal(renderer._getSampler(layer), mixed);
  layer.magnificationFilter = TextureMagnificationFilter.NEAREST;
  assert.equal(renderer._getSampler(layer).magFilter, "nearest");
  assert.equal(created, 2);
  layer.minificationFilter = TextureMinificationFilter.LINEAR_MIPMAP_LINEAR;
  assert.throws(() => renderer._getSampler(layer), /NEAREST or LINEAR/);
});

test("HTML images flip once; already flipped ImageBitmaps do not; teardown is idempotent", (t) => {
  const previous = globalThis.ImageBitmap;
  globalThis.ImageBitmap = class { constructor() { this.width = 128; this.height = 64; } };
  t.after(() => { globalThis.ImageBitmap = previous; });
  const { renderer, copies, destroys } = fixture(t);
  const image = renderer.createImageryTexture({ width: 16, height: 16, naturalWidth: 256, naturalHeight: 128 });
  const bitmap = renderer.createImageryTexture(new globalThis.ImageBitmap());
  assert.equal(copies[0][0].flipY, true);
  assert.equal(copies[1][0].flipY, false);
  assert.deepEqual([image.width, image.height], [256, 128]);
  assert.equal(renderer.statistics.textureBytes, 256 * 128 * 4 + 128 * 64 * 4);
  image.destroy(); image.destroy();
  assert.equal(destroys(), 1);
  renderer.destroy(); bitmap.destroy();
  assert.equal(destroys(), 2);
  assert.equal(renderer.statistics.textureBytes, 0);
});
