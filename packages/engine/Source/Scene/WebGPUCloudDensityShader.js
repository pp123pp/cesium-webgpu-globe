import WebGPUCloudLayerShader from "./WebGPUCloudLayerShader.js";

/**
 * Shared cloud extinction field. Positions and sample footprints are meters.
 * Weather and 3D structure advect together around the supplied ECEF wind axis.
 * @private
 */
const WebGPUCloudDensityShader = `
fn cloudWindPosition(p: vec3f, weather: vec4f) -> vec3f {
  let axis = vec3f(sin(weather.w), 0.0, cos(weather.w));
  let c = cos(weather.y);
  let s = sin(weather.y);
  return p * c - cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

// A direction on the unit sphere has a single weather value, including at the
// antimeridian and both poles. The warp bends broad regional systems into fronts.
fn cloudRegionalWeather(n: vec3f, coverage: f32) -> vec4f {
  let warp = textureSampleLevel(cloudNoise, cloudSampler, n * 0.54 + vec3f(0.21, 0.70, 0.35), 0.0);
  let bent = n + 0.15 * (warp.rgb - vec3f(0.48));
  let front = textureSampleLevel(cloudNoise, cloudSampler,
    bent * vec3f(1.16, 0.93, 1.60) + vec3f(0.27, 0.35, 0.76), 0.0);
  let regional = 0.69 * front.r + 0.20 * warp.r + 0.11 * front.g;
  let development = smoothstep(0.22, 0.70, 0.68 * warp.r + 0.32 * front.b);
  let moisture = smoothstep(0.26, 0.68, regional);
  let cover = coverage * (0.34 + 0.66 * moisture);
  let base = 2120.0 + 530.0 * (1.0 - development);
  let top = min(5970.0, base + 1950.0 + 1400.0 * development);
  return vec4f(cover, base, top, development);
}

// Rounded intersection of two signed interior distances, in meters.
fn cloudRoundJoin(a: f32, b: f32, radius: f32) -> f32 {
  let overlap = max(radius - abs(a - b), 0.0) / radius;
  return min(a, b) - 0.25 * radius * overlap * overlap;
}

// The phase belongs to the advected cloud column. Neighboring updrafts grow
// and dissipate at different times, independently of camera position or FPS.
fn cloudGrowth(phase: f32, regional: f32, local: f32) -> f32 {
  if (phase == 0.0) { return 0.0; }
  return sin((phase - 1.0) + 15.0*local + 9.0*regional);
}

fn cloudCirrus(column: vec3f, height: f32, coverage: f32, footprint: f32, phase: f32) -> f32 {
  let warp = textureSampleLevel(cloudNoise, cloudSampler, column / 68400.0, 0.0);
  let bent = column + (warp.rgb - vec3f(0.48)) * 5500.0;
  let veil = textureSampleLevel(cloudNoise, cloudSampler,
    bent.yzx / vec3f(78000.0, 11000.0, 17000.0), 0.0);
  let fibers = textureSampleLevel(cloudNoise, cloudSampler,
    bent.yzx / vec3f(36500.0, 2100.0, 3200.0), 0.0);
  let detail = 1.0 - smoothstep(180.0, 900.0, footprint);
  let streak = mix(0.26, smoothstep(0.44, 0.71, 0.64*fibers.r + 0.36*fibers.b), detail);
  let ice = smoothstep(0.46 - 0.13*coverage, 0.70,
    veil.r + 0.12*(warp.r - 0.48) + 0.065*cloudGrowth(phase, warp.b, veil.g));
  let center = 9850.0 + 560.0 * (warp.g - 0.48);
  let vertical = 1.0 - smoothstep(0.0, 460.0, abs(height - center));
  return 0.00013 * coverage * vertical * ice * (0.05 + 0.95*streak);
}

fn cloudDensity(p: vec3f, footprint: f32, weather: vec4f, shape: vec4f) -> f32 {
  if (weather.x <= 0.0) { return 0.0; }
  let scaledRadius = length(p * planet.inverseRadii.xyz);
  let height = (scaledRadius - 1.0) * (length(p) / scaledRadius);
  if (height > 9000.0 && height < 11000.0 && shape.y > 0.5) {
    return cloudCirrus(cloudWindPosition(p, weather) / scaledRadius, height, weather.x, footprint, shape.z);
  }
  if (height <= 2000.0 || height >= 6000.0) { return 0.0; }

  let advected = cloudWindPosition(p, weather);
  let field = cloudRegionalWeather(normalize(advected), weather.x);
  if (height <= field.y || height >= field.z) { return 0.0; }

  // Carry regional weather into broad, distorted banks before resolving
  // individual updrafts. Direction-space weather and surface-space banks
  // both advect with the 3D lobes throughout the height of the layer.
  let column = advected / scaledRadius;
  let bank = textureSampleLevel(cloudNoise, cloudSampler, column / 95500.0, 0.0);
  let warped = advected + 8200.0 * (bank.rgb - vec3f(0.48));
  let streets = textureSampleLevel(cloudNoise, cloudSampler,
    (column.yzx + 8200.0 * (bank.gbr - vec3f(0.48))) / vec3f(43100.0, 28200.0, 35800.0), 0.0);
  let cluster = 0.55 * (bank.r - 0.47) + 0.82 * (streets.r - 0.47)
              + 0.19 * (streets.b - 0.48);
  let growth = cloudGrowth(shape.z, bank.b, streets.g);
  if (shape.x > 0.5) {
    // Column noise shapes connected banks with open lanes and small billows
    // on top. Keeping it independent of height gives the deck a level base.
    let cells = textureSampleLevel(cloudNoise, cloudSampler,
      (column + 2100.0 * (bank.brg - vec3f(0.48))) / 12600.0, 0.0);
    let bankFill = cluster + 0.36 * (cells.g - 0.48) + 0.55 * (field.x - 0.25) + 0.035*growth;
    let base = field.y + 160.0 * streets.r;
    let billows = textureSampleLevel(cloudNoise, cloudSampler,
      (column.zxy + 1300.0 * (cells.rgb - vec3f(0.48))) / 7100.0, 0.0);
    let relief = (1.0 - smoothstep(350.0, 1500.0, footprint)) *
      (510.0*(billows.g - 0.48) + 210.0*(billows.b - 0.48));
    let thickness = 420.0 + 870.0 * smoothstep(-0.15, 0.35, bankFill) + relief + 120.0*growth;
    let side = 6300.0 * (bankFill + 0.07);
    let depth = cloudRoundJoin(min(height - base, base + thickness - height), side, 290.0);
    return 0.0022 * smoothstep(0.0, 0.15, weather.x) *
      smoothstep(-35.0, 235.0 + 0.2 * min(footprint, 700.0), depth);
  }
  let bodyWeight = 1.0 - smoothstep(900.0, 3300.0, footprint);
  let bodyP = warped + 3600.0 * (streets.brg - vec3f(0.48));
  let body = textureSampleLevel(cloudNoise, cloudSampler, bodyP / 17900.0, 0.0);
  let lobesWeight = 1.0 - smoothstep(300.0, 1350.0, footprint);
  let lobeP = bodyP.zxy + 1250.0 * (body.rgb - vec3f(0.48));
  let lobes = textureSampleLevel(cloudNoise, cloudSampler, lobeP / 8300.0, 0.0);
  // G stores 1 minus distance to a cell center. Its squared distance has
  // zero slope at the center, so a rising lobe rounds over at its crown.
  let bodyDistance = 1.0 - body.g;
  let lobeDistance = 1.0 - lobes.g;
  let dilation = bodyWeight * (0.60 * (body.r - 0.47) + 0.54 * (0.27 - bodyDistance * bodyDistance))
               + lobesWeight * (0.38 * (lobes.r - 0.47) + 0.62 * (0.27 - lobeDistance * lobeDistance));
  let base = field.y + 220.0 * bank.r + 180.0 * streets.r;
  let extent = field.z - base;
  let wisps = weather.z * 0.036 * lobesWeight;
  let rise = 0.28 + 0.35 * field.x + 1.05 * cluster + 1.80 * dilation + wisps + 0.14*growth;
  // Compress tall updrafts below the regional ceiling instead of slicing
  // every overshooting crown at exactly the same altitude.
  let top = extent * (min(rise, 0.65) + 0.35 * (1.0 - exp(-max(rise - 0.65, 0.0) / 0.35)));
  let side = 4700.0 * (0.095 + 0.24 * field.x + cluster + 0.88 * dilation + wisps + 0.055*growth);
  let aboveBase = height - base;
  let depth = cloudRoundJoin(min(top - aboveBase, aboveBase), side, 580.0);
  if (depth <= -65.0) { return 0.0; }

  // Erosion moves the density boundary at the sides, crown and underside.
  // Fully condensed cores bypass those texture reads and keep their mass.
  let edgeWeight = 1.0 - smoothstep(150.0, 1000.0, footprint);
  let fineWeight = 1.0 - smoothstep(55.0, 325.0, footprint);
  var erosion = 0.0;
  if (depth < 1350.0 && edgeWeight > 0.0) {
    let detailP = lobeP + 590.0 * (lobes.bgr - vec3f(0.48));
    let detail = textureSampleLevel(cloudNoise, cloudSampler, detailP / 4100.0, 0.0);
    // Carve the gaps between cells. Their dense centers stay convex and
    // scatter light into the smaller billows along the larger bank.
    let gap = 1.0 - detail.g;
    erosion = 990.0 * gap * gap + 220.0 * (1.0 - detail.r);
    if (fineWeight > 0.0) {
      let fringe = textureSampleLevel(cloudNoise, cloudSampler, detailP.zxy / 1480.0, 0.0);
      erosion += 340.0 * fineWeight * (0.52 - dot(fringe.gb, vec2f(0.70, 0.30)));
    }
    erosion *= edgeWeight * mix(0.68, 1.0, smoothstep(0.0, 600.0, aboveBase))
             * (1.0 - smoothstep(950.0, 1350.0, depth));
  }
  let edgeWidth = 235.0 + min(footprint, 750.0) * 0.24;
  let condensed = depth - erosion;
  let boundary = smoothstep(-65.0, edgeWidth, condensed);
  let core = 0.34 + 0.66 * smoothstep(100.0, 1100.0, condensed);
  return 0.00140 * smoothstep(0.0, 0.15, weather.x) * (0.62 + 0.38 * field.x) * boundary * core;
}
`;

const cloudFieldShader = `${WebGPUCloudLayerShader}
struct CloudVolume {
  shell: WebGPUCloudLayer,
  weather: vec4f,
  budget: vec4f, // primary steps, light steps, normalized solar irradiance
  shape: vec4f, // stratocumulus, cirrus, evolution phase, mist
}
@group(0) @binding(17) var<uniform> clouds: CloudVolume;
@group(0) @binding(18) var cloudNoise: texture_3d<f32>;
@group(0) @binding(19) var cloudSampler: sampler;

fn cloudVisibleRange() -> f32 {
  return mix(60000.0,250000.0,smoothstep(10000.0,120000.0,planet.cameraLow.w));
}

fn cloudVisibleExtinction(extinction: f32, distanceToCamera: f32) -> f32 {
  let visibleRange = cloudVisibleRange();
  let rangeWeight = 1.0 - smoothstep(visibleRange*0.42, visibleRange, distanceToCamera);
  let altitudeWeight = 1.0 - smoothstep(80000.0, 250000.0, planet.cameraLow.w);
  return extinction * rangeWeight * altitudeWeight;
}

${WebGPUCloudDensityShader}`;

export { cloudFieldShader };
export default WebGPUCloudDensityShader;
