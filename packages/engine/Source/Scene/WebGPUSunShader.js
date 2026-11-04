/**
 * Distant solar disk and texture-driven solar rays/halo/corona. Shares the
 * planet record, solar effect controls and completed real depth with the HDR compositor.
 * @private
 */
const WebGPUSunShader = `
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

fn sunRadiance(direction: vec3f, pixel: vec2i, pixelWidth: f32, viewTransmittance: vec3f) -> vec3f {
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
  // The analytic disk is the direct photosphere and follows Beer-Lambert
  // attenuation in the compositor. Artwork is a restrained visual supplement,
  // not a second scattering solution: reduce it as the physical view path
  // becomes optically thick, where Rayleigh/Mie in-scattering already supplies
  // the atmospheric glow. This avoids a second orange veil at the limb while
  // retaining the full authored appearance in optically thin space.
  let viewTransmission = dot(viewTransmittance, vec3f(0.2126, 0.7152, 0.0722));
  let artworkTransmission = mix(0.58, 1.0, smoothstep(0.25, 0.90, viewTransmission));
  return atmosphere.sun.y * (disk +
    (tint * (halo + rayDetail) + coronaTint * coronaDetail) * visibility * artworkTransmission);
}
`;

export default WebGPUSunShader;
