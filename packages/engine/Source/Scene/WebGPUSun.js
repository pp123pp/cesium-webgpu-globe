import { DeveloperError } from "@cesium/core";

// Mean apparent semidiameter at 1 AU, approximately 0.2664 degrees.
const angularRadius = 0.00465;
const displayScale = (Math.PI * Math.sin(angularRadius) ** 2) / 10;

/**
 * WebGPU-only Sun settings. Angles are radians. displayScale is a Sun-only
 * radiance-to-LDR scale in steradians, not a scene exposure. Irradiance remains
 * the single scene.atmosphere.lightIntensity value (normalized units, not lux).
 * @param {object} [options] Mutable setting overrides.
 * @returns {object} Validated independent settings.
 * @private
 */
export function createSunParameters(options = {}) {
  const parameters = {
    show: true,
    angularRadius,
    displayScale,
    glowStrength: 0.025,
    glowRadius: 0.025,
    ...options,
  };
  sunDisplayRadiance(parameters, 10);
  return parameters;
}

/**
 * Uniform disk E = integral(L cos(theta) dOmega) = pi L sin(alpha)^2.
 * Reject malformed mutable edits before writing uniforms. No photometric
 * calibration, seasonal angular-size variation or global tone mapper is used.
 * @param {object} parameters Sun settings.
 * @param {number} irradiance Shared normalized solar irradiance.
 * @returns {number} Sun-only display-scaled linear radiance.
 * @private
 */
export function sunDisplayRadiance(parameters, irradiance) {
  for (const [name, minimum, maximum] of [
    ["angularRadius", 1e-5, 0.05],
    ["displayScale", 0, 1],
    ["glowStrength", 0, 0.25],
    ["glowRadius", 1e-5, 0.1],
  ]) {
    const value = parameters[name];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new DeveloperError(
        `Sun ${name} must be finite in [${minimum}, ${maximum}].`,
      );
    }
  }
  if (parameters.glowRadius < parameters.angularRadius) {
    throw new DeveloperError("Sun glowRadius must include its angularRadius.");
  }
  if (!Number.isFinite(irradiance) || irradiance < 0 || irradiance > 1e6) {
    throw new DeveloperError("Sun irradiance must be finite in [0, 1000000].");
  }
  return (
    (irradiance * parameters.displayScale) /
    (Math.PI * Math.sin(parameters.angularRadius) ** 2)
  );
}

export default { createSunParameters, sunDisplayRadiance };
