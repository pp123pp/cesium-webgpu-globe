# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 — M0.1–M0.4 complete; M0.5 pending**
Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146` (annotated tag object unsigned)
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified.

## Completed
- M0.1: pinned source, version `1.146.0`, upstream commit and Apache-2.0 license verified.
- M0.2: build and WebGL smoke passed in run 41386475484, but its unit-test browser never started and gulp hid the failure. Corrected baseline run [41389237203](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41389237203) actually passed 10,353 non-WebGL tests (5,537 skipped). Historical handoffs now carry this correction.
- WebGL smoke: Cesium `1.146.0`, WebGL 2.0, 1280x720, SceneMode 3D, Globe object present, context not lost. This is an initialization smoke, not full Globe visual acceptance.
- M0.3: Viewer → CesiumWidget → Scene → Globe → QuadtreePrimitive → GlobeSurfaceTileProvider → Context pipeline audited; see `coordination/handoffs/M0.3-source-pipeline-audit.md`.
- M0.4: Viewer selects an isolated WebGPU proof at construction while preserving Viewer identity. WebGPUContext/WebGPUWidget own device/canvas, WGSL color/depth drawing, sizing, errors/loss and disposal. The real-browser gate, standalone demo and screenshot inspection passed. Existing CesiumWidget, Scene, WebGL Context and Globe source remain unchanged.

## Next task
M0.5: perform target-browser/physical-GPU and full visual regression acceptance. The inherited WebGL smoke must be extended to establish visible Globe readiness and compare rendered output. WebGL remains default. WebGPU is an experimental triangle/depth proof with no Globe/terrain/imagery compatibility claim. Do not start M1.

## Active branches / worktrees
- `feat/m0-webgl-baseline`: baseline harness and source audit.
- `feat/m0-webgpu-backend`: M0.4 integration branch; product implementation `ef69938`; accepted browser/test configuration `3798477`.
- Isolated worktree `../cesium-webgpu-m0`; integration owner exclusively edits shared Viewer/STATUS. Independent agents performed read-only CI/source/review tasks. `main` remains `a7f4729`; no merge was performed.

## Tests
- Local build, targeted ESLint/Prettier and nine lifecycle tests: PASS.
- Accepted run [41392263849](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849): build, 9 lifecycle tests, original WebGL smoke, 10,353 non-WebGL tests (5,537 skipped), and **17 WebGPU checks: PASS**.
- Chromium `156.0.8078.4`, Google SwiftShader, headed via Xvfb. Normal WebGPU drawing has zero unexpected validation/browser errors. GPU readback and inspected screenshots agree: background `[10,15,26]`, center `[127,64,64]`.
- [Artifact 13118360256](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849/artifacts/13118360256): JSON diagnostics, original WebGL screenshot, WebGPU proof and standalone-demo screenshots.
- M0.5 target-device/full visual regression gate: pending; not claimed complete.

## Open decisions
- WebGPU unsupported behavior: explicit error; no silent WebGL fallback.
- Recovery after device loss is destruction and recreation; no backend hot switch.
- Read `coordination/handoffs/M0.4-webgpu-proof.md` for the supported API, commands, evidence and environment limits.
