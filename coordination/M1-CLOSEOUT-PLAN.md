# M1 closeout implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded continuation. Root owns integration, acceptance documents and publication; a read-only reviewer checks the existing source changes independently.

**Goal:** Finish M1 A03–A06 under the user's existing acceptance decisions, publish all retained work and evidence to PR #2, then merge to `main` under the user's later explicit instruction. Stop without entering M2.

**Architecture:** Preserve the completed native-fill and navigation-policy commits. Execute the real fast-descent scenario and report a diagnosed M1-NAV-001 occurrence as KNOWN_UNRESOLVED; continue mandatory terrain, drape and resource checks. Verify the final source through the existing Fast and Full workflows.

**Tech Stack:** Official CesiumJS 1.146.0, JavaScript/WGSL, Node, Chromium/WebGPU, native Providers, GitHub Actions.

**Spec:** `coordination/M1-PLAN.md`, `tasks/M1.md`, `docs/ACCEPTANCE.md`, and the user's 2026-11-02 instruction to continue M1 closeout.

## Global constraints

- Only M1; no M2 implementation. The later 2026-11-02 user instruction “收尾后合并到main” authorizes integration after closeout and supersedes the original no-merge constraint.
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

- [x] Read project instructions, compare published/local trees and use an isolated writable checkout without altering the previous workspace.
- [x] Verify retained focused tests, build/lint/types and actual terrain/demo browser runs; inspect screenshots and retain original failures.
- [x] Complete independent source and acceptance-policy review: no Critical/Important blocker; 51 focused cases independently executed.

### 2. Publish and verify the runtime source

- [x] Publish the existing continuation to `feat/m1-wgs84-globe`, preserving previous heads and local tree identities.
- [x] Run Fast and Full on `03233da`: runs 41430449080 and 41430449094 succeeded. Full actually observed M1-NAV-001 and reports KNOWN_UNRESOLVED.
- [x] Verify all other gates and preserve concise evidence and links in `evidence/M1/closeout/`.

### 3. Finish the acceptance record and integration

- [x] Prepare STATUS, M1 task/plan, acceptance matrix, capability documentation and handoff with verified source results and all retained evidence.

Publication operations are recorded in the live [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) checks and merge history, so recording their outcome does not create another untested source revision:

1. Publish this documentation/evidence-only closeout, update PR #2 and mark it ready. Verify both Fast and an actually executed Full on that final head; older green source checks alone do not satisfy this publication gate.
2. Recheck dependency PR #1's verified head/checks, then merge it normally to `main`. Retarget PR #2 to `main` and verify the prospective merge tree retains the reviewed M1 tree without conflict or extra changes.
3. Merge PR #2 using its verified expected head SHA. Verify main's tree, both merged PR states and the preserved limitation. Stop at M1.

## Execution notes

The user has selected this scope, the handling of M1-NAV-001 and subsequent main integration. No new design or repeated permission is needed. The independent checkout preserves the prior workspace, including previously uncommitted closeout evidence and ignored raw logs. Existing hosted tests certify the runtime source; this documentation-only task does not recreate earlier implementation or its RED/GREEN history. Final-head hosted verification remains mandatory before the authorized merge.
