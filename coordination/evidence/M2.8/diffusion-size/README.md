# M2.8 adjustable warm diffusion and linked outer halo

The final parameter is `viewer.scene._atmosphere.lensFlare.diffusionSize`, default **0.7**, valid **0.1–2**. It changes the warm shoulder/spread and outer spectral arc together. The compact bright core/short rays and reflection ghosts retain their own sizes. The Demo's **Diffusion size** slider updates this production parameter directly. **Ready for user review; no user visual acceptance or main merge is claimed.**

| Native 1920x1080, same hero camera and exposure 1 | Image |
| --- | --- |
| Default 0.7, combined | [Default](reference/hero-1920x1080-e1-on.png) |
| Size 0.3, combined | [Smaller warm diffusion and linked halo](reference/diffusion-size-0.3-combined.png) |
| Size 0.3, warm layer alone | [Warm layer](reference/diffusion-size-0.3-1920x1080.png) |
| Size 0.3, outer arc and ghosts alone | [Linked arc](reference/diffusion-size-0.3-reflection.png) |
| Size 0.1 / 1 / 2, warm layer | [0.1](reference/diffusion-size-0.1-1920x1080.png) / [1](reference/diffusion-size-1-1920x1080.png) / [2](reference/diffusion-size-2-1920x1080.png) |

All images are original physical-GPU canvas output. The [preceding fixed-size compaction](../compaction/README.md) remains an intermediate historical archive. The later request to link the spectral arc to the size parameter supersedes its unchanged-arc requirement at nondefault sizes. Default 0.7 still exactly preserves that archive's appearance.

## Actual rendered checks

[The final reference report](reference/result.json) passes on headed Chrome `156.0.8078.80`, physical Intel Xe-LPG, nonfallback adapter. No SwiftShader. These are dirty working-tree captures based on `7d5ac6f677f7e72fc041f4eb89a93fe9bd3f4979`; exact source status, runtime/harness hashes and original PNG hashes are in the report. The unrelated concurrent `package.json` edit is recorded, not included in this change's ownership.

Final bundle SHA-256: `c8ae61d356b30fb1d70a8b63d6833ba95d1ee6ad88bb791e41653d9e0d8523ef`. The final build followed the concrete fixed-ray support correction and linked-arc change; subsequent reruns changed only verification, without rebuilding or changing runtime.

- **26 default captures are byte-identical** to the intermediate compact runtime, including both aspect ratios, exposures 0.5/1/2, centered/off-axis/sunrise, lens disabled and isolated layers. Camera, time, exposure, viewport, solar effects, bloom strength, terrain, Sun and atmosphere snapshots match. The earlier 0.6/0.7 compact-footprint ratio checks still pass.
- Size 0.1/0.3/0.4/0.7/1/2 changes the actual production warm footprint monotonically, while every size retains core peak RGB 255/255/255. Every size produces exact disabled output. At the two endpoint sizes, a fully Earth-hidden Sun leaves zero lens difference; hidden receivers and restored-off output have zero residual.
- An actual-output boundary test caught the first parameter implementation truncating the fixed short-ray tail at size 0.1. The [retained RED report](attempts/ray-support/error.json) measures zero on-minus-off bytes in the 83–109px source annulus. The final shader applies adjustable support to the warm layers alone and retains **10 bytes** of short-ray output there. [Original failed PNG](attempts/ray-support/diffusion-size-0.1-1920x1080.png) and [failure log](attempts/ray-support/output.log) are preserved.
- Arc radius is measured from the reflection-only production image along a down-left diagonal, clear of the orange ghost and lower-right ghost cluster. The radius averages samples within 95% of the profile's maximum RGB increase. Size 0.3/default radius ratio is **194 / 451.47 = 0.4297**, matching requested 0.3/0.7 = 0.4286; size 1/default is **646 / 451.47 = 1.4309**, matching 1/0.7 = 1.4286, within the fixed 10% tolerance. The prior parameter runtime's saved size-1 reflection PNG is exactly the fixed-size default PNG, so it fails this new linked-radius requirement; this negative control is recorded in the audit.
- Ghost expressions remain unchanged. A native 7x7 orange-ghost patch around (332,261) is pixel-exact at sizes 0.1/1/2, where the moving arc does not overlap it. At size 0.4 the moving arc crosses this patch, so the displayed composite legitimately changes; the verifier does not demand false whole-image equality of the reflection-plus-arc layer.

