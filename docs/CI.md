# WebGPU CI: non-rendering hosted checks and local hardware validation

User policy (2026-11-04): **do not use SwiftShader for subsequent verification**.
Rendering verification uses the local physical GPU and records its actual adapter.
Hosted Fast checks source, build, types and focused unit tests; Full additionally
runs the complete upstream non-WebGL suite. Neither tier runs software-GPU
rendering. **Passing CI does not certify rendering acceptance or complete WebGL
no-regression.** Rendering scripts and their assertions remain available for
scoped local hardware verification; never silently fall back to SwiftShader.

## Agent verification cadence

Use the smallest sufficient checks under
[AGENTS.md](../AGENTS.md#risk-based-testing-and-verification). Batch related edits
before verification and publication; do not push frequent intermediate changes to
trigger repeated CI. Reuse still-applicable evidence and identify its tested source.
Documentation-only work needs content/diff checks, not runtime suites.

**Do not manually execute, dispatch or rerun Full without explicit user
authorization.** An older milestone's Full requirement, task completion or a failed
run does not supply that authorization. Do not add or toggle `ci:full`, mark a PR
ready, or make an extra push solely to cause another Full run without authorization.
Coordinate any authorized verification through the integration owner.

The automatic event triggers and selector are unchanged. Consequently, an
otherwise authorized update to a ready PR still automatically selects Full;
draft shared-code updates can also select it. The table below describes that
existing behavior, not permission to initiate more runs. Fast's former
software-GPU rendering steps are removed under the user's explicit instruction.

## Functional rendering checks versus visual acceptance

User policy (2026-11-04): local rendering checks, including future additions,
must use small, deterministic scenes with bounded terrain complexity and no
external provider dependency. Exercise the real production WebGPU shaders,
native mesh depth and displayed output; do not replace them with mocked pixels.
Keep meaningful illumination, occlusion and color assertions. Terrain loading
should not repeatedly run expensive sky/solar effects: restore all settings
before checking the final rendered output. Record fixture limits and readiness.

The B5-A remediation smoke uses a 640×360 viewport and native ellipsoid terrain
meshes capped at level 8. It checks twilight/night surface brightness, real depth,
solar contrast, irradiance response and the unlit color codec. This is functional
regression coverage, not a replacement for the accepted 1920×1080 visual evidence.

Full visual matrices (real terrain and LOD transitions, multiple altitudes,
exposures/resolutions, 120-frame motion and GPU profiling) belong to explicitly
assigned milestone acceptance. Do not add those matrices to every CI run.
Apply this separation to subsequent workflow changes without silently removing
functional assertions. Both hosted tiers remain non-rendering. Run applicable
local browser scripts with `M0_GPU_MODE=hardware` and
`M0_REQUIRE_PHYSICAL_GPU=1`, selecting the installed hardware-capable browser.
The shared browser configuration defaults to hardware, rejects software mode
and always requires a physical adapter; an environment override cannot disable
that requirement or silently reinstate SwiftShader.
If no physical adapter is available, record that limitation instead of running
SwiftShader. Historical software reports remain historical evidence only.

## What each tier runs

| Gate | Fast CI | Full regression |
| --- | --- | --- |
| Pinned Cesium version, license and upstream revision | Yes | Yes |
| Candidate build | Once | Once |
| WebGPU/Viewer lint, generated declarations and TypeScript | Yes | Yes |
| Focused M0 tests and all `m1-*.test.mjs` / `m2-*.test.mjs` | Yes | Yes |
| Visible WebGL comparison with `724b5db`, including missing-Globe negative control | Local hardware | No |
| M0 WebGPU proof and M1 Globe browser smoke | Local hardware | No |
| M2.1 WGSL, depth, representative views and resource cleanup | Local hardware | No |
| M2.2 atmosphere, real-depth aerial perspective and resource cleanup | Local hardware | No |
| M2.3 Sun, occultation, transmittance and resource cleanup | Local hardware | No |
| M2.4 Moon, stars, moonlight and resource cleanup | Local hardware | No |
| B5 lighting/depth/color functional fixture | Local hardware | No |
| Complete upstream non-WebGL suite with `--failTaskOnError` | No | Yes |
| Complete upstream WebGL differential | No | No |
| M1 imagery/navigation browser acceptance | No | No |
| Live terrain, draping, seams and near-ground flight | No | No |
| Live demo, provider errors and lifecycle acceptance | No | No |

The workflows are
[Fast](../.github/workflows/m0-webgl-baseline.yml) and
[Full](../.github/workflows/m1-full-regression.yml). Each builds its own candidate;
Full does not reuse Fast artifacts or results. Neither hosted tier checks out or
builds the pre-WebGPU rendering reference. Full still uses
Chromium for upstream **non-WebGL** unit tests; installing a browser does not mean
that Full runs a rendering gate.

Both tiers generate declarations with `npm run build-ts`, compile the Sandcastle
template declaration using
`npm exec --package=typescript --offline -- tsc --project packages/sandcastle/templates/tsconfig.lib.json`,
then run `npm run tsc`. Focused tests of rendering helpers remain unit tests; their
presence does not restore the removed real-browser rendering gates.

## Rendering evidence and acceptance limits

Fast no longer produces the historical `m1-fast` rendering artifact. Local
hardware reports must identify the source, bundle, physical adapter and executed
checks. Full retains its `m1-full-selection` selection artifact; its non-WebGL
test results are in Actions logs. Historical hosted rendering artifacts do not
describe either tier's current scope.

The complete WebGL differential, imagery/navigation, live terrain and demo scripts
remain under `coordination/ci/`, with their assertions intact. Run them only under
separate authorization and report the actual GPU, source and result. Their absence
from hosted CI does not convert unexecuted checks into passes or resolve previously
observed rendering defects. Applicable rendering requirements in
[ACCEPTANCE.md](ACCEPTANCE.md) need their own evidence or an explicit scope decision;
a green Full alone cannot satisfy them. Historical final-head Full requirements
and selector-summary wording do not authorize a new run or imply rendering coverage.

## Trigger policy

| PR event or state | Fast | Full |
| --- | --- | --- |
| Draft opened/reopened | Yes | Shared changes, `ci:full`, or unavailable comparison |
| Draft receives a commit | Yes | This update changes shared code/configuration, `ci:full`, or unavailable comparison |
| Ready PR opened/reopened or receives a commit | Yes | Always |
| `ready_for_review` | Existing commit's result remains applicable | Always |
| Add `ci:full` label | No additional run | Current head |
| Other label added | No | Selector records a skip; active Full is preserved |
| `workflow_dispatch` | No | Always |

There is no `push` trigger. A push to a branch with a PR produces the PR's
`synchronize` event; a branch without a PR does not receive these PR gates.
Manual dispatch is available with the workflow on `main`; it is not an instruction
to dispatch. The `ci:full` label persists: later draft updates also select Full
while attached. Removing it disables only that override for later updates, not
shared-code/ready-PR triggers or an already running job.

### Shared changes and exact source

[m1-ci-policy.mjs](../coordination/ci/m1-ci-policy.mjs) selects Full for changes
under `packages/core`, `packages/engine`, `packages/widgets`, `Specs`, `scripts`,
`.github/workflows` or `coordination/ci`, and for package manifests/locks, root
gulpfiles, TypeScript configuration, `eslint.config.js` and `server.js`. Isolated
`WebGPU*.js` modules under `packages/engine/Source` are eligible for Fast-only draft
iteration. Shared Viewer, native Globe, renderer, core or test-harness edits still
select Full.

For `synchronize`, selection compares the previous event head (`before`) with the
current head. Opened/reopened events use the base-to-head merge-base diff. Renames
are treated as deletion/addition paths. Missing/invalid SHAs or unavailable history
select Full; a malformed event that prevents selection fails the workflow.

The selector checks out the event head with full Git history and reads the local
diff. It records its reason and head in the `m1-full-selection` artifact's
`full-selection.json` and Actions summary. Candidate jobs check out that same head.
A selection-only success or skipped job does not mean the Full tests executed.
Older passing revisions and cancelled runs do not certify a new revision.

### Cancellation

Fast uses concurrency group `m1-fast-<PR number>` and Full uses
`m1-full-<PR number>`, both with `cancel-in-progress: true`. New revisions cancel
obsolete work within their own tier. A Fast-only update can cancel an older Full
before recording the new skip. Unrelated label events use a separate group with
the run ID, so they cannot cancel a real Full run. Adding `ci:full` or marking a PR
ready uses the normal Full group. Evidence uploads use `always()`.

## Local policy checks and repository settings

For a related workflow/selector change, the focused check is:

```bash
node coordination/ci/m1-ci-policy.test.mjs
```

It checks selector decisions against temporary Git histories/events and inspects
the actual workflows: checkout, builds, lint/types, unit-test discovery,
hosted rendering exclusions, and Full's retained non-WebGL suite.
This is configuration verification, not a rendering test or authorization
to execute Full.

This change does not alter branch protection or required-check settings. Visible
job names remain `Fast CI`, `Select Full regression`, and `Full regression`. Inspect
current repository settings when those settings matter; historical observations
are not proof of current protection. Report each executed check within its actual
scope rather than treating the name "Full" as a complete rendering acceptance.
