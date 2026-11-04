import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUAtmosphereShader from "../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";
import WebGPUSunShader from "../../packages/engine/Source/Scene/WebGPUSunShader.js";

test("B4 attenuates authored solar artwork with physical view-path transmittance only", () => {
  assert.match(WebGPUSunShader, /fn sunRadiance\(direction: vec3f, pixel: vec2i, pixelWidth: f32, viewTransmittance: vec3f\)/);
  assert.match(WebGPUSunShader, /let viewTransmission = dot\(viewTransmittance, vec3f\(0\.2126, 0\.7152, 0\.0722\)\)/);
  assert.match(WebGPUSunShader, /let artworkTransmission = mix\(0\.58, 1\.0, smoothstep\(0\.25, 0\.90, viewTransmission\)\)/);
  assert.match(WebGPUSunShader, /atmosphere\.sun\.y \* \(disk \+\s*\n\s*\(tint \* \(halo \+ rayDetail\) \+ coronaTint \* coronaDetail\) \* visibility \* artworkTransmission\)/);
  assert.match(WebGPUAtmosphereShader, /sunRadiance\(direction, coordinate, pixelWidth, transport\.transmittance\)/);
  assert.match(WebGPUAtmosphereShader, /sunRadiance\(direction, coordinate, pixelWidth, vec3f\(1\.0\)\)/);
});

test("B4 retains physical atmosphere scattering and the existing HDR output order", () => {
  assert.match(WebGPUAtmosphereShader, /transport\.radiance/);
  assert.match(WebGPUAtmosphereShader, /transport\.transmittance/);
  assert.match(WebGPUAtmosphereShader, /atmosphereToneMapACES/);
  assert.match(WebGPUAtmosphereShader, /atmosphereEncodeSrgb/);
  assert.doesNotMatch(WebGPUSunShader, /texture_2d<f32>\s*<\s*solar/);
});
