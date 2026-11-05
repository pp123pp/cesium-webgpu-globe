# M3-01 — curved cloud geometry and ray intersection

Implementation and scoped verification: **PASS; pending user acceptance**.
This completes only task 1 of `tasks/M3.md`. It does not pass M3 A11–A13.

## Source and environment

- Fetched main: `bc649cc8d291a2d37f0d2532ec5490312881859d`.
- Geometry implementation: `0ed4fb5828b16bd293522eb7288f17e903cb06a6`.
- Final tested implementation and demo: `07e00af375efa01560df5e3687bbea5aaf2365f5`.
  Both final browser captures recorded a clean working tree. Subsequent evidence
  publication changes documentation/artifacts only.
- [Source hashes](source-manifest.json), [machine-readable summary](summary.json).
  Final geometry and demo use the same SHA-256 browser bundle:
  `47068cdffc7d51c12543ba10ef50d5679ac4d545f95a054219acb9751c57e8c8`.
- Chrome **156.0.8078.80**, headed, Windows; physical Intel **Xe-LPG** WebGPU
  adapter, `isFallbackAdapter=false`. Windows/WebGL identifies the device as
  **Intel Arc 130T**; [driver record](checks/gpu-windows.json).
- Official Cesium tag `1.146` / package `1.146.0` reverified with `git ls-remote`:
  tag object `b90bf5fa30c8f573072181165c9462d987e26580`, peeled commit
  `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`.

## Implementation

`WebGPUCloudLayer` expands WGS84 axes by cloud base/top altitude (defaults 2/6 km).
It retains ECEF meters and continuous polar flattening. It subtracts the hollow
inner ellipsoid from the outer boundary, returns up to two ordered ray intervals,
and clips them by solid Earth and measured terrain distance. Outer tangency is
a repeated root; inner tangency removes no material. Nonunit CPU rays are normalized
by the existing planet intersection implementation without modifying input.

Axis expansion approximates a constant geodetic normal offset. For WGS84 axes
`a,b`, the height shortfall is bounded by `h * (1 - 2*sqrt(a*b)/(a+b))`:
2.820 mm at 2 km and 8.460 mm at 6 km; the equator and poles are exact.
Native cartographic tests sample every degree of latitude. A maximum-radius sphere
would introduce about 21.4 km of polar error and was rejected.

The binding-free production WGSL uses split inverse radii/camera constants and
compensated arithmetic. Physical-GPU failures established that relying on the
`fma` product residual was insufficient on this adapter. Explicit significand
splitting, normalized encoded-camera pairs and compensated division fix the
observed false limb hits and distance errors. Only the compensated discriminant
roundoff band is canonicalized to a repeated root. At 35,786 km its radial band
is below 0.055 mm; **this is not a bound on total GPU ray/distance error**.

The existing demo now has a default-off cyan geometry overlay and orbit/high/near
presets. The overlay uses these same production functions and actual scene depth,
after normal rendering. It does not implement cloud density or scattering.
The Pages workflow packages the imported module. The user also explicitly included
the `8067 --no-sandcastle` demo-server changes; the server's default mirror behavior
remains enabled for ordinary `npm start`.

## Verification

| Check | Result and evidence |
| --- | --- |
| Focused CPU batch | **33/33**: 9 cloud geometry/packing/geographic cases, 20 existing planet/depth cases and 4 existing demo-control cases. [Log](checks/focused.txt). |
| Existing CI policy tests | **28/28** after adding M3 lint/test globs and the demo module. [Log](checks/ci-policy.txt). |
| Build and generated APIs | `npm run build`, `npm run build-ts`, engine `tsc --noEmit`, root `npm run tsc`, scoped lint/format and commit hooks passed. [Logs](checks/). |
| Geometry on physical WebGPU | **PASS**, 63 distinct probe records, real native terrain depth, orbit/high/near/inside, tangent ±1 cm, orbital limb ±1 m, two segments, Earth clipping, 12 camera steps, resize. [Raw report](geometry/result.json). |
| Actual raised terrain | Native 32×32 constant-height 4 km mesh truncates cloud exit to **6000.006836 m**, versus **8000.006519 m** without terrain. The CPU/GPU entry is about 4000 m. No mocked depth. |
| Actual demo UI | **PASS** on all three presets. Enabling changes displayed pixels; disabling restores **zero changed pixels** in all three views. Resize and pagehide pass; both cloud buffers released, all 249 tracked resources destroyed. [Raw report](demo/result.json). |
| WebGL preservation | Existing physical-GPU orbit/oblique/resize smoke **PASS**, no browser errors. [Report](webgl/webgl-smoke.json). Captured earlier in development, before final cloud precision fixes; those changed only the new WebGPU cloud code, leaving this WebGL evidence applicable. This is not a final-HEAD complete WebGL differential. |
| Demo server | `node server.js --port 8067 --production --no-sandcastle` started; preview-module HTTP 200; existing 8081 listener remained owned by its prior process. Graceful Ctrl-C shutdown verified. |

