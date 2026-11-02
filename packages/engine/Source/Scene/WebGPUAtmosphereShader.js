import WebGPUPlanetShader from "./WebGPUPlanetShader.js";

/**
 * Original meter-based radiative-transfer implementation. Equations and the
 * reduced Hillaire isotropic closure are documented in docs/WEBGPU_M2.2.md.
 * The same executable functions serve visible sky, terrain aerial perspective
 * and the independent GPU numerical acceptance probes. No Sun disk is drawn.
 * @private
 */
const WebGPUAtmosphereShader = `${WebGPUPlanetShader}
struct AtmosphereParameters {
  rayleigh: vec4f, // scattering/extinction RGB in 1/m, scale height in m
  mie: vec4f,      // scattering, extinction in 1/m, scale height in m, g
  light: vec4f,    // normalized solar irradiance, MS strength, LUT radius/height m
  viewport: vec4f,
}
@group(0) @binding(0) var<uniform> planet: WebGPUPlanet;
@group(0) @binding(1) var<uniform> atmosphere: AtmosphereParameters;
@group(0) @binding(2) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var multipleScatteringLut: texture_2d<f32>;
@group(0) @binding(4) var atmosphereSampler: sampler;
@group(0) @binding(5) var sceneColor: texture_2d<f32>;
@group(0) @binding(6) var sceneDepth: texture_depth_2d;

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
    let source = atmosphere.light.x * (direct * (rayleigh * phaseRayleigh + vec3f(mie * phaseMie)) + scattering * multiple);
    result.radiance += result.transmittance * source * step * phi;
    result.transmittance *= segmentT;
  }
  return result;
}

fn atmosphereDecodeSrgb(value: vec3f) -> vec3f {
  return select(pow((value + 0.055) / 1.055, vec3f(2.4)), value / 12.92,
                value <= vec3f(0.04045));
}

fn atmosphereEncodeSrgb(value: vec3f) -> vec3f {
  let color = max(value, vec3f(0.0));
  return select(1.055 * pow(color, vec3f(1.0 / 2.4)) - 0.055, color * 12.92,
                color <= vec3f(0.0031308));
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
  let depth = textureLoad(sceneDepth, coordinate, 0);
  let sceneDistance = webgpuSceneRayDistance(depth, direction, planet);
  let transport = atmosphereIntegrate(direction, sceneDistance);
  let background = atmosphereDecodeSrgb(textureLoad(sceneColor, coordinate, 0).rgb);
  let linear = background * transport.transmittance + transport.radiance;
  // A display-referred LDR output only. HDR, exposure and tone mapping are M2.5.
  return vec4f(clamp(atmosphereEncodeSrgb(linear), vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export default WebGPUAtmosphereShader;
