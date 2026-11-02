# M1 demo acceptance — 2026-11-02

**Owned demo fixes verified; current browser gate is RED on a confirmed shared terrain-attribution defect.** The integration owner is fixing terrain credit publication. Do not label the current test or M1 fully accepted until the integrated rerun is GREEN.

## Scope and source

- Branch: `test/m1-demo`, isolated worktree based on `52f4874e6105e7964776d72137446a9e3c8f0b40`.
- Owned product file: `Apps/WebGPUGlobe.html`.
- New test: `coordination/ci/m1-demo-smoke.mjs`; this handoff; evidence under `coordination/evidence/M1/demo/`.
- No shared renderer, Scene, Viewer, harness, workflow, STATUS, task or M2 changes. No push or merge.
- Root's later renderer readiness and reentrant-callback fixes were intentionally not cherry-picked into this worktree. Its bundle is independently built and hash-checked against the served bytes.

## Reproduced demo fixes

| Failure | Root cause and fix | Preserved RED |
| --- | --- | --- |
| Leaving during WebGPU initialization retains the Viewer and canvas | `pagehide` was registered after `await readyPromise`. Register teardown and tile-progress handling before the await; ignore initialization rejection after destruction. | `demo/red-initialization/` |
| Actual GPU device loss leaves buttons enabled | Fatal rendering errors only changed text. Mark the demo failed and disable all unavailable controls. | `demo/red-device-loss/` |
| Late provider failure overwrites device-loss feedback and re-enables controls | Provider completion handlers did not respect terminal renderer state. Ignore late success/failure after fatal rendering failure or destruction; retain the fatal status through tile-progress events. | `demo/red-late-provider/` |
| Successful retry retains red error styling | Error color was never cleared. Clear the inline error color when starting a new provider request. | `demo/red-provider-retry/` |

The final local scenarios use actual Viewer/GPU objects. They delay a real adapter request, destroy a real GPU device, and hold/reject actual HTTP requests only at the network boundary. They never fabricate successful terrain or imagery responses. The provider-failure control asserts that both real metadata requests were intercepted; the subsequent success path uses the live services.

## Actual verification

| Command or gate | Actual result |
| --- | --- |
| `npx gulp prepare` then `npm run build` | PASS. The first fresh-worktree build lacked the generated ZIP worker; the repository prepare step generated it. Final build log: `demo/build.txt`. |
| `npx prettier --ignore-path /dev/null --check Apps/WebGPUGlobe.html coordination/ci/m1-demo-smoke.mjs` | PASS. Explicit ignore override covers `.mjs`, which the repository's default Prettier ignore rules otherwise skip. |
| `npx eslint Apps/WebGPUGlobe.html coordination/ci/m1-demo-smoke.mjs` and `git diff --check` | PASS; `demo/lint.txt`. |
| Full live demo gate before the terrain-attribution oracle was added | PASS, ten checks, same final demo HTML and baseline renderer bundle. Exact executed test snapshot, JSON and log are retained. |
| Current full live demo gate with native terrain-attribution assertion | **FAIL as expected:** required USGS/CGIAR-CSI/Copernicus/LINZ/data.gov.uk/Geoscience Australia text is missing from the visible attribution dialog. `demo/red-terrain-attribution/error.json`. |

The passing live run used Chrome **156.0.8078.4**, headed Xvfb, **Google SwiftShader software GPU**, Cesium **1.146.0**, 1280 × 720. It is not physical GPU evidence.

