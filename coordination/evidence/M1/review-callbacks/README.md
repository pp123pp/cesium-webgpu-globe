# M1 callback review regressions

**Status: intentional RED on review baseline `99185d2736b95e756837596a136665a2c2535b66`.** Production fixes are owned by root. This commit changes tests and evidence only, on isolated branch `test/m1-review-callbacks`.

## Actual results

| Command                                                      | Result                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `node coordination/ci/m1-imagery-lifecycle.test.mjs`         | **20 passed, 6 failed**, exit 1. All existing cases pass; all six new callback regressions reproduce the native destroyed-object exception. |
| `node coordination/ci/m1-scene-events.test.mjs`              | **0 passed, 4 failed**, exit 1. Two actual renderer exceptions and two stale camera-selection assertions.                                   |
| Targeted ESLint, explicit Prettier check, `git diff --check` | PASS.                                                                                                                                       |

Final runs are `imagery-red.txt` and `scene-red.txt`; whitespace-only log lines were normalized for repository diff checks. `source-hashes.json` identifies the exact test and production bytes, baseline commit, branch, and Node version. No browser run or GPU hardware claim is made by this CPU verification task.

## Imagery error callbacks

The six cases are named:

`{request|upload} error callback can {remove layer|replace terrain|destroy adapter} while a READY terrain tile advances native imagery`

They use native `EllipsoidTerrainProvider` data, a native parent/child tile tree and replacement queue, native `ImageryLayerCollection`, and the actual adapter `loadTile` entry point with terrain state READY. The provider either throws synchronously from `requestImage`, or resolves an image whose upload then throws. Its real `errorEvent` listener performs the selected owner mutation.

Every baseline failure is `DeveloperError: This object was destroyed, i.e., destroy() was called.` The native `TileImagery` association remains on the stack while the callback releases its imagery. The tests also require that released terrain data is never republished as renderable/DONE, each failure is reported once, bitmap/terrain ownership is released exactly once, and no pending requests or textures remain. Removing only the imagery layer must leave terrain usable on the next `loadTile` call.

## Scene event ordering

The four cases are named:

- `postUpdate can replace terrain before same-frame tile selection and drawing`
- `preRender can replace terrain before same-frame tile selection and drawing`
- `postUpdate camera.setView updates same-frame culling and selected draws`
- `preRender camera.setView updates same-frame culling and selected draws`

They run actual `WebGPUScene.render` / `_renderFrame`, the public terrain setter, native `Globe`, `Camera.setView`, frustum culling, quadtree invalidation and `beginFrame`, native provider resource lifetime, and actual `WebGPUGlobeRenderer._draw`. GPU uploads/pass operations and traversal of two prepared terrain regions are the only substituted boundaries; DOM input/GPU initialization is outside this CPU fixture. No test inspects source text or simply asserts callback ordering.

The prepared traversal consumes native invalidation and creates a fresh ready generation after a provider replacement. Thus a correctly timed event can pass without resubmitting a stale test tile. On the baseline, both replacement cases release a mesh after it is queued, and actual renderer drawing throws `Cannot read properties of undefined (reading 'center')`.

The camera cases first draw the southern region, then move the real Camera north in the event listener. The baseline still submits the southern region through the actual renderer. Expected drawing and culling must use the northern camera view in that same frame.

## Exact next step

Root should cherry-pick this test-only commit, integrate the owned `WebGPUImagery`, `WebGPUGlobeTileProvider`, and `WebGPUScene` fixes, then run both commands above unchanged and retain their GREEN logs. Add the new scene-events file to the focused CI gate. Existing retry, lifecycle, rendering and browser suites remain required integration coverage.

The intended production strategy is to notify synchronous imagery failures after native associations unwind, recheck released/destroyed terrain data after imagery callbacks, and run mutable scene callbacks before frame culling/traversal. This handoff does not claim those fixes have been verified yet.
