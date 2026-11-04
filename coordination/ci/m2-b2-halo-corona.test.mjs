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
  // B5-A-R calibration retains both bands while emphasizing irregular fine detail.
  assert.match(sun, /mix\(coronaMid, coronaFine, 0\.78\)/);
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

test("B2 corona payloads feather transverse edges without erasing directional energy", async () => {
  const root = "packages/engine/Source/Assets/Textures/WebGPU/Solar/GPU";
  const size = 512;
  const means = {};
  for (const name of ["corona-fine", "corona-mid"]) {
    const pixels = await readFile(`${root}/${name}.r8`);
    assert.equal(pixels.length, size * size);
    let largestStep = 0;
    let sum = 0;
    let count = 0;
    const sectors = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = pixels[y * size + x];
        if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
          assert.ok(value <= 1, `${name} must fade before its texture boundary`);
        }
        const dx = x - 255.5;
        const dy = y - 255.5;
        const radius = Math.hypot(dx, dy) / 256;
        if (radius <= 0.25 || radius >= 0.8) { continue; }
        largestStep = Math.max(largestStep,
          Math.abs(value - pixels[y * size + x + 1]),
          Math.abs(value - pixels[(y + 1) * size + x]));
        sum += value;
        count++;
        const sector = Math.min(11, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 12));
        sectors[sector].sum += value;
        sectors[sector].count++;
      }
    }
    // Bound adjacent coverage jumps in the visible annulus to 8/255. This
    // catches the old 1–3-texel traced wires; it is not a naturalness verdict.
    assert.ok(largestStep <= 8, `${name} has an unfeathered ${largestStep}/255 coverage jump`);
    means[name] = sum / count;
    const angularMeans = sectors.map((sector) => sector.sum / sector.count);
    assert.ok(Math.max(...angularMeans) - Math.min(...angularMeans) >= 3,
      `${name} must retain directional structure rather than uniform haze`);
  }
  const mixedMean = means["corona-mid"] * 0.22 + means["corona-fine"] * 0.78;
  assert.ok(mixedMean >= 12 && mixedMean <= 30,
    `corona coverage must retain restrained visible energy (${mixedMean})`);
});
