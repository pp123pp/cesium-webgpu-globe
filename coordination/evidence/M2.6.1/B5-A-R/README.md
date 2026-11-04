# M2.6.1-B5-A-R — Static Visual Remediation

**Status:** implementation and static recapture complete; awaiting the user's second-round visual review. This is not a B5-A visual PASS and does not close M2.6.1.

## Baseline and candidate

- Baseline audit: [PR #26](https://github.com/pp123pp/cesium-webgpu-globe/pull/26), head `a1a2d680268672f12f7320dac360f2769d751e80`; its original screenshots and FAIL/BLOCKED results remain unchanged.
- Candidate runtime and capture source: `8bb21de89ce1c42a4e2c43d029771df18c0eab5a`.
- Bundle: `Build/CesiumUnminified/Cesium.js`, SHA-256 `5c584fd85a551ba47483e4770faf79eefb1dd095b85405f2798d65bd4901c3d7`.
- Environment: headed Chrome 156.0.8078.80; Intel Xe-LPG non-fallback WebGPU; 1920×1080; exposure 1; CesiumJS 1.146.0.
- Eight authored solar assets plus the full nine-record solar asset set: **9/9 LOADED**.
- 58 diagnostic PNGs captured; all 58 hashes match `capture-result.json`; SHA256SUMS manifest verified. No browser/page errors.

## Changes

1. Rays: rebalance the three authored masks toward irregular fine detail (0.15 / 0.65 / 0.20), reduce ray energy from 2.5 to 0.75 and shorten the outer fade.
2. Solar artwork: lower the minimum view-path transmission from 0.58 to 0.28 and begin attenuation earlier on optically thick paths. The analytic solar disk remains on its existing physical path.
3. Atmosphere display balance: apply a scene-linear, long-path desaturation / attenuation to the transmitted scene plus in-scattered radiance in both atmosphere output paths. Physical scattering coefficients, transmittance, direct solar energy, depth, Earth/terrain intersection, Bloom order and the single ACES/sRGB output remain intact.

## Second-round static observations

| Scene | Candidate observation |
| --- | --- |
| A01 high-orbit Sun | Rays are softer, shorter and lower-energy; residual radial structure remains for user review. |
| A02 Earth limb | Long-path color is reduced; a thin residual atmospheric limb remains visible. The atmosphere-off control removes it, confirming the atmosphere composite as its source. |
| A03 orbital sunrise | Horizon warmth is less dominant; a narrow warm band remains. |
| A04 low-orbit low Sun | Recaptured with the original geometry; residual low-Sun warmth remains under review. |
| A05 near-ground low Sun | Atmospheric veil is restrained; no claim of visual PASS. |
| A06 ground daytime | Retained as a control; no obvious regression observed in the reviewed capture. |
| A07 ground twilight | Yellow cast is reduced toward a softer warm-neutral transition; residual warmth remains for review. |
| A08 ground night | **BLOCKED / unresolved.** The unlit constant-color night-side terrain remains too bright; this is a surface-lighting limitation, not a solar-artwork defect. It was not hidden by changing exposure or disabling Sun effects. |

Primary candidate captures: [A01](captures/a01-all.png), [A02](captures/a02-all.png), [A03](captures/a03-all.png), [A04](captures/a04-all.png), [A05](captures/a05-all.png), [A06](captures/a06-all.png), [A07](captures/a07-all.png), [A08](captures/a08-all.png).

Diagnostic controls include [A02 atmosphere off](captures/a02-atmosphere-off.png), [A02 physical only / no Bloom](captures/a02-physical-no-bloom.png), [A02 corona disabled](captures/a02-effect-off-corona.png), [A03 physical only / no Bloom](captures/a03-physical-no-bloom.png), [A07 physical only / no Bloom](captures/a07-physical-no-bloom.png), and [A08 physical only / no Bloom](captures/a08-physical-no-bloom.png). All remaining controls and the full capture metadata are retained in this directory.

For same-state before/after comparison, use the original A01–A08 images in [PR #26's B5-A evidence](https://github.com/pp123pp/cesium-webgpu-globe/tree/feat/m2-6-1-b5-a-static-audit/coordination/evidence/M2.6.1/B5/A); no baseline image or result was overwritten.

## Verification

- `npm run build`: PASS on candidate source.
- Focused Node tests: **5/5 PASS** (two existing B1 solar checks plus three B5-A-R shader invariants).
- M2.2 production atmosphere browser smoke: **PASS** after updating its independent CPU composite oracle to reproduce the new long-path balance; the original ±3 display-channel tolerance and all physical/depth/occlusion assertions remain unchanged.
- Targeted ESLint on both modified shaders and B5-A-R scripts: PASS.
- Capture harness: PASS; all 58 PNG hashes and per-scene error lists verified.
- Cleanup: viewer destroyed; 6,850/6,850 buffers released; zero pending imagery requests; zero canvases retained.
- `git diff --check`: PASS.
- Full regression, WebGL differential, 120-frame temporal acceptance, B5-C GPU timing / resident-VRAM and lifecycle acceptance were not run.

The capture harness PASS is a technical capture-integrity result, **not** a visual acceptance result. Stop here for the user's second-round visual review. Do not start B5-B/B5-C, merge PR #26, merge this remediation, or claim M2.6.1 complete.
