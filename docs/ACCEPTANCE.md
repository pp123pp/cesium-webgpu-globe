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
