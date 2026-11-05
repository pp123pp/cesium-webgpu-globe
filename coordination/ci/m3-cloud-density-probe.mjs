/* global navigator, window, GPUBufferUsage, GPUTextureUsage, GPUMapMode, atob */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import planetShader from "../../packages/engine/Source/Scene/WebGPUPlanetShader.js";
import densityShader from "../../packages/engine/Source/Scene/WebGPUCloudDensityShader.js";
import createCloudNoise from "../../packages/engine/Source/Scene/WebGPUCloudNoise.js";
import { assertPhysicalGpu, classifyGpu, getBrowserConfiguration } from "./m0-browser-config.mjs";

const config = getBrowserConfiguration();
const output = process.env.M3_FIELD_OUTPUT ?? "Build/m3-cloud-density";
const startedAt = new Date().toISOString();
const server = createServer((request, response) => response.end("<title>M3 cloud field</title>"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch(config.launchOptions);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const info = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter unavailable");
    const { vendor, architecture, device, description, isFallbackAdapter } = adapter.info;
    window.cloudProbeDevice = await adapter.requestDevice();
    return { vendor, architecture, device, description, isFallbackAdapter };
  });
  assertPhysicalGpu(classifyGpu(info), config);

  const samples = [];
  function sample(lon, lat, height, coverage, angle = 0, footprint = 100, enhance = 0) {
    const toRad = Math.PI / 180;
    const l = lon * toRad;
    const b = lat * toRad;
    const a = 6378137;
    const c = 6356752.314245179;
    const primeVertical = a / Math.sqrt(1 - (1 - (c / a) ** 2) * Math.sin(b) ** 2);
    const r = (primeVertical + height) * Math.cos(b);
    samples.push(r * Math.cos(l), r * Math.sin(l), (primeVertical * (c / a) ** 2 + height) * Math.sin(b),
      footprint, coverage, angle, enhance, 0.32);
    return samples.length / 8 - 1;
  }
  const globe = [];
  for (let i = 0; i < 512; ++i) {
    const lon = (i * 137.50776405) % 360 - 180;
    const lat = Math.asin(2 * (i + 0.5) / 512 - 1) * 180 / Math.PI;
    const tiers = [0, 0.23, 0.58, 1].map((c) => sample(lon, lat, 3650, c));
    globe.push({ lon, lat, tiers, near: tiers[2], far: sample(lon, lat, 3650, 0.58, 0, 50000),
      smallWind: sample(lon, lat, 3650, 0.58, 1e-6), largeWind: sample(lon, lat, 3650, 0.58, 0.08),
      cycle: sample(lon, lat, 3650, 0.58, 2 * Math.PI),
      enhancement: sample(lon, lat, 3650, 0.58, 0, 100, 1) });
  }
  const seams = [];
  for (let lat = -80; lat <= 80; lat += 5) {
    seams.push([sample(-180 + 1e-6, lat, 3700, 0.85), sample(180 - 1e-6, lat, 3700, 0.85)]);
  }
  for (const pole of [-1, 1]) {
    const center = sample(0, pole * 90, 3700, 1);
    for (let lon = -180; lon < 180; lon += 30) {
      seams.push([center, sample(lon, pole * (90 - 1e-6), 3700, 1)]);
    }
  }
  const shell = [1900, 2000, 6000, 6100].map((h) => sample(20, 35, h, 1));
  const patches = [];
  const heights = Array.from({ length: 14 }, (_, i) => 2100 + 300 * i);
  for (const [longitude, latitude] of [[0, 0], [46, 71], [179.96, 43], [-124, 32], [85, -60], [-50, -4]]) {
    for (const coverage of [0.23, 0.78]) {
      const columns = [];
      for (let y = -8; y <= 8; ++y) {
        for (let x = -8; x <= 8; ++x) {
          const lon = longitude + x * 0.009 / Math.cos(latitude * Math.PI / 180);
          const lat = latitude + y * 0.009;
          columns.push(heights.map((h) => sample(lon, lat, h, coverage)));
        }
      }
      patches.push({ longitude, latitude, coverage, columns });
    }
  }

  const { size, data } = createCloudNoise();
  const code = `${planetShader}
    @group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
    @group(0) @binding(1) var cloudNoise: texture_3d<f32>;
    @group(0) @binding(2) var cloudSampler: sampler;
    @group(0) @binding(3) var<storage,read> samples: array<vec4f>;
    @group(0) @binding(4) var<storage,read_write> result: array<vec4f>;
    ${densityShader}
    @compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) id: vec3u) {
      let i = id.x;
      if (i >= arrayLength(&result)) {return;}
      let p = samples[i * 2u]; let w = samples[i * 2u + 1u];
      let f = cloudRegionalWeather(normalize(cloudWindPosition(p.xyz, w)), w.x);
      result[i] = vec4f(cloudDensity(p.xyz, p.w, w), f.xyz);
    }`;
  const values = await page.evaluate(async ({ samples, code, size, encodedNoise }) => {
    const device = window.cloudProbeDevice;
    const texture = device.createTexture({ size: [size, size, size], dimension: "3d", format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture }, Uint8Array.from(atob(encodedNoise), (c) => c.charCodeAt(0)),
      { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, size]);
    const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear",
      addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
    function uploaded(data, usage) {
      const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    }
    const uniforms = new Float32Array(68);
    uniforms.set([1 / 6378137, 1 / 6378137, 1 / 6356752.314245179], 4);
    const uniform = uploaded(uniforms, GPUBufferUsage.UNIFORM);
    const input = uploaded(new Float32Array(samples), GPUBufferUsage.STORAGE);
    const bytes = samples.length * 2;
    const out = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const shader = device.createShaderModule({ code });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: shader, entryPoint: "probe" } });
    const resources = [{ buffer: uniform }, texture.createView(), sampler, { buffer: input }, { buffer: out }];
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })) });
    const cmd = device.createCommandEncoder();
    const pass = cmd.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(samples.length / (8 * 64)));
    pass.end();
    cmd.copyBufferToBuffer(out, 0, read, 0, bytes);
    device.queue.submit([cmd.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Float32Array(read.getMappedRange()));
    read.unmap();
    for (const resource of [read, out, input, uniform, texture]) resource.destroy();
    device.destroy();
    return result;
  }, { samples, code, size, encodedNoise: Buffer.from(data).toString("base64") });
  const density = (i) => values[i * 4];
  const cover = (i) => values[i * 4 + 1];
  const activeCounts = [0, 1, 2, 3].map((j) => globe.filter((s) => density(s.tiers[j]) > 0.00002).length);
  assert.ok(values.every(Number.isFinite));
  assert.ok(globe.every((s) => density(s.tiers[0]) === 0));
  assert.ok(activeCounts.every((n, i) => !i || n > activeCounts[i - 1]));
  assert.ok(shell.every((i) => density(i) === 0));
  const maxDelta = (pairs, value) => Math.max(...pairs.map(([a, b]) => Math.abs(value(a) - value(b))));
  const seam = { extinctionPerMeter: maxDelta(seams, density), coverage: maxDelta(seams, cover) };
  assert.ok(seam.extinctionPerMeter < 3e-6 && seam.coverage < 1e-3);
  const pairs = (key) => globe.map((s) => [s.near, s[key]]);
  assert.equal(maxDelta(pairs("far"), cover), 0);
  const wind = { small: maxDelta(pairs("smallWind"), density), large: maxDelta(pairs("largeWind"), density),
    fullCycle: maxDelta(pairs("cycle"), density) };
  assert.ok(wind.small < 0.00006 && wind.large > 0.0002 && wind.fullCycle < 0.00003);
  assert.ok(globe.every((s) => density(s.enhancement) + 1e-10 >= density(s.near)));
  const boosted = globe.filter((s) => density(s.enhancement) > density(s.near) + 0.00001).length;
  assert.ok(boosted > 0);
  const localSections = patches.map(({ longitude, latitude, coverage, columns }) => {
    const tops = [];
    let gaps = 0;
    for (const column of columns) {
      const tau = column.reduce((sum, i) => sum + 300 * density(i), 0);
      if (tau < 0.06) gaps++;
      if (tau > 0.20) tops.push(heights[column.findLastIndex((i) => density(i) > 0.000019)]);
    }
    const summary = { longitude, latitude, coverage, columns: columns.length, gaps,
      cloudyColumns: tops.length, lowestTop: Math.min(...tops), highestTop: Math.max(...tops) };
    assert.ok(tops.length >= 3 && gaps >= 3 && summary.highestTop - summary.lowestTop >= 600,
      `cloud banks, holes and varying tops: ${JSON.stringify(summary)}`);
    return summary;
  });
  const occupied = globe.filter((s) => density(s.near) > 0.0005).slice(0, 4);
  const result = { startedAt, finishedAt: new Date().toISOString(), browser: browser.version(), adapter: info,
    shaderSha256: createHash("sha256").update(densityShader).digest("hex"),
    noiseSha256: createHash("sha256").update(data).digest("hex"),
    shaderEvaluations: samples.length / 8, globeDirections: globe.length, coverages: [0, 0.23, 0.58, 1],
    activeCounts, localSections, seamPairs: seams.length, maximumSeamDelta: seam, maximumWindExtinctionDeltaPerMeter: wind,
    nearEnhancementIncreasedCount: boosted, footprintMacroCoverageDelta: 0, densityOutsideShell: shell.map(density),
    sampleLocations: occupied.map((s) => ({ longitude: s.lon, latitude: s.lat, height: 3650, coverage: 0.58,
      windAngle: 0, extinctionPerMeter: density(s.near) })) };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  server.close();
}
