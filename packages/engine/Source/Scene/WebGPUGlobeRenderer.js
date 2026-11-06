import { Matrix4, RuntimeError, WebMercatorProjection } from "@cesium/core";
import HeightmapTerrainData from "../Core/HeightmapTerrainData.js";
import TextureMinificationFilter from "../Renderer/TextureMinificationFilter.js";
import TextureMagnificationFilter from "../Renderer/TextureMagnificationFilter.js";
import WebGPUDepth from "../Renderer/WebGPUDepth.js";
import {
  computeRelativeViewProjection,
  decodeTerrainMesh,
} from "./WebGPUGlobeMath.js";

const shader = `
fn srgbToLinear(value: vec3f) -> vec3f {
  return select(pow((value + 0.055) / 1.055, vec3f(2.4)), value / 12.92,
                value <= vec3f(0.04045));
}
struct Tile { matrix: mat4x4f, clip: vec4f, color: vec4f }
@group(0) @binding(0) var<uniform> tile: Tile;
struct VertexOutput {
  @builtin(position) @invariant position: vec4f,
  @location(0) uv: vec2f,
  @location(1) mercatorT: f32,
}
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f,
  @location(2) mercatorT: f32) -> VertexOutput {
  var output: VertexOutput;
  output.position = tile.matrix * vec4f(position, 1.0);
  output.uv = uv;
  output.mercatorT = mercatorT;
  return output;
}
fn outside(uv: vec2f, rectangle: vec4f) -> bool {
  // Full tiles include native skirts. Do not clip their interpolated edge UVs:
  // float interpolation can overshoot [0,1] and cut a one-pixel crack in a skirt.
  // Internal boundaries are identical in geometry and imagery. Expanding only
  // terrain coverage writes depth where its imagery is excluded, leaving a
  // bare pixel that a neighboring tile's imagery cannot repair.
  return (rectangle.x > 0.0 && uv.x < rectangle.x) ||
         (rectangle.y > 0.0 && uv.y < rectangle.y) ||
         (rectangle.z < 1.0 && uv.x >= rectangle.z) ||
         (rectangle.w < 1.0 && uv.y >= rectangle.w);
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (outside(input.uv, tile.clip)) { discard; }
  return vec4f(srgbToLinear(tile.color.rgb), tile.color.a);
}
struct Image { rectangle: vec4f, mapping: vec4f, config: vec4f, mercator: vec4f }
@group(1) @binding(0) var dayTexture: texture_2d<f32>;
@group(1) @binding(1) var daySampler: sampler;
@group(1) @binding(2) var<uniform> imagery: Image;
@fragment fn imageryMain(input: VertexOutput) -> @location(0) vec4f {
  if (outside(input.uv, tile.clip)) { discard; }
  var t = input.uv.y;
  if (imagery.config.y == 1.0) { t = input.mercatorT; }
  var angle = 0.0;
  if (imagery.config.y >= 2.0) {
    let latitude = clamp(imagery.config.z + input.uv.y * imagery.config.w,
                         -1.4844222297453324, 1.4844222297453324);
    angle = log(tan(0.7853981633974483 + latitude * 0.5));
    if (imagery.config.y == 3.0) {
      t = (angle - imagery.mercator.z) * imagery.mercator.w;
    }
  }
  if (outside(vec2f(input.uv.x, t), imagery.rectangle)) { discard; }
  var uv = vec2f(input.uv.x, t) * imagery.mapping.zw + imagery.mapping.xy;
  if (imagery.config.y == 2.0) {
    // Polar terrain does not have a native Mercator attribute. Reproject its
    // geographic latitude, clamping the base layer to the Mercator edge.
    uv.y = (angle - imagery.mercator.x) * imagery.mercator.y;
  }
  let texel = textureSample(dayTexture, daySampler, uv);
  return vec4f(srgbToLinear(texel.rgb), texel.a * imagery.config.x);
}`;

/** Mesh upload and one opaque Globe pass; deliberately not a general renderer. @private */
class WebGPUGlobeRenderer {
  constructor(context) {
    this.context = context;
    this._draws = [];
    this._textures = new Set();
    this._samplers = new Map();
    this._imageryGrids = new Map();
    this._destroyed = false;
    this._matrix = new Matrix4();
    this.statistics = {
      buffersCreated: 0,
      buffersDestroyed: 0,
      bufferBytes: 0,
      drawCalls: 0,
      triangles: 0,
      texturesCreated: 0,
      texturesDestroyed: 0,
      textureBytes: 0,
      imageryDrawCalls: 0,
      imageryTriangles: 0,
      imageryGridDrawCalls: 0,
      imageryGridBuffers: 0,
      imageryGridBytes: 0,
      imageryGridBuildMs: 0,
    };
  }

