# WebGPU CI: Fast feedback and complete regression

Every PR commit receives **Fast CI**. **Full regression** retains the complete
upstream and M0/M1/M2.1 acceptance gates and must pass on the latest PR head before
final acceptance. A successful Fast run or a skipped Full job does not satisfy that
acceptance requirement.

## Agent verification cadence

The user's 2026-11-02 policy in [`AGENTS.md`](../AGENTS.md#risk-based-testing-and-verification)
limits test authoring and local/manually requested execution to the smallest
sufficient scope. Routine implementation work uses affected cases/modules and
necessary rendering views. Documentation-only work needs content/diff checks;
it does not reopen a completed milestone or require a manual Full run.
Add tests only for a concrete coverage gap, critical new behavior or a regression.

Full is not an automatic task-closing ritual. Run it when explicitly requested,
required by the active acceptance/CI gate, or justified by a specific broad risk
that targeted checks cannot cover. Batch related edits first. Reuse applicable
CI results instead of repeating them locally, and coordinate shared checks
through the integration owner. An old source result must never be presented
as a passing result for a newly required final HEAD.

**This policy does not change the workflow YAML or selector.** The trigger table
below still applies: a ready PR automatically selects Full, including for a
documentation update; every PR commit receives Fast. Assemble related changes
before making a PR ready to avoid repeated automatic Full runs. Do not manually
add `ci:full`, dispatch Full or rerun it for an isolated documentation update
without one of the reasons above. Required final milestone acceptance still needs
successful Fast and an actually executed Full on the specified latest PR head.

## What each tier runs

| Gate                                                                                                     | Fast CI | Full regression |
| -------------------------------------------------------------------------------------------------------- | ------- | --------------- |
| Pinned Cesium version, license and upstream revision checks                                              | Yes     | Yes             |
| Candidate build                                                                                          | Once    | Once            |
| WebGPU/Viewer lint, generated declarations and all TypeScript projects                                   | Yes     | Yes             |
| M0 focused tests and every `coordination/ci/m1-*.test.mjs` / `m2-*.test.mjs`                             | Yes     | Yes             |
| Visible WebGL comparison against independently built `724b5db`, including missing-Globe negative control | Yes     | Yes             |
| M0 WebGPU proof and M1 real globe browser smoke                                                          | Yes     | Yes             |
| M2.1 actual WGSL, high/low/ground depth, boundary rays and resource cleanup                              | Yes     | Yes             |
| Complete upstream non-WebGL suite with `--failTaskOnError`                                               | —       | Yes             |
| Complete upstream WebGL differential against `724b5db`                                                   | —       | Yes             |
| M1 imagery and navigation browser acceptance                                                             | —       | Yes             |
| Live M1 terrain, draping, seams and near-ground flight                                                   | —       | Yes             |
| Live demo, provider errors and lifecycle acceptance                                                      | —       | Yes             |

The workflows are `.github/workflows/m0-webgl-baseline.yml` (Fast) and
`.github/workflows/m1-full-regression.yml` (Full). Each builds its own candidate and
independent reference once. Full does not depend on a Fast artifact or a previous
commit's result. The reference build is necessary for the visible WebGL comparison
even in Fast.

Both tiers generate declarations with `npm run build-ts`, compile the Sandcastle
template declaration with
`npm exec --package=typescript --offline -- tsc --project packages/sandcastle/templates/tsconfig.lib.json`,
then run `npm run tsc`. The template generation is required by the upstream
Sandcastle gallery imports; omitting it can produce a TypeScript resolver failure
on a fresh checkout.

The focused-test globs include new M1/M2 tests and the same-frame scene callback
suite. M2.1 adds 27 dedicated unit cases and the required
`coordination/ci/m2-foundation-smoke.mjs` browser gate. The browser report executes
the real shared WGSL, reads native terrain depth and checks 35,786 km / 400 km /
2 m cameras, off-axis rays, boundary contacts, sky, resize and resource cleanup.
Its `Build/m2-foundation/` reports and screenshots are included in `m1-fast` and
`m1-full-regression` artifacts; the historical workflow/artifact names remain.

