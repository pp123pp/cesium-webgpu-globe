/* global Cesium, window, GPUBufferUsage, GPUMapMode */
import { installAtmosphereProbe } from "./m2-atmosphere-fixtures.mjs";

// Real production WGSL, Viewer's GPUDevice, completed terrain depth, and actual
// canvas pixels. The CPU geometry reference uses native Cesium ephemerides,
// camera projection, ray/ellipsoid intersection and rendered-mesh picking.
export async function installSunProbe(page) {
  const coldSun = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    if (!scene.sun) { throw new Error("M2.3 solar settings are missing"); }
    scene.atmosphere.show = false;
    scene.sun.show = true;
    scene.backgroundColor = Cesium.Color.clone(Cesium.Color.BLACK);
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
    const direction = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      viewer.clock.currentTime, new Cesium.Cartesian3(),
    );
    const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(
      viewer.clock.currentTime, new Cesium.Matrix3(),
    );
    Cesium.Matrix3.multiplyByVector(rotation, direction, direction);
    Cesium.Cartesian3.normalize(direction, direction);
    const right = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    viewer.camera.frustum = new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(12), aspectRatio: viewer.canvas.width / viewer.canvas.height,
      near: 0.1, far: 500000000,
    });
    viewer.camera.setView({
      destination: Cesium.Cartesian3.multiplyByScalar(direction, Cesium.Ellipsoid.WGS84.maximumRadius + 400000, new Cesium.Cartesian3()),
      orientation: { direction, up: Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()) },
    });
    // This first real Sun frame precedes every atmosphere/LUT probe. It catches
    // a sun-only pipeline accidentally depending on already-created LUTs.
    const { data, width, height } = window.__m1.pixels();
    const offset = ((height >> 1) * width + (width >> 1)) * 4;
    await scene.context._device.queue.onSubmittedWorkDone();
    return {
      center: Array.from(data.slice(offset, offset + 4)),
      corner: Array.from(data.slice(0, 4)),
      errors: [...window.__m1.errors],
    };
  });
  const atmosphere = await installAtmosphereProbe(page);
  const sun = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    const device = scene.context._device;
    if (!scene.sun) {
      throw new Error("M2.3 solar settings are missing");
    }
    const state = (window.__m2Sun = {});
    state.defaults = { ...scene.sun };
    state.fixedTime = Cesium.JulianDate.clone(viewer.clock.currentTime);
    state.originalTerrain = viewer.terrainProvider;
    scene.globe.baseColor = new Cesium.Color(0.2, 0.45, 0.7, 1);
    state.reset = () => {
      window.__m2Atmosphere.restore();
      Object.assign(scene.sun, state.defaults, { show: true, glowStrength: 0 });
      scene.atmosphere.show = false;
      scene._atmosphere.bloomStrength = 0;
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: Cesium.Math.toRadians(12),
        aspectRatio: viewer.canvas.width / viewer.canvas.height,
        near: 0.1,
        far: 500000000,
      });
    };
    state.nativeSun = () => {
      const inertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        viewer.clock.currentTime,
        new Cesium.Cartesian3(),
      );
      const rotation = Cesium.CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(
        viewer.clock.currentTime,
        new Cesium.Matrix3(),
      );
      return Cesium.Cartesian3.normalize(
        Cesium.Matrix3.multiplyByVector(rotation, inertial, inertial),
        inertial,
      );
    };
    state.project = (direction) => {
      const eye = Cesium.Matrix4.multiplyByVector(
        viewer.camera.viewMatrix,
        new Cesium.Cartesian4(direction.x, direction.y, direction.z, 0),
        new Cesium.Cartesian4(),
      );
      const clip = Cesium.Matrix4.multiplyByVector(
        viewer.camera.frustum.projectionMatrix,
        eye,
        new Cesium.Cartesian4(),
      );
      return [
        ((clip.x / clip.w + 1) * viewer.canvas.width) / 2,
        ((1 - clip.y / clip.w) * viewer.canvas.height) / 2,
      ];
    };
    state.rayAt = (x, y) => viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
    state.earthHit = (ray) => {
      const interval = Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84);
      return interval && interval.stop > 0 ? interval : undefined;
    };
    state.originAtElevation = (height, elevation) => {
      const direction = state.nativeSun();
      const longitude = Math.atan2(direction.y, direction.x) + Math.acos(
        Math.sin(Cesium.Math.toRadians(elevation)) / Math.hypot(direction.x, direction.y),
      );
      return Cesium.Cartesian3.fromRadians(longitude, 0, height);
    };
    state.look = (origin, direction = state.nativeSun()) => {
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin, new Cesium.Cartesian3());
      let right = Cesium.Cartesian3.cross(direction, normal, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitude(right) < 1e-5) {
        right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, right);
      }
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      viewer.camera.setView({ destination: origin, orientation: { direction, up } });
      viewer.camera.update(Cesium.SceneMode.SCENE3D);
    };
    state.setElevation = (height, elevation) => {
      state.look(state.originAtElevation(height, elevation));
      return { height, elevation };
    };
    state.limbElevation = (height) => {
      const direction = state.nativeSun();
      // Bracket high-orbit limbs too; -60 degrees only covered lower views.
      let blocked = -Cesium.Math.toDegrees(Math.asin(Math.hypot(direction.x, direction.y))) + 1e-5;
      let clear = 0;
      for (let iteration = 0; iteration < 44; ++iteration) {
        const middle = (blocked + clear) / 2;
        const ray = new Cesium.Ray(state.originAtElevation(height, middle), direction);
        if (state.earthHit(ray)) { blocked = middle; } else { clear = middle; }
      }
      return (blocked + clear) / 2;
    };
    state.pixelAtAngle = (angle) => {
      const direction = Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(viewer.camera.directionWC, Math.cos(angle), new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(viewer.camera.rightWC, Math.sin(angle), new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      return state.project(direction).map(Math.floor);
    };
    state.centerPixel = () => state.project(state.nativeSun()).map(Math.floor);
    state.prepareMountain = (minimumHeight = 5500) => {
      const height = 20000;
      const direction = state.nativeSun();
      let low = state.limbElevation(height);
      let high = 0;
      let closest;
      for (let iteration = 0; iteration < 44; ++iteration) {
        const middle = (low + high) / 2;
        const origin = state.originAtElevation(height, middle);
        const distance = -Cesium.Cartesian3.dot(origin, direction);
        closest = Cesium.Ray.getPoint(new Cesium.Ray(origin, direction), distance);
        const altitude = Cesium.Ellipsoid.WGS84.cartesianToCartographic(closest).height;
        if (altitude < minimumHeight) { low = middle; } else { high = middle; }
      }
      const elevation = (low + high) / 2;
      state.setElevation(height, elevation);
      const origin = viewer.camera.positionWC;
      closest = Cesium.Ray.getPoint(
        new Cesium.Ray(origin, direction), -Cesium.Cartesian3.dot(origin, direction),
      );
      const mountain = Cesium.Ellipsoid.WGS84.cartesianToCartographic(closest);
      window.__m2Atmosphere.installMountain(
        Cesium.Math.toDegrees(mountain.longitude), Cesium.Math.toDegrees(mountain.latitude),
      );
      return {
        height, elevation,
        rayMinimumHeight: mountain.height,
        longitude: Cesium.Math.toDegrees(mountain.longitude),
        latitude: Cesium.Math.toDegrees(mountain.latitude),
      };
    };

    // The same capture harness must probe both the accepted pre-B4 bundle and
    // B4's additional transport input, without changing either production shader.
    const transportArgument = /fn sunRadiance\([^)]*viewTransmittance/.test(Cesium.WebGPUAtmosphereShader)
      ? ", transport.transmittance" : "";
    const code = `${Cesium.WebGPUAtmosphereShader}
      @group(0) @binding(17) var<storage, read> solarPixels: array<vec4f>;
      @group(0) @binding(18) var<storage, read_write> solarResults: array<vec4f>;
      @compute @workgroup_size(1)
      fn solarProbeMain(@builtin(global_invocation_id) id: vec3u) {
        let pixel = vec2i(solarPixels[id.x].xy);
        let ndc = vec2f(2.0 * (f32(pixel.x) + 0.5) / atmosphere.viewport.x - 1.0,
                       1.0 - 2.0 * (f32(pixel.y) + 0.5) / atmosphere.viewport.y);
        let direction = webgpuRayDirection(ndc, planet);
        let pixelWidth = 2.0 / (atmosphere.viewport.x * planet.projection.x);
        let depth = textureLoad(sceneDepth, pixel, 0);
        let distance = webgpuSceneRayDistance(depth, direction, planet);
        var transport = AtmosphereResult(vec3f(0.0), vec3f(1.0));
        if (atmosphere.viewport.z > 0.0) {
          transport = atmosphereIntegrate(direction, distance);
        }
        var solar = vec3f(0.0);
        if (atmosphere.viewport.w > 0.0) {
          solar = sunRadiance(direction, pixel, pixelWidth${transportArgument});
        }
        let i = id.x * 6u;
        solarResults[i] = vec4f(solar, sunDiskCoverage(direction, pixelWidth));
        solarResults[i + 1u] = vec4f(transport.transmittance, depth);
        solarResults[i + 2u] = vec4f(transport.radiance, distance);
        solarResults[i + 3u] = textureLoad(sceneColor, pixel, 0);
        solarResults[i + 4u] = vec4f(direction, pixelWidth);
        solarResults[i + 5u] = planet.sunDirectionWC;
      }`;
    device.pushErrorScope("validation");
    let compilation;
    let pipeline;
    let error;
    try {
      const module = device.createShaderModule({ label: "M2.3 production solar probe", code });
      compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) { throw new Error(errors.map((message) => message.message).join("\n")); }
      pipeline = await device.createComputePipelineAsync({
        label: "M2.3 production solar readback", layout: "auto",
        compute: { module, entryPoint: "solarProbeMain" },
      });
    } finally {
      error = await device.popErrorScope();
    }
    if (error) { throw new Error(error.message); }

    state.probe = async (pixels) => {
      const buffers = [];
      const buffer = (size, usage, values) => {
        const result = device.createBuffer({
          label: "M2.3 temporary solar probe", size, usage,
          mappedAtCreation: values !== undefined,
        });
        buffers.push(result);
        if (values !== undefined) {
          new Float32Array(result.getMappedRange()).set(values);
          result.unmap();
        }
        return result;
      };
      device.pushErrorScope("validation");
      let values;
      let validation;
      try {
        const input = buffer(pixels.length * 16, GPUBufferUsage.STORAGE,
          pixels.flatMap(([x, y]) => [x, y, 0, 0]));
        const size = pixels.length * 96;
        const output = buffer(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const readback = buffer(size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
        const renderer = scene._atmosphere;
        const bindings = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: renderer._planetBuffer } },
            { binding: 1, resource: { buffer: renderer._parametersBuffer } },
            { binding: 2, resource: renderer._transmittanceTexture.createView() },
            { binding: 3, resource: renderer._multipleScatteringTexture.createView() },
            { binding: 4, resource: renderer._sampler },
            { binding: 5, resource: scene.context.sceneColorTexture.createView() },
            { binding: 6, resource: scene.context.sceneDepthTexture.createView() },
            ...renderer._solarTextures.map((texture, index) => ({
              binding: 7 + index,
              resource: texture.createView(),
            })),
            { binding: 16, resource: renderer._sampler },
            { binding: 17, resource: { buffer: input } },
            { binding: 18, resource: { buffer: output } },
          ],
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindings);
        pass.dispatchWorkgroups(pixels.length);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, size);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        values = Array.from(new Float32Array(readback.getMappedRange()));
        readback.unmap();
      } finally {
        for (const resource of buffers) { resource.destroy(); }
        validation = await device.popErrorScope();
      }
      if (validation) { throw new Error(validation.message); }
      const rows = [];
      for (let offset = 0; offset < values.length; offset += 24) {
        rows.push(values.slice(offset, offset + 24));
      }
      return rows;
    };
    state.samples = async (pixels, image, offImage) => {
      const gpu = await state.probe(pixels);
      return pixels.map((pixel, index) => {
        const offset = (pixel[1] * image.width + pixel[0]) * 4;
        const ray = state.rayAt(pixel[0] + 0.5, pixel[1] + 0.5);
        const ellipsoid = state.earthHit(ray);
        const picked = scene.globe.pick(ray, scene);
        return {
          pixel, gpu: gpu[index],
          displayed: Array.from(image.data.slice(offset, offset + 4)),
          withoutSun: offImage ? Array.from(offImage.data.slice(offset, offset + 4)) : null,
          exposure: scene.exposure,
          nativeRay: [ray.direction.x, ray.direction.y, ray.direction.z],
          ellipsoid: ellipsoid ? [ellipsoid.start, ellipsoid.stop] : null,
          pickedDistance: picked ? Cesium.Cartesian3.distance(ray.origin, picked) : null,
          pickedHeight: picked ? Cesium.Ellipsoid.WGS84.cartesianToCartographic(picked).height : null,
        };
      });
    };
    state.observe = async ({ geometry = true, pixels } = {}) => {
      // Both copies are made synchronously in the same task: no later cleared
      // swap texture or async terrain completion can masquerade as Sun pixels.
      scene.sun.show = false;
      const off = window.__m1.pixels();
      scene.sun.show = true;
      const on = window.__m1.pixels();
      await device.queue.onSubmittedWorkDone();
      const nativeSun = state.nativeSun();
      const expectedCenter = state.project(nativeSun);
      const centerPixel = expectedCenter.map(Math.floor);
      const projection = viewer.camera.frustum.projectionMatrix;
      const pixelWidth = 2 / (on.width * projection[0]);
      const radiusPixels = Math.tan(scene.sun.angularRadius) * on.width * projection[0] / 2;
      const roiRadius = Math.ceil(radiusPixels + 3);
      const decode = (byte) => {
        const encoded = byte / 255;
        return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
      };
      let maxDelta = 0;
      let changedPixels = 0;
      for (let offset = 0; offset < on.data.length; offset += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; ++channel) {
          delta = Math.max(delta, Math.abs(on.data[offset + channel] - off.data[offset + channel]));
        }
        maxDelta = Math.max(maxDelta, delta);
        if (delta > 3) { ++changedPixels; }
      }
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = on.width;
      let maxX = -1;
      let minY = on.height;
      let maxY = -1;
      const reference = { visible: 0, hidden: 0, mismatches: 0, examples: [] };
      for (let y = Math.max(0, centerPixel[1] - roiRadius); y <= Math.min(on.height - 1, centerPixel[1] + roiRadius); ++y) {
        for (let x = Math.max(0, centerPixel[0] - roiRadius); x <= Math.min(on.width - 1, centerPixel[0] + roiRadius); ++x) {
          const offset = (y * on.width + x) * 4;
          let linearDelta = 0;
          for (let channel = 0; channel < 3; ++channel) {
            linearDelta += decode(on.data[offset + channel]) - decode(off.data[offset + channel]);
          }
          linearDelta /= 3;
          const lit = linearDelta > 0.4;
          if (lit) {
            ++count;
            sumX += x + 0.5;
            sumY += y + 0.5;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
          if (!geometry) { continue; }
          const ray = state.rayAt(x + 0.5, y + 0.5);
          const separation = Cesium.Cartesian3.angleBetween(ray.direction, nativeSun);
          // Exclude only a fixed two-pixel boundary for raster/AA uncertainty.
          const clear = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].map(([dx, dy]) =>
            !state.earthHit(state.rayAt(x + 0.5 + dx, y + 0.5 + dy)));
          const inside = separation < scene.sun.angularRadius - 2 * pixelWidth;
          const visible = inside && clear.every(Boolean);
          const hidden = separation > scene.sun.angularRadius + 2 * pixelWidth ||
            (inside && clear.every((value) => !value));
          if (visible) { ++reference.visible; }
          if (hidden) { ++reference.hidden; }
          if ((visible && !lit) || (hidden && linearDelta > 0.015)) {
            ++reference.mismatches;
            if (reference.examples.length < 6) { reference.examples.push({ x, y, linearDelta, visible, hidden }); }
          }
        }
      }
      const centroid = count ? [sumX / count, sumY / count] : null;
      const diameter = count ? Cesium.Math.toDegrees(Cesium.Cartesian3.angleBetween(
        state.rayAt(minX, centroid[1]).direction,
        state.rayAt(maxX + 1, centroid[1]).direction,
      )) : null;
      return {
        size: [on.width, on.height], expectedCenter,
        nativeSun: [nativeSun.x, nativeSun.y, nativeSun.z],
        pixelWidth, radiusPixels, maxDelta, changedPixels,
        mask: { count, centroid, diameterDegrees: diameter, bounds: count ? [minX, minY, maxX, maxY] : null },
        reference,
        samples: await state.samples(pixels ?? [centerPixel], on, off),
      };
    };
    state.reset();
    state.setElevation(400000, 60);
    scene.sun.show = true;
    viewer.render();
    return {
      settings: state.defaults,
      shaderDiagnostics: compilation.messages.map(({ type, message }) => ({ type, message })),
    };
  });
  return { coldSun, atmosphere, sun };
}
