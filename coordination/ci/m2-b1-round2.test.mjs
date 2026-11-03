import assert from "node:assert/strict";
import { test } from "node:test";
import { applyB1Controls, assertB1Pair, b1CaptureConfig, b1StaticCaptures } from "./m2-b1-round2-fixtures.mjs";

test("a combined resize restores Bloom and all controls after an isolated off-axis capture", () => {
  const combined = b1CaptureConfig();
  const isolated = b1CaptureConfig({ mode: "disc-only", exposure: 0.5, yaw: 0.09 });
  const scene = { exposure: -1, sun: {}, atmosphere: {}, moon: {}, stars: {},
    _atmosphere: { bloomStrength: 0, solarEffects: {} } };
  const resized = b1CaptureConfig({ width: 1280 });
  applyB1Controls(scene, isolated.controls);
  applyB1Controls(scene, resized.controls);
  assert.equal(scene._atmosphere.bloomStrength, 0.35, "720p must not inherit Bloom=0");
  assert.equal(scene.exposure, 1, "720p must not inherit isolated exposure");
  assert.deepEqual(scene.sun, combined.controls.sun);
  assert.deepEqual(scene.atmosphere, combined.controls.atmosphere);
  assert.deepEqual(scene._atmosphere.solarEffects, combined.controls.solarEffects);
  scene.atmosphere.rayleighScattering[0] = 1;
  assert.equal(resized.controls.atmosphere.rayleighScattering[0], 5.802e-6);
});

test("resolution equality rejects the historical Bloom leak and the matrix resets off-axis yaw", () => {
  const rows = b1StaticCaptures();
  const center = rows.find((row) => row.id === "combined-low-1080-e1").config;
  const offAxis = rows.find((row) => row.id === "combined-off-axis-1080-e1").config;
  const resized = rows.find((row) => row.id === "combined-low-720-e1").config;
  assert.notEqual(offAxis.camera.yaw, 0);
  assert.equal(resized.camera.yaw, 0);
  assertB1Pair(center, resized, "resolution");
  resized.controls.bloomStrength = 0;
  assert.throws(() => assertB1Pair(center, resized, "resolution"), /capture pair/);
});
