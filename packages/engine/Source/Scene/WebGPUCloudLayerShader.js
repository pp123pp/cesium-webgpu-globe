/**
 * Binding-free cloud geometry; compose after WebGPUPlanetShader. CloudLayer's
 * six vec4s carry split inverse radii and camera constants for inner/outer/Earth.
 * Compensated coefficients avoid the broad float32 discriminant band that would
 * collapse short, real orbital limb chords to tangency. Results are ECEF meters.
 * @private
 */
const WebGPUCloudLayerShader = `
struct WebGPUCloudLayer {
  innerHigh: vec4f,
  innerLow: vec4f,
  outerHigh: vec4f,
  outerLow: vec4f,
  earthHigh: vec4f,
  earthLow: vec4f,
}

fn cloudSum(a: vec2f, b: vec2f) -> vec2f {
  let s = a.x + b.x;
  let v = s - a.x;
  let e = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
  let high = s + e;
  return vec2f(high, e - (high - s));
}

fn cloudProduct(a: vec2f, b: vec2f) -> vec2f {
  let p = a.x * b.x;
  // WGSL fma need not retain a fused product residual on every adapter.
  // Split the significands explicitly so the high-high product is exact.
  let ah = bitcast<f32>(bitcast<u32>(a.x) & 0xfffff000u);
  let bh = bitcast<f32>(bitcast<u32>(b.x) & 0xfffff000u);
  let al = a.x - ah;
  let bl = b.x - bh;
  let residual = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  let e = residual + a.x * b.y + a.y * b.x + a.y * b.y;
  let high = p + e;
  return vec2f(high, e - (high - p));
}

fn cloudQuotient(a: vec2f, b: vec2f) -> f32 {
  let q = a.x / b.x;
  let remainder = cloudSum(a, -cloudProduct(vec2f(q, 0.0), b));
  return q + (remainder.x + remainder.y) / b.x;
}

fn webgpuCloudBoundary(direction: vec3f, high: vec4f, low: vec4f,
                       planet: WebGPUPlanet) -> vec2f {
  var a = vec2f(0.0);
  var b = vec2f(0.0);
  for (var i = 0u; i < 3u; i++) {
    let inverse = vec2f(high[i], low[i]);
    // EncodedCartesian3's low part can be kilometers, so normalize the pair
    // before using arithmetic that expects a small trailing significand.
    let camera = cloudSum(vec2f(planet.cameraHigh[i], 0.0), vec2f(planet.cameraLow[i], 0.0));
    let q = cloudProduct(camera, inverse);
    let w = cloudProduct(vec2f(direction[i], 0.0), inverse);
    a = cloudSum(a, cloudProduct(w, w));
    b = cloudSum(b, cloudProduct(q, w));
  }
  let c = vec2f(high.w, low.w);
  let aa = a.x + a.y;
  let bb = b.x + b.y;
  let cc = c.x + c.y;
  if (cc == 0.0) {
    if (bb < 0.0) { return vec2f(0.0, cloudQuotient(-2.0 * b, a)); }
    return vec2f(0.0);
  }
  let disc = cloudSum(cloudProduct(b, b), -cloudProduct(a, c));
  let discriminant = disc.x + disc.y;
  // Canonicalize only the compensated roundoff band, not a float32 band.
  // At 35,786 km this is <0.2 mm of radial uncertainty at the outer limb.
  let error = 2.0e-13 * (bb * bb + abs(aa * cc));
  if (discriminant < -error) { return vec2f(-1.0); }
  if (abs(discriminant) <= error) {
    let contact = cloudQuotient(-b, a);
    if (contact < 0.0) { return vec2f(-1.0); }
    return vec2f(contact);
  }
  let root = sqrt(discriminant);
  let q = cloudSum(-b, vec2f(-select(-root, root, bb >= 0.0), 0.0));
  if (q.x == 0.0) { return vec2f(-1.0); }
  let t0 = cloudQuotient(q, a);
  let t1 = cloudQuotient(c, q);
  let stop = max(t0, t1);
  if (stop < 0.0) { return vec2f(-1.0); }
  return vec2f(max(0.0, min(t0, t1)), stop);
}

// xy/zw are ordered segments; (-1,-1) denotes an absent segment.
// sceneDistance < 0 is cleared depth, matching webgpuSceneRayDistance.
fn webgpuCloudSegments(direction: vec3f, sceneDistance: f32,
                       cloud: WebGPUCloudLayer, planet: WebGPUPlanet) -> vec4f {
  let outer = webgpuCloudBoundary(direction, cloud.outerHigh, cloud.outerLow, planet);
  if (outer.x < 0.0 || cloud.earthHigh.w < 0.0) { return vec4f(-1.0); }
  let earth = webgpuCloudBoundary(direction, cloud.earthHigh, cloud.earthLow, planet);
  var stop = outer.y;
  if (sceneDistance >= 0.0) { stop = min(stop, sceneDistance); }
  if (earth.x >= 0.0 && earth.y > earth.x) { stop = min(stop, earth.x); }
  if (stop < outer.x) { return vec4f(-1.0); }
  let inner = webgpuCloudBoundary(direction, cloud.innerHigh, cloud.innerLow, planet);
  if (inner.x < 0.0 || inner.y <= inner.x || inner.y < outer.x || inner.x > stop) {
    return vec4f(outer.x, stop, -1.0, -1.0);
  }
  var result = vec4f(-1.0);
  if (inner.x > outer.x) { result = vec4f(outer.x, min(inner.x, stop), -1.0, -1.0); }
  if (inner.y < stop) {
    let second = vec2f(max(inner.y, outer.x), stop);
    if (result.x < 0.0) { result = vec4f(second, -1.0, -1.0); }
    else { result = vec4f(result.xy, second); }
  }
  return result;
}
`;

export default WebGPUCloudLayerShader;
