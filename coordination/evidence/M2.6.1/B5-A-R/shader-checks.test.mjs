import assert from "node:assert/strict";
import { test } from "node:test";
import WebGPUSunShader from "../../../../packages/engine/Source/Scene/WebGPUSunShader.js";
import WebGPUAtmosphereShader from "../../../../packages/engine/Source/Scene/WebGPUAtmosphereShader.js";
import { terrainSurfaceLighting } from "../../../ci/m2-composite-reference.mjs";

test("integrated solar rays are shorter, lower-energy and weighted toward irregular fine detail", () => {
  assert.match(WebGPUSunShader, /solarRaysPrimary[\s\S]*?\.r \* 0\.15/);
  assert.match(WebGPUSunShader, /solarRaysFine[\s\S]*?\.r \* 0\.65/);
  assert.match(WebGPUSunShader, /solarRaysBroad[\s\S]*?\.r \* 0\.20/);
  assert.match(WebGPUSunShader, /smoothstep\(0\.32, 0\.72, r\)/);
  assert.match(WebGPUSunShader, /atmosphere\.sun\.z \* 0\.24 \* rays/);
  assert.match(WebGPUSunShader, /mix\(coronaMid, coronaFine, 0\.78\)/);
  assert.match(WebGPUSunShader, /atmosphere\.sun\.z \* 0\.5 \* coronaPattern/);
});

test("solar artwork attenuates more strongly on optically thick view paths", () => {
  assert.match(WebGPUSunShader, /mix\(0\.28, 1\.0, smoothstep\(0\.35, 0\.90, viewTransmission\)\)/);
});

test("long-path atmosphere display balance is shared by display and HDR-linear fragments", () => {
  assert.match(WebGPUAtmosphereShader, /fn atmosphereLongPathBalance\(radiance: vec3f, transmittance: vec3f\)/);
  assert.match(WebGPUAtmosphereShader, /let desaturation = 0\.85 \* grazingPath/);
  assert.match(WebGPUAtmosphereShader, /let attenuation = 1\.0 - 0\.35 \* grazingPath/);
  assert.equal((WebGPUAtmosphereShader.match(/background \* surfaceLighting \* transport\.transmittance \+ transport\.radiance/g) ?? []).length, 2);
  const uses = WebGPUAtmosphereShader.match(/atmosphereLongPathBalance\(atmosphereComposite, transport\.transmittance\)/g) ?? [];
  assert.equal(uses.length, 2);
  assert.ok(WebGPUAtmosphereShader.indexOf("atmosphereLongPathBalance") < WebGPUAtmosphereShader.indexOf("atmosphereToneMapACES"));
});

test("terrain lighting uses geodetic Lambert response and a low night-side ambient floor", () => {
  assert.match(WebGPUAtmosphereShader, /fn atmosphereTerrainLighting\(/);
  assert.match(WebGPUAtmosphereShader, /let normal = normalize\(scaledPosition \* inverseRadii\)/);
  assert.match(WebGPUAtmosphereShader, /atmosphereSunTransmittance\(surface\.w, sunCosine\)/);
  assert.match(WebGPUAtmosphereShader, /return vec3f\(0\.025\) \+ direct/);
  assert.equal((WebGPUAtmosphereShader.match(/atmosphereTerrainLighting\(direction, sceneDistance\)/g) ?? []).length, 2);
  assert.equal((WebGPUAtmosphereShader.match(/sunOnlyTerrainLighting\(direction, sceneDistance\)/g) ?? []).length, 2);
});

test("CPU terrain-light reference keeps deep night dark and preserves direct daylight", () => {
  assert.deepEqual(terrainSurfaceLighting(-0.2, 2), [0.025, 0.025, 0.025]);
  const daylight = terrainSurfaceLighting(1, 2);
  assert.ok(daylight.every((value) => value > 0.7 && value <= 1.015));
  assert.ok(daylight[0] > daylight[1] && daylight[1] > daylight[2],
    "daylight direct irradiance retains Rayleigh wavelength attenuation");
  const lowSun = terrainSurfaceLighting(0.01, 2);
  assert.ok(lowSun.every((value) => value >= 0.025 && value < 0.03));
  assert.deepEqual(terrainSurfaceLighting(1, 2, false), [1.025, 1.025, 1.025]);
});
