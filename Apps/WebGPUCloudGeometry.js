/* global Cesium */

// M3-01 diagnostic overlay only: reuse the production shell intersection and
// finished terrain depth without changing atmosphere or normal scene rendering.
export async function createCloudGeometryPreview(scene) {
  const context = scene.context;
  const device = context._device;
  const layer = new Cesium.WebGPUCloudLayer({ ellipsoid: scene.ellipsoid });
  const module = device.createShaderModule({
    label: "M3-01 cloud geometry preview",
    code: `${Cesium.WebGPUPlanetShader}
${Cesium.WebGPUCloudLayerShader}
@group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
@group(0) @binding(1) var<uniform> cloud: WebGPUCloudLayer;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sceneDepth));
  let ndc = position.xy / size * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
  let direction = webgpuRayDirection(ndc, planet);
  let depth = textureLoad(sceneDepth, vec2i(position.xy), 0);
  let distance = webgpuSceneRayDistance(depth, direction, planet);
  let segments = webgpuCloudSegments(direction, distance, cloud, planet);
  let path = max(0.0, segments.y - segments.x) + max(0.0, segments.w - segments.z);
  let alpha = select(0.0, 0.22 + 0.4 * (1.0 - exp(-path / 20000.0)), path > 0.0);
  return vec4f(0.12, 0.8, 1.0, alpha);
}`,
  });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter(
    (message) => message.type === "error",
  );
  if (errors.length) {
    throw new Error(errors.map((message) => message.message).join("\n"));
  }
  const pipeline = await device.createRenderPipelineAsync({
    label: "M3-01 cloud geometry preview",
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: context._format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
  const planetBuffer = device.createBuffer({
    label: "M3 cloud preview planet",
    size: 272,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cloudBuffer = device.createBuffer({
    label: "M3 cloud preview shell",
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return {
    render() {
      layer.update(scene._planetState);
      device.queue.writeBuffer(
        planetBuffer,
        0,
        scene._planetState.uniformValues,
      );
      device.queue.writeBuffer(cloudBuffer, 0, layer.uniformValues);
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: planetBuffer } },
          { binding: 1, resource: { buffer: cloudBuffer } },
          { binding: 2, resource: context.sceneDepthTexture.createView() },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context._canvasContext.getCurrentTexture().createView(),
            loadOp: "load",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      planetBuffer.destroy();
      cloudBuffer.destroy();
    },
  };
}
