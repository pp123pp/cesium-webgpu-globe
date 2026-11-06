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
| A10 | M2    | HDR + solar glow                | HDR detail; subtle bloom/rays; no clipping or Earth/terrain leaks        |
| A11 | M3    | orbit to local clouds           | clear far orbit, smooth descent to geographically stable local clouds    |
| A12 | M3    | cloud fly-through               | near-cloud detail and interior density, coherent with distance           |
| A13 | M3    | sunset/side lighting            | self-shadow and silver lining, no severe temporal ghosting               |
| A14 | M4    | moving terrestrial cloud shadow | position tracks Sun and cloud movement, follows terrain                  |
| A15 | M4    | sunlight/ambient dimming        | terrain darkens plausibly when Sun is obscured                           |
| A16 | M5    | camera stress sweep             | rapid pan/zoom/time progression no serious flicker/ghosting              |
| A17 | M5    | duration soak                   | no steadily growing GPU memory or crashes                                |
| A18 | M5    | WebGL regression                | tests/smoke of unchanged official path pass                              |
| A19 | M7    | city/BIM/photogrammetry         | common tile mesh content and necessary compression render correctly      |

## Gates

- **M1 is the first shipping-quality vertical slice.** A mapped sphere with a static texture does NOT pass M1.
- M2 must be stable before M3 lighting integration. M4 must NOT depend on M7 (the former M6 model stage).
- V1.0 = M0闁炽儲褰? gates; **A19 is not a blocker for V1.0**.
- Performance is observational until test GPU/resolution agreed; capture baseline data and regression trends.

## M6 Global Ocean — separate extension gates

The next priority is [M6 Global Ocean](OCEAN_PLAN.md), route v2.0; the next task is [O0-R01](../tasks/M6/O0-R.md). Its **M6-A01–M6-A22** criteria are in [M6_ACCEPTANCE.md](M6_ACCEPTANCE.md); do not renumber A01–A18 or reuse the historical A19 model criterion for ocean work. A19 moves with 3D Tiles/BIM to M7. Existing evidence and V1.0 acceptance obligations remain unchanged.

M6-A01 retains original O0 document/data audit evidence for Natural Earth only; the O0-R replacement-source/fixture gate is NOT_RUN. A revised route or manifest does not pass that gate. All ocean runtime and rendering/performance criteria remain NOT_RUN. O3, O6 and O7 are separate visual/performance release gates; complete underwater is O7, last. Technical checks, owner visual acceptance and release/integration permissions are distinct. M5 open items remain open unless separately completed with applicable evidence. See [M6-STATUS](../coordination/M6-STATUS.md) for the active task and records.

## Verification scope and cadence

Follow the user's 2026-11-02 risk-based testing policy in [`AGENTS.md`](../AGENTS.md#risk-based-testing-and-verification). Ordinary subtasks use the smallest checks that cover the changed behavior and its effects. Documentation-only updates use content/diff checks and do not reopen completed milestone acceptance.

Keep the required numerical, functional and view-based checks for the active task. In particular, M2.1 verifies its math/depth foundation at high orbit, low orbit and ground; A07闁炽儲寮?0 remain final M2 acceptance. M2.6's A10 includes the explicit supplemental solar-appearance requirement below; this is not satisfied by a bright Sun disk or the existing small analytic aureole alone. Full regression is required when the active milestone acceptance or CI gate specifies it, not after every individual edit or ordinary task handoff. Exact final-HEAD requirements cannot be satisfied with an older passing result.

