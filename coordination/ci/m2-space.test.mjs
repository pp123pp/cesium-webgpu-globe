import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMoonParameters,
  createStarParameters,
  validateMoonParameters,
  validateStarParameters,
} from "../../packages/engine/Source/Scene/WebGPUSpace.js";
import WebGPUAtmosphereShader from "../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";

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
