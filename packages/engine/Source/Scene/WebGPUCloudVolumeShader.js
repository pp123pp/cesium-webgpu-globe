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

fn cloudLightDepth(p: vec3f, footprint: f32, localExtinction: f32) -> f32 {
  let count = u32(clouds.budget.y);
  // Account for near-field self shadow before spreading samples over the bank.
  var opticalDepth = localExtinction * 75.0;
  var start = 75.0;
  for (var i = 1u; i <= count; i++) {
    let u = f32(i) / f32(count);
    let end = 75.0 + 6325.0 * u * u * u;
    let sampleP = p + planet.sunDirectionWC.xyz * ((start + end) * 0.5);
    opticalDepth += cloudDensity(sampleP, max(footprint, (end-start)*0.2), clouds.weather) * (end - start);
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
    let visibleRange = mix(60000.0,250000.0,smoothstep(10000.0,120000.0,planet.cameraLow.w));
    let rangeWeight = 1.0 - smoothstep(visibleRange*0.42, visibleRange, t);
    let altitudeWeight = 1.0 - smoothstep(80000.0, 250000.0, planet.cameraLow.w);
    let localExtinction = cloudDensity(p, footprint, clouds.weather);
    let sigma = localExtinction * rangeWeight * altitudeWeight;
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
    var diffuseEscape = 1.0;
    if (!earthBlocksSun) {
      let tau = cloudLightDepth(p, footprint, localExtinction);
      result.lightSteps += u32(clouds.budget.y);
      // The existing light march also distinguishes exposed lobes from
      // pockets inside the bank. Keep a floor for diffuse skylight there.
      diffuseEscape = exp(-0.72*tau);
      let powder = mix(0.74 + 0.26*(1.0-exp(-sigma*2400.0)), 1.0, smoothstep(0.25,0.9,cosine));
      let single = phase * exp(-tau);
      let diffuse = 0.31 * cloudPhase(cosine,0.32)*exp(-0.65*tau) + 0.09*exp(-0.24*tau);
      let baseLight = mix(0.72, 1.0, smoothstep(0.05,0.5,layerHeight));
      result.direct += weight * (0.76*single + diffuse) * powder * baseLight;
    }
    let skyVisibility = mix(0.42, 1.0, sqrt(layerHeight)) * mix(0.40, 1.0, diffuseEscape);
    result.ambient += weight * skyVisibility * (0.01 + 0.34 * smoothstep(-0.13, 0.38, mu));
    result.distanceMoment += weight * t;
    result.transmission *= attenuation;
  }
  return result;
}

fn cloudTrace(direction: vec3f, pixel: vec2f) -> CloudIntegral {
  let distance = webgpuSceneRayDistance(textureLoad(sceneDepth, vec2i(pixel), 0), direction, planet);
  let range = mix(60000.0,250000.0,smoothstep(10000.0,120000.0,planet.cameraLow.w));
  let limit = select(min(distance, range), range, distance < 0.0);
  let segments = webgpuCloudSegments(direction, limit, clouds.shell, planet);
  var result = CloudIntegral(0.0, 0.0, 1.0, 0.0, 0u, 0u);
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

fn cloudInAir(pixel: vec2f) -> vec4f {
  let ray = cloudViewDirection(pixel);
  let volume = cloudTrace(ray, pixel);
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
