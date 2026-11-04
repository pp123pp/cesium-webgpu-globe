
struct WebGPUPlanet {
  radii: vec4f,                 // WGS84 xyz, outer atmosphere sphere radius
  inverseRadii: vec4f,          // reciprocal xyz and atmosphere radius
  cameraHigh: vec4f,            // encoded ECEF high, geocentric distance
  cameraLow: vec4f,             // encoded ECEF low, geodetic height
  sunDirectionWC: vec4f,        // Earth-to-Sun, ECEF axes (w reserved)
  sunDirectionEC: vec4f,        // Earth-to-Sun, eye axes (w reserved)
  cameraRightWC: vec4f,
  cameraUpWC: vec4f,
  cameraForwardWC: vec4f,
  projection: vec4f,            // native column-major [0], [5], [8], [9]
  depth: vec4f,                 // near, far, reversed A, reversed B: z = B/d - A
  surface: vec4f,               // CPU-double ellipsoid c, atmosphere c, height, reserved
  moonDirectionWC: vec4f,       // camera-to-Moon unit direction, angular radius rad
  moon: vec4f,                  // phase fraction, camera distance, star intensity, moonlight intensity
  starRotation0: vec4f,         // ICRF-from-ECEF rotation row 0
  starRotation1: vec4f,         // ICRF-from-ECEF rotation row 1
  starRotation2: vec4f,         // ICRF-from-ECEF rotation row 2
}

fn webgpuRelativePosition(high: vec3f, low: vec3f, planet: WebGPUPlanet) -> vec3f {
  // Subtract each encoded part BEFORE adding. Never form float32 absolute ECEF.
  return (high - planet.cameraHigh.xyz) + (low - planet.cameraLow.xyz);
}

fn webgpuRayDirection(ndc: vec2f, planet: WebGPUPlanet) -> vec3f {
  // For top-left pixel (x,y), use (2*(x+.5)/width-1, 1-2*(y+.5)/height).
  let eye = (ndc + planet.projection.zw) / planet.projection.xy;
  return normalize(planet.cameraRightWC.xyz * eye.x +
                   planet.cameraUpWC.xyz * eye.y + planet.cameraForwardWC.xyz);
}

fn webgpuSceneRayDistance(depth: f32, direction: vec3f, planet: WebGPUPlanet) -> f32 {
  // Negative means background/invalid, never a zero-distance occluder.
  let cosine = dot(direction, planet.cameraForwardWC.xyz);
  if (depth <= 0.0 || depth > 1.0 || cosine <= 0.0) { return -1.0; }
  return planet.depth.w / (depth + planet.depth.z) / cosine;
}

fn webgpuForwardInterval(a: f32, b: f32, c: f32, tangentError: f32) -> vec2f {
  if (a <= 0.0) { return vec2f(-1.0); }
  // Only CPU-double surface roundoff is canonicalized to exact zero. A float32
  // epsilon test on c would incorrectly erase centimeter/meter ground heights.
  if (c == 0.0) {
    if (b < -tangentError) { return vec2f(0.0, -2.0 * b / a); }
    return vec2f(0.0);
  }
  let product = a * c;
  let discriminant = b * b - product;
  let error = 4.76837158203125e-7 * (abs(b * b) + abs(product));
  if (discriminant < -error) { return vec2f(-1.0); }
  if (abs(discriminant) <= error) {
    let contact = -b / a;
    if (contact < 0.0) { return vec2f(-1.0); }
    return vec2f(contact);
  }
  let root = sqrt(discriminant);
  // Stable quadratic: one large root and its product-related partner.
  let q = -b - select(-root, root, b >= 0.0);
  let t0 = q / a;
  let t1 = c / q;
  let stop = max(t0, t1);
  if (stop < 0.0) { return vec2f(-1.0); }
  return vec2f(max(0.0, min(t0, t1)), stop);
}

