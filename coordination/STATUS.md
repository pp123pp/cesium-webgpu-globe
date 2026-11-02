# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 — M0.1–M0.3 complete; M0.4 queued (implementation not started)**
Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146` (annotated tag object unsigned)
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified.

## Completed
- M0.1: pinned source, version `1.146.0`, upstream commit and Apache-2.0 license verified.
- M0.2: Node `v22.23.4`; npm install, official `npm run build`, Chromium install, Viewer WebGL smoke and upstream non-WebGL tests all passed in CI run [41386475484](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41386475484).
- WebGL smoke: Cesium `1.146.0`, WebGL 2.0, 1280x720, SceneMode 3D, Globe present, context not lost.
- M0.3: Viewer → CesiumWidget → Scene → Globe → QuadtreePrimitive → GlobeSurfaceTileProvider → Context pipeline audited; see `coordination/handoffs/M0.3-source-pipeline-audit.md`.
- Smoke harness fixes isolated to test script: localhost host binding and correct `1.146.0` version assertion. No Cesium engine/widget/renderer source modified.

## Next task
M0.4 on `feat/m0-webgpu-backend`: implement a separately selected minimal WebGPU proof (adapter/device, canvas configure, clear + triangle + depth, resize/error/device-loss handling). WebGL remains default. No Globe/terrain/imagery compatibility claimed.

## Active branches / worktrees
- `feat/m0-webgl-baseline`: baseline harness and source audit.
- `feat/m0-webgpu-backend`: prepared integration branch for M0.4; no WebGPU implementation changes yet.
- No local worktrees or sub-agents available in this session; shared integration files must be owned serially.

## Tests
- Official WebGL baseline: PASS (CI run 41386475484).
- WebGPU: NOT IMPLEMENTED.
- M0.5 regression gate: pending M0.4.

## Open decisions
- WebGPU unsupported behavior: explicit error; no silent WebGL fallback.
- Minimal WebGPU path is experimental and does not expose Cesium Globe/terrain/imagery functionality.
