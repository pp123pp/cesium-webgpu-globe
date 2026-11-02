# M1 closeout implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded continuation. Root owns integration, acceptance documents and publication; a read-only reviewer checks the existing source changes independently.

**Goal:** Finish M1 A03–A06 under the user's existing acceptance decisions, publish all retained work and evidence to PR #2, and stop without entering M2 or merging main.

**Architecture:** Preserve the completed native-fill and navigation-policy commits. Execute the real fast-descent scenario and report a diagnosed M1-NAV-001 occurrence as KNOWN_UNRESOLVED; continue mandatory terrain, drape and resource checks. Verify the final source through the existing Fast and Full workflows.

**Tech Stack:** Official CesiumJS 1.146.0, JavaScript/WGSL, Node, Chromium/WebGPU, native Providers, GitHub Actions.

**Spec:** `coordination/M1-PLAN.md`, `tasks/M1.md`, `docs/ACCEPTANCE.md`, and the user's 2026-11-02 instruction to continue M1 closeout.

## Global constraints

- Only M1; no M2 implementation and no merge to main.
- Continue from existing work. Published `6ffe437` has the same tree as local `fd0cae8`; local `5877be7` and `656cb08` preserve the subsequent work.
- Harmless image differences are allowed; images need not be identical.
- Unavailable physical GPU testing is nonblocking; software evidence stays explicitly labeled.
- Only the repeatedly unresolved rapid real-terrain navigation issue has the user's specific nonblocking authorization. Do not call that defect fixed or A06 unconditionally passed.
- Ordinary terrain coverage/LOD, real imagery, drape controls, other navigation, lifecycle and complete WebGL/non-WebGL regression remain required.
- Preserve original failures and all existing results; no history rewrite or broad test suppression.

## Review focus

- Optional native fill hooks must retain the default WebGL path.
- Real/fill mesh replacement, eviction and provider replacement must release resources once.
- Navigation classification must reject unrelated geometry, imagery, endpoint or LOD failures.
- A known navigation occurrence must not stop later drape and cleanup checks.
- Final reports must identify the actual source, browser/GPU, results and known issue separately.

## Tasks

### 1. Recover and verify the unpublished continuation

- [x] Read project instructions and compare published/local trees; clone into an isolated writable checkout without altering the previous workspace.
- [ ] Run the existing focused tests, build/lint/types and real terrain/demo browser gates. Retain actual results and inspect screenshots.
- [ ] Complete independent source and acceptance-policy review; fix only concrete blocking findings, with a failing regression first for any source change.

### 2. Publish and verify the final source

- [ ] Publish the existing continuation and any verified fixes to `feat/m1-wgs84-globe`, preserving the previous remote head and local tree identities.
- [ ] Run Fast and Full on that published source. Preserve an observed M1-NAV-001 result without presenting it as PASS.
- [ ] Verify all other gates and retain concise evidence and links. Investigate only concrete new failures.

### 3. Finish the acceptance record and PR

- [ ] Update STATUS, M1 task/plan, acceptance matrix, capability documentation and handoff to the final evidence.
- [ ] Update PR #2 and mark it ready once M1's authorized gates are complete. Keep its dependency on PR #1 and do not merge.
- [ ] Verify the published final head and CI, report the known limitation and stop at M1.

## Execution notes

The user has already selected this scope and the handling of M1-NAV-001. No new design or repeated permission is needed. The independent checkout is used because the prior workspace is outside the current writable root. Existing tests supply the baseline; this task does not recreate earlier implementation or its RED/GREEN history.