Automatic workflow selection remains governed by [`CI.md`](CI.md#trigger-policy); this policy does not disable an automatically selected or required gate. Historical acceptance evidence and known-issue decisions below remain unchanged.

### M2.6 A10 supplemental solar-appearance requirement

A10 additionally requires a restrained, HDR-aware solar glow treatment that visibly improves the Sun's presentation beyond the existing disk and small analytic aureole:

- Add a controlled HDR bloom around the solar source, composed in linear HDR before the single ACES tone-map and final sRGB encode. Keep the highlight core and surrounding gradation legible; do not use exposure increase as a substitute for bloom.
- Add subtle, clearly visible radial Sun Rays around the Sun, comparable in character to the project's reference screenshots, but restrained enough to avoid an exaggerated starburst. Their placement must follow the actual scene-time Sun direction and camera projection, not a fixed screen coordinate.
- Preserve per-fragment Sun disk occultation and prevent bloom/rays from visibly bleeding through the Earth or real terrain. Respect atmospheric attenuation and the existing linear-HDR 闁?ACES 闁?sRGB pipeline.
- Verify day, low-Sun/orbital sunrise, twilight and night-adjacent views at more than one exposure. The glow must not wash out the whole image, erase the solar disk boundary, or create distracting temporal flicker when time/camera moves.
- Record screenshots and observations showing both the effect enabled and a disabled/baseline comparison. Pixel-identical matching to a reference is not required.

This is a bounded visual rendering requirement, not a claim that screen-space radial rays are a physically exact atmospheric phenomenon. Cinematic lens ghosts, dirt, anamorphic streaks and exaggerated flare remain out of scope.

### M2.6 closeout evidence (2026-11-03)

A07–A10 local visual/functional acceptance passed on clean revision `cf2c1d1`;
see [closeout reports and observations](../coordination/evidence/M2.6/closeout/README.md).
This supersedes the preliminary checkpoint below. Evidence covers partial and
fully hidden Sun, real mesh depth, same-state effect comparisons, ground/orbital
views, continuous sunset, loss/recreation and 404/corrupt-payload handling.
A08 uses the same-bundle ground day/terminator/night and fixed-camera 12-hour
change plus continuous solar/space views; UTC orbital filenames alone do not
establish local daytime. Final publication Fast/Full and WebGL differential
remain separately recorded in the closeout regression record and PR #18.

The adapter supports timestamp queries when explicitly enabled by the benchmark.
GPU render-pass timings are now measured; resident VRAM and multi-device
performance remain unverified. The performance-observational policy above is
unchanged. NaturalEarth detail/seams and high-exposure low-Sun contrast remain
explicit limitations, not silently fixed by this acceptance.

### M2.6.1 — Solar Visual Polish

M2.6.1 is a separate visual-polish gate after the merged M2.6 implementation. It does not reopen or replace the accepted M2.6 A07–A10 results. The full task contract is in [tasks/M2.6.1.md](../tasks/M2.6.1.md).

The required review covers the solar disk highlight roll-off and edge readability; less regular radial rays without aliasing or temporal shimmer; multi-scale halo and restrained irregular corona; linear-HDR Bloom while preserving disk boundary, black-space contrast and Earth / terrain occlusion; coherent appearance from high orbit through ground views; exposure 0.5 / 1.0 / 2.0; 1920×1080 and 1280×720 (or equivalent); visible, partial and fully hidden Sun; same-state baseline and per-effect isolation captures; at least 120 frames of camera / time progression; and same-adapter GPU timestamp mean / p95 with stable native resource counts.

Acceptance IDs SVP-01–SVP-10 and the evidence package are defined in the task file. Pixel-identical reference matching is not required. Cinematic Lens Ghosts, Lens Dirt, Anamorphic Streaks and exaggerated Lens Flare remain out of scope and require a separate future task.

This task is visual refinement only. Preserve the M2.6 physical Sun, WGS84 / terrain depth and occultation, atmospheric transport, linear-HDR → ACES → sRGB pipeline, asset fallback and lifecycle behavior. This planning entry does not authorize runtime implementation.

### M2.6 implementation checkpoint 闁?not accepted

A preliminary headed Chromium 156.0.8078.4 run on an Intel Xe-LPG non-fallback adapter produced actual WebGPU scenario screenshots for A07闁炽儲寮?0 at 1920閼?080. The script also tested 1280閼?20 target recreation, exposure 0.5/1/2, enabled/disabled Bloom and one renderer teardown. These are implementation checks, not final PASS decisions for the acceptance matrix. Partial Earth/terrain occultation, animation stability, independent per-effect visual isolation, device-loss recovery, repeated create/destroy soak, final-head Fast/Full, and WebGL differential remain outstanding.

The first 30-sample wall-clock render-plus-queue-completion measurements varied materially between runs (including approximately 11闁?8 ms means); they are not GPU timestamp measurements. Record GPU frame time as UNVERIFIED and do not claim a performance pass. See `coordination/evidence/M2.6/README.md` for the exact run identity and outstanding acceptance matrix.

## Visual acceptance policy

**Pixel-identical images are not required.** This applies to subsequent milestone acceptance as well as M1, following the user's explicit clarification on 2026-11-02. Assess correct rendering and normal use at comparable camera positions, provider data, viewport sizes and scene settings. WebGL and WebGPU may differ in rasterization, antialiasing, color rounding and transient provider/LOD timing without failing acceptance.

A visual difference is acceptable when the evidence shows that it does not materially affect the rendered scene or its use. Record the affected scene, environment, screenshot/log, observed difference and reason for acceptance. Preserve original failed comparisons. Software GPU results must be labeled as such.

The following remain required:

- Correct WGS84 coordinates, horizon, terrain coverage and imagery placement, with usable navigation from orbit to the ground.
- No significant terrain holes, visible tile seams, obvious coordinate jitter, serious depth errors, incorrect collision heights, unhandled provider failures or resource/lifecycle regressions.
- Actual browser runs and evidence for A03闁炽儲寮?6. A visual exception cannot substitute for running terrain, imagery, navigation or lifecycle acceptance.
- For final milestone implementation acceptance, full non-WebGL and WebGL regression on the required final HEAD before merge, including the existing comparison against the pinned WebGL baseline. This final acceptance requirement does not mandate repeated full suites for ordinary subtasks or reopen acceptance for an isolated documentation update. Report inherited baseline failures separately; do not claim that every upstream test passed. An accepted visual difference does not automatically waive a newly failing functional test.

Exact pixel checks may remain useful diagnostics. If one reports a harmless difference, qualify that specific comparison with evidence instead of requiring identical images. Future work must use this policy when deciding visual acceptance.

## M1-specific known navigation issue

On 2026-11-02 the user separately authorized the repeatedly unresolved rapid real-terrain descent issue to remain nonblocking for M1. `M1-NAV-001` is the fast space-to-near-ground collision/altitude problem documented in `coordination/evidence/M1/final-navigation-issue/`. It is a real navigation limitation, separate from the harmless image-difference policy above.

The scenario still executes and retains its evidence. A diagnosed occurrence is `KNOWN_UNRESOLVED`; the terrain suite reports `PASS_WITH_KNOWN_ISSUES`. Do not describe A06 as unconditionally passed or the defect as fixed. A03/A04, ordinary terrain LOD and stable coverage, drape controls, other navigation, cleanup and final HEAD full regression remain required. This authorization does not extend to other failures or future milestones.

## M1 source acceptance record 闁?2026-11-02

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
