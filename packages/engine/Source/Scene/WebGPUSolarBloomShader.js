/** Low-resolution scene-linear HDR bloom and final ACES/sRGB output. @private */
const WebGPUSolarBloomShader = `
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
  let sourceSize = vec2f(textureDimensions(sourceTexture));
  let outputSize = max(ceil(sourceSize / 4.0), vec2f(1.0));
  let uv = position.xy / outputSize;
  let texel = 4.0 / sourceSize;
  var color = textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(-0.25, -0.25), 0.0).rgb;
  color += textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(0.25, -0.25), 0.0).rgb;
  color += textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(-0.25, 0.25), 0.0).rgb;
  color += textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(0.25, 0.25), 0.0).rgb;
  color *= 0.25;
  let brightness = max(color.r, max(color.g, color.b));
  let contribution = color * max(brightness - 1.0, 0.0) / max(brightness, 1.0e-5);
  return vec4f(contribution, 1.0);
}

@fragment fn bloomBlur(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let uv = position.xy / size;
  let texel = 1.0 / size;
  let center = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).rgb * 0.36;
  let diagonals = (
    textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb +
    textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(1.0, -1.0), 0.0).rgb +
    textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(-1.0, 1.0), 0.0).rgb +
    textureSampleLevel(sourceTexture, sourceSampler, uv + texel * vec2f(1.0, 1.0), 0.0).rgb
  ) * 0.16;
  return vec4f(center + diagonals, 1.0);
}

struct FinalParameters {
  exposure: f32,
  strength: f32,
  padding: vec2f,
}
@group(0) @binding(2) var blurredBloom: texture_2d<f32>;
@group(0) @binding(3) var<uniform> finalParameters: FinalParameters;

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
  let scene = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0).rgb;
  let bloom = textureSampleLevel(blurredBloom, sourceSampler, uv, 0.0).rgb;
  return vec4f(bloomSrgb(bloomAces(scene + bloom * finalParameters.strength)), 1.0);
}
`;

export default WebGPUSolarBloomShader;
