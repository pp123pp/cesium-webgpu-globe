/* global Cesium, window, GPUBufferUsage, GPUMapMode, GPUDevice */
import assert from "node:assert/strict";
import process from "node:process";
import {
  runM1BrowserSuite,
  installM1Scene,
  captureM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";

process.env.M1_OUTPUT ??= "Build/m2-foundation";

// Real WGSL execution and real rendered depth. No successful GPU operation is
// mocked; the CPU reference uses independent native camera/projection operations.
await runM1BrowserSuite("m2-foundation", async ({ page, report, output }) => {
  await page.evaluate(() => {
    const allocated = [];
    window.__m2allocations = allocated;
    for (const kind of ["Buffer", "Texture"]) {
      const create = GPUDevice.prototype[`create${kind}`];
      GPUDevice.prototype[`create${kind}`] = function (...args) {
        const resource = create.apply(this, args);
        const row = { kind, destroyed: false };
        allocated.push(row);
        const destroy = resource.destroy;
        resource.destroy = function (...args) {
          row.destroyed = true;
          return destroy.apply(this, args);
        };
        return resource;
      };
    }
  });
  await installM1Scene(page, { baseLayer: false });
  await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    viewer.scene.globe.baseColor = new Cesium.Color(0.2, 0.45, 0.7, 1);
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    const device = viewer.scene.context._device;
    if (typeof Cesium.WebGPUPlanetShader !== "string") {
      throw new Error("M2.1 shared WGSL interface is missing");
    }
    const code = `${Cesium.WebGPUPlanetShader}
      struct Probe { ndcDepth: vec4f, direction: vec4f, high: vec4f, low: vec4f }
      @group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
      @group(0) @binding(1) var<storage, read> probes: array<Probe>;
      @group(0) @binding(2) var sceneDepth: texture_depth_2d;
      @group(0) @binding(3) var<storage, read_write> results: array<vec4f>;
      @compute @workgroup_size(1) fn probeMain(@builtin(global_invocation_id) id: vec3u) {
        let input = probes[id.x];
        var direction = webgpuRayDirection(input.ndcDepth.xy, planet);
        if (input.direction.w == 1.0) { direction = normalize(input.direction.xyz); }
        var depth = input.ndcDepth.z;
        if (input.ndcDepth.w == 1.0) {
          depth = textureLoad(sceneDepth, vec2i(i32(input.high.w), i32(input.low.w)), 0);
        }
        let distance = webgpuSceneRayDistance(depth, direction, planet);
        let earth = webgpuRayEllipsoid(direction, planet);
        let atmosphere = webgpuRayAtmosphere(direction, planet);
        let segment = webgpuAtmosphereSegment(direction, distance, planet);
        let i = id.x * 6u;
        results[i] = vec4f(direction, length(direction));
        results[i+1u] = vec4f(earth, atmosphere);
        results[i+2u] = vec4f(segment, distance, depth);
        results[i+3u] = vec4f(webgpuRelativePosition(input.high.xyz, input.low.xyz, planet), 0);
        results[i+4u] = planet.sunDirectionWC;
        results[i+5u] = planet.sunDirectionEC;
      }`;
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label: "M2.1 mathematical probe", code });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter((message) => message.type === "error");
    if (errors.length) {throw new Error(errors.map((message) => message.message).join("\n"));}
    const pipeline = await device.createComputePipelineAsync({
      label: "M2.1 mathematical readback", layout: "auto", compute: { module, entryPoint: "probeMain" },
    });
    const validation = await device.popErrorScope();
    if (validation) {throw new Error(validation.message);}
    window.__m2probe = async (rows, state = viewer.scene._planetState) => {
      const buffers = [];
      const buffer = (size, usage, data) => {
        const result = device.createBuffer({ size, usage, mappedAtCreation: data !== undefined });
        buffers.push(result);
        if (data !== undefined) {
          new Float32Array(result.getMappedRange()).set(data);
          result.unmap();
        }
        return result;
      };
      device.pushErrorScope("validation");
      let values;
      let validation;
      try {
        const uniform = buffer(192, GPUBufferUsage.UNIFORM, state.uniformValues);
        const input = buffer(rows.length * 64, GPUBufferUsage.STORAGE, rows.flat());
        const size = rows.length * 96;
        const output = buffer(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const readback = buffer(size, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: input } },
          { binding: 2, resource: viewer.scene.context.sceneDepthTexture.createView() },
          { binding: 3, resource: { buffer: output } },
        ] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(rows.length);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, size);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        values = Array.from(new Float32Array(readback.getMappedRange()));
        readback.unmap();
      } finally {
        for (const resource of buffers) {resource.destroy();}
        validation = await device.popErrorScope();
      }
      if (validation) { throw new Error(validation.message); }
      const results = [];
      for (let offset = 0; offset < values.length; offset += 24) { results.push(values.slice(offset, offset + 24)); }
      return results;
    };
    window.__m2row = ({ ndc = [0, 0], depth = 0, pixel, direction, point } = {}) => {
      const camera = viewer.camera;
      point ??= Cesium.Cartesian3.add(camera.positionWC, new Cesium.Cartesian3(0.01, -0.02, 1.25), new Cesium.Cartesian3());
      const encoded = Cesium.EncodedCartesian3.fromCartesian(point);
      return [
        ...ndc, depth, pixel ? 1 : 0,
        direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? 0, direction ? 1 : 0,
        encoded.high.x, encoded.high.y, encoded.high.z, pixel?.[0] ?? 0,
        encoded.low.x, encoded.low.y, encoded.low.z, pixel?.[1] ?? 0,
      ];
    };
  });

  report.numeric = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const results = [];
    const fixedTime = viewer.clock.currentTime;
    for (const height of [2, 400000, 35786000]) {
      viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(12.34567, 37.4, height), orientation: { heading: 0.31, pitch: -0.9, roll: 0.13 } });
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Math.PI / 3, aspectRatio: 1.8, near: 0.1, far: 500000000, xOffset: 0.02, yOffset: 0.025 });
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
      const state = new Cesium.WebGPUPlanetState().update(viewer.camera, fixedTime);
      const ndcs = [[0, 0], [-0.6, 0.3], [0.7, -0.4]];
      const projection = Cesium.WebGPUDepth.computeProjection(viewer.camera.frustum);
      const depth = projection[14] / height - projection[10];
      const rows = ndcs.map((ndc) => window.__m2row({ ndc, depth }));
      const gpu = await window.__m2probe(rows, state);
      for (let index = 0; index < ndcs.length; ++index) {
        const row = gpu[index];
        const direction = new Cesium.Cartesian3(...row.slice(0, 3));
        const ray = new Cesium.Ray(viewer.camera.positionWC, direction);
        const earth = Cesium.WebGPUPlanetMath.intersectEllipsoid(ray);
        const atmosphere = Cesium.WebGPUPlanetMath.intersectAtmosphere(ray, state.planet);
        const distance = Cesium.WebGPUDepth.reconstructRayDistance(Math.fround(depth), direction, viewer.camera.directionWC, 0.1, 500000000);
        const clip = Cesium.Matrix4.multiplyByPointAsVector(viewer.camera.viewMatrix, direction, new Cesium.Cartesian3());
        const projected = Cesium.Matrix4.multiplyByVector(viewer.camera.frustum.projectionMatrix, new Cesium.Cartesian4(clip.x, clip.y, clip.z, 0), new Cesium.Cartesian4());
        results.push({ height, ndc: ndcs[index], projected: [projected.x / projected.w, projected.y / projected.w], gpu: row, cpu: { earth, atmosphere, distance }, sun: [state.sunDirectionWC.x, state.sunDirectionWC.y, state.sunDirectionWC.z] });
      }
    }
    return results;
  });
  for (const sample of report.numeric) {
    assert.ok(sample.gpu.every(Number.isFinite));
    assert.ok(Math.abs(sample.gpu[3] - 1) < 2e-7);
    for (let i = 0; i < 2; i++) {assert.ok(Math.abs(sample.projected[i] - sample.ndc[i]) < 5e-7, "off-center projection and pixel axes round-trip");}
    assert.ok(Math.abs(sample.gpu[10] - sample.cpu.distance) < Math.max(0.00001, sample.cpu.distance * 5e-7));
    for (const [offset, expected] of [[4, sample.cpu.earth], [6, sample.cpu.atmosphere]]) {
      if (!expected) {assert.equal(sample.gpu[offset], -1);}
      else {for (const [i, key] of ["start", "stop"].entries()) {
        assert.ok(Math.abs(sample.gpu[offset + i] - expected[key]) < Math.max(0.005, expected[key] * 1e-5), `GPU ${key} at ${sample.height} m: ${sample.gpu[offset + i]} vs ${expected[key]}`);
      }}
    }
    for (const [i, expected] of [0.01, -0.02, 1.25].entries()) {assert.ok(Math.abs(sample.gpu[12 + i] - expected) < 0.004, "split coordinate subtraction retains local offsets");}
    for (let i = 0; i < 3; i++) {assert.ok(Math.abs(sample.gpu[16 + i] - sample.sun[i]) < 1e-7);}
  }
  report.checks.push("WGSL unit rays, asymmetric projection, meter intervals, noncentral depth and split-coordinate precision at three altitudes");

  report.boundaries = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const C = Cesium.Cartesian3;
    const cases = [];
    for (const [longitude, latitude] of [[12.34567, 37.4], [-177, -87], [0, 90]]) {
      const origin = C.fromDegrees(longitude, latitude);
      const frame = Cesium.FixedFrameTransforms.eastNorthUpToFixedFrame(origin);
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
      const east = Cesium.Matrix4.multiplyByPointAsVector(frame, C.UNIT_X, new C());
      const north = Cesium.Matrix4.multiplyByPointAsVector(frame, C.UNIT_Y, new C());
      for (const [name, direction] of [["outward", normal], ["inward", C.negate(normal, new C())], ["east-tangent", east], ["north-tangent", north]]) {
        cases.push({ name: `${longitude}/${latitude}/${name}`, origin, direction });
      }
      cases.push({ name: `${longitude}/${latitude}/centimeter`, origin: C.fromDegrees(longitude, latitude, 0.01), direction: C.negate(normal, new C()) });
      cases.push({ name: `${longitude}/${latitude}/high-orbit-hit`, origin: C.fromDegrees(longitude, latitude, 35786000), direction: C.negate(normal, new C()) });
    }
    const a = 6378137;
    cases.push(
      { name: "exterior-tangent", origin: new C(-1000, a, 0), direction: C.UNIT_X },
      { name: "exterior-near-hit", origin: new C(-1000, a - 0.01, 0), direction: C.UNIT_X },
      { name: "exterior-near-miss", origin: new C(-1000, a + 0.01, 0), direction: C.UNIT_X },
      { name: "atmosphere-surface-outward", origin: new C(a + 100000, 0, 0), direction: C.UNIT_X },
      { name: "space-outward-miss", origin: new C(a + 400000, 0, 0), direction: C.UNIT_X },
    );
    const output = [];
    for (const input of cases) {
      viewer.camera.setView({ destination: input.origin });
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
      const state = new Cesium.WebGPUPlanetState().update(viewer.camera, viewer.clock.currentTime);
      const gpu = (await window.__m2probe([window.__m2row({ direction: input.direction })], state))[0];
      const ray = new Cesium.Ray(input.origin, input.direction);
      output.push({ name: input.name, gpu, cpu: {
        earth: Cesium.WebGPUPlanetMath.intersectEllipsoid(ray),
        atmosphere: Cesium.WebGPUPlanetMath.intersectAtmosphere(ray, state.planet),
        segment: Cesium.WebGPUPlanetMath.clipAtmosphereRay(ray, state.planet),
      } });
    }
    return output;
  });
  for (const sample of report.boundaries) {
    assert.ok(sample.gpu.every(Number.isFinite), sample.name);
    for (const [offset, expected] of [[4, sample.cpu.earth], [6, sample.cpu.atmosphere], [8, sample.cpu.segment]]) {
      if (expected === undefined) {
        assert.equal(sample.gpu[offset], -1, sample.name);
      } else {
        for (const [index, key] of ["start", "stop"].entries()) {
          assert.ok(Math.abs(sample.gpu[offset + index] - expected[key]) < Math.max(0.005, expected[key] * 1e-5), `${sample.name}: ${key} ${sample.gpu[offset + index]} vs ${expected[key]}`);
        }
      }
    }
  }
  report.checks.push("WGSL generic/polar ground contacts, centimeter heights, high-orbit hits, exterior tangent/near-miss and atmosphere boundary");

  // Restore the native symmetric frustum before measuring actual terrain depth.
  await page.evaluate(() => {
    window.__m1.viewer.camera.frustum = new Cesium.PerspectiveFrustum({ fov: Math.PI / 3, aspectRatio: 1280 / 720, near: 0.1, far: 500000000 });
  });
  for (const [name, height] of [["high-orbit", 35786000], ["low-orbit", 400000], ["ground", 2]]) {
    const settled = await page.evaluate((height) => window.__m1.settle({ longitude: 12.34567, latitude: 37.4, height, pitch: -90 }), height);
    const measurement = await page.evaluate(async () => {
      const { viewer } = window.__m1;
      viewer.render();
      const width = viewer.canvas.width, height = viewer.canvas.height;
      const pixels = [[width >> 1, height >> 1], [Math.floor(width * 0.47), Math.floor(height * 0.52)]];
      const rows = pixels.map((pixel) => window.__m2row({ ndc: [2 * (pixel[0] + 0.5) / width - 1, 1 - 2 * (pixel[1] + 0.5) / height], pixel }));
      const gpu = await window.__m2probe(rows);
      const state = viewer.scene._planetState;
      return gpu.map((row) => {
        const ray = new Cesium.Ray(viewer.camera.positionWC, new Cesium.Cartesian3(...row.slice(0, 3)));
        const nativePick = viewer.scene.globe.pick(ray, viewer.scene);
        return { gpu: row, pickedDistance: nativePick ? Cesium.Cartesian3.distance(nativePick, ray.origin) : null, cameraHeight: state.cameraHeight, cameraGeocentricDistance: state.cameraGeocentricDistance };
      });
    });
    for (const value of measurement) {
      assert.ok(value.pickedDistance !== null, `${name} native rendered-mesh pick`);
      assert.ok(value.gpu[11] > 0 && value.gpu[11] <= 1, `${name} surface wrote valid reversed depth`);
      assert.ok(value.gpu[10] > 0, `${name} reconstructed forward surface`);
      assert.ok(Math.abs(value.gpu[10] - value.pickedDistance) < Math.max(0.01, value.pickedDistance * 2e-6), `${name} GPU depth agrees with native rendered-mesh pick: ${value.gpu[10]} vs ${value.pickedDistance}`);
      assert.ok(value.gpu[9] < 0 || value.gpu[9] <= value.gpu[10] + Math.max(0.01, value.gpu[10] * 2e-6), "visible atmosphere is clipped at terrain");
    }
    await captureM1Scene(page, report, output, name, { settled, measurement });
    report.checks.push(`${name}: actual terrain depth, native mesh pick, visible surface and finite camera state`);
  }

  const sky = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(12.34567, 37.4, 2), orientation: { heading: 0, pitch: Math.PI / 2, roll: 0 } });
    viewer.render();
    const width = viewer.canvas.width, height = viewer.canvas.height;
    const row = window.__m2row({ pixel: [width >> 1, height >> 1], ndc: [1 / width, -1 / height] });
    return (await window.__m2probe([row]))[0];
  });
  assert.equal(sky[11], 0);
  assert.equal(sky[10], -1, "GPU clear-depth sentinel is distinct from surface distance");
  assert.equal(sky[4], -1);
  assert.ok(sky[9] > 90000, "ground-to-sky atmosphere remains visible");
  report.sky = sky;
  report.checks.push("ground-to-sky miss, cleared depth and unoccluded atmosphere segment");
  await page.setViewportSize({ width: 960, height: 540 });
  await page.evaluate(() => { window.__m1.viewer.resize(); window.__m1.viewer.render(); });
  const resized = await page.evaluate(async () => (await window.__m2probe([window.__m2row({ pixel: [480, 270] })]))[0]);
  assert.equal(resized[11], 0);
  report.checks.push("resized depth remains readable with no stale texture binding");
  report.cleanup = await destroyM1Scene(page);
  report.nativeResources = await page.evaluate(() => {
    const rows = window.__m2allocations;
    return { created: rows.length, destroyed: rows.filter((row) => row.destroyed).length, buffers: rows.filter((row) => row.kind === "Buffer").length, textures: rows.filter((row) => row.kind === "Texture").length };
  });
  assert.equal(report.nativeResources.created, report.nativeResources.destroyed);
  report.checks.push("all native GPU buffers/textures released, including readback buffers and resized depth");
});
