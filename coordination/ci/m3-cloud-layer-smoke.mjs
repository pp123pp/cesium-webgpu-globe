/* global Cesium, window, document, navigator, GPUBufferUsage, GPUMapMode */
import assert from "node:assert/strict";
import process from "node:process";
import path from "node:path";
import { runM1BrowserSuite, installM1Scene, captureM1Scene, destroyM1Scene } from "./m1-browser-harness.mjs";

process.env.M1_OUTPUT ??= "Build/m3-cloud-layer";

await runM1BrowserSuite("m3-01-cloud-geometry", async ({ page, report, output }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await installM1Scene(page, { baseLayer: false });
  await page.evaluate(() => {
    const { viewer } = window.__m1;
    class BoundedTerrain extends Cesium.EllipsoidTerrainProvider {
      getLevelMaximumGeometricError(level) {
        return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
      }
    }
    viewer.terrainProvider = new BoundedTerrain();
    viewer.scene.globe.baseColor = new Cesium.Color(0.12, 0.22, 0.32, 1);
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    viewer.camera.frustum.near = 0.1;
    viewer.camera.frustum.far = 500000000;
  });
  await installProbe(page);
  report.fixture = { viewport: [640, 360], maximumTerrainLevel: 8, provider: "native EllipsoidTerrainProvider", baseHeight: 2000, topHeight: 6000, diagnostic: "cyan shell path length over native terrain; no cloud density or scattering" };
  report.depthReference = "All measured-depth rows compare GPU reconstruction with CPU WebGPUDepth and clip cloud exits against actual stored depth. Native unsnapped CPU mesh picks and their differences are retained for every surface row; strict pick agreement is additionally required in controlled nadir views. Shallow hardware-rasterized depth and native double mesh picks are separate observations.";
  for (const view of [
    { name: "orbit", height: 35786000, pitch: -90 },
    { name: "high", height: 20000, pitch: -6 },
    { name: "inside", height: 4000, pitch: 0 },
    { name: "near", height: 2, pitch: 2 },
  ]) {
    const settled = await page.evaluate((view) => window.__m1.settle({ longitude: 0, latitude: 0, height: view.height, heading: 90, pitch: view.pitch, timeout: 60000 }), view);
    await page.evaluate(() => { document.querySelector("#cloudDiagnostic").style.visibility = "hidden"; });
    await captureM1Scene(page, report, output, `${view.name}-terrain`, { settled });
    const rows = await page.evaluate(async () => window.__cloud.probe([
      [0, 0], [-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65],
    ].map(([x, y]) => [x, y, 0, 0, 0, 0, -1, 1])));
    report.probeRows = { view: view.name, rows };
    checkRows(rows, view.name);
    const diagnostic = await page.evaluate(() => window.__cloud.draw());
    report.diagnostic = { view: view.name, ...diagnostic };
    assert.ok(diagnostic.cloudPixels > 0, `${view.name}: actual cloud diagnostic pixels`);
    assert.ok(diagnostic.terrainPixels > 0, `${view.name}: real native terrain depth present`);
    assert.ok(diagnostic.maximumTerrainLevel <= 8);
    await page.locator("#cloudDiagnostic").screenshot({ path: path.join(output, `${view.name}-cloud.png`) });
    report.scenes.push({ name: `${view.name}-cloud`, view, rows, diagnostic });
    report.checks.push(`${view.name}: CPU/GPU entry and exit, actual mesh depth, rendered cloud shell`);
  }

  report.nadirDepth = [];
  for (const height of [35786000, 20000, 2]) {
    const settled = await page.evaluate((height) => window.__m1.settle({ longitude: 0, latitude: 0, height, heading: 0, pitch: -90, timeout: 60000 }), height);
    const rows = await page.evaluate(() => window.__cloud.probe([[0, 0, 0, 0, 0, 1, -1, 1]]));
    checkRows(rows, `controlled nadir ${height}`);
    assert.ok(rows[0].depth > 0 && rows[0].sceneDistance > 0, `nadir ${height}: native mesh writes real reversed depth`);
    assert.ok(Math.abs(rows[0].sceneDistance - rows[0].nativePickDistance) < 0.05 + rows[0].nativePickDistance * 3e-6, `nadir ${height}: tight native mesh depth comparison`);
    report.nadirDepth.push({ height, settled, rows });
  }
  report.checks.push("controlled orbital/high/near nadir views retain tight native mesh pick/depth comparisons");

  // Equatorial orbital rays use geometric impact parameters, independent of the
  // camera's screen projection. 4 km impact altitude crosses both shell lobes.
  const grazing = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 35786000) });
    viewer.render();
    const radius = viewer.camera.positionWC.x;
    const a = Cesium.Ellipsoid.WGS84.maximumRadius;
    const impacts = [a - 100, a + 1000, a + 4000, a + 5990, a + 5999, a + 6001, a + 6010];
    const rays = impacts.map((impact) => {
      const sine = impact / radius;
      return [-Math.sqrt(1 - sine * sine), sine, 0, 1, 0, 0, -1, 0];
    });
    const rows = await window.__cloud.probe(rays);
    return { impacts, rows };
  });
  report.grazing = grazing;
  checkRows(grazing.rows, "orbital grazing");
  assert.equal(grazing.rows[0].expected.length, 1, "Earth clips the far shell lobe");
  assert.equal(grazing.rows[1].expected.length, 2, "Earth-missing hollow-interior ray has two segments");
  assert.equal(grazing.rows[2].expected.length, 1, "ray above cloud base remains inside one shell chord");
  assert.equal(grazing.rows[5].expected.length, 0, "1 m above outer limb is a miss");
  assert.equal(grazing.rows[6].expected.length, 0);
  report.checks.push("orbital near-tangent hits and misses, hollow-interior two segments and Earth clipping");

  const exteriorTangent = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const radius = Cesium.Ellipsoid.WGS84.maximumRadius + 6000;
    const samples = [];
    for (const offset of [-0.01, 0, 0.01]) {
      viewer.camera.setView({ destination: new Cesium.Cartesian3(-1000000, radius + offset, 0) });
      viewer.render();
      samples.push({ offset, rows: await window.__cloud.probe([[1, 0, 0, 1, 0, 0, -1, 0]]) });
    }
    return samples;
  });
  report.exteriorTangent = exteriorTangent;
  for (const sample of exteriorTangent) { checkRows(sample.rows, `exterior tangent ${sample.offset}`); }
  assert.ok(exteriorTangent[0].rows[0].actual[1] > exteriorTangent[0].rows[0].actual[0], "centimeter inside exterior tangent has positive chord");
  assert.equal(exteriorTangent[1].rows[0].actual[0], exteriorTangent[1].rows[0].actual[1], "exterior tangent contact has zero chord");
  assert.equal(exteriorTangent[2].rows[0].actual[0], -1, "centimeter outside exterior tangent misses");
  report.checks.push("outside-origin exact tangent and centimeter neighboring chord/miss");

  const boundaries = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const results = [];
    for (const height of [6000, 6000.01, 4000, 2000, 2]) {
      viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, height) });
      viewer.render();
      results.push({ height, rows: await window.__cloud.probe([
        [0, 1, 0, 1, 0, 0, -1, 0],
        [1, 0, 0, 1, 0, 0, -1, 0],
        [-1, 0, 0, 1, 0, 0, -1, 0],
        [1, 0, 0, 1, 0, 0, 500, 0],
      ]) });
    }
    return results;
  });
  for (const item of boundaries) { checkRows(item.rows, `boundary ${item.height}`); }
  assert.equal(boundaries[0].rows[0].actual[0], 0, "outer surface tangent starts at camera");
  assert.equal(boundaries[0].rows[0].actual[1], 0, "outer surface tangent is zero length");
  assert.equal(boundaries[1].rows[0].actual[0], -1, "centimeter outside tangent is a miss");
  assert.equal(boundaries[2].rows[0].actual[0], 0, "inside-cloud tangent begins at camera");
  assert.equal(boundaries[4].rows[2].actual[0], -1, "ground-facing ray has no cloud through Earth");
  assert.equal(boundaries[4].rows[3].actual[0], -1, "measured nearer geometry hides clouds");
  report.boundaries = boundaries;
  report.checks.push("outer tangent, centimeter boundary, in-cloud camera and explicit near-occluder distance");

  await page.evaluate(() => {
    const { viewer } = window.__m1;
    window.__cloud.originalTerrain = viewer.terrainProvider;
    class BoundedRaisedTerrain extends Cesium.CustomHeightmapTerrainProvider {
      getLevelMaximumGeometricError(level) {
        return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
      }
    }
    viewer.terrainProvider = new BoundedRaisedTerrain({
      width: 32, height: 32, callback: () => new Float32Array(32 * 32).fill(4000),
    });
  });
  const raisedSettled = await page.evaluate(() => window.__m1.settle({ longitude: 0, latitude: 0, height: 10000, heading: 0, pitch: -90, timeout: 60000 }));
  await page.evaluate(() => { document.querySelector("#cloudDiagnostic").style.visibility = "hidden"; });
  await captureM1Scene(page, report, output, "raised-terrain", { settled: raisedSettled });
  const raised = await page.evaluate(async () => {
    const row = (await window.__cloud.probe([[0, 0, 0, 0, 0, 1, -1, 1]]))[0];
    const ray = new Cesium.Ray(window.__m1.viewer.camera.positionWC, new Cesium.Cartesian3(...row.direction));
    const unclipped = new Cesium.WebGPUCloudLayer().intersect(ray);
    return { row, unclipped: unclipped.map(({ start, stop }) => ({ start, stop })), diagnostic: await window.__cloud.draw() };
  });
  checkRows([raised.row], "raised native terrain");
  assert.ok(raised.row.depth > 0 && raised.row.sceneDistance > 0, "raised native mesh provides actual scene depth");
  assert.ok(raised.row.actual[0] > 0 && raised.row.actual[1] > raised.row.actual[0], "raised terrain leaves a visible front cloud segment");
  assert.ok(Math.abs(raised.row.actual[1] - raised.row.sceneDistance) < 0.02, "actual raised terrain depth terminates the cloud segment");
  assert.ok(raised.row.actual[1] < raised.unclipped[0].stop - 1500, "raised mesh truncates cloud material before its analytic inner exit");
  assert.ok(Math.abs(raised.row.sceneDistance - raised.row.nativePickDistance) < 0.05 + raised.row.nativePickDistance * 3e-6, "raised nadir native pick and GPU depth agree tightly");
  assert.ok(raised.diagnostic.maximumTerrainLevel <= 8);
  await page.locator("#cloudDiagnostic").screenshot({ path: path.join(output, "raised-terrain-cloud.png") });
  report.raisedTerrain = { ...raised, settled: raisedSettled, provider: "native CustomHeightmapTerrainProvider", width: 32, height: 32, constantHeight: 4000, maximumLevel: 8 };
  report.checks.push("native raised 4 km heightmap depth truncates clouds before their analytic inner exit");
  await page.evaluate(() => { window.__m1.viewer.terrainProvider = window.__cloud.originalTerrain; });

  const motion = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const samples = [];
    for (let index = 0; index < 12; ++index) {
      viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(index * 0.001, 35, 4000), orientation: { heading: 0, pitch: 0, roll: 0 } });
      viewer.render();
      samples.push((await window.__cloud.probe([[0, 0, 0, 0, 0, 0, -1, 0]]))[0]);
    }
    return samples;
  });
  checkRows(motion, "bounded camera motion");
  for (let i = 1; i < motion.length; ++i) {
    assert.ok(Math.abs(motion[i].actual[1] - motion[i - 1].actual[1]) < 5, "adjacent ECEF camera samples preserve continuous exit");
  }
  report.motion = motion;
  await page.setViewportSize({ width: 800, height: 450 });
  const resize = await page.evaluate(async () => {
    window.__m1.viewer.resize();
    window.__m1.viewer.render();
    return { rows: await window.__cloud.probe([[0, 0, 0, 0, 0, 0, -1, 1]]), diagnostic: await window.__cloud.draw() };
  });
  checkRows(resize.rows, "resize");
  assert.deepEqual(resize.diagnostic.size, [800, 450]);
  await page.locator("#cloudDiagnostic").screenshot({ path: path.join(output, "resized-cloud.png") });
  report.resize = resize;
  report.checks.push("12 bounded ECEF camera steps and refreshed native depth binding after resize");
  await page.evaluate(() => window.__cloud.destroy());
  report.cleanup = await destroyM1Scene(page);
  assert.deepEqual(report.browserConsole, [], "no GPU validation errors or browser warnings");
});

