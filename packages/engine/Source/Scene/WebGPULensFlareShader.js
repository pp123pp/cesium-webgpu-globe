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
  if (textureLoad(bloomDepth, vec2i(position.xy), 0) != 0.0) { return vec3f(0.0); }
  let ray = webgpuRayDirection(vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0), bloomPlanet);
  let earth = webgpuRayEllipsoid(ray, bloomPlanet);
  if (earth.x >= 0.0 && earth.y > 0.0) { return vec3f(0.0); }
  let sunUv = lensProject(bloomPlanet.sunDirectionWC.xyz);
  let aspect = vec2f(size.x / size.y, 1.0);
  let delta = (uv - sunUv) * aspect;
  let opticalAxis = (vec2f(0.5) - sunUv) * aspect;
  let offAxis = length(opticalAxis);
  let r = length(delta);
  // Smooth shoulders, without a hard ring or repeated ghost chain. The broad
  // component leans toward the optical axis as the Sun moves off-center.
  let compact = exp(-r * r / 0.0012) * 0.032;
  let shoulder = exp(-r * r / 0.009) * 0.008;
  let pupil = delta - opticalAxis * 0.065;
  let spread = exp(-dot(pupil, pupil) / 0.0144) * 0.004;
  let diffusion = (compact + shoulder + spread) * lens.diffusion;
  let reflectionCenter = sunUv + (vec2f(0.5) - sunUv) * 0.72;
  let reflectionDelta = (uv - reflectionCenter) * aspect;
  let reflectionRadius = 0.035 + min(offAxis, 0.7) * 0.055;
  let reflection = exp(-dot(reflectionDelta, reflectionDelta) / (reflectionRadius * reflectionRadius)) *
    smoothstep(0.04, 0.4, offAxis) * 0.004 * lens.reflection;
  return energy * lens.strength * (vec3f(1.0, 0.97, 0.91) * diffusion +
    vec3f(0.80, 0.91, 1.0) * reflection);
}

@fragment fn lensFinal(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return vec4f(bloomSrgb(bloomAces(bloomLinear(position) + lensRadiance(position))), 1.0);
}
`;

export default WebGPULensFlareShader;
