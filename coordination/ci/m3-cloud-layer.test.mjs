import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Cartographic, Ellipsoid } from "@cesium/core";
import WebGPUCloudLayer from "../../packages/engine/Source/Scene/WebGPUCloudLayer.js";

const a = Ellipsoid.WGS84.radii.x;
const layer = () => new WebGPUCloudLayer();
const ray = (height, direction = -1) => ({
  origin: new Cartesian3(a + height, 0, 0),
  direction: new Cartesian3(direction, 0, 0),
});
function intervals(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach(({ start, stop }, i) => {
    assert.ok(Math.abs(start - expected[i][0]) < tolerance, `${start} vs ${expected[i][0]}`);
    assert.ok(Math.abs(stop - expected[i][1]) < tolerance, `${stop} vs ${expected[i][1]}`);
  });
}

test("WGS84 axis offsets preserve equator/poles and bound geodetic approximation", () => {
  const cloud = layer();
  assert.equal(cloud.baseHeight, 2000);
  assert.equal(cloud.topHeight, 6000);
  assert.ok(cloud.maximumHeightError < 0.009);
  for (const [height, boundary] of [[2000, cloud.innerEllipsoid], [6000, cloud.outerEllipsoid]]) {
    for (let latitude = -90; latitude <= 90; latitude += 1) {
      const point = boundary.cartographicToCartesian(Cartographic.fromDegrees(137, latitude));
      const measured = Ellipsoid.WGS84.cartesianToCartographic(point).height;
      assert.ok(measured <= height + 1e-8);
      assert.ok(height - measured <= cloud.maximumHeightError + 1e-8);
    }
  }
});

test("outside/inside/below shell entries and Earth clipping use meter distances", () => {
  intervals(layer().intersect(ray(10000, -17)), [[4000, 8000]]);
  intervals(layer().intersect(ray(4000)), [[0, 2000]]);
  intervals(layer().intersect(ray(4000, 1)), [[0, 2000]]);
  intervals(layer().intersect(ray(2, 1)), [[1998, 5998]]);
  intervals(layer().intersect(ray(2)), []);
  intervals(layer().intersect(ray(-1, 1)), []);
  intervals(layer().intersect(ray(10000, 1)), []);
});

test("hollow interior crossing returns two lobes when Earth is missed", () => {
  const y = a + 1000;
  const input = { origin: new Cartesian3(-1000000, y, 0), direction: Cartesian3.UNIT_X };
  const outer = Math.sqrt((a + 6000) ** 2 - y ** 2);
  const inner = Math.sqrt((a + 2000) ** 2 - y ** 2);
  intervals(layer().intersect(input), [[1000000 - outer, 1000000 - inner], [1000000 + inner, 1000000 + outer]], 1e-5);
});

test("outer tangent is contact, near tangents separate miss and finite chord", () => {
  const cloud = layer();
  const input = { origin: new Cartesian3(-1000000, a + 6000, 0), direction: Cartesian3.UNIT_X };
  intervals(cloud.intersect(input), [[1000000, 1000000]], 1e-5);
  input.origin.y += 0.01;
  intervals(cloud.intersect(input), []);
  input.origin.y -= 0.02;
  const result = cloud.intersect(input);
  assert.equal(result.length, 1);
  assert.ok(result[0].stop - result[0].start > 700);
});

test("shell boundary directions and terrain clip neither leak nor invent distance", () => {
  intervals(layer().intersect(ray(2000, 1)), [[0, 4000]]);
  intervals(layer().intersect(ray(6000)), [[0, 4000]]);
  intervals(layer().intersect(ray(6000, 1)), [[0, 0]]);
  intervals(layer().intersect(ray(10000), 5000), [[4000, 5000]]);
  intervals(layer().intersect(ray(10000), 3000), []);
  intervals(layer().intersect(ray(10000), 0), []);
});

test("parameter and ray validation remains at public entry points", () => {
  for (const options of [{baseHeight: -1}, {baseHeight: 6000}, {topHeight: Infinity}, {baseHeight: NaN}, {ellipsoid: new Ellipsoid(1, 0, 1)}]) {
    assert.throws(() => new WebGPUCloudLayer(options));
  }
  for (const distance of [-1, NaN, -Infinity]) { assert.throws(() => layer().intersect(ray(10000), distance)); }
  assert.throws(() => layer().intersect(ray(10000, 0)));
  assert.throws(() => layer().intersect({ origin: Cartesian3.ZERO, direction: new Cartesian3(NaN, 0, 0) }));
});

test("inner tangency does not split material; measured depth can stop between lobes", () => {
  const cloud = layer();
  const input = { origin: new Cartesian3(-1000000, a + 2000, 0), direction: Cartesian3.UNIT_X };
  assert.equal(cloud.intersect(input).length, 1);
  input.origin.y = a + 1000;
  const before = { origin: Cartesian3.clone(input.origin), direction: Cartesian3.clone(input.direction) };
  const full = cloud.intersect(input);
  intervals(cloud.intersect(input, 1000000), [[full[0].start, full[0].stop]]);
  intervals(cloud.intersect(input, full[1].start + 10), [[full[0].start, full[0].stop], [full[1].start, full[1].start + 10]]);
  assert.deepEqual(input, before);
});

test("split uniform packing preserves reciprocal radii and near-boundary camera c", () => {
  const cloud = layer();
  for (const height of [2, 2000, 2000.01, 4000, 6000, 35786000]) {
    const position = new Cartesian3(a + height, 0, 0);
    assert.equal(cloud.update({ cameraPositionWC: position }), cloud);
    assert.equal(cloud.uniformValues.byteLength, 96);
    for (const [i, ellipsoid] of [cloud.innerEllipsoid, cloud.outerEllipsoid, cloud.ellipsoid].entries()) {
      const values = cloud.uniformValues;
      const inverse = values[i * 8] + values[i * 8 + 4];
      const c = values[i * 8 + 3] + values[i * 8 + 7];
      const expected = ((a + height) / ellipsoid.radii.x) ** 2 - 1;
      assert.ok(Math.abs(inverse - ellipsoid.oneOverRadii.x) < 1e-21);
      assert.ok(Math.abs(c - expected) < 2e-13);
    }
  }
});

test("geographic shell crossings agree with native WGS84 normal altitude", () => {
  const cloud = layer();
  for (const [longitude, latitude] of [[179.999, 45], [-179.999, -45], [12, 90], [125, -80]]) {
    const origin = Cartesian3.fromDegrees(longitude, latitude, 10000);
    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
    const direction = Cartesian3.negate(normal, new Cartesian3());
    const hit = cloud.intersect({ origin, direction });
    assert.equal(hit.length, 1);
    assert.ok(Math.abs(hit[0].start - 4000) <= cloud.maximumHeightError + 1e-6);
    assert.ok(Math.abs(hit[0].stop - 8000) <= cloud.maximumHeightError + 1e-6);
  }
});
