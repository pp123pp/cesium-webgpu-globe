import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUAtmosphereRenderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";
import { createAtmosphereParameters } from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";
import { createSunParameters, sunDisplayRadiance } from "../../packages/engine/Source/Scene/WebGPUSun.js";

test("shared irradiance controls finite solar radiance and invalid mutable settings are rejected", () => {
  const settings = createSunParameters();
  assert.ok(Math.abs(sunDisplayRadiance(settings, 10) - 1) < 1e-12);
  assert.ok(Math.abs(sunDisplayRadiance(settings, 5) - 0.5) < 1e-12);
  assert.equal(sunDisplayRadiance(settings, 0), 0);
  for (const [key, value] of [["angularRadius", 0], ["angularRadius", NaN], ["displayScale", -1], ["glowStrength", Infinity], ["glowRadius", 0.001]]) {
    assert.throws(() => sunDisplayRadiance({ ...settings, [key]: value }, 10));
  }
  assert.throws(() => sunDisplayRadiance(settings, NaN));
  assert.throws(() => sunDisplayRadiance(settings, -1));
});

// Catch the old atmosphere-only early return: a visible Sun must still update
// and draw when the medium is disabled, without building/uploading medium LUTs.
test("Sun-only updates use the existing uniforms without creating medium resources", () => {
  const writes = [];
  const renderer = new WebGPUAtmosphereRenderer({ drawingBufferWidth: 640, drawingBufferHeight: 360 });
  renderer._device = { queue: { writeBuffer: (...args) => writes.push(args) } };
  renderer._planetBuffer = {};
  renderer._parametersBuffer = {};
  renderer._sunPipeline = {};
  const sun = { show: true, angularRadius: 0.00465, displayScale: 6.792859e-6, glowStrength: 0.025, glowRadius: 0.025 };
  const atmosphere = createAtmosphereParameters({ show: false });
  const state = { uniformValues: new Float32Array(48), planet: { maximumRadius: 6378137, atmosphereHeight: 100000 } };
  assert.equal(renderer.update(state, atmosphere, sun), true);
  assert.equal(writes.length, 2);
  assert.equal(renderer.statistics.lutBuilds, 0);
  assert.equal(renderer.statistics.texturesCreated, 0);
  assert.equal(renderer._activePipeline, renderer._sunPipeline);
  const before = writes.length;
  sun.show = false;
  assert.equal(renderer.update(state, atmosphere, sun), false);
  assert.equal(writes.length, before);
});
