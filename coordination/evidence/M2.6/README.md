# M2.6 preliminary evidence — IN PROGRESS

This directory contains real headed-browser WebGPU captures and run diagnostics from the committed M2.6 implementation. The capture was built from commit e1dab082bbfdbd3cba1bb24b3d39132f02ed33ee with a clean source worktree. The report is tied to that exact implementation commit and bundle; later evidence-only commits do not alter the built source. It remains preliminary acceptance evidence, not final PR-head acceptance. Draft PR #18 currently targets main; Fast CI and Full regression have been triggered on the latest PR HEAD and their final results are pending.

## Environment

- Browser: Chromium 156.0.8078.4, headed.
- Cesium: 1.146.0.
- Adapter: Intel, architecture xe-lpg, non-fallback adapter. Device/driver identifiers were not exposed by requestAdapterInfo().
- Viewport: 1920×1080 for A07–A10 captures; resize assertion at 1280×720.
- Device features: core-features-and-limits only; timestamp-query is not supported by this WebGPU device. Limits reported: maxTextureDimension2D 8192, maxBufferSize 268435456 bytes.
- Tested source commit: e1dab082bbfdbd3cba1bb24b3d39132f02ed33ee.
- Base main commit: 1869091d0d4a95250e2c56f51cb574ab23598718.
- Bundle SHA-256: a098d91da5bd3ddfa63456be465b2234715cbff969a23ccfcb2beff5c3c2608d.
- Browser console errors: none recorded by the harness.

## Scenario run status

| Gate | Run result | Evidence | Visual/acceptance status |
| --- | --- | --- | --- |
| A07 orbital sunrise | Browser scenario executed | A07/orbital-sunrise.png | IN PROGRESS; Sun is visible over the limb, but full partial-limb occultation and terrain occlusion still need dedicated probes |
| A08 time progression | Morning/noon/evening/night scenarios executed; native solar direction samples differ | A08/*.png | IN PROGRESS; full continuous transition/temporal stability not certified |
| A09 altitude sweep | High orbit, low orbit and 2 m camera heights executed | A09/*.png | IN PROGRESS; horizon/air-perspective review and terrain depth coverage remain |
| A10 HDR solar | Bloom on/off, exposure 0.5/1/2 and five independent effect-off captures executed | A10/*.png | IN PROGRESS; clipping thresholds and physical occultation still need dedicated assertions |

The screenshots are actual browser canvas captures, not generated or composited images. A10 also contains without-rays.png, without-softHalo.png, without-wideHalo.png, without-corona.png and without-tint.png; the harness verifies each independently disabled control changes the canvas hash. Some camera compositions are diagnostic rather than polished presentation shots.

## Assets

Eight original SVG sources were converted to GPU payloads:

- Seven 512×512 R8 alpha masks: three Rays, two Halo, Corona and Noise.
- One 512×512 RGBA8 authored color ramp.
- Total payload: 2,883,584 bytes (2.75 MiB).
- The loader validates exact payload lengths and tracks GPU texture creation/destruction.
- The visual run loaded all eight assets successfully. One renderer teardown balanced 16/16 textures and 3/3 buffers because the resize test correctly destroyed and recreated three post-process textures.
- A separate headed-browser negative test returned HTTP 404 for the final color-ramp payload after seven masks had loaded. The loader destroyed all seven partial allocations, created eight neutral fallback textures, continued rendering, and balanced all 18/18 textures and 3/3 buffers at teardown. No browser errors were recorded.

The source SVGs, build script, loader and detailed semantics are documented in packages/engine/Source/Assets/Textures/WebGPU/Solar/README.md.

## Performance

The harness measures viewer.render() plus queue submission completion via GPUQueue.onSubmittedWorkDone(). This is a CPU-observed end-to-end timing, not a GPU timestamp query. Values varied significantly across runs and are not suitable for claiming GPU frame-time acceptance.

Latest preliminary run at 1920×1080, 30 samples:

- Bloom disabled: mean 7.55 ms, p50 7.40 ms, p95 8.90 ms.
- Bloom enabled: mean 9.77 ms, p50 10.00 ms, p95 11.00 ms.
- GPU frame time: UNVERIFIED.
- Initial renderer setup: approximately 1.79 s (includes browser startup/scene setup, not isolated asset fetch/decode time).

The apparent timing difference is within run-to-run noise and does not prove Bloom has zero GPU cost. A GPU timestamp query or controlled external profiler is still required.

## Independent effect isolation

The browser harness now disables each of the five solar artwork controls independently and captures the actual canvas: rays, soft halo, wide halo, corona and authored tint. It asserts that each disabled image hash differs from the all-enabled baseline. Bloom is separately compared enabled/disabled. These checks establish independent toggling and visible contribution in the captured diagnostic view; they do not replace visual review at other elevations or under partial Earth/terrain occultation.

## Lifecycle and resize

- 1920×1080 bloom targets: 480×270 per low-resolution texture.
- 1280×720 resize assertion: targets recreated at 320×180.
- Renderer teardown: 16 textures created / 16 destroyed; 3 buffers created / 3 destroyed.
- Asset bytes and bloom target bytes return to zero after destruction.
- Device Lost recovery, repeated create/destroy soak, and GPU memory plateau measurement: UNVERIFIED.

## Remaining mandatory work

1. Re-run all evidence after the first M2.6 commit and again on final PR HEAD; include commit SHA and built bundle SHA.
2. Add independent per-effect isolation (Rays, Soft Halo, Wide Halo, Corona, Atmospheric Glow, Bloom).
3. Add partial Earth-limb and real terrain occlusion tests for each screen-space contribution; verify fully hidden Sun leaves no detached glow.
4. Verify continuous time animation, camera movement, exposure changes, and absence of flicker.
5. Verify missing/corrupt texture fallback and resource disposal; Device Lost and repeated scene creation/destruction.
6. Review all screenshots, including clipping/black-space detail and the A07–A10 intended visual outcomes.
7. Measure GPU frame time and memory with a real GPU profiler/timestamp query. Current GPU performance is not accepted.
8. Wait for Fast CI and Full regression on PR #18 final HEAD, then run/record WebGL differential if not covered by those jobs. Current GitHub Actions runs are in progress; no final CI result is claimed.

No A07–A10 gate is marked ACCEPTED in this evidence checkpoint. Overall M2.6 remains IN PROGRESS.
