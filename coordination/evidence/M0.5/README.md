# M0.5 evidence — 2026-11-02

All images are actual browser captures, not generated illustrations. Chromium 156.0.8078.4 on Ubuntu 24.04 uses Google SwiftShader. The user explicitly waived unavailable physical GPU testing as a blocker; none of these artifacts prove physical GPU operation.

- `webgl-smoke.json` and `webgl-{orbit,oblique,resized}.png`: actual visible Globe, three stable ready frames, exact pre-WebGPU reference pixel matches, and repeatable settled PNG captures.
- `webgpu-smoke.json`, `webgpu-smoke.png`, `webgpu-demo.png`: all 17 real-browser initialization, depth, lifecycle and demo checks.
- `webgl-differential-summary.json`: final accepted full-suite comparison. Each side executed 3,822 specs: 3,810 passed and the same 12 failed (12,068 skipped). Complete failure assertions and execution order agree. The raw suites exit 1; the no-new-regression gate exits 0. CI uploads complete per-spec reports separately.
- `cesium-m0-webgl-*-comparison.json`: earlier unsorted diagnostic runs, retained for provenance. They are not the accepted final gate. `cesium-m0-shadowmap-control-comparison.json` isolates the ordering diagnosis.
- `control-flow-probes.mjs`: five mock control-flow probes for healthy exits, final-write deadlines and reference rollback. They are not GPU-rendering evidence. Run `node coordination/evidence/M0.5/control-flow-probes.mjs` from the repository root.

Commands, upstream baseline commit and environment repairs are documented in `coordination/handoffs/M0.5-regression-gate.md`. The deterministic raw pixel references and their provenance live in `coordination/ci/references/m0-webgl/`.
