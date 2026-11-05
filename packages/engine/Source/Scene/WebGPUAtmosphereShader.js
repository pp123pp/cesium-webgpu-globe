import WebGPUPlanetShader from "./WebGPUPlanetShader.js";
import WebGPUSunShader from "./WebGPUSunShader.js";

/**
 * Meter-based radiative transfer and M2.6 scene-linear HDR solar composition.
 * Atmosphere, Sun, Moon, stars and solar artwork remain linear until ACES/sRGB output.
 * The completed terrain attachment is RGBA16Float; only this final pass writes
 * the display-referred canvas format.
 * @private
 */
function createAtmosphereShader(cloudShadowShader) {
  return `${WebGPUPlanetShader}
struct AtmosphereParameters {
  rayleigh: vec4f, // scattering/extinction RGB in 1/m, scale height in m
  mie: vec4f,      // scattering, extinction in 1/m, scale height in m, g
  light: vec4f,    // normalized solar irradiance, MS strength, LUT radius/height m
  viewport: vec4f, // width, height, atmosphere enabled, Sun enabled
  sun: vec4f,      // angular radius rad, displayed L, glare strength/radius rad
  exposure: vec4f, // exposure, surface-lighting enabled, normalized irradiance, tint
  solarEffects: vec4f, // rays, soft halo, wide halo and corona controls
}
@group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
@group(0) @binding(1) var<uniform> atmosphere: AtmosphereParameters;
@group(0) @binding(2) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var multipleScatteringLut: texture_2d<f32>;
@group(0) @binding(4) var atmosphereSampler: sampler;
@group(0) @binding(5) var sceneColor: texture_2d<f32>;
@group(0) @binding(6) var sceneDepth: texture_depth_2d;
@group(0) @binding(7) var solarRaysPrimary: texture_2d<f32>;
@group(0) @binding(8) var solarRaysFine: texture_2d<f32>;
@group(0) @binding(9) var solarRaysBroad: texture_2d<f32>;
@group(0) @binding(10) var solarSoftHalo: texture_2d<f32>;
@group(0) @binding(11) var solarWideHalo: texture_2d<f32>;
@group(0) @binding(12) var solarCorona: texture_2d<f32>;
@group(0) @binding(13) var solarCoronaMid: texture_2d<f32>;
@group(0) @binding(14) var solarNoise: texture_2d<f32>;
@group(0) @binding(15) var solarGlowGradient: texture_2d<f32>;
@group(0) @binding(16) var solarSampler: sampler;

${WebGPUSunShader}


fn spaceHash(p: vec3f) -> f32 {
  // Cell coordinates are integral. Integer mixing keeps rare star selection
  // independent of backend-specific sine approximations and float rounding.
  let cell = bitcast<vec3u>(vec3i(p));
  var hash = (cell.x * 1597334677u) ^ (cell.y * 3812015801u) ^ (cell.z * 2798796415u);
  hash = (hash ^ (hash >> 16u)) * 2146121005u;
  hash = (hash ^ (hash >> 15u)) * 2221713035u;
  hash = hash ^ (hash >> 16u);
  return f32(hash >> 8u) * (1.0 / 16777216.0);
}

// Star positions are indexed only by the world-space ray, never camera position.
fn starRadiance(direction: vec3f, pixelWidth: f32) -> vec3f {
  if (planet.moon.z <= 0.0) { return vec3f(0.0); }
  let observer = normalize((planet.cameraHigh.xyz + planet.cameraLow.xyz) * planet.inverseRadii.xyz);
  let earth = webgpuRayEllipsoid(direction, planet);
  if (earth.x >= 0.0 && earth.y > earth.x) { return vec3f(0.0); }
  let solarElevation = dot(observer, planet.sunDirectionWC.xyz);
  let night = 1.0 - smoothstep(-0.08, 0.035, solarElevation);
  let grid = normalize(vec3f(dot(planet.starRotation0.xyz, direction), dot(planet.starRotation1.xyz, direction), dot(planet.starRotation2.xyz, direction))) * 1800.0;
  let cell = floor(grid);
  let seed = spaceHash(cell);
  if (seed < 0.9965) { return vec3f(0.0); }
  let offset = vec3f(spaceHash(cell + vec3f(17.0, 3.0, 11.0)),
                    spaceHash(cell + vec3f(5.0, 29.0, 7.0)),
                    spaceHash(cell + vec3f(13.0, 19.0, 31.0)));
  let radius = length(fract(grid) - offset);
  let point = 1.0 - smoothstep(0.006, 0.035 + pixelWidth * 900.0, radius);
  let brightness = mix(0.12, 0.85, spaceHash(cell + vec3f(41.0)));
  let tint = mix(vec3f(0.72, 0.82, 1.0), vec3f(1.0, 0.88, 0.70),
                 spaceHash(cell + vec3f(71.0)));
  return tint * point * brightness * night * planet.moon.z;
}

fn moonRadiance(direction: vec3f, pixel: vec2i, pixelWidth: f32) -> vec3f {
  if (planet.moon.x <= 0.0 || planet.moonDirectionWC.w <= 0.0 ||
      textureLoad(sceneDepth, pixel, 0) != 0.0) { return vec3f(0.0); }
  let moonDirection = planet.moonDirectionWC.xyz;
  let chord = length(direction - moonDirection);
  let radius = 2.0 * sin(0.5 * planet.moonDirectionWC.w);
  let halfWidth = max(pixelWidth * 0.5, 1.0e-7);
  if (chord > radius + halfWidth) { return vec3f(0.0); }
  let earth = webgpuRayEllipsoid(direction, planet);
  if (earth.x >= 0.0 && earth.y > earth.x) { return vec3f(0.0); }
  let cosine = clamp(dot(direction, moonDirection), -1.0, 1.0);
  let tangent = direction - moonDirection * cosine;
  let radial = clamp(chord / max(radius, 1.0e-7), 0.0, 1.0);
  var tangentDirection = vec3f(1.0, 0.0, 0.0);
  if (length(tangent) > 1.0e-7) { tangentDirection = normalize(tangent); }
  let surfaceNormal = normalize(-moonDirection * sqrt(max(0.0, 1.0 - radial * radial)) +
                                tangentDirection * radial);
  let phase = max(dot(surfaceNormal, planet.sunDirectionWC.xyz), 0.0);
  let coverage = 1.0 - smoothstep(radius - halfWidth, radius + halfWidth, chord);
  return vec3f(0.72, 0.76, 0.84) * (0.16 * phase * coverage);
}

fn moonTerrainLight(direction: vec3f, sceneDistance: f32) -> vec3f {
  if (sceneDistance < 0.0 || planet.moon.x <= 0.0) { return vec3f(0.0); }
  let inverseRadii = planet.inverseRadii.xyz;
  let scaledPosition = planet.cameraHigh.xyz * inverseRadii +
                       planet.cameraLow.xyz * inverseRadii +
                       direction * sceneDistance * inverseRadii;
  let normal = normalize(scaledPosition * inverseRadii);
  let sunElevation = dot(normal, planet.sunDirectionWC.xyz);
  let moonElevation = max(dot(normal, planet.moonDirectionWC.xyz), 0.0);
  let night = 1.0 - smoothstep(-0.015, 0.04, sunElevation);
  return vec3f(planet.moon.w * moonElevation * night * planet.moon.x);
}

fn atmosphereRayleighPhase(cosine: f32) -> f32 {
  let mu = clamp(cosine, -1.0, 1.0);
  return 0.05968310365946075 * (1.0 + mu * mu); // 3/(16 pi)
}

fn atmosphereMiePhase(cosine: f32) -> f32 {
  let mu = clamp(cosine, -1.0, 1.0);
  let g = atmosphere.mie.w;
  let g2 = g * g;
  let d = select((1.0 + g) * (1.0 + g) - 2.0 * g * (1.0 + mu),
                 (1.0 - g) * (1.0 - g) + 2.0 * g * (1.0 - mu), g >= 0.0);
  return 0.1193662073189215 * (1.0 - g2) * (1.0 + mu * mu) /
    ((2.0 + g2) * d * sqrt(d)); // normalized Cornette-Shanks
}

fn atmosphereLutUv(uv: vec2f, size: vec2u) -> vec2f {
  let dimensions = vec2f(size);
  return (clamp(uv, vec2f(0.0), vec2f(1.0)) * (dimensions - 1.0) + 0.5) / dimensions;
}

fn atmosphereSunTransmittance(height: f32, mu: f32) -> vec3f {
  let h = clamp(height, 0.0, atmosphere.light.w);
  let r = atmosphere.light.z + h;
  let horizon = -sqrt(h * (2.0 * atmosphere.light.z + h)) / r;
  // Actual WGS84 visibility is tested before this lookup. Its directional
  // curvature differs slightly from the LUT reference sphere: clamp visible
  // rays to the reference horizon rather than inventing a spherical shadow.
  let u = sqrt(clamp((mu - horizon) / (1.0 - horizon), 0.0, 1.0));
  let v = sqrt(h / atmosphere.light.w);
  return textureSampleLevel(transmittanceLut, atmosphereSampler,
    atmosphereLutUv(vec2f(u, v), textureDimensions(transmittanceLut)), 0.0).rgb;
}

fn atmosphereMultipleScattering(height: f32, mu: f32) -> vec3f {
  let uv = vec2f(mu * 0.5 + 0.5, sqrt(clamp(height / atmosphere.light.w, 0.0, 1.0)));
  return textureSampleLevel(multipleScatteringLut, atmosphereSampler,
    atmosphereLutUv(uv, textureDimensions(multipleScatteringLut)), 0.0).rgb;
}

// The minimum-altitude point can be at either endpoint or inside a limb ray.
// Concentrating samples there resolves the 1200 m Mie layer with a small march.
fn atmosphereSampleDistance(index: f32, closest: f32, distanceLimit: f32) -> f32 {
  let u = index / 32.0;
  if (closest <= distanceLimit * 0.001) { return distanceLimit * u * u; }
  if (closest >= distanceLimit * 0.999) { return distanceLimit * (1.0 - (1.0 - u) * (1.0 - u)); }
  if (u < 0.5) {
    let q = 1.0 - 2.0 * u;
    return closest * (1.0 - q * q);
  }
  let q = 2.0 * u - 1.0;
  return closest + (distanceLimit - closest) * q * q;
}

struct AtmosphereResult {
  radiance: vec3f,
  transmittance: vec3f,
}

fn atmosphereIntegrate(direction: vec3f, sceneDistance: f32) -> AtmosphereResult {
  var result = AtmosphereResult(vec3f(0.0), vec3f(1.0));
  let segment = webgpuAtmosphereSegment(direction, sceneDistance, planet);
  if (segment.x < 0.0) { return result; }
  // Rebase space rays at entry. fma avoids rounding the large multiplication
  // before cancellation; split camera components are never first collapsed.
  let anchor = fma(direction, vec3f(segment.x), planet.cameraHigh.xyz) + planet.cameraLow.xyz;
  let q = anchor * planet.inverseRadii.xyz;
  let w = direction * planet.inverseRadii.xyz;
  var anchorC = dot(q, q) - 1.0;
  if (segment.x == 0.0) { anchorC = planet.surface.x; }
  let segmentLength = segment.y - segment.x;
  let closest = clamp(-dot(q, w) / dot(w, w), 0.0, segmentLength);
  let sun = planet.sunDirectionWC.xyz;
  let sunScaled = sun * planet.inverseRadii.xyz;
  let phaseCosine = dot(direction, sun); // forward scattering is toward the Sun
  let phaseRayleigh = atmosphereRayleighPhase(phaseCosine);
  let phaseMie = atmosphereMiePhase(phaseCosine);
  var previous = 0.0;
  for (var i = 0u; i < 32u; i++) {
    let next = atmosphereSampleDistance(f32(i + 1u), closest, segmentLength);
    let distance = 0.5 * (previous + next);
    let step = next - previous;
    previous = next;
    let offsetScaled = w * distance;
    let sampleC = anchorC + 2.0 * dot(q, offsetScaled) + dot(offsetScaled, offsetScaled);
    let sampleQ = sqrt(max(1.0 + sampleC, 1.0e-12));
    let position = fma(direction, vec3f(distance), anchor);
    // Radial distance above the true ellipsoid, not length(position)-a.
    // The implicit-surface expansion preserves near-camera centimeter heights.
    let height = max(0.0, length(position) * sampleC / (sampleQ * (sampleQ + 1.0)));
    if (height >= atmosphere.light.w) { continue; }
    let density = exp(-height / vec2f(atmosphere.rayleigh.w, atmosphere.mie.z));
    let rayleigh = atmosphere.rayleigh.xyz * density.x;
    let mie = atmosphere.mie.x * density.y;
    let scattering = rayleigh + vec3f(mie);
    let extinction = rayleigh + vec3f(atmosphere.mie.y * density.y);
    let tau = extinction * step;
    let segmentT = exp(-tau);
    // Avoid 0/0 and cancellation at zero/tiny optical thickness. This evaluates
    // step*(1-exp(-tau))/tau, the exact constant-source segment integral.
    let phi = select((1.0 - segmentT) / max(tau, vec3f(1.0e-20)),
      1.0 - 0.5 * tau + tau * tau / 6.0, tau < vec3f(0.001));
    let scaledPosition = q + offsetScaled;
    let normal = normalize(scaledPosition * planet.inverseRadii.xyz);
    let muSun = clamp(dot(normal, sun), -1.0, 1.0);
    let b = dot(scaledPosition, sunScaled);
    let rounding = 4.76837158203125e-7 * dot(abs(scaledPosition * sunScaled), vec3f(1.0));
    let earth = webgpuForwardInterval(dot(sunScaled, sunScaled), b, sampleC, rounding);
    var direct = vec3f(0.0);
    if (!(earth.x >= 0.0 && earth.y > earth.x)) {
      direct = atmosphereSunTransmittance(height, muSun);
    }
    let multiple = atmosphereMultipleScattering(height, muSun) * atmosphere.light.y;
    var moonScattering = vec3f(0.0);
    if (planet.moon.x > 0.0 && planet.moon.w > 0.0) {
      let moonDirection = planet.moonDirectionWC.xyz;
      let moonMu = max(dot(normal, moonDirection), 0.0);
      let moonScaled = moonDirection * planet.inverseRadii.xyz;
      let moonB = dot(scaledPosition, moonScaled);
      let moonRound = 4.76837158203125e-7 * dot(abs(scaledPosition * moonScaled), vec3f(1.0));
      let moonEarth = webgpuForwardInterval(dot(moonScaled, moonScaled), moonB, sampleC, moonRound);
      var moonDirect = 0.0;
      if (!(moonEarth.x >= 0.0 && moonEarth.y > moonEarth.x)) {
        moonDirect = planet.moon.w * moonMu * planet.moon.x;
      }
      let moonPhaseRayleigh = atmosphereRayleighPhase(dot(direction, moonDirection));
      let moonPhaseMie = atmosphereMiePhase(dot(direction, moonDirection));
      moonScattering = moonDirect * (rayleigh * moonPhaseRayleigh + vec3f(mie * moonPhaseMie));
    }
    let source = atmosphere.light.x * (direct * (rayleigh * phaseRayleigh + vec3f(mie * phaseMie)) +
      scattering * multiple + moonScattering);
    result.radiance += result.transmittance * source * step * phi;
    result.transmittance *= segmentT;
  }
  return result;
}

// The WebGPU terrain pass supplies linear albedo but intentionally has no
// camera-local lighting. Reconstruct the ellipsoid surface normal from the
// completed depth so the final compositor applies the same geodetic Lambert
// day/night split used by Cesium's GlobeFS and Bruneton's ground irradiance.
// The small ambient floor is an artistic fill, NOT a physical earthshine model.
fn atmosphereTerrainGeometry(direction: vec3f, sceneDistance: f32) -> vec4f {
  if (sceneDistance < 0.0) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let inverseRadii = planet.inverseRadii.xyz;
  // Keep the high/low camera split until the local ray offset is added.
  let localOffset = planet.cameraLow.xyz + direction * sceneDistance;
  let scaledPosition = planet.cameraHigh.xyz * inverseRadii + localOffset * inverseRadii;
  let scaledRadius = max(length(scaledPosition), 1.0e-7);
  let normal = normalize(scaledPosition * inverseRadii);
  let radialDirection = scaledPosition / scaledRadius;
  let heightScale = max(dot(radialDirection, normal * inverseRadii), 1.0e-7);
  let height = max((scaledRadius - 1.0) / heightScale, 0.0);
  return vec4f(normal, height);
}

${cloudShadowShader ?? ""}
fn terrainSurfaceLight(direction: vec3f, sceneDistance: f32, normal: vec3f, sunCosine: f32, directTransmittance: vec3f) -> vec3f {
  // Lambert irradiance is continuous at the terminator. Normalize the existing
  // scene irradiance convention (10 at default daylight), not the visible disk.
  var ambient = 0.025;
  var direct = atmosphere.exposure.z * sunCosine * directTransmittance;
  ${
    cloudShadowShader
      ? `
  if (sunCosine > 0.0) {
    // Completed mesh depth includes terrain height and tile skirts in world space.
    let receiver = planet.cameraHigh.xyz + fma(direction, vec3f(sceneDistance), planet.cameraLow.xyz);
    direct *= cloudShadowTransmission(receiver, planet.sunDirectionWC.xyz, 12u);
    if (clouds.ambientShadows > 0.0) {
      // Overhead cloud opacity approximates obscured skylight. Preserve fill from
      // the rest of the hemisphere and fade the daylight response at twilight.
      let sky = cloudShadowTransmission(receiver, normal, 8u);
      ambient *= 1.0 - 0.6 * (1.0 - sky) * smoothstep(0.0, 0.15, sunCosine);
    }
  }`
      : ""
  }
  return vec3f(ambient) + direct;
}

fn atmosphereTerrainLighting(direction: vec3f, sceneDistance: f32) -> vec3f {
  if (atmosphere.exposure.y == 0.0) { return vec3f(1.0); }
  let surface = atmosphereTerrainGeometry(direction, sceneDistance);
  if (surface.w < 0.0) { return vec3f(1.0); }
  let sunCosine = max(dot(surface.xyz, planet.sunDirectionWC.xyz), 0.0);
  var directTransmittance = vec3f(1.0);
  if (sunCosine > 0.0) {
    directTransmittance = atmosphereSunTransmittance(surface.w, sunCosine);
  }
  return terrainSurfaceLight(direction, sceneDistance, surface.xyz, sunCosine, directTransmittance);
}

// The atmosphere-disabled entry point deliberately avoids the transmittance
// LUT binding, preserving the cold Sun-only pipeline before LUT allocation.
fn sunOnlyTerrainLighting(direction: vec3f, sceneDistance: f32) -> vec3f {
  if (atmosphere.exposure.y == 0.0) { return vec3f(1.0); }
  let surface = atmosphereTerrainGeometry(direction, sceneDistance);
  if (surface.w < 0.0) { return vec3f(1.0); }
  let sunCosine = max(dot(surface.xyz, planet.sunDirectionWC.xyz), 0.0);
  return terrainSurfaceLight(direction, sceneDistance, surface.xyz, sunCosine, vec3f(1.0));
}

// Long grazing paths can produce a saturated, one-pixel limb/horizon band after
// tone mapping. Apply a restrained scene-linear display balance to the combined
// transmitted scene and in-scattered atmosphere. Transport transmittance, physical
// coefficients, direct Sun energy and the single ACES/sRGB output remain unchanged.
fn atmosphereLongPathBalance(radiance: vec3f, transmittance: vec3f) -> vec3f {
  let weights = vec3f(0.2126, 0.7152, 0.0722);
  let opacity = clamp(1.0 - dot(transmittance, weights), 0.0, 1.0);
  let grazingPath = smoothstep(0.25, 0.75, opacity);
  let luminance = max(dot(radiance, weights), 0.0);
  let desaturation = 0.85 * grazingPath;
  let attenuation = 1.0 - 0.35 * grazingPath;
  return mix(radiance, vec3f(luminance), desaturation) * attenuation;
}

fn atmosphereEncodeSrgb(value: vec3f) -> vec3f {
  let color = max(value, vec3f(0.0));
  return select(1.055 * pow(color, vec3f(1.0 / 2.4)) - 0.055, color * 12.92,
                color <= vec3f(0.0031308));
}

// Narkowicz fitted ACES curve. Inputs remain scene-linear HDR until this point.
fn atmosphereToneMapACES(value: vec3f) -> vec3f {
  let x = max(value, vec3f(0.0)) * atmosphere.exposure.x;
  return clamp((x * (2.51 * x + 0.03)) /
               (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn atmosphereDisplayOutput(linear: vec3f) -> vec4f {
  return vec4f(atmosphereEncodeSrgb(atmosphereToneMapACES(linear)), 1.0);
}

@vertex fn atmosphereVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(points[index], 0.0, 1.0);
}

@fragment fn atmosphereFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let coordinate = vec2i(pixel.xy);
  let ndc = vec2f(2.0 * pixel.x / atmosphere.viewport.x - 1.0,
                 1.0 - 2.0 * pixel.y / atmosphere.viewport.y);
  let direction = webgpuRayDirection(ndc, planet);
  // Derivatives are evaluated in uniform control flow before solar occlusion.
  let pixelWidth = max(length(dpdx(direction)), length(dpdy(direction)));
  let depth = textureLoad(sceneDepth, coordinate, 0);
  let sceneDistance = webgpuSceneRayDistance(depth, direction, planet);
  let transport = atmosphereIntegrate(direction, sceneDistance);
  let background = textureLoad(sceneColor, coordinate, 0).rgb;
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let solar = sunRadiance(direction, coordinate, pixelWidth, transport.transmittance);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let surfaceLighting = atmosphereTerrainLighting(direction, sceneDistance);
  let atmosphereComposite = background * surfaceLighting * transport.transmittance + transport.radiance;
  let balancedAtmosphere = atmosphereLongPathBalance(atmosphereComposite, transport.transmittance);
  let linear = (stars + solar + moon) * transport.transmittance +
               balancedAtmosphere + moonTerrain;
  return atmosphereDisplayOutput(linear);
}

// Scene-linear entry point feeds HDR bloom before the final ACES/sRGB pass.
@fragment fn atmosphereLinearFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let coordinate = vec2i(pixel.xy);
  let ndc = vec2f(2.0 * pixel.x / atmosphere.viewport.x - 1.0,
                 1.0 - 2.0 * pixel.y / atmosphere.viewport.y);
  let direction = webgpuRayDirection(ndc, planet);
  let pixelWidth = max(length(dpdx(direction)), length(dpdy(direction)));
  let depth = textureLoad(sceneDepth, coordinate, 0);
  let sceneDistance = webgpuSceneRayDistance(depth, direction, planet);
  let transport = atmosphereIntegrate(direction, sceneDistance);
  let background = textureLoad(sceneColor, coordinate, 0).rgb;
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let solar = sunRadiance(direction, coordinate, pixelWidth, transport.transmittance);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let surfaceLighting = atmosphereTerrainLighting(direction, sceneDistance);
  let atmosphereComposite = background * surfaceLighting * transport.transmittance + transport.radiance;
  let balancedAtmosphere = atmosphereLongPathBalance(atmosphereComposite, transport.transmittance);
  let linear = (stars + solar + moon) * transport.transmittance +
               balancedAtmosphere + moonTerrain;
  return vec4f(linear, 1.0);
}

// Separate entry point keeps disabled atmosphere independent of LUT resources
// and their expensive quadrature. The same real completed depth still occludes.
@fragment fn sunOnlyFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let coordinate = vec2i(pixel.xy);
  let ndc = vec2f(2.0 * pixel.x / atmosphere.viewport.x - 1.0,
                 1.0 - 2.0 * pixel.y / atmosphere.viewport.y);
  let direction = webgpuRayDirection(ndc, planet);
  let pixelWidth = max(length(dpdx(direction)), length(dpdy(direction)));
  let source = textureLoad(sceneColor, coordinate, 0);
  let sceneDistance = webgpuSceneRayDistance(textureLoad(sceneDepth, coordinate, 0), direction, planet);
  let solar = sunRadiance(direction, coordinate, pixelWidth, vec3f(1.0));
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let surfaceLighting = sunOnlyTerrainLighting(direction, sceneDistance);
  let linear = source.rgb * surfaceLighting + solar + moon + stars + moonTerrain;
  return atmosphereDisplayOutput(linear);
}

@fragment fn sunOnlyLinearFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let coordinate = vec2i(pixel.xy);
  let ndc = vec2f(2.0 * pixel.x / atmosphere.viewport.x - 1.0,
                 1.0 - 2.0 * pixel.y / atmosphere.viewport.y);
  let direction = webgpuRayDirection(ndc, planet);
  let pixelWidth = max(length(dpdx(direction)), length(dpdy(direction)));
  let source = textureLoad(sceneColor, coordinate, 0);
  let sceneDistance = webgpuSceneRayDistance(textureLoad(sceneDepth, coordinate, 0), direction, planet);
  let solar = sunRadiance(direction, coordinate, pixelWidth, vec3f(1.0));
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let surfaceLighting = sunOnlyTerrainLighting(direction, sceneDistance);
  return vec4f(source.rgb * surfaceLighting + solar + moon + stars + moonTerrain, 1.0);
}
`;
}

export { createAtmosphereShader };
export default createAtmosphereShader();
