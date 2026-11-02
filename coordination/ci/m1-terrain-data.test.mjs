// SPDX-License-Identifier: Apache-2.0
// CPU terrain contracts using the pinned upstream fixtures and algorithms.
// Only filesystem IO and worker message transport are adapted in this process.
// No browser, WebGL context, WebGPU device, or network access is required.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, sep } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Cartesian3 } from "@cesium/core";
import CesiumTerrainProvider from "../../packages/engine/Source/Core/CesiumTerrainProvider.js";
import EllipsoidTerrainProvider from "../../packages/engine/Source/Core/EllipsoidTerrainProvider.js";
import HeightmapTerrainData from "../../packages/engine/Source/Core/HeightmapTerrainData.js";
import QuantizedMeshTerrainData from "../../packages/engine/Source/Core/QuantizedMeshTerrainData.js";
import Resource from "../../packages/engine/Source/Core/Resource.js";
import TaskProcessor from "../../packages/engine/Source/Core/TaskProcessor.js";
import TerrainMesh from "../../packages/engine/Source/Core/TerrainMesh.js";

const fixtureBase = new URL(
  "../../Specs/Data/CesiumTerrainTileJson/",
  import.meta.url,
);
const fixtureDirectory = await realpath(fileURLToPath(fixtureBase));
const redControls = new Set([
  "corrupt-index",
  "nonfinite-position",
  "missing-skirts",
  "reversed-edge",
]);
const arguments_ = process.argv.slice(2);
assert.ok(arguments_.length <= 1, "Only one optional RED control is supported");
const redControl = arguments_[0]?.replace(/^--red-control=/, "");
assert.ok(
  redControl === undefined ||
    (arguments_[0].startsWith("--red-control=") && redControls.has(redControl)),
  "Unknown RED control",
);

let transformTerrainPayload;
let restoreAdapters = () => {};

async function readFixture(resource, extension) {
  const url = new URL(resource.url);
  assert.equal(
    url.protocol,
    "file:",
    "Terrain tests must not access the network",
  );
  assert.equal(url.hostname, "", "Only local fixture files are allowed");
  url.search = "";
  url.hash = "";
  const path = await realpath(fileURLToPath(url));
  const inside = relative(fixtureDirectory, path);
  assert.ok(
    inside !== "" &&
      inside !== ".." &&
      !inside.startsWith(`..${sep}`) &&
      !isAbsolute(inside),
    "Resource must remain inside the existing terrain fixture directory",
  );
  assert.equal(extname(path), extension, "Unexpected fixture resource type");
  return readFile(path);
}

