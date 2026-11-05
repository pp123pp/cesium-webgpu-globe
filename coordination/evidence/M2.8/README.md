# M2.8 A/B — hardware evidence and visual review

**User visual acceptance PASSED on 2026-11-05. [Acceptance and delivery record](ACCEPTANCE.md) identifies accepted runtime `27e8cef` and the user's authorization to publish/update [PR #31](https://github.com/pp123pp/cesium-webgpu-globe/pull/31), wait for latest CI and merge into main. No C/M2.7/M3 or manual Full. Original capture-time reports and manifests remain unchanged.**

**Latest implementation: [adjustable diffusion and linked outer halo](diffusion-size/README.md). User follow-ups add the live size parameter/slider and proportional spectral-arc scaling, with fixed core/rays and independent reflection glints. Final native samples and Demo input checks are recorded separately from the intermediate matrix. The acceptance record above supersedes pending/no-merge wording in the historical records below.**

**Intermediate: [compact cinematic revision](compaction/README.md). The user approved a lens-only core/diffusion contraction while retaining peaks and the original arc/reflections. Native before/after captures, two motion sequences and scoped WebGL checks remain traceable; the final default output is equivalent. Earlier evidence below remains unchanged.**

**The user rejected the restrained first treatment below. The [preceding reference-directed revision](revision/README.md) retains its original screenshots, verification and performance. Its core/diffusion footprint is superseded by the compact revision above. Stop at B; do not merge main.**

Everything below is the historical first-treatment record; it is retained for traceability and is not the current visual acceptance conclusion.

Architecture: [M2.8 review](../../../docs/M2.8_LENS_FLARE.md). Execution scope: [task](../../../tasks/M2.8.md).

## Source and environment

