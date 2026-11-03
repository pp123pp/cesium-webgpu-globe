# M2.3 compact evidence

`local-summary.json` records the actual local working tree, served bundle,
software-GPU environment, eight solar acceptance groups and representative
measurements. It distinguishes the earlier atmosphere regression and failed
fixture/review diagnostics from the final complete solar run. It does not
describe a future clean or hosted commit.

Read the [handoff](../../handoffs/M2.3-sun-rendering.md) for commands, diagnosis,
scope and limitations, and the [Sun contract](../../../docs/WEBGPU_M2.3.md)
for units, LDR composition and lifecycle. Final same-head remote SHA/tree,
successful Fast and actually executed Full, and artifact links are recorded in
[PR #8](https://github.com/pp123pp/cesium-webgpu-globe/pull/8), retaining the
accepted M2.1/M2.2 history. No pending run is marked passed in this snapshot.

Both workflows upload complete `m2-sun/result.json`, failure diagnostics and
screenshots in the existing `m1-fast` / `m1-full-regression` artifacts. Bulk
captures/logs are not duplicated into Git. Representative artifact files:

| Path under `m2-sun/` | Actual rendered evidence |
| --- | --- |
| `ground-sun.png`, `low-orbit-sun.png`, `high-orbit-sun.png` | Native direction and resolved angular disk at 2 m, 400 km and 35,786 km |
| `sun-four-minutes-later.png` | Scene-time change with fixed camera |
| `limb-1.2.png`, `limb-0.png`, `limb--1.2.png` | Full, partial and hidden orbital Sun |
| `ground-horizon-half-sun.png` | Partial disk at the 2 m observer's geometric horizon |
| `sun-behind-real-mountain.png` | Actual depth occludes a Sun ray that misses WGS84 |
| `ground-low-sun-atmosphere.png` | Existing RGB atmosphere dims/reddens the Sun |
| `resized-off-axis-sun.png` | Projection and bindings after camera/viewport changes |

The complete report also records cold Sun-only initialization without LUTs,
five subpixel mountain alignments, the shared-intensity zero/linear response,
finite glare, exact old attachment destruction, actual device loss and all
native resources balanced at teardown. Shader probes supplement actual canvas
comparisons and independent native geometry; counters alone do not pass a group.
