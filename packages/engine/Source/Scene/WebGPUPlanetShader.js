/**
 * Shared M2.1 WGSL math, without bindings, entry points or visible effects.
 * WebGPUPlanetState supplies exactly twelve vec4 values (192 bytes).
 * ECEF positions, radii, distances and ray intervals are meters. Callers supply
 * normalized ECEF directions. vec2(-1) is a miss; [0,0] is surface contact.
 * GPU float32 grazing contacts have a relative rounding band; real terrain
 * occlusion remains authoritative through the existing depth texture.
 * @private
 */
const WebGPUPlanetShader = `
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
`;

export default WebGPUPlanetShader;
