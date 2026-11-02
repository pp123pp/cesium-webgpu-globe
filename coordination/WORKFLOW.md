# Codex workflow: context-aware, merge-safe concurrency

## Core principle
**Parallelize independent outputs, serialize shared renderer integrations.** Worktrees isolate working directories but do NOT magically make overlapping changes conflict-free. A sub-agent is a separate implementation/research worker, not an authority to alter milestone scope.

## Roles
- **Integration owner (single):** owns canonical branch, shared Scene/Viewer/render queue edits, API gates, WebGL regression, integration tests and `coordination/STATUS.md` updates. Only integration owner merges.
- **Research subagent:** read-only investigation, returns ≤ 1 page evidence with exact upstream paths and source references, no speculative designs.
- **Feature subagent:** owns explicitly assigned file set with separate worktree/branch; returns diff/PR and handoff, never edits integration-owned source.
- **Verification subagent:** separate tests/reference screenshots and performance observations; cannot secretly rewrite shared renderer code.

## Worktree procedure (Git CLI)
After cloning and establishing a shared integration branch, for **disjoint** tasks:

```bash
git worktree add ../cesium-wgpu-atmosphere -b feat/m2-atmosphere
git worktree add ../cesium-wgpu-sky -b feat/m2-space-sky
# enter each worktree in a separate Codex session and assign exclusive file ownership
# verify tests, review diffs, merge sequentially into integration branch
```

A worktree branch can only be checked out in one worktree; check repository state first. Never run simultaneous source imports or concurrent installs modifying the same checkout. Do not use `git push --force`, `git reset --hard`, or delete another worker's branch unless explicitly approved. Add third-party source only after license review.

## Which work can run in parallel
| Milestone | Parallel eligible | Must remain serialized |
|---|---|---|
| M0 | upstream code audit; build/test investigation; shader prototype in isolated directory | source import, shared Viewer/Scene/bootstrap |
| M1 | provider compatibility research; terrain/imagery test fixtures; precision experiments | shared Globe command submission and renderer backend |
| M2 | atmosphere equations/LUT prototype; Sun/Sky cubemap; HDR test fixtures, **if file ownership distinct** | final compositing order, resource binding and Scene integration |
| M3 | noise/weather generation; cloud scattering reference; camera regression scripts | main cloud pass, temporal history and shared depth integration |
| M4 | cloud shadow derivation; terrain shadow golden scenes | terrain lighting integration and global uniforms |
| M5 | QA test matrices; GPU profiling; screenshot/reference review | code fixes touching shared pipeline |
| M6 | data compatibility matrix; codec checks; sample model inventory | shared scene/model drawing integration |

## Context budgeting
- **One agent = one task = one bounded output.** Do not paste full source directories, giant logs, screenshots or whole task archives into prompts.
- Start each session with only AGENTS, STATUS, ROADMAP and active task. Read just-in-time 1–3 relevant source files and their call sites.
- Use search to locate symbols before opening whole files. Capture paths+line ranges, not 5,000-line dumps.
- At ~half practical context budget or once 1 small PR is ready, produce a handoff using `HANDOFF_TEMPLATE.md`, commit concise notes and start fresh.
- Limit concurrent implementing workers initially to **2**, plus at most **1 read-only reviewer**. Increase only when merge/test throughput demonstrates benefit.
- Avoid subagent chains and nested delegation unless a specific Codex version supports them and resulting source ownership remains clear.

## Submission contract
Every subtask response must contain: goal, owned files, commits/PR, verification actually executed with results, relevant evidence locations, residual risk, exact next action. Integration owner rejects unsupported 'done' claims. For documentation-only tasks, content and diff checks satisfy verification; do not manufacture runtime tests or screenshots.

Follow the risk-based testing policy in `AGENTS.md`. The integration owner chooses and coordinates shared/full checks; workers run only their relevant focused checks and share applicable results. Do not let multiple agents repeat the same full suite or duplicate equivalent CI verification. Stop once the concrete change risks and applicable gates are covered.

## Quality checkpoints
1. Runtime/build changes receive the relevant build or validation checks; errors are surfaced. Documentation-only changes require content/diff review, not a build. Equivalent applicable CI results need not be repeated locally.
2. Scope does not jump to future milestones.
3. WebGL smoke must remain unaffected by WebGPU changes.
4. Code touching common renderer files has single owner and is integrated only after review.
5. Update STATUS once after merging, not from every parallel worker.
