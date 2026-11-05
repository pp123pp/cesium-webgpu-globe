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

fn cloudDensity(p: vec3f, footprint: f32, weather: vec4f) -> f32 {
  if (weather.x <= 0.0) { return 0.0; }
  let scaledRadius = length(p * planet.inverseRadii.xyz);
  let height = (scaledRadius - 1.0) * (length(p) / scaledRadius);
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
  let rise = 0.28 + 0.35 * field.x + 1.05 * cluster + 1.80 * dilation + wisps;
  // Compress tall updrafts below the regional ceiling instead of slicing
  // every overshooting crown at exactly the same altitude.
  let top = extent * (min(rise, 0.65) + 0.35 * (1.0 - exp(-max(rise - 0.65, 0.0) / 0.35)));
  let side = 4700.0 * (0.095 + 0.24 * field.x + cluster + 0.88 * dilation + wisps);
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

export default WebGPUCloudDensityShader;
