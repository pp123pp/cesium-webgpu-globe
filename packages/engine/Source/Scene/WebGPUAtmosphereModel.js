import { DeveloperError } from "@cesium/core";

// Original implementation of exponential participating-media transport, using
// Bruneton and Neyret's transmittance formulation and a reduced version of
// Hillaire's isotropic multiple-scattering closure (2020, section 5.5):
// https://ebruneton.github.io/precomputed_atmospheric_scattering/
// https://sebh.github.io/publications/egsr2020.pdf
// No external shader/source implementation is incorporated. This is an RGB,
// black-ground approximation, without ozone or spectral color conversion.
const inverseFourPi = 1 / (4 * Math.PI);
const transmittanceSteps = 128;
const scatteringSteps = 64;
const scatteringDirections = 32;
const maximumFeedback = 0.95;

function isFiniteFloat32(value) {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

/**
 * Creates independent mutable settings. Distances are meters; sea-level
 * scattering/extinction coefficients are inverse meters. Mie extinction includes
 * Mie absorption. Light intensity and scattering strength are runtime controls.
 * @param {object} [options] Overrides for the atmosphere settings.
 * @returns {object} Validated atmosphere settings.
 * @private
 */
export function createAtmosphereParameters(options = {}) {
  const {
    show = true,
    rayleighScattering = [5.802e-6, 13.558e-6, 33.1e-6],
    // Clear-sky aerosol calibration; retain mutable controls for hazier media.
    mieScattering = 1.998e-6,
    mieExtinction = 2.22e-6,
    rayleighScaleHeight = 8000,
    mieScaleHeight = 1200,
    mieAnisotropy = 0.65,
    lightIntensity = 10,
    multipleScatteringStrength = 1,
  } = options;
  const parameters = {
    show,
    rayleighScattering,
    mieScattering,
    mieExtinction,
    rayleighScaleHeight,
    mieScaleHeight,
    mieAnisotropy,
    lightIntensity,
    multipleScatteringStrength,
  };
  validateAtmosphereParameters(parameters);
  parameters.rayleighScattering = Array.from(rayleighScattering);
  return parameters;
}

/**
 * Rejects invalid energy, length or phase inputs, including mutable edits made
 * after settings creation. Inputs must fit finite GPU float32 values, and scale
 * heights must stay positive there. The supported domain bounds extinction at
 * 1/m, scale heights at [1, 1000000] m, intensity at [0, 1000000], and multiple
 * scattering strength at [0, 1]. Mie anisotropy is [-0.99, 0.99]; negative
 * anisotropy is valid back scattering. Unsupported values throw, never clamp.
 * @param {object} parameters Atmosphere settings.
 * @private
 */
export function validateAtmosphereParameters(parameters) {
  const rayleigh = parameters?.rayleighScattering;
  if (
    rayleigh?.length !== 3 ||
    !Array.from(rayleigh).every(
      (value) => isFiniteFloat32(value) && value >= 0 && value <= 1,
    )
  ) {
    throw new DeveloperError(
      "Rayleigh scattering coefficients must be finite float32 values from 0 to 1 per meter.",
    );
  }
  for (const name of [
    "mieScattering",
    "mieExtinction",
    "lightIntensity",
    "multipleScatteringStrength",
  ]) {
    if (!isFiniteFloat32(parameters[name]) || parameters[name] < 0) {
      throw new DeveloperError(`${name} must be finite nonnegative float32.`);
    }
  }
  if (
    parameters.mieExtinction < parameters.mieScattering ||
    parameters.mieExtinction > 1 ||
    !Array.from(rayleigh).every(
      (value) => value + parameters.mieExtinction <= 1,
    )
  ) {
    throw new DeveloperError(
      "Total extinction must be at least scattering and at most 1 per meter.",
    );
  }
  if (
    parameters.lightIntensity > 1e6 ||
    parameters.multipleScatteringStrength > 1
  ) {
    throw new DeveloperError(
      "Light intensity must not exceed 1000000 and multiple scattering strength must not exceed 1.",
    );
  }
  for (const name of ["rayleighScaleHeight", "mieScaleHeight"]) {
    if (
      !isFiniteFloat32(parameters[name]) ||
      parameters[name] < 1 ||
      parameters[name] > 1e6
    ) {
      throw new DeveloperError(
        `${name} must be finite float32 meters from 1 to 1000000.`,
      );
    }
  }
  const g = parameters.mieAnisotropy;
  if (!Number.isFinite(g) || Math.abs(g) > 0.99) {
    throw new DeveloperError("Mie anisotropy must be between -0.99 and 0.99.");
  }
  if (typeof parameters.show !== "boolean") {
    throw new DeveloperError("Atmosphere show must be a boolean.");
  }
}

function validatePlanet(planet) {
  const radius = planet?.maximumRadius;
  const height = planet?.atmosphereHeight;
  const top = radius + height;
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(top * top) ||
    top <= radius
  ) {
    throw new DeveloperError(
      "Atmosphere LUT radii and height must be finite positive meters.",
    );
  }
}