function checkRows(rows, label) {
  for (const row of rows) {
    assert.equal(row.productLow, 2 ** -46, `${label}: production compensated product retains low bits`);
    assert.ok(row.actual.every(Number.isFinite), `${label}: finite GPU distances`);
    const expected = row.expected.flatMap(({ start, stop }) => [start, stop]);
    while (expected.length < 4) { expected.push(-1); }
    for (let index = 0; index < 4; ++index) {
      if (expected[index] < 0) { assert.equal(row.actual[index], -1, `${label}: absent segment ${index}`); }
      else { assert.ok(Math.abs(row.actual[index] - expected[index]) <= 0.5 + Math.abs(expected[index]) * 3e-7, `${label}: distance ${index}: GPU ${row.actual[index]} vs CPU ${expected[index]}`); }
    }
    if (row.sceneDistance >= 0) {
      if (row.measuredDepth) {
        assert.ok(Math.abs(row.sceneDistance - row.cpuSceneDistance) < 0.01 + row.cpuSceneDistance * 3e-7, `${label}: GPU depth decode agrees with CPU production depth math`);
      }
      if (row.requireNativePick) {
        assert.ok(row.nativePickDistance !== null, `${label}: native rendered-mesh pick exists`);
        assert.ok(Math.abs(row.sceneDistance - row.nativePickDistance) < 0.05 + row.nativePickDistance * 3e-6, `${label}: reconstructed depth agrees with native mesh: ${row.sceneDistance} vs ${row.nativePickDistance}`);
      }
      for (let index = 0; index < 4; index += 2) {
        if (row.actual[index] >= 0) { assert.ok(row.actual[index + 1] <= row.sceneDistance + 0.5, `${label}: cloud clipped by real depth`); }
      }
    }
  }
}

