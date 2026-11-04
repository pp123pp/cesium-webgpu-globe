// Independent CPU reference for the atmosphere display balance. Keep this
// test-only: never derive expected pixels from the production WGSL helper.
// Call on sceneColor * transmittance + in-scattering only. Direct celestial
// light is transported separately and must not be desaturated by this step.
export function balanceLongPathAtmosphere(radiance, transmittance) {
  const weights = [0.2126, 0.7152, 0.0722];
  const opacity = Math.min(
    1,
    Math.max(0, 1 - transmittance.reduce((sum, value, index) => sum + value * weights[index], 0)),
  );
  const t = Math.min(1, Math.max(0, (opacity - 0.25) / (0.75 - 0.25)));
  const grazingPath = t * t * (3 - 2 * t);
  const luminance = Math.max(0, radiance.reduce((sum, value, index) => sum + value * weights[index], 0));
  const desaturation = 0.58 * grazingPath;
  const attenuation = 1 - 0.18 * grazingPath;
  return radiance.map((value) => (value * (1 - desaturation) + luminance * desaturation) * attenuation);
}
