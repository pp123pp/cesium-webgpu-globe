import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Cartesian3,
  Ellipsoid,
  FixedFrameTransforms,
  GeographicProjection,
  JulianDate,
  Matrix4,
  PerspectiveOffCenterFrustum,
} from "@cesium/core";
import Camera from "../../packages/engine/Source/Scene/Camera.js";
import SceneMode from "../../packages/engine/Source/Scene/SceneMode.js";
import PlanetState from "../../packages/engine/Source/Scene/WebGPUPlanetState.js";

const time = JulianDate.fromIso8601("2026-03-20T12:00:00Z");
function cameraAt(longitude, latitude, height) {
  const camera = new Camera({
    drawingBufferWidth: 1280,
    drawingBufferHeight: 720,
    mapProjection: new GeographicProjection(Ellipsoid.WGS84),
    scene3DOnly: true,
  });
  camera.frustum.near = 0.1;
  camera.frustum.far = 500000000;
  camera.setView({
    destination: Cartesian3.fromDegrees(longitude, latitude, height),
    orientation: { heading: 0.3, pitch: -0.7, roll: 0.1 },
  });
  camera.update(SceneMode.SCENE3D);
  return camera;
}
function close(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
}

for (const [label, longitude, latitude, height] of [
  ["high orbit", 0, 0, 35786000],
  ["low orbit", 179.999, 85, 400000],
  ["ground", 86.925, 27.9, 2],
  ["polar ground", 0, 90, 2],
]) {
  test(`${label}: ECEF, geodetic height, encoded meters and uniform values remain finite`, () => {
    const camera = cameraAt(longitude, latitude, height);
    const view = Matrix4.clone(camera.viewMatrix);
    const state = new PlanetState();
    const values = state.uniformValues;
    assert.equal(state.update(camera, time), state);
    assert.equal(state.uniformValues, values, "reuse the frame allocation");
    assert.equal(values.byteLength, 272);
    assert.ok(state.moonDistance > 3.4e8 && state.moonDistance < 4.1e8);
    assert.ok(state.moonAngularRadius > 0.0035 && state.moonAngularRadius < 0.0055);
    assert.ok(state.moonIllumination >= 0 && state.moonIllumination <= 1);
    close(Cartesian3.magnitude(state.moonDirectionWC), 1, 1e-12);
    close(values[48], state.moonDirectionWC.x, 1e-7);
    close(values[49], state.moonDirectionWC.y, 1e-7);
    close(values[50], state.moonDirectionWC.z, 1e-7);
    close(values[51], state.moonAngularRadius, 1e-7);
    close(values[52], state.moonIllumination, 1e-7);
    for (let row = 0; row < 3; ++row) {
      for (let column = 0; column < 3; ++column) {
        close(values[56 + row * 4 + column], state._moonRotation[row * 3 + column], 1e-7);
      }
    }
    assert.ok([...values].every(Number.isFinite));
    close(state.cameraHeight, height, 1e-6);
    assert.ok(state.cameraGeocentricDistance > height + 6356000);
    assert.ok(JulianDate.equals(state.time, time));
    assert.deepEqual(camera.viewMatrix, view);
    for (const [index, axis] of ["x", "y", "z"].entries()) {
      close(values[8 + index] + values[12 + index], camera.positionWC[axis], 0.003);
      close(values[index], Ellipsoid.WGS84.radii[axis], 0.5);
    }
    close(values[3], 6478137, 0);
    close(values[15], height, 4);
    const eye = Matrix4.multiplyByPointAsVector(camera.viewMatrix, state.sunDirectionWC, new Cartesian3());
    assert.ok(Cartesian3.equalsEpsilon(state.sunDirectionEC, eye, 1e-14));
    close(Cartesian3.magnitude(state.sunDirectionEC), 1, 1e-14);
  });
}

test("native transformed camera uses ECEF world position; Sun has no camera-translation parallax", () => {
  const camera = cameraAt(20, 30, 2);
  const state = new PlanetState().update(camera, time);
  const sun = Cartesian3.clone(state.sunDirectionWC);
  const transform = FixedFrameTransforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(20, 30));
  camera.lookAtTransform(transform, new Cartesian3(0, -400000, 400000));
  camera.update(SceneMode.SCENE3D);
  state.update(camera, time);
  assert.ok(!Cartesian3.equals(camera.position, camera.positionWC));
  assert.ok(Cartesian3.equals(state.cameraPositionWC, camera.positionWC));
  assert.ok(Cartesian3.equals(state.sunDirectionWC, sun));
  const later = JulianDate.addHours(time, 6, new JulianDate());
  state.update(camera, later);
  assert.ok(Math.abs(Cartesian3.dot(state.sunDirectionWC, sun)) < 0.02);
});

test("off-center projection and forward direction are packed without reversing axes", () => {
  const camera = cameraAt(0, 0, 400000);
  camera.frustum = new PerspectiveOffCenterFrustum({ near: 0.1, far: 500000000, left: -0.07, right: 0.11, bottom: -0.025, top: 0.075 });
  const state = new PlanetState().update(camera, time);
  const values = state.uniformValues;
  const projection = camera.frustum.projectionMatrix;
  for (const [i, source] of [0, 5, 8, 9].entries()) {close(values[36 + i], projection[source], 1e-7);}
  for (const [i, axis] of ["x", "y", "z"].entries()) {close(values[32 + i], camera.directionWC[axis], 1e-7);}
  close(values[40], 0.1, 1e-8);
  close(values[41], 500000000, 0);
});

test("ground quadratic constant is computed before float32 Earth-sized cancellation", () => {
  const camera = cameraAt(0, 90, 0.01);
  const state = new PlanetState().update(camera, time);
  const c = state.uniformValues[44];
  assert.ok(c > 0 && c < 1e-8, "one-centimeter altitude must survive upload");
  close(c, 3.1462606e-9, 2e-15);
});


test("Moon direction includes camera parallax and follows native lunar ephemeris time", () => {
  const camera = cameraAt(20, 30, 400000);
  const state = new PlanetState().update(camera, time);
  const first = Cartesian3.clone(state.moonDirectionWC);
  const firstPhase = state.moonIllumination;
  camera.position = Cartesian3.add(camera.positionWC, new Cartesian3(200000, 0, 0), new Cartesian3());
  camera.update(SceneMode.SCENE3D);
  state.update(camera, time);
  assert.ok(Cartesian3.distance(first, state.moonDirectionWC) > 1e-5, "camera translation changes apparent lunar direction");
  const nextTime = JulianDate.addDays(time, 7, new JulianDate());
  state.update(camera, nextTime);
  assert.ok(Cartesian3.distance(first, state.moonDirectionWC) > 0.01, "lunar ephemeris advances with scene time");
  assert.ok(state.moonIllumination >= 0 && state.moonIllumination <= 1);
  assert.ok(Number.isFinite(firstPhase));
});
