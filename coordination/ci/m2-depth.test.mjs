import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Cartesian4, Matrix4, PerspectiveOffCenterFrustum } from "@cesium/core";
import Depth from "../../packages/engine/Source/Renderer/WebGPUDepth.js";
import WebGPUContext from "../../packages/engine/Source/Renderer/WebGPUContext.js";

const near = 0.1;
const far = 500000000;
const frustum = () => new PerspectiveOffCenterFrustum({ near, far, left: -0.07, right: 0.11, bottom: -0.025, top: 0.075 });
function close(actual, expected, relative = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * relative), `${actual} != ${expected}`);
}

test("shared projection preserves native off-center X/Y while near=1 and far=0", () => {
  const f = frustum();
  const original = Matrix4.clone(f.projectionMatrix);
  const p = Depth.computeProjection(f);
  for (const i of [0, 5, 8, 9, 11, 15]) {assert.equal(p[i], original[i]);}
  assert.deepEqual(f.projectionMatrix, original);
  for (const [d, want] of [[near, 1], [far, 0]]) {
    const clip = Matrix4.multiplyByVector(p, new Cartesian4(0, 0, -d, 1), new Cartesian4());
    close(clip.z / clip.w, want);
  }
});

test("depth reconstruction remains finite from ground to high orbit after float32 storage", () => {
  const p = Depth.computeProjection(frustum());
  let previous = 1;
  for (const d of [1, 2, 400000, 35786000, 400000000]) {
    const z = Math.fround(p[14] / d - p[10]);
    assert.ok(z > 0 && z < previous);
    close(Depth.reconstructEyeDistance(z, near, far), d, 1e-7);
    previous = z;
  }
  assert.equal(Depth.reconstructEyeDistance(0, near, far), Infinity);
  close(Depth.reconstructEyeDistance(1, near, far), near);
});

test("noncentral depth reconstructs ray meters rather than axial eye distance", () => {
  const p = Depth.computeProjection(frustum());
  const z = p[14] / 400000 - p[10];
  const forward = new Cartesian3(0, 0, -1);
  const oblique = new Cartesian3(0.6, 0, -0.8);
  close(Depth.reconstructRayDistance(z, oblique, forward, near, far), 500000);
  assert.equal(Depth.reconstructRayDistance(0, oblique, forward, near, far), Infinity);
  assert.throws(() => Depth.reconstructRayDistance(z, Cartesian3.UNIT_X, forward, near, far));
});

test("invalid depths and finite-frustum violations are rejected", () => {
  for (const z of [-0.1, 1.1, NaN, Infinity]) {assert.throws(() => Depth.reconstructEyeDistance(z, near, far));}
  for (const [n, f] of [[0, far], [1, 1], [1, Infinity], [NaN, far]]) {
    assert.throws(() => Depth.reconstructEyeDistance(0.5, n, f));
  }
});

test("Globe depth can be read in a later GPU pass and resize releases its predecessor", (t) => {
  const previous = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 };
  t.after(() => { globalThis.GPUTextureUsage = previous; });
  const descriptors = [];
  const textures = [];
  const context = Object.assign(Object.create(WebGPUContext.prototype), {
    _globe: true,
    canvas: { width: 1, height: 1 },
    _device: {
      limits: { maxTextureDimension2D: 4096 },
      createTexture(descriptor) {
        descriptors.push(descriptor);
        const texture = { destroyed: false, destroy() { this.destroyed = true; } };
        textures.push(texture);
        return texture;
      },
    },
  });
  context.resize(800, 600);
  assert.equal(descriptors[0].format, "depth32float");
  assert.equal(descriptors[0].usage & 4, 4);
  assert.equal(context.sceneDepthTexture, textures[0]);
  context.resize(640, 480);
  assert.equal(textures[0].destroyed, true);
  assert.equal(context.sceneDepthTexture, textures[1]);
  context.resize(640, 480);
  assert.equal(textures.length, 2, "unchanged size does not allocate");
  const proof = Object.assign(Object.create(WebGPUContext.prototype), {
    ...context, _globe: false, _depthTexture: undefined, canvas: { width: 1, height: 1 },
  });
  proof.resize(200, 150);
  assert.equal(descriptors[2].format, "depth24plus");
  assert.equal(descriptors[2].usage, 16);
  assert.equal(proof.sceneDepthTexture, undefined);
});