No acceptance test or assertion is removed. Full preserves the
upstream WebGL differential policy: identical inherited failures are recorded;
new failures, missing execution or changed assertion signatures fail the gate.

## Trigger policy

| PR event or state                             | Fast                                             | Full                                                                                   |
| --------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Draft opened/reopened                         | Yes                                              | If shared changes, `ci:full`, or unavailable comparison                                |
| Draft receives a commit                       | Yes                                              | If this update changes shared code/configuration, `ci:full`, or unavailable comparison |
| Ready PR opened/reopened or receives a commit | Yes                                              | Always                                                                                 |
| `ready_for_review`                            | Existing commit's Fast result remains applicable | Always                                                                                 |
| Add `ci:full` label                           | No additional Fast run                           | Immediately, on current head                                                           |
| Other label added                             | No                                               | Selection records a skip; active Full is preserved                                     |
| `workflow_dispatch`                           | No                                               | Always; workflow is now present on `main`                                              |

There is no `push` trigger. A branch push associated with a PR produces the PR's
`synchronize` event without a second push workflow run. A branch without a PR does
not receive these PR gates.

### What counts as a shared change

`coordination/ci/m1-ci-policy.mjs` selects Full for changes under `packages/core`,
`packages/engine`, `packages/widgets`, `Specs`, `scripts`, `.github/workflows` or
`coordination/ci`, and for package manifests/locks, root gulpfiles, TypeScript
configuration, `eslint.config.js` and `server.js`. Isolated `WebGPU*.js` modules
under `packages/engine/Source` are eligible for Fast-only iteration while a PR is
a draft. A shared `Viewer.js`, native Globe, renderer, core or test-harness edit
still selects Full.

For `synchronize`, the selector compares the event's previous head (`before`) with
the current PR head. An older Viewer change in the cumulative PR diff therefore
does not force Full for every later documentation-only update. Opened/reopened
events conservatively use the complete base-to-head merge-base diff. Renames are
read as separate deletion/addition paths so renaming a shared file cannot hide its
removal. Missing/invalid SHAs or unavailable Git history select Full. A malformed
event that prevents selection fails the workflow.

The selector checks out the exact PR head with full Git history, reads the local
diff without a paginated API/file-count limit, and saves its reason and head in
`m1-full-selection/full-selection.json` and the Actions summary. Candidate jobs
also check out that same event head explicitly.

### Cancellation

Fast uses `m1-fast-<PR number>`; Full uses `m1-full-<PR number>`. Both set
`cancel-in-progress: true`. A newer revision cancels obsolete work in its own tier
without cancelling the other tier. An eligible Fast-only update also cancels an
older Full for an obsolete head before recording the new Full skip.

Unrelated label events use a separate Full group containing the run ID. They
cannot cancel a real Full run. Adding `ci:full` or marking the PR ready uses the
normal Full group and can replace an older run for the same PR. Evidence upload
steps use `always()`, including cancellation paths.

## Manual Full and final acceptance

**Current route: apply the `ci:full` PR label after these workflows are published
on the PR branch.** A maintainer can create the label if necessary and add it in
GitHub's PR interface. With GitHub CLI and an authorized user session:

```bash
gh label create ci:full --repo pp123pp/cesium-webgpu-globe --color B60205 --description "Run complete M1 regression"
gh pr edit 2 --repo pp123pp/cesium-webgpu-globe --add-label ci:full
```

Only create the label if it is missing. If already attached and a new run is
needed for the same head, remove and re-add it, or rerun the previous Full run
after verifying that run targets the current head. Adding an already attached
label does not reliably create another `labeled` event.

