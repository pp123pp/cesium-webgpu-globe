import assert from "node:assert/strict";
import { test } from "node:test";
import Renderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";
import { createAtmosphereParameters } from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";

test("lens controls default off and belong to each renderer", () => {
  const a = new Renderer({});
  const b = new Renderer({});
  assert.deepEqual(a.lensFlare, { enabled: false, strength: 1, diffusion: 1, diffusionSize: 0.7, reflection: 1 });
  a.lensFlare.enabled = true;
  assert.equal(b.lensFlare.enabled, false);
  assert.equal(a.statistics.lensFlareTextureBytes, 0);
});

test("invalid mutable lens controls fail at the update boundary", () => {
  for (const [key, value] of [["strength", NaN], ["strength", -1], ["strength", 5], ["diffusion", -1], ["reflection", Infinity], ["enabled", 1]]) {
    const renderer = new Renderer({});
    renderer.lensFlare[key] = value;
    assert.throws(() => renderer.update({}, { show: false }), /Lens flare/);
  }
  for (const value of [NaN, Infinity, 0, 0.09, 2.01]) {
    const renderer = new Renderer({});
    renderer.lensFlare.diffusionSize = value;
    assert.throws(() => renderer.update({}, { show: false }), /Lens flare diffusionSize/);
  }
});

test("diffusion size changes upload through the existing display uniform", () => {
  const writes = [];
  const renderer = new Renderer({ drawingBufferWidth: 640, drawingBufferHeight: 360 });
  renderer._device = { queue: { writeBuffer: (buffer, offset, values) => writes.push({ buffer, offset, values: [...values] }) } };
  renderer._planetBuffer = {};
  renderer._parametersBuffer = {};
  renderer._postParametersBuffer = {};
  renderer._sunPipeline = {};
  const state = { uniformValues: new Float32Array(68), planet: { maximumRadius: 6378137, atmosphereHeight: 100000 } };
  const atmosphere = createAtmosphereParameters({ show: false });
  const sun = { show: true, angularRadius: 0.00465, displayScale: 3.3964295e-5, glowStrength: 0.08, glowRadius: 0.05 };
  for (const size of [0.1, 0.7, 1, 2]) {
    renderer.lensFlare.diffusionSize = size;
    assert.equal(renderer.update(state, atmosphere, sun), true);
    const upload = writes.findLast((write) => write.buffer === renderer._postParametersBuffer);
    assert.equal(upload.offset, 0);
    assert.equal(upload.values.length, 4, "Existing 16-byte display buffer is reused");
    assert.equal(upload.values[2], Math.fround(size));
    assert.equal(upload.values[0], 1, "Exposure remains independent");
    assert.equal(upload.values[1], Math.fround(0.35), "Bloom strength remains independent");
  }
  assert.equal(renderer.statistics.texturesCreated, 0);
});
