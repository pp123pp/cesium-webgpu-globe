import assert from "node:assert/strict";
import { test } from "node:test";
import { DeveloperError, Ellipsoid } from "@cesium/core";
import { createPlanetParameters } from "../../packages/engine/Source/Scene/WebGPUPlanetMath.js";
import {
  atmosphereLutKey,
  cornetteShanksPhase,
  createAtmosphereParameters,
  generateAtmosphereLuts,
  integrateTransmittance,
  rayleighPhase,
  sampleMultipleScattering,
  sampleTransmittance,
  validateAtmosphereParameters,
} from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";

const planet = createPlanetParameters();
const atmosphere = createAtmosphereParameters();
let standardLuts;

function getStandardLuts() {
  standardLuts ??= generateAtmosphereLuts(atmosphere, planet);
  return standardLuts;
}

function close(actual, expected, tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} within ${tolerance}`,
  );
}

function checkRgb(lut, predicate) {
  for (let index = 0; index < lut.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(
        predicate(lut.data[index + channel]),
        `texel ${index / 4}, channel ${channel}`,
      );
    }
  }
}

test("invalid optical parameters fail before producing nonphysical or undefined energy", () => {
  for (const changes of [
    { rayleighScattering: [1e-5, -1e-5, 1e-5] },
    { rayleighScattering: [1e-5, NaN, 1e-5] },
    { rayleighScattering: [1e100, 0, 0] },
    { rayleighScattering: [1.1, 0, 0] },
    {
      rayleighScattering: [0.8, 0.8, 0.8],
      mieExtinction: 0.3,
      mieScattering: 0.1,
    },
    { mieScattering: -1 },
    { mieScattering: 1e100, mieExtinction: 1e100 },
    { mieExtinction: 1e-7 },
    { mieExtinction: 1.1 },
    { rayleighScaleHeight: 0 },
    { mieScaleHeight: Infinity },
    { mieScaleHeight: 1e-100 },
    { rayleighScaleHeight: 1e100 },
    { rayleighScaleHeight: 0.5 },
    { mieScaleHeight: 2e6 },
    { mieAnisotropy: -1 },
    { mieAnisotropy: 1 },
    { mieAnisotropy: -0.991 },
    { mieAnisotropy: 0.991 },
    { lightIntensity: NaN },
    { lightIntensity: 1e100 },
    { lightIntensity: 1e6 + 1 },
    { multipleScatteringStrength: -1 },
    { multipleScatteringStrength: 1e100 },
    { multipleScatteringStrength: 1.1 },
  ]) {
    assert.throws(
      () => validateAtmosphereParameters({ ...atmosphere, ...changes }),
      DeveloperError,
    );
  }
});

test("medium changes invalidate the LUT cache while runtime lighting controls do not", () => {
  const first = atmosphereLutKey(atmosphere, planet);
  const runtime = createAtmosphereParameters({
    show: false,
    lightIntensity: 0,
    multipleScatteringStrength: 0,
    mieAnisotropy: -0.5,
  });
  assert.equal(atmosphereLutKey(runtime, planet), first);
  runtime.rayleighScattering[0] *= 2;
  assert.notEqual(atmosphereLutKey(runtime, planet), first);
  assert.equal(
    atmosphereLutKey(atmosphere, planet),
    first,
    "one mutable parameter object must not alter another",
  );
  assert.notEqual(
    atmosphereLutKey(
      atmosphere,
      createPlanetParameters(Ellipsoid.WGS84, 80000),
    ),
    first,
  );
  assert.notEqual(
    atmosphereLutKey(
      atmosphere,
      createPlanetParameters(new Ellipsoid(6000000, 6000000, 6000000)),
    ),
    first,
  );
});

test("an empty path transmits all light and increasing extinction cannot brighten a path", () => {
  assert.deepEqual(
    integrateTransmittance(atmosphere, planet, 0, 1, 0),
    [1, 1, 1],
  );
  const original = integrateTransmittance(atmosphere, planet, 0, 1, 100000);
  const absorbing = createAtmosphereParameters({ mieExtinction: 4.44e-4 });
  const attenuated = integrateTransmittance(absorbing, planet, 0, 1, 100000);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(
      attenuated[channel] >= 0 && attenuated[channel] < original[channel],
    );
  }
});

test("vertical transmission agrees with the analytic exponential atmosphere column", () => {
  const numerical = integrateTransmittance(atmosphere, planet, 0, 1, 100000);
  const rayleighColumn = 8000 * (1 - Math.exp(-100000 / 8000));
  const mieColumn = 1200 * (1 - Math.exp(-100000 / 1200));
  for (let channel = 0; channel < 3; channel++) {
    const exact = Math.exp(
      -atmosphere.rayleighScattering[channel] * rayleighColumn -
        atmosphere.mieExtinction * mieColumn,
    );
    close(numerical[channel], exact, 0.0003);
  }
  // A horizon path also checks that the low-altitude integration resolves the
  // spherical density profile, not a planar height/cosine approximation.
  const horizonDistance = Math.sqrt(100000 * (2 * 6378137 + 100000));
  const coarse = integrateTransmittance(
    atmosphere,
    planet,
    0,
    0,
    horizonDistance,
  );
  const reference = integrateTransmittance(
    atmosphere,
    planet,
    0,
    0,
    horizonDistance,
    2048,
  );
  for (let channel = 0; channel < 3; channel++) {
    close(coarse[channel], reference[channel], 0.001);
  }
});

test("transmittance LUT samples conserve bounds and do not leak across the planet horizon", () => {
  const { transmittance } = getStandardLuts();
  checkRgb(
    transmittance,
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  assert.deepEqual(
    sampleTransmittance(transmittance, planet, 100000, 1),
    [1, 1, 1],
  );
  const height = 1000;
  const horizon =
    -Math.sqrt(height * (2 * 6378137 + height)) / (6378137 + height);
  assert.deepEqual(
    sampleTransmittance(transmittance, planet, height, horizon - 1e-4),
    [0, 0, 0],
  );
  const zenith = sampleTransmittance(transmittance, planet, height, 1);
  for (let channel = 0; channel < 3; channel++) {
    const opticalDepth =
      atmosphere.rayleighScattering[channel] *
        8000 *
        (Math.exp(-height / 8000) - Math.exp(-100000 / 8000)) +
      atmosphere.mieExtinction *
        1200 *
        (Math.exp(-height / 1200) - Math.exp(-100000 / 1200));
    close(zenith[channel], Math.exp(-opticalDepth), 0.001);
  }
});

test("a vacuum has unit transmission and no scattered radiance or feedback", () => {
  const vacuum = createAtmosphereParameters({
    rayleighScattering: [0, 0, 0],
    mieScattering: 0,
    mieExtinction: 0,
  });
  const luts = generateAtmosphereLuts(vacuum, planet);
  checkRgb(luts.transmittance, (value) => value === 1);
  checkRgb(luts.multipleScattering, (value) => value === 0);
  assert.equal(luts.maxFeedback, 0);
});

test("multiple scattering carries illuminated twilight but disappears in deep planetary shadow", () => {
  const { multipleScattering, maxFeedback } = getStandardLuts();
  assert.ok(maxFeedback > 0 && maxFeedback <= 1);
  checkRgb(
    multipleScattering,
    (value) =>
      Number.isFinite(value) && value >= 0 && value <= 20 / (4 * Math.PI),
  );
  const day = sampleMultipleScattering(multipleScattering, planet, 0, 1);
  const twilight = sampleMultipleScattering(
    multipleScattering,
    planet,
    0,
    -0.05,
  );
  const night = sampleMultipleScattering(multipleScattering, planet, 0, -1);
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(day[channel] > twilight[channel] && twilight[channel] > 0);
    assert.equal(night[channel], 0);
  }
  for (let row = 0; row < multipleScattering.height; row++) {
    const offset = row * multipleScattering.width * 4;
    assert.deepEqual(
      Array.from(multipleScattering.data.slice(offset, offset + 3)),
      [0, 0, 0],
    );
  }
});

test("the multiple-scattering closure remains finite when feedback approaches one", () => {
  const opticallyThick = createAtmosphereParameters({
    rayleighScattering: [0.001, 0.001, 0.001],
    rayleighScaleHeight: 1e6,
    mieScattering: 0,
    mieExtinction: 0,
  });
  const luts = generateAtmosphereLuts(opticallyThick, planet);
  assert.ok(luts.maxFeedback > 0.95 && luts.maxFeedback <= 1 + 1e-12);
  checkRgb(
    luts.multipleScattering,
    (value) =>
      Number.isFinite(value) && value >= 0 && value <= 20 / (4 * Math.PI),
  );
});

test("normalized phases conserve energy and positive Mie anisotropy peaks toward the Sun", () => {
  const steps = 16384;
  for (const phase of [
    rayleighPhase,
    ...[-0.7, 0, 0.8].map((g) => (mu) => cornetteShanksPhase(mu, g)),
  ]) {
    let integral = 0;
    for (let step = 0; step < steps; step++) {
      const value = phase(-1 + (2 * (step + 0.5)) / steps);
      assert.ok(value >= 0 && Number.isFinite(value));
      integral += value * ((4 * Math.PI) / steps);
    }
    close(integral, 1, 0.00001);
  }
  assert.ok(cornetteShanksPhase(1, 0.8) > cornetteShanksPhase(-1, 0.8));
  close(rayleighPhase(0.4), rayleighPhase(-0.4), 1e-15);
  for (const sign of [-1, 1]) {
    const sharpPeak = cornetteShanksPhase(sign, sign * 0.99);
    assert.ok(Number.isFinite(sharpPeak) && sharpPeak > 0);
  }
});
