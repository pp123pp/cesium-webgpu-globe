// CPU precision and terrain-layout checks; no browser or GPU is used.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AxisAlignedBoundingBox,
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Ellipsoid,
  FixedFrameTransforms,
  Matrix4,
  OrthographicFrustum,
  PerspectiveFrustum,
  PerspectiveOffCenterFrustum,
} from "@cesium/core";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";
import HeightmapTerrainData from "../../packages/engine/Source/Core/HeightmapTerrainData.js";
import TerrainEncoding from "../../packages/engine/Source/Core/TerrainEncoding.js";
import {
  computeRelativeViewProjection,
  decodeTerrainMesh,
} from "../../packages/engine/Source/Scene/WebGPUGlobeMath.js";

// Model float32 vertex arithmetic, including rounding each multiply and add.
// A real GPU may fuse operations; these checks do not claim GPU execution.
function floatClip(matrix, position) {
  const values = Float32Array.from(Matrix4.toArray(matrix));
  const point = [position.x, position.y, position.z, 1].map(Math.fround);
  return [0, 1, 2, 3].map((row) => {
    let sum = Math.fround(values[row] * point[0]);
    for (let column = 1; column < 4; column++) {
      sum = Math.fround(
        sum + Math.fround(values[column * 4 + row] * point[column]),
      );
    }
    return sum;
  });
}

function ndc(clip) {
  return clip.slice(0, 3).map((value) => value / clip[3]);
}