/**
 * Only medium and planet geometry affect these LUTs. The reduced isotropic
 * multiple-scattering approximation is deliberately independent of Mie g.
 * @param {object} parameters Atmosphere settings.
 * @param {object} planet Planet parameters from WebGPUPlanetMath.
 * @returns {string} Cache key, independent of camera, time and runtime controls.
 * @private
 */
export function atmosphereLutKey(parameters, planet) {
  validateAtmosphereParameters(parameters);
  validatePlanet(planet);
  return JSON.stringify([
    ...parameters.rayleighScattering,
    parameters.mieScattering,
    parameters.mieExtinction,
    parameters.rayleighScaleHeight,
    parameters.mieScaleHeight,
    planet.maximumRadius,
    planet.atmosphereHeight,
    planet.atmosphereRadius,
    planet.radii?.x,
    planet.radii?.y,
    planet.radii?.z,
  ]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function horizonCosine(radius, height) {
  return -Math.sqrt(height * (2 * radius + height)) / (radius + height);
}

function distanceToTop(radius, atmosphereHeight, height, cosine) {
  const b = (radius + height) * cosine;
  const c =
    (atmosphereHeight - height) * (2 * radius + atmosphereHeight + height);
  const root = Math.sqrt(b * b + c);
  // The quotient avoids cancellation close to the outer surface. At the exact
  // top, outward/tangent rays have no atmospheric segment.
  return b >= 0 ? (c === 0 ? 0 : c / (root + b)) : root - b;
}

function distanceToBoundary(radius, atmosphereHeight, height, cosine) {
  if (cosine < horizonCosine(radius, height)) {
    const b = (radius + height) * cosine;
    const c = height * (2 * radius + height);
    return c / (-b + Math.sqrt(Math.max(0, b * b - c)));
  }
  return distanceToTop(radius, atmosphereHeight, height, cosine);
}

function heightAlongRay(radius, height, cosine, distance) {
  const difference =
    height * (2 * radius + height) +
    distance * (2 * (radius + height) * cosine + distance);
  // Compute sqrt(R^2 + difference) - R without Earth-sized subtraction.
  return Math.max(
    0,
    difference / (Math.sqrt(radius * radius + difference) + radius),
  );
}

function integrateTransmittanceUnchecked(
  parameters,
  planet,
  height,
  cosine,
  distance,
  sampleCount,
  result,
) {
  const stepLength = distance / sampleCount;
  let rayleighColumn = 0;
  let mieColumn = 0;
  for (let step = 0; step < sampleCount; step++) {
    const sampleHeight = heightAlongRay(
      planet.maximumRadius,
      height,
      cosine,
      (step + 0.5) * stepLength,
    );
    rayleighColumn +=
      Math.exp(-sampleHeight / parameters.rayleighScaleHeight) * stepLength;
    mieColumn +=
      Math.exp(-sampleHeight / parameters.mieScaleHeight) * stepLength;
  }
  for (let channel = 0; channel < 3; channel++) {
    result[channel] = Math.exp(
      -parameters.rayleighScattering[channel] * rayleighColumn -
        parameters.mieExtinction * mieColumn,
    );
  }
  return result;
}

/**
 * Double-precision Beer-Lambert integration of an unobstructed segment inside
 * the atmosphere. The caller supplies a ground/top-clipped length in meters.
 * The optional resolution supports independent convergence checks.
 * @param {object} parameters Atmosphere settings.
 * @param {object} planet Planet parameters.
 * @param {number} height Starting height over the local reference sphere, meters.
 * @param {number} cosine Ray direction dotted with starting radial up.
 * @param {number} distance Unobstructed segment length in meters.
 * @param {number} [sampleCount=128] Midpoint integration samples.
 * @returns {number[]} RGB transmittance, including unity for an empty segment.
 * @private
 */
export function integrateTransmittance(
  parameters,
  planet,
  height,
  cosine,
  distance,
  sampleCount = transmittanceSteps,
) {
  validateAtmosphereParameters(parameters);
  validatePlanet(planet);
  if (
    !Number.isFinite(height) ||
    height < 0 ||
    height > planet.atmosphereHeight ||
    !Number.isFinite(cosine) ||
    Math.abs(cosine) > 1 ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 1
  ) {
    throw new DeveloperError(
      "Atmosphere integration requires a finite valid segment.",
    );
  }
  return integrateTransmittanceUnchecked(
    parameters,
    planet,
    height,
    cosine,
    distance,
    sampleCount,
    [1, 1, 1],
  );
}

function sampleBilinear(lut, u, v, result) {
  const x = clamp(u, 0, 1) * (lut.width - 1);
  const y = clamp(v, 0, 1) * (lut.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, lut.width - 1);
  const y1 = Math.min(y0 + 1, lut.height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const first = 4 * (y0 * lut.width + x0);
  const second = 4 * (y0 * lut.width + x1);
  const third = 4 * (y1 * lut.width + x0);
  const fourth = 4 * (y1 * lut.width + x1);
  for (let channel = 0; channel < 3; channel++) {
    const lower =
      lut.data[first + channel] * (1 - tx) + lut.data[second + channel] * tx;
    const upper =
      lut.data[third + channel] * (1 - tx) + lut.data[fourth + channel] * tx;
    result[channel] = lower * (1 - ty) + upper * ty;
  }
  return result;
}

/**
 * Manual bilinear sample using endpoint coordinates, with an exact spherical
 * ground-shadow test before filtering. h=H*v^2 and mu=muH+(1-muH)*u^2.
 * @param {object} lut Transmittance LUT.
 * @param {object} planet Planet parameters.
 * @param {number} height Height over the local reference sphere, meters.
 * @param {number} cosine Local ray or Sun zenith cosine.
 * @param {number[]} [result] Receives RGB transmittance.
 * @returns {number[]} RGB transmittance, zero when the ground blocks the ray.
 * @private
 */
export function sampleTransmittance(
  lut,
  planet,
  height,
  cosine,
  result = [0, 0, 0],
) {
  const h = clamp(height, 0, planet.atmosphereHeight);
  const horizon = horizonCosine(planet.maximumRadius, h);
  if (cosine < horizon) {
    result[0] = result[1] = result[2] = 0;
    return result;
  }
  const u = Math.sqrt(clamp((cosine - horizon) / (1 - horizon), 0, 1));
  const v = Math.sqrt(h / planet.atmosphereHeight);
  return sampleBilinear(lut, u, v, result);
}

/**
 * Samples isotropic multiple-scattering radiance per unit solar irradiance.
 * Unlike direct Sun transmittance, this value may be nonzero during twilight.
 * @param {object} lut Multiple-scattering LUT.
 * @param {object} planet Planet parameters.
 * @param {number} height Height over the local reference sphere, meters.
 * @param {number} sunCosine Local radial up dotted with the direction to the Sun.
 * @param {number[]} [result] Receives RGB radiance per unit solar irradiance.
 * @returns {number[]} Sampled isotropic radiance.
 * @private
 */
export function sampleMultipleScattering(
  lut,
  planet,
  height,
  sunCosine,
  result = [0, 0, 0],
) {
  return sampleBilinear(
    lut,
    0.5 * (sunCosine + 1),
    Math.sqrt(clamp(height / planet.atmosphereHeight, 0, 1)),
    result,
  );
}

/**
 * Normalized Rayleigh phase per steradian.
 * @param {number} cosine View-ray direction dotted with direction to the Sun.
 * @returns {number} Phase density.
 * @private
 */
export function rayleighPhase(cosine) {
  const mu = clamp(cosine, -1, 1);
  return (3 / (16 * Math.PI)) * (1 + mu * mu);
}

/**
 * Normalized Cornette-Shanks Mie phase per steradian. Positive g peaks when the
 * camera looks toward the Sun (positive view-ray/Sun dot product).
 * @param {number} cosine View-ray direction dotted with direction to the Sun.
 * @param {number} anisotropy Mie anisotropy in [-0.99, 0.99].
 * @returns {number} Phase density.
 * @private
 */
export function cornetteShanksPhase(cosine, anisotropy) {
  const mu = clamp(cosine, -1, 1);
  const g = Math.abs(anisotropy);
  const g2 = g * g;
  // Equivalent to 1+g^2-2*g*mu, without cancellation near the phase peak.
  const alignedCosine = anisotropy >= 0 ? mu : -mu;
  const angularDistance = (1 - g) * (1 - g) + 2 * g * (1 - alignedCosine);
  return (
    ((3 / (8 * Math.PI)) * (1 - g) * (1 + g) * (1 + mu * mu)) /
    ((2 + g2) * Math.pow(angularDistance, 1.5))
  );
}

function createLut(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

function buildTransmittance(parameters, planet) {
  const lut = createLut(256, 64);
  const rgb = [0, 0, 0];
  for (let y = 0; y < lut.height; y++) {
    const h = planet.atmosphereHeight * Math.pow(y / (lut.height - 1), 2);
    const horizon = horizonCosine(planet.maximumRadius, h);
    for (let x = 0; x < lut.width; x++) {
      const u = x / (lut.width - 1);
      const mu = horizon + (1 - horizon) * u * u;
      integrateTransmittanceUnchecked(
        parameters,
        planet,
        h,
        mu,
        distanceToTop(planet.maximumRadius, planet.atmosphereHeight, h, mu),
        transmittanceSteps,
        rgb,
      );
      const offset = 4 * (y * lut.width + x);
      lut.data.set(rgb, offset);
      lut.data[offset + 3] = 1;
    }
  }
  return lut;
}

function buildScatteringRow(parameters, planet, height, samples) {
  const feedback = [0, 0, 0];
  const radius = planet.maximumRadius;
  const startingRadius = radius + height;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let count = 0;
  for (let direction = 0; direction < scatteringDirections; direction++) {
    // Equal-solid-angle Fibonacci directions; the radial cosine is uniformly
    // distributed. The Sun lies in the x/z plane, so only dx and dz are needed.
    const mu = 1 - (2 * (direction + 0.5)) / scatteringDirections;
    const dx = Math.sqrt(1 - mu * mu) * Math.cos(goldenAngle * direction);
    const distance = distanceToBoundary(
      radius,
      planet.atmosphereHeight,
      height,
      mu,
    );
    if (distance === 0) {
      continue;
    }
    const stepLength = distance / scatteringSteps;
    const transmission = [1, 1, 1];
    for (let step = 0; step < scatteringSteps; step++) {
      const t = (step + 0.5) * stepLength;
      const sampleHeight = heightAlongRay(radius, height, mu, t);
      const rayleighDensity = Math.exp(
        -sampleHeight / parameters.rayleighScaleHeight,
      );
      const mieDensity = Math.exp(-sampleHeight / parameters.mieScaleHeight);
      const offset = 6 * count++;
      samples[offset] = sampleHeight;
      samples[offset + 1] = (dx * t) / (radius + sampleHeight);
      samples[offset + 2] = (startingRadius + mu * t) / (radius + sampleHeight);
      for (let channel = 0; channel < 3; channel++) {
        const rayleigh =
          parameters.rayleighScattering[channel] * rayleighDensity;
        const extinction = rayleigh + parameters.mieExtinction * mieDensity;
        const scattering = rayleigh + parameters.mieScattering * mieDensity;
        const opticalDepth = extinction * stepLength;
        // Exact homogeneous-segment transport with midpoint coefficients keeps
        // f <= 1, even for large optical depths; expm1 also handles thin segments.
        const kernel =
          extinction > 0 ? -Math.expm1(-opticalDepth) / extinction : stepLength;
        const weight =
          (transmission[channel] * scattering * kernel) / scatteringDirections;
        samples[offset + 3 + channel] = weight;
        feedback[channel] += weight;
        transmission[channel] *= Math.exp(-opticalDepth);
      }
    }
  }
  return { count, feedback };
}

/**
 * Builds CPU-double transport integrals and returns two RGBA Float32Array LUTs
 * for upload as rgba16float. Texel coordinates include both domain endpoints;
 * alpha is one. Density is exponential above a sphere of maximumRadius, using
 * atmosphereHeight as its outer height. The view integration separately uses
 * the real ellipsoid and measured scene depth.
 *
 * For every multiple-scattering texel, J1 is the mean ray-integrated isotropic
 * single-scattering radiance, and f is the mean integral of T*sigma_s. The LUT
 * stores J1/(1-min(f,0.95)) per RGB channel, with no ground bounce. The one 1/4pi
 * factor belongs to the isotropic direct source; the directional mean already
 * integrates the receiving isotropic phase. Clamping f bounds amplification at
 * 20; this is not an optically thick or full higher-order transport solution.
 * @param {object} parameters Atmosphere settings.
 * @param {object} planet Planet parameters.
 * @returns {object} Transmittance and multiple-scattering LUTs, and maximum raw feedback.
 * @private
 */
export function generateAtmosphereLuts(parameters, planet) {
  validateAtmosphereParameters(parameters);
  validatePlanet(planet);
  const transmittance = buildTransmittance(parameters, planet);
  const multipleScattering = createLut(32, 32);
  // Transport along each direction is independent of solar zenith. Reuse one
  // altitude row of double-precision samples instead of repeating those paths.
  const samples = new Float64Array(scatteringDirections * scatteringSteps * 6);
  const sunlight = [0, 0, 0];
  let maxFeedback = 0;
  for (let y = 0; y < multipleScattering.height; y++) {
    const height =
      planet.atmosphereHeight *
      Math.pow(y / (multipleScattering.height - 1), 2);
    const row = buildScatteringRow(parameters, planet, height, samples);
    const denominator = [1, 1, 1];
    for (let channel = 0; channel < 3; channel++) {
      const feedback = row.feedback[channel];
      maxFeedback = Math.max(maxFeedback, feedback);
      denominator[channel] = 1 - Math.min(feedback, maximumFeedback);
    }
    for (let x = 0; x < multipleScattering.width; x++) {
      const sunCosine = (2 * x) / (multipleScattering.width - 1) - 1;
      const sunX = Math.sqrt(Math.max(0, 1 - sunCosine * sunCosine));
      const radiance = [0, 0, 0];
      for (let sample = 0; sample < row.count; sample++) {
        const offset = 6 * sample;
        const sampleSunCosine =
          samples[offset + 1] * sunX + samples[offset + 2] * sunCosine;
        sampleTransmittance(
          transmittance,
          planet,
          samples[offset],
          sampleSunCosine,
          sunlight,
        );
        for (let channel = 0; channel < 3; channel++) {
          radiance[channel] +=
            samples[offset + 3 + channel] * sunlight[channel] * inverseFourPi;
        }
      }
      const offset = 4 * (y * multipleScattering.width + x);
      for (let channel = 0; channel < 3; channel++) {
        multipleScattering.data[offset + channel] =
          radiance[channel] / denominator[channel];
      }
      multipleScattering.data[offset + 3] = 1;
    }
  }
  return { transmittance, multipleScattering, maxFeedback };
}

// Cesium's generated module index consumes a default export for source modules.
const WebGPUAtmosphereModel = {
  createAtmosphereParameters,
  validateAtmosphereParameters,
  atmosphereLutKey,
  generateAtmosphereLuts,
  integrateTransmittance,
  sampleTransmittance,
  sampleMultipleScattering,
  rayleighPhase,
  cornetteShanksPhase,
};

export default WebGPUAtmosphereModel;
