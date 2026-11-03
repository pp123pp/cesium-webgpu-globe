# WebGPU CI: Fast and non-rendering Full regression

The user's 2026-11-03 instruction removes software-GPU rendering tests from
**Full regression**. Full now checks source, builds, types and unit tests, including
the complete upstream non-WebGL suite. **A passing Full does not certify rendering
acceptance or complete WebGL no-regression.** Fast retains its existing rendering
checks. Rendering scripts and their assertions remain in the repository for
separately authorized execution.

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
existing behavior, not permission to initiate more runs. This change does not
disable Fast's software-GPU checks.

## What each tier runs

| Gate | Fast CI | Full regression |
| --- | --- | --- |
| Pinned Cesium version, license and upstream revision | Yes | Yes |
| Candidate build | Once | Once |
| WebGPU/Viewer lint, generated declarations and TypeScript | Yes | Yes |
| Focused M0 tests and all `m1-*.test.mjs` / `m2-*.test.mjs` | Yes | Yes |
| Visible WebGL comparison with `724b5db`, including missing-Globe negative control | Yes | No |
| M0 WebGPU proof and M1 Globe browser smoke | Yes | No |
| M2.1 WGSL, depth, representative views and resource cleanup | Yes | No |
| M2.2 atmosphere, real-depth aerial perspective and resource cleanup | Yes | No |
| M2.3 Sun, occultation, transmittance and resource cleanup | Yes | No |
| M2.4 Moon, stars, moonlight and resource cleanup | Yes | No |
| Complete upstream non-WebGL suite with `--failTaskOnError` | No | Yes |
| Complete upstream WebGL differential | No | No |
| M1 imagery/navigation browser acceptance | No | No |
| Live terrain, draping, seams and near-ground flight | No | No |
| Live demo, provider errors and lifecycle acceptance | No | No |

The workflows are
[Fast](../.github/workflows/m0-webgl-baseline.yml) and
[Full](../.github/workflows/m1-full-regression.yml). Each builds its own candidate;
Full does not reuse Fast artifacts or results. Only Fast checks out and builds the
independent pre-WebGPU reference for its visible WebGL comparison. Full still uses
Chromium for upstream **non-WebGL** unit tests; installing a browser does not mean
that Full runs a rendering gate.

Both tiers generate declarations with `npm run build-ts`, compile the Sandcastle
template declaration using
`npm exec --package=typescript --offline -- tsc --project packages/sandcastle/templates/tsconfig.lib.json`,
then run `npm run tsc`. Focused tests of rendering helpers remain unit tests; their
presence does not restore the removed real-browser rendering gates.

## Rendering evidence and acceptance limits

Fast uploads its existing `m1-fast` artifact: visible WebGL/negative-control,
M0 WebGPU, M1 Globe and M2 foundation/atmosphere/Sun/space reports and captures.
These are the checks actually executed by Fast, not complete upstream WebGL or
live terrain/demo acceptance. Full retains its `m1-full-selection` selection
artifact; its non-WebGL test results are in Actions logs. It no longer uploads
`m1-full-regression` rendering reports, screenshots or complete WebGL differential
evidence. Historical rendering artifacts do not describe the new Full scope.

The complete WebGL differential, imagery/navigation, live terrain and demo scripts
remain under `coordination/ci/`, with their assertions intact. Run them only under
separate authorization and report the actual GPU, source and result. Their absence
from Full does not convert unexecuted checks into passes or resolve previously
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
the actual workflows: checkout, builds, lint/types, unit-test discovery, unchanged
Fast rendering gates, and Full's retained non-WebGL suite and excluded rendering
gates. This is configuration verification, not a rendering test or authorization
to execute Full.

This change does not alter branch protection or required-check settings. Visible
job names remain `Fast CI`, `Select Full regression`, and `Full regression`. Inspect
current repository settings when those settings matter; historical observations
are not proof of current protection. Report each executed check within its actual
scope rather than treating the name "Full" as a complete rendering acceptance.
