# M2.1 compact evidence

`local-summary.json` preserves the actual local browser report's source identity,
dirty working-tree status, served-bundle digest, GPU/browser identity, numerical
observations and balanced resource counts. The source label is `8ade9f94` plus
the then-uncommitted M2 implementation, not a clean final-head test. Do not relabel
it as hosted evidence or replace its source identity with a later commit SHA.

| Capture                          | Scenario         | Observation                                                                                           |
| -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| [high-orbit.png](high-orbit.png) | 35,786 km height | Visible native ellipsoid terrain and black space; the coarse terrain tessellation remains M1 behavior |
| [low-orbit.png](low-orbit.png)   | 400 km height    | Visible surface, positive reversed depth, native mesh-pick agreement                                  |
| [ground.png](ground.png)         | 2 m height       | Stable visible surface, finite camera state and readable depth                                        |

These are unlit base-color mathematical test scenes, with imagery intentionally
disabled to isolate depth and coordinate checks. Existing independent M1 tests
continue to require real imagery/terrain. No atmosphere image or Sun disk is
claimed by these captures.

The local run used Chromium 156.0.8078.4, headed Xvfb, Google SwiftShader and
1280×720, then 960×540 for resize. It executed 9 asymmetric-camera probes,
23 GPU boundary cases and 8 aggregate checks, with all 456 native GPU resources
released. The images were visually inspected. The raw local report remains in
`Build/m2-foundation/result.json`; complete hosted reports/screenshots are uploaded
to Actions artifacts under `m1-fast` and `m1-full-regression`, including the
`m2-foundation` directory. They are not duplicated into Git.

Final acceptance uses the current M2 PR head's Fast and actually executed Full
results. The [handoff](../../handoffs/M2.1-mathematical-foundation.md) distinguishes
local verification, inherited failures and environmental problems.
