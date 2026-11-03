/**
 * Distant solar disk and restrained angular glare. Shares the planet record,
 * atmosphere parameter record and completed real depth with the compositor.
 * There is no new texture, postprocess blur or scene HDR/exposure system.
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
  // terrain-occluded source outside the viewport. This is a bounded LDR effect.
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
  let disk = sunDiskCoverage(direction, pixelWidth);
  var halo = 0.0;
  if (atmosphere.sun.z > 0.0 && chord < outer) {
    let r = chord / outer;
    let profile = exp(-6.0 * r * r) * (1.0 - smoothstep(0.7, 1.0, r));
    halo = atmosphere.sun.z * profile * sunSourceVisibility();
  }
  return vec3f(atmosphere.sun.y * (disk + halo));
}
`;

export default WebGPUSunShader;
