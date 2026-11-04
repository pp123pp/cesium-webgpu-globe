import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUSunShader from "../../../../packages/engine/Source/Scene/WebGPUSunShader.js";
import WebGPUAtmosphereShader from "../../../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";

test("integrated solar rays are shorter, lower-energy and weighted toward irregular fine detail", () => {
  assert.match(WebGPUSunShader, /solarRaysPrimary[\s\S]*?\.r \* 0\.15/);
  assert.match(WebGPUSunShader, /solarRaysFine[\s\S]*?\.r \* 0\.65/);
  assert.match(WebGPUSunShader, /solarRaysBroad[\s\S]*?\.r \* 0\.20/);
  assert.match(WebGPUSunShader, /smoothstep\(0\.52, 0\.90, r\)/);
  assert.match(WebGPUSunShader, /atmosphere\.sun\.z \* 0\.75 \* rays/);
});

test("solar artwork attenuates more strongly on optically thick view paths", () => {
  assert.match(WebGPUSunShader, /mix\(0\.28, 1\.0, smoothstep\(0\.35, 0\.90, viewTransmission\)\)/);
});

test("long-path atmosphere display balance is shared by display and HDR-linear fragments", () => {
  assert.match(WebGPUAtmosphereShader, /fn atmosphereLongPathBalance\(radiance: vec3f, transmittance: vec3f\)/);
  assert.match(WebGPUAtmosphereShader, /let desaturation = 0\.58 \* grazingPath/);
  assert.match(WebGPUAtmosphereShader, /let attenuation = 1\.0 - 0\.18 \* grazingPath/);
  assert.equal((WebGPUAtmosphereShader.match(/background \* transport\.transmittance \+ transport\.radiance/g) ?? []).length, 2);
  const uses = WebGPUAtmosphereShader.match(/atmosphereLongPathBalance\(atmosphereComposite, transport\.transmittance\)/g) ?? [];
  assert.equal(uses.length, 2);
  assert.ok(WebGPUAtmosphereShader.indexOf("atmosphereLongPathBalance") < WebGPUAtmosphereShader.indexOf("atmosphereToneMapACES"));
});
