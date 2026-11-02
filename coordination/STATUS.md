# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 — WebGL baseline verified; M0.3 audit complete; M0.4 in progress**
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
- CI smoke fixes isolated to test harness: localhost host binding and version assertion; no upstream renderer edits.

## Next task
M0.4: add an explicitly selected minimal WebGPU Viewer proof (adapter/device, canvas configure, clear + triangle + depth, resize and error handling). WebGL remains default. No Globe/terrain/imagery compatibility claimed.

## Active branches / worktrees
- `feat/m0-webgl-baseline`: baseline harness and source audit.
- `feat/m0-webgpu-backend`: M0.4 integration branch.
- No local worktrees or sub-agents available in this session; shared integration files owned serially.

## Tests
- Official WebGL baseline: PASS (CI run 41386475484).
- WebGPU: not yet implemented.
- M0.5 regression gate: pending M0.4 implementation.

## Open decisions
- WebGPU unsupported behavior: explicit error; no silent WebGL fallback.
- Minimal WebGPU path is experimental and does not expose Cesium Globe/terrain/imagery functionality.
