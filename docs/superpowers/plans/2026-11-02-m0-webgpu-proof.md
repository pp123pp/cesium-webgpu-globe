# M0.4 WebGPU proof implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the serialized integration. Independent agents may audit or review, but never edit Viewer concurrently.

**Goal:** Complete task M0.4 on the existing development branch, with a separately selected, testable WebGPU proof and unchanged default WebGL behavior.

**Architecture:** `new Viewer(container, { renderingBackend: "webgpu" })` selects an isolated proof before constructing CesiumWidget. The object remains a Viewer; a small WebGPU host owns canvas/layout/animation and a separate WebGPUContext owns device/pipeline/depth resources. Existing CesiumWidget, Scene, Context and Globe rendering stay on their original path.

**Tech stack:** Existing CesiumJS 1.146.0 npm workspaces, JavaScript, WGSL, Playwright Chromium, upstream Jasmine/Karma.

**Spec:** `tasks/M0.md` task 4; `docs/ACCEPTANCE.md` A01/A02; `coordination/handoffs/M0.3-source-pipeline-audit.md`.

## Global constraints

- WebGL remains the default; backend choice is immutable after construction.
- WebGPU supports SCENE3D only and exposes a deliberately narrow proof contract, not a Cesium Scene/Globe/Terrain/Imagery implementation.
- No general renderer abstraction, RenderGraph, M1 functionality, or direct push to main.
- One integration owner owns Viewer and STATUS. Read-only reviewers own no implementation files.
- Preserve upstream source notices and npm workspaces; no new runtime dependencies.
- Record real test counts, browser/device details, validation errors and limitations.

## Design decisions

The existing Scene and Globe create WebGL resources during construction; changing Context alone cannot isolate WebGPU. Returning a different object from the Viewer constructor would misrepresent its type. Therefore initialize a private `_webgpuProof` and return normally from the constructor, forwarding only the supported Viewer lifecycle/property surface.

Supported WebGPU surface: `container`, `canvas`, `renderingBackend`, `readyPromise`, `renderError`, `useDefaultRenderLoop`, `resolutionScale`, `useBrowserRecommendedResolution`, `resize`, `forceResize`, `render`, `destroy`, `isDestroyed`. Scene-dependent access must report that M0.4 has no Scene. Unsupported explicit creation features are rejected. Startup failures reject `readyPromise`; runtime failures emit `renderError`, retain the error, stop rendering, and never fall back to WebGL. Explicit destruction must safely cancel pending startup and dispose any device that arrives later.

The proof draws the nearer RGB triangle before a farther magenta triangle covering the same area, using `depth24plus`, depth writes and `less` comparison. A pixel check distinguishes correct depth from painter's order. Resize recreates the depth attachment; zero-size containers skip drawing, and dimensions are bounded by device limits.

## Review focus

- Destruction while adapter/device/pipeline acquisition is pending: no late resource leak or restarted animation.
- Missing WebGPU, null adapter, rejected device request and pipeline/validation errors: explicit failure with cleanup.
- Hidden/zero-size container, resizing and device-pixel scaling: matching depth/color extents and no invalid zero-size texture.
- Device loss or uncaptured validation error after startup: observable error and stopped render loop.
- Invalid backend or explicit unsupported scene features: rejected before creating a WebGL context or leaving DOM behind.

## Task 1: Restore trustworthy baseline verification

**Files:** `.github/workflows/m0-webgl-baseline.yml`, `coordination/ci/m0-chrome.cjs`; evidence later in the task handoff.

**Interfaces:** A Chrome wrapper launches the Playwright-installed Chromium with the headless CI flags; existing npm test commands receive `--failTaskOnError` so browser/test failures return nonzero.

- [x] Verify historical job 125088335375: WebGL smoke passed, Karma browser failed to start, and the gulp default suppressed the exit code.
- [x] Add the narrow CI browser wrapper and propagate failures in the workflow, including the M0.4 branch/PR trigger.
- [x] Build and run the original WebGL smoke plus upstream non-WebGL tests; retain actual results without relabeling failures as success.
- [x] Commit the validation fix separately.

## Task 2: Add and integrate the minimal WebGPU proof

**Files:** create `packages/engine/Source/Renderer/WebGPUContext.js`, `packages/engine/Source/Widget/WebGPUWidget.js`, `coordination/ci/m0-webgpu-smoke.mjs`; modify only `packages/widgets/Source/Viewer/Viewer.js` among shared rendering files. Add `Apps/WebGPUProof.html` as an offline demo.

**Interfaces:** WebGPUContext exposes async initialization, `render`, `resize`, `destroy`, and an error event. WebGPUWidget owns the DOM/render loop and forwards failures. Viewer forwards the narrow public surface documented above. Tests use the real built Viewer and real browser GPU, with API failure injection only for exceptional acquisition branches.

- [x] Write a browser assertion that a WebGPU Viewer acquires only a WebGPU context, has the same Viewer identity, exposes readiness, and draws depth-tested pixels. Run it against the baseline and observe the missing-selection failure.
- [x] Implement device/canvas initialization, one isolated WGSL pipeline and the lifecycle guards.
- [x] Test resize, hidden-to-visible layout, manual/default rendering, loss, validation error and destruction during startup; assert resource disposal and no WebGL fallback.
- [x] Rebuild and rerun the unchanged WebGL smoke, the new WebGPU smoke and upstream tests with failure propagation.
- [x] Commit the implementation and tests after review.

## Task 3: Review and hand off

**Files:** `coordination/STATUS.md`, `tasks/M0.md`, `coordination/handoffs/M0.4-webgpu-proof.md`; add correction notes to earlier baseline records whose unit-test claims were unsupported.

**Interfaces:** Final handoff uses `coordination/HANDOFF_TEMPLATE.md`; current status must distinguish implementation, local verification, remote CI and pending M0.5.

- [x] Review the diff, run lint/format checks for changed code, and obtain one independent whole-change review.
- [x] Fix material findings with reproducing tests, then run the affected required gates.
- [x] Record commands/results, browser/adapter, screenshots, commits, residual limitations and the next M0.5 action.
- [x] Commit synchronized docs; keep main unchanged and do not mark M0.5 complete.

## Execution result

M0.4 verified on commit `3798477` / CI run [41392263849](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849): 9 lifecycle tests, 17 WebGPU browser checks, 10,353 non-WebGL tests and original WebGL smoke passed. Headed Chromium + Xvfb produced inspected, correct proof/demo screenshots. See `coordination/handoffs/M0.4-webgpu-proof.md` for diagnostics, API, exact commands and remaining M0.5 hardware/visual gate.
