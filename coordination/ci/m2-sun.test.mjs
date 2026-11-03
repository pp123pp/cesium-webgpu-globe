import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUAtmosphereRenderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";
import { createAtmosphereParameters } from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";
import { createSunParameters, sunDisplayRadiance } from "../../packages/engine/Source/Scene/WebGPUSun.js";

test("shared irradiance controls finite solar radiance and invalid mutable settings are rejected", () => {
  const settings = createSunParameters();
  assert.ok(Math.abs(sunDisplayRadiance(settings, 10) - 5) < 1e-12);
  assert.ok(Math.abs(sunDisplayRadiance(settings, 5) - 2.5) < 1e-12);
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
  const sun = { show: true, angularRadius: 0.00465, displayScale: 3.3964295e-5, glowStrength: 0.025, glowRadius: 0.025 };
  const atmosphere = createAtmosphereParameters({ show: false });
  const state = { uniformValues: new Float32Array(68), planet: { maximumRadius: 6378137, atmosphereHeight: 100000 } };
  assert.equal(renderer.update(state, atmosphere, sun), true);
  assert.equal(writes.length, 2);
  assert.equal(renderer.statistics.lutBuilds, 0);
  assert.equal(renderer.statistics.texturesCreated, 0);
  assert.equal(renderer._activePipeline, renderer._sunPipeline);
  assert.equal(renderer._parametersValues[20], 1, "default exposure is uploaded independently");
  assert.equal(renderer.update(state, atmosphere, sun, undefined, undefined, 2), true);
  assert.equal(renderer._parametersValues[20], 2, "runtime exposure updates the display pass uniform");
  assert.throws(() => renderer.update(state, atmosphere, sun, undefined, undefined, 17), /exposure/);
  // A hidden, partially edited medium must not shift the visible Sun ABI.
  atmosphere.rayleighScattering = [];
  assert.equal(renderer.update(state, atmosphere, sun), true);
  assert.deepEqual(Array.from(renderer._parametersValues.slice(12, 16)), [640, 360, 0, 1]);
  const before = writes.length;
  sun.show = false;
  assert.equal(renderer.update(state, atmosphere, sun), true);
  assert.equal(renderer._activePipeline, renderer._sunPipeline);
  assert.equal(writes.length, before + 2);
});
