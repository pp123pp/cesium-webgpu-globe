
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
  moonDirectionWC: vec4f,       // camera-to-Moon unit direction, angular radius rad
  moon: vec4f,                  // phase fraction, camera distance, star intensity, moonlight intensity
  starRotation0: vec4f,         // ICRF-from-ECEF rotation row 0
  starRotation1: vec4f,         // ICRF-from-ECEF rotation row 1
  starRotation2: vec4f,         // ICRF-from-ECEF rotation row 2
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


struct BloomParameters {
  exposure: f32,
  strength: f32,
  padding: vec2f,
}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex fn bloomVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(points[index], 0.0, 1.0);
}

// 4x4 source footprint averages into quarter-resolution HDR. Thresholding is
// performed on linear scene values before exposure and tone mapping.
@fragment fn bloomExtract(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let origin = vec2i(position.xy) * 4;
  var contribution = vec3f(0.0);
  // Extract each source texel BEFORE downsampling. Even bilinear filtering
  // before the threshold can erase a small HDR highlight completely.
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      let pixel = clamp(origin + vec2i(x, y), vec2i(0), size - 1);
      let color = max(textureLoad(sourceTexture, pixel, 0).rgb, vec3f(0.0));
      let brightness = max(color.r, max(color.g, color.b));
      // Scene-linear threshold 1.0 with a 0.5-wide knee on either side.
      // Both value and slope join continuously: black/dim space stays zero,
      // while highlights >= 1.5 retain the previous extracted energy.
      let knee = clamp(brightness - 0.5, 0.0, 1.0);
      let excess = max(brightness - 1.0, knee * knee * 0.5);
      contribution += color * excess / max(brightness, 1.0e-5);
    }
  }
  return vec4f(contribution / 16.0, 1.0);
}

fn bloomBlurRow(uv: vec2f, texel: vec2f) -> vec3f {
  // Bilinear pairs reconstruct the normalized [1,4,6,4,1]/16 kernel.
  // Fractional offsets cover adjacent texels instead of copying a small
  // highlight into disconnected diagonal lobes.
  let offset = vec2f(texel.x * 1.2, 0.0);
  return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).rgb * 0.375 +
    (textureSampleLevel(sourceTexture, sourceSampler, uv - offset, 0.0).rgb +
     textureSampleLevel(sourceTexture, sourceSampler, uv + offset, 0.0).rgb) * 0.3125;
}

@fragment fn bloomBlur(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let uv = position.xy / size;
  let texel = 1.0 / size;
  let offset = vec2f(0.0, texel.y * 1.2);
  // One compact, energy-normalized 5x5 filter, nine bilinear samples. Reuses
  // the existing quarter-resolution target and single blur pass.
  let blurred = bloomBlurRow(uv, texel) * 0.375 +
    (bloomBlurRow(uv - offset, texel) + bloomBlurRow(uv + offset, texel)) * 0.3125;
  return vec4f(blurred, 1.0);
}

struct FinalParameters {
  exposure: f32,
  strength: f32,
  padding: vec2f,
}
@group(0) @binding(2) var blurredBloom: texture_2d<f32>;
@group(0) @binding(3) var<uniform> finalParameters: FinalParameters;
@group(0) @binding(4) var bloomDepth: texture_depth_2d;
@group(0) @binding(5) var<uniform> bloomPlanet: WebGPUPlanet;

fn bloomAces(value: vec3f) -> vec3f {
  let x = max(value, vec3f(0.0)) * finalParameters.exposure;
  return clamp((x * (2.51 * x + 0.03)) /
    (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn bloomSrgb(value: vec3f) -> vec3f {
  let color = max(value, vec3f(0.0));
  return select(1.055 * pow(color, vec3f(1.0 / 2.4)) - 0.055,
    color * 12.92, color <= vec3f(0.0031308));
}
@fragment fn bloomFinal(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let uv = position.xy / size;
  let coordinate = vec2i(position.xy);
  let scene = textureLoad(sourceTexture, coordinate, 0).rgb;
  var bloom = vec3f(0.0);
  // Blur spreads source energy across pixels. Reapply receiver visibility after
  // filtering so sky glow cannot paint foreground terrain or an unloaded Earth.
  // This bounded solar Bloom intentionally does not add light over surfaces.
  if (finalParameters.strength > 0.0 && textureLoad(bloomDepth, coordinate, 0) == 0.0) {
    let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let ray = webgpuRayDirection(ndc, bloomPlanet);
    let earth = webgpuRayEllipsoid(ray, bloomPlanet);
    if (earth.x < 0.0 || earth.y <= 0.0) {
      bloom = textureSampleLevel(blurredBloom, sourceSampler, uv, 0.0).rgb;
    }
  }
  return vec4f(bloomSrgb(bloomAces(scene + bloom * finalParameters.strength)), 1.0);
}
