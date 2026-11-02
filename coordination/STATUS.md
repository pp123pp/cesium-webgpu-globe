# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M1.1 foundation verified; M1.2 imagery in progress; M0.5 accepted under the explicit physical-GPU waiver**
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

## Active task

M1 on independent branch `feat/m1-wgs84-globe`, based on published M0 commit `7a689426af4b4b5f9c510d91e68ff45623f20090`. [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) targets `feat/m0-webgpu-backend`; PR #1 remains unmerged and is ready for review. The user requested publishing verified progress incrementally. `coordination/M1-PLAN.md` defines A03–A06; root alone owns shared integration, and imagery state adaptation uses a disjoint worktree. No M2 work.

### Verified M1 slices

- RTC/depth math: 10 tests, including 180 orbit-to-1m projection samples; native NONE/BITS12 meshes and skirts retained.
- Native terrain/quadtree adapter: 6 tests for deferral, unavailable-child upsampling, eviction and provider replacement with late completion. Real World Terrain data/adjacency was separately probed; this alone is not rendered A05 evidence.
- Actual WGS84 WebGPU foundation: native Camera/Globe/Quadtree, depth32float, no hidden WebGL context. Orbit/pole/dateline silhouette agreement exceeds 99.8%; ground selects levels 12–13 with zero background crack pixels. All 187 allocated buffers are destroyed. Direct Scene error policy is checked separately from normal rendering.
- Same M1 build: all 17 M0 WebGPU proof checks pass; three WebGL views have zero changed reference pixels and identical settled repeat captures. Foundation source hashes, screenshots and logs: `coordination/evidence/M1/foundation/`; details: `coordination/handoffs/M1.1-gpu-globe.md`.
- Remaining: dynamic imagery A04, rendered quantized terrain and draping A05, flight/input/resource churn A06, final full regression. **M1 is not yet accepted.**

## M0.5 acceptance (2026-11-02)

- User explicitly waived unavailable physical GPU testing as a blocker: “若没有可用物理 GPU，则跳过这个要求，不作为卡点”. Current evidence is **software only**, never physical GPU evidence.
- Visible WebGL Globe readiness now requires renderable terrain tiles/vertex arrays, completed load queues and three stable frames. Orbit/oblique/resized pixels exactly match a clean independent pre-WebGPU build (`724b5db`); settled PNG captures also match. Blank/transparent/missing-Globe/shifted-image controls reject regressions.
- WebGPU: all 17 real-browser depth/lifecycle/demo checks pass; normal rendering has no unexpected validation/browser errors. Original lifecycle and new pixel/config tests: 13 passed; differential-runner tests: 26 passed; control-flow probes: 5 passed.
- Full non-WebGL suite: 10,353 passed, 5,537 skipped. Full WebGL **no-new-regression gate passes**: baseline and candidate each execute 3,822 specs with 3,810 passed and the **same 12 inherited failures** (12,068 skipped). Exact execution order and assertion signatures match. The underlying suites still exit 1; those failures are not claimed passed.
- Chromium 156.0.8078.4, Ubuntu 24.04, Google SwiftShader, headed Xvfb for screenshots. Source and served-bundle provenance, browser/GPU metadata, screenshots and compact differential report are preserved in `coordination/evidence/M0.5/`.
- Concurrent remote `fda7f01` was integrated with a normal merge preserving repeatability checks. `main` remains unmerged. See `coordination/handoffs/M0.5-regression-gate.md` for commands, local certificate-trust diagnosis and retained upstream failures.
- Published-head CI: [PR run 41400575907](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400575907) passed; [push run 41400570084 attempt 2](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400570084/attempts/2) passed. Push attempt 1 retained two extra native Cesium3DTileset async timeouts; rerunning only the failed job without any source or gate change passed. The original failure remains in Actions.

## Active branches / worktrees

- `feat/m0-webgpu-backend`: M0 integration branch and PR #1; M0.4 product implementation is preserved. M0.5 adds only verification, CI and documentation.
- Clean detached pre-WebGPU reference worktree at `724b5db`; independent differential-harness worktree was integrated after review. One integration owner edits shared Viewer/STATUS.
- `main` remains `a7f4729`; no merge was performed. M1 branches from the accepted M0 tree and targets it while PR #1 remains unmerged.

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