  async initialize() {
    const device = this.context._device;
    this._device = device;
    this._uniformStride =
      Math.ceil(96 / device.limits.minUniformBufferOffsetAlignment) *
      device.limits.minUniformBufferOffsetAlignment;
    device.pushErrorScope("validation");
    let validationError;
    try {
      this._tileLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: 96,
            },
          },
        ],
      });
      this._imageLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: 64,
            },
          },
        ],
      });
      const module = device.createShaderModule({
        label: "WGS84 RTC and reversed-depth WGSL",
        code: shader,
      });
      const descriptor = {
        label: "WGS84 opaque terrain",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this._tileLayout],
        }),
        vertex: {
          module,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 24,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x2" },
                { shaderLocation: 2, offset: 20, format: "float32" },
              ],
            },
          ],
        },
        fragment: {
          module,
          entryPoint: "fragmentMain",
          targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list", cullMode: "back" },
        depthStencil: {
          format: WebGPUDepth.format,
          depthWriteEnabled: true,
          depthCompare: WebGPUDepth.compare,
        },
      };
      this._pipeline = await device.createRenderPipelineAsync(descriptor);
      this._pipelineNoCull = await device.createRenderPipelineAsync({
        ...descriptor,
        label: "WGS84 two-sided terrain",
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      const imageDescriptor = {
        ...descriptor,
        label: "Provider imagery draped on native terrain",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this._tileLayout, this._imageLayout],
        }),
        fragment: {
          module,
          entryPoint: "imageryMain",
          targets: [
            {
              format: "rgba16float",
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        depthStencil: {
          format: WebGPUDepth.format,
          depthWriteEnabled: false,
          depthCompare: WebGPUDepth.imageryCompare,
        },
      };
      this._imagePipeline =
        await device.createRenderPipelineAsync(imageDescriptor);
      this._imagePipelineNoCull = await device.createRenderPipelineAsync({
        ...imageDescriptor,
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
    } finally {
      validationError = await device.popErrorScope();
    }
    this.context._checkAlive();
    if (validationError) {
      throw new RuntimeError(
        `WebGPU Globe validation: ${validationError.message}`,
      );
    }
  }

  _createBuffer(size, usage, contents, label) {
    const buffer = this._device.createBuffer({
      size: Math.ceil(size / 4) * 4,
      usage,
      mappedAtCreation: contents !== undefined,
      label,
    });
    ++this.statistics.buffersCreated;
    this.statistics.bufferBytes += buffer.size;
    try {
      if (contents !== undefined) {
        new Uint8Array(buffer.getMappedRange()).set(
          new Uint8Array(
            contents.buffer,
            contents.byteOffset,
            contents.byteLength,
          ),
        );
        buffer.unmap();
      }
    } catch (error) {
      this._destroyBuffer(buffer);
      throw error;
    }
    return buffer;
  }

  _destroyBuffer(buffer) {
    if (buffer) {
      buffer.destroy();
      ++this.statistics.buffersDestroyed;
      this.statistics.bufferBytes -= buffer.size;
    }
  }

  createTile(mesh, terrainData) {
    const decoded = decodeTerrainMesh(mesh);
    let indices = decoded.indices;
    if (indices instanceof Uint8Array) {
      indices = new Uint16Array(indices);
    }
    const vertex = this._createBuffer(
      decoded.vertices.byteLength,
      GPUBufferUsage.VERTEX,
      decoded.vertices,
      "Globe RTC vertices",
    );
    let index;
    try {
      index = this._createBuffer(
        indices.byteLength,
        GPUBufferUsage.INDEX,
        indices,
        "Globe terrain indices and skirts",
      );
    } catch (error) {
      this._destroyBuffer(vertex);
      throw error;
    }
    const imageryGrid =
      terrainData instanceof HeightmapTerrainData &&
      terrainData.createMesh === HeightmapTerrainData.prototype.createMesh
        ? this._acquireImageryGrid(mesh, decoded.vertices)
        : undefined;
    let destroyed = false;
    return {
      vertex,
      index,
      imageryGrid,
      indexFormat: indices instanceof Uint32Array ? "uint32" : "uint16",
      indexCount: indices.length,
      indexCountWithoutSkirts: mesh.indexCountWithoutSkirts,
      isDestroyed: () => destroyed,
      destroy: () => {
        if (!destroyed) {
          destroyed = true;
          this._destroyBuffer(vertex);
          this._destroyBuffer(index);
          if (imageryGrid) {
            this._releaseImageryGrid(imageryGrid.shared);
          }
        }
      },
    };
  }

  _acquireImageryGrid(mesh, vertices) {
    const width = mesh.southIndicesEastToWest.length;
    const height = mesh.westIndicesSouthToNorth.length;
    if (
      width < 33 ||
      height < 33 ||
      mesh.indexCountWithoutSkirts !== (width - 1) * (height - 1) * 6
    ) {
      return undefined;
    }
    const started = performance.now();
    let shared = this._imageryGrids.get(mesh.indices);
    if (!shared) {
      shared = createImageryGrid(mesh, width, height);
      this._imageryGrids.set(mesh.indices, shared);
    }
    ++shared.references;
    // Native heightmap U depends only on column, V and Mercator T only on row.
    // The decoded attributes include the same quantization as the vertex shader.
    const cells = shared.cells.map((cell) => ({
      cell,
      west: cell.left === 0 ? -Infinity : vertices[cell.left * 6 + 3],
      east: cell.right === width - 1 ? Infinity : vertices[cell.right * 6 + 3],
      north: cell.top === 0 ? Infinity : vertices[cell.top * width * 6 + 4],
      south:
        cell.bottom === height - 1
          ? -Infinity
          : vertices[cell.bottom * width * 6 + 4],
      northT: cell.top === 0 ? Infinity : vertices[cell.top * width * 6 + 5],
      southT:
        cell.bottom === height - 1
          ? -Infinity
          : vertices[cell.bottom * width * 6 + 5],
    }));
    this.statistics.imageryGridBuildMs += performance.now() - started;
    return { shared, cells };
  }

  _releaseImageryGrid(shared) {
    if (--shared.references === 0) {
      this._imageryGrids.delete(shared.indices);
      if (shared.buffer) {
        --this.statistics.imageryGridBuffers;
        this.statistics.imageryGridBytes -= shared.buffer.size;
        this._destroyBuffer(shared.buffer);
      }
    }
  }

  _imageryCell(grid, rectangle, mode) {
    if (!grid || mode === 3) {
      return undefined;
    }
    // Keep the discarded geometry strictly beyond the fragment boundary even
    // after f32 interpolation. Tile-exterior edges have infinite bounds.
    const margin = 0.00001;
    for (const bounds of grid.cells) {
      const north = mode === 1 ? bounds.northT : bounds.north;
      const south = mode === 1 ? bounds.southT : bounds.south;
      if (
        rectangle.x > bounds.west + margin &&
        rectangle.z < bounds.east - margin &&
        rectangle.y > south + margin &&
        rectangle.w < north - margin
      ) {
        const shared = grid.shared;
        if (!shared.buffer) {
          const started = performance.now();
          const indices = packImageryGrid(shared);
          shared.buffer = this._createBuffer(
            indices.byteLength,
            GPUBufferUsage.INDEX,
            indices,
            "Heightmap imagery cells",
          );
          ++this.statistics.imageryGridBuffers;
          this.statistics.imageryGridBytes += shared.buffer.size;
          this.statistics.imageryGridBuildMs += performance.now() - started;
        }
        return bounds.cell;
      }
    }
    return undefined;
  }

  createImageryTexture(image) {
    const width = image.naturalWidth ?? image.width;
    const height = image.naturalHeight ?? image.height;
    const maximum = this._device.limits.maxTextureDimension2D;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > maximum ||
      height > maximum
    ) {
      throw new RuntimeError(
        "Imagery must have valid WebGPU texture dimensions.",
      );
    }
    const texture = this._device.createTexture({
      label: "ImageryProvider tile",
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const bytes = width * height * 4;
    ++this.statistics.texturesCreated;
    this.statistics.textureBytes += bytes;
    let destroyed = false;
    const resource = {
      texture,
      width,
      height,
      destroy: () => {
        if (!destroyed) {
          destroyed = true;
          texture.destroy();
          resource.bindings = undefined;
          resource.bindingBuffer = undefined;
          this._textures.delete(resource);
          ++this.statistics.texturesDestroyed;
          this.statistics.textureBytes -= bytes;
        }
      },
    };
    this._textures.add(resource);
    try {
      resource.view = texture.createView();
      // Cesium's ImageBitmap loader already applies flipY; HTML images/canvas
      // retain their normal top-left origin and must be flipped at upload.
      const bitmap =
        typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
      this._device.queue.copyExternalImageToTexture(
        { source: image, flipY: !bitmap },
        { texture, premultipliedAlpha: false },
        [width, height],
      );
    } catch (error) {
      resource.destroy();
      throw error;
    }
    return resource;
  }

  _getSampler(layer) {
    const min = layer.minificationFilter;
    const mag = layer.magnificationFilter;
    if (
      (min !== TextureMinificationFilter.NEAREST &&
        min !== TextureMinificationFilter.LINEAR) ||
      (mag !== TextureMagnificationFilter.NEAREST &&
        mag !== TextureMagnificationFilter.LINEAR)
    ) {
      throw new RuntimeError("ImageryLayer filters must be NEAREST or LINEAR.");
    }
    const key = `${min}:${mag}`;
    let sampler = this._samplers.get(key);
    if (!sampler) {
      sampler = this._device.createSampler({
        minFilter:
          min === TextureMinificationFilter.NEAREST ? "nearest" : "linear",
        magFilter:
          mag === TextureMagnificationFilter.NEAREST ? "nearest" : "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      this._samplers.set(key, sampler);
    }
    return sampler;
  }

  beginFrame() {
    this._draws.length = 0;
    this.statistics.drawCalls = 0;
    this.statistics.triangles = 0;
    this.statistics.imageryDrawCalls = 0;
    this.statistics.imageryTriangles = 0;
    this.statistics.imageryGridDrawCalls = 0;
  }

  addTile(tile, rectangle) {
    this._draws.push({ tile, rectangle });
  }

  render(scene) {
    const atmosphere = scene._atmosphere;
    const composite = atmosphere?.update(
      scene._planetState,
      scene.atmosphere,
      scene.sun,
      scene.moon,
      scene.stars,
      scene.exposure,
      scene.globe.enableLighting,
      scene.clouds,
    )
      ? atmosphere.composite
      : undefined;
    this.context.render(
      (pass) => this._draw(pass, scene),
      scene.backgroundColor,
      composite,
    );
  }

  _draw(pass, scene) {
    const count = this._draws.length;
    if (count === 0) {
      return;
    }
    if (
      !this._uniformBuffer ||
      this._uniformBuffer.size < count * this._uniformStride
    ) {
      const capacity = 2 ** Math.ceil(Math.log2(count));
      const replacement = this._createBuffer(
        capacity * this._uniformStride,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        undefined,
        "Globe per-draw uniforms",
      );
      try {
        const values = new Float32Array(replacement.size / 4);
        const bindings = this._device.createBindGroup({
          layout: this._tileLayout,
          entries: [
            { binding: 0, resource: { buffer: replacement, size: 96 } },
          ],
        });
        this._destroyBuffer(this._uniformBuffer);
        this._uniformBuffer = replacement;
        this._uniformValues = values;
        this._tileBindings = bindings;
      } catch (error) {
        this._destroyBuffer(replacement);
        throw error;
      }
    }
    const color = scene.globe.baseColor;
    for (let i = 0; i < count; ++i) {
      const { tile, rectangle } = this._draws[i];
      const offset = (i * this._uniformStride) / 4;
      const matrix = computeRelativeViewProjection(
        scene.camera,
        tile.data.renderedMesh.center,
        this._matrix,
      );
      for (let j = 0; j < 16; ++j) {
        this._uniformValues[offset + j] = matrix[j];
      }
      this._uniformValues.set(
        [
          (rectangle.west - tile.rectangle.west) / tile.rectangle.width,
          (rectangle.south - tile.rectangle.south) / tile.rectangle.height,
          (rectangle.east - tile.rectangle.west) / tile.rectangle.width,
          (rectangle.north - tile.rectangle.south) / tile.rectangle.height,
          color.red,
          color.green,
          color.blue,
          color.alpha,
        ],
        offset + 16,
      );
    }
    this._device.queue.writeBuffer(
      this._uniformBuffer,
      0,
      this._uniformValues.buffer,
      0,
      count * this._uniformStride,
    );
    pass.setPipeline(
      scene.globe.backFaceCulling && !scene.cameraUnderground
        ? this._pipeline
        : this._pipelineNoCull,
    );
    for (let i = 0; i < count; ++i) {
      const data = this._draws[i].tile.data;
      const gpu = data.gpu ?? data.fill?.vertexArray;
      pass.setBindGroup(0, this._tileBindings, [i * this._uniformStride]);
      pass.setVertexBuffer(0, gpu.vertex);
      pass.setIndexBuffer(gpu.index, gpu.indexFormat);
      const indexCount = scene.globe.showSkirts
        ? gpu.indexCount
        : gpu.indexCountWithoutSkirts;
      pass.drawIndexed(indexCount);
      ++this.statistics.drawCalls;
      this.statistics.triangles += indexCount / 3;
    }
    this._drawImagery(pass, scene);
  }

  _drawImagery(pass, scene) {
    const draws = [];
    for (let i = 0; i < this._draws.length; ++i) {
      const { tile } = this._draws[i];
      for (const association of tile.data.imagery) {
        const image = association.readyImagery;
        const layer = image?.imageryLayer;
        if (!image?.texture || !layer.show || layer.alpha === 0) {
          continue;
        }
        if (!Number.isFinite(layer.alpha)) {
          throw new RuntimeError(
            "WebGPU imagery alpha must be a finite number.",
          );
        }
        draws.push({ tile, association, image, drawIndex: i });
      }
    }
    if (draws.length === 0) {
      return;
    }
    const stride = this._uniformStride;
    if (
      !this._imageUniformBuffer ||
      this._imageUniformBuffer.size < draws.length * stride
    ) {
      const capacity = 2 ** Math.ceil(Math.log2(draws.length));
      const replacement = this._createBuffer(
        capacity * stride,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        undefined,
        "Imagery per-draw uniforms",
      );
      let values;
      try {
        values = new Float32Array(replacement.size / 4);
      } catch (error) {
        this._destroyBuffer(replacement);
        throw error;
      }
      this._destroyBuffer(this._imageUniformBuffer);
      this._imageUniformBuffer = replacement;
      this._imageUniformValues = values;
    }
    for (let i = 0; i < draws.length; ++i) {
      const { tile, association, image } = draws[i];
      const layer = image.imageryLayer;
      const provider = layer.imageryProvider;
      const rectangle = association.textureCoordinateRectangle;
      const mapping =
        association.textureTranslationAndScale ??
        layer._calculateTextureTranslationAndScale(tile, association);
      const mercator =
        provider.tilingScheme.projection instanceof WebMercatorProjection;
      const mode = mercator
        ? association.useWebMercatorT
          ? tile.data.renderedMesh.encoding.hasWebMercatorT
            ? 1
            : 3
          : 2
        : 0;
      const gpu = tile.data.gpu ?? tile.data.fill?.vertexArray;
      draws[i].cell = this._imageryCell(gpu.imageryGrid, rectangle, mode);
      let south = 0;
      let inverseHeight = 1;
      let terrainSouth = 0;
      let terrainInverseHeight = 1;
      if (mode === 2) {
        south = WebMercatorProjection.geodeticLatitudeToMercatorAngle(
          image.rectangle.south,
        );
        inverseHeight =
          1 /
          (WebMercatorProjection.geodeticLatitudeToMercatorAngle(
            image.rectangle.north,
          ) -
            south);
      }
      if (mode === 3) {
        terrainSouth = WebMercatorProjection.geodeticLatitudeToMercatorAngle(
          tile.rectangle.south,
        );
        terrainInverseHeight =
          1 /
          (WebMercatorProjection.geodeticLatitudeToMercatorAngle(
            tile.rectangle.north,
          ) -
            terrainSouth);
      }
      this._imageUniformValues.set(
        [
          rectangle.x,
          rectangle.y,
          rectangle.z,
          rectangle.w,
          mapping.x,
          mapping.y,
          mapping.z,
          mapping.w,
          layer.alpha,
          mode,
          tile.rectangle.south,
          tile.rectangle.height,
          south,
          inverseHeight,
          terrainSouth,
          terrainInverseHeight,
        ],
        (i * stride) / 4,
      );
      if (provider.credit) {
        scene.creditDisplay?.addCreditToNextFrame(provider.credit);
      }
      for (const credit of image.credits ?? []) {
        scene.creditDisplay?.addCreditToNextFrame(credit);
      }
    }
    this._device.queue.writeBuffer(
      this._imageUniformBuffer,
      0,
      this._imageUniformValues.buffer,
      0,
      draws.length * stride,
    );
    pass.setPipeline(
      scene.globe.backFaceCulling && !scene.cameraUnderground
        ? this._imagePipeline
        : this._imagePipelineNoCull,
    );
    for (let i = 0; i < draws.length; ++i) {
      const { tile, image, drawIndex, cell } = draws[i];
      const texture = image.texture;
      const sampler = this._getSampler(image.imageryLayer);
      if (
        texture.bindingBuffer !== this._imageUniformBuffer ||
        texture.bindingSampler !== sampler
      ) {
        texture.bindings = this._device.createBindGroup({
          layout: this._imageLayout,
          entries: [
            { binding: 0, resource: texture.view },
            { binding: 1, resource: sampler },
            {
              binding: 2,
              resource: { buffer: this._imageUniformBuffer, size: 64 },
            },
          ],
        });
        texture.bindingBuffer = this._imageUniformBuffer;
        texture.bindingSampler = sampler;
      }
      const gpu = tile.data.gpu ?? tile.data.fill?.vertexArray;
      pass.setBindGroup(0, this._tileBindings, [drawIndex * stride]);
      pass.setBindGroup(1, texture.bindings, [i * stride]);
      pass.setVertexBuffer(0, gpu.vertex);
      const range = cell ?? gpu;
      const count = scene.globe.showSkirts
        ? range.indexCount
        : range.indexCountWithoutSkirts;
      pass.setIndexBuffer(
        cell ? gpu.imageryGrid.shared.buffer : gpu.index,
        gpu.indexFormat,
      );
      pass.drawIndexed(count, 1, cell?.firstIndex ?? 0);
      ++this.statistics.imageryDrawCalls;
      this.statistics.imageryTriangles += (count ?? 0) / 3;
      this.statistics.imageryGridDrawCalls += Number(cell !== undefined);
    }
  }

  destroy() {
    if (!this._destroyed) {
      this._destroyed = true;
      this._destroyBuffer(this._uniformBuffer);
      this._destroyBuffer(this._imageUniformBuffer);
      for (const texture of this._textures) {
        texture.destroy();
      }
      this._uniformBuffer = undefined;
      this._tileBindings = undefined;
      this._pipeline = undefined;
      this._pipelineNoCull = undefined;
      this._imagePipeline = undefined;
      this._imagePipelineNoCull = undefined;
      this._imageUniformBuffer = undefined;
      this._imageUniformValues = undefined;
      this._samplers.clear();
      this._draws.length = 0;
    }
  }
}

function createImageryGrid(mesh, width, height) {
  const cells = [];
  const bodyCount = (height - 1) * (width - 1) * 6;
  const skirtCount = mesh.indices.length - bodyCount;
  let length = 0;
  for (let row = 0; row < 4; ++row) {
    for (let column = 0; column < 4; ++column) {
      // One overlapping grid cell retains boundary triangles on both sides.
      const left = Math.max(0, Math.floor((column * (width - 1)) / 4) - 1);
      const right = Math.min(
        width - 1,
        Math.ceil(((column + 1) * (width - 1)) / 4) + 1,
      );
      const top = Math.max(0, Math.floor((row * (height - 1)) / 4) - 1);
      const bottom = Math.min(
        height - 1,
        Math.ceil(((row + 1) * (height - 1)) / 4) + 1,
      );
      const indexCountWithoutSkirts = (right - left) * (bottom - top) * 6;
      const indexCount = indexCountWithoutSkirts + skirtCount;
      cells.push({
        left,
        right,
        top,
        bottom,
        firstIndex: length,
        indexCount,
        indexCountWithoutSkirts,
      });
      length += indexCount;
    }
  }
  return {
    indices: mesh.indices,
    width,
    bodyCount,
    cells,
    length,
    references: 0,
  };
}

function packImageryGrid(shared) {
  const { indices, width, cells, bodyCount } = shared;
  const IndexArray = indices.constructor;
  const packed = new IndexArray(shared.length);
  for (const cell of cells) {
    let offset = cell.firstIndex;
    for (let row = cell.top; row < cell.bottom; ++row) {
      const first = (row * (width - 1) + cell.left) * 6;
      const count = (cell.right - cell.left) * 6;
      packed.set(indices.subarray(first, first + count), offset);
      offset += count;
    }
    // Keep every native skirt and preserve its original relative draw order.
    packed.set(indices.subarray(bodyCount), offset);
  }
  return packed;
}

export default WebGPUGlobeRenderer;