- The actual demo initialized a real `Cesium.Viewer`, used the automatic render loop, requested no WebGL context, and displayed bundled tiled Natural Earth. The visible-globe sample contained 238,522 colored pixels and 1,993 distinct sampled colors.
- The Orbit button completed its native flight to 20° E, 20° N, 20,000 km height and −90° pitch.
- Controlled metadata failure preserved the working ellipsoid/Natural Earth scene and enabled retry. The retry loaded real `CesiumTerrainProvider` and `ArcGisMapServerImageryProvider` instances and restored normal status styling.
- The live run received **301 terrain tile** and **275 imagery tile** successful HTTP responses. Everest rendered **31 native quantized meshes**, levels **11–12**, with maximum mesh height **8,777.140625 m**. The actual camera ended at 86.925° E, 27.9° N, 18,000 m and −45° pitch, then returned to the specified Orbit view.
- Native Natural Earth and ArcGIS credits were opened through the actual attribution dialog. The later terrain-credit investigation is documented below.
- Page exit released all **507/507 observed native GPU buffers** and **264/264 native GPU textures**, including depth textures. Renderer counts separately record 262/262 imagery textures. Retained GPU bytes, pending imagery requests and canvases were zero; frame count remained 586 before/after exit.
- Unsupported WebGPU, exit before readiness, actual device loss with pending providers, and exit during provider loading all passed their error/cleanup checks. No unhandled browser errors or live provider errors occurred. Two `ERR_FAILED` console/network events are intentional metadata negative controls; retained `ERR_ABORTED` tile requests are native flight/churn cancellations.

Screenshots were inspected: `natural-earth.png`, `orbit-button.png`, `everest.png`, `live-orbit.png`, `webgpu-unavailable.png`, `device-lost.png`, and `provider-error.png`. Duplicate failing screenshots were not copied.

## Shared defect and dependent RED

An additional real-browser probe inspected the **rendered tiles'** `terrainData.credits`. They contain the terrain-source attribution, Cesium ion credit, and the default-token notice. The visible credit dialog contained only ArcGIS attribution. `red-terrain-attribution/actual-tile-credits.json` and `credit-dialog.png` preserve this comparison.

Native `GlobeSurfaceTileProvider` publishes `terrainData.credits` for selected terrain. The current WebGPU path publishes provider-level and imagery credits but omits terrain-data credits. The integration owner accepted ownership of a fix in `WebGPUGlobeTileProvider.showTileThisFrame`, including the actual source tile for ancestor fallback.

The new demo assertion independently extracts required text from native terrain credits and compares it with the real user-visible credit dialog. The latest run reaches actual live Everest terrain and then fails on this exact missing attribution. It is an intended dependent RED, not an environmental failure. The earlier passing run predates this assertion and is explicitly named `result-before-terrain-attribution-oracle.json`; it must not be used as proof that the current script passes.

`source-hashes.json` records the baseline commit/tree, final demo and test hashes, shared source hashes and served bundle hash. The earlier passing test's exact bytes are saved as `executed-test-before-terrain-attribution-oracle.mjs.txt`. Raw implementation and harness-development failures remain under their named RED directories and `diagnostics/`; `run-index.json` distinguishes product defects, intermediate edits and corrected harness assumptions. In particular, the initial absolute-host routing glob failed to match nested URL paths. The final test uses a protocol regex and an explicit two-interception assertion.

## Exact integration step

Cherry-pick this bounded commit after review. Integrate the root-owned terrain-credit fix and existing readiness/callback fixes, rebuild, then run the **default full gate** against that exact checkout:

```sh
npm run build
# Start the static server separately in the same checkout:
python3 -m http.server 8091 --bind 127.0.0.1
# In another shell:
M0_BROWSER_EXECUTABLE=/workspace/scratch/74d641ebe31c/pw-browsers/chromium-1248/chrome-linux64/chrome \
M1_BASE_URL=http://127.0.0.1:8091/ M1_OUTPUT=Build/m1-demo \
xvfb-run -a node coordination/ci/m1-demo-smoke.mjs
```

The local environment required authorized socket/browser execution outside its filesystem sandbox. Live ArcGIS returned HTTP 200 there. The presented proxy chain's root SPKI was independently verified as `n9jEr2dCP1tg9exQzr7xEpZ4TjG2QWO02LUFhmAzII4=`; this environment's browser runs set `M1_CA_SPKI` to that narrow pin. Ordinary hosted CI should use its normal trust store. No global certificate bypass or production trust change was added.

`M1_DEMO_LOCAL_ONLY=1` runs the explicitly labelled `demo-local` diagnostic subset; it does not certify live providers or terrain attribution and must not replace the full CI gate. Full regression and final M1 acceptance remain with the integration owner.
