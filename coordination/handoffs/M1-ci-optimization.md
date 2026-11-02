# M1 CI optimization — implementation and handoff

**Goal:** give every PR code update a Fast gate while retaining the complete M1
and upstream regression gate for final acceptance and significant shared changes.

**Architecture:** two PR workflows with independent cancellation groups. A small
Node policy reads the event and local Git comparison to select Full. Tests execute
the policy against real temporary Git histories and validate workflow wiring.

**Scope:** start at `99185d2`; own only the two CI workflows, dedicated CI policy
script/tests, `docs/CI.md`, and this handoff. Root owns all production changes,
existing acceptance tests, STATUS, publication and integration. No M2, main merge,
dependency changes, PR state changes or label mutations.

## Implementation plan

- [x] Write failing policy/workflow tests: draft updates; incremental shared-file
      detection; ready transition and later commits; persistent `ci:full`; unavailable
      comparison; independent cancellation; preserved acceptance commands.
- [x] Implement the pure CI selector and split the existing workflow without
      reducing the full suite or rebuilding the candidate twice within one tier.
- [x] Validate YAML, shell blocks, event conditions, focused tests and formatting;
      document actual repository checks, manual trigger availability and measured
      historical timings separately from projected savings.
- [x] Prepare the owned files for a dedicated commit and return the exact commit and remaining hosted
      verification to root. No self-integration or new PR.

## Decisions

- `synchronize` compares `before..head`; opened/reopened use the PR's base/head
  merge-base comparison. Missing history selects Full conservatively.
- The `ci:full` label runs Full immediately and on later draft updates while it
  remains attached. Removal disables that override for later updates.
- Unrelated label events use an isolated cancellation group, so they cannot cancel
  an active Full run. Fast and Full never cancel one another.
- Keep required-check settings unchanged. Public branch metadata currently reports
  protection disabled and no required checks on main or PR #2's base; rulesets are
  empty. The protected-status endpoint itself requires authentication.
- Main contains only `import-cesium.yml`; dispatch is future support, not a currently
  available manual entry. Root must publish and use the PR label or ready event.

## Verification and handoff

Branch: `chore/m1-tiered-ci`, based on `99185d2`, in the isolated `m1-ci`
worktree. The integration owner receives the exact commit in the task response;
this worktree does not publish or integrate itself.

Owned changes:

- `.github/workflows/m0-webgl-baseline.yml`: Fast build/lint/types, all focused
  M0/M1 units, independent visible WebGL comparison and M0/M1 WebGPU smoke.
- `.github/workflows/m1-full-regression.yml`: selector and complete original
  regression, including live terrain/demo acceptance; independent cancellation.
- `coordination/ci/m1-ci-policy.mjs` and `m1-ci-policy.test.mjs`: event/Git policy
  plus executable temporary-history and actual-YAML contract tests.
- `docs/CI.md` and this handoff: trigger matrix, manual label semantics, current
  required-check/dispatch facts, evidence and qualified timing estimate.

Executed verification (local Node 24.22.1; workflow retains Node 22):

| Check                                            | Result                                                                                                   | Evidence under `Build/m1-ci/`                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `node coordination/ci/m1-ci-policy.test.mjs`     | 28 passed, 0 failed; RED before implementation, GREEN after                                              | `policy-red.log`, `policy-green.log`           |
| `actionlint -shellcheck=` on both workflows      | Pass, actionlint 1.7.12                                                                                  | `actionlint.log`, `actionlint/provenance.json` |
| `bash -n` on every YAML run block                | 23 passed                                                                                                | `shell-syntax.log`                             |
| ESLint and Prettier APIs, assigned files only    | Pass                                                                                                     | `format-lint.log`                              |
| markdownlint API, two documents                  | Pass                                                                                                     | `markdownlint.log`                             |
| Compare Full against original `99185d2` workflow | 12 command bodies plus their conditions/env and all artifact paths unchanged; unit list expanded to glob | `preserved-gates.log`                          |
| `git diff --check`                               | Pass                                                                                                     | Command output empty                           |

