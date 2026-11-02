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

Root reviews and cherry-picks the dedicated CI commit after its production fixes,
publishes the existing PR branch, then applies `ci:full` (creating the repository
label if missing) or marks the PR ready. Do not create another PR. Leave the
label attached through final acceptance so later commits automatically run Full.
Verify both tiers on the latest PR head and inspect Full browser/differential
artifacts. The source YAML and policy tests pass locally; GitHub event delivery,
runner timing and hosted execution of the new tier split remain unverified until
that publication. Default-main dispatch remains unavailable, and M1 is not marked
complete by this work.
