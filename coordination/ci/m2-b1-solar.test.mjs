import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUSunShader from "../../packages/engine/Source/Scene/WebGPUSunShader.js";
import { createSunParameters } from "../../packages/engine/Source/Scene/WebGPUSun.js";

test("solar disk uses a normalized limb profile without changing physical Sun parameters", () => {
  const sun = createSunParameters();
  assert.equal(sun.angularRadius, 0.00465);
  assert.equal(sun.displayScale, (Math.PI * Math.sin(0.00465) ** 2) / 2);
  assert.match(WebGPUSunShader, /fn sunDiskProfile\(chord: f32\) -> vec3f/);
  assert.match(WebGPUSunShader, /let limbDarkening = 0\.60;/);
  assert.match(WebGPUSunShader, /1\.0 - limbDarkening \/ 3\.0/);
  assert.match(WebGPUSunShader, /warmWhite = vec3f\(1\.0295226, 0\.9986369, 0\.9265703\)/);
  assert.match(WebGPUSunShader, /vec3f\(sunDiskCoverage\(direction, pixelWidth\)\) \* sunDiskProfile\(chord\)/);
});

test("solar ray layers use fixed independent UV transforms and retain exactly three ray samples", () => {
  assert.match(WebGPUSunShader, /fn solarRayUv\(uv: vec2f, angle: f32, scale: f32\)/);
  assert.match(WebGPUSunShader, /solarRayUv\(uv, 0\.11, 0\.96\)/);
  assert.match(WebGPUSunShader, /solarRayUv\(uv, -0\.19, 1\.07\)/);
  assert.match(WebGPUSunShader, /solarRayUv\(uv, 0\.31, 0\.86\)/);
  const samples = WebGPUSunShader.match(/textureSampleLevel\(solarRays(?:Primary|Fine|Broad)/g) ?? [];
  assert.equal(samples.length, 3);
});