**The label is persistent:** later draft commits also run Full while it remains
attached. Removing it disables this override for subsequent updates; it does not
cancel an already running Full. Shared-code and ready-PR triggers continue to
apply. Leave the label attached through final verification so any later commit
automatically receives Full again. A maintainer's label action is required;
GitHub normally suppresses new workflow runs from events created with a workflow's
own `GITHUB_TOKEN` ([GitHub trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).

Before final milestone acceptance, verify the latest PR head SHA, a successful Fast job,
and a successful **executed** `Full regression` job for that same head. Check the
selection evidence and the uploaded `m1-full-regression` browser/differential
artifacts. A selector-only success, skipped Full, older passing head or cancelled
run is insufficient. Final status remains the integration owner's decision.

### Historical dispatch limitation and current state

The limitation below applied before M0/M1 integration. It no longer describes
current `main`: both workflows are present at
`c47ef56343343684f50992af8a3f32813402884f`, and the
[`workflow_dispatch` run 41439499307](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41439499307)
demonstrates that manual dispatch is available. That historical run failed and
is not M2.1 acceptance evidence. A ready M2 PR selects Full without a label or
additional dispatch; do not start a duplicate Full while its final-head run is
already executing.

On 2026-11-02, default `main` was
`a7f472990cc4cb9fa6628181952fa8be7ad43eda`; its workflow directory contained only
`import-cesium.yml` ([recorded revision](https://github.com/pp123pp/cesium-webgpu-globe/tree/a7f472990cc4cb9fa6628181952fa8be7ad43eda/.github/workflows)).
GitHub requires a `workflow_dispatch` workflow to exist on the default branch
before it can be manually dispatched
([GitHub manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).
An Actions workflow registry entry alone does not meet that requirement.

At that earlier checkpoint the Full YAML's dispatch was not yet usable. Label
and ready-for-review PR events supplied the immediate routes. Actual hosted
execution must always be verified; local policy tests cannot prove GitHub
delivered an event.

## Required status checks: observed state

The 2026-11-02 read-only repository audit found both `main` and PR #2's base,
`feat/m0-webgpu-backend`, with `protected: false`, protection disabled, and empty
required-check contexts/checks. Repository rulesets were empty. Sources:
[main branch API](https://api.github.com/repos/pp123pp/cesium-webgpu-globe/branches/main),
[PR base branch API](https://api.github.com/repos/pp123pp/cesium-webgpu-globe/branches/feat%2Fm0-webgpu-backend),
and [repository rulesets API](https://api.github.com/repos/pp123pp/cesium-webgpu-globe/rulesets).
The dedicated protection endpoint required authenticated access; the stated
observation comes from the public branch metadata and ruleset response.

This change does not alter branch protection or required checks. The visible jobs
are `Fast CI`, `Select Full regression`, and `Full regression`. There was no
required `webgl-baseline` context to preserve in the observed settings. If an owner
later configures protection, verify the current settings and check names then;
branch protection cannot replace the explicit final-head Full acceptance rule.

## Expected time benefit and limits

Historical successful workflow runs provide a reference, not a benchmark of the
new tiers:

| Original run                                                                           | Run elapsed | Complete non-WebGL | Complete WebGL differential |
| -------------------------------------------------------------------------------------- | ----------- | ------------------ | --------------------------- |
| [41407632894](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41407632894) | 10m 16s     | 60s                | 386s                        |
| [41413125879](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41413125879) | 10m 54s     | 61s                | 386s                        |
| [41415613101](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41415613101) | 10m 29s     | 59s                | 370s                        |

Moving just the two complete upstream suites out of ordinary draft iterations
removes approximately **429–447 seconds (7.2–7.5 minutes)** of work from their Fast
path, based on those step timestamps. This is an estimate of omitted work, not a
measured Fast wall-clock improvement. Current type generation, browser setup,
live service latency, runner queues and the newer acceptance coverage affect
actual timing. Historical successful runs predate the latest full terrain/demo
acceptance and do not certify it.

Ready/shared/manual Full events run both independent tiers, so they deliberately
retain duplicate setup across workflows. Cancellation saves obsolete-run work;
it does not reduce the selected Full gate itself. Compare new hosted timing only
after successful runs of the integrated head.

## Local verification of the policy

After installing the existing repository dependencies:

```bash
node coordination/ci/m1-ci-policy.test.mjs
actionlint .github/workflows/m0-webgl-baseline.yml .github/workflows/m1-full-regression.yml
```

The tests execute the selector against temporary Git histories and real event
files, inspect the actual YAML, exercise cancellation expressions, and check that
both complete upstream suites and all browser gates remain wired into Full.
They also check exact-head checkout, one candidate build per tier, lint/types,
focused-test discovery and the WebGL negative control. Browser/acceptance results
remain the responsibility of the hosted workflows and integration verification.
