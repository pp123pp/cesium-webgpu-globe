# Acceptance matrix

Evidence per scenario: build/test command + screenshot or short recorded view + concise manual observation + blockers. Record GPU/vendor, browser version and resolution if available. Never claim automated visual comparisons exist until implemented.

| ID  | Stage | Scenario                        | Passing criteria                                                         |
| --- | ----- | ------------------------------- | ------------------------------------------------------------------------ |
| A01 | M0    | official WebGL smoke            | official scene unaffected and initializes                                |
| A02 | M0    | WebGPU bootstrap                | canvas configured, color/depth draw works, no fatal validation error     |
| A03 | M1    | orbital WGS84 Earth             | correct ellipsoid and horizon, stable rotations                          |
| A04 | M1    | imagery                         | real imagery provider tiles loaded, positioned, LOD correct              |
| A05 | M1    | terrain                         | actual terrain provider, terrain+imagery aligned, stable tile transition |
| A06 | M1    | orbit-to-ground flight          | no obvious coordinate jitter or catastrophic depth artifacts             |
| A07 | M2    | orbital sunrise                 | Sun correctly occludes/appears at limb, physically plausible scattering  |
| A08 | M2    | twilight, noon, night           | smoothly varying sky and sunlight, believable night background           |
| A09 | M2    | horizon / aerial perspective    | terrain and atmosphere visually coherent at several altitudes            |
| A10 | M2    | HDR                             | Sun/highlights visible without inappropriate clipping in whole image     |
| A11 | M3    | orbital global clouds           | curved global coverage, meaningful shapes, no planar seam/edge           |
| A12 | M3    | cloud fly-through               | near-cloud detail and interior density, coherent with distance           |
| A13 | M3    | sunset/side lighting            | self-shadow and silver lining, no severe temporal ghosting               |
| A14 | M4    | moving terrestrial cloud shadow | position tracks Sun and cloud movement, follows terrain                  |
| A15 | M4    | sunlight/ambient dimming        | terrain darkens plausibly when Sun is obscured                           |
| A16 | M5    | camera stress sweep             | rapid pan/zoom/time progression no serious flicker/ghosting              |
| A17 | M5    | duration soak                   | no steadily growing GPU memory or crashes                                |
| A18 | M5    | WebGL regression                | tests/smoke of unchanged official path pass                              |
| A19 | M6    | city/BIM/photogrammetry         | common tile mesh content and necessary compression render correctly      |

## Gates

- **M1 is the first shipping-quality vertical slice.** A mapped sphere with a static texture does NOT pass M1.
- M2 must be stable before M3 lighting integration. M4 must NOT depend on M6.
- V1.0 = M0–M5 gates; **A19 is not a blocker for V1.0**.
- Performance is observational until test GPU/resolution agreed; capture baseline data and regression trends.

## Visual acceptance policy

**Pixel-identical images are not required.** This applies to subsequent milestone acceptance as well as M1, following the user's explicit clarification on 2026-11-02. Assess correct rendering and normal use at comparable camera positions, provider data, viewport sizes and scene settings. WebGL and WebGPU may differ in rasterization, antialiasing, color rounding and transient provider/LOD timing without failing acceptance.

A visual difference is acceptable when the evidence shows that it does not materially affect the rendered scene or its use. Record the affected scene, environment, screenshot/log, observed difference and reason for acceptance. Preserve original failed comparisons. Software GPU results must be labeled as such.

The following remain required:

- Correct WGS84 coordinates, horizon, terrain coverage and imagery placement, with usable navigation from orbit to the ground.
- No significant terrain holes, visible tile seams, obvious coordinate jitter, serious depth errors, incorrect collision heights, unhandled provider failures or resource/lifecycle regressions.
- Actual browser runs and evidence for A03–A06. A visual exception cannot substitute for running terrain, imagery, navigation or lifecycle acceptance.
- Full non-WebGL and WebGL regression on the final HEAD before merge, including the existing comparison against the pinned WebGL baseline. Report inherited baseline failures separately; do not claim that every upstream test passed. An accepted visual difference does not automatically waive a newly failing functional test.

Exact pixel checks may remain useful diagnostics. If one reports a harmless difference, qualify that specific comparison with evidence instead of requiring identical images. Future work must use this policy when deciding visual acceptance.

## M1-specific known navigation issue

On 2026-11-02 the user separately authorized the repeatedly unresolved rapid real-terrain descent issue to remain nonblocking for M1. `M1-NAV-001` is the fast space-to-near-ground collision/altitude problem documented in `coordination/evidence/M1/final-navigation-issue/`. It is a real navigation limitation, separate from the harmless image-difference policy above.

The scenario still executes and retains its evidence. A diagnosed occurrence is `KNOWN_UNRESOLVED`; the terrain suite reports `PASS_WITH_KNOWN_ISSUES`. Do not describe A06 as unconditionally passed or the defect as fixed. A03/A04, ordinary terrain LOD and stable coverage, drape controls, other navigation, cleanup and final HEAD full regression remain required. This authorization does not extend to other failures or future milestones.

## M1 source acceptance record — 2026-11-02

Published source `03233dae8b524d6b3f4498a48a2fd7e89fffa806` passed [Fast CI](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449080) and the actually executed [Full regression](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094). Final publication and merge still require successful checks on the latest PR head under `CI.md`.

| Gate | Verified result |
| --- | --- |
| A03 | PASS: native WGS84 Globe, horizon/rotations, native camera and reversed depth. |
| A04 | PASS: real Provider imagery, geographic/Mercator placement, LOD, layers and disposal. |
| A05 | PASS: actual quantized terrain, ordinary LOD/seams, 561/561 drape samples, 1 km offset negative control and balanced cleanup. |
| A06 ordinary navigation | PASS: ellipsoid orbit-to-ground flight, depth/precision, real input, resize and bounded GPU lifetimes. |
| A06 rapid real-terrain descent | KNOWN_UNRESOLVED: hosted run observed coarse-terrain collision leaving the camera above the requested height; specifically authorized nonblocking. Overall terrain report: PASS_WITH_KNOWN_ISSUES. |
| Full upstream regression | Non-WebGL 10,353 passed / 5,537 skipped. WebGL baseline and candidate each 3,811 passed / the same 11 failed / 12,068 skipped; no new regression. Inherited failures are not passes. |

The [acceptance handoff](../coordination/handoffs/M1-acceptance.md) and [evidence index](../coordination/evidence/M1/closeout/README.md) retain exact source identities, raw reports, screenshots, environment, local/hosted distinctions and limitations. All current GPU evidence is software SwiftShader. The user subsequently authorized merging to `main` after closeout; this changes integration permission only, not acceptance scope or M2 authorization.