| Size | Warm shoulder radius, >=80 mean RGB-byte increase | Warm spread radius, >=20 | Outer arc radius |
| --- | --- | --- | --- |
| 0.1 | 51 px | 58 px | 66 px |
| 0.3 | 115 px | 153 px | 194 px |
| 0.4 | 153 px | 205 px | 258 px |
| 0.7 | 267 px | 358 px | 451.47 px |
| 1 | 382 px | 512 px | 646 px |
| 2 | >=592 px, image-edge limited | >=592 px, image-edge limited | Outside sampled profile |

At size 2, the warm horizontal footprint reaches the left edge and the arc lies beyond the sampled 40–800px diagonal. No radius is invented for that case. The [first clipped-profile attempt](attempts/profile-clipping/error.json) failed an overbroad visibility assertion; the verifier now demands visible/measurable arcs only where the sampling geometry covers them. This correction changed verification only; the original [failed PNG](attempts/profile-clipping/diffusion-size-2-reflection.png) and [log](attempts/profile-clipping/output.log) are retained. These output-space metrics include the physical Sun, tone mapping and 8-bit quantization and do not isolate each individual authored ray.

## Demo, engineering and reused evidence

[The real Demo DOM probe](demo/result.json) passes for 0.1/0.4/0.7/1/2: actual slider `input` events update the production renderer and two-decimal readout. It loads the real HTML, production bundle and original slider listener; only no-loop/base-layer-free offline startup and a test viewer handle are injected. External providers are blocked. The current HTML source hash, bundle and physical adapter are recorded. It verifies control wiring, not external terrain service connectivity.

[16 focused tests](parameter-focused.txt), [initial scoped lint](parameter-lint.txt), [final shader/Demo lint](parameter-final-shader-lint.txt), [final verification-script lint](parameter-final-verification-lint.txt), [production formatting](parameter-format.txt), [engine TypeScript](parameter-types.txt), and [final production build](parameter-final-build.log) pass. [The focused parameter RED](parameter-red.txt) preceded default/range/uniform-upload implementation. Existing 16-byte uniform padding carries the size; no new GPU resource or buffer growth was introduced. Native fixture resources are destroyed exactly once.

Default pixel equivalence permits reuse of the intermediate [98 stills +120 camera/time frames](../compaction/visual/result.json), [120 limb-traversal frames](../compaction/limb/result.json), [42 independent historical-main exact disabled matches](../compaction/integrity-audit.json), and [three physical WebGL smoke fixtures](../compaction/webgl/webgl-smoke.json). Those reports retain their actual old bundle/source hashes; they are **reused behavior evidence**, not freshly executed final-runtime matrices. No broad suite, full regression, manual Full, GPU timing or dedicated lifecycle rerun was added for this parameter.

[The final integrity audit](integrity-audit.json) verifies **47 final PNGs +2 failed-attempt PNGs**, default exact matches, current source/Demo/bundle hashes and the retained negative controls. Reproduce the production check with `M2_LENS_COMPACTION_BASELINE=coordination/evidence/M2.8/compaction/baseline/result.json`, `M2_LENS_DIFFUSION_BASELINE=coordination/evidence/M2.8/compaction/reference/result.json`, and a fresh `M1_OUTPUT` when running `coordination/ci/m2-lens-flare-reference.mjs` against this candidate build. Run `coordination/ci/m2-lens-flare-demo-size.mjs` for the offline Demo control probe.

Limits: one integrated GPU, bounded deterministic native ellipsoid/Gaussian terrain rather than an external dataset, 8-bit output and fixed profile geometry. This does not establish cross-device appearance, resident VRAM or real-time FPS.
