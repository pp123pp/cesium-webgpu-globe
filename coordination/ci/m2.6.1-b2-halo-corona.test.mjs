import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

test("M2.6.1 B2 composes three halo scales and two authored corona bands", async () => {
  const root = "packages/engine/Source/Assets/Textures/WebGPU/Solar";
  const sun = await readFile("packages/engine/Source/Scene/WebGPUSunShader.js", "utf8");
  const atmosphere = await readFile("packages/engine/Source/Scene/WebGPUAtmosphereShader.js", "utf8");
  const renderer = await readFile("packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js", "utf8");
  const builder = await readFile("coordination/ci/build-solar-textures.mjs", "utf8");

  for (const scale of ["innerFalloff", "intermediateFalloff", "outerFalloff"]) {
    assert.ok(sun.includes(scale), `missing ${scale} halo contribution`);
  }
  assert.match(sun, /solarCoronaMid/);
  assert.match(sun, /coronaEnvelope/);
  assert.match(sun, /mix\(coronaMid, coronaFine, 0\.56\)/);
  assert.match(atmosphere, /@binding\(12\) var solarCorona:/);
  assert.match(atmosphere, /@binding\(13\) var solarCoronaMid:/);
  assert.match(atmosphere, /@binding\(14\) var solarNoise:/);
  assert.match(atmosphere, /@binding\(16\) var solarSampler:/);
  assert.match(renderer, /\["corona-mid", "r8", 1\]/);
  assert.match(renderer, /binding: 16, resource: this\._sampler/);
  assert.match(builder, /Corona\/corona-mid\.svg/);

  for (const name of ["corona-fine", "corona-mid"]) {
    const svg = await readFile(`${root}/Corona/${name}.svg`, "utf8");
    assert.match(svg, /<svg[\s>]/i);
    assert.ok((svg.match(/<path/g) ?? []).length >= 8, `${name} must contain authored irregular filament paths`);
    assert.equal((await stat(`${root}/GPU/${name}.r8`)).size, 512 * 512);
  }

  const manifest = JSON.parse(await readFile(`${root}/GPU/manifest.json`, "utf8"));
  assert.equal(manifest.assets.length, 9);
  assert.equal(manifest.assets.reduce((sum, asset) => sum + asset.byteLength, 0), 3_145_728);
  assert.ok(manifest.assets.some((asset) => asset.source === "Corona/corona-mid.svg"));
});
