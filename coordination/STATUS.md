# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M2.1 mathematical foundation and final-head verification; M2.2 not started**
Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146` (annotated tag object unsigned)
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified.

## M2.1 implementation and verification

The current task authorizes M2.1 implementation, tests, feature-branch publication
and a PR to `main`, **not merging or M2.2**. The earlier M1 merge authorization
below is historical and does not authorize this branch's merge.

- Initially restored `main`: `c47ef56343343684f50992af8a3f32813402884f`.
  M0 [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1) and M1
  [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) are merged, with
  merge commits `8a0c5f59bdea67e150faf3114fcdfa0d2b8748c8` and
  `676061f40cd2a885b58963bea833f551c4feb90c`, respectively.
- During this task, [PR #7](https://github.com/pp123pp/cesium-webgpu-globe/pull/7)
  updated `main` to `08dcf05d54ffc3ef62c12f76bda7ad0ac4243c1d`. Its risk-based
  verification policy was integrated by a normal merge into the M2 branch,
  preserving both histories. Only four rule/documentation files changed on main;
  runtime evidence remains applicable. No extra runtime suite was run for this
  documentation merge. The final-head acceptance/automatic CI gates still apply.
- [PR #6](https://github.com/pp123pp/cesium-webgpu-globe/pull/6) remains open at
  `6788fbd174a1104688be34abbb40c8f9d305da7a`. Its
  [Fast](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41445066459)
  passed and its
  [Full](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41445066455)
  failed. M2.1 includes bounded prerequisite repairs for two observed inherited
  ShadowMap pixel signatures and stale demo expectations; it does not merge or
  rewrite PR #6. See [prerequisite evidence](handoffs/M2.1-prerequisite-gates.md).
- Branch: `feat/m2-physical-atmosphere`, isolated worktree `cesium-m2`, based on
  the restored main. Runtime commit
  [`5eca1d0`](https://github.com/pp123pp/cesium-webgpu-globe/commit/5eca1d0ff0cdb5697126a60433713fcbedb9de3a)
  has tree `3d4c8d71e94b982e00031010142a63723d142ec0`, identical to local
  `1435343546a00031d37a3b0504b266ff321edfe9`. GitHub publication uses the
  authorized connector because local Git has no GitHub push credential; commit
  identities differ, and each published tree was explicitly checked.
- Implemented native ECEF/meters/WGS84 parameters, native time-dependent
  Earth-to-Sun direction, forward ellipsoid/atmosphere ray intervals, a 192-byte
  CPU/WGSL state interface, shared finite reversed-Z reconstruction and readable
  Globe depth. M1 terrain RTC/matrices, depth ordering and camera behavior remain
  intact. No atmosphere, Sun disk, sky or HDR rendering is added.
- Local verification: **224 focused tests passed** across all 20 M0/M1/M2 files;
  build, ESLint, generated declarations and TypeScript passed. Real WebGPU
  verification passed 9 asymmetric-camera probes, 23 boundary cases and 8
  aggregate checks, including 35,786 km / 400 km / 2 m scenes, native mesh-pick
  depth comparisons, sky, resize and **456/456** released native GPU resources.
  Independent review found no blocking code issue.
- These local reports identify the actual working tree and bundle; they are not
  relabeled as a later clean commit. **Final acceptance requires successful Fast
  and an actually executed Full on the current M2 PR head.** The PR checks/body
  and Actions artifacts record that final result; this publication snapshot does
  not claim that a future or pending run passed. No redundant complete local
  upstream run was added before the hosted final-head regression.
- `M1-NAV-001` remains **KNOWN_UNRESOLVED**. The inherited rejected Google ion
  endpoint-promise retry limitation is documented, not repaired. Physical GPU
  testing remains unavailable and nonblocking; observed results use Chromium 156,
  headed Xvfb and Google SwiftShader software rendering.

Read [M2.1 contracts](../docs/WEBGPU_M2.1.md),
[handoff](handoffs/M2.1-mathematical-foundation.md) and
[compact evidence](evidence/M2.1/README.md). After final-head verification, stop
and wait for explicit M2.2 authorization; leave the PR unmerged.

## Completed

- M0.1: pinned source, version `1.146.0`, upstream commit and Apache-2.0 license verified.
- M0.2: build and WebGL smoke passed in run 41386475484, but its unit-test browser never started and gulp hid the failure. Corrected baseline run [41389237203](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41389237203) actually passed 10,353 non-WebGL tests (5,537 skipped). Historical handoffs now carry this correction.
- Historical M0.2 WebGL smoke verified initialization; M0.5 below supersedes it with visible Globe readiness and independent visual comparison.
- M0.3: Viewer → CesiumWidget → Scene → Globe → QuadtreePrimitive → GlobeSurfaceTileProvider → Context pipeline audited; see `coordination/handoffs/M0.3-source-pipeline-audit.md`.
- M0.4: Viewer selects an isolated WebGPU proof at construction while preserving Viewer identity. WebGPUContext/WebGPUWidget own device/canvas, WGSL color/depth drawing, sizing, errors/loss and disposal. The real-browser gate, standalone demo and screenshot inspection passed. Existing CesiumWidget, Scene, WebGL Context and Globe source remain unchanged.

## Historical M1 closeout and integration

M1 covers the real WGS84 Globe, ImageryProvider and TerrainProvider, A03–A06. On 2026-11-02 the user additionally instructed **“收尾后合并到main”** for that closeout. M0 dependency [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1), then [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2), were merged into `main`. M2 had not started at that historical checkpoint; the current M2.1 task is recorded above.

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

## Historical M1 branch dependencies and publication

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
