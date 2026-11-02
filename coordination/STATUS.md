# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M1 A03–A06 closeout; verified source and documented navigation limitation**
Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146` (annotated tag object unsigned)
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified.

## Completed

- M0.1: pinned source, version `1.146.0`, upstream commit and Apache-2.0 license verified.
- M0.2: build and WebGL smoke passed in run 41386475484, but its unit-test browser never started and gulp hid the failure. Corrected baseline run [41389237203](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41389237203) actually passed 10,353 non-WebGL tests (5,537 skipped). Historical handoffs now carry this correction.
- Historical M0.2 WebGL smoke verified initialization; M0.5 below supersedes it with visible Globe readiness and independent visual comparison.
- M0.3: Viewer → CesiumWidget → Scene → Globe → QuadtreePrimitive → GlobeSurfaceTileProvider → Context pipeline audited; see `coordination/handoffs/M0.3-source-pipeline-audit.md`.
- M0.4: Viewer selects an isolated WebGPU proof at construction while preserving Viewer identity. WebGPUContext/WebGPUWidget own device/canvas, WGSL color/depth drawing, sizing, errors/loss and disposal. The real-browser gate, standalone demo and screenshot inspection passed. Existing CesiumWidget, Scene, WebGL Context and Globe source remain unchanged.

## M1 closeout and integration

M1 covers the real WGS84 Globe, ImageryProvider and TerrainProvider, A03–A06. On 2026-11-02 the user additionally instructed **“收尾后合并到main”**. This supersedes the earlier no-merge instruction: finish the records and final PR checks, merge M0 dependency [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1), then merge [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) into `main`. Stop at M1; M2 is not started.

Verified runtime source: `03233dae8b524d6b3f4498a48a2fd7e89fffa806`, tree `48142ced46a15cdf435db7902b9ba601449b5358`, identical to locally verified `f2b9921`. [Fast 41430449080](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449080) and [Full 41430449094](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094) both completed successfully. The actual Full regression job ran every required step; this was not a selector-only success.

This closeout changes documentation and evidence only. Its publication must also pass Fast and an executed Full on the latest PR head under `docs/CI.md`. The live PR checks and merge record are the final publication authority; the source report below does not claim to test a future commit SHA. See [M1 acceptance handoff](handoffs/M1-acceptance.md).

### Verified hosted closeout evidence

- Build, ESLint, generated declarations and TypeScript checks pass; all **160 focused tests** pass across 17 suites.
- A03 WGS84 foundation, A04 imagery and ordinary A06 navigation/depth/precision/input/resource gates pass. All five M1 browser reports identify the exact verified source above.
- A05 actual quantized World Terrain + ArcGIS imagery passes ordinary coverage, adjacent/mixed-LOD checks and four LOD transitions with zero background/untextured pixels. Drape passes **561/561** native-pick samples; a real 1 km GPU imagery offset fails **535/561**, as required.
- The hosted rapid flight **observed `M1-NAV-001`**: coarse-terrain collision left the camera **2,098.890 m above terrain**, above its requested height. It is `KNOWN_UNRESOLVED`; the complete terrain result is `PASS_WITH_KNOWN_ISSUES`. The flight ran, and drape/error/cleanup checks continued afterwards. A06 is not unconditionally passed.
- Hosted terrain releases **1,184/1,184 buffers and 424/424 imagery textures**; pending requests, retained bytes and canvases are zero. Ordinary navigation releases **2,608/2,608 actual GPU buffers and 68/68 actual GPU textures**.
- All **10 live demo checks** pass, including native Providers, attribution, Everest/Orbit, retry, device loss and early exit. Demo teardown releases **884/884 buffers and 242/242 native GPU textures**, including depth textures.
- Complete non-WebGL: **10,353 passed / 5,537 skipped**. Complete WebGL differential: both independent baseline and candidate execute **3,822 specs: 3,811 passed / the same 11 failed / 12,068 skipped**. No new failures or changed failure signatures; raw suites still exit 1. The historical 12-failure M0 result below is preserved as history, not reused as this run's count.
- Independent source/acceptance review found no Critical/Important blocker and independently ran 51 focused cases. Hosted checks, source identities, reports, representative screenshots and checksums are in `coordination/evidence/M1/closeout/hosted/`.

Earlier local results remain separately in `coordination/evidence/M1/closeout/local/`, including the original sandbox `EPERM` and unchanged successful retry. That local rapid-flight sample passed at 33.579 m AGL; it does not negate the hosted occurrence or resolve the intermittent defect. Historical rejected candidates remain unchanged in their original evidence and handoffs.

### Acceptance decisions already authorized

- Harmless visual differences are allowed; WebGL/WebGPU images need not be pixel-identical. This applies to later acceptance too and does not waive functional regressions.
- Physical GPU testing is unavailable and nonblocking. Current browser evidence is Chromium 156 / headed Xvfb / Google SwiftShader software rendering; no physical performance claim is made.
- Only the repeatedly unresolved fast real-terrain descent collision/altitude problem is nonblocking as `M1-NAV-001`. The test still runs and retains its evidence. Ordinary terrain coverage/LOD, imagery/drape, other navigation, cleanup, browser errors and complete upstream regression remain mandatory.

## M0.5 acceptance (2026-11-02)

- User explicitly waived unavailable physical GPU testing as a blocker: “若没有可用物理 GPU，则跳过这个要求，不作为卡点”. Current evidence is **software only**, never physical GPU evidence.
- Visible WebGL Globe readiness now requires renderable terrain tiles/vertex arrays, completed load queues and three stable frames. Orbit/oblique/resized pixels exactly match a clean independent pre-WebGPU build (`724b5db`); settled PNG captures also match. Blank/transparent/missing-Globe/shifted-image controls reject regressions.
- WebGPU: all 17 real-browser depth/lifecycle/demo checks pass; normal rendering has no unexpected validation/browser errors. Original lifecycle and new pixel/config tests: 13 passed; differential-runner tests: 26 passed; control-flow probes: 5 passed.
- Full non-WebGL suite: 10,353 passed, 5,537 skipped. Full WebGL **no-new-regression gate passes**: baseline and candidate each execute 3,822 specs with 3,810 passed and the **same 12 inherited failures** (12,068 skipped). Exact execution order and assertion signatures match. The underlying suites still exit 1; those failures are not claimed passed.
- Chromium 156.0.8078.4, Ubuntu 24.04, Google SwiftShader, headed Xvfb for screenshots. Source and served-bundle provenance, browser/GPU metadata, screenshots and compact differential report are preserved in `coordination/evidence/M0.5/`.
- Concurrent remote `fda7f01` was integrated with a normal merge preserving repeatability checks. At that M0.5 checkpoint, `main` was unmerged. See `coordination/handoffs/M0.5-regression-gate.md` for commands, local certificate-trust diagnosis and retained upstream failures.
- Published-head CI: [PR run 41400575907](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400575907) passed; [push run 41400570084 attempt 2](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400570084/attempts/2) passed. Push attempt 1 retained two extra native Cesium3DTileset async timeouts; rerunning only the failed job without any source or gate change passed. The original failure remains in Actions.

## Branch dependencies and publication

- `feat/m0-webgpu-backend` / PR #1 supplies M0; its verified head is `7a689426af4b4b5f9c510d91e68ff45623f20090`.
- `feat/m1-wgs84-globe` / PR #2 supplies M1 and this closeout. Preserve both histories with normal merge commits; do not force-push or delete the branches during closeout.
- The independent pre-WebGPU reference remains pinned at `724b5db`. One integration owner controls shared source and STATUS.
- Before the newly authorized integration, `main` was `a7f4729`. Merge PR #1 first, retarget PR #2 to `main`, verify its final checks and prospective merge tree, then merge PR #2. GitHub records the resulting SHAs and actual merge state.

## Tests

- Local build, targeted ESLint/Prettier and nine lifecycle tests: PASS.
- Accepted run [41392263849](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849): build, 9 lifecycle tests, original WebGL smoke, 10,353 non-WebGL tests (5,537 skipped), and **17 WebGPU checks: PASS**.
- Chromium `156.0.8078.4`, Google SwiftShader, headed via Xvfb. Normal WebGPU drawing has zero unexpected validation/browser errors. GPU readback and inspected screenshots agree: background `[10,15,26]`, center `[127,64,64]`.
- [Artifact 13118360256](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849/artifacts/13118360256): JSON diagnostics, original WebGL screenshot, WebGPU proof and standalone-demo screenshots.
- M0.5 visual/software regression gate: complete under the explicit user waiver; see the newer M0.5 acceptance above. Physical hardware testing remains unperformed and nonblocking.

## Open decisions

- WebGPU unsupported behavior: explicit error; no silent WebGL fallback.
- Recovery after device loss is destruction and recreation; no backend hot switch.
- Read `coordination/handoffs/M0.4-webgpu-proof.md` for the supported API, commands, evidence and environment limits.
