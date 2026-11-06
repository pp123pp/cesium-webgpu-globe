# Single source of truth — status

Last updated: 2026-11-06
Current development priority: **M6 Global Ocean, route v2.0 — next task [O0-R01](../tasks/M6/O0-R.md).** Start with [AGENTS](../AGENTS.md), [ocean status](M6-STATUS.md) and the selected task; read this historical log only when needed. The [route](../docs/OCEAN_PLAN.md) adopts detailed OSM coastlines and sparse coverage levels. [Original O0 evidence](evidence/M6/O0/README.md) retains its Natural Earth document/data TECHNICAL_PASS; the new source is not acquired/accepted, masks are not generated, runtime is NOT_STARTED and rendering/performance acceptance is NOT_RUN. O1-01 CPU time/geography may run independently when assigned; O1-02 waits for O0-R. This documentation update uses `e91ae8c` as its repository baseline and does not change engine runtime. The former M6 3D Tiles/BIM stage is [M7](../tasks/M7.md); full underwater remains last, O7.

**M5 checkpoint and open debt:** M5 tasks 1 and 2 are complete on local branches. The [eight reference scenes](evidence/M5/reference-scenes/README.md) were used for [altitude and time continuity](evidence/M5/continuity/README.md). Two local transitions in the star field and sunset cloud lighting were fixed and verified on Intel Xe-LPG. The next unfinished M5 task covers motion stability and resource lifetime. Profiling and final regression remain pending. M4 A14/A15 are accepted on local `main`. O0 records the actual checked-out source and integration status; only M5 defects directly blocking the active ocean task are prerequisites. Other M5 obligations remain tracked and V1.0 is not declared complete.

**Reading historical records:** the priority decision above supersedes older future-work routing only. Older “M6 3D Tiles/BIM” references below mean today's M7; capture-time status, approvals and evidence stay historical. This update does not grant push/merge/manual-Full authorization or turn old GPU evidence into a new test run.

