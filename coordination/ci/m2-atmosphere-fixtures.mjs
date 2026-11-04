/* global Cesium, window, GPUDevice, GPUBufferUsage, GPUMapMode */

// These fixtures execute the production WGSL on the Viewer's actual device.
// Resource instrumentation observes native allocations; it never substitutes a
// successful GPU operation, terrain depth, LUT sample, or rendered pixel.
export async function trackAtmosphereResources(page) {
  await page.evaluate(() => {
    window.__m2AtmosphereAllocations = [];
    for (const kind of ["Buffer", "Texture"]) {
      const create = GPUDevice.prototype[`create${kind}`];
      GPUDevice.prototype[`create${kind}`] = function (...args) {
        const resource = create.apply(this, args);
        const record = {
          kind,
          label: args[0]?.label ?? "",
          resource,
          destroyed: false,
        };
        window.__m2AtmosphereAllocations.push(record);
        const destroy = resource.destroy;
        resource.destroy = function (...destroyArgs) {
          record.destroyed = true;
          return destroy.apply(this, destroyArgs);
        };
        return resource;
      };
    }
  });
}

export async function installAtmosphereProbe(page) {
  return page.evaluate(async () => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    const device = scene.context._device;
    if (typeof Cesium.WebGPUAtmosphereShader !== "string") {
      throw new Error("M2.2 shared atmosphere WGSL is missing");
    }
    scene.atmosphere.show = true;
    scene.globe.enableLighting = true;
    scene._atmosphere.bloomStrength = 0;
    scene.backgroundColor = Cesium.Color.clone(Cesium.Color.BLACK);
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
      "2026-03-20T12:00:00Z",
    );
    try {
      viewer.render();
    } catch (error) {
      throw new Error(`${error.message}; WebGPU context: ${scene.context._error?.message ?? "unavailable"}`, { cause: error });
    }

    const code = `${Cesium.WebGPUAtmosphereShader}
      struct AtmosphereProbe {
        ndcDistance: vec4f,
        direction: vec4f,
        pixel: vec4f,
        lutUv: vec4f,
      }
      @group(0) @binding(17) var<storage, read> atmosphereProbes: array<AtmosphereProbe>;
      @group(0) @binding(18) var<storage, read_write> atmosphereResults: array<vec4f>;
      @compute @workgroup_size(1)
      fn atmosphereProbeMain(@builtin(global_invocation_id) id: vec3u) {
        let input = atmosphereProbes[id.x];
        var direction = webgpuRayDirection(input.ndcDistance.xy, planet);
        if (input.direction.w > 0.0) {
          direction = normalize(input.direction.xyz);
        }
        let pixel = vec2i(input.pixel.xy);
        let depth = textureLoad(sceneDepth, pixel, 0);
        var distance = input.ndcDistance.z;
        if (input.pixel.z > 0.0) {
          distance = webgpuSceneRayDistance(depth, direction, planet);
        }
        let result = atmosphereIntegrate(direction, distance);
        let segment = webgpuAtmosphereSegment(direction, distance, planet);
        let earth = webgpuRayEllipsoid(direction, planet);
        let transPixel = vec2i(input.lutUv.xy *
                              vec2f(textureDimensions(transmittanceLut) - vec2u(1)));
        let multiPixel = vec2i(input.lutUv.xy *
                              vec2f(textureDimensions(multipleScatteringLut) - vec2u(1)));
        let i = id.x * 8u;
        atmosphereResults[i] = vec4f(result.radiance, distance);
        atmosphereResults[i + 1u] = vec4f(result.transmittance, depth);
        atmosphereResults[i + 2u] = vec4f(direction, dot(direction, planet.cameraForwardWC.xyz));
        atmosphereResults[i + 3u] = vec4f(segment, earth);
        atmosphereResults[i + 4u] = textureLoad(sceneColor, pixel, 0);
        atmosphereResults[i + 5u] = vec4f(atmosphereRayleighPhase(1.0),
          atmosphereRayleighPhase(0.0), atmosphereMiePhase(1.0), atmosphereMiePhase(-1.0));
        atmosphereResults[i + 6u] = textureLoad(transmittanceLut, transPixel, 0);
        atmosphereResults[i + 7u] = textureLoad(multipleScatteringLut, multiPixel, 0);
      }`;
    device.pushErrorScope("validation");
    let pipeline;
    let compilation;
    let validation;
    try {
      const module = device.createShaderModule({
        label: "M2.2 production atmosphere readback probe",
        code,
      });
      compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(
        (message) => message.type === "error",
      );
      if (errors.length) {
        throw new Error(errors.map((message) => message.message).join("\n"));
      }
      pipeline = await device.createComputePipelineAsync({
        label: "M2.2 production atmosphere readback",
        layout: "auto",
        compute: { module, entryPoint: "atmosphereProbeMain" },
      });
    } finally {
      validation = await device.popErrorScope();
    }
    if (validation) {
      throw new Error(validation.message);
    }

    const state = (window.__m2Atmosphere = {});
    state.fixedTime = Cesium.JulianDate.clone(viewer.clock.currentTime);
    state.originalTerrain = viewer.terrainProvider;
    state.settings = () => {
      const a = scene.atmosphere;
      return {
        show: a.show,
        rayleighScattering: [...a.rayleighScattering],
        mieScattering: a.mieScattering,
        mieExtinction: a.mieExtinction,
        rayleighScaleHeight: a.rayleighScaleHeight,
        mieScaleHeight: a.mieScaleHeight,
        mieAnisotropy: a.mieAnisotropy,
        lightIntensity: a.lightIntensity,
        multipleScatteringStrength: a.multipleScatteringStrength,
      };
    };
    state.defaults = state.settings();
    state.restore = () => {
      Object.assign(scene.atmosphere, state.defaults, {
        rayleighScattering: [...state.defaults.rayleighScattering],
      });
      viewer.clock.currentTime = Cesium.JulianDate.clone(state.fixedTime);
    };
    state.row = ({
      ndc = [0, 0],
      direction,
      distance = -1,
      pixel,
      lutUv = [0.5, 0.5],
    } = {}) => {
      if (pixel) {
        ndc = [
          (2 * (pixel[0] + 0.5)) / viewer.canvas.width - 1,
          1 - (2 * (pixel[1] + 0.5)) / viewer.canvas.height,
        ];
      }
      return [
        ...ndc, distance, 0,
        ...(direction ?? [0, 0, 0]), direction ? 1 : 0,
        ...(pixel ?? [0, 0]), pixel ? 1 : 0, 0,
        ...lutUv, 0, 0,
      ];
    };
    state.probe = async (rows) => {
      const buffers = [];
      const buffer = (size, usage, data) => {
        const result = device.createBuffer({
          label: "M2.2 temporary atmosphere probe",
          size,
          usage,
          mappedAtCreation: data !== undefined,
        });
        buffers.push(result);
        if (data !== undefined) {
          new Float32Array(result.getMappedRange()).set(data);
          result.unmap();
        }
        return result;
      };
      device.pushErrorScope("validation");
      let values;
      let error;
      try {
        const input = buffer(
          rows.length * 64,
          GPUBufferUsage.STORAGE,
          rows.flat(),
        );
        const size = rows.length * 128;
        const output = buffer(
          size,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        );
        const readback = buffer(
          size,
          GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        );
        const renderer = scene._atmosphere;
        const group = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: renderer._planetBuffer } },
            { binding: 1, resource: { buffer: renderer._parametersBuffer } },
            { binding: 2, resource: renderer._transmittanceTexture.createView() },
            { binding: 3, resource: renderer._multipleScatteringTexture.createView() },
            { binding: 4, resource: renderer._sampler },
            { binding: 5, resource: scene.context.sceneColorTexture.createView() },
            { binding: 6, resource: scene.context.sceneDepthTexture.createView() },
            { binding: 17, resource: { buffer: input } },
            { binding: 18, resource: { buffer: output } },
          ],
        });
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
        for (const resource of buffers) {
          resource.destroy();
        }
        error = await device.popErrorScope();
      }
      if (error) {
        throw new Error(error.message);
      }
      const results = [];
      for (let offset = 0; offset < values.length; offset += 32) {
        results.push(values.slice(offset, offset + 32));
      }
      return results;
    };
    state.sunLocation = (offset = 0) => {
      const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(state.fixedTime);
      return {
        longitude: Cesium.Math.toDegrees(Math.atan2(sun.y, sun.x)) + offset,
        latitude: Cesium.Math.toDegrees(Math.asin(sun.z)),
        sun: [sun.x, sun.y, sun.z],
      };
    };
    state.setView = ({ longitude, latitude, height, pitch = -90, heading = 0 }) => {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0,
        },
      });
      viewer.render();
    };
    state.pixelSamples = async (fractions, terrainSubpixel = false) => {
      const { data, width, height } = window.__m1.pixels();
      const pixels = fractions.map(([x, y]) => [
        Math.min(width - 1, Math.floor(width * x)),
        Math.min(height - 1, Math.floor(height * y)),
      ]);
      const gpu = await state.probe(pixels.map((pixel) => state.row({ pixel })));
      return pixels.map((pixel, index) => {
        const offset = (pixel[1] * width + pixel[0]) * 4;
        const ray = viewer.camera.getPickRay(
          new Cesium.Cartesian2(pixel[0] + 0.5, pixel[1] + 0.5),
        );
        const picked = scene.globe.pick(ray, scene);
        const ellipsoid = Cesium.WebGPUPlanetMath.intersectEllipsoid(ray);
        const sceneDistance = gpu[index][3];
        const depthPoint = sceneDistance >= 0
          ? Cesium.Cartesian3.add(
              ray.origin,
              Cesium.Cartesian3.multiplyByScalar(ray.direction, sceneDistance, new Cesium.Cartesian3()),
              new Cesium.Cartesian3(),
            )
          : undefined;
        const ellipsoidPoint = ellipsoid && ellipsoid.start >= 0
          ? Cesium.Cartesian3.add(
              ray.origin,
              Cesium.Cartesian3.multiplyByScalar(ray.direction, ellipsoid.start, new Cesium.Cartesian3()),
              new Cesium.Cartesian3(),
            )
          : undefined;
        const surfacePoint = depthPoint ?? picked ?? ellipsoidPoint;
        const surfaceNormal = surfacePoint
          ? Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(surfacePoint, new Cesium.Cartesian3())
          : undefined;
        const sunCosine = surfaceNormal
          ? Cesium.Cartesian3.dot(surfaceNormal, scene._planetState.sunDirectionWC)
          : undefined;
        const surfaceHeight = surfacePoint
          ? Cesium.Ellipsoid.WGS84.cartesianToCartographic(surfacePoint).height
          : null;
        const cosine = Cesium.Cartesian3.dot(ray.direction, viewer.camera.directionWC);
        // Rasterization snaps projected vertices. Chromium's SwiftShader GN
        // configuration supports a 1/16-pixel grid (see WEBGPU_M2.2.md).
        // Measure a fixed geometric neighborhood, not an adjustable meter
        // tolerance, for the oblique mountain fixture only. M2.1's depth
        // reconstruction precision assertions remain unchanged.
        let rasterPickDistances;
        if (terrainSubpixel) {
          rasterPickDistances = [];
          for (const dx of [-1 / 16, 1 / 16]) {
            for (const dy of [-1 / 16, 1 / 16]) {
              const neighbor = viewer.camera.getPickRay(
                new Cesium.Cartesian2(pixel[0] + 0.5 + dx, pixel[1] + 0.5 + dy),
              );
              const position = scene.globe.pick(neighbor, scene);
              rasterPickDistances.push(position
                ? Cesium.Cartesian3.distance(neighbor.origin, position)
                : null);
            }
          }
        }
        return {
          pixel,
          displayed: Array.from(data.slice(offset, offset + 4)),
          gpu: gpu[index],
          nativeRay: [ray.direction.x, ray.direction.y, ray.direction.z],
          cosine,
          pickedDistance: picked ? Cesium.Cartesian3.distance(ray.origin, picked) : null,
          pickedHeight: picked ? Cesium.Ellipsoid.WGS84.cartesianToCartographic(picked).height : null,
          surfaceHeight,
          surfaceNormal: surfaceNormal ? [surfaceNormal.x, surfaceNormal.y, surfaceNormal.z] : null,
          sunCosine,
          atmosphereEnabled: scene.atmosphere.show,
          surfaceLightingEnabled: scene.globe.enableLighting,
          lightIntensity: scene.atmosphere.lightIntensity,
          ellipsoidDistance: ellipsoid?.start ?? null,
          rasterPickDistances,
        };
      });
    };
    state.installMountain = (longitude, latitude) => {
      const tilingScheme = new Cesium.GeographicTilingScheme();
      const centerLongitude = Cesium.Math.toRadians(longitude);
      const centerLatitude = Cesium.Math.toRadians(latitude);
      const width = 33;
      viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
        width,
        height: width,
        tilingScheme,
        credit: "M2.2 deterministic Gaussian mountain fixture",
        callback(x, y, level) {
          const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
          const heights = new Float32Array(width * width);
          for (let row = 0; row < width; ++row) {
            const lat = rectangle.north - (rectangle.height * row) / (width - 1);
            for (let column = 0; column < width; ++column) {
              const lon = rectangle.west + (rectangle.width * column) / (width - 1);
              const dx = Cesium.Math.negativePiToPi(lon - centerLongitude) * Math.cos(centerLatitude);
              const dy = lat - centerLatitude;
              heights[row * width + column] =
                6000 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.008 ** 2));
            }
          }
          return heights;
        },
      });
    };
    return {
      settings: state.defaults,
      shaderDiagnostics: compilation.messages.map(({ type, message }) => ({ type, message })),
      buffers: [scene._atmosphere._planetBuffer.size, scene._atmosphere._parametersBuffer.size],
      sceneColorFormat: scene.context.sceneColorTexture.format,
      lutFormats: [scene._atmosphere._transmittanceTexture.format, scene._atmosphere._multipleScatteringTexture.format],
    };
  });
}
