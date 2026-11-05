# Context handoff — M3-01 / 2026-11-05

**State:** VERIFIED; pending user专项验收.
**Branch:** `feat/m3-01-curved-cloud-layer`.
**Objective:** task 1 of `tasks/M3.md`, curved WGS84 cloud shell and ray intersection.

## What changed

- `packages/engine/Source/Scene/WebGPUCloudLayer.js`: axis-offset ellipsoids,
  CPU ray interval subtraction/occlusion and split uniform packing.
- `packages/engine/Source/Scene/WebGPUCloudLayerShader.js`: robust GPU shell
  intersections, repeated tangents, Earth and real-depth clipping.
- `coordination/ci/m3-cloud-*.mjs`: focused CPU, physical GPU and actual Demo tests.
- `Apps/WebGPUCloudGeometry.js`, `Apps/WebGPUGlobe.html`, `Apps/WebGPUIndex.html`:
  default-off diagnostic overlay and three altitude presets.
- `.github/workflows/`: add M3 checks, package the Demo module for Pages.
- `package.json`, `server.js`: user-authorized 8067 demo startup and optional mirror.
- `coordination/plans/M3-01.md`: scoped implementation and authorized additions.
- [Evidence package](../evidence/M3-01/README.md): source/GPU identities, raw results,
  screenshots, limits and retained development failures.

## Verified evidence

Implementation `0ed4fb5`, Demo/server `07e00af`.
Final geometry and Demo capture source: clean
`07e00af375efa01560df5e3687bbea5aaf2365f5`.
33 focused tests and 28 CI-policy cases pass. Build, generated APIs, scoped
lint/format/types and commit hooks pass. Intel Xe-LPG / Arc 130T, headed Chrome
156.0.8078.80 passes geometry, native raised-depth, actual UI, resize and cleanup.
Existing physical WebGL smoke passes; no complete final-HEAD differential claim.

## Decisions and risks

WGS84 axis expansion has at most 8.460 mm height shortfall at 6 km. Compensated
math is required because this adapter did not retain the expected `fma` residual.
Canonicalization-band precision and total float32 distance precision are distinct.
Observed shallow native-pick/raster-depth discrepancy is retained, not claimed fixed.
Default-off preview preserves output when disabled; no normal Scene or WebGL path
was modified. Public cloud appearance and A11–A13 remain future milestones.

`coordination/STATUS.md` was not changed: workflow requires its integration owner
to update it after merge. No merge is authorized in this task.

## Next smallest action

User reviews the geometry evidence and Demo, then decides M3-01 acceptance.
Do not merge main or start M3-02 without a new instruction.

## Read next time

AGENTS.md, coordination/STATUS.md, tasks/M3.md and the linked M3-01 evidence index.
