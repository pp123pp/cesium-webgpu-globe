import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import createCloudNoise from "../../packages/engine/Source/Scene/WebGPUCloudNoise.js";

test("cloud noise is repeatable RGBA8 with useful contrast in every band", () => {
  const { size, data } = createCloudNoise();
  assert.equal(data.length, size ** 3 * 4);
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    "607a75cfd14ad77bcb4f84c5f46115822fde6967bd54fb802a27c1c62ea646ca",
    "the baked texture preserves the accepted procedural field",
  );
  assert.deepEqual(createCloudNoise().data, data);
  for (let channel = 0; channel < 4; ++channel) {
    const values = [];
    for (let i = channel; i < data.length; i += 4) {
      values.push(data[i]);
    }
    values.sort((a, b) => a - b);
    const count = values.length;
    assert.ok(values[Math.floor(count * 0.95)] - values[Math.floor(count * 0.05)] > 45);
  }
});

test("each repeating face has comparable contrast to adjacent interior slices", () => {
  const { size, data } = createCloudNoise();
  for (const stride of [1, size, size * size]) {
    for (let channel = 0; channel < 4; ++channel) {
      let edge = 0;
      let interior = 0;
      for (let voxel = 0; voxel < size ** 3; ++voxel) {
        const last = Math.floor(voxel / stride) % size === size - 1;
        const next = last ? voxel - (size - 1) * stride : voxel + stride;
        const delta = Math.abs(data[voxel * 4 + channel] - data[next * 4 + channel]);
        if (last) {edge += delta;}
        else {interior += delta;}
      }
      const ratio = (edge * (size - 1)) / interior;
      assert.ok(ratio > 0.5 && ratio < 1.6, `stride ${stride}, band ${channel}: ${ratio}`);
    }
  }
});
