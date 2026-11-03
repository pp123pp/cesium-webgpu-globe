import assert from "node:assert/strict";
import { test } from "node:test";
import Renderer from "../../packages/engine/Source/Scene/WebGPUAtmosphereRenderer.js";

function setup(t, options = {}) {
  for (const [name, value] of Object.entries({
    GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 },
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 },
  })) {
    const old = globalThis[name]; globalThis[name] = value;
    t.after(() => { globalThis[name] = old; });
  }
  const resources = [];
  const uploads = [];
  const resource = (kind, descriptor) => {
    const value = { kind, descriptor, destructions: 0, destroy() { this.destructions++; }, createView() { return { value: this }; } };
    resources.push(value); return value;
  };
  const device = {
    pushErrorScope() {}, async popErrorScope() { return null; },
    createShaderModule() { return {}; },
    async createRenderPipelineAsync() { return { getBindGroupLayout() { return {}; } }; },
    createBuffer(d) { return resource("buffer", d); },
    createTexture(d) { return resource("texture", d); },
    createSampler() { return {}; },
    queue: { writeTexture(...args) { uploads.push(args); if (options.uploadError && uploads.length === 2) {throw new Error("GPU upload failure");} } },
  };
  const renderer = new Renderer({ _device: device, _format: "bgra8unorm", _checkAlive() {} });
  renderer._device = device;
  t.after(() => renderer.destroy());
  return { renderer, resources, uploads };
}
function payload(url) {
  return { ok: true, async arrayBuffer() { return new ArrayBuffer(512 * 512 * (String(url).endsWith(".rgba8") ? 4 : 1)); } };
}

test("destroy during a pending solar fetch stops further GPU allocation and upload", async (t) => {
  const { renderer, resources, uploads } = setup(t);
  let finishFetch, reached;
  const waiting = new Promise((resolve) => { reached = resolve; });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    requests++;
    if (requests === 2) { reached(); return new Promise((resolve) => { finishFetch = () => resolve(payload(url)); }); }
    return payload(url);
  });
  const loading = renderer._loadSolarAssets();
  await waiting; renderer.destroy(); finishFetch(); await loading;
  assert.equal(uploads.length, 1, "no GPU upload after owner destruction");
  assert.equal(requests, 2, "do not fetch remaining textures after cancellation");
  assert.equal(resources.length, 1);
  assert.ok(resources.every((r) => r.destructions === 1));
  assert.equal(renderer.statistics.texturesCreated, renderer.statistics.texturesDestroyed);
  assert.equal(renderer.statistics.solarAssetBytes, 0);
  assert.equal(renderer.statistics.solarAssetsLoaded, false);
});

test("solar initialization is idempotent and all owned resources are freed exactly once", async (t) => {
  const { renderer, resources } = setup(t);
  t.mock.method(globalThis, "fetch", async (url) => payload(url));
  await Promise.all([renderer.initialize(), renderer.initialize()]);
  assert.equal(resources.filter((r) => r.kind === "texture").length, 8);
  assert.equal(resources.filter((r) => r.kind === "buffer").length, 3);
  renderer.destroy(); renderer.destroy();
  assert.ok(resources.every((r) => r.destructions === 1));
  assert.equal(renderer.statistics.texturesCreated, renderer.statistics.texturesDestroyed);
  assert.equal(renderer.statistics.buffersCreated, renderer.statistics.buffersDestroyed);
});

test("GPU upload failures are fatal, balanced, and not disguised as optional asset failures", async (t) => {
  const { renderer, resources } = setup(t, { uploadError: true });
  t.mock.method(globalThis, "fetch", async (url) => payload(url));
  await assert.rejects(renderer._loadSolarAssets(), /GPU upload failure/);
  assert.equal(resources.length, 2, "must not allocate eight fallback textures on GPU failure");
  assert.ok(resources.every((r) => r.destructions === 1));
  assert.equal(renderer.statistics.texturesCreated, 2);
  assert.equal(renderer.statistics.texturesDestroyed, 2);
});
