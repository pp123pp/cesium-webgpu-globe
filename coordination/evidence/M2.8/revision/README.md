# M2.8-B reference-directed visual revision

The user rejected the first restrained treatment. This revision replaces that art direction with a bright irregular optical core, gold shoulder, broad peach diffusion, soft spectral arc and overlapping olive/yellow reflections. **Ready for user visual review, not user-approved. Stop at B; do not merge main.**

## Look at the actual output

All local images below are original physical-GPU canvas captures, without retouching. The reference is an external Unity documentation image, not a runtime asset.

| Comparison | Image |
| --- | --- |
| Official visual target | [Unity HDRP space Sun](https://media.githubusercontent.com/media/Unity-Technologies/Graphics/master/Packages/com.unity.render-pipelines.high-definition/Documentation~/Images/LensFlareSamples2.png) |
| Matching 1000x227 framing, disabled | [Original Sun](reference/hero-1000x227-e1-off.png) |
| Matching 1000x227 framing, enabled | [Revised optics](reference/hero-1000x227-e1-on.png) |
| 1920x1080, disabled / enabled | [Off](reference/hero-1920x1080-e1-off.png) / [on](reference/hero-1920x1080-e1-on.png) |
| Exposure 0.5 / 2 | [0.5](reference/hero-1920x1080-e0.5-on.png) / [2](reference/hero-1920x1080-e2-on.png) |
| Isolated optical layers | [Diffusion](reference/hero-layer-diffusion-1920x1080.png) / [reflection](reference/hero-layer-reflection-1920x1080.png) |
| Earth partial occultation | [Off](visual/earth-partial-1280-e1-off.png) / [on](visual/earth-partial-1280-e1-on.png) |
| Near horizon | [Off](visual/near-horizon-1280-e1-off.png) / [on](visual/near-horizon-1280-e1-on.png) |
| Real terrain mesh hides source / removed | [Hidden](visual/mesh-hidden-1280-on.png) / [removed](visual/mesh-removed-1280-on.png) |
| Continuous limb traversal | [Clear](limb/limb-120/frame-0000.png) / [partial](limb/limb-120/frame-0060.png) / [hidden](limb/limb-120/frame-0119.png) |

Independent review inspected the actual reference and iterative native screenshots. Excessively saturated rings and long needle-like rays were corrected before this submission. The final reference-sized capture reproduces the intended optical hierarchy and placement. Remaining visual differences: our near-core shoulder is creamier, the wide veil is more uniform, and sparse incidental glints in the reference are not reproduced. The reference's stylized planet, rings and surface lighting are not Lens Flare requirements; the actual WGS84 Earth and accepted atmosphere remain intact. At low exposure the irregular short core points are more apparent. Near-ground haze is inherited. These differences are disclosed for the user's judgment, not described as pixel parity.

The source projects at (0.31W, 0.35H) in the reference view. A native 5x5 patch 0.45 viewport heights to its right gains 192.47 mean RGB bytes at exposure 1; the central 13x13 patch is white. These lower bounds reject the earlier weak appearance but do not establish aesthetic acceptance.

## Provenance and functional gates

- Runtime commit: `cf0ec5d195f69506df1f9963bf9104090e77d5ed`. Clean reference, visual and limb captures use this commit. Clean timing/lifecycle/WebGL captures use harness-only `022c65a6a8f444b0fa8164decfb8981f320d7dfb`. The audit verifies identical engine/core/widgets runtime trees, current source hashes and one bundle SHA-256: `a184cd4d469a40d2474c64a6a443fcba9cd5eb3d1e2aaa4c734d725b41e9c2c9`.
- Headed Chrome 156.0.8078.80, physical Intel Xe-LPG; WebGL reports Intel Arc 130T / D3D11. No SwiftShader. This is integrated-GPU evidence, not discrete-GPU or resident-VRAM qualification.
- [Integrity audit](integrity-audit.json): 376 native PNGs, all hashes verified. [Reference](reference/result.json): 26 images. [Visual matrix](visual/result.json): 98 stills plus 120 consecutive camera/time frames. [Limb traversal](limb/result.json): another 120 consecutive frames plus explicit clear/partial/hidden pairs. Both 120-frame sequences save every rendered frame; capture pacing is not a real-time FPS claim.
- Existing 42 independently built M2.6.1 baseline views are reused only after verifying exact camera/time/exposure/terrain state and byte-identical fresh disabled PNGs. All paired restored-off and hidden-receiver deltas are zero. Full Earth, native mesh occlusion and zero irradiance leave zero flare difference; removing the mesh restores optics.
- The terrain test uses actual bounded Gaussian heightmap meshes and production depth, not a real-world terrain dataset or a streaming/LOD qualification.
- The 26 reference PNGs are byte-identical before and after performance optimization. Source visibility retains 128 disk samples. Default-off final output, physical Sun direction/angular radius/irradiance, single exposure/ACES/sRGB and accepted atmospheric coefficients are preserved.

## GPU cost and resources

[Raw timing](timing/result.json) records 600 alternating samples per mode and resolution after 60 warmup pairs. Numbers below are GPU timestamp render-pass sums, not CPU frame time. Budgets remain mean increment <=0.5 ms and p95 increment <=1 ms.

| Resolution | Off mean / p95 ms | On mean / p95 ms | Increment mean / p95 ms |
| --- | --- | --- | --- |
| 1920x1080 | 7.820 / 10.682 | 8.065 / 11.076 | +0.245 / +0.393 |
| 1280x720 | 3.772 / 4.588 | 4.038 / 4.915 | +0.266 / +0.328 |
| Resize back to 1920x1080 | 7.771 / 9.830 | 8.001 / 10.289 | +0.230 / +0.459 |

This compares the same candidate with flare off/on; it is not a separately rebuilt M2.6.1 performance differential. The disabled-image baseline is independently rebuilt. Earlier failed budgets remain in [revision attempts](../revision-attempts/README.md). Optimizations bound near-source texture work, share receiver visibility and skip zero-support reflections. No budget or functional assertion was relaxed. Small-sample p95 imbalance involved unchanged atmospheric work; final larger-sample evidence passes but cannot promise the same timings on other devices or under different GPU contention.

The revision reuses two existing original R8 ray masks. It adds no resource beyond initial B's one 1x1 RGBA16F texture (8 logical bytes) and 16-byte uniform. No steady-state allocation growth. Native allocations destroyed exactly once: reference 444, visual 1813, limb 551, timing 442 and lifecycle 99. [Lifecycle](lifecycle/result.json) covers initialization, resize, corrupt optional assets, real device destruction/loss callback, explicit recreation and pipeline initialization rejection; zero retained resources.

## Engineering and delivery

[11 focused tests](focused-tests.txt) pass at the final runtime. Scoped ESLint/Prettier, production build and pre-commit engine TypeScript checks pass. [Physical WebGL smoke](webgl/webgl-smoke.json) passes its original three fixtures/tolerances against baseline `724b5db`; the complete previously accepted M2.6.1 differential was not needlessly repeated. No shared WebGL runtime was changed. Hosted Fast/Full results are separate from hardware evidence and belong to PR #31; no manual Full dispatch.

Architecture: [M2.8 review](../../../../docs/M2.8_LENS_FLARE.md). [PR #31](https://github.com/pp123pp/cesium-webgpu-globe/pull/31) remains draft pending visual acceptance. Do not merge or start C/M2.7/M3.
