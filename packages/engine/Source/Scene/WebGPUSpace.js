import { DeveloperError } from "@cesium/core";

function finiteRange(name, value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DeveloperError(`Space ${name} must be finite in [${minimum}, ${maximum}].`);
  }
}

/** Mutable WebGPU lunar controls. Distances are meters; intensity is normalized linear radiance. */
export function createMoonParameters(options = {}) {
  const parameters = {
    show: true,
    moonlightIntensity: 0.0025,
    ...options,
  };
  validateMoonParameters(parameters);
  return parameters;
}

export function validateMoonParameters(parameters) {
  if (typeof parameters.show !== "boolean") {
    throw new DeveloperError("Moon show must be boolean.");
  }
  finiteRange("moonlightIntensity", parameters.moonlightIntensity, 0, 0.1);
  return parameters;
}

/** Mutable procedural-star controls; intensity scales linear radiance. */
export function createStarParameters(options = {}) {
  const parameters = {
    show: true,
    intensity: 1,
    ...options,
  };
  validateStarParameters(parameters);
  return parameters;
}

export function validateStarParameters(parameters) {
  if (typeof parameters.show !== "boolean") {
    throw new DeveloperError("Stars show must be boolean.");
  }
  finiteRange("star intensity", parameters.intensity, 0, 4);
  return parameters;
}

export default { createMoonParameters, validateMoonParameters, createStarParameters, validateStarParameters };
