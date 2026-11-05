# M2.6.1 — integrated acceptance evidence index (2026-11-05)

**Decision: B1–B5 and SVP-01–SVP-10 were accepted by phase; the separately authorized complete physical-GPU WebGL differential subsequently PASSED on merged runtime `b5422e5` (2026-11-05).** [Final WebGL evidence](final-webgl/README.md) records 3 identical inherited failures, 0 new failures and the unchanged strict comparator. Hosted Fast/Full are non-rendering and are not substituted for this gate.

## Integration and tested identity

- PRs [#21](https://github.com/pp123pp/cesium-webgpu-globe/pull/21), [#22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22), [#23](https://github.com/pp123pp/cesium-webgpu-globe/pull/23), [#25](https://github.com/pp123pp/cesium-webgpu-globe/pull/25), [#27](https://github.com/pp123pp/cesium-webgpu-globe/pull/27) and [#28](https://github.com/pp123pp/cesium-webgpu-globe/pull/28) are merged. PR #28 tested head: `96820edb62a7c27ef679914d3a2ef257239cbdb1`; main merge commit: `1462876b3f6428e3fe5da5a054d01bcc6767d66b`.
- B5-B/B5-C physical GPU source: `8e7c53c09f3b0e2ae6b38ab4593d818282b979a4`, with production bundle SHA-256 `410f39366223a6a611e2072945c39d682507b2b152e2105a964325887cab9980`. PR #28 adds harnesses, accepted evidence and documentation without changing engine runtime.
- Local capture: Intel Xe-LPG non-fallback WebGPU, headed Chrome 156.0.8078.80, Windows. Captures are real GPU output, not hosted SwiftShader. See the phase reports for camera/time, exposure, source hashes and per-run exceptions.
- PR #28 exact-head [Fast CI](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319742) PASS and actually executed [Full regression](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41846319604) PASS. Both are now non-rendering tiers. A separate full WebGL differential was subsequently executed on the merged runtime `b5422e5` and PASSED; see [the independent final gate](final-webgl/README.md).

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

All phase-level acceptance decisions above are grounded in prior recorded user confirmations. The earlier PR #29 reconciliation did not perform a rendering run; the separately authorized final WebGL differential is now [independently archived](final-webgl/README.md). No new SVP visual capture or user approval is claimed. Original capture-time AWAITING_REVIEW fields remain historical and are superseded only by separate user-acceptance records.

## Final WebGL gate and retained limitations

- **PASS — complete upstream WebGL differential for final M2.6.1 runtime.** After explicit authorization, the original comparator on actual Intel Arc hardware compared clean baseline `724b5db` and merged `main` `b5422e5` at the same 9876 loopback port. Each executed 3,822 WebGL specs; 3 failures have exactly matching identities and signatures; **0 new failures and 0 tolerated signature drift**. See [raw reports and integrity manifest](final-webgl/README.md). The earlier WebGPU-only source-path audit was preliminary and was not used in place of this test.
- M2.6 A07–A10 remain accepted at their original gate; B5's new scoped checks support preservation but do not constitute a fresh complete A07–A10 rerun. M1-NAV-001 and previously disclosed image/terrain limitations remain.
- Native accounting is limited to instrumented buffers/textures. Physical resident VRAM, multiple GPU vendors, long-duration soak and live terrain streaming are not certified. B5-A's thin A02 limb and A05 haze remain user-accepted limitations.
- All specified M2.6.1 technical gates now have accepted evidence. This source is updated with a separate, actual hardware verification (not merely the older document reconciliation). Final evidence-publication PR review/merge remains an integration action, not a rendering test.

Next stop: review and integrate the final evidence publication; M2.6.1 technical acceptance is complete on the tested runtime. Do not start optional M2.7/M2.8, M3 or unrelated renderer work here.
