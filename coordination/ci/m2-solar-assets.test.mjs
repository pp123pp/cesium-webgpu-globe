import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve("packages/engine/Source/Assets/Textures/WebGPU/Solar");
const masks = [
  "radial-rays-01",
  "radial-rays-02",
  "radial-rays-03",
  "soft-halo",
  "wide-halo",
  "corona-fine",
  "corona-mid",
  "radial-noise",
];

test("M2.6 solar pack contains all authored SVG sources and 512px GPU mask payloads", async () => {
  for (const name of masks) {
    const svg = await readFile(path.join(root, name.startsWith("radial-rays") ? "Rays" : name.includes("halo") ? "Halo" : name.startsWith("corona-") ? "Corona" : "Noise", `${name}.svg`), "utf8");
    assert.match(svg, /<svg[\s>]/i, `${name} source SVG`);
    assert.match(svg, /viewBox="0 0 1024 1024"/);
    const payload = await stat(path.join(root, "GPU", `${name}.r8`));
    assert.equal(payload.size, 512 * 512, `${name} R8 byte count`);
  }
  const manifest = JSON.parse(await readFile(path.join(root, "GPU", "manifest.json"), "utf8"));
  assert.equal(manifest.assets.length, 9);
  assert.equal(manifest.assets.reduce((sum, asset) => sum + asset.byteLength, 0), 3145728);
  assert.equal(manifest.assets.find((asset) => asset.source === "Atmosphere/glow-gradient.svg").format, "rgba8unorm-srgb");
  const gradient = await readFile(path.join(root, "Atmosphere", "glow-gradient.svg"), "utf8");
  assert.match(gradient, /linearGradient/);
  assert.equal((await stat(path.join(root, "GPU", "glow-gradient.rgba8"))).size, 512 * 512 * 4);
});

test("solar texture conversion source is deterministic and preserves source SVGs", async () => {
  const script = await readFile("coordination/ci/build-solar-textures.mjs", "utf8");
  assert.match(script, /const size = 512/);
  assert.match(script, /rgba8/);
  assert.match(script, /alpha\[i\] = rgba\[i \* 4 \+ 3\]/);
  assert.match(script, /"r8"/);
  assert.match(script, /"rgba8"/);
  const sunShader = await readFile("packages/engine/Source/Scene/WebGPUSunShader.js", "utf8");
  const atmosphereShader = await readFile("packages/engine/Source/Scene/WebGPUAtmosphereShader.js", "utf8");
  for (const asset of ["solarRaysPrimary", "solarRaysFine", "solarRaysBroad", "solarSoftHalo", "solarWideHalo", "solarCorona", "solarCoronaMid", "solarNoise", "solarGlowGradient"]) {
    assert.match(atmosphereShader, new RegExp(`var ${asset}:`));
    assert.ok(sunShader.includes(asset) || asset === "solarRaysPrimary" || asset === "solarRaysFine" || asset === "solarRaysBroad");
  }
});
