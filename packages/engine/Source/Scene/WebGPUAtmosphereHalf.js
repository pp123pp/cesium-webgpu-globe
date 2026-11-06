import { RuntimeError } from "@cesium/core";

// The LUTs contain nonnegative finite radiance/transmittance. Convert to IEEE
// binary16 with rounding, including subnormals, without an optional GPU feature
// or requiring the newer JavaScript Float16Array API.
export default function encodeHalf(values) {
  const result = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!(value >= 0) || !Number.isFinite(value) || value > 65504) {
      throw new RuntimeError(
        "Atmosphere LUT exceeds finite RGBA16Float range.",
      );
    }
    if (value < 2 ** -14) {
      result[i] = Math.round(value * 2 ** 24);
    } else {
      const exponent = Math.floor(Math.log2(value));
      result[i] =
        (exponent + 15) * 1024 + Math.round((value / 2 ** exponent - 1) * 1024);
    }
  }
  return result;
}
