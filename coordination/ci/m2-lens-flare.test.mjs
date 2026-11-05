import assert from "node:assert/strict";
import { test } from "node:test";
import Renderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";

test("lens controls default off and belong to each renderer", () => {
  const a = new Renderer({});
  const b = new Renderer({});
  assert.deepEqual(a.lensFlare, { enabled: false, strength: 1, diffusion: 1, reflection: 1 });
  a.lensFlare.enabled = true;
  assert.equal(b.lensFlare.enabled, false);
  assert.equal(a.statistics.lensFlareTextureBytes, 0);
});

test("invalid mutable lens controls fail at the update boundary", () => {
  for (const [key, value] of [["strength", NaN], ["strength", -1], ["strength", 5], ["diffusion", -1], ["reflection", Infinity], ["enabled", 1]]) {
    const renderer = new Renderer({});
    renderer.lensFlare[key] = value;
    assert.throws(() => renderer.update({}, { show: false }), /Lens flare/);
  }
});
