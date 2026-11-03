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
| A10 | M2    | HDR + solar glow                 | HDR Sun/highlights retain detail; restrained bloom, visible but subtle radial Sun Rays and atmospheric glow; no whole-image clipping or glow leaking through Earth/terrain occlusion |
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

## Verification scope and cadence

Follow the user's 2026-11-02 risk-based testing policy in [`AGENTS.md`](../AGENTS.md#risk-based-testing-and-verification). Ordinary subtasks use the smallest checks that cover the changed behavior and its effects. Documentation-only updates use content/diff checks and do not reopen completed milestone acceptance.

Keep the required numerical, functional and view-based checks for the active task. In particular, M2.1 verifies its math/depth foundation at high orbit, low orbit and ground; A07–A10 remain final M2 acceptance. M2.6's A10 includes the explicit supplemental solar-appearance requirement below; this is not satisfied by a bright Sun disk or the existing small analytic aureole alone. Full regression is required when the active milestone acceptance or CI gate specifies it, not after every individual edit or ordinary task handoff. Exact final-HEAD requirements cannot be satisfied with an older passing result.

Automatic workflow selection remains governed by [`CI.md`](CI.md#trigger-policy); this policy does not disable an automatically selected or required gate. Historical acceptance evidence and known-issue decisions below remain unchanged.

### M2.6 A10 supplemental solar-appearance requirement

A10 additionally requires a restrained, HDR-aware solar glow treatment that visibly improves the Sun's presentation beyond the existing disk and small analytic aureole:

- Add a controlled HDR bloom around the solar source, composed in linear HDR before the single ACES tone-map and final sRGB encode. Keep the highlight core and surrounding gradation legible; do not use exposure increase as a substitute for bloom.
- Add subtle, clearly visible radial Sun Rays around the Sun, comparable in character to the project's reference screenshots, but restrained enough to avoid an exaggerated starburst. Their placement must follow the actual scene-time Sun direction and camera projection, not a fixed screen coordinate.
- Preserve per-fragment Sun disk occultation and prevent bloom/rays from visibly bleeding through the Earth or real terrain. Respect atmospheric attenuation and the existing linear-HDR → ACES → sRGB pipeline.
- Verify day, low-Sun/orbital sunrise, twilight and night-adjacent views at more than one exposure. The glow must not wash out the whole image, erase the solar disk boundary, or create distracting temporal flicker when time/camera moves.
- Record screenshots and observations showing both the effect enabled and a disabled/baseline comparison. Pixel-identical matching to a reference is not required.

This is a bounded visual rendering requirement, not a claim that screen-space radial rays are a physically exact atmospheric phenomenon. Cinematic lens ghosts, dirt, anamorphic streaks and exaggerated flare remain out of scope.

## Visual acceptance policy

**Pixel-identical images are not required.** This applies to subsequent milestone acceptance as well as M1, following the user's explicit clarification on 2026-11-02. Assess correct rendering and normal use at comparable camera positions, provider data, viewport sizes and scene settings. WebGL and WebGPU may differ in rasterization, antialiasing, color rounding and transient provider/LOD timing without failing acceptance.

A visual difference is acceptable when the evidence shows that it does not materially affect the rendered scene or its use. Record the affected scene, environment, screenshot/log, observed difference and reason for acceptance. Preserve original failed comparisons. Software GPU results must be labeled as such.

The following remain required:

- Correct WGS84 coordinates, horizon, terrain coverage and imagery placement, with usable navigation from orbit to the ground.
- No significant terrain holes, visible tile seams, obvious coordinate jitter, serious depth errors, incorrect collision heights, unhandled provider failures or resource/lifecycle regressions.
- Actual browser runs and evidence for A03–A06. A visual exception cannot substitute for running terrain, imagery, navigation or lifecycle acceptance.
- For final milestone implementation acceptance, full non-WebGL and WebGL regression on the required final HEAD before merge, including the existing comparison against the pinned WebGL baseline. This final acceptance requirement does not mandate repeated full suites for ordinary subtasks or reopen acceptance for an isolated documentation update. Report inherited baseline failures separately; do not claim that every upstream test passed. An accepted visual difference does not automatically waive a newly failing functional test.

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