function close(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} versus ${expected}, tolerance ${tolerance}`,
  );
}

function perspective(options = {}) {
  return new PerspectiveFrustum({
    fov: Math.PI / 3,
    aspectRatio: 16 / 9,
    near: 0.1,
    far: 500000000,
    ...options,
  });
}

function surfaceOffset(frame, east, north, height = 0) {
  const position = Matrix4.multiplyByPoint(
    frame,
    new Cartesian3(east, north, 0),
    new Cartesian3(),
  );
  const surface = Ellipsoid.WGS84.scaleToGeodeticSurface(position);
  const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(surface);
  Cartesian3.multiplyByScalar(normal, height, normal);
  return Cartesian3.add(surface, normal, surface);
}

function cameraFixture(longitude, latitude, altitude) {
  const origin = Cartesian3.fromDegrees(
    longitude,
    latitude,
    0,
    Ellipsoid.WGS84,
  );
  const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(
    origin,
    Ellipsoid.WGS84,
  );
  const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
  const camera = {
    viewMatrix: Matrix4.computeView(
      Cartesian3.fromDegrees(longitude, latitude, altitude, Ellipsoid.WGS84),
      Cartesian3.negate(normal, new Cartesian3()),
      Cartesian3.fromCartesian4(Matrix4.getColumn(frame, 1, new Cartesian4())),
      Cartesian3.fromCartesian4(Matrix4.getColumn(frame, 0, new Cartesian4())),
      new Matrix4(),
    ),
    frustum: perspective(),
  };
  return { camera, frame, center: surfaceOffset(frame, 750, -500) };
}

function nativeClip(camera, position) {
  const eye = Matrix4.multiplyByPoint(
    camera.viewMatrix,
    position,
    new Cartesian3(),
  );
  const clip = Matrix4.multiplyByVector(
    camera.frustum.projectionMatrix,
    new Cartesian4(eye.x, eye.y, eye.z, 1),
    new Cartesian4(),
  );
  return [clip.x, clip.y, (clip.w - clip.z) * 0.5, clip.w];
}

test("reversed projection retains nonzero ordered orbital depth after float32 upload", () => {
  const camera = { viewMatrix: Matrix4.IDENTITY, frustum: perspective() };
  const matrix = computeRelativeViewProjection(camera, Cartesian3.ZERO);
  const vectors = [
    [1, 0.09999999982],
    [10, 0.009999999802],
    [20000000, 4.80000000096e-9],
    [100000000, 8.0000000016e-10],
    [400000000, 5.000000001e-11],
  ];
  let previous = 1;
  for (const [distance, expected] of vectors) {
    const depth = ndc(floatClip(matrix, new Cartesian3(0, 0, -distance)))[2];
    assert.ok(depth > 0 && depth < previous, `depth at ${distance} m`);
    close(depth, expected, expected * 3e-7, "reversed depth");
    previous = depth;
  }
});

test("near and far clip boundaries map to one and zero with out-of-range rejection", () => {
  const camera = { viewMatrix: Matrix4.IDENTITY, frustum: perspective() };
  const matrix = computeRelativeViewProjection(camera, Cartesian3.ZERO);
  const depth = (distance) =>
    ndc(floatClip(matrix, new Cartesian3(0, 0, -distance)))[2];
  close(depth(0.1), 1, 1e-7, "near plane");
  close(depth(500000000), 0, 1e-16, "far plane");
  assert.ok(depth(0.05) > 1);
  assert.ok(depth(600000000) < 0);
  assert.ok(depth(1) > depth(1.001), "one-millimetre depth separation");
});

test("unsupported frusta fail instead of producing invalid GPU depth", () => {
  for (const frustum of [
    perspective({ far: Infinity }),
    perspective({ near: 0 }),
    perspective({ near: 1, far: 1 }),
    new OrthographicFrustum({
      width: 100,
      aspectRatio: 16 / 9,
      near: 0.1,
      far: 1000,
    }),
  ]) {
    assert.throws(() =>
      computeRelativeViewProjection(
        { viewMatrix: Matrix4.IDENTITY, frustum },
        Cartesian3.ZERO,
      ),
    );
  }
});

test("off-center projection matches native double X/Y and preserves its inputs", () => {
  const { camera, frame, center } = cameraFixture(179.9995, 85, 10000);
  camera.frustum = new PerspectiveOffCenterFrustum({
    near: 0.1,
    far: 500000000,
    left: -0.07,
    right: 0.11,
    bottom: -0.025,
    top: 0.075,
  });
  const originalView = Matrix4.clone(camera.viewMatrix);
  const originalProjection = Matrix4.clone(camera.frustum.projectionMatrix);
  const originalCenter = Cartesian3.clone(center);
  const result = new Matrix4();
  assert.equal(computeRelativeViewProjection(camera, center, result), result);
  for (const [east, north] of [
    [0, 0],
    [50, -70],
    [-100, 200],
  ]) {
    const point = surfaceOffset(frame, east, north, 12);
    const local = Cartesian3.subtract(point, center, new Cartesian3());
    const actual = Matrix4.multiplyByVector(
      result,
      new Cartesian4(local.x, local.y, local.z, 1),
      new Cartesian4(),
    );
    const expected = nativeClip(camera, point);
    for (const [index, value] of [
      actual.x,
      actual.y,
      actual.z,
      actual.w,
    ].entries()) {
      close(value, expected[index], 1e-7, `clip component ${index}`);
    }
  }
  assert.ok(Matrix4.equals(camera.viewMatrix, originalView));
  assert.ok(
    Matrix4.equals(camera.frustum.projectionMatrix, originalProjection),
  );
  assert.ok(Cartesian3.equals(center, originalCenter));
});

test("RTC stays within subpixel error from WGS84 orbit to ground at dateline and poles", (t) => {
  let maxNdcError = 0;
  let samples = 0;
  for (const [longitude, latitude] of [
    [12.34567, 0],
    [179.9995, 85],
    [-179.9995, -45],
    [0, 90],
  ]) {
    for (const altitude of [20000000, 1000000, 10000, 100, 1]) {
      const { camera, frame, center } = cameraFixture(
        longitude,
        latitude,
        altitude,
      );
      const matrix = computeRelativeViewProjection(camera, center);
      const span = Math.min(altitude * 0.15, 1000);
      for (const east of [-span, 0, span]) {
        for (const north of [-span, 0, span]) {
          const point = surfaceOffset(frame, east, north, 0.123);
          const local = Cartesian3.subtract(point, center, new Cartesian3());
          const actual = ndc(floatClip(matrix, local));
          const expected = ndc(nativeClip(camera, point));
          for (let component = 0; component < 3; component++) {
            close(
              actual[component],
              expected[component],
              3e-4,
              "RTC NDC error",
            );
            maxNdcError = Math.max(
              maxNdcError,
              Math.abs(actual[component] - expected[component]),
            );
          }
          assert.ok(actual[2] > 0 && actual[2] < 1, "visible surface depth");
          samples++;
        }
      }
    }
  }
  t.diagnostic(
    `${samples} CPU float32 samples; maximum NDC error ${maxNdcError}`,
  );
});

function encodedMesh(quantized, mercator) {
  const center = Cartesian3.fromDegrees(179.9995, 85, 0, Ellipsoid.WGS84);
  const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(
    center,
    Ellipsoid.WGS84,
  );
  const encoding = new TerrainEncoding(
    center,
    quantized
      ? new AxisAlignedBoundingBox(
          new Cartesian3(-1000, -1000, -100),
          new Cartesian3(1000, 1000, 100),
        )
      : undefined,
    quantized ? -100 : undefined,
    quantized ? 100 : undefined,
    quantized ? frame : undefined,
    true,
    mercator,
    true,
  );
  const vertices = new Float32Array(encoding.stride * 3);
  const offsets = [
    [37.25, -83.625, 0.123],
    [-100, 50, 20],
    [100, 25, -10],
  ];
  const positions = offsets.map(([east, north, height]) =>
    Matrix4.multiplyByPoint(
      frame,
      new Cartesian3(east, north, height),
      new Cartesian3(),
    ),
  );
  positions.forEach((position, index) =>
    encoding.encode(
      vertices,
      index * encoding.stride,
      position,
      new Cartesian2(index * 0.25, 0.75 - index * 0.25),
      offsets[index][2],
      Cartesian3.UNIT_Z,
      0.2 + index * 0.25,
      Cartesian3.UNIT_Z,
    ),
  );
  return {
    mesh: { center, vertices, indices: new Uint16Array([0, 1, 2]), encoding },
    positions,
  };
}

for (const quantized of [false, true]) {
  for (const mercator of [false, true]) {
    test(`terrain decoding preserves RTC/UV and ${mercator ? "Mercator T" : "V fallback"} with ${quantized ? "BITS12" : "NONE"} encoding`, () => {
      const { mesh, positions } = encodedMesh(quantized, mercator);
      const original = mesh.vertices.slice();
      const decoded = decodeTerrainMesh(mesh);
      assert.ok(decoded.vertices instanceof Float32Array);
      assert.equal(decoded.vertices.length, 18);
      assert.equal(decoded.indices, mesh.indices);
      assert.equal(decoded.center, mesh.center);
      assert.deepEqual(mesh.vertices, original);
      for (let index = 0; index < 3; index++) {
        const offset = index * 6;
        const actual = Cartesian3.fromArray(decoded.vertices, offset);
        Cartesian3.add(actual, mesh.center, actual);
        assert.ok(
          Cartesian3.distance(actual, positions[index]) <
            (quantized ? 0.75 : 0.00002),
          "world-position reconstruction",
        );
        close(decoded.vertices[offset + 3], index * 0.25, 1 / 4095, "U");
        close(decoded.vertices[offset + 4], 0.75 - index * 0.25, 1 / 4095, "V");
        close(
          decoded.vertices[offset + 5],
          mercator ? 0.2 + index * 0.25 : 0.75 - index * 0.25,
          1 / 4095,
          "Mercator coordinate",
        );
      }
    });
  }
}

test("native heightmap meshes retain all surface and skirt vertices across encodings", () => {
  for (const level of [2, 14]) {
    const data = new HeightmapTerrainData({
      buffer: Uint16Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      width: 3,
      height: 3,
    });
    const mesh = data._createMeshSync({
      tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.WGS84 }),
      x: 1,
      y: 1,
      level,
    });
    const decoded = decodeTerrainMesh(mesh);
    assert.equal(decoded.vertices.length, 21 * 6);
    assert.equal(decoded.indices, mesh.indices);
    assert.equal(decoded.indices.length, 72);
    assert.ok(decoded.vertices.every(Number.isFinite));
    for (let vertex = 0; vertex < 21; vertex++) {
      const expected = mesh.encoding.decodePosition(mesh.vertices, vertex);
      const actual = Cartesian3.fromArray(decoded.vertices, vertex * 6);
      Cartesian3.add(actual, mesh.center, actual);
      const tolerance = level === 2 ? 0.2 : 0.001;
      assert.ok(
        Cartesian3.distance(actual, expected) < tolerance,
        "native mesh position",
      );
    }
  }
});
