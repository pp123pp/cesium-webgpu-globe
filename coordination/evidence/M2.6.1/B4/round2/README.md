# M2.6.1-B4 — Round 2: corrected scenes and matched evidence

**Technical result: PASS_WITH_KNOWN_ISSUES. Visual acceptance: AWAITING USER REVIEW.** This is B4 / B05 only. PR #25 remains draft; B5 has not started and main is not merged or pushed.

## Fixed source and build identities

The canonical comparison is the first complete round-two capture, using the same committed harness on both runtimes. Later recapture metadata is retained separately; it does not replace this source-to-build record.

| Identity | Accepted baseline | B4 candidate |
| --- | --- | --- |
| Runtime checkout during capture | 5f18afc1b77f433892f14510b2599c374f8a4942 | ac7884dcb15b0e83ac173f211b7eb1814ee26a92 |
| Bundle build checkout | 5f18afc1b77f433892f14510b2599c374f8a4942 | 995860bf2e3aa6cee0731d2e110643f45e16f6bf |
| Engine Source Git tree | d89e835bb08c174afa1d8ad374679cb605a3ae03 | a01b16951f3f31458a9c3768fe0626a6e5a10341 |
| Capture harness checkout | ac7884dcb15b0e83ac173f211b7eb1814ee26a92 | ac7884dcb15b0e83ac173f211b7eb1814ee26a92 |
| Bundle SHA-256 | c7529148c4b88961c0b2249868d662e8baca4f167f2b0853f4a2cf4565797854 | 71ea6226295ad805895660da9f6f4ce7711a93c4b32c69b03284bc1a3cdb402f |

Both `npm run build` executions succeeded. Candidate commit ac7884d changes only the capture script after 995860b; the engine tree and runtime/build inputs are identical, so the existing bundle was reused. Both runtime worktrees and the shared harness were clean at capture. The local bundle hash equals the served bundle hash. No uncommitted shader replacement or dirty patch was used.

[Build manifest](build-manifest.json), [baseline build log](verification/baseline-build.log), [candidate build log](verification/candidate-build.log), [baseline raw report](before/result.json) and [candidate raw report](after/result.json) establish the mapping. Raw reports include runtime/harness file hashes, every camera vector, time, Sun state, exposure, effects, atmosphere, FOV, terrain, resolution, GPU/browser and PNG SHA-256.

The original B4 engine implementation remains ff06e9691ae98550cc965e1f8c6313a730c0bab6. No engine runtime code changed in this round. Later harness commit 10e3d08 and publication commits are distinct from the hardware-tested canonical harness. Supplementary captures at f58881f / 10e3d08, including their different candidate bundle hash, remain in [repeat metadata](repeat/README.md). Every supplementary PNG is byte-identical to its canonical counterpart; the images are shared without duplication.

## Environment and coverage

Windows, Node 22.20.0, headed Chrome 156.0.8078.80, Intel Xe-LPG non-fallback WebGPU; Windows identifies Intel Arc 130T GPU (16 GB), driver 32.0.101.8801. Canvas: 1920 × 1080. Fixed time: 2026-03-20T12:00:00Z. Exposure is 1 except the explicit 0.5 / 1 / 2 sequence. Reported DPR differs only by Windows floating-point rounding, 1 versus 1.0000000149011612; the audit requires exact physical dimensions and less than 1e-6 DPR difference.

The 42 captures per side use deterministic untextured ellipsoid base color. The terrain case adds a real rendered 6 km Gaussian CustomHeightmapTerrainProvider mesh. These are controlled diagnostic scenes, not a natural-landscape realism test.

Height labels correspond to actual camera heights: high orbit 36,000 km; low orbit 400 km; near-ground 2 km; ground 2 m. Coverage includes high-orbit direct Sun and limb, low-orbit sunrise and low Sun, near-ground low Sun, ground day/twilight/night, and downward ground-facing day/terminator/night. Eleven primary views retain atmosphere-off/on pairs.

## Corrected limb exposure and night views

The old 400 km / +0.5° exposure view placed the Sun about 20.28° above the Earth limb and sampled no Earth in its 12° FOV. The corrected camera uses the actual WGS84 limb elevation plus 0.35°. All three exposures retain identical camera, time, FOV, Sun and effect settings and include the Sun, atmospheric limb and Earth.