async function installAdapters() {
  const originals = [
    [Resource.prototype, "fetchJson"],
    [Resource.prototype, "fetchArrayBuffer"],
    [TaskProcessor.prototype, "scheduleTask"],
    [globalThis, "self"],
    [globalThis, "postMessage"],
  ].map(([object, property]) => ({
    object,
    property,
    descriptor: Object.getOwnPropertyDescriptor(object, property),
  }));
  const restore = () => {
    for (const { object, property, descriptor } of originals) {
      if (descriptor) {
        Object.defineProperty(object, property, descriptor);
      } else {
        delete object[property];
      }
    }
    transformTerrainPayload = undefined;
  };

  try {
    Resource.prototype.fetchJson = async function () {
      return JSON.parse((await readFixture(this, ".json")).toString("utf8"));
    };
    Resource.prototype.fetchArrayBuffer = async function () {
      const bytes = await readFixture(this, ".terrain");
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      return transformTerrainPayload ? transformTerrainPayload(buffer) : buffer;
    };

    const handlers = new Map();
    for (const name of [
      "createVerticesFromQuantizedTerrainMesh",
      "upsampleQuantizedTerrainMesh",
      "createVerticesFromHeightmap",
    ]) {
      globalThis.self = {};
      const worker = await import(
        `../../packages/engine/Source/Workers/${name}.js`
      );
      handlers.set(name, {
        handler: worker.default.onmessage,
        scope: worker.default,
      });
    }

    // Tests are deliberately sequential. Preserve structured cloning and the
    // worker's actual transfer list, while leaving scheduling/throttling untested.
    let active = false;
    TaskProcessor.prototype.scheduleTask = async function (parameters) {
      assert.equal(
        active,
        false,
        "CPU worker adapter requires sequential tasks",
      );
      const worker = handlers.get(this._workerPath);
      assert.ok(worker, "Unexpected worker requested by the terrain pipeline");
      active = true;
      try {
        let response;
        globalThis.self = worker.scope;
        globalThis.postMessage = (message, transfer = []) => {
          response = globalThis.structuredClone(message, { transfer });
        };
        await worker.handler({
          data: {
            id: 1,
            parameters: globalThis.structuredClone(parameters),
            baseUrl: "",
            canTransferArrayBuffer: true,
          },
        });
        assert.ok(response, "Native worker did not return a response");
        if (response.error) {
          const error = new Error(
            response.error.message ?? String(response.error),
          );
          error.name = response.error.name ?? "Error";
          throw error;
        }
        return response.result;
      } finally {
        active = false;
      }
    };
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

before(async () => {
  restoreAdapters = await installAdapters();
});
after(() => restoreAdapters());

async function loadTile(name, options = {}) {
  const provider = await CesiumTerrainProvider.fromUrl(
    new URL(`${name}/`, fixtureBase).href,
    options,
  );
  const data = await provider.requestTileGeometry(0, 0, 0);
  assert.ok(data instanceof QuantizedMeshTerrainData);
  return { provider, data };
}

function createMesh(provider, data, x = 0, y = 0, level = 0) {
  return data.createMesh({ tilingScheme: provider.tilingScheme, x, y, level });
}

const edgeDefinitions = [
  ["westIndicesSouthToNorth", "x", 0, "y", 1],
  ["southIndicesEastToWest", "y", 0, "x", -1],
  ["eastIndicesNorthToSouth", "x", 1, "y", -1],
  ["northIndicesWestToEast", "y", 1, "x", 1],
];

function assertMesh(mesh) {
  assert.ok(mesh instanceof TerrainMesh);
  assert.ok(mesh.vertices instanceof Float32Array);
  assert.ok(
    mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array,
  );
  const count = mesh.vertices.length / mesh.encoding.stride;
  assert.ok(
    Number.isInteger(count) && count > 0,
    "Mesh has whole, nonempty vertices",
  );
  assert.ok(mesh.vertexCountWithoutSkirts > 0, "Source mesh is nonempty");
  assert.ok(mesh.indexCountWithoutSkirts > 0, "Source triangles are nonempty");
  assert.equal(mesh.indexCountWithoutSkirts % 3, 0);
  assert.equal(mesh.indices.length % 3, 0);
  for (const value of mesh.vertices) {
    assert.ok(
      Number.isFinite(value),
      "Vertex buffer contains a nonfinite value",
    );
  }
  for (let i = 0; i < mesh.indices.length; i++) {
    assert.ok(
      mesh.indices[i] < count,
      "Triangle index is outside the vertex buffer",
    );
    if (i < mesh.indexCountWithoutSkirts) {
      assert.ok(mesh.indices[i] < mesh.vertexCountWithoutSkirts);
    }
  }
  const position = new Cartesian3();
  for (let i = 0; i < count; i++) {
    mesh.encoding.decodePosition(mesh.vertices, i, position);
    assert.ok(Number.isFinite(position.x + position.y + position.z));
    const uv = mesh.encoding.decodeTextureCoordinates(mesh.vertices, i);
    assert.ok(uv.x >= -1e-6 && uv.x <= 1 + 1e-6);
    assert.ok(uv.y >= -1e-6 && uv.y <= 1 + 1e-6);
    assert.ok(Number.isFinite(mesh.encoding.decodeHeight(mesh.vertices, i)));
  }

  let edgeVertices = 0;
  let skirtIndices = 0;
  for (const [
    property,
    fixedAxis,
    fixedValue,
    axis,
    direction,
  ] of edgeDefinitions) {
    const edge = mesh[property];
    assert.ok(edge.length >= 2, `${property} spans a tile edge`);
    edgeVertices += edge.length;
    skirtIndices += (edge.length - 1) * 6;
    let previous;
    for (const index of edge) {
      assert.ok(
        index < mesh.vertexCountWithoutSkirts,
        "Edge references source vertices",
      );
      const uv = mesh.encoding.decodeTextureCoordinates(mesh.vertices, index);
      assert.ok(
        Math.abs(uv[fixedAxis] - fixedValue) < 1e-6,
        `${property} lies on its edge`,
      );
      if (previous !== undefined) {
        assert.ok(
          (uv[axis] - previous) * direction >= -1e-6,
          `${property} is ordered`,
        );
      }
      previous = uv[axis];
    }
    const first = mesh.encoding.decodeTextureCoordinates(
      mesh.vertices,
      edge[0],
    );
    const last = mesh.encoding.decodeTextureCoordinates(
      mesh.vertices,
      edge[edge.length - 1],
    );
    assert.ok(Math.abs(first[axis] - (direction > 0 ? 0 : 1)) < 1e-6);
    assert.ok(Math.abs(last[axis] - (direction > 0 ? 1 : 0)) < 1e-6);
  }
  assert.equal(
    count,
    mesh.vertexCountWithoutSkirts + edgeVertices,
    "One skirt vertex per edge entry",
  );
  assert.equal(
    mesh.indices.length - mesh.indexCountWithoutSkirts,
    skirtIndices,
    "Two skirt triangles per edge segment",
  );
  let minimumSkirtHeight = Infinity;
  for (let i = mesh.vertexCountWithoutSkirts; i < count; i++) {
    minimumSkirtHeight = Math.min(
      minimumSkirtHeight,
      mesh.encoding.decodeHeight(mesh.vertices, i),
    );
  }
  assert.ok(
    minimumSkirtHeight < mesh.minimumHeight,
    "Skirts descend below surface bounds",
  );
}

function injectRedControl(mesh) {
  if (redControl === "corrupt-index") {
    mesh.indices[0] = mesh.vertices.length / mesh.encoding.stride;
  } else if (redControl === "nonfinite-position") {
    mesh.vertices[0] = NaN;
  } else if (redControl === "missing-skirts") {
    mesh.vertices = mesh.vertices.subarray(
      0,
      mesh.vertexCountWithoutSkirts * mesh.encoding.stride,
    );
    mesh.indices = mesh.indices.subarray(0, mesh.indexCountWithoutSkirts);
  } else if (redControl === "reversed-edge") {
    mesh.westIndicesSouthToNorth = Array.from(
      mesh.westIndicesSouthToNorth,
    ).reverse();
  }
}

test("native quantized fixture produces finite indexed terrain, skirts and ordered edges", async (t) => {
  const { provider, data } = await loadTile("QuantizedMesh");
  const rectangle = provider.tilingScheme.tileXYToRectangle(0, 0, 0);
  const longitude = (rectangle.west + rectangle.east) / 2;
  const latitude = (rectangle.south + rectangle.north) / 2;
  assert.ok(
    Number.isFinite(data.interpolateHeight(rectangle, longitude, latitude)),
  );
  const mesh = await createMesh(provider, data);
  injectRedControl(mesh);
  assertMesh(mesh);
  assert.equal(mesh.vertexCountWithoutSkirts, 219);
  assert.equal(mesh.indexCountWithoutSkirts / 3, 402);
  assert.ok(mesh.minimumHeight < -150 && mesh.minimumHeight > -160);
  assert.ok(mesh.maximumHeight > 6800 && mesh.maximumHeight < 6900);
  const afterMesh = data.interpolateHeight(rectangle, longitude, latitude);
  t.diagnostic(
    afterMesh === undefined
      ? "Observed upstream post-mesh interpolateHeight limitation; not a supported-height claim."
      : "Post-mesh interpolation returned a value; review the historical handoff limitation.",
  );
});

test("oct-encoded normals survive native decoding and worker transfer", async () => {
  const { provider, data } = await loadTile(
    "QuantizedMeshWithOctVertexNormals",
    { requestVertexNormals: true },
  );
  const mesh = await createMesh(provider, data);
  assertMesh(mesh);
  assert.equal(mesh.vertexCountWithoutSkirts, 214);
  assert.equal(mesh.encoding.hasVertexNormals, true);
  const normal = new Cartesian3();
  for (let i = 0; i < mesh.vertexCountWithoutSkirts; i++) {
    mesh.encoding.decodeNormal(mesh.vertices, i, normal);
    assert.ok(Math.abs(Cartesian3.magnitude(normal) - 1) < 1e-6);
  }
});

test("native metadata parsing resolves unknown child availability", async () => {
  const provider = await CesiumTerrainProvider.fromUrl(
    new URL("QuantizedMeshWithMetadataAvailability/", fixtureBase).href,
  );
  assert.equal(provider.getTileDataAvailable(0, 0, 0), true);
  assert.equal(provider.getTileDataAvailable(0, 0, 1), undefined);
  const data = await provider.requestTileGeometry(0, 0, 0);
  assert.ok(data instanceof QuantizedMeshTerrainData);
  assert.equal(provider.getTileDataAvailable(0, 0, 1), true);
  assert.equal(data.isChildAvailable(0, 0, 0, 0), true);
  assert.equal(provider.getTileDataAvailable(0, 0, 100), false);
  assertMesh(await createMesh(provider, data));
});

test("large native quantized fixture preserves indices above 65535", async () => {
  const { provider, data } = await loadTile("QuantizedMeshWith32BitIndices");
  const mesh = await createMesh(provider, data);
  assertMesh(mesh);
  assert.equal(mesh.vertexCountWithoutSkirts, 65612);
  assert.ok(mesh.indices instanceof Uint32Array);
  assert.ok(mesh.indices.some((index) => index > 65535));
});

test("all four native upsample children retain their quadrant, skirts and fallback identity", async () => {
  const { provider, data } = await loadTile("QuantizedMesh");
  assert.equal(
    data.upsample(provider.tilingScheme, 0, 0, 0, 0, 0, 1),
    undefined,
  );
  const parent = await createMesh(provider, data);
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const child = await data.upsample(provider.tilingScheme, 0, 0, 0, x, y, 1);
    assert.ok(child instanceof QuantizedMeshTerrainData);
    assert.equal(child.wasCreatedByUpsampling(), true);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      assert.equal(child.isChildAvailable(x, y, x * 2 + dx, y * 2 + dy), false);
    }
    const mesh = await createMesh(provider, child, x, y, 1);
    assertMesh(mesh);
    const expected = provider.tilingScheme.tileXYToRectangle(x, y, 1);
    assert.deepEqual(mesh.rectangle, expected);
    assert.ok(mesh.minimumHeight >= parent.minimumHeight - 0.001);
    assert.ok(mesh.maximumHeight <= parent.maximumHeight + 0.001);
  }
});

