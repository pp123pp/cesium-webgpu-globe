/* global window, GPUAdapter, GPUTextureUsage, GPUBufferUsage, GPUShaderStage, GPUMapMode */
import assert from "node:assert/strict";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";
import shader from "../../packages/engine/Source/Scene/WebGPUSolarBloomShader.js";

// Direct production WGSL with controlled HDR/depth attachments. This test does
// not infer visibility from a changing screenshot hash or terrain tile loading.
await runM1BrowserSuite("m2-solar-bloom", async ({ page, report }) => {
  await page.evaluate(() => {
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = function (descriptor = {}) {
      window.__solarAdapterFeatures = Array.from(this.features);
      return request.call(this, {
        ...descriptor,
        requiredFeatures: this.features.has("timestamp-query")
          ? [...new Set([...(descriptor.requiredFeatures ?? []), "timestamp-query"])]
          : descriptor.requiredFeatures,
      });
    };
  });
  await installM1Scene(page, { baseLayer: false });
  report.probe = await page.evaluate(async (code) => {
    const viewer = window.__m1.viewer;
    const device = viewer.scene.context._device;
    const owned = [];
    const width = 128, height = 128;
    const texture = (size, format, usage) => {
      const t = device.createTexture({ size, format, usage }); owned.push(t); return t;
    };
    const buffer = (size, usage) => {
      const b = device.createBuffer({ size, usage }); owned.push(b); return b;
    };
    device.pushErrorScope("validation");
    let result;
    try {
      const source = texture([width, height], "rgba16float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
      const bloom = texture([32, 32], "rgba16float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
      const depth = texture([width, height], "depth32float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT);
      const output = texture([width, height], "rgba8unorm", GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
      const parameters = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const planetBuffer = buffer(272, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const download = buffer(width * height * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      const sourcePixels = new Uint16Array(width * height * 4);
      for (let i = 3; i < sourcePixels.length; i += 4) { sourcePixels[i] = 0x3c00; }
      device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: width * 8 }, [width, height]);
      const bloomPixels = new Uint16Array(32 * 32 * 4).fill(0x3c00); // exactly 1.0 linear HDR
      device.queue.writeTexture({ texture: bloom }, bloomPixels, { bytesPerRow: 32 * 8 }, [32, 32]);
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const module = device.createShaderModule({ code });
      const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: "bloomVertex" },
        fragment: { module, entryPoint: "bloomFinal", targets: [{ format: "rgba8unorm" }] },
      });
      const group = device.createBindGroup({ layout, entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }) },
        { binding: 2, resource: bloom.createView() },
        { binding: 3, resource: { buffer: parameters } },
        { binding: 4, resource: depth.createView() },
        { binding: 5, resource: { buffer: planetBuffer } },
      ] });
      const planet = new Float32Array(68);
      const a = 6378137, b = 6356752.314245;
      planet.set([a, a, b, a + 100000], 0);
      planet.set([1 / a, 1 / a, 1 / b, 1 / (a + 100000)], 4);
      planet.set([2 * a, 0, 0, 2 * a], 8);
      planet.set([0, 0, 0, a], 12);
      planet.set([0, 1, 0, 0], 24);
      planet.set([0, 0, 1, 0], 28);
      planet.set([1, 0, 0, 0], 32);
      planet.set([1, 1, 0, 0], 36);
      planet.set([3, 3, a, 0], 44);
      const render = async (blockedDepth, inward, strength, exposure = 1) => {
        planet[32] = inward ? -1 : 1;
        device.queue.writeBuffer(planetBuffer, 0, planet);
        device.queue.writeBuffer(parameters, 0, new Float32Array([exposure, strength, 0, 0]));
        const encoder = device.createCommandEncoder();
        const clear = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
          view: depth.createView(), depthClearValue: blockedDepth, depthLoadOp: "clear", depthStoreOp: "store",
        } }); clear.end();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
        encoder.copyTextureToBuffer({ texture: output }, { buffer: download, bytesPerRow: width * 4 }, [width, height]);
        device.queue.submit([encoder.finish()]);
        await download.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(download.getMappedRange()).slice(); download.unmap();
        const pixel = (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
        return { center: pixel(64, 64), corner: pixel(1, 1), litPixels: data.filter((v, i) => i % 4 === 0 && v > 2).length };
      };
      const small = texture([32, 32], "rgba16float", GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
      const extract = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: "bloomVertex" },
        fragment: { module, entryPoint: "bloomExtract", targets: [{ format: "rgba16float" }] },
      });
      // A single 4.0 HDR texel diluted across a 4x4 footprint averages to 0.25.
      // Correct bright extraction must threshold BEFORE any spatial averaging.
      const hot = (64 * width + 64) * 4;
      sourcePixels[hot] = sourcePixels[hot + 1] = sourcePixels[hot + 2] = 0x4400;
      device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: width * 8 }, [width, height]);
      const extractEncoder = device.createCommandEncoder();
      const extractPass = extractEncoder.beginRenderPass({ colorAttachments: [{ view: small.createView(), loadOp: "clear", storeOp: "store" }] });
      extractPass.setPipeline(extract); extractPass.setBindGroup(0, group); extractPass.draw(3); extractPass.end();
      extractEncoder.copyTextureToBuffer({ texture: small }, { buffer: download, bytesPerRow: 256 }, [32, 32]);
      device.queue.submit([extractEncoder.finish()]);
      await download.mapAsync(GPUMapMode.READ);
      const smallHighlightHalf = new Uint16Array(download.getMappedRange())[(16 * 32 + 16) * 4];
      download.unmap();
      sourcePixels[hot] = sourcePixels[hot + 1] = sourcePixels[hot + 2] = 0;
      device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: width * 8 }, [width, height]);
      result = {
        smallHighlightHalf,
        visible: await render(0, false, 0.35),
        terrainBlocked: await render(0.5, false, 0.35),
        ellipsoidBlocked: await render(0, true, 0.35),
        disabledAfterEnabled: await render(0, false, 0),
        adapterFeatures: window.__solarAdapterFeatures,
        deviceFeatures: Array.from(device.features),
      };
    } finally {
      for (const resource of owned) { resource.destroy(); }
    }
    const validation = await device.popErrorScope();
    if (validation) { throw new Error(validation.message); }
    viewer.destroy();
    return { ...result, probeResourcesCreated: owned.length, probeResourcesDestroyed: owned.length };
  }, shader);
  assert.ok(report.probe.visible.center[0] > 20, "negative control: unoccluded HDR bloom is visible");
  assert.deepEqual(report.probe.terrainBlocked.center, [0, 0, 0], "Bloom must not cross opaque terrain depth");
  assert.equal(report.probe.terrainBlocked.litPixels, 0);
  assert.deepEqual(report.probe.ellipsoidBlocked.center, [0, 0, 0], "Bloom must respect analytic Earth even before terrain is resident");
  assert.ok(report.probe.ellipsoidBlocked.corner[0] > 20, "Earth masking must not erase visible sky");
  assert.equal(report.probe.disabledAfterEnabled.litPixels, 0, "zero-strength skips stale bloom contribution");
  assert.equal(report.probe.smallHighlightHalf, 0x3200, "one HDR 4.0 texel must retain (4-1)/16 = 0.1875 in the extracted HDR texture");
  report.checks.push("real production HDR final pass respects terrain depth and WGS84 with positive/negative controls");
});
