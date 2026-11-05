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

fn cloudDensity(p: vec3f, footprint: f32, weather: vec4f) -> f32 {
  if (weather.x <= 0.0) { return 0.0; }
  let scaledRadius = length(p * planet.inverseRadii.xyz);
  let height = (scaledRadius - 1.0) * (length(p) / scaledRadius);
  if (height <= 2000.0 || height >= 6000.0) { return 0.0; }

  let advected = cloudWindPosition(p, weather);
  let field = cloudRegionalWeather(normalize(advected), weather.x);
  if (height <= field.y || height >= field.z) { return 0.0; }

  // Sample columns on the ellipsoid so a single updraft has a level
  // condensation base and a lifted crown that stays over its parent cloud.
  let column = advected / scaledRadius;
  let bank = textureSampleLevel(cloudNoise, cloudSampler, column / 83500.0, 0.0);
  let movingP = advected + 2600.0 * (bank.rgb - vec3f(0.48));
  let bentColumn = column + 2600.0 * (bank.rgb - vec3f(0.48));
  let cellWeight = 1.0 - smoothstep(950.0, 3200.0, footprint);
  let cell = textureSampleLevel(cloudNoise, cloudSampler, bentColumn / 19700.0, 0.0);
  let updraft = mix(0.48, 0.62 * cell.g + 0.38 * cell.r, cellWeight);
  let shoulder = 0.12 * (bank.r - 0.47) + 0.045 * weather.z * cellWeight;
  let strength = smoothstep(0.50 - field.x * 0.19, 0.76 - field.x * 0.14, updraft + shoulder);
  let filteredFill = (1.0 - cellWeight) * (0.13 + 0.48 * field.x);
  let fill = max(strength, filteredFill);
  if (fill <= 0.0) { return 0.0; }

  let base = field.y + 140.0 * bank.r;
  let normalizedHeight = (height - base) / (field.z - base);
  let shapeWeight = 1.0 - smoothstep(260.0, 1450.0, footprint);
  let lobes = textureSampleLevel(cloudNoise, cloudSampler, movingP / 10200.0, 0.0);
  let crown = 0.08 + 0.88 * sqrt(fill) + (lobes.g - 0.48) * 0.30 * shapeWeight;
  let capDepth = (crown - normalizedHeight) * (field.z - base);
  if (height <= base || capDepth <= 0.0) { return 0.0; }
  let lower = smoothstep(0.0, 170.0, height - base);
  let upper = smoothstep(0.0, 540.0, capDepth);

  let erosionWeight = 1.0 - smoothstep(80.0, 580.0, footprint);
  var erosion = 0.0;
  if (erosionWeight > 0.0) {
    let detail = textureSampleLevel(cloudNoise, cloudSampler, movingP / 4900.0, 0.0);
    erosion = (dot(detail.gba, vec3f(0.58, 0.29, 0.13)) - 0.20) * erosionWeight;
  }
  let core = (0.40 + 0.60 * fill) * upper;
  let billows = 1.0 + (lobes.r - 0.47) * 1.25 * shapeWeight;
  let body = max(0.0, core * billows - erosion * (1.0 - core) * 0.8);
  return 0.00112 * smoothstep(0.0, 0.15, weather.x) * (0.62 + field.x * 0.38) * fill * lower * body;
}
`;

export default WebGPUCloudDensityShader;
