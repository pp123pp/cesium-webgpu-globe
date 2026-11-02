# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 — STARTED (source import complete; baseline not verified)**
Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146`
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified (`package.json`, `packages/engine/package.json`, `packages/engine/Source/Scene/Globe.js`, `LICENSE.md`).

## Completed
- Source imported from official tagged commit, keeping original Cesium source and license.
- Codex plan, stage breakdown, worktree/subagent instructions and handoff template committed.

## Next task
**M0.2:** use Node >=22 + upstream npm workspaces, establish reproducible original WebGL build/test/Viewer smoke. Record exact commands, versions and results. Then audit shared Scene/Globe submission pipeline before WebGPU modifications.

## Active branches / worktrees
None registered.

## Tests
- Source import GitHub Actions completed successfully.
- Official Cesium npm build, WebGL Viewer smoke and unit tests: **NOT RUN**.
- WebGPU: **NOT IMPLEMENTED**.

## Open decisions
- Unsupported WebGPU behavior at Viewer creation (explicit error vs fallback) to resolve during M0.
- GPU/browser/resolution reference before performance acceptance only.

Keep this file under approximately 100 lines; hand off completed tasks in separate context docs.
