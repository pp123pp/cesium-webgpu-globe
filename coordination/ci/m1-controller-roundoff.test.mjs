import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Quaternion } from "@cesium/core";
import { updateCameraController } from "../../packages/engine/Source/Scene/WebGPUScene.js";

test("native center-wheel zero-axis roundoff is an update-only no-op", () => {
  const calls = [];
  const prototype = {
    rotate(axis, angle) {
      calls.push({ axis, angle });
      return Quaternion.fromAxisAngle(axis, angle);
    },
  };
  const camera = Object.create(prototype);
  const controller = {
    update() {
      // Observed actual native wheel input at 45E/45N, height 12,000,000m.
      camera.rotate(Cartesian3.ZERO, 5.880415029710569e-9);
      camera.rotate(Cartesian3.UNIT_Z, 1e-9);
    },
  };
  updateCameraController(camera, controller);
  assert.equal(calls.length, 1, "A legitimate tiny rotation must still run");
  assert.equal(calls[0].axis, Cartesian3.UNIT_Z);
  assert.equal(camera.rotate, prototype.rotate);
  assert.equal(Object.hasOwn(camera, "rotate"), false);
  assert.throws(() => camera.rotate(Cartesian3.ZERO, 0.1), /normalized/);
});

test("controller exceptions restore the original camera method and do not hide invalid rotations", () => {
  const camera = {
    rotate: (axis, angle) => Quaternion.fromAxisAngle(axis, angle),
  };
  const original = camera.rotate;
  assert.throws(
    () =>
      updateCameraController(camera, {
        update() {
          camera.rotate(Cartesian3.ZERO, 0.1);
        },
      }),
    /normalized/,
  );
  assert.equal(camera.rotate, original);
  assert.equal(Object.hasOwn(camera, "rotate"), true);
});