fn webgpuCameraInterval(direction: vec3f, inverseRadii: vec3f, c: f32,
                        planet: WebGPUPlanet) -> vec2f {
  let w = direction * inverseRadii;
  let high = planet.cameraHigh.xyz * inverseRadii;
  let low = planet.cameraLow.xyz * inverseRadii;
  let b = dot(high, w) + dot(low, w);
  let scale = dot(abs(high * w), vec3f(1.0)) + dot(abs(low * w), vec3f(1.0));
  return webgpuForwardInterval(dot(w, w), b, c, 4.76837158203125e-7 * scale);
}

fn webgpuRayEllipsoid(direction: vec3f, planet: WebGPUPlanet) -> vec2f {
  return webgpuCameraInterval(direction, planet.inverseRadii.xyz, planet.surface.x, planet);
}

fn webgpuRayAtmosphere(direction: vec3f, planet: WebGPUPlanet) -> vec2f {
  return webgpuCameraInterval(direction, vec3f(planet.inverseRadii.w), planet.surface.y, planet);
}

fn webgpuAtmosphereSegment(direction: vec3f, sceneDistance: f32,
                           planet: WebGPUPlanet) -> vec2f {
  var atmosphere = webgpuRayAtmosphere(direction, planet);
  if (atmosphere.x < 0.0) { return vec2f(-1.0); }
  if (sceneDistance >= 0.0) { atmosphere.y = min(atmosphere.y, sceneDistance); }
  let earth = webgpuRayEllipsoid(direction, planet);
  if (earth.x >= 0.0 && earth.y > earth.x) { atmosphere.y = min(atmosphere.y, earth.x); }
  if (atmosphere.y <= atmosphere.x) { return vec2f(-1.0); }
  return atmosphere;
}

