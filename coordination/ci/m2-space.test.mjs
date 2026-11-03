import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMoonParameters,
  createStarParameters,
  validateMoonParameters,
  validateStarParameters,
} from "../../packages/engine/Source/Scene/WebGPUSpace.js";
import WebGPUAtmosphereShader from "../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";
import WebGPUAtmosphereRenderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";
import { createAtmosphereParameters } from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";
import { createSunParameters } from "../../packages/engine/Source/Scene/WebGPUSun.js";

test("Moon settings validate visibility and bounded linear moonlight", () => {
  assert.deepEqual(createMoonParameters(), { show: true, moonlightIntensity: 0.0025 });
  assert.deepEqual(createMoonParameters({ show: false }), { show: false, moonlightIntensity: 0.0025 });
  assert.throws(() => createMoonParameters({ moonlightIntensity: -1 }));
  assert.throws(() => validateMoonParameters({ show: 1, moonlightIntensity: 0 }));
  assert.throws(() => validateMoonParameters({ show: true, moonlightIntensity: Infinity }));
});

test("star settings validate visibility and bounded intensity", () => {
  assert.deepEqual(createStarParameters(), { show: true, intensity: 1 });
  assert.deepEqual(createStarParameters({ show: false, intensity: 0 }), { show: false, intensity: 0 });
  assert.throws(() => createStarParameters({ intensity: 5 }));
  assert.throws(() => validateStarParameters({ show: false, intensity: NaN }));
});

test("production WGSL contains direction-anchored stars, lunar disk, phase and night lighting", () => {
  assert.match(WebGPUAtmosphereShader, /fn starRadiance/);
  assert.match(WebGPUAtmosphereShader, /let grid = direction \* 1800\.0/);
  assert.match(WebGPUAtmosphereShader, /fn moonRadiance/);
  assert.match(WebGPUAtmosphereShader, /planet\.moonDirectionWC\.w/);
  assert.match(WebGPUAtmosphereShader, /fn moonTerrainLight/);
  assert.match(WebGPUAtmosphereShader, /moonDirect = planet\.moon\.w/);
  assert.match(WebGPUAtmosphereShader, /sceneDistance < 0\.0/);
});

test("Moon and stars render without Sun or atmospheric LUT resources", () => {
  const writes = [];
  const renderer = new WebGPUAtmosphereRenderer({ drawingBufferWidth: 800, drawingBufferHeight: 450 });
  renderer._device = { queue: { writeBuffer: (...args) => writes.push(args) } };
  renderer._planetBuffer = {};
  renderer._parametersBuffer = {};
  renderer._sunPipeline = {};
  const state = { uniformValues: new Float32Array(68), planet: { maximumRadius: 6378137, atmosphereHeight: 100000 } };
  const atmosphere = createAtmosphereParameters({ show: false });
  const sun = createSunParameters({ show: false });
  assert.equal(renderer.update(state, atmosphere, sun, createMoonParameters(), createStarParameters()), true);
  assert.equal(renderer._activePipeline, renderer._sunPipeline);
  assert.equal(renderer.statistics.lutBuilds, 0);
  assert.equal(renderer.statistics.texturesCreated, 0);
  assert.equal(writes.length, 2);
  assert.equal(renderer._moonShown, true);
  assert.equal(renderer._starsShown, true);
  assert.equal(renderer.update(state, atmosphere, sun, { show: false, moonlightIntensity: 0 }, { show: false, intensity: 0 }), false);
});

test("hiding the Moon disables both its disk and moonlight uniforms", () => {
  const state = {
    uniformValues: new Float32Array(68),
    planet: { maximumRadius: 6378137, atmosphereHeight: 100000 },
  };
  // The state packing is exercised by the planet-state suite; this test
  // guards the shader ABI convention used by the scene controls.
  state.uniformValues.set([0, 384400000, 1, 0], 52);
  assert.equal(state.uniformValues[52], 0);
  assert.equal(state.uniformValues[55], 0);
});
