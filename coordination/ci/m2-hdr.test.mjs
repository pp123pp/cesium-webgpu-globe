import assert from "node:assert/strict";
import { createSunParameters, sunDisplayRadiance } from "../../packages/engine/Source/Scene/WebGPUSun.js";
import {
  decodeSrgbChannel,
  encodeSrgbChannel,
  toneMapACESChannel,
  validateExposure,
} from "../../packages/engine/Source/Scene/WebGPUColorPipeline.js";

assert.equal(validateExposure(1), 1);
assert.throws(() => validateExposure(0), /exposure/);
assert.throws(() => validateExposure(17), /exposure/);
assert.throws(() => validateExposure(Number.NaN), /exposure/);
assert.ok(sunDisplayRadiance(createSunParameters(), 10) > 1,
  "default solar disk radiance is preserved above 1.0 in the HDR scene");

assert.equal(decodeSrgbChannel(0), 0);
assert.equal(decodeSrgbChannel(1), 1);
assert.ok(Math.abs(decodeSrgbChannel(0.04045) - 0.0031308) < 1e-7);
assert.ok(Math.abs(encodeSrgbChannel(decodeSrgbChannel(0.5)) - 0.5) < 1e-7);

assert.equal(toneMapACESChannel(0), 0);
assert.ok(toneMapACESChannel(0.18) > 0.1 && toneMapACESChannel(0.18) < 0.3);
assert.ok(toneMapACESChannel(1) < 1);
assert.ok(toneMapACESChannel(8) > toneMapACESChannel(1));
assert.ok(toneMapACESChannel(8) <= 1);
assert.ok(toneMapACESChannel(1, 2) > toneMapACESChannel(1, 0.5));

