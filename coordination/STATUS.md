# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 complete under the user's software-GPU acceptance waiver; M1 is next**
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

## Next task

M1: read `tasks/M1.md`, REQUIREMENTS and ACCEPTANCE; audit and implement the WGS84/imagery/terrain slice on a separate branch/PR dependent on the accepted M0 integration branch. Do not enter M2. WebGL remains default; M0 itself is still a triangle/depth proof and makes no WebGPU Globe claim.

## M0.5 acceptance (2026-11-02)

- User explicitly waived unavailable physical GPU testing as a blocker: “若没有可用物理 GPU，则跳过这个要求，不作为卡点”. Current evidence is **software only**, never physical GPU evidence.
- Visible WebGL Globe readiness now requires renderable terrain tiles/vertex arrays, completed load queues and three stable frames. Orbit/oblique/resized pixels exactly match a clean independent pre-WebGPU build (`724b5db`); settled PNG captures also match. Blank/transparent/missing-Globe/shifted-image controls reject regressions.
- WebGPU: all 17 real-browser depth/lifecycle/demo checks pass; normal rendering has no unexpected validation/browser errors. Original lifecycle and new pixel/config tests: 13 passed; differential-runner tests: 26 passed; control-flow probes: 5 passed.
- Full non-WebGL suite: 10,353 passed, 5,537 skipped. Full WebGL **no-new-regression gate passes**: baseline and candidate each execute 3,822 specs with 3,810 passed and the **same 12 inherited failures** (12,068 skipped). Exact execution order and assertion signatures match. The underlying suites still exit 1; those failures are not claimed passed.
- Chromium 156.0.8078.4, Ubuntu 24.04, Google SwiftShader, headed Xvfb for screenshots. Source and served-bundle provenance, browser/GPU metadata, screenshots and compact differential report are preserved in `coordination/evidence/M0.5/`.
- Concurrent remote `fda7f01` was integrated with a normal merge preserving repeatability checks. `main` remains unmerged. See `coordination/handoffs/M0.5-regression-gate.md` for commands, local certificate-trust diagnosis and retained upstream failures.

## Active branches / worktrees

- `feat/m0-webgpu-backend`: M0 integration branch and PR #1; M0.4 product implementation is preserved. M0.5 adds only verification, CI and documentation.
- Clean detached pre-WebGPU reference worktree at `724b5db`; independent differential-harness worktree was integrated after review. One integration owner edits shared Viewer/STATUS.
- `main` remains `a7f4729`; no merge was performed. M1 will branch from the published, accepted M0 tree and target this branch while PR #1 remains unmerged.

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
