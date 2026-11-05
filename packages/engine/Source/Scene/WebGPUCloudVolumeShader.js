import WebGPUAtmosphereShader from "./WebGPUAtmosphereShader.js";
import { cloudFieldShader } from "./WebGPUCloudDensityShader.js";

// Separate entry points let the vacuum path operate without atmosphere LUTs.
const WebGPUCloudVolumeShader = `${WebGPUAtmosphereShader}
${cloudFieldShader}

struct CloudIntegral {
  // Sunlit crowns and opaque shaded banks can sit at different depths on one ray.
  direct: f32,
  directDistanceMoment: f32,
  ambient: f32,
  skyWeight: f32,
  transmission: f32,
  distanceMoment: f32,
  primarySteps: u32,
  lightSteps: u32,
}

fn cloudLightDepth(p: vec3f, footprint: f32, localExtinction: f32) -> f32 {
  let count = u32(clouds.budget.y);
  // Account for near-field self shadow before spreading samples over the bank.
  var opticalDepth = localExtinction * 75.0;
  var start = 75.0;
  for (var i = 1u; i <= count; i++) {
    let u = f32(i) / f32(count);
    let end = 75.0 + 6325.0 * u * u * u;
    let sampleP = p + planet.sunDirectionWC.xyz * ((start + end) * 0.5);
    opticalDepth += cloudDensity(sampleP, max(footprint, (end-start)*0.2), clouds.weather, clouds.shape) * (end - start);
    start = end;
  }
  return opticalDepth;
}

fn cloudPhase(mu: f32, g: f32) -> f32 {
  return (1.0-g*g) / pow(1.0+g*g-2.0*g*mu, 1.5);
}

fn cloudMarchSegment(segment: vec2f, direction: vec3f, count: u32, angularPixel: f32, jitter: f32,
                     initial: CloudIntegral) -> CloudIntegral {
  var result = initial;
  let span = segment.y - segment.x;
  let anchor = fma(direction, vec3f(segment.x), planet.cameraHigh.xyz) + planet.cameraLow.xyz;
  let cosine = clamp(dot(direction, planet.sunDirectionWC.xyz), -1.0, 1.0);
  let phase = mix(cloudPhase(cosine, -0.24), cloudPhase(cosine, 0.70), 0.70);
  let nonuniform = 0.8 * (1.0 - smoothstep(0.0, 18000.0, segment.x));
  var start = 0.0;
  for (var i = 1u; i <= count; i++) {
    if (result.transmission < 0.008) { break; }
    result.primarySteps++;
    let u = f32(i) / f32(count);
    let end = span * mix(u, u*u, nonuniform);
    let ds = end - start;
    // A stationary subpixel phase decorrelates grazing-ray bands without
    // reseeding the volume or changing a pixel's value on a paused camera.
    let midpoint = mix(start, end, 0.5 + jitter*smoothstep(130.0,1100.0,ds));
    start = end;
    let p = fma(direction, vec3f(midpoint), anchor);
    let t = segment.x + midpoint;
    let footprint = max(t * angularPixel, ds * 0.22);
    // Local clouds stay in ECEF. Only their optical weight follows the view.
    let localExtinction = cloudDensity(p, footprint, clouds.weather, clouds.shape);
    let sigma = cloudVisibleExtinction(localExtinction, t);
    if (sigma <= 0.0) { continue; }
    let attenuation = exp(-sigma * ds);
    let weight = result.transmission * (1.0 - attenuation);
    let scaled = p * planet.inverseRadii.xyz;
    let normal = normalize(scaled * planet.inverseRadii.xyz);
    let height = length(p) * (1.0 - 1.0 / length(scaled));
    let layerHeight = clamp((height - 2000.0) / 4000.0, 0.0, 1.0);
    let mu = dot(normal, planet.sunDirectionWC.xyz);
    let sunScaled = planet.sunDirectionWC.xyz * planet.inverseRadii.xyz;
    // In scaled WGS84 coordinates the tangent to the unit sphere defines
    // the solar horizon at this sample's altitude. Fade over one solar disk.
    let radius2 = dot(scaled, scaled);
    let horizonMu = -sqrt(max(0.0, 1.0 - 1.0/radius2));
    let scaledMu = dot(scaled, sunScaled) * inverseSqrt(radius2 * dot(sunScaled,sunScaled));
    let sunVisibility = smoothstep(-atmosphere.sun.x, atmosphere.sun.x, scaledMu - horizonMu);
    var diffuseEscape = 1.0;
    if (sunVisibility > 0.0) {
      let tau = cloudLightDepth(p, footprint, localExtinction);
      result.lightSteps += u32(clouds.budget.y);
      // The existing light march also distinguishes exposed lobes from
      // pockets inside the bank. Keep a floor for diffuse skylight there.
      diffuseEscape = exp(-0.72*tau);
      let powder = mix(0.74 + 0.26*(1.0-exp(-sigma*2400.0)), 1.0, smoothstep(0.25,0.9,cosine));
      let single = phase * exp(-tau);
      // Repeated scattering broadens the phase and carries light deeper into a bank.
      // Its contribution builds with intercepted sunlight and fades in opaque cores.
      let penetration = exp(-0.24*tau);
      let scattered = 1.0 - exp(-tau);
      let diffuse = 0.31 * cloudPhase(cosine,0.32)*exp(-0.65*tau)
                  + (0.09 + 0.45*scattered) * penetration;
      let baseLight = mix(0.72, 1.0, smoothstep(0.05,0.5,layerHeight));
      let direct = weight * sunVisibility * (0.76*single + diffuse) * powder * baseLight;
      result.direct += direct;
      result.directDistanceMoment += direct * t;
    }
    let skyVisibility = mix(0.42, 1.0, sqrt(layerHeight)) * mix(0.40, 1.0, diffuseEscape);
    result.skyWeight += weight * skyVisibility;
    result.ambient += weight * skyVisibility * (0.01 + 0.34 * smoothstep(-0.13, 0.38, mu));
    result.distanceMoment += weight * t;
    result.transmission *= attenuation;
  }
  return result;
}

fn cloudTrace(direction: vec3f, pixel: vec2f) -> CloudIntegral {
  let distance = webgpuSceneRayDistance(textureLoad(sceneDepth, vec2i(pixel), 0), direction, planet);
  let range = cloudVisibleRange();
  let limit = select(min(distance, range), range, distance < 0.0);
  let segments = webgpuCloudSegments(direction, limit, clouds.shell, planet);
  var result = CloudIntegral(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0u, 0u);
  let first = segments.y - segments.x;
  if (first <= 0.0) { return result; }
  let second = segments.w - segments.z;
  let steps = u32(clouds.budget.x);
  let angularPixel = 2.0 / (atmosphere.viewport.y * planet.projection.y);
  let jitter = 0.86 * (fract(52.9829189 * fract(dot(floor(pixel), vec2f(0.06711056,0.00583715)))) - 0.5);
  var n = steps;
  if (second > 0.0) { n = clamp(u32(round(f32(steps)*first/(first+second))), 1u, steps-1u); }
  result = cloudMarchSegment(segments.xy, direction, n, angularPixel, jitter, result);
  if (second > 0.0) {
    result = cloudMarchSegment(segments.zw, direction, steps-n, angularPixel, jitter, result);
  }
  return result;
}

fn cloudViewDirection(pixel: vec2f) -> vec3f {
  return webgpuRayDirection(pixel / atmosphere.viewport.xy * vec2f(2.0,-2.0) + vec2f(-1.0,1.0), planet);
}

fn cloudRadiance(ray: vec3f, volume: CloudIntegral) -> vec4f {
  let opacity = 1.0 - volume.transmission;
  if (opacity <= 0.0) { return vec4f(0.0); }
  let distance = volume.distanceMoment / opacity;
  let air = atmosphereIntegrate(ray, distance);
  let p = fma(ray, vec3f(distance), planet.cameraHigh.xyz) + planet.cameraLow.xyz;
  let scaled = p * planet.inverseRadii.xyz;
  let mu = dot(normalize(scaled * planet.inverseRadii.xyz), planet.sunDirectionWC.xyz);
  let height = length(p)*(1.0-1.0/length(scaled));
  var direct = vec3f(0.0);
  if (volume.direct > 0.0) {
    let litDistance = volume.directDistanceMoment / volume.direct;
    let litPoint = fma(ray, vec3f(litDistance), planet.cameraHigh.xyz) + planet.cameraLow.xyz;
    let litScaled = litPoint * planet.inverseRadii.xyz;
    let litHeight = length(litPoint)*(1.0-1.0/length(litScaled));
    let litMu = dot(normalize(litScaled * planet.inverseRadii.xyz), planet.sunDirectionWC.xyz);
    // Reuse the integrated mean air extinction to attenuate light from a
    // more distant crown without marching the atmosphere a second time.
    let litTransmission = pow(max(air.transmittance, vec3f(1e-20)), vec3f(litDistance/distance));
    direct = litTransmission * atmosphereSunTransmittance(litHeight, litMu) * volume.direct;
  }
  // The LUT stores mean incident radiance per unit solar irradiance. Cloud
  // phase uses a unit mean rather than 1/(4*pi), so match its normalization.
  let sky = 12.5663706 * atmosphereMultipleScattering(height, mu);
  let source = clouds.budget.z * (direct + air.transmittance * volume.skyWeight * sky);
  // Approximate a humid aerosol layer around the low clouds. Two points on
  // the sightline estimate the fraction of the path inside the layer.
  let pathHeights = mix(vec2f(planet.cameraLow.w), vec2f(height), vec2f(0.2113, 0.7887));
  let humidity = 1.0 - smoothstep(vec2f(6000.0), vec2f(10000.0), pathHeights);
  let hazeTau = 6.0 * atmosphere.mie.y * distance * dot(humidity, vec2f(0.5));
  let hazeT = exp(-hazeTau);
  // The integrated air provides the directional source color, including at
  // dusk. Extend its optical depth without tinting the background or terrain.
  let hazeColor = air.radiance / max(vec3f(1.0) - air.transmittance, vec3f(1e-4));
  let radiance = hazeT * (source + opacity * air.radiance) + (1.0-hazeT) * opacity * hazeColor;
  return vec4f(radiance, opacity);
}

// Sample the same low-cloud field as the visible banks. March toward the Sun
// through the 2–6 km shell even when a grazing ray reaches it tens of km away.
fn mistSunTransmission(p: vec3f, height: f32, mu: f32) -> f32 {
  let radius = length(p);
  let b = radius * mu;
  let rise = (2000.0-height) * (2.0*radius + 2000.0-height);
  let entry = rise / (b + sqrt(b*b + rise));
  let top = (6000.0-height) * (2.0*radius + 6000.0-height);
  let exitDistance = top / (b + sqrt(b*b + top));
  let ds = (exitDistance-entry) / 6.0;
  var tau = 0.0;
  for (var i = 0u; i < 6u; i++) {
    let sampleP = p + planet.sunDirectionWC.xyz * (entry + (f32(i)+0.5)*ds);
    tau += cloudDensity(sampleP, ds*0.10, clouds.weather, clouds.shape)*ds;
  }
  return exp(-tau);
}

fn cloudMorningMist(ray: vec3f, pixel: vec2f) -> vec4f {
  let camera = planet.cameraHigh.xyz + planet.cameraLow.xyz;
  let up = normalize(camera*planet.inverseRadii.xyz*planet.inverseRadii.xyz);
  let mu = dot(up, planet.sunDirectionWC.xyz);
  let lowSun = smoothstep(0.0, 0.05, mu) * (1.0-smoothstep(0.30, 0.58, mu))
             * smoothstep(0.0,0.18,clouds.weather.x);
  if (lowSun <= 0.0) { return vec4f(0.0); }
  let layer = webgpuCloudBoundary(ray, clouds.shell.innerHigh, clouds.shell.innerLow, planet);
  if (layer.x < 0.0) { return vec4f(0.0); }
  let terrain = webgpuSceneRayDistance(textureLoad(sceneDepth, vec2i(pixel), 0), ray, planet);
  let ground = webgpuRayEllipsoid(ray, planet);
  var end = min(layer.y, 24000.0);
  if (terrain >= 0.0) { end = min(end, terrain); }
  if (ground.x >= 0.0 && ground.y > ground.x) { end = min(end,ground.x); }
  if (end <= layer.x) { return vec4f(0.0); }
  let ds = (end-layer.x)/12.0;
  // Normalize the aerosol phase for a directional irradiance source. Using
  // the cloud phase's unit mean here clips the forward lobe over the horizon.
  let phase = 0.07957747 * cloudPhase(dot(ray,planet.sunDirectionWC.xyz), 0.50);
  let sun = atmosphereSunTransmittance(700.0,mu) * atmosphere.light.x * phase;
  let ambient = 12.5663706 * atmosphereMultipleScattering(700.0,mu) * clouds.budget.z;
  var transmission = 1.0;
  var radiance = vec3f(0.0);
  for (var i=0u; i<12u; i++) {
    let t = layer.x + (f32(i)+0.5)*ds;
    let p = fma(ray,vec3f(t),planet.cameraHigh.xyz) + planet.cameraLow.xyz;
    let height = clamp(length(p)*(1.0 - 1.0/length(p*planet.inverseRadii.xyz)),0.0,1999.0);
    let density = 0.000050 * lowSun * exp(-height/850.0) * (1.0-smoothstep(1200.0,2000.0,height));
    let stepT = exp(-ds*density);
    let sampleMu = dot(normalize(p*planet.inverseRadii.xyz*planet.inverseRadii.xyz), planet.sunDirectionWC.xyz);
    radiance += transmission * (1.0-stepT) * (ambient + sun*mistSunTransmission(p,height,max(sampleMu,0.0)));
    transmission *= stepT;
  }
  return vec4f(radiance, 1.0-transmission);
}

fn cloudInAir(pixel: vec2f) -> vec4f {
  let ray = cloudViewDirection(pixel);
  let cloud = cloudRadiance(ray, cloudTrace(ray, pixel));
  if (clouds.shape.w < 0.5) { return cloud; }
  let mist = cloudMorningMist(ray,pixel);
  if (planet.cameraLow.w < 2000.0) { return mist + (1.0-mist.a)*cloud; }
  return cloud + (1.0-cloud.a)*mist;
}

fn cloudInVacuum(pixel: vec2f) -> vec4f {
  let volume = cloudTrace(cloudViewDirection(pixel), pixel);
  return vec4f(clouds.budget.z * vec3f(volume.direct + volume.ambient), 1.0-volume.transmission);
}

fn cloudNativePixel(pixel: vec2f) -> vec2f {
  let size = atmosphere.viewport.xy;
  return floor(pixel * size / ceil(size/clouds.budget.w)) + 0.5;
}
@fragment fn cloudAir(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  return cloudInAir(cloudNativePixel(pixel.xy));
}
@fragment fn cloudVacuum(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  return cloudInVacuum(cloudNativePixel(pixel.xy));
}

@group(0) @binding(23) var cloudLow: texture_2d<f32>;

// Accumulate compatible neighbors in premultiplied HDR space. At a silhouette
// with no compatible depth, retrace that native pixel instead of bleeding cloud
// across an opaque foreground object.
fn cloudReconstruct(pixel: vec2f) -> vec4f {
  let size = vec2i(textureDimensions(cloudLow));
  let uv = pixel * vec2f(size) / atmosphere.viewport.xy - 0.5;
  let base = vec2i(floor(uv));
  let fraction = fract(uv);
  let depth = textureLoad(sceneDepth, vec2i(pixel), 0);
  let ray = cloudViewDirection(pixel);
  let distance = webgpuSceneRayDistance(depth,ray,planet);
  let hit = ray * distance;
  let position = (planet.cameraHigh.xyz + hit) + planet.cameraLow.xyz;
  let normal = normalize(position * planet.inverseRadii.xyz * planet.inverseRadii.xyz);
  var sum = vec4f(0.0);
  var weight = 0.0;
  for (var y=0; y<=1; y++) {
    for (var x=0; x<=1; x++) {
      let loc = clamp(base + vec2i(x,y), vec2i(0), size-1);
      let source = cloudNativePixel(vec2f(loc)+0.5);
      let neighbor = textureLoad(sceneDepth,vec2i(source),0);
      let neighborRay = cloudViewDirection(source);
      let t = webgpuSceneRayDistance(neighbor,neighborRay,planet);
      if ((t < 0.0) != (distance < 0.0)) { continue; }
      // At grazing angles, adjacent rays to the same terrain have different
      // lengths. Compare displacement across its tangent plane instead.
      var edge = 1.0;
      if (distance >= 0.0) {
        let gap = abs(dot(neighborRay * t - hit, normal));
        let tolerance = max(10.0, 0.015*distance) * max(0.02, abs(dot(neighborRay,normal)));
        edge = 1.0 - smoothstep(tolerance*0.25,tolerance,gap);
      }
      let w = edge*select(1.0-fraction.x,fraction.x,x==1)*select(1.0-fraction.y,fraction.y,y==1);
      sum += w * textureLoad(cloudLow,loc,0);
      weight += w;
    }
  }
  if (weight < 0.001) { return vec4f(0.0,0.0,0.0,-1.0); }
  return sum/weight;
}
@fragment fn resolveCloudAir(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let sample = cloudReconstruct(pixel.xy);
  if (sample.a < 0.0) { return cloudInAir(pixel.xy); }
  return sample;
}
@fragment fn resolveCloudVacuum(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let sample = cloudReconstruct(pixel.xy);
  if (sample.a < 0.0) { return cloudInVacuum(pixel.xy); }
  return sample;
}

@group(0) @binding(20) var<uniform> probePixel: vec2u;
@group(0) @binding(21) var<storage, read_write> probeSteps: vec2u;
@compute @workgroup_size(1) fn countCloudSteps() {
  let pixel = vec2f(probePixel) + vec2f(0.5);
  let volume = cloudTrace(cloudViewDirection(pixel), pixel);
  probeSteps = vec2u(volume.primarySteps, volume.lightSteps);
}
`;

export default WebGPUCloudVolumeShader;