| Scenario | Baseline | Candidate |
| --- | --- | --- |
| Limb exposure 0.5 | [PNG](before/orbital-limb-exposure-0.5.png) | [PNG](after/orbital-limb-exposure-0.5.png) |
| Limb exposure 1 | [PNG](before/orbital-limb-exposure-1.png) | [PNG](after/orbital-limb-exposure-1.png) |
| Limb exposure 2 | [PNG](before/orbital-limb-exposure-2.png) | [PNG](after/orbital-limb-exposure-2.png) |
| Night horizon, 2 m | [PNG](before/ground-night-2m-atmosphere-on.png) | [PNG](after/ground-night-2m-atmosphere-on.png) |
| High-orbit limb, 36,000 km | [PNG](before/high-orbit-limb-36000km-atmosphere-on.png) | [PNG](after/high-orbit-limb-36000km-atmosphere-on.png) |
| Near-ground low Sun, 2 km | [PNG](before/near-ground-low-sun-2km-atmosphere-on.png) | [PNG](after/near-ground-low-sun-2km-atmosphere-on.png) |

The old night camera pointed at the below-horizon Sun and sampled no sky. The corrected view keeps Sun elevation −8° while independently aiming the camera +0.5° above the horizon, yielding 15 sky / 10 Earth framing samples. Additional −1° and −4° Sun views show the twilight-to-night transition.

**Night surface limitation remains:** the geographic night-side receiver is visible, but the current constant-color globe surface is unlit albedo and stays unrealistically bright blue. The same baseline/candidate night images are byte-identical. This is an inherited surface-lighting limitation, not successful realistic dark-terrain acceptance. The fixture was not recolored to hide it.

## Representative occultation and residual controls

| State | Actual occlusion | Evidence |
| --- | --- | --- |
| Earth partially covers the disk | 36 / 81 disk samples Earth-blocked, 45 clear; 51,377 hidden receiver samples have max Sun-on/off delta 0 bytes | [All](after/earth-partial-all.png), [artwork off](after/earth-partial-physical-only.png), [Bloom off](after/earth-partial-bloom-off.png), [Sun off](after/earth-partial-sun-off.png) |
| Real terrain fully covers the disk | 81 / 81 mesh-blocked, 0 / 81 analytic Earth hits; five GPU probes report terrain depth and zero solar radiance; full-frame Sun-on/off max delta 0, changed pixels 0 | [All](after/terrain-full-all.png), [artwork off](after/terrain-full-physical-only.png), [Bloom off](after/terrain-full-bloom-off.png), [Sun off](after/terrain-full-sun-off.png) |
| Terrain removed | All 81 disk samples clear; production solar readback becomes positive | [Positive control](after/terrain-removed-all.png) |

At −8° and −4°, matched Sun-on/off frames also have maximum byte delta 0. Visible-sky probes separately record physical atmospheric radiance. Warm sky remaining behind the occluding terrain is therefore not evidence of Rays/Halo/Corona/Bloom leakage. The existing atmosphere models Earth shadow, not terrain shadows in the scattering volume. This representative check does not claim the full B5 occultation matrix.

## Twilight color and disk contrast diagnosis

The four controls retain the same camera, time and exposure. Physical-only disables authored solar effects and glow while retaining the physical disk and atmosphere. Bloom-off preserves the other components.

| Mode | Raw image | Disk luminance | Annulus luminance | (Disk − annulus) / annulus |
| --- | --- | ---: | ---: | ---: |
| All effects | [PNG](after/twilight-all.png) | 0.81976 | 0.74806 | 9.58% |
| Physical-only | [PNG](after/twilight-physical-only.png) | 0.81775 | 0.74376 | 9.95% |
| Bloom-off | [PNG](after/twilight-bloom-off.png) | 0.78412 | 0.70792 | 10.76% |
| Physical-only + Bloom-off | [PNG](after/twilight-physical-no-bloom.png) | 0.78213 | 0.70385 | 11.12% |

These are decoded sRGB **post-tone-map** luminances, not scene-linear radiance or acceptance thresholds. Disk ROI is within 0.65 projected solar radius; annulus is 1.5–2.5 radii. Far-sky ROI is the top-left 20% region.

