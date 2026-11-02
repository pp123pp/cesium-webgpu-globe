# M1 closeout and acceptance handoff

Date: 2026-11-02. Scope: M1 only, official CesiumJS 1.146.0. Integration owner: root.

## Outcome

Published source `03233dae8b524d6b3f4498a48a2fd7e89fffa806` completed Fast and the actual Full regression successfully. A03/A04/A05 and ordinary A06 gates pass; rapid real-terrain descent remains accepted only under the specific known-issue authorization. This closeout adds documentation and evidence, with no production/test/workflow changes. Its final PR head must also pass the existing Fast/Full publication gate before merge.

The later user instruction on 2026-11-02, **“收尾后合并到main”**, authorizes merging dependency PR #1 and then PR #2 to `main` after closeout. It supersedes the earlier no-merge constraint. M2 is not started.

The user explicitly permits harmless visual differences and does not require pixel-identical output. Physical GPU testing is unavailable and nonblocking. The separate, repeatedly unresolved rapid real-terrain descent issue remains `M1-NAV-001 / KNOWN_UNRESOLVED`; it is not fixed and A06 must not be described as unconditionally passed.

## Preserved implementation

- Actual native WGS84 Globe/Camera, RTC coordinates and reversed depth, native Providers/quadtree/workers, real imagery tiling/layer lifetimes and quantized terrain.
- Native TerrainFillMesh geometry, conservative bounds and preservation of real parent/fine meshes during asynchronous LOD changes. Optional hooks retain the original default WebGL branches.
- Provider/imagery callback reentrancy, Scene event order, dataset attribution, native camera-controller roundoff and demo error/exit lifecycle corrections.
- The rapid flight still executes. Only its diagnosed coarse-terrain collision/height occurrence is nonblocking; ordinary terrain transitions, coverage, imagery, drape, other navigation, errors and resource checks remain mandatory and continue afterwards.

The previous workspace was copied into an isolated checkout without modification. The unpublished commits and all original failure evidence were preserved. [Source/evidence identity mapping](../evidence/M1/closeout/README.md) records identical local and published trees.

## Acceptance matrix

All hosted rows below refer to [Full run 41430449094](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094), actual regression job `125227480660`, source `03233da`. Its selection and regression jobs both succeeded; no mandatory gate was skipped.

| Gate | Actual hosted result | Retained evidence |
| --- | --- | --- |
| A03 WGS84 orbital Globe / native camera | PASS | `../evidence/M1/closeout/hosted/m1-globe/m1-globe.json` |
| A04 real imagery / alignment / LOD / layers | PASS | `../evidence/M1/closeout/hosted/m1-imagery/result.json` |
| A05 real terrain / seams / transitions / drape | PASS for all mandatory A05 checks; complete terrain suite PASS_WITH_KNOWN_ISSUES due to the separate flight issue | `../evidence/M1/closeout/hosted/m1-terrain/result.json` |
| A06 ordinary navigation / depth / precision / lifecycle | PASS | `../evidence/M1/closeout/hosted/m1-navigation/result.json` |
| A06 fast real-terrain descent | KNOWN_UNRESOLVED; actually observed this run, user-authorized nonblocking | Terrain `knownIssues` and `groundFlight.acceptance`; original failures also preserved |
| Live demo / attribution / errors / disposal | 10/10 checks PASS | `../evidence/M1/closeout/hosted/m1-demo/result.json` |
| Build / lint / generated declarations / TypeScript | PASS | `../evidence/M1/closeout/hosted/github-verification.json` |
| Focused M0/M1 suites | 160/160 PASS across 17 suites | `../evidence/M1/closeout/hosted/job-conclusions.log` |
| Complete upstream non-WebGL | 10,353 passed / 5,537 skipped | Hosted job log and retained conclusions |
| Complete upstream WebGL differential | No new failures: baseline/candidate each 3,811 passed, same 11 failed, 12,068 skipped; 3,822 executed | `../evidence/M1/closeout/hosted/m0-webgl-regression/summary.json` |

The two raw WebGL suites still exit 1. The differential gate exits 0 because execution order and all 11 inherited failure signatures match. Older runs' 12 failures are historical observations, not this run's count. WebGL orbit/oblique/resized comparisons show zero changed pixels and the missing-Globe negative control is correctly rejected; pixel identity is an observed diagnostic, not a general acceptance requirement.

## Hosted browser observations

