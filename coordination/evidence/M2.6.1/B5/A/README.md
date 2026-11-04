# M2.6.1-B5-A — Static Integrated Visual Audit

**Result: FAIL (static visual gate).** The eight required scene slots are populated with original, unmodified WebGPU PNG captures and each has a per-scene review. This is not a B5-B/C result and does not close M2.6.1.

## Provenance and capture reuse

The eight images are exact byte copies of the canonical B4 round-two candidate captures. They are not newly captured for B5-A. This reuse is intentional and limited to static review: the B4 evidence records a headed, non-fallback Intel Xe-LPG WebGPU run at 1920×1080, Chrome 156.0.8078.80, exposure 1, scene time 2026-03-20T12:00:00Z, with original per-scene camera vectors, height, Sun elevation, PNG SHA-256, browser errors and bundle identity in `result.json`.

- Capture/runtime source: `ac7884dcb15b0e83ac173f211b7eb1814ee26a92`
- Bundle build checkout: `995860bf2e3aa6cee0731d2e110643f45e16f6bf`
- Capture harness: `ac7884dcb15b0e83ac173f211b7eb1814ee26a92`
- Bundle SHA-256: `71ea6226295ad805895660da9f6f4ce7711a93c4b32c69b03284bc1a3cdb402f`
- Current main checked: `f51ee9ea1618071ec67f77421c5a4d933ce1f3d4`
- Git comparison: `packages/engine/Source` is identical between bundle-build commit `995860b` and current main. Intervening differences are planning/evidence/harness records, not engine source.
- Hardware: Intel Xe-LPG non-fallback adapter (Windows device identified in B4 report as Intel Arc 130T, 16 GB; driver 32.0.101.8801).
- Browser: headed Chrome 156.0.8078.80; viewport 1920×1080; DPR approximately 1; CesiumJS 1.146.0.

**Limit:** source equivalence is established for the engine source tree and the historical B4 report says the candidate bundle hash matched its served bundle. This package does not claim a fresh B5-A build, fresh live-production deployment capture, or a new GPU run on current main. The original source/bundle identities are preserved rather than relabeled as current-main execution.

## Scene results

| ID | Scene | Camera height | Sun elevation | Result | Raw screenshot |
| --- | --- | ---: | ---: | --- | --- |
| A01 | High-orbit direct Sun | 36,000 km | +60° | FAIL | [PNG](high-orbit-direct-36000km-atmosphere-on.png) |
| A02 | High-orbit Earth limb | 36,000 km | −80.99° | FAIL | [PNG](high-orbit-limb-36000km-atmosphere-on.png) |
| A03 | Low-orbit sunrise | 400 km | −19.43° | FAIL | [PNG](low-orbit-sunrise-400km-atmosphere-on.png) |
| A04 | Low-orbit low Sun | 400 km | See result.json | FAIL | [PNG](low-orbit-low-sun-400km-atmosphere-on.png) |
| A05 | Near-ground low Sun | 2 km | See result.json | FAIL | [PNG](near-ground-low-sun-2km-atmosphere-on.png) |
| A06 | Ground daytime | 2 m | See result.json | PASS | [PNG](ground-day-2m-atmosphere-on.png) |
| A07 | Ground twilight | 2 m | See result.json | FAIL | [PNG](ground-twilight-2m-atmosphere-on.png) |
| A08 | Ground night | 2 m | See result.json | BLOCKED | [PNG](ground-night-2m-atmosphere-on.png) |

All exact Sun angles, camera position/direction/up, timestamps, exposure, viewport, adapter/browser and PNG hashes are in the structured [result.json](result.json).

## Integrated visual findings

