# M2.8-B optical footprint compaction

The user requested a smaller bright core and short rays, about 60% of the previous width, and a smaller warm shoulder/spread, about 70%. The existing spectral arc and reflection layer stay fixed. These are original native canvas captures on a physical GPU. **This is the intermediate fixed-size runtime, before the subsequent request for an adjustable diffusion size. It is not final delivery or user visual acceptance; do not merge main or start C/M2.7/M3.**

| Same camera, exposure 1 | Before | After |
| --- | --- | --- |
| 1000x227 | [Original](baseline/hero-1000x227-e1-on.png) | [Compacted](reference/hero-1000x227-e1-on.png) |
| 1920x1080 | [Original](baseline/hero-1920x1080-e1-on.png) | [Compacted](reference/hero-1920x1080-e1-on.png) |
| Diffusion alone | [Original](baseline/hero-layer-diffusion-1920x1080.png) | [Compacted](reference/hero-layer-diffusion-1920x1080.png) |
| Reflection and spectral arc alone | [Original](baseline/hero-layer-reflection-1920x1080.png) | [Unchanged](reference/hero-layer-reflection-1920x1080.png) |
| Lens disabled | [Original](baseline/hero-1920x1080-e1-off.png) | [Exact match](reference/hero-1920x1080-e1-off.png) |

The core stays bright while the surrounding space becomes darker. The unchanged spectral arc looks more apparent after the warm veil shrinks; its isolated output remains byte-identical. No retouching, image rescaling, exposure adjustment or reference-image assets enter these renders. Final appearance remains the user's decision.

## Fixed rendered measurements

Measurements use the actual production diffusion layer with reflection set to zero, so the preserved arc cannot contaminate the result. They are output-space footprints at exposure 1, including the unchanged physical Sun, tone mapping and pixel quantization; they are approximate visual widths, not radiometric radii or isolated measurements of every individual beam.

- Core width: square root of the number of native pixels whose three channels are >=250 in a source-centered box extending 8% of image width each way.
- Short-ray bright extent: outermost sample with all channels >=240 on a horizontal profile pointing left from the source, averaging five pixels vertically. This measures the combined bright core/ray footprint, rather than each separate authored ray.
- Warm shoulder/spread: outermost profile samples with mean RGB increase of >=80 / >=20 bytes over the same scene with flare disabled. The direction samples clear sky and avoids the Earth on the right.
- Bounds fixed before the candidate shader: core/short-ray ratio 0.5–0.7 and warm shoulder/spread ratio 0.6–0.8. Both views must retain a saturated white peak. The old far-shoulder >=40-byte minimum is superseded by these explicit compaction bounds; its diagnostic is still recorded.

| Metric | 1000x227 candidate / old | 1920x1080 candidate / old |
| --- | --- | --- |
| Core equivalent width | 61.50% | 61.56% |
| Short-ray bright radius | 27 / 41 px = 65.85% | 53 / 80 px = 66.25% |
| Warm shoulder radius | 139 / 198 px = 70.20% | 267 / 382 px = 69.90% |
| Warm spread radius | 186 / 266 px = 69.92% | 358 / 512 px = 69.92% |
| Core peak RGB | 255, 255, 255 | 255, 255, 255 |

The [old-shader self-comparison](red-self-comparison/error.json) fails the new core assertion with ratio 1 and exit code 1; all four ratios equal 1 in both views. Its [original output](red-self-comparison/output.log) is retained. The [candidate report](reference/result.json) passes the same fixed bounds. Reproduce with `M2_LENS_COMPACTION_BASELINE=coordination/evidence/M2.8/compaction/baseline/result.json` and a fresh `M1_OUTPUT` directory when running `coordination/ci/m2-lens-flare-reference.mjs` against this candidate bundle.

## Provenance and verification

- Base commit: `7d5ac6f677f7e72fc041f4eb89a93fe9bd3f4979`. These are **dirty working-tree captures**, not a newly verified clean final HEAD. Each report preserves its actual `sourceStatus`, source hashes, harness hash, adapter and native PNG hashes. The unrelated concurrent `package.json` edit was present before baseline capture and is outside this change's ownership.
- Old runtime was captured before shader edits. Baseline bundle SHA-256: `0ee9a02b3c4527665de697917dbd26558a24d12812e46d2405006c420f792853`. Candidate bundle SHA-256: `2231df4afd232396ca4ad3d28c2c3c17ab90c4822603339286553349836f8dd4`. The candidate was built once; the fixture asserts source/bundle shader identity and local/served bundle identity. Baseline and candidate runtime hashes differ only for `WebGPULensFlareShader.js` among the recorded atmosphere/Sun/bloom/planet files.
- Headed Chrome `156.0.8078.80`; physical Intel Xe-LPG, `isFallbackAdapter=false`. Physical WebGL reports Intel Arc 130T / D3D11. No SwiftShader or software fallback.
- [Integrity audit](integrity-audit.json), run by [the focused offline audit](../../../ci/m2-lens-flare-compaction-audit.mjs), passed at the recorded intermediate runtime. Its current-source identity checks intentionally require that runtime and do not certify later parameter changes. It verifies all **399 PNG hashes**: old reference 26; candidate reference 26; visual 98 stills +120 motion frames; limb 6 controls +120 frames; WebGL 3. Historical evidence directories were preserved.
- Baseline/candidate camera, time, exposure, viewport, solar effects, bloom strength, terrain, physical Sun, atmosphere and lens settings match for every reference capture. Twelve disabled frames and the isolated spectral arc/reflection frame are exact old/new matches. Another **42 disabled views** match the independently built historical main baseline, with matching scene state and verified original hashes.
- [Reference](reference/result.json): both aspect ratios, exposure 0.5/1/2, centered/off-axis/sunrise views, isolated layers, peak brightness and spatial compaction pass. All restored-off and hidden-receiver residuals are zero.
- [Existing visual smoke](visual/result.json): resolution/exposure/resize, Earth/native-mesh source and receiver occultation, zero irradiance, independent layers and 120 consecutive camera/time frames pass. [Limb motion](limb/result.json) saves another 120 consecutive frames across clear/partial/fully hidden Earth and explicit off/on controls. All hidden-source residuals are zero; mesh removal restores optics. The scripts retain their original assertions and resource cleanup checks.
- [Physical WebGL smoke](webgl/webgl-smoke.json): all three existing fixtures pass their original tolerances. This is scoped smoke coverage, not a complete WebGL regression rerun.
- [Build](build.log), [11 focused tests](focused.txt), [scoped lint](lint.txt), [shader formatting](format.txt), and [final verification-script lint](verification-lint.txt) pass. No broad suite, manual Full, GPU timing or dedicated lifecycle rerun was required for the spatial-only constants change. Existing historical timing/lifecycle results are not new measurements of this shader.

Fixture limits: deterministic bounded ellipsoid and Gaussian native terrain meshes, no external provider; one integrated GPU; 8-bit displayed output; fixed e1 hero footprint thresholds. Capturing each of the two 120-frame sequences is paced by PNG encoding and does not establish real-time FPS, cross-device quality or resident VRAM.
