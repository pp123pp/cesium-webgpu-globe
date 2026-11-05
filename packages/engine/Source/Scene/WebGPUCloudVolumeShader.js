import WebGPUAtmosphereShader from "./WebGPUAtmosphereShader.js";
import WebGPUCloudLayerShader from "./WebGPUCloudLayerShader.js";
import WebGPUCloudDensityShader from "./WebGPUCloudDensityShader.js";

// Separate entry points let the vacuum path operate without atmosphere LUTs.
const WebGPUCloudVolumeShader = `${WebGPUAtmosphereShader}
${WebGPUCloudLayerShader}
struct CloudVolume {
  shell: WebGPUCloudLayer,
  weather: vec4f,
  budget: vec4f, // primary steps, light steps, normalized solar irradiance
}
@group(0) @binding(17) var<uniform> clouds: CloudVolume;
@group(0) @binding(18) var cloudNoise: texture_3d<f32>;
@group(0) @binding(19) var cloudSampler: sampler;
${WebGPUCloudDensityShader}

struct CloudIntegral {
  // Separate direct and ambient allow one atmospheric sunlight lookup per pixel.
  direct: f32,
  ambient: f32,
  transmission: f32,
  distanceMoment: f32,
  primarySteps: u32,
  lightSteps: u32,
}

fn cloudLightDepth(p: vec3f, footprint: f32) -> f32 {
  let count = u32(clouds.budget.y);
  var opticalDepth = 0.0;
  var start = 0.0;
  for (var i = 1u; i <= count; i++) {
    let u = f32(i) / f32(count);
    let end = 6400.0 * u * u;
    let sampleP = p + planet.sunDirectionWC.xyz * ((start + end) * 0.5);
    opticalDepth += cloudDensity(sampleP, max(footprint, (end-start)*0.2), clouds.weather) * (end - start);
    start = end;
  }
  return opticalDepth;
}

fn cloudPhase(mu: f32, g: f32) -> f32 {
  return (1.0-g*g) / pow(1.0+g*g-2.0*g*mu, 1.5);
}

fn cloudMarchSegment(segment: vec2f, direction: vec3f, count: u32, angularPixel: f32,
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
    let midpoint = (start + end) * 0.5;
    let ds = end - start;
    start = end;
    let p = fma(direction, vec3f(midpoint), anchor);
    let t = segment.x + midpoint;
    let footprint = max(t * angularPixel, ds * 0.22);
    // Local clouds stay in ECEF. Only their optical weight follows the view.
    let rangeWeight = 1.0 - smoothstep(80000.0, 250000.0, t);
    let altitudeWeight = 1.0 - smoothstep(80000.0, 250000.0, planet.cameraLow.w);
    let sigma = cloudDensity(p, footprint, clouds.weather) * rangeWeight * altitudeWeight;
    if (sigma <= 0.0) { continue; }
    let attenuation = exp(-sigma * ds);
    let weight = result.transmission * (1.0 - attenuation);
    let scaled = p * planet.inverseRadii.xyz;
    let normal = normalize(scaled * planet.inverseRadii.xyz);
    let height = length(p) * (1.0 - 1.0 / length(scaled));
    let layerHeight = clamp((height - 2000.0) / 4000.0, 0.0, 1.0);
    let mu = dot(normal, planet.sunDirectionWC.xyz);
    let sunScaled = planet.sunDirectionWC.xyz * planet.inverseRadii.xyz;
    let b = dot(scaled, sunScaled);
    let earthBlocksSun = b < 0.0 && b*b > dot(sunScaled,sunScaled) * (dot(scaled,scaled)-1.0);
    if (!earthBlocksSun) {
      let tau = cloudLightDepth(p, footprint);
      result.lightSteps += u32(clouds.budget.y);
      // Diffuse orders retain light in optically thick crowns. Side-lit thin
      // edges keep their forward lobe while dense undersides receive less sky.
      let powder = mix(0.74 + 0.26*(1.0-exp(-sigma*2400.0)), 1.0, smoothstep(0.25,0.9,cosine));
      let single = phase * exp(-tau);
      let diffuse = 0.36 * cloudPhase(cosine,0.32)*exp(-0.44*tau) + 0.12*exp(-0.18*tau);
      let baseLight = mix(0.72, 1.0, smoothstep(0.05,0.5,layerHeight));
      result.direct += weight * (0.76*single + diffuse) * powder * baseLight;
    }
    let skyVisibility = mix(0.47, 1.0, sqrt(layerHeight));
    result.ambient += weight * skyVisibility * (0.01 + 0.34 * smoothstep(-0.13, 0.38, mu));
    result.distanceMoment += weight * t;
    result.transmission *= attenuation;
  }
  return result;
}

fn cloudTrace(direction: vec3f, pixel: vec2f) -> CloudIntegral {
  let distance = webgpuSceneRayDistance(textureLoad(sceneDepth, vec2i(pixel), 0), direction, planet);
  let limit = select(min(distance, 250000.0), 250000.0, distance < 0.0);
  let segments = webgpuCloudSegments(direction, limit, clouds.shell, planet);
  var result = CloudIntegral(0.0, 0.0, 1.0, 0.0, 0u, 0u);
  let first = segments.y - segments.x;
  if (first <= 0.0) { return result; }
  let second = segments.w - segments.z;
  let steps = u32(clouds.budget.x);
  let angularPixel = 2.0 / (atmosphere.viewport.y * planet.projection.y);
  var n = steps;
  if (second > 0.0) { n = clamp(u32(round(f32(steps)*first/(first+second))), 1u, steps-1u); }
  result = cloudMarchSegment(segments.xy, direction, n, angularPixel, result);
  if (second > 0.0) {
    result = cloudMarchSegment(segments.zw, direction, steps-n, angularPixel, result);
  }
  return result;
}

fn cloudViewDirection(pixel: vec2f) -> vec3f {
  return webgpuRayDirection(pixel / atmosphere.viewport.xy * vec2f(2.0,-2.0) + vec2f(-1.0,1.0), planet);
}

@fragment fn cloudAir(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let ray = cloudViewDirection(pixel.xy);
  let volume = cloudTrace(ray, pixel.xy);
  let opacity = 1.0 - volume.transmission;
  if (opacity <= 0.0) { return vec4f(0.0); }
  let distance = volume.distanceMoment / opacity;
  let air = atmosphereIntegrate(ray, distance);
  let p = fma(ray, vec3f(distance), planet.cameraHigh.xyz) + planet.cameraLow.xyz;
  let scaled = p * planet.inverseRadii.xyz;
  let mu = dot(normalize(scaled * planet.inverseRadii.xyz), planet.sunDirectionWC.xyz);
  let height = clamp(length(p)*(1.0-1.0/length(scaled)), 2000.0, 6000.0);
  let direct = atmosphereSunTransmittance(height, mu) * volume.direct;
  let source = clouds.budget.z * (direct + volume.ambient * vec3f(0.72,0.83,1.0));
  return vec4f(air.transmittance * source + opacity * air.radiance, opacity);
}

@fragment fn cloudVacuum(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let volume = cloudTrace(cloudViewDirection(pixel.xy), pixel.xy);
  return vec4f(clouds.budget.z * vec3f(volume.direct + volume.ambient), 1.0-volume.transmission);
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