struct AtmosphereParameters {
  rayleigh: vec4f, // scattering/extinction RGB in 1/m, scale height in m
  mie: vec4f,      // scattering, extinction in 1/m, scale height in m, g
  light: vec4f,    // normalized solar irradiance, MS strength, LUT radius/height m
  viewport: vec4f, // width, height, atmosphere enabled, Sun enabled
  sun: vec4f,      // angular radius rad, displayed L, glare strength/radius rad
  exposure: vec4f, // manual scene-referred exposure multiplier
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


fn sunEarthVisible(direction: vec3f) -> bool {
  let earth = webgpuRayEllipsoid(direction, planet);
  return !(earth.x >= 0.0 && earth.y > earth.x);
}

fn sunDiskCoverage(direction: vec3f, pixelWidth: f32) -> f32 {
  // Chord distance retains small-angle precision; acos(dot) does not.
  let chord = length(direction - planet.sunDirectionWC.xyz);
  let radius = 2.0 * sin(0.5 * atmosphere.sun.x);
  let halfWidth = max(0.5 * pixelWidth, 1.0e-7);
  return 1.0 - smoothstep(radius - halfWidth, radius + halfWidth, chord);
}

fn sunDiskProfile(chord: f32) -> vec3f {
  // A restrained limb-darkening profile gives the analytic disk a readable
  // core/edge transition. Normalize its projected-disk integral to one so
  // the existing angular radius and irradiance calibration remain unchanged.
  let sinTheta = chord * sqrt(max(1.0 - 0.25 * chord * chord, 0.0));
  let radial = clamp(sinTheta / max(sin(atmosphere.sun.x), 1.0e-7), 0.0, 1.0);
  let limb = sqrt(max(1.0 - radial * radial, 0.0));
  let limbDarkening = 0.60;
  let profile = (1.0 - limbDarkening * (1.0 - limb)) / (1.0 - limbDarkening / 3.0);
  // A subtle warm-white limb is normalized to unit Rec.709 luminance; it
  // changes edge chromaticity without changing the disk's photometric energy.
  let warmWhite = vec3f(1.0295226, 0.9986369, 0.9265703);
  let edgeTint = mix(vec3f(1.0), warmWhite, (1.0 - limb) * 0.65);
  return vec3f(profile) * edgeTint;
}

fn solarRayUv(uv: vec2f, angle: f32, scale: f32) -> vec2f {
  // Deterministic per-layer transforms decorrelate authored spokes while
  // keeping every mask centered on the true projected Sun direction.
  let centered = (uv - vec2f(0.5)) * scale;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2f(c * centered.x - s * centered.y,
                      s * centered.x + c * centered.y);
  return clamp(vec2f(0.5) + rotated, vec2f(0.0), vec2f(1.0));
}

fn sunSkyAtPixel(pixel: vec2i) -> f32 {
  let size = vec2i(textureDimensions(sceneDepth));
  if (any(pixel < vec2i(0)) || any(pixel >= size)) { return 0.0; }
  return select(0.0, 1.0, textureLoad(sceneDepth, pixel, 0) == 0.0);
}

fn sunSourceVisibility() -> f32 {
  // Only the weak halo uses this bounded disk-area estimate. The visible disk
  // itself always uses each fragment's own exact Earth/depth test. Bilinear
  // depth-mask sampling reduces halo steps when a ridge moves across samples.
  let sun = planet.sunDirectionWC.xyz;
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(sun.z) < 0.9);
  let right = normalize(cross(sun, axis));
  let up = cross(right, sun);
  var visible = 0.0;
  for (var i = 0u; i < 16u; i++) {
    let angle = f32(i) * 2.399963229728653;
    let radius = sqrt((f32(i) + 0.5) / 16.0) * tan(atmosphere.sun.x);
    let direction = normalize(sun + radius * (cos(angle) * right + sin(angle) * up));
    let forward = dot(direction, planet.cameraForwardWC.xyz);
    if (forward <= 0.0 || !sunEarthVisible(direction)) { continue; }
    let eye = vec2f(dot(direction, planet.cameraRightWC.xyz),
                    dot(direction, planet.cameraUpWC.xyz)) / forward;
    let ndc = eye * planet.projection.xy - planet.projection.zw;
    let pixel = vec2f(ndc.x + 1.0, 1.0 - ndc.y) * 0.5 * atmosphere.viewport.xy - 0.5;
    // A covered source sample cannot borrow visibility from a clear texel
    // outside the disk. Without this conservative test a fully hidden small
    // Sun can leave a detached halo along a subpixel mountain edge.
    if (sunSkyAtPixel(vec2i(floor(pixel + 0.5))) == 0.0) { continue; }
    let base = vec2i(floor(pixel));
    let weight = fract(pixel);
    let upper = mix(sunSkyAtPixel(base), sunSkyAtPixel(base + vec2i(1, 0)), weight.x);
    let lower = mix(sunSkyAtPixel(base + vec2i(0, 1)), sunSkyAtPixel(base + vec2i(1, 1)), weight.x);
    visible += mix(upper, lower, weight.y);
  }
  // Offscreen samples contribute zero: no artificial glare from an unobserved
  // terrain-occluded source outside the viewport. The resulting radiance remains linear HDR.
  return visible / 16.0;
}

