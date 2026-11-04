
fn srgbToLinear(value: vec3f) -> vec3f {
  return select(pow((value + 0.055) / 1.055, vec3f(2.4)), value / 12.92,
                value <= vec3f(0.04045));
}
struct Tile { matrix: mat4x4f, clip: vec4f, color: vec4f }
@group(0) @binding(0) var<uniform> tile: Tile;
struct VertexOutput {
  @builtin(position) @invariant position: vec4f,
  @location(0) uv: vec2f,
  @location(1) mercatorT: f32,
}
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f,
  @location(2) mercatorT: f32) -> VertexOutput {
  var output: VertexOutput;
  output.position = tile.matrix * vec4f(position, 1.0);
  output.uv = uv;
  output.mercatorT = mercatorT;
  return output;
}
fn outside(uv: vec2f, rectangle: vec4f) -> bool {
  // Full tiles include native skirts. Do not clip their interpolated edge UVs:
  // float interpolation can overshoot [0,1] and cut a one-pixel crack in a skirt.
  // Internal boundaries are identical in geometry and imagery. Expanding only
  // terrain coverage writes depth where its imagery is excluded, leaving a
  // bare pixel that a neighboring tile's imagery cannot repair.
  return (rectangle.x > 0.0 && uv.x < rectangle.x) ||
         (rectangle.y > 0.0 && uv.y < rectangle.y) ||
         (rectangle.z < 1.0 && uv.x >= rectangle.z) ||
         (rectangle.w < 1.0 && uv.y >= rectangle.w);
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (outside(input.uv, tile.clip)) { discard; }
  return vec4f(srgbToLinear(tile.color.rgb), tile.color.a);
}
struct Image { rectangle: vec4f, mapping: vec4f, config: vec4f, mercator: vec4f }
@group(1) @binding(0) var dayTexture: texture_2d<f32>;
@group(1) @binding(1) var daySampler: sampler;
@group(1) @binding(2) var<uniform> imagery: Image;
@fragment fn imageryMain(input: VertexOutput) -> @location(0) vec4f {
  if (outside(input.uv, tile.clip)) { discard; }
  var t = input.uv.y;
  if (imagery.config.y == 1.0) { t = input.mercatorT; }
  var angle = 0.0;
  if (imagery.config.y >= 2.0) {
    let latitude = clamp(imagery.config.z + input.uv.y * imagery.config.w,
                         -1.4844222297453324, 1.4844222297453324);
    angle = log(tan(0.7853981633974483 + latitude * 0.5));
    if (imagery.config.y == 3.0) {
      t = (angle - imagery.mercator.z) * imagery.mercator.w;
    }
  }
  if (outside(vec2f(input.uv.x, t), imagery.rectangle)) { discard; }
  var uv = vec2f(input.uv.x, t) * imagery.mapping.zw + imagery.mapping.xy;
  if (imagery.config.y == 2.0) {
    // Polar terrain does not have a native Mercator attribute. Reproject its
    // geographic latitude, clamping the base layer to the Mercator edge.
    uv.y = (angle - imagery.mercator.x) * imagery.mercator.y;
  }
  let texel = textureSample(dayTexture, daySampler, uv);
  return vec4f(srgbToLinear(texel.rgb), texel.a * imagery.config.x);
}