Far-sky mean RGB is [231.8188, 200.7053, 93.8558] for all / physical-only and [230.7502, 198.6050, 91.2792] for Bloom-off / physical-no-Bloom. The baseline and candidate match within each mode. Bloom measurably changes sky brightness/color and reduces disk contrast; the strong yellow remains when both artwork and Bloom are disabled.

At the sampled physical-only solar pixel, view transmittance is [0.252545, 0.053960, 0.001105], physical atmospheric radiance is [2.434791, 0.661732, 0.049666], and solar radiance before transport is approximately [6.249496, 6.249480, 6.249439]. At that pixel, physical in-scattered radiance exceeds the transmitted solar term. This probe and the full physical-no-Bloom control support a pre-existing physical transport/display-balance contribution; they do not make a frame-wide single-pixel inference.

The baseline/candidate physical-only and physical-no-Bloom images are byte-identical. Authored artwork adds a smaller local veil; Bloom further compresses contrast. No B4-specific new yellow defect was established, so no runtime retune, exposure reduction or physical-scattering change was justified. Yellow twilight and weak disk contrast remain open for separately scoped atmosphere/HDR color calibration.

## Actual image review and limits

The integration owner and an independent reviewer opened the original exposure 0.5/1/2, night, twilight-control and terrain-occlusion PNGs, plus representative matching baseline images. Review used raw captures, without recoloring, rescaling or generated substitutes. The user explicitly confirmed B4 / B05 visual acceptance on 2026-11-04.

The corrected orbital frames make the disk, atmospheric limb and Earth assessable across all three exposures. Saturated horizon colors, prominent radial artwork, slight silhouette stair steps, weak twilight contrast and bright unlit night terrain remain visible concerns. The smooth synthetic occluder limits scenic realism. Automated PASS was supplemented by manual raw-image review and explicit user visual acceptance.

## Verification and reproduction

- Baseline and candidate builds: PASS, with original build logs retained above.
- [Focused Node batch](verification/focused-tests.log): 18 passed, 0 failed, 0 skipped.
- Hardware suite: 42 captures per side, no browser errors or warnings; cleanup resource checks passed. [Baseline log](verification/baseline-capture.log), [candidate log](verification/candidate-capture.log).
- [Offline audit](audit.json): 42 exact state pairs, 84 PNG hashes, 24 required invariant pairs, 28 byte-identical baseline/candidate pairs. The small DPR tolerance is explicit; camera, time, Sun, exposure, FOV, settings and physical dimensions match.
- Subsequent publication changes concern evidence, labels and offline audit metadata; no fresh runtime test is implied.
- [CI job record](ci-status.json) identifies observed commits and actual job states. No manual Full dispatch. A skipped Full job is not reported as passed.

Reproduce the canonical comparison with clean runtime checkouts at the tabled commits and a separate clean ac7884d harness checkout. Build and serve each runtime's CesiumUnminified bundle, then run the harness by absolute path with the runtime checkout as the current directory. Set M0_GPU_MODE=hardware, M0_REQUIRE_PHYSICAL_GPU=1, M0_HEADLESS=0, M0_BROWSER_EXECUTABLE to the installed Chrome executable, M1_BASE_URL to that runtime server, M1_OUTPUT to a fresh result directory, and B4_ROLE to baseline or candidate. Serialize the two GPU captures. No B4_RUNTIME_COMMIT override is used by the canonical ac7884d harness.

Run the current offline audit with:

```text
node coordination/ci/m2.6.1-b4-audit.mjs coordination/evidence/M2.6.1/B4/round2/before coordination/evidence/M2.6.1/B4/round2/after <new-audit-output.json>
```

The [capture script](../../../../ci/m2.6.1-b4-atmospheric-glow-smoke.mjs), [fixtures](../../../../ci/m2.6.1-b4-fixtures.mjs) and [audit](../../../../ci/m2.6.1-b4-audit.mjs) preserve the checks. No new timing run, resident-VRAM measurement, full B5 matrix, 120-frame sequence or additional local WebGL differential was performed. Round-one captures/timing remain historical and are not overwritten or relabeled as fresh evidence.

**B4 / B05 visual acceptance: PASS (user-confirmed 2026-11-04).** PR #25 merge is authorized. B5/B07 remains unstarted and requires a separate instruction.