1. **B1 — Solar Disc / Rays:** A01 still presents prominent, relatively regular radial spokes at long range. This is a direct mismatch with the target of restrained, non-decorative rays. Disk silhouette is clear, but the core is clipped to white in the sampled A01 pixels; disk highlight roll-off cannot be judged from this exposure alone.
2. **B2 — Halo / Corona:** The broad halo is visible and continuous, but in A01 the radial pattern competes with the disk and halo. A02/A03 show the halo near the limb/horizon; no separate new corona texture discontinuity is established from these eight static views. B2 is not independently failed on texture integrity from this limited set.
3. **B3 — HDR Bloom:** The direct/high-orbit halo remains broad. A03/A04/A07 lose useful color/contrast in the horizon region. The B4 matched diagnosis already shows Bloom measurably changes far-sky brightness/color and reduces disk contrast, while the physical-only/no-Bloom control remains strongly yellow. Classify this as a B3 + physical-atmosphere display-balance interaction, not a proven B3-only regression.
4. **B4 — Atmospheric Glow:** A02 shows a conspicuous thin saturated rim at the Earth silhouette. The image alone does not prove whether it is a physical scattering boundary, surface/atmosphere compositing edge or capture fixture artifact. Keep as a diagnostic item; do not change shader without a controlled matched probe.
5. **Baseline atmosphere / surface lighting:** Yellow twilight and the bright blue unlit night-side constant-color surface are already documented in B4 baseline-identical controls. They are not new B4 regressions and are not fixed or waived by this audit.

## Scene-by-scene review

- **A01 FAIL:** Disk boundary is distinct; the halo/corona are visible. Radial spokes are too prominent and too regular for the primary far-distance product use. The sampled core is clipped white (B4 raw report: 100% of disk samples have a channel at 254 or above), so the highlight transition needs a lower-exposure comparison before judging roll-off.
- **A02 FAIL:** Sun is correctly framed above the Earth limb. A narrow high-saturation cyan/yellow edge follows the silhouette and is visually too hard. Needs source attribution before deciding whether B4 or the underlying atmospheric/surface baseline owns it.
- **A03 FAIL:** Sunrise geometry is legible, but the red/orange horizon band is strongly saturated and the radial artwork remains obvious. Existing B4 controls indicate a substantial physical-scattering contribution.
- **A04 FAIL:** The broad warm horizon band and radial rays dominate the view. Physical-only and Bloom-off comparisons are needed to separate B3 from physical transport; those prior controls are retained in B4 round-two evidence.
- **A05 FAIL:** The sky is broadly washed with a pale warm field; the Sun reads as a small low-contrast disk. This is consistent with the previously recorded near-ground low-Sun contrast concern.
- **A06 PASS:** Ground daytime retains a visible disk and smooth surrounding glow without a hard halo boundary in this frame. Fine corona/ray detail is naturally subdued at this viewing scale.
- **A07 FAIL:** The yellow field is nearly uniform and the solar disk is weakly separated. B4 matched physical-only/no-Bloom evidence demonstrates that much of the yellow is pre-existing physical transport/display balance; authored artwork and Bloom add smaller changes.
- **A08 BLOCKED:** Solar artwork residual is not apparent in the captured night frame. However, the constant-color unlit surface remains bright blue and prevents a complete scene-quality judgement. This is a known baseline surface-lighting limitation, not a solar-artwork failure.

## Required six-part review summary

| Aspect | Finding |
| --- | --- |
| Solar Disc | Clear silhouette; highlight clipping/weak low-Sun contrast require attention. |
| Solar Rays | FAIL: overly prominent/regular in far-orbit view. |
| Solar Halo | Broad smooth falloff visible; no new hard-ring defect proven in this sample. |
| Solar Corona | Visible but not sufficiently isolated from Rays/Halo in the current static set; no new texture defect proven. |
| HDR Bloom | Broad at horizon; contributes to contrast/color compression. Attribute jointly with physical transport until controlled comparison. |
| Atmospheric Glow | Earth limb has conspicuous thin colored edge; needs diagnostic attribution, not speculative shader tuning. |

## Scope boundary

This is static evidence and review only. No Shader/runtime code was changed. No new render pass was added. The following remain **NOT RUN** and are not implied to pass:

- B5-B: 120-frame temporal stability, continuous time/camera movement, complete Earth/terrain occultation matrix, flicker/jump analysis.
- B5-C: GPU mean/P95 performance comparison, complete resource lifecycle validation, final full regression and M2.6.1 closeout.

**Handoff:** B5-A static audit evidence is assembled, but the visual gate is FAIL due primarily to far-orbit Rays and horizon/limb presentation. Stop here for user review; do not start B5-B/B5-C or merge main.
