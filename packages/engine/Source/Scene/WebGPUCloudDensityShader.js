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
  let cover = smoothstep(0.47, 0.68, regional + (coverage - 0.50) * 0.82);
  let development = smoothstep(0.22, 0.70, 0.68 * warp.r + 0.32 * front.b);
  let base = 2050.0 + 780.0 * (1.0 - development);
  let top = min(5975.0, base + 700.0 + 1820.0 * development + 1410.0 * cover);
  return vec4f(cover, base, top, development);
}

fn cloudDensity(p: vec3f, footprint: f32, weather: vec4f) -> f32 {
  if (weather.x <= 0.0) { return 0.0; }
  let scaledRadius = length(p * planet.inverseRadii.xyz);
  let height = (scaledRadius - 1.0) * (length(p) / scaledRadius);
  if (height <= 2000.0 || height >= 6000.0) { return 0.0; }

  let advected = cloudWindPosition(p, weather);
  let field = cloudRegionalWeather(normalize(advected), weather.x);
  if (field.x <= 0.0 || height <= field.y || height >= field.z) { return 0.0; }
  let h = (height - field.y) / (field.z - field.y);
  let profile = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.48 + 0.25 * field.w, 1.0, h));

  // A pixel or ray step wider than a feature integrates its mean. Filtering
  // each octave before thresholding avoids changing to a separate orbital field.
  let regionWeight = 1.0 - smoothstep(6000.0, 26000.0, footprint);
  var regionalShape = 0.47;
  if (regionWeight > 0.0) {
    let bank = textureSampleLevel(cloudNoise, cloudSampler,
      advected / 118000.0 + vec3f(0.13, 0.48, 0.75), 0.0);
    regionalShape = mix(regionalShape, bank.r, regionWeight);
  }
  let bodyWeight = 1.0 - smoothstep(650.0, 4400.0, footprint);
  var body = 0.47;
  if (bodyWeight > 0.0) {
    let shape = textureSampleLevel(cloudNoise, cloudSampler, advected / 24200.0, 0.0);
    body = mix(body, 0.63 * shape.r + 0.37 * shape.g, bodyWeight);
  }
  let wisps = weather.z * bodyWeight * (1.0 - field.x) * smoothstep(0.0, 0.16, field.x);
  let threshold = mix(0.61, 0.22, field.x) - 0.12 * wisps;
  let signal = 0.58 * regionalShape + 0.42 * body + 0.18 * (profile - 0.5);
  let filteredWidth = mix(0.14, 0.055, regionWeight);
  var cloud = smoothstep(threshold - filteredWidth, threshold + filteredWidth, signal);
  let edgeWeight = 1.0 - smoothstep(65.0, 580.0, footprint);
  if (cloud > 0.0 && edgeWeight > 0.0) {
    let erosion = textureSampleLevel(cloudNoise, cloudSampler, advected / 7400.0, 0.0);
    let cavities = 0.55 * erosion.g + 0.30 * erosion.b + 0.15 * erosion.a;
    cloud *= mix(1.0, smoothstep(-0.16, 0.48, cloud - (cavities - 0.15)), edgeWeight);
  }
  return 0.0016 * cloud * profile * field.x * (0.64 + 0.36 * field.w);
}
`;

export default WebGPUCloudDensityShader;