- Base: latest main `f107e9cc7c867db37ff9f619899e5fe778542c9c` (PR #30). Official upstream tag rechecked 2026-11-05: `1.146` tag object `b90bf5fa30c8f573072181165c9462d987e26580`, peeled commit `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`; package 1.146.0.
- A documentation commit `7f1c24b`; tested B runtime `85017f04770d3f0826729253982204680a3e18a2`; lifecycle harness correction `ada51d51bbca77953d6ca4378a929e3a34a545fa` changes no runtime. Later evidence/audit/docs commits reuse these identified inputs; they are not fresh rendering of a different runtime.
- Production bundle SHA-256 `b27c35918414a341e12d09ea20507d7522c280d8765c3c03684fe66d6df250da`. Reports include file hashes, served-shader equality and original capture metadata. Static/temporal capture at clean `85017f0`; lifecycle at clean `ada51d5`.
- Windows, headed Chrome `156.0.8078.80`, physical Intel Xe-LPG WebGPU; WebGL reports Intel Arc 130T / D3D11. No SwiftShader. This is integrated-GPU evidence, not discrete-GPU qualification or resident-VRAM measurement.
- Bounded native ellipsoid terrain (level 8), no imagery/network provider; occultation uses actual Gaussian heightmap terrain meshes. This tests real production terrain depth, not a real-world terrain dataset or broad streaming/LOD matrix.

## Visual evidence

[Original report](visual/result.json) contains 98 still PNGs and 120 contiguous motion PNGs, 48 off/on pairs, layer controls, three exposures and both resolutions. Capture exports pixels and PNG in the same browser task. All images are original canvas captures, without retouching.

| View | Disabled | Enabled |
| --- | --- | --- |
| High orbit centered | [off](visual/high-front-1920-e1-off.png) | [on](visual/high-front-1920-e1-on.png) |
| High orbit off-axis | [off](visual/high-offaxis-1920-e1-off.png) | [on](visual/high-offaxis-1920-e1-on.png) |
| Orbital sunrise | [off](visual/orbit-sunrise-1920-e1-off.png) | [on](visual/orbit-sunrise-1920-e1-on.png) |
| Partial Earth occultation | [off](visual/earth-partial-1920-e1-off.png) | [on](visual/earth-partial-1920-e1-on.png) |
| Low orbit | [off](visual/low-orbit-1920-e1-off.png) | [on](visual/low-orbit-1920-e1-on.png) |
| Near horizon, 2 km | [off](visual/near-horizon-1920-e1-off.png) | [on](visual/near-horizon-1920-e1-on.png) |
| Ground horizon, 2 m | [off](visual/ground-horizon-1920-e1-off.png) | [on](visual/ground-horizon-1920-e1-on.png) |
| Native mesh fully hides Sun | [off](visual/mesh-hidden-1280-off.png) | [on](visual/mesh-hidden-1280-on.png) |
| Same mesh removed | [off](visual/mesh-removed-1280-off.png) | [on](visual/mesh-removed-1280-on.png) |

Also inspect [diffusion only](visual/layer-diffusion-1920.png), [reflection only](visual/layer-reflection-1920.png), exposure [0.5](visual/high-offaxis-1920-e0.5-on.png) / [2.0](visual/high-offaxis-1920-e2-on.png), and motion [start](visual/motion-120/frame-0000.png) / [middle](visual/motion-120/frame-0060.png) / [end](visual/motion-120/frame-0119.png).

Independent source/visual review inspected official Unity HDRP space-Sun and screen-space reference images linked in the architecture document. Their white-core/soft-shoulder/faint-off-axis hierarchy informed the original shader; no Unity source/assets were copied. Our B deliberately excludes their large chromatic rings, ghost chains and streaks. Final review found a coherent warm shoulder, subtle cool reflection, legible solar core, no new hard ring/texture boundary or full-frame veil. Final centered corners have zero delta. Partial Earth and both full-occlusion controls pass; hidden receivers have zero delta. All 120 frames (480–599) advance camera/time consecutively from 12:00:01 to 12:02:00 without recorded errors.

The effect is deliberately weak in highly attenuated sunrise/ground views (partial maximum delta 2 bytes, ground 3, mesh-restored 1). Inherited near-ground haze and low contrast remain; Lens Flare does not repair the accepted atmosphere calibration. Screenshot review supports submitting this restrained optical treatment for user review, not blanket HDRP parity or user acceptance. Motion captures are capture-paced, not a real-time FPS measurement.

## Default-off baseline and WebGL

[Independent baseline report](baseline/result.json): separately installed/built main `f107e9c`, 42 exact camera/time/exposure/resolution pairs match preliminary candidate-off PNG bytes. [Offline audit](audit.json) also matches every final candidate-off PNG to that baseline, establishing transitivity without rerendering an unchanged disabled path. Same-candidate restored-off comparisons are independently exact after toggling.

[WebGL smoke](webgl/webgl-smoke.json): orbit, oblique and resize pass original visual tolerances on physical GPU; no browser errors/warnings. Tiny inherited adapter-dependent edge differences are retained (102/79/45 changed pixels), not called pixel-identical. No new complete WebGL differential was run: runtime edits are confined to WebGPU and the completed M2.6.1 full differential remains historical evidence, not a new HEAD result.

## GPU timing and resource lifecycle

[Timestamp report](timing/result.json), alternating 60 samples per mode in each batch, all enabled solar effects and matched exposure/camera:

| Resolution | Off mean / p95 ms | On mean / p95 ms | Mean increment | p95 difference |
| --- | --- | --- | --- | --- |
| 1920x1080 | 8.319 / 11.796 | 8.445 / 10.617 | +0.127 ms | -1.180 ms |
| 1280x720 | 4.060 / 5.964 | 4.226 / 6.619 | +0.166 ms | +0.655 ms |
| Resize back 1920x1080 | 7.732 / 9.699 | 7.913 / 10.486 | +0.181 ms | +0.786 ms |

These are summed render-pass GPU timestamps, not CPU time or complete frame latency. Negative p95 difference indicates distribution noise, not an optimization benefit. All final batches meet the original +0.5 ms mean / +1 ms p95 budget. Cost comparison is candidate on versus its baseline-equivalent off path, not a separately timed independent baseline executable. The independent baseline establishes visual identity only.

One additional measurement pass and one 1x1 rgba16float record (8 logical bytes), one 16-byte uniform; no new asset download, full-size texture, Bloom chain or temporal history. These allocate on first enable and remain reusable until renderer destruction. No steady-state native allocations during timing. All 442 timing-scene resources destroyed exactly once, zero retained bytes; resident VRAM unavailable.

[Lifecycle report](lifecycle/result.json): resize, corrupt optional solar asset fallback, actual device destruction/loss callback, explicit recreation and injected lens pipeline rejection all pass. 99 native resources across five cases are released once; zero retained growth. Sky-only lifecycle fixture disables terrain before initialization and asserts zero terrain draws; terrain occlusion is tested separately in the visual matrix.

## Failed attempts and fixes

- [First visual report](earlier-attempts/visual-round1.json) and [defect screenshot](earlier-attempts/centered-veiling-defect.png): centered normalized optical axis degenerated, creating a uniform veil. Replaced with continuous radial pupil offset and added zero-corner-delta assertion. Final full matrix recaptured after correction.
- [Timing round 1](earlier-attempts/timing-round1.json): resize-back p95 increment 1.114 ms failed. Unchanged atmosphere p95 accounted for 0.983 ms; new source pass p95 0.197 ms. [Round 2](earlier-attempts/timing-round2.json): corrected sampling but concurrent dependency/type work; mean increment 0.653 ms failed. Final shader simplifies redundant source tests and uses continuous pupil coordinates; final measurement ran without concurrent builds/installations. No thresholds weakened; failed measurements remain evidence of variability.
- [First lifecycle failure](earlier-attempts/lifecycle-unsettled-terrain.json): asynchronous native terrain uploaded four buffers (22,200 bytes) during the stability window. Corrected the fixture's sky-only setup before initialization; strict unchanged-allocation assertion retained.
- Local `build-ts` initially failed because the unchanged upstream parser splits on LF-only blank lines while its reviewed input was CRLF. Normalized only local input line endings, regenerated successfully, restored original line endings; no tracked build-system change or hand-edited generated declaration. [Successful type log](types.log).

## Engineering and delivery

[Focused tests](focused-tests.log): 11/11 pass. Scoped ESLint, pre-commit TypeScript checks, `npm run build`, `npm run build-ts`, Sandcastle declaration compilation and `npm run tsc` pass. Audit verifies evidence integrity and applicable source hashes. Hosted Fast/Full execution is tracked on the PR; no manual Full dispatch or label manipulation.

Demo: `Apps/WebGPUGlobe.html` → Lens optics. Default off; strength 0–4, diffusion/reflection isolation. No change to physical Sun direction/radius/irradiance, atmosphere coefficients, original solar assets, WebGL rendering or the single exposure/ACES/sRGB path.

Next action: user reviews these original off/on images and the PR. No M2.8-C, M2.7, M3 or merge is authorized by this handoff.

Publication: [Draft PR #31](https://github.com/pp123pp/cesium-webgpu-globe/pull/31). [Fast 41943899573](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41943899573) and [executed Full 41943899662](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41943899662) passed on source/evidence head 655b4ca; [job-level record](ci-status.json). Later log/checklist publication changes no runtime, tests or configuration and does not imply new hardware capture. User visual acceptance remains pending.