M3 is complete. The user visually accepted all [five cloud enhancements](../tasks/M3.md#planned-visual-enhancements) on 2026-11-05, including [cloud evolution and morning light shafts](evidence/M3/evolution-and-mist/README.md), and authorized merging the changes to main.

The user accepted the local volumetric cloud baseline on 2026-11-05, including the revised clear-far-orbit requirement, cloud crowns, interior lighting and reduced flight striations, and authorized delivery to `main`. The accepted Intel Xe-LPG bundle starts with `68649e4b`. [Matched images, physical GPU checks and limitations](evidence/M3/cloud-appearance/README.md).

Repository: official CesiumJS 1.146.0 monorepo at root + Codex planning documents.
Upstream official tag: `1.146` (annotated tag object unsigned)
Upstream commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
Import method: GitHub Actions `.github/workflows/import-cesium.yml`
Import workflow result: SUCCESS; source presence verified.

## M4 implementation and acceptance status — 2026-11-06

- Main integrates the ellipsoid, terrain, direct/ambient lighting and timeline work through `1518222`. The tested local shader revision is `89cb9a1`, bundle `fd1fabca`. The earlier [ellipsoid](evidence/M4/ellipsoid-cloud-shadows/README.md) and [terrain](evidence/M4/terrain-cloud-shadows/README.md) captures keep their original source provenance.
- The finite-disk, wind, solar motion, 19 altitude/return captures, three reference WebGL views and full pinned-baseline WebGL differential passed on one physical Intel adapter. Of 3,822 specs executed on each side, three failed on the baseline and one on the candidate, with zero new failures. [Results and limitations](evidence/M4/final-acceptance/README.md).
- The user accepted both A14 and A15 on 2026-11-06. Local `main` fast-forwarded from `d2833a1` to `c54bb81`, integrating the renderer, updated demo and index, and acceptance evidence. M4 frame cost and multi-adapter behavior are unmeasured. The updated Golden Gate example exposes the height and solar-radius comparisons.

## M2.8 A/B acceptance and authorized closeout — 2026-11-05

- User explicitly confirmed visual acceptance and authorized pushing the latest changes, updating [PR #31](https://github.com/pp123pp/cesium-webgpu-globe/pull/31), waiting for latest-head CI and merging to main. The user additionally requested including the existing `package.json` `demo:webgpu` command. [Acceptance record](evidence/M2.8/ACCEPTANCE.md) identifies the accepted runtime and evidence reuse. Runtime/Demo remain unchanged; no new rendering, broad local suite or manual Full is required for this documentation/npm-script closeout. No C/M2.7/M3 work is authorized.
- The implementation history below preserves capture-time pending-acceptance states and historical measurements. The acceptance record above supersedes those earlier review states; it does not turn historical checks into new final-HEAD runs.

## M2.8 A/B implementation history — 2026-11-05

- Latest follow-ups: user requested a diffusion-size parameter, then explicitly chose proportional outer-halo scaling. `lensFlare.diffusionSize` defaults to 0.7 within [0.1, 2], with a live Demo slider/readout. Warm shoulder/spread and spectral arc scale together; core/short rays and reflection glints retain independent sizes. Existing final-display uniform padding carries the value without a new GPU allocation. [Parameter and linked-halo evidence](evidence/M2.8/diffusion-size/README.md) checks actual production output and real Demo input. Default 26 PNGs match the intermediate compaction exactly; size 0.3/0.7 arc radii are about 194/451 px. A real-output RED at size 0.1 exposed shared warm support clipping short rays; the fix leaves warm support on warm terms only. Sixteen focused tests, engine TypeScript and scoped lint/format pass. The full scoped static/motion/WebGL evidence below belongs to the default-equivalent intermediate runtime, not a fresh complete final-runtime matrix. No Full or new timing claim; visual acceptance remains pending.
- Latest correction: user approved keeping the cinematic style while reducing lens-core diameter to about 60% and warm diffusion to about 70%. [Fresh before/after evidence](evidence/M2.8/compaction/README.md) measures core 61.50%/61.56%, short-ray footprint 65.85%/66.25%, warm shoulder 70.20%/69.90% and spread 69.92%/69.92% at 1000x227/1920x1080. All 12 reference disabled frames and the isolated arc/reflection frame match exactly. Physical Intel Xe-LPG reference/exposure/resize/real-mesh/occultation checks and two consecutive 120-frame sequences pass; physical WebGL three-fixture smoke, 11 focused tests, scoped lint/format and the candidate build pass. No Full dispatch, new timing or broader terrain qualification. Source/hash provenance and the expected baseline RED failure are retained; old evidence remains historical. The unchanged spectral arc is more apparent against the smaller warm veil. User visual acceptance is pending.
- The following reference-directed revision is superseded only in its core/diffusion footprint; its original evidence and performance measurements are retained.
- Previous reference-directed correction: user requested matching the displayed reference without restraint. Runtime `cf0ec5d`, expanded verification `022c65a`: bright irregular core, wide warm diffusion, soft spectral arc and overlapping reflections; existing R8 masks reused, no additional resource allocations. [Original revision evidence](evidence/M2.8/revision/README.md) has 376 native PNGs, two 120-frame sequences, 42 exact disabled baseline matches and an independent integrity audit. Final GPU mean increments +0.245/+0.266/+0.230 ms and p95 +0.393/+0.328/+0.459 ms at 1080/720/1080, 600 samples per mode/resolution. Prior visual defects and failed timing attempts are retained. Lifecycle, focused tests, build/lint/types and physical WebGL smoke pass. These checks and timings describe that historical runtime, not the compact revision above.
- The following bullets describe the historical first treatment, not the current visual conclusion or performance measurement.
- User explicitly authorized A followed directly by B, development-branch commit/push and PR, then stop for visual acceptance. This supersedes the historical no-new-engine-work closeout instructions below only within M2.8 A/B.
- A plan `7f1c24b`; runtime `85017f0`; lifecycle fixture `ada51d5`. Default-off original output, independent optical controls, one 1x1 GPU source record and existing linear-HDR final composition. No M2.6.1 physical Sun/atmosphere or WebGL runtime changes.
- [Evidence index](evidence/M2.8/README.md): original physical Intel Xe-LPG/Chrome captures, 98 stills +120 contiguous frames, 42 independent main-baseline exact disabled pairs, functional occultation/resize, timestamp/lifecycle records and retained failed attempts. Focused tests/build/lint/types and physical WebGL smoke pass. Final GPU mean increment +0.127/+0.166/+0.181 ms for 1080/720/1080; no resident-VRAM claim.
- [Handoff](handoffs/M2.8-AB-lens-flare.md). User visual acceptance remains pending; screenshot review is not a declaration of HDRP parity. Hosted job status belongs to the PR, distinct from physical rendering evidence.

## M2.6.1 final complete WebGL differential — 2026-11-05

- After explicit user authorization, executed the original complete differential `coordination/ci/m0-webgl-regression.mjs` on real Intel Arc 130T / D3D11 WebGL, headed by Chrome Headless 156.0.8078.80. Baseline `724b5db8f258d0ce00c4f6b774bd38529e24252b`, final merged `main` candidate `b5422e5c9885cfba06efb26ada7d7b5cf6ced22c`; source-clean worktrees. Candidate/baseline bundle SHA-256 and exact run hashes are in [the final WebGL evidence archive](evidence/M2.6.1/final-webgl/README.md).
- **PASS: original comparator exit code 0**, status `no-new-failures`. Both sides executed 3,822 matching tests, passed 3,819, retained the same 3 failed specs/signatures and skipped 12,068; **0 new failures**, **0 changed signatures**, **0 tolerated drift**. Raw Karma exits were 1 because inherited failures were intentionally retained; do not misreport those tests as fixed.
- Two earlier complete attempts remain archived. The first failed a Windows `0.0.0.0:9876` bind (Karma shifted to 9880); a local-only loopback binding fixed the environment without changing an assertion. The second failed due to alternating 10-second Cesium3DTileset timeouts; both affected specs passed 2/2 on each revision in focused hardware reruns before the successful full differential. Do not erase either failed attempt.
- M2.6.1 B1–B5 and SVP-01–SVP-10 have prior user-accepted evidence; the independent final WebGL gate is now also satisfied on the final runtime. All acceptance and tests were performed without production runtime/shader changes, SwiftShader, weakened assertions or mandatory Full redispatch. This documentation/evidence publication is on a separate branch until reviewed and merged; do not start M2.7/M2.8/M3 in this scope.

## Historical M2.6.1 pre-differential reconciliation — 2026-11-05 (superseded by final PASS above)

- PR [#28](https://github.com/pp123pp/cesium-webgpu-globe/pull/28) merged tested head `96820edb62a7c27ef679914d3a2ef257239cbdb1` as main `1462876b3f6428e3fe5da5a054d01bcc6767d66b`. Its [Fast CI 41846319742](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319742) and [actually executed Full 41846319604](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319604) both PASS. Both hosted tiers are non-rendering; the Full job itself completed successfully.
- B1–B4 and B5-A/B5-B/B5-C have user-confirmed phase acceptance. [Integrated SVP-01–SVP-10 evidence and limitations](evidence/M2.6.1/README.md) link the exact physical-GPU capture and performance reports. No new capture or runtime change occurred in this documentation reconciliation.
- B5-C's accepted observation remains a **+10.24% mean / +24.77% p95** GPU-timestamp increase over its pooled M2.6 baseline, not a no-regression claim. Lifecycle allocations are balanced; resident VRAM remains unverified.
- From M2.6 reference `cf2c1d1` to merged M2.6.1, all 21 changed engine/widgets Source paths include `WebGPU`; zero changed paths outside that namespace in those trees. At this earlier reconciliation, **the complete upstream WebGL differential had NOT RUN**; the subsequent authorized hardware differential has now PASSED on `b5422e5`, as documented in the final gate section above. Source auditing and non-rendering CI were never treated as substitutes.
- Existing accepted A02 thin-limb and A05 haze limitations, single-adapter verification, bounded terrain fixtures and `M1-NAV-001` remain disclosed. No M2.7/M2.8/M3 work is authorized in this closeout.

## B5-B/B5-C acceptance and delivery — 2026-11-04

- User confirmed B5-B visual acceptance and B5-C acceptance, then authorized commit, push and merge to main. This supersedes the earlier no-push instruction for this delivery.
- [B5-B evidence](evidence/M2.6.1/B5-B/README.md): 288 original physical-GPU PNGs; 120-frame camera/time and 120-frame Earth-limb sequences; resize and native-mesh occlusion; independent integrity and visual review passed. User confirmation is recorded separately from immutable capture-time reports.
- [B5-C evidence](evidence/M2.6.1/B5-C/README.md): same Intel Xe-LPG / Chrome A–B–A comparison to rebuilt M2.6 `cf2c1d1`; 810 timestamp samples and three lifecycle cycles. Mean/p95 increased 10.24%/24.77% against pooled baseline; this disclosed observation is accepted, not called performance neutrality. All 312 lifecycle buffers/textures were destroyed once, with no retained growth.
- Tested candidate runtime is `8e7c53c09f3b0e2ae6b38ab4593d818282b979a4`, bundle `410f39366223a6a611e2072945c39d682507b2b152e2105a964325887cab9980`. This delivery adds harnesses/evidence and acceptance records only; there is no runtime implementation change. New publication CI does not constitute fresh rendering or complete WebGL differential evidence.
- Final PR checks and merge identity are recorded by GitHub. This record authorizes delivery; it does not predeclare the merge successful or waive remaining milestone-level gates.

## B5-A acceptance and integration — 2026-11-04

- User explicitly confirmed visual acceptance and authorized merging to main. A02's thin limb and A05's haze remain accepted limitations, not claimed eliminated.
- [PR #27](https://github.com/pp123pp/cesium-webgpu-globe/pull/27) merged tested head `dd641663698c08894f9ef5b15b876ceebb5f5479` as `0cf85063a4c63251b71be95375da03ba6354f869`. Engine runtime is unchanged from `9a3a1f2`; clean `885e6a3` hardware recapture verified all 70 image hashes match the third-round evidence.
- Final-head [Fast 41826987786](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41826987786) and executed [Full 41826987870](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41826987870) PASS. Both hosted tiers are non-rendering under the user's latest instruction; they do not certify a complete WebGL differential.
- Local rendering verification now uses a bounded 640×360 native ellipsoid fixture (maximum level 8) for the B5 lighting/depth/color checks, preserving all 10 original assertions. Hardware positive checks passed; disabling actual surface lighting made both twilight/night brightness checks fail. All subsequent rendering verification uses the local physical GPU, never SwiftShader. Browser configuration defaults to hardware and requires a physical adapter. Hosted Fast no longer runs software rendering; local functional fixtures and milestone visual matrices follow `docs/CI.md` and `AGENTS.md`.
- [Visual evidence](evidence/M2.6.1/B5-A-R/round3/README.md) and [CI diagnosis](evidence/M2.6.1/B5-A-R/ci-followup/settle-fix.json) retain exact sources, the failed hosted attempts, the local software-adapter limitation and scoped hardware validation. No new rendering implementation, B5-B/B5-C acceptance, resident-VRAM measurement or complete WebGL differential is claimed.

## Current integration state

- PR [#21](https://github.com/pp123pp/cesium-webgpu-globe/pull/21) merged accepted B1 as `eeaca1ddc3ef960ad23cd4aae9757b31ea98063a`; PR [#22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22) merged accepted B2 as `76faa2be8e0b0b9e4b49a74ba600d0d4eb775aba`.
- PR [#23](https://github.com/pp123pp/cesium-webgpu-globe/pull/23) merged visually accepted B3 / B06 HDR Bloom Refinement into main at `9dfc6d6539e5ebb17e38c5761e0f07c77d762e54`. The hardware-tested runtime is `4fde49bc63eb67c34816a424895d035b24efc2ea`; publication head `57e02703cec723d0fe7c12dd10f5d72c1f263055` passed Fast [41763228341](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41763228341) and executed Full [41763228306](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41763228306). B3 evidence and acceptance are recorded in `coordination/evidence/M2.6.1/B3/`.

- PR [#14](https://github.com/pp123pp/cesium-webgpu-globe/pull/14) integrates M2.5 from `feat/m2.5-hdr-tonemapping` into `main`; its base at acceptance was `8693c44d721fa327c9765ffa74a8b21e8d09912d`. Runtime acceptance source is `e22d4361ccdf3310e12431a740a4f8606a567722`. GitHub records the final check results and merge SHA; older main SHAs below are historical.
- PR [#8](https://github.com/pp123pp/cesium-webgpu-globe/pull/8) merged M2.1–M2.3. Its final-head Fast [41560846959](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41560846959) and executed Full [41560846966](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41560846966) succeeded.
- PR [#9](https://github.com/pp123pp/cesium-webgpu-globe/pull/9) merged M2.4 at merge commit `1fe802d0ca45ac98c4822338e41e487390219a89`. Its final development head was `e76bc3866289b3f93f80546eeb14dd7f5b32f9e0`; Fast [41581646293](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41581646293) and actually executed Full [41581646232](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41581646232) both succeeded on that exact head.
- PR [#10](https://github.com/pp123pp/cesium-webgpu-globe/pull/10) merged the public Moon / Stars / moonlight demo controls at `d52bdb43ce8c76f9e7f3b32c247200c974d6d9cb`. Its final head `482ce2b438c64070c996426276074ee91c5c415a` passed Fast [41585321728](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41585321728) and Full [41585321714](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41585321714).
- PR [#11](https://github.com/pp123pp/cesium-webgpu-globe/pull/11) merged native Cesium Timeline integration, configured default ion token usage and Pages stylesheet-path handling. Its head `b46f97ab29e8486bcd3715efc348b033d7734bf7` passed Fast [41588524382](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41588524382) and Full [41588524350](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41588524350). The main push Pages workflow [41588552188](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41588552188) and Pages deployment [41588680662](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41588680662) succeeded.
- PR [#6](https://github.com/pp123pp/cesium-webgpu-globe/pull/6) remains open at `6788fbd174a1104688be34abbb40c8f9d305da7a`, with an obsolete base SHA from before the current M2 integration. It is a historical M1 regression-closeout proposal, not an active M2 dependency. Do not merge or close it without separately reviewing whether its changes are already superseded.
- PR [#18](https://github.com/pp123pp/cesium-webgpu-globe/pull/18) merged M2.6 into `main` at `cf4f56cebd7ee37f761bb6668770d78c5081533e`. Final publication Fast [41625999356](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41625999356), executed Full [41625999341](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41625999341), and the separate WebGL differential passed with no new failures. M2.6 is accepted and merged. The requirements-only M2.6.1 checkpoint and B1/B2 integration records are historical; the current B3 handoff is below.

## Accepted milestones

- **M0 — WebGPU foundation:** accepted and merged.
- **M1 — WGS84 Globe, imagery and terrain:** accepted and merged. The previously authorized `M1-NAV-001` rapid near-ground descent limitation remains **KNOWN_UNRESOLVED**; it is not claimed fixed.
- **M2.1 — shared coordinates, units, solar direction, ray intersections and depth:** accepted and merged.
- **M2.2 — physical-inspired Rayleigh / Mie atmosphere, transmittance and aerial perspective:** accepted and merged.
- **M2.3 — Sun disk, occultation, irradiance, atmospheric attenuation and bounded glare:** accepted and merged.
- **M2.4 — inertial stars, lunar ephemeris / phases, lunar occultation and bounded moonlight:** accepted and merged. The Moon / Stars controls and native Timeline demo follow-ups are also merged.

M2.4's implementation and browser smoke passed Fast on its final development head, and its Full workflow actually executed and passed on that same SHA. The M2.4 Fast evidence includes the production-browser space smoke. Full is now a build / lint / type / focused-unit / complete upstream non-WebGL test tier; it no longer runs rendering acceptance or the complete WebGL differential. A passing Full must not be described as proof of those removed rendering gates. Fast retains software-GPU browser rendering checks. M2.5 now adds the scoped Intel Xe-LPG evidence below; performance remains unverified.

The following known limitations remain recorded and are not silently waived by M2.4 completion:

- `M1-NAV-001`: the specifically authorized rapid real-terrain descent / collision-height limitation.
- The separate transient terrain-gap observation recorded during M2.3 remains unresolved; the final M2.3 run did not reproduce it and no runtime fix is claimed.
- Hosted rendering uses Chromium 156 and Google SwiftShader. M2.5 adds one Intel Xe-LPG device for focused HDR/space/M0 checks; this does not certify other devices or performance.

## M2.5 HDR, exposure and tone mapping — focused acceptance passed

- Implemented linear `rgba16float` surface/sky composition, manual exposure (default 1, range 0.01–16), fitted ACES and one final sRGB encode. No automatic exposure, general PBR or future cloud work.
- [Acceptance evidence](evidence/M2.5/README.md) contains 20 actual 800×450 hardware captures, source/bundle identity, pixel metrics, a reproducible script and explicit limitations. Headed Chromium `156.0.8078.4`, Intel Xe-LPG non-fallback adapter.
- Day/terminator/night views at exposure 0.5/1/2 preserve black space and have no channel at the 254 clipping threshold. Lower exposure retains more highlight contrast; higher exposure reveals more night-side surface detail. Five fixed-camera sunset samples progress from daylight through orange twilight to stars.
- Default-exposure Sun remains distinguishable without whole-image clipping. Exposure 2 produces a bounded white orbital disk and washed-out yellow low-Sun sky (19.67% any-channel clipping, no all-white pixels). This is a recorded high-exposure tradeoff, not a claim that every exposure improves quality.
- Acceptance found and fixed custom background RGB bypassing sRGB decoding: actual equal gray terrain/background differed 154 vs 206 before the fix and match at 154 afterward. Commit `e22d436` preserves the direct M0 clear, alpha and input Color. A real-browser regression and focused context test cover the defect.
- Local build, targeted lint, commit-hook types, focused lifecycle tests, hardware M2 space smoke and 17 M0 proof checks passed. The 20-frame capture has no browser errors and clean source identity. Original source `c11494b` passed Fast [41596565861](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41596565861) and executed Full [41596565848](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41596565848); those historical runs do not certify the later fix. Final PR CI must pass before the authorized merge.
- NaturalEarth coarse imagery/seam, live terrain/navigation limitations and high-exposure calibration remain explicit. This is M2.5 acceptance only; M2.6 A07–A10, continuous-animation quality and complete WebGL differential are not claimed complete.

## M2.6 closeout — 2026-11-03 (accepted and merged)

- Runtime/harness revision: `cf2c1d1bc4f368a02d126bab203ee32da5d4064c`, clean for all seven hardware browser suites. [Closeout evidence](evidence/M2.6/closeout/README.md) records the bundle, actual screenshots, raw reports and limitations. Earlier preliminary records below are historical.
- Fixed post-blur Earth/terrain leakage, small-highlight loss during downsampling, pending-load destruction and failed-upload cleanup. Solar defaults now match the accepted visible rays/halo configuration. No WebGL implementation was changed.
- A07–A10 local acceptance passed: partial/hidden Sun and actual mesh occlusion, coherent ground/orbital views, fixed-camera ground day/terminator/night, 120-frame moving-time/camera sunset, independent effect controls and exposure comparisons. UTC orbital filenames are not local-daytime assertions.
- Build, targeted lint, commit-hook types and 7 focused unit tests passed. Production-WGSL Bloom, solar occlusion, Sun, atmosphere, visual/lifecycle, 404 and corrupt-payload browser suites passed on Intel Xe-LPG / Chromium 156. The main scene released 6,896/6,896 native buffers/textures; loss stops drawing and three explicit recreations succeed.
- Corrected capability diagnosis: the adapter supports timestamp queries; the old device had not requested them. Benchmark-only GPU timestamps measure all-enabled render-pass sum mean 16.80 ms at 1920 x 1080, with approximately 0.27 ms Bloom increment. Performance remains observational; this is not a pre-M2.6 comparison or a resident-VRAM measurement.
- Final publication Fast [41625999356](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41625999356) and executed Full [41625999341](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41625999341) passed on publication HEAD `3bcaac3`. The separate WebGL differential passed on runtime `cf2c1d1`: baseline/candidate each 3,811 pass, the same 11 inherited failures and 12,068 skipped, with no new failures or changed signatures. Raw suites retain exit 1; the comparison runner passes.
- PR #18 merged as `cf4f56cebd7ee37f761bb6668770d78c5081533e`. M2.6 A07–A10 is accepted and integrated into `main`. Existing `M1-NAV-001`, NaturalEarth detail/seams, exposure-2 low-Sun contrast, resident VRAM and multi-device / long-duration coverage limitations remain.

## Completed handoff — B3 HDR Bloom, 2026-11-04

**B3 / B06 HDR Bloom Refinement: implementation, scoped hardware verification and user visual acceptance PASS; PR #23 merged.**

- PR #23 merged at `9dfc6d6539e5ebb17e38c5761e0f07c77d762e54`. Publication head: `57e02703cec723d0fe7c12dd10f5d72c1f263055`; hardware-tested runtime/harness: `4fde49bc63eb67c34816a424895d035b24efc2ea`. These identities are distinct; publication adds evidence/docs and does not claim a fresh hardware execution.
- [Evidence index](evidence/M2.6.1/B3/README.md), [structured result](evidence/M2.6.1/B3/result.json), and [handoff](handoffs/M2.6.1-B3-hdr-bloom.md) preserve captures, hashes, tests, performance/resource measurements and limitations. Fast [41763228341](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41763228341) and executed non-rendering Full [41763228306](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41763228306) passed on the exact publication head.
- User visual acceptance: **PASS** (2026-11-04). Inner Bloom is tighter and more continuous; the solar core and outer Rays/Corona remain legible; black-space contrast and Earth/terrain occultation are preserved. GPU pass-sum mean changed from 2.232593 ms to 2.317790 ms (+0.085197 ms, about 3.8%); p95 remained 2.490368 ms. Known limits remain: one physical adapter, controlled/local providers, capture-paced motion sequence, no resident-VRAM measurement, no new complete WebGL differential, and aggregate motion metrics are not a localized flicker guarantee.
- B3 is closed. B4 / B05, B5 / B07, M2.7/M2.8 and M3 remain outside current authorization.

## Historical B2 user acceptance and integration checkpoint, 2026-11-04

- On 2026-11-04 (Asia/Shanghai), the user explicitly confirmed: “B2通过画面验收，将当前成果合并到main”. B2 B03 Halo / B04 Corona visual acceptance is confirmed for reviewed publication head `d5d7b84ecdb27091537d9a564b9ccf7942561cc6`. This is a user decision following the round-two visual review, not an inference from technical checks.
- B1 B01 Solar Disc / B02 Rays was visually accepted on 2026-11-03. The new integration instruction separately authorizes merging the B1 prerequisite and accepted B2 results into main while preserving each PR's implementation scope. [PR #21](https://github.com/pp123pp/cesium-webgpu-globe/pull/21) merged as `eeaca1ddc3ef960ad23cd4aae9757b31ea98063a`; [PR #22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22) now targets main. The PR merge records are authoritative for integration status and the resulting main commit.
- Before this integration, main was `5cb8eda655314119fa5567e1b4c023e2c4217906`, B1 was `22515f64eeb04f9d6aab887073051f7e2a34543b`, and the B2 round-two starting head was `302682b41a9e0ec64fcda1a0621dc49205eb694d`. These are historical checkpoints, not current no-merge restrictions.
- Accepted B2 scope is B03 Halo retention/combination checks and B04 Corona contour/filament refinement. The original Halo falloff is retained; Corona contours are replaced with feathered, tapered density and restrained warm-white color. Exact sources, matched hardware evidence, results and limitations are recorded in [round-two evidence](evidence/M2.6.1/B2/round2/README.md) and the [round-two plan](audits/M2.6.1-B2-round2-plan.md).
- Runtime source remains `b5fc33e37e0a8f5faeb731df23c954cb86f36dd0` (clean), implementation commit `e009078aa836e2631e8ec8566aa30255363ee6e1`. The before/after sets contain 158 matching captures each, including 120 consecutive frames; a separate after-only 120-frame sequence moves camera and time on every frame at fixed exposure/resolution. Halo-only and Corona-off are byte-identical. Earth hidden-pixel difference is 0; actual mesh occlusion/removal and 404/corrupt teardown pass. Nine focused units, targeted lint, generated/engine types and build passed on their recorded sources.
- Reviewed publication head `d5d7b84ecdb27091537d9a564b9ccf7942561cc6` passed [Fast 41748371938](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41748371938) and an executed [Full 41748372196](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41748372196). Acceptance-record changes are documentation only; they do not alter runtime or raw capture evidence. Their own automatic final-head checks are tracked on PR #22 and must complete before integration. Hardware and CI remain separate evidence; no new local runtime test or manual Full dispatch is claimed.
- The original B2 `combined` captures were 12-degree diagnostics with Rays and Bloom disabled. They remain historical evidence; round-two 60-degree full-effect captures explicitly restore every layer and Bloom 0.35. Original run-time PENDING/READY fields describe the capture checkpoint and remain unchanged; the subsequent user decision is recorded in the current evidence index and summary.
- B2 is accepted with the recorded nonblocking soft/cloud-like outer Corona, exposure-2 inner-contrast and overall scene-naturalness limitations. Existing `M1-NAV-001`, NaturalEarth detail/seams and single-device coverage limits remain. M2.6 A07–A10 acceptance is preserved; final M2.6.1 integrated acceptance is not claimed.
- At this historical checkpoint B3 and later phases required separate authorization. B1/B2 integration is now complete; the subsequent B3 authorization and current stop condition are recorded above. B4 atmospheric integration (B05), B5 integrated acceptance (B07), M2.7/M2.8 and M3 remain outside the current task.

## Historical M2.6 implementation checkpoint — superseded by closeout

Development branch: `feat/m2.6-solar-visual-enhancement`, based on `1869091d0d4a95250e2c56f51cb574ab23598718`. Draft PR [#18](https://github.com/pp123pp/cesium-webgpu-globe/pull/18) targets `main`; latest pushed HEAD is tracked by PR #18. Fast CI and Full regression have been triggered on the current PR head; final results are pending. No merge is authorized. Current implementation and preliminary browser evidence are not final acceptance.

- Integrated the eight authored SVG assets as seven 512×512 R8 linear alpha masks and one 512×512 RGBA8-sRGB color ramp (2,883,584 bytes total). A deterministic Playwright/Chromium build script retains all editable SVG sources and emits a per-asset manifest with alpha ranges/coverage. The WebGPU renderer fetches once, validates byte sizes, uploads once, falls back to neutral 1×1 textures on optional asset failure and tracks resource creation/destruction.
- Added independently controllable Rays, Soft Halo, Wide Halo, Corona and authored tint sampling while retaining the existing physical Sun direction, disk angular radius, per-pixel WGS84 Earth test, scene-depth test and sampled disk-area visibility estimate. The browser harness captures each effect disabled individually and asserts a distinct canvas hash. Existing Rayleigh/Mie integration remains the source of atmospheric transport; the authored gradient is only a tint.
- Added an `rgba16float` scene-linear composite, quarter-resolution bright-pass extraction, diagonal Kawase blur, linear-HDR composition, fitted ACES and final sRGB encode. Bloom intermediate targets are reused across frames and recreated on resize. Bloom strength zero bypasses extraction/blur work.
- Clean headed Chromium 156.0.8078.4 run at commit `1df6719` on Intel Xe-LPG (non-fallback adapter), 1920×1080, generated actual A07–A10 screenshots and reported no browser console errors. `timestamp-query` is not supported by this WebGPU device. Exposure 0.5/1/2, enabled/disabled Bloom, 1280×720 resize and renderer teardown are covered by `coordination/ci/m2.6-solar-visual-smoke.mjs`. A single renderer teardown balanced 16/16 textures and 3/3 buffers; resize target recreation is separately asserted.
- Local focused tests (4/4), targeted ESLint and `npm run build` passed on the current working tree. M2 Sun and atmosphere smoke passed with Bloom disabled for independent physical-path checks. These results are not final-HEAD CI.
- Preliminary 1920×1080 end-to-end `render()` plus `queue.onSubmittedWorkDone()` timings on Intel Xe-LPG: latest 30-sample means were 10.71 ms Bloom-disabled and 10.45 ms enabled (p95 13.10 / 12.10 ms). The device exposes no `timestamp-query` feature; these wall-clock measurements are not GPU timestamps. GPU frame time remains UNVERIFIED. No performance pass is claimed.
- A07–A10 are preliminary scenario-run PASS only; independent visual review of every scenario, partial Earth/terrain occultation, dynamic time stability, device-loss recovery and multi-create/destroy soak are not yet fully certified. Per-effect toggling is tested, but full visual acceptance is still open. Fast CI and Full regression have been triggered on the latest PR #18 HEAD; final results are pending. WebGL differential and physical-GPU profiling are not yet run. Do not mark any A07–A10 item ACCEPTED yet.
- `M1-NAV-001`, the NaturalEarth imagery seam and documented physical GPU/multi-device coverage limitations remain unchanged.

See [M2.6 evidence](evidence/M2.6/README.md) and [M2.6 handoff](handoffs/M2.6-solar-visual-enhancement.md) for the exact commit, bundle, evidence and remaining gates.

## M2.6 acceptance checklist

Local evidence for A07–A10 is linked in the closeout above; final publication gates remain separately tracked. Criteria from [docs/ACCEPTANCE.md](../docs/ACCEPTANCE.md):

- A07: orbital sunrise and correct solar appearance / occultation at the limb.
- A08: continuous twilight, noon and night transitions.
- A09: coherent horizon and aerial perspective across representative altitudes.
- A10: HDR highlights without inappropriate whole-image clipping; additionally implement and visually accept restrained HDR bloom, subtle radial Sun Rays tied to the true Sun direction, and atmospheric glow. Bloom must be composed in linear HDR before ACES/sRGB output; preserve Earth/terrain occultation, atmospheric attenuation and exposure control, with no glow leakage, whole-frame washout or temporal instability. Capture enabled/baseline comparisons. Cinematic lens ghosts, dirt, anamorphic streaks and exaggerated flare remain out of scope.

M2.6 must also coordinate the required final acceptance evidence and regression gates. Follow the current CI policy: Full does not include rendering acceptance or complete WebGL differential. Those checks remain separate and require the applicable explicit authorization; do not infer them from a successful Full run.

**M2.6 A10 supplement:** the existing M2.3 analytic aureole is not sufficient by itself. The in-progress implementation now includes texture-driven radial rays/halo/corona and a linear-HDR bloom path. The acceptance requirement remains the complete visible, physically constrained behavior described in [docs/ACCEPTANCE.md](../docs/ACCEPTANCE.md#m26-a10-supplemental-solar-appearance-requirement); code presence and preliminary smoke are not final visual acceptance.

## Later roadmap

After M2.6, proceed to M3 global volumetric clouds, M4 cloud shadows / terrain-light coupling, and M5 image-quality stabilization / profiling. V1.0 is M0–M5. M6 3D Tiles / BIM is deferred until after V1.0 and is not a V1.0 blocker.

---

## Historical M2.2 implementation and verification

The user explicitly authorized M2.2 implementation, necessary fixes/tests,
commits, publication of `feat/m2-physical-atmosphere` and updates to existing
[PR #8](https://github.com/pp123pp/cesium-webgpu-globe/pull/8). No main push or PR
merge is authorized. Stop after M2.2; M2.3 and later work require a new instruction.

- Restored and rechecked actual remote main
  `08dcf05d54ffc3ef62c12f76bda7ad0ac4243c1d` and development head
  `07e4659ae13187a4e22456519ed4f54300027e16`. Main is already an ancestor;
  no additional merge or parallel remote edit was present. The prior M2.1
  workspace remains untouched. Root owns Scene/bindings/STATUS; two isolated
  workers supplied disjoint model and browser-validation files.
- The M2.1 checkpoint is accepted on that exact remote SHA:
  [Fast 41453209579](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41453209579)
  and [executed Full 41453209551](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41453209551)
  succeeded. Its evidence below is historical and does not certify M2.2.
- Implemented meter-based exponential Rayleigh/Mie media, normalized phase
  functions, Beer transmittance, a reduced Hillaire isotropic multiple-scattering
  closure, 256×64 / 32×32 RGBA16Float LUTs and a production WGSL view integrator.
  A separate completed-color/depth composite supplies actual sky and terrain
  aerial perspective in linear RGB. True WGS84 solar occlusion, real terrain
  depth, high/low ECEF, reversed Z and M1 RTC remain authoritative.
- `scene.atmosphere` controls the enabled default and validated physical
  parameters. Medium edits rebuild the two LUTs; view/time/light changes reuse
  them. Context owns the intermediate color attachment. Resize, initialization
  failure, device loss and destruction follow the existing ownership paths.
- Local verification and exact working-tree/bundle identity are recorded in the
  [M2.2 handoff](handoffs/M2.2-physical-atmosphere.md) and
  [compact evidence](evidence/M2.2/README.md). The new required browser gate runs
  production WGSL, real depth, actual canvas pixels and native resource tracking.
  Both workflows retain the foundation and all existing regression gates.
- First published-head Full [41502541781](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41502541781)
  exposed a navigation accounting mismatch: 98 actual buffers versus 96 terrain
  buffers omitted two owned atmosphere uniforms. The strict equality now sums
  both owners; original caps, repeat-visit bounds and zero-resource teardown stay
  intact. Targeted navigation passed 10 checks and released 2,713/2,713 buffers
  plus 68/68 textures. The same head's Fast M2.2 artifact passed all 8 atmosphere
  checks with 3,666/3,666 releases. Full did not reach M2 after the navigation
  failure. This test/documentation repair needs final-head Fast/Full; neither
  the failed Full nor the older Fast certifies the new head.
- The next Fast [41505390861](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41505390861)
  exposed the separate M1 Globe fixture's missing atmosphere opt-out: its
  60-second surface-LOD wait timed out with 60 atmosphere frames and no render
  errors on software GPU. That geometry-only fixture now explicitly disables
  atmosphere like the shared M1 fixtures. Its unchanged time/pixel/error bounds
  pass all 7 checks in the targeted rerun, including 4 camera views. M2's own
  atmosphere gate and the enabled-default live demo retain atmosphere coverage.
- Head `a7839cf56edda42236433128768e1929e7e18231` passed
  [Fast 41507084728](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41507084728),
  including all 8 atmosphere checks and 3,670/3,670 native releases. Its
  [Full 41507084724](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41507084724)
  and one unchanged-head [retry 41511999042](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41511999042)
  both passed preceding gates but failed the enabled-default demo's Everest
  90-second readiness wait. They remain failed, not acceptance evidence.
  Targeted CPU stress reproduced slow finite frame/mesh progress without
  pending HTTP or renderer errors. The software-only fixture now keeps native
  SSE/LOD constant while using the existing resolution scale during streaming,
  then restores 1280×720 and verifies three actual frames, GPU completion and
  identical tiles inside the same original 90-second budget. Atmosphere stays
  enabled. This is a functional-test load budget, not a product loading-speed
  fix; exact hosted timeout state was unavailable in the old reports. Failure
  diagnostics now retain sanitized queue/request/tile state. See the handoff
  and `demo-readiness.json` for controls and actual source identities.
  The modified complete demo passed all 14 checks under four-CPU affinity:
  43,851 ms shared Everest budget, identical 31 tiles at LOD 11/12 after
  restoration, 769/769 buffers and 185/185 textures released, no unexpected
  browser or provider errors. This targeted local result is not final-head CI.
- This source snapshot does not certify a future or pending Actions run. Final
  acceptance requires successful Fast and an actually executed Full on the same
  latest PR head under [CI policy](../docs/CI.md). The PR body/checks provide the
  published SHA, verified tree mapping, run links and bulk artifact locations.
- `M1-NAV-001` remains **KNOWN_UNRESOLVED**; Google ion's rejected endpoint-cache
  retry limitation remains. Software-GPU results are not physical-GPU results.
  Coarse NaturalEarth imagery has a visible inherited low-orbit seam in both
  enabled/disabled captures. M1 unlit surface colors are retained at night;
  atmospheric direct sunlight is correctly occluded. No Sun disk, full HDR,
  cloud, PBR or general RenderGraph work is included.

Read [M2.2 model, units, approximations and lifecycle](../docs/WEBGPU_M2.2.md).
At that checkpoint the continuation point required explicit M2.3 authorization;
the later authorization is recorded above. No A07–A10 or whole-M2 acceptance is
claimed.

## Historical M2.1 implementation and verification

The M2.1 task authorized implementation, tests, feature-branch publication
and a PR to `main`, **not merging or M2.2 at that checkpoint**. The earlier M1 merge authorization
below is historical and does not authorize this branch's merge.

- Initially restored `main`: `c47ef56343343684f50992af8a3f32813402884f`.
  M0 [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1) and M1
  [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2) are merged, with
  merge commits `8a0c5f59bdea67e150faf3114fcdfa0d2b8748c8` and
  `676061f40cd2a885b58963bea833f551c4feb90c`, respectively.
- During this task, [PR #7](https://github.com/pp123pp/cesium-webgpu-globe/pull/7)
  updated `main` to `08dcf05d54ffc3ef62c12f76bda7ad0ac4243c1d`. Its risk-based
  verification policy was integrated by a normal merge into the M2 branch,
  preserving both histories. Only four rule/documentation files changed on main;
  runtime evidence remains applicable. No extra runtime suite was run for this
  documentation merge. The final-head acceptance/automatic CI gates still apply.
- [PR #6](https://github.com/pp123pp/cesium-webgpu-globe/pull/6) remains open at
  `6788fbd174a1104688be34abbb40c8f9d305da7a`. Its
  [Fast](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41445066459)
  passed and its
  [Full](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41445066455)
  failed. M2.1 includes bounded prerequisite repairs for two observed inherited
  ShadowMap pixel signatures and stale demo expectations; it does not merge or
  rewrite PR #6. See [prerequisite evidence](handoffs/M2.1-prerequisite-gates.md).
- Branch: `feat/m2-physical-atmosphere`, isolated worktree `cesium-m2`, based on
  the restored main. Runtime commit
  [`5eca1d0`](https://github.com/pp123pp/cesium-webgpu-globe/commit/5eca1d0ff0cdb5697126a60433713fcbedb9de3a)
  has tree `3d4c8d71e94b982e00031010142a63723d142ec0`, identical to local
  `1435343546a00031d37a3b0504b266ff321edfe9`. GitHub publication uses the
  authorized connector because local Git has no GitHub push credential; commit
  identities differ, and each published tree was explicitly checked.
- Implemented native ECEF/meters/WGS84 parameters, native time-dependent
  Earth-to-Sun direction, forward ellipsoid/atmosphere ray intervals, a 192-byte
  CPU/WGSL state interface, shared finite reversed-Z reconstruction and readable
  Globe depth. M1 terrain RTC/matrices, depth ordering and camera behavior remain
  intact. No atmosphere, Sun disk, sky or HDR rendering is added.
- Local verification: **224 focused tests passed** across all 20 M0/M1/M2 files;
  build, ESLint, generated declarations and TypeScript passed. Real WebGPU
  verification passed 9 asymmetric-camera probes, 23 boundary cases and 8
  aggregate checks, including 35,786 km / 400 km / 2 m scenes, native mesh-pick
  depth comparisons, sky, resize and **456/456** released native GPU resources.
  Independent review found no blocking code issue.
- These local reports identify the actual working tree and bundle; they are not
  relabeled as a later clean commit. **Final acceptance requires successful Fast
  and an actually executed Full on the current M2 PR head.** The PR checks/body
  and Actions artifacts record that final result; this publication snapshot does
  not claim that a future or pending run passed. No redundant complete local
  upstream run was added before the hosted final-head regression.
- `M1-NAV-001` remains **KNOWN_UNRESOLVED**. The inherited rejected Google ion
  endpoint-promise retry limitation is documented, not repaired. Physical GPU
  testing remains unavailable and nonblocking; observed results use Chromium 156,
  headed Xvfb and Google SwiftShader software rendering.

Read [M2.1 contracts](../docs/WEBGPU_M2.1.md),
[handoff](handoffs/M2.1-mathematical-foundation.md) and
[compact evidence](evidence/M2.1/README.md). Its final-head checks succeeded and
the later explicit M2.2 authorization is recorded above. The PR stays unmerged.

## Completed

- M0.1: pinned source, version `1.146.0`, upstream commit and Apache-2.0 license verified.
- M0.2: build and WebGL smoke passed in run 41386475484, but its unit-test browser never started and gulp hid the failure. Corrected baseline run [41389237203](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41389237203) actually passed 10,353 non-WebGL tests (5,537 skipped). Historical handoffs now carry this correction.
- Historical M0.2 WebGL smoke verified initialization; M0.5 below supersedes it with visible Globe readiness and independent visual comparison.
- M0.3: Viewer → CesiumWidget → Scene → Globe → QuadtreePrimitive → GlobeSurfaceTileProvider → Context pipeline audited; see `coordination/handoffs/M0.3-source-pipeline-audit.md`.
- M0.4: Viewer selects an isolated WebGPU proof at construction while preserving Viewer identity. WebGPUContext/WebGPUWidget own device/canvas, WGSL color/depth drawing, sizing, errors/loss and disposal. The real-browser gate, standalone demo and screenshot inspection passed. Existing CesiumWidget, Scene, WebGL Context and Globe source remain unchanged.

## Historical M1 closeout and integration

M1 covers the real WGS84 Globe, ImageryProvider and TerrainProvider, A03–A06. On 2026-11-02 the user additionally instructed **“收尾后合并到main”** for that closeout. M0 dependency [PR #1](https://github.com/pp123pp/cesium-webgpu-globe/pull/1), then [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2), were merged into `main`. M2 had not started at that historical checkpoint; the subsequent M2 checkpoints are recorded above.

Verified runtime source: `03233dae8b524d6b3f4498a48a2fd7e89fffa806`, tree `48142ced46a15cdf435db7902b9ba601449b5358`, identical to locally verified `f2b9921`. [Fast 41430449080](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449080) and [Full 41430449094](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094) both completed successfully. The actual Full regression job ran every required step; this was not a selector-only success.

This closeout changes documentation and evidence only. Its publication must also pass Fast and an executed Full on the latest PR head under `docs/CI.md`. The live PR checks and merge record are the final publication authority; the source report below does not claim to test a future commit SHA. See [M1 acceptance handoff](handoffs/M1-acceptance.md).

### Verified hosted closeout evidence

- Build, ESLint, generated declarations and TypeScript checks pass; all **160 focused tests** pass across 17 suites.
- A03 WGS84 foundation, A04 imagery and ordinary A06 navigation/depth/precision/input/resource gates pass. All five M1 browser reports identify the exact verified source above.
- A05 actual quantized World Terrain + ArcGIS imagery passes ordinary coverage, adjacent/mixed-LOD checks and four LOD transitions with zero background/untextured pixels. Drape passes **561/561** native-pick samples; a real 1 km GPU imagery offset fails **535/561**, as required.
- The hosted rapid flight **observed `M1-NAV-001`**: coarse-terrain collision left the camera **2,098.890 m above terrain**, above its requested height. It is `KNOWN_UNRESOLVED`; the complete terrain result is `PASS_WITH_KNOWN_ISSUES`. The flight ran, and drape/error/cleanup checks continued afterwards. A06 is not unconditionally passed.
- Hosted terrain releases **1,184/1,184 buffers and 424/424 imagery textures**; pending requests, retained bytes and canvases are zero. Ordinary navigation releases **2,608/2,608 actual GPU buffers and 68/68 actual GPU textures**.
- All **10 live demo checks** pass, including native Providers, attribution, Everest/Orbit, retry, device loss and early exit. Demo teardown releases **884/884 buffers and 242/242 native GPU textures**, including depth textures.
- Complete non-WebGL: **10,353 passed / 5,537 skipped**. Complete WebGL differential: both independent baseline and candidate execute **3,822 specs: 3,811 passed / the same 11 failed / 12,068 skipped**. No new failures or changed failure signatures; raw suites still exit 1. The historical 12-failure M0 result below is preserved as history, not reused as this run's count.
- Independent source/acceptance review found no Critical/Important blocker and independently ran 51 focused cases. Hosted checks, source identities, reports, representative screenshots and checksums are in `coordination/evidence/M1/closeout/hosted/`.

Earlier local results remain separately in `coordination/evidence/M1/closeout/local/`, including the original sandbox `EPERM` and unchanged successful retry. That local rapid-flight sample passed at 33.579 m AGL; it does not negate the hosted occurrence or resolve the intermittent defect. Historical rejected candidates remain unchanged in their original evidence and handoffs.

### Acceptance decisions already authorized

- Harmless visual differences are allowed; WebGL/WebGPU images need not be pixel-identical. This applies to later acceptance too and does not waive functional regressions.
- Physical GPU testing is unavailable and nonblocking. Current browser evidence is Chromium 156 / headed Xvfb / Google SwiftShader software rendering; no physical performance claim is made.
- Only the repeatedly unresolved fast real-terrain descent collision/altitude problem is nonblocking as `M1-NAV-001`. The test still runs and retains its evidence. Ordinary terrain coverage/LOD, imagery/drape, other navigation, cleanup, browser errors and complete upstream regression remain mandatory.

## M0.5 acceptance (2026-11-02)

- User explicitly waived unavailable physical GPU testing as a blocker: “若没有可用物理 GPU，则跳过这个要求，不作为卡点”. Current evidence is **software only**, never physical GPU evidence.
- Visible WebGL Globe readiness now requires renderable terrain tiles/vertex arrays, completed load queues and three stable frames. Orbit/oblique/resized pixels exactly match a clean independent pre-WebGPU build (`724b5db`); settled PNG captures also match. Blank/transparent/missing-Globe/shifted-image controls reject regressions.
- WebGPU: all 17 real-browser depth/lifecycle/demo checks pass; normal rendering has no unexpected validation/browser errors. Original lifecycle and new pixel/config tests: 13 passed; differential-runner tests: 26 passed; control-flow probes: 5 passed.
- Full non-WebGL suite: 10,353 passed, 5,537 skipped. Full WebGL **no-new-regression gate passes**: baseline and candidate each execute 3,822 specs with 3,810 passed and the **same 12 inherited failures** (12,068 skipped). Exact execution order and assertion signatures match. The underlying suites still exit 1; those failures are not claimed passed.
- Chromium 156.0.8078.4, Ubuntu 24.04, Google SwiftShader, headed Xvfb for screenshots. Source and served-bundle provenance, browser/GPU metadata, screenshots and compact differential report are preserved in `coordination/evidence/M0.5/`.
- Concurrent remote `fda7f01` was integrated with a normal merge preserving repeatability checks. At that M0.5 checkpoint, `main` was unmerged. See `coordination/handoffs/M0.5-regression-gate.md` for commands, local certificate-trust diagnosis and retained upstream failures.
- Published-head CI: [PR run 41400575907](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400575907) passed; [push run 41400570084 attempt 2](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41400570084/attempts/2) passed. Push attempt 1 retained two extra native Cesium3DTileset async timeouts; rerunning only the failed job without any source or gate change passed. The original failure remains in Actions.

## Historical M1 branch dependencies and publication

- `feat/m0-webgpu-backend` / PR #1 supplies M0; its verified head is `7a689426af4b4b5f9c510d91e68ff45623f20090`.
- `feat/m1-wgs84-globe` / PR #2 supplies M1 and this closeout. Preserve both histories with normal merge commits; do not force-push or delete the branches during closeout.
- The independent pre-WebGPU reference remains pinned at `724b5db`. One integration owner controls shared source and STATUS.
- Before the newly authorized integration, `main` was `a7f4729`. Merge PR #1 first, retarget PR #2 to `main`, verify its final checks and prospective merge tree, then merge PR #2. GitHub records the resulting SHAs and actual merge state.

## Tests

- Local build, targeted ESLint/Prettier and nine lifecycle tests: PASS.
- Accepted run [41392263849](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849): build, 9 lifecycle tests, original WebGL smoke, 10,353 non-WebGL tests (5,537 skipped), and **17 WebGPU checks: PASS**.
- Chromium `156.0.8078.4`, Google SwiftShader, headed via Xvfb. Normal WebGPU drawing has zero unexpected validation/browser errors. GPU readback and inspected screenshots agree: background `[10,15,26]`, center `[127,64,64]`.
- [Artifact 13118360256](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41392263849/artifacts/13118360256): JSON diagnostics, original WebGL screenshot, WebGPU proof and standalone-demo screenshots.
- M0.5 visual/software regression gate: complete under the explicit user waiver; see the newer M0.5 acceptance above. Physical hardware testing remains unperformed and nonblocking.

## Open decisions

- WebGPU unsupported behavior: explicit error; no silent WebGL fallback.
- Recovery after device loss is destruction and recreation; no backend hot switch.
- Read `coordination/handoffs/M0.4-webgpu-proof.md` for the supported API, commands, evidence and environment limits.

## Historical handoff — B4 / B05 accepted and merged, 2026-11-04

**B4 / B05 implementation, scoped technical verification and user visual acceptance PASS. PR #25 merged into main at `34f2571b80ee1854e4a7b8369c845aa506a0b24d`. B5 / B07 remains unstarted; M2.6.1 as a whole is not complete.**

- [PR #25](https://github.com/pp123pp/cesium-webgpu-globe/pull/25) merged B4 / B05 from feat/m2-6-1-b4-atmospheric-glow into main at `34f2571b80ee1854e4a7b8369c845aa506a0b24d` on 2026-11-04. Canonical baseline/build: `5f18afc1b77f433892f14510b2599c374f8a4942`; candidate capture/shared harness: `ac7884dcb15b0e83ac173f211b7eb1814ee26a92`; candidate bundle built at `995860bf2e3aa6cee0731d2e110643f45e16f6bf`, with identical runtime/build inputs at capture. Original B4 engine commit ff06e96 is unchanged.
- Corrected actual-limb exposures 0.5/1/2, independent night camera, distinct 36,000 km/400 km/2 km/2 m views and ground-facing day/terminator/night. Added partial Earth and real-mesh full occultation, matched effect controls, source isolation and complete source/bundle/camera/PNG hashes. [Round-two evidence](evidence/M2.6.1/B4/round2/README.md) preserves 42 PNGs per side.
- Both canonical builds passed; original build logs are retained. Focused Node batch: 18/18 passed, none skipped. Intel Xe-LPG / headed Chrome 156.0.8078.80, 1920×1080; no browser errors/warnings. Offline audit verifies 84 PNG hashes, 42 matched state pairs, 24 required invariant pairs and 28 identical pairs.
- Partial Earth: 36/81 disk samples blocked, 45 clear, hidden-receiver solar difference 0. Full terrain: 81/81 mesh hits, 0 analytic Earth hits, positive depth and zero solar readback; full-frame Sun on/off difference 0. Mesh removal restores the source; −8°/−4° sky residual controls also have max difference 0.
- Yellow twilight and weak disk contrast remain in the baseline-identical physical-only/no-Bloom control. Bloom additionally changes brightness/color and reduces contrast; authored artwork contributes a smaller local veil. Geometric night framing is corrected, but inherited unlit terrain remains unrealistically bright. Atmosphere/HDR calibration and surface lighting require separate work; no B4 runtime retune or exposure reduction was justified.
- Supplementary 10e3d08/f58881f recapture metadata is preserved separately; all 84 image hashes equal the canonical images. Its distinct candidate bundle is not conflated with the canonical build. Subsequent publication/audit-label changes do not imply a new hardware test.
- [CI record](evidence/M2.6.1/B4/round2/ci-status.json) identifies actual commit/job states; PR #25 tracks later publication checks. Canonical ac7884d Fast and executed Full passed; later documentation-head Full skips are explicitly skips. No manual Full dispatch, new local WebGL differential, timing, 120-frame sequence or full B5 matrix.
- [Handoff](handoffs/M2.6.1-B4-atmospheric-glow.md) records B4 acceptance and merge. Stop after B4; do not start B5/B07 or claim M2.6.1 complete without separate authorization.