The first local `build-ts` failed because Windows CRLF in the existing generated
shim candidate list defeated its LF-only section parser. Running the repository's
`node scripts/listCoreReExportShims.js` regenerated that input with identical
version-controlled content; `build-ts` then passed. No generator or generated
declaration was manually patched.

## Screenshots

| View | Geometry diagnostic | Actual demo |
| --- | --- | --- |
| Orbit, 35,786 km | [Geometry](geometry/orbit-cloud.png) | [Preview](demo/orbit-on.png), [controls](demo/orbit-controls.png) |
| High, 20 km | [Geometry](geometry/high-cloud.png) | [Preview](demo/high-on.png), [controls](demo/high-controls.png) |
| Near ground, 2 m | [Geometry](geometry/near-cloud.png) | [Preview](demo/near-on.png), [controls](demo/near-controls.png) |
| Inside, 4 km | [Geometry](geometry/inside-cloud.png) | Not a separate UI preset |
| Raised terrain, 4 km | [Clipped shell](geometry/raised-terrain-cloud.png) | Native depth numerical record above |
| Resize | [800×450](geometry/resized-cloud.png) | [800-wide demo](demo/resized-on.png) |

Geometry captures are 640×360 with native ellipsoid terrain bounded at level 8;
the raised fixture uses the same bound. Red marks native depth while green/blue
encode shell path length. The faint raised-shell image is below the diagnostic's
bright-cyan pixel-count threshold, so its `cloudPixels=0` is not an empty segment.
Actual-demo captures are 640×480 including its Timeline, plus an 800×600 resize.
Tests inject offline/manual startup and bounded terrain; the real controls, preview
module and production Viewer are exercised. They do not certify live ion services.

## Limits and retained failures

- Maximum observed CPU/GPU endpoint discrepancy: **2.288 m**, including GEO
  float32 distances. Maximum CPU/GPU real-depth decode difference: **1.195 m**,
  also at orbital scale. Ordinary low-altitude errors are much smaller; raw values
  remain in the report. No pixel-identical WebGPU/WebGL claim is made.
- Shallow-view native double-precision `globe.pick` and hardware-rasterized depth
  differed by up to **10.008 m**. They are different geometry references. All actual
  depth samples retain tight CPU/GPU depth-decoding and cloud-clipping assertions;
  independent nadir and raised-terrain samples retain the original strict native
  pick comparison. The covering triangle's exact discrepancy was not diagnosed,
  and no existing renderer fix is claimed.
- [Failed development reports](failed-attempts/) retain the invalid shallow-pick
  oracle, asynchronous canvas-read timing failure, FMA residual loss, root precision
  and encoded-camera/tangent failures. Existing tests/assertions were not removed
  or weakened. The new shallow oracle was corrected to measured raster depth,
  with strict native-mesh checks kept in controlled nadir fixtures.
- Single physical GPU; bounded deterministic fixtures. No new performance, resident
  VRAM, live-provider, broad terrain or full WebGL differential claim. No software
  GPU or manually dispatched Full. Hosted checks are separate from these captures.
- No density/noise/wind, scattering/self-shadow/silver lining, cloud LOD, temporal
  history or terrain cloud shadows. Existing `M1-NAV-001` remains unresolved.

## Reproduce

```powershell
npm run build
node server.js --port 8067 --production --no-sandcastle
# In another terminal:
$env:M0_BROWSER_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:M1_BASE_URL='http://localhost:8067/'
$env:M1_OUTPUT='Build/m3-01-replay/geometry'
node coordination/ci/m3-cloud-layer-smoke.mjs
$env:M1_OUTPUT='Build/m3-01-replay/demo'
node coordination/ci/m3-cloud-demo-smoke.mjs
```

For manual review, run `npm run demo:webgpu`, open
`http://localhost:8067/Apps/WebGPUGlobe.html`, and use the M3-01 controls.
Stop after M3-01 user review; do not initiate M3-02.
