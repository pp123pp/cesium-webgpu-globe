# Codex project instructions

Read this file first. **Do not load the entire documentation tree or Cesium source into context.**

## Mission

Start from CesiumJS **official 1.146.0 tag** (verify at implementation time), keep the existing WebGL path unchanged in behavior, add a separately selectable WebGPU backend. Prioritize WGS84 Globe, imagery, Terrain, physical atmosphere, Sun, space sky, HDR, volumetric clouds and terrain cloud shadows. **3D Tiles/BIM is deferred until after V1.0 Globe.** Only SceneMode.SCENE3D required for WebGPU.

## Always-on rules

1. Inspect actual upstream files before editing. No invented Cesium symbols or APIs; keep patches minimal.
2. WebGL regression is a hard gate. Select backend on Viewer creation; no hot switching.
3. Complete only the active milestone and an explicitly assigned small task. Do not prebuild a generic engine, full RenderGraph, PBR system or 3D Tiles pipeline.
4. Work in small auditable commits and isolate shared integration files. Never push directly to main unless explicitly instructed.
5. Each task ends with risk-appropriate verification and a short handoff: files changed, checks/results, known issues, next step. Content and diff checks are sufficient for documentation-only tasks. Update `coordination/STATUS.md` only through integration owner.
6. Avoid doing research-only work without concrete evidence and a deliverable.
7. Preserve licenses, attribution and upstream notices.
8. No task is done without its testable acceptance criteria or a documented blocker.

## Risk-based testing and verification

User policy (2026-11-02): use the smallest sufficient verification scope. Apply this to ordinary tasks and subsequent milestones while preserving explicitly required functional acceptance and CI gates.

- Identify changed behavior and its direct and indirect effects before choosing checks. Select relevant lint, types, build, unit or browser checks; do not automatically run every category.
- **Avoid frequent full-suite testing.** Do not run the full test suite, full regression, complete browser matrix or broad build repeatedly after each small edit or subtask. First finish and stabilize a coherent batch of related changes, then run the smallest combined set of checks that covers the batch's changed behavior and regression risks. Merge compatible test cases into one invocation where practical (for example, run the relevant focused unit tests together, then one applicable build/type/lint pass, then the necessary browser acceptance checks). Reuse still-valid results from the same source/configuration and do not rerun checks whose inputs have not changed. If a check fails, diagnose the failure and rerun only the affected check(s) after the fix; repeat broader suites only if the fix changes their coverage or an explicit gate requires it. Never skip a required acceptance gate or weaken assertions merely to reduce test frequency.
- Reuse existing coverage. Add only the minimum meaningful tests for new critical behavior, a fixed defect or a concrete uncovered regression risk. Do not add tests that merely repeat the implementation, chase test counts/coverage, or introduce a new test framework for a small change.
- Documentation, comments and formatting changes that do not affect runtime behavior need content/diff checks, not new runtime tests, builds or rendering suites.
- Prefer a test case, file or module over an entire suite. Batch related edits before verification; do not rerun broad checks after every file edit.
- **Full regression is off by default, including task handoff.** Run it only when explicitly requested, required by the active acceptance/CI gate, or justified by a concrete broad risk that targeted checks cannot cover. State that reason before manually starting it. Committing or finishing an ordinary subtask is not itself a reason.
- When Full is necessary, wait until related changes are stable. There is no mandatory one-Full-run-per-task quota: run none when unnecessary. After a failure, diagnose and rerun the affected checks first; repeat Full only when relevant changes invalidate its evidence or an applicable gate requires it.
- Reuse passing evidence only while the tested source, tests, dependencies, configuration and relevant environment remain applicable. Record the tested revision, checks and results. Never describe an old result as a newly verified HEAD; an explicitly required final-HEAD gate still needs that HEAD's evidence.
- The integration owner coordinates shared/full verification so agents do not duplicate it. Independent focused checks and read-only reviews may run in parallel. Reuse equivalent CI evidence instead of repeating it locally.
- Stop when the change's concrete risks are sufficiently checked and applicable gates are satisfied. Do not add extra verification merely for reassurance.
- User policy (2026-11-04): do not use SwiftShader for any subsequent verification. Hosted Fast/Full are non-rendering; use the local physical GPU for scoped rendering verification and record the adapter. Do not silently fall back to software rendering when hardware is unavailable.
- Local rendering checks, including future additions, use small deterministic scenes with bounded terrain complexity to exercise real production GPU lighting, depth and color output. Full visual matrices belong to explicitly assigned milestone acceptance, not every CI run. Preserve meaningful functional assertions; follow the fixture and evidence rules in `docs/CI.md`.
- Do not remove existing tests, weaken valid assertions or disable required CI gates to reduce work. Report actual checks/results and any unverified scope concisely.

### Cesium / WebGPU verification scope

| Change                                                                      | Minimum relevant verification                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation, handoffs, comments, behavior-preserving formatting           | Review content, links where changed and the diff; no runtime/rendering tests.                                                                                 |
| Local math function or isolated behavior                                    | Existing affected cases; add only missing meaningful cases.                                                                                                   |
| M2.1 coordinates, units/radii, solar direction, ray intersections and depth | Focused numerical/boundary/occlusion checks plus the required high-orbit, low-orbit and ground views. Do not repeat complete regression after each math edit. |
| Camera, rendering pipeline or shared core                                   | Expand checks according to actual impact, including relevant WebGL smoke and rendering/view checks; use Full only under the conditions above.                 |
| Final milestone acceptance                                                  | Run the specified acceptance gates and reuse still-applicable evidence; M2 A07–A10 belong to the M2.6 acceptance task, not every M2.1 iteration.              |

Harmless image differences remain acceptable under `docs/ACCEPTANCE.md`; do not require pixel-identical WebGL/WebGPU output. Functional correctness and the documented `M1-NAV-001` limitation remain governed by that document. Automatic workflow triggers are described in `docs/CI.md`; these instructions do not change those triggers.

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
