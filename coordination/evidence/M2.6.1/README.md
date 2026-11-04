# M2.6.1 — integrated acceptance evidence index (2026-11-05)

**Decision: B1–B5 implementation and the ten SVP visual/functional criteria are accepted by phase. Final milestone closeout remains PENDING the separately authorized, final-runtime complete WebGL differential.** Do not interpret the completed hosted workflows as WebGL rendering verification.

## Integration and tested identity

- PRs [#21](https://github.com/pp123pp/cesium-webgpu-globe/pull/21), [#22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22), [#23](https://github.com/pp123pp/cesium-webgpu-globe/pull/23), [#25](https://github.com/pp123pp/cesium-webgpu-globe/pull/25), [#27](https://github.com/pp123pp/cesium-webgpu-globe/pull/27) and [#28](https://github.com/pp123pp/cesium-webgpu-globe/pull/28) are merged. PR #28 tested head: `96820edb62a7c27ef679914d3a2ef257239cbdb1`; main merge commit: `1462876b3f6428e3fe5da5a054d01bcc6767d66b`.
- B5-B/B5-C physical GPU source: `8e7c53c09f3b0e2ae6b38ab4593d818282b979a4`, with production bundle SHA-256 `410f39366223a6a611e2072945c39d682507b2b152e2105a964325887cab9980`. PR #28 adds harnesses, accepted evidence and documentation without changing engine runtime.
- Local capture: Intel Xe-LPG non-fallback WebGPU, headed Chrome 156.0.8078.80, Windows. Captures are real GPU output, not hosted SwiftShader. See the phase reports for camera/time, exposure, source hashes and per-run exceptions.
- PR #28 exact-head [Fast CI](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319742) PASS and actually executed [Full regression](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319604) PASS. Both are now non-rendering tiers. The separate full WebGL differential has **not** been executed for the M2.6.1 runtime.

## SVP-01–SVP-10 traceability

| Gate | Phase-level decision | Primary evidence and qualification |
| --- | --- | --- |
| SVP-01 layered reference Sun | PASS | [B5-A-R round 3](B5-A-R/round3/README.md) A01; B1/B2 accepted visual refinements. |
| SVP-02 controlled Rays / stability | PASS | [B2 round 2](B2/round2/README.md), [B5-A-R round 3](B5-A-R/round3/README.md) and [B5-B](B5-B/README.md) moving-camera frames. |
| SVP-03 halo / corona continuity | PASS | [B2 round 2](B2/round2/README.md) and B5-A-R round-three integrated static review. |
| SVP-04 exposures 0.5 / 1 / 2 | PASS | B5-A-R round-three matched exposures and [B3 HDR Bloom](B3/README.md); high-exposure limb/detail limitations remain. |
| SVP-05 elevation / altitude | PASS | B5-A-R round-three A01–A08 (high orbit, low orbit, near ground and night), with accepted A02 limb and A05 haze limitations. |
| SVP-06 Earth / native terrain hiding | PASS | [B5-B](B5-B/README.md) Earth-limb 120-frame sequence, full-hidden on/off control, native mountain occlusion/removal. Bounded deterministic native mesh, not live terrain streaming. |
| SVP-07 temporal stability | PASS | B5-B 48 fixed-state frames plus 120-frame camera/time and 120-frame limb sequences, 288 original PNG hashes; capture-paced, not a real-time FPS claim. |
| SVP-08 resize / off-axis | PASS | B5-B 1920×1080 → 1280×720 → 1920×1080 and off-axis stable captures. |
| SVP-09 effect isolation | PASS | B1/B2/B3 accepted same-state per-effect controls; B5-A-R matched atmosphere/Bloom and selected effect-disabled captures. |
| SVP-10 GPU cost / lifecycle | PASS (observational) | [B5-C](B5-C/README.md) 810 native GPU-timestamp samples (M2.6 before/current/M2.6 return), plus three lifecycle Viewers. Against pooled baseline candidate mean **+10.24%**, p95 **+24.77%**; user accepted the disclosed increase. All 312 lifecycle GPU buffers/textures were released once; no growing live count. |

All phase-level acceptance decisions above are grounded in prior recorded user confirmations. This reconciliation introduces **no new screenshots, GPU run, user approval or independent visual audit**. Original capture-time AWAITING_REVIEW fields remain historical and are superseded only by separate user-acceptance records.

## Remaining release gates and limits

- **NOT RUN — complete upstream WebGL differential for final M2.6.1 runtime.** `docs/CI.md` requires separate authorization. A source-file audit from M2.6 baseline `cf2c1d1` to merged M2.6.1 `1462876` lists 21 changed engine/widgets source paths, each containing `WebGPU` in its path, and no other source paths in those directories. This narrows code-path risk but **does not** replace a complete differential or prove no WebGL behavior regression.
- M2.6 A07–A10 remain accepted at their original gate; B5's new scoped checks support preservation but do not constitute a fresh complete A07–A10 rerun. M1-NAV-001 and previously disclosed image/terrain limitations remain.
- Native accounting is limited to instrumented buffers/textures. Physical resident VRAM, multiple GPU vendors, long-duration soak and live terrain streaming are not certified. B5-A's thin A02 limb and A05 haze remain user-accepted limitations.
- Final milestone closeout should be recorded **only after** the separately authorized WebGL gate and an integration-owner review of that result. This document is a documentation-only reconciliation and must not be cited as new hardware verification.

Next stop: resolve or explicitly scope the remaining WebGL differential gate, then close M2.6.1. Do not start optional M2.7/M2.8, M3 or unrelated renderer work here.
