import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Ellipsoid, FixedFrameTransforms, Interval, JulianDate, Matrix4 } from "@cesium/core";
import PlanetMath from "../../packages/engine/Source/Scene/WebGPUPlanetMath.js";
import CelestialFrameTransforms from "../../packages/engine/Source/Core/CelestialFrameTransforms.js";

const a = 6378137;
const b = 6356752.3142451793;
const ray = (x, y, z, dx, dy, dz) => ({
  origin: new Cartesian3(x, y, z),
  direction: new Cartesian3(dx, dy, dz),
});
function close(actual, expected, tolerance = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} within ${tolerance}`,
  );
}
function interval(actual, start, stop, tolerance = 1e-7) {
  assert.ok(actual, "expected a forward interval");
  close(actual.start, start, tolerance);
  close(actual.stop, stop, tolerance);
  assert.ok(actual.start >= 0 && actual.stop >= actual.start);
}

test("WGS84 and the enclosing atmosphere use meters and retain polar flattening", () => {
  const p = PlanetMath.createPlanetParameters();
  assert.deepEqual(p.radii, new Cartesian3(a, a, b));
  assert.equal(p.maximumRadius, a);
  assert.equal(p.minimumRadius, b);
  assert.equal(p.atmosphereHeight, 100000);
  assert.equal(p.atmosphereRadius, 6478137);
  close(p.maximumSphereError, 21384.685754820704, 1e-8);
  close(p.atmosphereRadius - b, 121384.6857548207, 1e-8);
  assert.ok(p.ellipsoid.equals(Ellipsoid.WGS84));
  assert.ok(p.atmosphereEllipsoid.equals(new Ellipsoid(6478137, 6478137, 6478137)));
});

test("explicit atmosphere heights cannot silently become kilometers or invalid radii", () => {
  const p = PlanetMath.createPlanetParameters(Ellipsoid.WGS84, 80000);
  assert.equal(p.atmosphereRadius, 6458137);
  for (const height of [0, -1, NaN, Infinity]) {
    assert.throws(() => PlanetMath.createPlanetParameters(Ellipsoid.WGS84, height));
  }
  assert.throws(() => PlanetMath.createPlanetParameters(new Ellipsoid(1, 0, 1)));
});

for (const altitude of [2, 400000, 35786000]) {
  test(`an equatorial ${altitude} m ray measures meters even with a nonunit direction`, () => {
    const input = ray(a + altitude, 0, 0, -17, 0, 0);
    const before = { origin: Cartesian3.clone(input.origin), direction: Cartesian3.clone(input.direction) };
    const result = new Interval();
    assert.equal(PlanetMath.intersectEllipsoid(input, Ellipsoid.WGS84, result), result);
    interval(result, altitude, altitude + 2 * a, 1e-6);
    assert.deepEqual(input, before);
  });
}

test("polar and equatorial ground inward rays return the complete diameter", () => {
  interval(PlanetMath.intersectEllipsoid(ray(0, 0, b, 0, 0, -1)), 0, 2 * b);
  interval(PlanetMath.intersectEllipsoid(ray(a, 0, 0, -1, 0, 0)), 0, 2 * a);
});

test("surface outward and tangent contact has zero length rather than Earth occlusion", () => {
  for (const input of [ray(a, 0, 0, 1, 0, 0), ray(a, 0, 0, 0, 1, 0), ray(0, 0, b, 0, 0, 1)]) {
    interval(PlanetMath.intersectEllipsoid(input), 0, 0);
  }
});

test("rotated geodetic ground tangents do not turn rounding into solid-Earth occlusion", () => {
  const p = PlanetMath.createPlanetParameters();
  for (const [longitude, latitude] of [[12.34567, 37.4], [-177, -87]]) {
    const origin = Cartesian3.fromDegrees(longitude, latitude, 0);
    const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(origin);
    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
    for (const localDirection of [Cartesian3.UNIT_X, Cartesian3.UNIT_Y]) {
      const direction = Matrix4.multiplyByPointAsVector(frame, localDirection, new Cartesian3());
      interval(PlanetMath.intersectEllipsoid({ origin, direction }), 0, 0, 0);
      assert.ok(PlanetMath.clipAtmosphereRay({ origin, direction }, p).stop > 1000000);
      const tilt = Cartesian3.multiplyByScalar(normal, 1e-6, new Cartesian3());
      const inward = Cartesian3.subtract(direction, tilt, new Cartesian3());
      const outward = Cartesian3.add(direction, tilt, new Cartesian3());
      assert.equal(PlanetMath.clipAtmosphereRay({ origin, direction: inward }, p), undefined);
      assert.ok(PlanetMath.clipAtmosphereRay({ origin, direction: outward }, p).stop > 1000000);
    }
  }
});

test("rays one centimeter inside and outside the surface remain distinct", () => {
  interval(PlanetMath.intersectEllipsoid(ray(a + 0.01, 0, 0, -1, 0, 0)), 0.01, 2 * a + 0.01);
  interval(PlanetMath.intersectEllipsoid(ray(a - 0.01, 0, 0, 1, 0, 0)), 0, 0.01);
  assert.equal(PlanetMath.intersectEllipsoid(ray(a + 0.01, 0, 0, 1, 0, 0)), undefined);
});

test("an exterior tangent and neighboring hit/miss rays keep sorted forward intervals", () => {
  interval(PlanetMath.intersectEllipsoid(ray(-1000, a, 0, 1, 0, 0)), 1000, 1000, 0.001);
  assert.equal(PlanetMath.intersectEllipsoid(ray(-1000, a + 0.01, 0, 1, 0, 0)), undefined);
  const hit = PlanetMath.intersectEllipsoid(ray(-1000, a - 0.01, 0, 1, 0, 0));
  assert.ok(hit.start < 1000 && hit.stop > 1000);
  close(hit.start + hit.stop, 2000, 1e-6);
  assert.equal(PlanetMath.intersectEllipsoid(ray(-1000, a + 1000, 0, -1, 0, 0)), undefined);
});

test("inside-Earth intervals are finite and invalid directions fail explicitly", () => {
  interval(PlanetMath.intersectEllipsoid(ray(0, 0, 0, 1, 0, 0)), 0, a);
  for (const input of [ray(0, 0, 0, 0, 0, 0), ray(a, 0, 0, NaN, 0, 0), ray(Infinity, 0, 0, 1, 0, 0)]) {
    assert.throws(() => PlanetMath.intersectEllipsoid(input));
  }
});

test("outer atmosphere entries and exits remain separate from WGS84 surface hits", () => {
  const p = PlanetMath.createPlanetParameters();
  interval(PlanetMath.intersectAtmosphere(ray(a + 400000, 0, 0, -1, 0, 0), p), 300000, 2 * a + 500000, 1e-6);
  interval(PlanetMath.intersectAtmosphere(ray(a + 1000, 0, 0, 1, 0, 0), p), 0, 99000);
  interval(PlanetMath.intersectAtmosphere(ray(a + 100000, 0, 0, 1, 0, 0), p), 0, 0);
  assert.equal(PlanetMath.intersectAtmosphere(ray(a + 400000, 0, 0, 1, 0, 0), p), undefined);
});

test("visible atmosphere stops at Earth or a nearer real scene surface", () => {
  const p = PlanetMath.createPlanetParameters();
  const input = ray(a + 400000, 0, 0, -1, 0, 0);
  interval(PlanetMath.clipAtmosphereRay(input, p), 300000, 400000, 1e-6);
  interval(PlanetMath.clipAtmosphereRay(input, p, 399900), 300000, 399900, 1e-6);
  assert.equal(PlanetMath.clipAtmosphereRay(input, p, 200000), undefined);
  interval(PlanetMath.clipAtmosphereRay(ray(a, 0, 0, 1, 0, 0), p), 0, 100000);
  assert.equal(PlanetMath.clipAtmosphereRay(ray(a, 0, 0, -1, 0, 0), p), undefined);
  assert.equal(PlanetMath.clipAtmosphereRay(ray(a - 1, 0, 0, 1, 0, 0), p), undefined);
  assert.throws(() => PlanetMath.clipAtmosphereRay(input, p, NaN));
  assert.throws(() => PlanetMath.clipAtmosphereRay(input, p, -1));
});

test("geocentric Earth-to-Sun direction agrees with equinox day/night and Earth rotation", () => {
  const noon = JulianDate.fromIso8601("2026-03-20T12:00:00Z");
  const s = PlanetMath.computeSunDirectionWC(noon);
  close(Cartesian3.magnitude(s), 1, 1e-14);
  assert.ok(s.x > 0.98 && Math.abs(s.y) < 0.05 && Math.abs(s.z) < 0.02);
  assert.ok(Cartesian3.dot(Cartesian3.UNIT_X, s) > 0, "Greenwich noon faces the Sun");
  assert.ok(Cartesian3.dot(Cartesian3.negate(Cartesian3.UNIT_X, new Cartesian3()), s) < 0, "opposite side is dark");
  const sixHours = PlanetMath.computeSunDirectionWC(JulianDate.addHours(noon, 6, new JulianDate()));
  const midnight = PlanetMath.computeSunDirectionWC(JulianDate.addHours(noon, 12, new JulianDate()));
  assert.ok(Math.abs(Cartesian3.dot(s, sixHours)) < 0.02);
  assert.ok(Cartesian3.dot(s, midnight) < -0.99);
  const result = new Cartesian3();
  assert.equal(PlanetMath.computeSunDirectionWC(noon, result), result);
  assert.ok(Cartesian3.equalsEpsilon(result, s, 1e-14));
});

test("unavailable ICRF data uses the native pseudo-fixed fallback and preserves seasonal direction", (t) => {
  const originalIcrf = CelestialFrameTransforms.computeIcrfToFixedMatrix;
  const originalFallback = CelestialFrameTransforms.computeTemeToPseudoFixedMatrix;
  let fallbackCalls = 0;
  CelestialFrameTransforms.computeIcrfToFixedMatrix = () => undefined;
  CelestialFrameTransforms.computeTemeToPseudoFixedMatrix = (...args) => {
    fallbackCalls++;
    return originalFallback(...args);
  };
  t.after(() => {
    CelestialFrameTransforms.computeIcrfToFixedMatrix = originalIcrf;
    CelestialFrameTransforms.computeTemeToPseudoFixedMatrix = originalFallback;
  });
  const june = PlanetMath.computeSunDirectionWC(JulianDate.fromIso8601("2026-06-21T12:00:00Z"));
  const december = PlanetMath.computeSunDirectionWC(JulianDate.fromIso8601("2026-12-21T12:00:00Z"));
  assert.equal(fallbackCalls, 2);
  close(june.z, 0.3978, 0.002);
  close(december.z, -0.3978, 0.002);
  close(Cartesian3.magnitude(june), 1, 1e-14);
  close(Cartesian3.magnitude(december), 1, 1e-14);
});
