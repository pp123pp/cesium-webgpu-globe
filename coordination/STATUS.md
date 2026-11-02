# Single source of truth — status

Last updated: 2026-11-02
Current milestone: **M0 — NOT STARTED**
Repository content: planning files only; no imported Cesium source and no functional WebGPU code.
Upstream target: CesiumJS `1.146` (exact tag/SHA to verify on import).

## Completed
- Requirement and roadmap scope captured: Globe V1.0 first, 3D Tiles V1.1+.
- Codex parallel and context-management rules drafted.

## Next task
- M0.1 Verify official tag and upstream commit; import sources safely while retaining planning files; baseline original WebGL behavior.

## Active branches / owners
- None. Worktree registry is empty.

## Verified tests
- None; no code imported.

## Blockers / decisions
- Source import approach requires actual repository inspection.
- WebGPU unsupported behavior to decide before UI acceptance.
- Target GPU and resolution needed only before performance acceptance.

**Keep this file under ~100 lines; archive historic details in milestone handoffs.**