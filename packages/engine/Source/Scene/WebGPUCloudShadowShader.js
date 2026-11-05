import { cloudFieldShader } from "./WebGPUCloudDensityShader.js";

// Sample along the receiver-to-Sun ray, independent of the camera ray used
// to display clouds. Positions, shell radii and optical path lengths are meters.
const WebGPUCloudShadowShader = `${cloudFieldShader}
fn cloudShadowShellExit(surfaceWC: vec3f, height: f32) -> f32 {
  let inverse = vec3f(1.0) / (planet.radii.xyz + vec3f(height));
  let origin = surfaceWC * inverse;
  let direction = planet.sunDirectionWC.xyz * inverse;
  return max(0.0, webgpuForwardInterval(dot(direction,direction), dot(origin,direction),
    dot(origin,origin)-1.0, 0.0).y);
}

fn cloudShadowOpticalDepth(surfaceWC: vec3f, base: f32, top: f32, steps: u32) -> f32 {
  let entry = cloudShadowShellExit(surfaceWC, base);
  let exitDistance = cloudShadowShellExit(surfaceWC, top);
  let ds = (exitDistance - entry) / f32(steps);
  if (ds <= 0.0) { return 0.0; }
  var tau = 0.0;
  for (var i = 0u; i < steps; i++) {
    let distance = entry + (f32(i) + 0.5) * ds;
    let p = fma(planet.sunDirectionWC.xyz, vec3f(distance), surfaceWC);
    let cameraDistance = length((p - planet.cameraHigh.xyz) - planet.cameraLow.xyz);
    let density = cloudDensity(p, ds*0.10, clouds.weather, clouds.shape);
    tau += cloudVisibleExtinction(density, cameraDistance) * ds;
  }
  return tau;
}

fn cloudShadowTransmission(surfaceWC: vec3f) -> f32 {
  let scaled = surfaceWC * planet.inverseRadii.xyz;
  if (clouds.weather.x <= 0.0 || planet.cameraLow.w >= 250000.0 ||
      dot(scaled * planet.inverseRadii.xyz, planet.sunDirectionWC.xyz) <= 0.0) {
    return 1.0;
  }
  var tau = cloudShadowOpticalDepth(surfaceWC, 2000.0, 6000.0, 12u);
  if (clouds.shape.y > 0.5) {
    // A separate interval resolves the thin cirrus instead of marching empty
    // air between the low and high decks.
    tau += cloudShadowOpticalDepth(surfaceWC, 9000.0, 11000.0, 6u);
  }
  return exp(-tau);
}
`;

export default WebGPUCloudShadowShader;