The policy fixtures cover shared-file changes, document-only incremental updates,
renames, force-push/missing history, ready and manual events, retained/removed
labels, unrelated-label cancellation, exact-head checkout, one candidate build,
lint/types and preserved acceptance wiring. The tests use the installed existing
`js-yaml` dependency to read workflows; no dependency/configuration files changed.

Public read-only API observations and actual historical Actions step timestamps
are in `Build/m1-ci/repository-snapshot.json`; stable run links and observed facts
are recorded in `docs/CI.md`. Estimated Fast-path omitted upstream work is
429–447 seconds, not a measured new workflow speedup. The actionlint release was
downloaded into ignored output and its official SHA-256 checksum was verified.

No product source, existing acceptance test, milestone status, branch protection,
PR state, label or `main` was changed. Existing focused/browser suites were not
rerun by this CI-only subtask. Root retains responsibility for the integrated M1
build and full runtime acceptance.

## Exact next action and remaining risk

The initial CI commit was integrated as `5617dfb` and published in the equivalent
tree at `8316a5df890d14e095324e8ba8002c13a07a160e`. The first hosted attempt below
found a test-import compatibility defect. Root must integrate the small follow-up
fix, publish the existing PR branch, and verify both tiers on the latest head.
The integration owner will apply `ci:full` on the final head to verify the manual
entry. Leave that label attached through final acceptance so later commits also
run Full. Default-main dispatch remains unavailable, and this work does not mark
M1 complete.

## First hosted attempt and compatibility follow-up

At head `8316a5d`, tree `9de29f76367de66952879c8fd88f24d0d0071de5`:

- [Fast run 41421978109](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41421978109)
  and [Full run 41421978175](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41421978175)
  were the only runs for this head; both were `pull_request`, with no duplicate
  push run. The PR was a draft with no labels.
- The hosted selector passed and reported `shared-code-update`, `before..head`,
  `comparisonAvailable: true`, and exactly the six newly changed CI/docs files.
  [Selection artifact](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41421978175/artifacts/13129738716).
- Published YAML matches the reviewed workflow. Its actual PR context evaluates
  to `m1-fast-2` and `m1-full-2`, each with cancellation enabled. Both jobs ran
  simultaneously. Superseding-head cancellation and manual labels were not
  exercised by this read-only verification.
- Candidate build, lint/generated TypeScript checks and the independent reference
  build passed in both tiers. The new policy test then failed during module import:
  hosted `js-yaml` does not expose a default export. Chromium installation was
  skipped after that failure; subsequent missing-browser errors are consequences
  of the import failure, not executed terrain/demo acceptance results.
- Fast elapsed **164 seconds (2m 44s)**, with a 160-second job; Full elapsed
  176 seconds. These are **failed, incomplete runs**, not successful Fast timing
  measurements or final acceptance. Successful Fast timing remains pending.

The follow-up changes only the policy test's YAML import/calls to named `load`,
which is supported by both the existing js-yaml 4.2.0 and current v5 API
([upstream migration guide](https://github.com/nodeca/js-yaml/blob/master/docs/migrate_v4_to_v5.md)).
An isolated, registry-integrity-verified js-yaml 5.5.0 fixture reproduced the exact
default-export failure before the fix. After the fix, **28/28 tests pass under
both 4.2.0 and 5.5.0**, and ESLint/Prettier pass. No dependency manifests,
workflows, existing acceptance tests or assertions are changed by this fix.

Evidence is under `Build/m1-ci/hosted-8316a5d/` (selection, final run/job metadata,
failure excerpts, exact published YAML and concurrency evaluation), plus
`Build/m1-ci/yaml-v5-red.log`, `yaml-v4-green.log`, `yaml-v5-green.log`, and
`yaml-v5-compat/package-provenance.json`. No Actions rerun, PR state or label
mutation was performed by this verification task.