test("ellipsoid provider reaches the same mesh boundary with a zero-height surface", async () => {
  const provider = new EllipsoidTerrainProvider();
  const data = await provider.requestTileGeometry(0, 0, 0);
  assert.ok(data instanceof HeightmapTerrainData);
  const mesh = await createMesh(provider, data);
  assertMesh(mesh);
  assert.equal(mesh.vertexCountWithoutSkirts, 256);
  assert.equal(mesh.indexCountWithoutSkirts / 3, 450);
  for (let i = 0; i < mesh.vertexCountWithoutSkirts; i++) {
    assert.equal(mesh.encoding.decodeHeight(mesh.vertices, i), 0);
  }
});

test("native parser rejects a truncated quantized-mesh header", async () => {
  const provider = await CesiumTerrainProvider.fromUrl(
    new URL("QuantizedMesh/", fixtureBase).href,
  );
  transformTerrainPayload = (buffer) => buffer.slice(0, 24);
  try {
    await assert.rejects(provider.requestTileGeometry(0, 0, 0), RangeError);
  } finally {
    transformTerrainPayload = undefined;
  }
});

test("native upsampling rejects skipping an intermediate level", async () => {
  const { provider, data } = await loadTile("QuantizedMesh");
  assert.throws(
    () => data.upsample(provider.tilingScheme, 0, 0, 0, 0, 0, 2),
    /more than one level/,
  );
});
