import { cloudFieldShader } from "./WebGPUCloudDensityShader.js";

// Sample from the terrain mesh towards the Sun or the zenith. Positions, shell radii and optical path lengths are meters.
const WebGPUCloudShadowShader = `${cloudFieldShader}
fn cloudShadowShellExit(surfaceWC: vec3f, ray: vec3f, height: f32) -> f32 {
  let inverse = vec3f(1.0) / (planet.radii.xyz + vec3f(height));
  let origin = surfaceWC * inverse;
  let direction = ray * inverse;
  return max(0.0, webgpuForwardInterval(dot(direction,direction), dot(origin,direction),
    dot(origin,origin)-1.0, 0.0).y);
}

fn cloudShadowOpticalDepth(surfaceWC: vec3f, ray: vec3f, base: f32, top: f32, steps: u32) -> f32 {
  let entry = cloudShadowShellExit(surfaceWC, ray, base);
  let exitDistance = cloudShadowShellExit(surfaceWC, ray, top);
  let ds = (exitDistance - entry) / f32(steps);
  if (ds <= 0.0) { return 0.0; }
  var tau = 0.0;
  for (var i = 0u; i < steps; i++) {
    let distance = entry + (f32(i) + 0.5) * ds;
    let p = fma(ray, vec3f(distance), surfaceWC);
    let cameraDistance = length((p - planet.cameraHigh.xyz) - planet.cameraLow.xyz);
    let density = cloudDensity(p, ds*0.10, clouds.weather, clouds.shape);
    tau += cloudVisibleExtinction(density, cameraDistance) * ds;
  }
  return tau;
}

fn cloudShadowTransmission(surfaceWC: vec3f, ray: vec3f, steps: u32) -> f32 {
  var tau = cloudShadowOpticalDepth(surfaceWC, ray, 2000.0, 6000.0, steps);
  if (clouds.shape.y > 0.5) {
    // A separate interval resolves the thin cirrus instead of marching empty
    // air between the low and high decks.
    tau += cloudShadowOpticalDepth(surfaceWC, ray, 9000.0, 11000.0, steps / 2u);
  }
  return exp(-tau);
}

fn cloudShadowSolarTransmission(surfaceWC: vec3f, sun: vec3f, angularRadius: f32) -> f32 {
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(sun.z) < 0.9);
  let right = normalize(cross(sun, axis));
  let up = cross(right, sun);
  // Three equally spaced samples at R/sqrt(2) match the disk's second moments.
  let ring = tan(angularRadius) * 0.70710678;
  let offsets = array<vec2f, 3>(
    vec2f(1.0, 0.0), vec2f(-0.5, 0.8660254), vec2f(-0.5, -0.8660254));
  var transmission = 0.0;
  for (var i = 0u; i < 3u; i++) {
    let offset = offsets[i];
    let ray = normalize(sun + ring * (offset.x * right + offset.y * up));
    transmission += cloudShadowTransmission(surfaceWC, ray, 12u);
  }
  return transmission / 3.0;
}

@group(0) @binding(20) var shadowColumns: texture_2d<f32>;

fn cloudShadowAtReceiver(direction: vec3f, distance: f32, normal: vec3f) -> vec2f {
  let receiver = planet.cameraHigh.xyz + fma(direction, vec3f(distance), planet.cameraLow.xyz);
  let direct = cloudShadowSolarTransmission(receiver, planet.sunDirectionWC.xyz, atmosphere.sun.x);
  var ambient = 1.0;
  if (clouds.ambientShadows > 0.0) {
    ambient = cloudShadowTransmission(receiver, normal, 8u);
  }
  return vec2f(direct, ambient);
}

fn cloudShadowRay(pixel: vec2i) -> vec3f {
  let uv = (vec2f(pixel) + 0.5) / atmosphere.viewport.xy;
  return webgpuRayDirection(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), planet);
}

@fragment fn cloudShadowColumnsFragment(@builtin(position) pixel: vec4f) -> @location(0) vec2f {
  let column = vec2i(i32(pixel.x) * 2, i32(pixel.y));
  let ray = cloudShadowRay(column);
  let distance = webgpuSceneRayDistance(textureLoad(sceneDepth, column, 0), ray, planet);
  let surface = atmosphereTerrainGeometry(ray, distance);
  if (surface.w < 0.0 || dot(surface.xyz, planet.sunDirectionWC.xyz) <= 0.0) { return vec2f(-1.0); }
  return cloudShadowAtReceiver(ray, distance, surface.xyz);
}

fn cloudShadowCompatible(pixel: vec2i, hit: vec3f, normal: vec3f) -> bool {
  let ray = cloudShadowRay(pixel);
  let distance = webgpuSceneRayDistance(textureLoad(sceneDepth, pixel, 0), ray, planet);
  let delta = ray * distance - hit;
  // Compare across the receiver tangent plane so a grazing view over level
  // ground does not look like a depth discontinuity.
  return distance >= 0.0 && abs(dot(delta, normal)) <= max(1.0, distance * 0.001 * abs(dot(ray, normal)));
}

fn cloudShadowResolve(pixel: vec2i, direction: vec3f, distance: f32, normal: vec3f) -> vec2f {
  let column = vec2i(pixel.x / 2, pixel.y);
  let left = textureLoad(shadowColumns, column, 0).rg;
  if ((pixel.x & 1) == 0 && left.x >= 0.0) { return left; }
  if ((pixel.x & 1) != 0 && pixel.x + 1 < i32(atmosphere.viewport.x) && left.x >= 0.0) {
    let right = textureLoad(shadowColumns, column + vec2i(1, 0), 0).rg;
    let hit = direction * distance;
    // Retrace silhouettes, steep depth edges and narrow penumbrae.
    if (right.x >= 0.0 &&
        cloudShadowCompatible(pixel - vec2i(1, 0), hit, normal) &&
        cloudShadowCompatible(pixel + vec2i(1, 0), hit, normal)) {
      // The ambient toggle must never change which direct-light samples are used.
      var transmission = 0.5 * (left + right);
      let receiver = planet.cameraHigh.xyz + fma(direction, vec3f(distance), planet.cameraLow.xyz);
      if (abs(left.x - right.x) > 0.02) {
        transmission.x = cloudShadowSolarTransmission(receiver, planet.sunDirectionWC.xyz, atmosphere.sun.x);
      }
      if (clouds.ambientShadows > 0.0 && abs(left.y - right.y) > 0.02) {
        transmission.y = cloudShadowTransmission(receiver, normal, 8u);
      }
      return transmission;
    }
  }
  return cloudShadowAtReceiver(direction, distance, normal);
}
`;

export default WebGPUCloudShadowShader;
