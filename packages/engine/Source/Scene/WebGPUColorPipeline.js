import { DeveloperError } from "@cesium/core";

export const DEFAULT_EXPOSURE = 1.0;
export const MIN_EXPOSURE = 0.01;
export const MAX_EXPOSURE = 16.0;

export function validateExposure(exposure) {
  if (
    !Number.isFinite(exposure) ||
    exposure < MIN_EXPOSURE ||
    exposure > MAX_EXPOSURE
  ) {
    throw new DeveloperError(
      `WebGPU exposure must be finite in [${MIN_EXPOSURE}, ${MAX_EXPOSURE}].`,
    );
  }
  return exposure;
}

export function decodeSrgbChannel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function encodeSrgbChannel(value) {
  const linear = Math.max(value, 0);
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** Narkowicz fitted ACES curve, applied after scene-referred exposure. */
export function toneMapACESChannel(value, exposure = DEFAULT_EXPOSURE) {
  validateExposure(exposure);
  const x = Math.max(0, value) * exposure;
  return Math.min(
    1,
    Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)),
  );
}

export default {
  DEFAULT_EXPOSURE,
  MIN_EXPOSURE,
  MAX_EXPOSURE,
  validateExposure,
  decodeSrgbChannel,
  encodeSrgbChannel,
  toneMapACESChannel,
};
