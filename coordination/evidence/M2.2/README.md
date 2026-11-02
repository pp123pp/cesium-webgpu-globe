# M2.2 compact evidence

`local-summary.json` records actual local source/working-tree and bundle identity,
software-GPU environment, eight aggregate outcomes, representative measurements
and balanced resource counts. It does not describe a later clean or hosted SHA.
Implementation, diagnosis, commands and limits are in the
[handoff](../../handoffs/M2.2-physical-atmosphere.md) and
[model contract](../../../docs/WEBGPU_M2.2.md).

Final remote commit/tree, same-head successful Fast and executed Full, and their
artifact URLs are recorded in [PR #8](https://github.com/pp123pp/cesium-webgpu-globe/pull/8).
The prior M2.1 runs remain historical evidence only. No pending/future CI result
is marked passed by this source snapshot.

Both workflows upload complete `m2-atmosphere/result.json` and screenshots in
their existing `m1-fast` / `m1-full-regression` artifacts. No bulk captures or logs
are duplicated into Git. Key images are:

| Artifact path under `m2-atmosphere/` | Purpose |
| --- | --- |
| `ground-day.png`, `ground-12h-later.png` | Same 2 m camera, actual scene-time response |
| `ground-terminator.png`, `ground-night.png` | Near-horizon color and planetary solar occlusion |
| `low-orbit.png`, `low-orbit-atmosphere-disabled.png` | 400 km atmosphere and same-view M1 input; inherited coarse imagery seam remains in both |
| `high-orbit.png`, `high-orbit-terminator.png` | 35,786 km globe/space, day and terminator |
| `mountain-aerial-perspective.png`, `mountain-atmosphere-disabled.png` | Actual elevated terrain and visible linear transmittance/scattering composition |

The complete local report is `Build/m2-atmosphere/result.json`. The initial
mountain-depth assertion failure was diagnosed with fixed subpixel native picks,
then the affected terrain/resize/release section and complete atmosphere suite
passed. Its diagnosis is retained in the handoff, including why the existing
M2.1 precision assertions remain unchanged. Full M1/WebGL compatibility and
device-loss/early-exit acceptance are supplied by final-head hosted Full; local
atmosphere evidence alone does not certify those unexecuted suites.

`navigation-accounting.json` records the first hosted Full failure's exact
98-versus-96 ownership mismatch, its source/run, and the focused local correction
result (10 checks, 2,713 buffers and 68 textures all destroyed). The handoff links
the initial hosted Fast/Full artifacts and verified archive digests. The new
strict equality includes the two initialized atmosphere uniforms; no allocation
cap or zero-resource teardown assertion was relaxed. Final-head acceptance is
recorded separately in the PR after the repaired head's CI completes.

`globe-isolation.json` records the separate M1 Globe fixture's later software-GPU
LOD timeout and the focused 7-check correction. This fixture now disables the
new atmosphere explicitly; its original 60-second wait, geometry/coverage and
error assertions remain unchanged. The dedicated M2 and enabled-default live
demo gates retain the atmosphere acceptance. See the handoff for the failed
Fast run, artifact and verified archive digest.
