# Codex project instructions

Read this file first. **Do not load the entire documentation tree or Cesium source into context.**

## Mission
Start from CesiumJS **official 1.146.0 tag** (verify at implementation time), keep the existing WebGL path unchanged in behavior, add a separately selectable WebGPU backend. Prioritize WGS84 Globe, imagery, Terrain, physical atmosphere, Sun, space sky, HDR, volumetric clouds and terrain cloud shadows. **3D Tiles/BIM is deferred until after V1.0 Globe.** Only SceneMode.SCENE3D required for WebGPU.

## Always-on rules
1. Inspect actual upstream files before editing. No invented Cesium symbols or APIs; keep patches minimal.
2. WebGL regression is a hard gate. Select backend on Viewer creation; no hot switching.
3. Complete only the active milestone and an explicitly assigned small task. Do not prebuild a generic engine, full RenderGraph, PBR system or 3D Tiles pipeline.
4. Work in small auditable commits and isolate shared integration files. Never push directly to main unless explicitly instructed.
5. Each task ends with tests and a short handoff: files changed, commands/results, known issues, next step. Update `coordination/STATUS.md` only through integration owner.
6. Avoid doing research-only work without concrete evidence and a deliverable.
7. Preserve licenses, attribution and upstream notices.
8. No task is done without its testable acceptance criteria or a documented blocker.

## Reading order (context budget)
1. `coordination/STATUS.md` (current state)
2. `ROADMAP.md` (stage dependency overview)
3. `tasks/MX.md` (ONLY active milestone)
4. Relevant excerpt of `docs/REQUIREMENTS.md`, `docs/ACCEPTANCE.md`, `docs/SOURCE_BASELINE.md`
5. Source files needed for the current task, not whole directories

## Workflow
Follow `coordination/WORKFLOW.md` for subagents, worktrees, ownership and integration. Subagents are optional and tool-dependent; don't assume they exist. If no subagent support, run the same split as separate human/Codex sessions or sequential tasks. No two agents may edit the same source file concurrently.

## Entry task
If source isn't imported: execute `tasks/M0.md` only after verifying upstream tag, licensing, baseline build, and import path. Before source exists, work only on docs/reproducible bootstrap.