import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUGlobeRenderer from "../../packages/engine/Source/Scene/WebGPUGlobeRenderer.js";
import WebGPUWidget from "../../packages/engine/Source/Widget/WebGPUWidget.js";
import WebGPUScene from "../../packages/engine/Source/Scene/WebGPUScene.js";

for (const stage of ["map", "copy", "unmap"]) {
  test(`buffer upload failure at ${stage} releases the allocated buffer`, () => {
    let destroyed = 0;
    const buffer = {
      size: 16,
      getMappedRange() {
        if (stage === "map") {
          throw new Error("map failed");
        }
        return new ArrayBuffer(stage === "copy" ? 0 : 16);
      },
      unmap() {
        if (stage === "unmap") {
          throw new Error("unmap failed");
        }
      },
      destroy() {
        ++destroyed;
      },
    };
    const renderer = new WebGPUGlobeRenderer({});
    renderer._device = { createBuffer: () => buffer };
    assert.throws(() =>
      renderer._createBuffer(16, 1, new Float32Array([1, 2, 3, 4]), "test"),
    );
    assert.equal(destroyed, 1);
    assert.equal(renderer.statistics.bufferBytes, 0);
    assert.equal(
      renderer.statistics.buffersCreated,
      renderer.statistics.buffersDestroyed,
    );
  });
}

test("proof mode rejects terrain and clock options before allocating DOM or GPU state", () => {
  for (const option of ["terrainProvider", "clock"]) {
    assert.throws(
      () => new WebGPUWidget({}, { globe: false, [option]: {} }),
      /globe.*false|proof/i,
    );
  }
});

test("uniform growth failure retains old ownership until destruction", (t) => {
  const oldUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
  t.after(() => {
    globalThis.GPUBufferUsage = oldUsage;
  });
  let destroys = 0;
  const renderer = new WebGPUGlobeRenderer({});
  renderer._uniformBuffer = {
    size: 256,
    destroy() {
      ++destroys;
    },
  };
  renderer._uniformStride = 256;
  renderer._draws = [{}, {}];
  renderer.statistics.buffersCreated = 1;
  renderer.statistics.bufferBytes = 256;
  renderer._device = {
    createBuffer() {
      throw new Error("allocation failed");
    },
  };
  assert.throws(() => renderer._draw({}, {}), /allocation failed/);
  renderer.destroy();
  assert.equal(destroys, 1);
  assert.equal(renderer.statistics.bufferBytes, 0);
});

test("direct Scene.render routes clock failures through the render-error policy", () => {
  const expected = new Error("clock tick failed");
  const errors = [];
  const scene = {
    context: { _checkAlive() {}, _fail: (error) => errors.push(error) },
    clock: { tick() { throw expected; } },
    rethrowRenderErrors: false,
    _renderFrame() { assert.fail("A failed clock cannot render a frame"); },
  };
  assert.doesNotThrow(() => WebGPUScene.prototype.render.call(scene));
  assert.deepEqual(errors, [expected]);
  scene.rethrowRenderErrors = true;
  assert.throws(() => WebGPUScene.prototype.render.call(scene), expected);
  assert.deepEqual(errors, [expected, expected]);
});