fn sunRadiance(direction: vec3f, pixel: vec2i, pixelWidth: f32) -> vec3f {
  if (atmosphere.viewport.w == 0.0 || atmosphere.sun.y == 0.0) { return vec3f(0.0); }
  let chord = length(direction - planet.sunDirectionWC.xyz);
  let outer = 2.0 * sin(0.5 * atmosphere.sun.w);
  let diskRadius = 2.0 * sin(0.5 * atmosphere.sun.x);
  if (chord > max(outer, diskRadius + pixelWidth)) { return vec3f(0.0); }
  // Sun is at infinity. Any non-clear scene depth is in front, including
  // mountains whose mesh lies above the analytic WGS84 limb.
  if (textureLoad(sceneDepth, pixel, 0) != 0.0 || !sunEarthVisible(direction)) {
    return vec3f(0.0);
  }
  let disk = vec3f(sunDiskCoverage(direction, pixelWidth)) * sunDiskProfile(chord);
  let visibility = sunSourceVisibility();
  let r = clamp(chord / max(outer, 1.0e-7), 0.0, 1.0);
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0),
                    abs(planet.sunDirectionWC.z) < 0.9);
  let right = normalize(cross(planet.sunDirectionWC.xyz, axis));
  let up = cross(right, planet.sunDirectionWC.xyz);
  // Angular tangent coordinates are projected through the actual camera basis;
  // the pattern follows the real solar ray and never uses a fixed screen point.
  let local = vec2f(dot(direction - planet.sunDirectionWC.xyz, right),
                    -dot(direction - planet.sunDirectionWC.xyz, up));
  let uv = clamp(vec2f(0.5) + local / max(2.0 * tan(atmosphere.sun.w), 1.0e-6),
                 vec2f(0.0), vec2f(1.0));
  let soft = textureSampleLevel(solarSoftHalo, solarSampler, uv, 0.0).r;
  let wide = textureSampleLevel(solarWideHalo, solarSampler, uv, 0.0).r;
  // Two authored corona frequency bands use independent deterministic transforms.
  // Both remain centered on the physical Sun and share the existing bounded UV domain.
  let coronaFineUv = solarRayUv(uv, 0.13, 1.08);
  let coronaMidUv = solarRayUv(uv, -0.23, 0.78);
  let coronaFine = textureSampleLevel(solarCorona, solarSampler, coronaFineUv, 0.0).r;
  let coronaMid = textureSampleLevel(solarCoronaMid, solarSampler, coronaMidUv, 0.0).r;
  let noise = textureSampleLevel(solarNoise, solarSampler, uv, 0.0).r;
  let primaryRayUv = solarRayUv(uv, 0.11, 0.96);
  let fineRayUv = solarRayUv(uv, -0.19, 1.07);
  let broadRayUv = solarRayUv(uv, 0.31, 0.86);
  let rays = textureSampleLevel(solarRaysPrimary, solarSampler, primaryRayUv, 0.0).r * 0.45 +
             textureSampleLevel(solarRaysFine, solarSampler, fineRayUv, 0.0).r * 0.15 +
             textureSampleLevel(solarRaysBroad, solarSampler, broadRayUv, 0.0).r * 0.40;
  let tint = mix(vec3f(1.0), textureSampleLevel(solarGlowGradient, solarSampler,
                                vec2f(1.0 - r, 0.5), 0.0).rgb, atmosphere.exposure.w);
  // Three overlapping halo scales share the two authored radial masks:
  // compact inner glow, broad intermediate transition and a low-energy outer falloff.
  // The radial envelopes avoid a third hard circular mask or a visible ring.
  let innerFalloff = 1.0 - smoothstep(0.08, 0.38, r);
  let intermediateFalloff = 1.0 - smoothstep(0.28, 0.78, r);
  let outerFalloff = 1.0 - smoothstep(0.58, 1.0, r);
  let innerHalo = soft * innerFalloff;
  let intermediateHalo = (0.62 * soft + 0.38 * wide) * intermediateFalloff;
  let outerHalo = wide * outerFalloff;
  let halo = atmosphere.sun.z * (
    0.48 * innerHalo * atmosphere.solarEffects.y +
    0.34 * intermediateHalo * mix(atmosphere.solarEffects.y, atmosphere.solarEffects.z, 0.5) +
    0.18 * outerHalo * atmosphere.solarEffects.z);
  // Corona starts just beyond the analytic photosphere and fades gradually.
  // Noise modulates authored structure; it is not animated or frame-random.
  let coronaEnvelope = smoothstep(0.08, 0.20, r) * (1.0 - smoothstep(0.62, 0.96, r));
  let coronaPattern = mix(coronaMid, coronaFine, 0.56) * mix(0.58, 1.18, noise);
  let coronaDetail = atmosphere.sun.z * 2.2 * coronaPattern * coronaEnvelope * atmosphere.solarEffects.w;
  // Diffuse corona remains warm-white instead of accumulating a brown-gold
  // veil. Desaturate only this layer toward its own linear luminance: this
  // preserves pre-transport linear Rec.709 luminance; Halo/Rays tint is unchanged.
  let coronaLuminance = dot(tint, vec3f(0.2126, 0.7152, 0.0722));
  let coronaTint = mix(tint, vec3f(coronaLuminance), 0.72);
  let rayFade = 1.0 - smoothstep(0.68, 1.0, r);
  let rayDetail = atmosphere.sun.z * 2.5 * rays * rayFade * atmosphere.solarEffects.x;
  return atmosphere.sun.y * (disk +
    (tint * (halo + rayDetail) + coronaTint * coronaDetail) * visibility);
}



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
  let solar = sunRadiance(direction, coordinate, pixelWidth);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let linear = (background + stars + solar + moon) * transport.transmittance +
               transport.radiance + moonTerrain;
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
  let solar = sunRadiance(direction, coordinate, pixelWidth);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let linear = (background + stars + solar + moon) * transport.transmittance +
               transport.radiance + moonTerrain;
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
  let solar = sunRadiance(direction, coordinate, pixelWidth);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  let linear = source.rgb + solar + moon + stars + moonTerrain;
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
  let solar = sunRadiance(direction, coordinate, pixelWidth);
  let moon = moonRadiance(direction, coordinate, pixelWidth);
  let stars = select(vec3f(0.0), starRadiance(direction, pixelWidth), sceneDistance < 0.0);
  let moonTerrain = moonTerrainLight(direction, sceneDistance);
  return vec4f(source.rgb + solar + moon + stars + moonTerrain, 1.0);
}

      struct AtmosphereProbe {
        ndcDistance: vec4f,
        direction: vec4f,
        pixel: vec4f,
        lutUv: vec4f,
      }
      @group(0) @binding(17) var<storage, read> atmosphereProbes: array<AtmosphereProbe>;
      @group(0) @binding(18) var<storage, read_write> atmosphereResults: array<vec4f>;
      @compute @workgroup_size(1)
      fn atmosphereProbeMain(@builtin(global_invocation_id) id: vec3u) {
        let input = atmosphereProbes[id.x];
        var direction = webgpuRayDirection(input.ndcDistance.xy, planet);
        if (input.direction.w > 0.0) {
          direction = normalize(input.direction.xyz);
        }
        let pixel = vec2i(input.pixel.xy);
        let depth = textureLoad(sceneDepth, pixel, 0);
        var distance = input.ndcDistance.z;
        if (input.pixel.z > 0.0) {
          distance = webgpuSceneRayDistance(depth, direction, planet);
        }
        let result = atmosphereIntegrate(direction, distance);
        let segment = webgpuAtmosphereSegment(direction, distance, planet);
        let earth = webgpuRayEllipsoid(direction, planet);
        let transPixel = vec2i(input.lutUv.xy *
                              vec2f(textureDimensions(transmittanceLut) - vec2u(1)));
        let multiPixel = vec2i(input.lutUv.xy *
                              vec2f(textureDimensions(multipleScatteringLut) - vec2u(1)));
        let i = id.x * 8u;
        atmosphereResults[i] = vec4f(result.radiance, distance);
        atmosphereResults[i + 1u] = vec4f(result.transmittance, depth);
        atmosphereResults[i + 2u] = vec4f(direction, dot(direction, planet.cameraForwardWC.xyz));
        atmosphereResults[i + 3u] = vec4f(segment, earth);
        atmosphereResults[i + 4u] = textureLoad(sceneColor, pixel, 0);
        atmosphereResults[i + 5u] = vec4f(atmosphereRayleighPhase(1.0),
          atmosphereRayleighPhase(0.0), atmosphereMiePhase(1.0), atmosphereMiePhase(-1.0));
        atmosphereResults[i + 6u] = textureLoad(transmittanceLut, transPixel, 0);
        atmosphereResults[i + 7u] = textureLoad(multipleScatteringLut, multiPixel, 0);
      }