async function installProbe(page) {
  await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const { scene } = viewer;
    const device = scene.context._device;
    const cloud = new Cesium.WebGPUCloudLayer();
    const canvas = document.createElement("canvas");
    canvas.id = "cloudDiagnostic";
    canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;width:100%;height:100%";
    document.body.appendChild(canvas);
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const resources = [];
    const makeBuffer = (size, usage, data) => {
      const buffer = device.createBuffer({ size, usage, mappedAtCreation: Boolean(data) });
      if (data) { new Float32Array(buffer.getMappedRange()).set(data); buffer.unmap(); }
      return buffer;
    };
    const planetBuffer = makeBuffer(272, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const cloudBuffer = makeBuffer(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    resources.push(planetBuffer, cloudBuffer);
    const code = `${Cesium.WebGPUPlanetShader}\n${Cesium.WebGPUCloudLayerShader}
      @group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
      @group(0) @binding(1) var<uniform> cloud: WebGPUCloudLayer;
      @group(0) @binding(2) var sceneDepth: texture_depth_2d;
      struct Probe { direction: vec4f, settings: vec4f }
      @group(0) @binding(3) var<storage, read> probes: array<Probe>;
      @group(0) @binding(4) var<storage, read_write> results: array<vec4f>;
      @group(0) @binding(5) var sceneColor: texture_2d<f32>;
      @compute @workgroup_size(1) fn probeMain(@builtin(global_invocation_id) id: vec3u) {
        let input = probes[id.x];
        var direction = webgpuRayDirection(input.direction.xy, planet);
        if (input.direction.w > 0.0) { direction = normalize(input.direction.xyz); }
        let size = vec2f(textureDimensions(sceneDepth));
        let pixel = vec2i((input.direction.xy * vec2f(0.5, -0.5) + 0.5) * size);
        var distance = input.settings.z;
        var depth = 0.0;
        if (input.settings.w > 0.0) {
          direction = webgpuRayDirection((vec2f(pixel) + 0.5) / size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), planet);
          depth = textureLoad(sceneDepth, pixel, 0);
          distance = webgpuSceneRayDistance(depth, direction, planet);
        }
        results[id.x * 3u] = webgpuCloudSegments(direction, distance, cloud, planet);
        results[id.x * 3u + 1u] = vec4f(direction, distance);
        let productProbe = cloudProduct(vec2f(1.00000011920928955078125, 0.0), vec2f(1.00000011920928955078125, 0.0));
        results[id.x * 3u + 2u] = vec4f(depth, productProbe.y, 0.0, 0.0);
      }
      @vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
        let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(p[vertex], 0.0, 1.0);
      }
      @fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let size = vec2f(textureDimensions(sceneDepth));
        let direction = webgpuRayDirection(position.xy / size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), planet);
        let depth = textureLoad(sceneDepth, vec2i(position.xy), 0);
        let distance = webgpuSceneRayDistance(depth, direction, planet);
        let segments = webgpuCloudSegments(direction, distance, cloud, planet);
        let length = max(0.0, segments.y - segments.x) + max(0.0, segments.w - segments.z);
        let opacity = select(0.0, 0.35 + 0.6 * (1.0 - exp(-length / 20000.0)), length > 0.0);
        let background = clamp(textureLoad(sceneColor, vec2i(position.xy), 0).rgb, vec3f(0.0), vec3f(1.0));
        let color = mix(background, vec3f(0.18, 0.85, 1.0), opacity);
        // Red is a native-depth mask; green/blue show production shell length.
        return vec4f(select(0.015, 0.12, depth > 0.0), color.gb, 1.0);
      }`;
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label: "M3 production cloud geometry probe", code });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === "error");
    if (errors.length) { throw new Error(errors.map(({ message }) => message).join("\n")); }
    const compute = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "probeMain" } });
    const render = await device.createRenderPipelineAsync({ layout: "auto", vertex: { module, entryPoint: "vertexMain" }, fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    const validation = await device.popErrorScope();
    if (validation) { throw new Error(validation.message); }
    const update = () => {
      cloud.update(scene._planetState);
      device.queue.writeBuffer(planetBuffer, 0, scene._planetState.uniformValues);
      device.queue.writeBuffer(cloudBuffer, 0, cloud.uniformValues);
      return [
        { binding: 0, resource: { buffer: planetBuffer } },
        { binding: 1, resource: { buffer: cloudBuffer } },
        { binding: 2, resource: scene.context.sceneDepthTexture.createView() },
      ];
    };
    window.__cloud = {
      async probe(rows) {
        viewer.render();
        const entries = update();
        const input = makeBuffer(rows.length * 32, GPUBufferUsage.STORAGE, rows.flat());
        const output = makeBuffer(rows.length * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const readback = makeBuffer(rows.length * 48, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
        device.pushErrorScope("validation");
        let values;
        let error;
        try {
          const group = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [...entries, { binding: 3, resource: { buffer: input } }, { binding: 4, resource: { buffer: output } }] });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(compute); pass.setBindGroup(0, group); pass.dispatchWorkgroups(rows.length); pass.end();
          encoder.copyBufferToBuffer(output, 0, readback, 0, rows.length * 48);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          values = Array.from(new Float32Array(readback.getMappedRange()));
          readback.unmap();
        } finally {
          input.destroy(); output.destroy(); readback.destroy();
          error = await device.popErrorScope();
        }
        if (error) { throw new Error(error.message); }
        return rows.map((row, index) => {
            const v = values.slice(index * 12, index * 12 + 12);
            const direction = new Cesium.Cartesian3(...v.slice(4, 7));
            const ray = new Cesium.Ray(viewer.camera.positionWC, direction);
            const expected = cloud.intersect(ray, v[7] < 0 ? Infinity : v[7]);
            const pick = v[8] > 0 ? scene.globe.pick(ray, scene) : undefined;
            const nativePickDistance = pick ? Cesium.Cartesian3.distance(ray.origin, pick) : null;
            const cpuSceneDistance = v[8] > 0 ? Cesium.WebGPUDepth.reconstructRayDistance(v[8], direction, viewer.camera.directionWC, viewer.camera.frustum.near, viewer.camera.frustum.far) : -1;
            return { actual: v.slice(0, 4), expected: expected.map(({ start, stop }) => ({ start, stop })), direction: v.slice(4, 7), sceneDistance: v[7], cpuSceneDistance, depth: v[8], productLow: v[9], nativePickDistance, nativePickDifference: pick ? v[7] - nativePickDistance : null, measuredDepth: row[7] > 0, requireNativePick: row[5] > 0 };
          });
      },
      async draw() {
        viewer.render();
        canvas.style.visibility = "visible";
        canvas.width = viewer.canvas.width; canvas.height = viewer.canvas.height;
        const group = device.createBindGroup({ layout: render.getBindGroupLayout(0), entries: [...update(), { binding: 5, resource: scene.context.sceneColorTexture.createView() }] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(render); pass.setBindGroup(0, group); pass.draw(3); pass.end();
        device.queue.submit([encoder.finish()]);
        const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
        const ctx = copy.getContext("2d"); ctx.drawImage(canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let cloudPixels = 0, terrainPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 1] > 100 && pixels[i + 2] > 120) { ++cloudPixels; }
          if (pixels[i] >= 29 && pixels[i] <= 32) { ++terrainPixels; }
        }
        await device.queue.onSubmittedWorkDone();
        return { size: [canvas.width, canvas.height], cloudPixels, terrainPixels, maximumTerrainLevel: Math.max(...scene._renderer._draws.map(({ tile }) => tile.level)) };
      },
      destroy() { for (const resource of resources) { resource.destroy(); } context.unconfigure(); canvas.remove(); },
    };
  });
}
