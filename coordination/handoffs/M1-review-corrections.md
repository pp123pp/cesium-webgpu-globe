# M1 callback and scene-event review corrections

## Scope and cause

Independent review of `99185d2736b95e756837596a136665a2c2535b66` reproduced six synchronous imagery-error callback failures and four scene-event failures. Test-only commit `d36643ccdd03ef740be264e75022247e64539114` was integrated as `e3f812f`; original RED evidence remains in `coordination/evidence/M1/review-callbacks/`.

- Synchronous request/upload errors notified listeners while native `TileImagery.processStateMachine` still held imagery references. Removing a layer, replacing terrain or destroying the adapter then resumed into freed native objects.
- `postUpdate` and `preRender` ran after terrain selection. Provider replacement freed queued meshes; camera changes left selection and culling one frame behind.

## Correction

- Track native imagery association call depth. Only failures originating inside that stack defer their entire state transition and error notification to a microtask, retaining `TRANSITIONING` until then. Active-generation guards discard notifications after release. Retries still reset to `UNLOADED` while the tile remains loading.
- Recheck terrain generation after imagery processing.
- Raise scene update/render events before deriving frame culling and collecting draws, matching native Scene ordering; honor destruction during those callbacks.
- Clarify that the demo visibly retries Provider initialization failures; subsequent tile errors use native Provider events.

## Executed verification

- `node coordination/ci/m1-imagery-lifecycle.test.mjs`: 26 PASS, including the six unchanged RED regressions.
- `node coordination/ci/m1-scene-events.test.mjs`: 4 PASS, including actual renderer submission and native camera/frustum/provider invalidation.
- Targeted ESLint: PASS. Exact corrected source/test hashes and GREEN logs accompany the RED evidence.
- Read-only reviewer additionally verified two synchronous retries followed by success, and destruction between queued failure and microtask notification.

## Remaining acceptance

These corrections do not accept A05. A repeated real near-ground flight still exposes transient missing geometry; its assertions remain unchanged. Rebuild and rerun the complete final-head gates after that separate terrain correction and CI integration. No M2 or main merge is authorized.
