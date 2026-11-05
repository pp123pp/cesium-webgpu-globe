/** Original solar camera optics, composed in scene-linear HDR. @private */
const WebGPULensFlareShader = `
struct LensParameters {
  strength: f32,
  diffusion: f32,
  reflection: f32,
  angularRadius: f32,
}
@group(0) @binding(6) var lensSource: texture_2d<f32>;
@group(0) @binding(7) var<uniform> lens: LensParameters;
@group(0) @binding(8) var lensRays: texture_2d<f32>;
@group(0) @binding(9) var lensFineRays: texture_2d<f32>;

fn lensProject(direction: vec3f) -> vec2f {
  let forward = dot(direction, bloomPlanet.cameraForwardWC.xyz);
  let eye = vec2f(dot(direction, bloomPlanet.cameraRightWC.xyz),
                  dot(direction, bloomPlanet.cameraUpWC.xyz)) / forward;
  let ndc = eye * bloomPlanet.projection.xy - bloomPlanet.projection.zw;
  return vec2f(ndc.x + 1.0, 1.0 - ndc.y) * 0.5;
}

@fragment fn lensMeasure() -> @location(0) vec4f {
  let sun = bloomPlanet.sunDirectionWC.xyz;
  if (lens.strength == 0.0 || dot(sun, bloomPlanet.cameraForwardWC.xyz) <= 0.0) {
    return vec4f(0.0);
  }
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(sun.z) < 0.9);
  let right = normalize(cross(sun, axis));
  let up = cross(right, sun);
  let size = vec2i(textureDimensions(sourceTexture));
  var energy = vec3f(0.0);
  var visibility = 0.0;
  // Dense disk quadrature runs once per frame, not once per output pixel.
  for (var i = 0u; i < 128u; i++) {
    let angle = f32(i) * 2.399963229728653;
    let radius = sqrt((f32(i) + 0.5) / 128.0) * tan(lens.angularRadius);
    let ray = normalize(sun + radius * (cos(angle) * right + sin(angle) * up));
    let uv = lensProject(ray);
    if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { continue; }
    let pixel = vec2i(uv * vec2f(size));
    if (textureLoad(bloomDepth, pixel, 0) != 0.0) { continue; }
    let pixelUv = (vec2f(pixel) + 0.5) / vec2f(size);
    let pixelRay = webgpuRayDirection(vec2f(pixelUv.x * 2.0 - 1.0, 1.0 - pixelUv.y * 2.0), bloomPlanet);
    let pixelEarth = webgpuRayEllipsoid(pixelRay, bloomPlanet);
    if (pixelEarth.x >= 0.0 && pixelEarth.y > pixelEarth.x) { continue; }
    if (length(pixelRay - sun) > 2.0 * sin(lens.angularRadius * 0.5)) { continue; }
    let color = max(textureLoad(sourceTexture, pixel, 0).rgb, vec3f(0.0));
    let brightness = max(color.r, max(color.g, color.b));
    let knee = clamp(brightness - 0.5, 0.0, 1.0);
    let excess = max(brightness - 1.0, knee * knee * 0.5);
    energy += color * excess / max(brightness, 1.0e-5);
    visibility += 1.0;
  }
  return vec4f(energy, visibility) / 128.0;
}

fn lensRadiance(position: vec4f) -> vec3f {
  let energy = textureLoad(lensSource, vec2i(0), 0).rgb;
  if (lens.strength == 0.0 || max(energy.r, max(energy.g, energy.b)) == 0.0) {
    return vec3f(0.0);
  }
  let size = vec2f(textureDimensions(sourceTexture));
  let uv = position.xy / size;
  let sunUv = lensProject(bloomPlanet.sunDirectionWC.xyz);
  // A fixed horizontal film gate keeps lens size stable when only aspect
  // ratio changes; the reference is a 1000x227 crop of that optical field.
  let aspect = vec2f(4.405286, 4.405286 * size.y / size.x);
  let delta = (uv - sunUv) * aspect;
  let opticalAxis = (vec2f(0.5) - sunUv) * aspect;
  let offAxis = length(opticalAxis);
  let r = length(delta);
  // Lens glare expands the apparent highlight, never the physical solar disk.
  // Unequal angular harmonics break up the shoulder without a regular star.
  let angle = atan2(delta.y, delta.x);
  let irregular = 1.0 + 0.22 * sin(angle * 7.0 + 0.6) +
    0.14 * sin(angle * 13.0 - 1.2) + 0.08 * sin(angle * 23.0 + 2.0);
  // Compact the optical footprint without dimming peaks or moving reflections.
  let coreDelta = delta / 0.6;
  let coreRadius = r / 0.6;
  let diffusionDelta = delta / finalParameters.lensDiffusionSize;
  let diffusionRadius = r / finalParameters.lensDiffusionSize;
  let core = exp(-coreRadius * coreRadius / (0.006 * irregular)) * 24.0;
  let shoulder = exp(-diffusionRadius * diffusionRadius / 0.035) * 1.4;
  let pupil = diffusionDelta - opticalAxis * 0.055;
  let spread = exp(-dot(pupil, pupil) / 0.40) * 0.22;
  let warmSupport = 1.0 - smoothstep(1.35, 1.80, diffusionRadius);
  var rays = 0.0;
  // Beyond this footprint the beam envelope is below 4e-9. Avoid nine mask
  // fetches over the rest of the sky while retaining the broad optical layers.
  if (coreRadius < 0.7) {
    let rayUv = clamp(vec2f(0.5) + coreDelta / 1.25, vec2f(0.0), vec2f(1.0));
    let fineDelta = vec2f(coreDelta.x * 0.98 - coreDelta.y * 0.20, coreDelta.x * 0.20 + coreDelta.y * 0.98);
    let fineUv = clamp(vec2f(0.5) + fineDelta / 0.95, vec2f(0.0), vec2f(1.0));
    let secondDelta = vec2f(coreDelta.x * 0.89 + coreDelta.y * 0.45, -coreDelta.x * 0.45 + coreDelta.y * 0.89);
    let secondUv = clamp(vec2f(0.5) + secondDelta / 1.15, vec2f(0.0), vec2f(1.0));
    // Remove the masks' low-bit-depth radial pedestal before amplification.
    // Its quantized gradients otherwise become conspicuous concentric bands.
    rays = (lensSoftRay(lensRays, rayUv, vec3f(0.34, 0.16, 0.035)) * 0.20 +
      lensSoftRay(lensFineRays, fineUv, vec3f(0.12, 0.06, 0.015)) * 0.55 +
      lensSoftRay(lensFineRays, secondUv, vec3f(0.12, 0.06, 0.015)) * 0.25) *
      exp(-coreRadius * coreRadius / 0.025) * 24.0;
  }
  // Small warm footprints must not trim the independently sized short rays.
  let diffusion = (vec3f(1.0, 0.91, 0.74) * (core + rays) +
    vec3f(1.0, 0.85, 0.40) * shoulder * warmSupport +
    vec3f(1.0, 0.60, 0.45) * spread * warmSupport) * lens.diffusion;

  let offAxisResponse = smoothstep(0.04, 0.45, offAxis);
  // Broad overlapping wavelength bands form a soft spectral arc, not a line.
  let arcScale = finalParameters.lensDiffusionSize / 0.7;
  let ringDistance = vec3f(r / arcScale) - vec3f(0.94, 1.04, 1.12);
  let arc = exp(-ringDistance * ringDistance / vec3f(0.012, 0.016, 0.018)) *
    vec3f(0.004, 0.009, 0.004) * (0.45 + 0.55 * pow(0.5 + 0.5 * cos(angle + 2.8), 2.0));
  let reflections =
    lensReflection(delta - opticalAxis * 1.32, 0.043) * vec3f(0.58, 0.70, 0.28) * 0.026 +
    lensReflection(delta - opticalAxis * 1.42, 0.070) * vec3f(0.48, 0.63, 0.23) * 0.022 +
    lensReflection(delta - opticalAxis * 1.51, 0.046) * vec3f(0.58, 0.66, 0.31) * 0.012 +
    lensReflection(delta + opticalAxis * 0.72, 0.022) * vec3f(1.0, 0.67, 0.22) * 0.038;
  return energy * lens.strength * (diffusion +
    (arc + reflections) * offAxisResponse * lens.reflection);
}

fn lensReflection(delta: vec2f, radius: f32) -> f32 {
  let normalized = delta / vec2f(radius, radius * 0.85);
  let squared = dot(normalized, normalized);
  if (squared >= 1.5625) { return 0.0; }
  let radial = sqrt(squared);
  return (1.0 - smoothstep(0.45, 1.25, radial)) *
    (0.75 + 0.25 * exp(-radial * radial * 3.0));
}

fn lensRayPedestal(uv: vec2f, stops: vec3f) -> f32 {
  // Matches the authored SVG core gradient; retain only the irregular beams.
  let radius = length(uv - vec2f(0.5)) * (1024.0 / 270.0);
  if (radius < 0.08) { return mix(stops.x, stops.y, radius / 0.08) + 2.0 / 255.0; }
  if (radius < 0.42) { return mix(stops.y, stops.z, (radius - 0.08) / 0.34) + 2.0 / 255.0; }
  return mix(stops.z, 0.0, clamp((radius - 0.42) / 0.58, 0.0, 1.0)) + 2.0 / 255.0;
}

fn lensSoftRay(mask: texture_2d<f32>, uv: vec2f, stops: vec3f) -> f32 {
  // Angular filtering gives thin authored beams a finite optical width.
  let tangent = vec2f(0.5 - uv.y, uv.x - 0.5) * 0.035;
  let value = textureSampleLevel(mask, sourceSampler, uv, 0.0).r * 0.5 +
    textureSampleLevel(mask, sourceSampler, uv + tangent, 0.0).r * 0.25 +
    textureSampleLevel(mask, sourceSampler, uv - tangent, 0.0).r * 0.25;
  return max(value - lensRayPedestal(uv, stops), 0.0);
}

@fragment fn lensFinal(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / vec2f(textureDimensions(sourceTexture));
  let scene = textureLoad(sourceTexture, vec2i(position.xy), 0).rgb;
  var bloom = vec3f(0.0);
  var flare = vec3f(0.0);
  // Both optical layers share the same receiver test. The disabled final
  // entry point remains untouched; source-disk visibility is still separate.
  if (textureLoad(bloomDepth, vec2i(position.xy), 0) == 0.0) {
    let ray = webgpuRayDirection(vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0), bloomPlanet);
    let earth = webgpuRayEllipsoid(ray, bloomPlanet);
    if (earth.x < 0.0 || earth.y <= 0.0) {
      if (finalParameters.strength > 0.0) {
        bloom = textureSampleLevel(blurredBloom, sourceSampler, uv, 0.0).rgb;
      }
      flare = lensRadiance(position);
    }
  }
  return vec4f(bloomSrgb(bloomAces(scene + bloom * finalParameters.strength + flare)), 1.0);
}
`;

export default WebGPULensFlareShader;