- Four ordinary terrain LOD transitions: zero background/untextured pixels. Drape: 561/561 native-pick samples, zero failures or missing picks; a deliberate 1 km imagery displacement fails 535 samples.
- Rapid flight: completed, 8 sampled frames, but a coarse-terrain collision clamp leaves the camera at 7,364.937 m ellipsoid height against a requested 5,299.682 m. Loaded terrain is 5,266.048 m, so the final camera is 2,098.890 m above ground. `observedThisRun=true`, acceptance `KNOWN_UNRESOLVED`, no unrelated failures. This is not a successful near-ground endpoint.
- All later drape, request/error and resource checks execute. Terrain releases 1,184/1,184 buffers and 424/424 imagery textures, with zero pending requests, retained bytes or canvases.
- Ordinary navigation releases 2,608/2,608 actual GPU buffers and 68/68 actual GPU textures. Demo releases 884/884 buffers and 242/242 native GPU textures, including depth; rendered frame count remains 417 after exit.
- Browser reports have no unexpected browser/provider errors. The demo's injected Provider failure diagnostics are expected negative controls.
- The actual hosted near-ground-target view, coordinate-pattern drape and Everest demo screenshots were inspected. The first shows terrain coverage while the numerical flight result identifies the above-target endpoint; the image alone is not proof of target-altitude success.

Environment: Ubuntu 24.04 hosted runner, Node 22.23.4, Chromium 156.0.8078.4, headed Xvfb, Google SwiftShader **software GPU**. Terrain/demo are 1280×720; navigation also verifies resized 960×540. No physical GPU or hardware performance claim is made.

## Verified source and commands

Published runtime source: `03233dae8b524d6b3f4498a48a2fd7e89fffa806`. It has the same tree as the clean local `f2b9921` used for the retained new browser reports. The later acceptance commit contains documentation and evidence only; it must not alter production, test or workflow sources.

Local commands executed:

```sh
npm run build
node node_modules/eslint/bin/eslint.js <M1 source and CI files>
npm run build-ts
node node_modules/typescript/bin/tsc --project packages/sandcastle/templates/tsconfig.lib.json
npm run tsc
# The workflow's four M0 suites plus every coordination/ci/m1-*.test.mjs
node coordination/ci/m1-ci-policy.test.mjs
M1_BASE_URL=http://127.0.0.1:8094/ xvfb-run --auto-servernum node coordination/ci/m1-terrain-smoke.mjs
M1_BASE_URL=http://127.0.0.1:8094/ xvfb-run --auto-servernum node coordination/ci/m1-demo-smoke.mjs
```

Exact lint arguments, test names, environment and checksums are retained in `../evidence/M1/closeout/local/`. The local browser uses the installed Chromium path and the previously verified proxy CA SPKI; hosted CI uses its normal trust store. The initial CI-policy `EPERM` was an execution-sandbox failure, resolved by allowing its unchanged child-process execution; both outputs remain available.

## New local browser observations

- Four ordinary LOD transitions: zero background/untextured pixels. Real terrain/imagery requests: 424/592, no provider errors.
- This rapid flight: 13 sampled frames, zero background/untextured pixels, final 33.579 m above refined terrain. It does not resolve `M1-NAV-001`.
- Drape: 561/561 samples pass, zero missing picks. Deliberate 1 km GPU imagery displacement fails 535 samples.
- Terrain cleanup: 1,334/1,334 buffers, 419/419 imagery textures, zero retained GPU bytes/pending requests/canvases.
- Demo cleanup: 1,004/1,004 buffers and 324/324 native GPU textures including depth textures; no frame advance after exit.
- Screenshots of near-ground terrain, coordinate drape and live Everest demo were inspected. The provider image resolution limits near-ground detail; no claim of photorealistic metre-scale imagery is made.

All local browser evidence is Chromium 156 / Xvfb / Google SwiftShader **software GPU**, 1280×720. No hardware performance benchmark is claimed.

## Independent review

Read-only review found no demonstrated Critical/Important source or acceptance-policy issue. The reviewer independently ran 51 focused cases. See `../evidence/M1/closeout/review.md` for the checked boundaries and one optional, deferred improvement to collision-clamp diagnostic proof.

## Publication and integration

Runtime source `03233da` passed [Fast 41430449080](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449080) and [Full 41430449094](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094). [Artifact 13134792351](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094/artifacts/13134792351) contains full reports/screenshots; its downloaded ZIP SHA-256 was verified against GitHub. Selected originals, full failure signatures and source/order identities are preserved in `../evidence/M1/closeout/hosted/`, with a checksum manifest.

The user now authorizes main integration after closeout. Publish the reviewed documentation/evidence commit, update PR #2 and mark it ready, and require successful Fast plus an actually executed Full for its final head. Then merge the verified M0 dependency [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1), retarget [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) to `main`, and merge using its verified head SHA after checking the prospective merge tree. Preserve both histories with normal merges.

The live PR checks and merge records supply the final publication SHAs/results; this source evidence does not predeclare a future SHA tested or a future merge completed. Verify the resulting main tree and merged PR states, retain `M1-NAV-001`, and stop at M1. Do not enter M2, reimplement completed slices or reinterpret a passing local flight as resolving the known limitation.
