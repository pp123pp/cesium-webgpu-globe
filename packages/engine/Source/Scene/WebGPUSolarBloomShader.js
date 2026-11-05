import WebGPUPlanetShader from "./WebGPUPlanetShader.js";
import WebGPULensFlareShader from "./WebGPULensFlareShader.js";

/** Low-resolution scene-linear HDR bloom and final ACES/sRGB output. @private */
const WebGPUSolarBloomShader = `${WebGPUPlanetShader}

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
fn bloomLinear(position: vec4f) -> vec3f {
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
  return scene + bloom * finalParameters.strength;
}
@fragment fn bloomFinal(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return vec4f(bloomSrgb(bloomAces(bloomLinear(position))), 1.0);
}
${WebGPULensFlareShader}
`;

export default WebGPUSolarBloomShader;
