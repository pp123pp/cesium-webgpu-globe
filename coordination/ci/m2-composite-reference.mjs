import {
  createAtmosphereParameters,
  generateAtmosphereLuts,
  sampleTransmittance,
} from "../../packages/engine/Source/Scene/WebGPUAtmosphereModel.js";
import { createPlanetParameters } from "../../packages/engine/Source/Scene/WebGPUPlanetMath.js";

// Independent CPU reference for the atmosphere display balance and terrain
// sunlight. Never derive expected pixels from production WGSL helper output.
const referenceAtmosphere = createAtmosphereParameters();
const referencePlanet = createPlanetParameters();
const referenceTransmittance = generateAtmosphereLuts(
  referenceAtmosphere,
  referencePlanet,
).transmittance;

// Apply only to sceneColor * viewTransmittance + in-scattering. Direct
// celestial light is transported separately and must not be desaturated here.
export function balanceLongPathAtmosphere(radiance, transmittance) {
  const weights = [0.2126, 0.7152, 0.0722];
  const opacity = Math.min(
    1,
    Math.max(0, 1 - transmittance.reduce((sum, value, index) => sum + value * weights[index], 0)),
  );
  const t = Math.min(1, Math.max(0, (opacity - 0.25) / (0.75 - 0.25)));
  const grazingPath = t * t * (3 - 2 * t);
  const luminance = Math.max(0, radiance.reduce((sum, value, index) => sum + value * weights[index], 0));
  const desaturation = 0.85 * grazingPath;
  const attenuation = 1 - 0.35 * grazingPath;
  return radiance.map((value) => (value * (1 - desaturation) + luminance * desaturation) * attenuation);
}

// CPU equivalent of the final terrain Lambert term. The atmosphere's direct
// Sun transmittance is sampled from an independently generated CPU LUT; when
// the atmosphere is disabled, the Sun path is intentionally unattenuated.
export function terrainSurfaceLighting(sunCosine, height, atmosphereEnabled = true, intensity = 10) {
  const cosine = Math.min(1, Math.max(0, sunCosine ?? 0));
  const transmittance = atmosphereEnabled && cosine > 0
    ? sampleTransmittance(referenceTransmittance, referencePlanet, height, cosine)
    : [1, 1, 1];
  return transmittance.map((value) => 0.025 + (intensity / 10) * cosine * value);
}
