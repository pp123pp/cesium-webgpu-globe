# M2.6.1-B4 — Round 2: matched scenes, occlusion and twilight diagnosis

**Technical verification: PASS_WITH_KNOWN_ISSUES. Visual acceptance: AWAITING USER REVIEW.** This remains B4 only; no B5 acceptance or main merge is claimed.

## Source and build provenance

| | Baseline | B4 candidate |
| --- | --- | --- |
| Runtime source commit | 5f18afc1b77f433892f14510b2599c374f8a4942 (main) | ff06e9691ae98550cc965e1f8c6313a730c0bab6 |
| Engine source tree | d89e835bb08c174afa1d8ad374679cb605a3ae03 | a01b16951f3f31458a9c3768fe0626a6e5a10341 |
| Harness checkout | f58881f895e5b61ee6f451474b047825e0e3cec2 | 10e3d0892b4f4ece7f61dd4c66c1da6afb07d2aa |
| Bundle SHA-256 | c7529148c4b88961c0b2249868d662e8baca4f167f2b0853f4a2cf4565797854 | 349a9cc9e5c12d60c4bd81e3d5f4c3e02532aeb355e53f303f799f41e7a07793 |

The runtime source identities are separate from the harness checkout commits. Both runtime worktrees were clean at capture. The harness file hashes match across baseline and candidate. The candidate bundle was rebuilt with npm run build from the committed B4 runtime. The baseline bundle was taken from the clean B3/main worktree at the exact main commit above; a baseline worktree build was attempted but the checkout lacks the generated zip-web-worker.js input, so the already-built main bundle was used and its SHA-256 recorded. No uncommitted runtime changes were used.

## Matched environment and capture method

- Windows, Node v22.20.0, Cesium 1.146.0.
- Headed Google Chrome 156.0.8078.80.
- Intel Xe-LPG non-fallback WebGPU adapter; OS reports Intel Arc 130T, driver 32.0.101.8801.
- 1920×1080 canvas, devicePixelRatio recorded in each raw scene report.
- Fixed scene time: 2026-03-20T12:00:00Z. Exposure 1 except the three explicit limb exposure captures.
- Same 42-scene script and same camera/time/settings on both sides; 84 raw PNGs verified against their recorded SHA-256.
- Deterministic ellipsoid base-color scenes use no imagery. The full terrain-occlusion case uses a 6 km Gaussian CustomHeightmapTerrainProvider rendered as an actual mesh.

## Corrected camera and elevation coverage

The old exposure framing at 400 km / 0.5° was geometrically invalid: its sampled view contained no Earth rays. The old night framing at 2 m / Sun elevation -8° pointed below the horizon and contained no sky rays. Both defects are reproduced and recorded in result.json, not passed off as acceptance captures.

The corrected exposure camera uses the WGS84 limb elevation derived from the actual 400 km camera origin, with a +0.35° limb offset. All three exposure captures have the same camera, time, FOV and scene state; the report verifies both sky and Earth rays, and the Sun is on-screen.

| Exposure | Raw capture |
| --- | --- |
| 0.5 | [orbital-limb-exposure-0.5.png](after/orbital-limb-exposure-0.5.png) |
| 1.0 | [orbital-limb-exposure-1.png](after/orbital-limb-exposure-1.png) |
| 2.0 | [orbital-limb-exposure-2.png](after/orbital-limb-exposure-2.png) |

The scenario labels now state their actual camera heights: high orbit 36,000 km; low orbit 400 km; near-ground 2 km; ground 2 m. Low-orbit sunrise and low-Sun use the derived local WGS84 limb elevation, not an assumed global constant.

The corrected horizon-night view keeps the Sun at -8° while pointing the camera +0.5° above the local horizon. It reports 15 sky and 10 Earth samples, and includes the night sky, horizon and surface in one frame: [ground-night-2m-atmosphere-on.png](after/ground-night-2m-atmosphere-on.png). A separate downward ground-facing night diagnostic intentionally has no sky. Important limitation: the controlled globe's current constant base-color surface pass does not implement directional night-side terrain shading, so the visible surface remains blue rather than becoming a physically dark albedo. This predates B4 and is not represented as a successful night-side lighting test.

## Twilight colour and disk contrast attribution

Same camera, time, exposure and physical atmosphere were captured in four modes: all effects; physical-only (solar artwork disabled, physical Sun and atmosphere retained); Bloom-off; and physical-no-Bloom. Raw images are linked below.

| Mode | Disk display-linear luminance | Annulus display-linear luminance | Disk / annulus contrast |
| --- | ---: | ---: | ---: |
| All | 0.81976 | 0.74806 | 9.58% |
| Physical-only | 0.81775 | 0.74376 | 9.95% |
| Bloom-off | 0.78412 | 0.70792 | 10.76% |
| Physical-no-Bloom | 0.78213 | 0.70385 | 11.12% |

- [All effects](after/twilight-all.png)
- [Physical-only](after/twilight-physical-only.png)
- [Bloom-off](after/twilight-bloom-off.png)
- [Physical-only + Bloom-off](after/twilight-physical-no-bloom.png)

The far-sky RGB mean is identical in all four modes: [231.82, 200.71, 93.86]. It is also identical between baseline and candidate. This isolates the strong yellow sky to the pre-existing physical Rayleigh/Mie twilight response, not B4-authored Rays/Halo/Corona or Bloom. Disabling authored solar artwork changes disk/annulus contrast only slightly. Disabling Bloom improves the measured disk/annulus contrast by about 1.2 percentage points. The production probe also records physical in-scattered radiance at the solar pixel, confirming that physical atmospheric radiance dominates the yellow veil.

Baseline and candidate far-sky colour are identical; physical-only mode is byte-identical between the two runtimes. B4 changes only the authored solar contribution. No B4 shader retune was made: reducing exposure or changing the physical scattering model would conceal or exceed this integration task's scope. The yellow physical twilight and weak disk contrast are retained as a known issue for a separately scoped physical-atmosphere / solar-disc calibration task.

## Representative occultation evidence

Partial Earth occultation: 81 disk samples include 36 Earth-blocked and 45 clear samples. The hidden receiver region has maximum solar-on/off byte delta 0 across 51,377 hidden samples. Same-state controls are retained:

- [Partial Earth — all](after/earth-partial-all.png)
- [Partial Earth — physical-only](after/earth-partial-physical-only.png)
- [Partial Earth — Bloom-off](after/earth-partial-bloom-off.png)
- [Partial Earth — Sun-off](after/earth-partial-sun-off.png)

Real terrain mesh occultation: the WGS84 Earth test blocks 0/81 disk samples, while the actual rendered heightmap mesh blocks 81/81. The solar-on/off final image has 0 changed pixels and max byte delta 0. Removing the mesh restores the solar source, providing a positive control.

- [Terrain fully occluded — all](after/terrain-full-all.png)
- [Terrain fully occluded — physical-only](after/terrain-full-physical-only.png)
- [Terrain fully occluded — Bloom-off](after/terrain-full-bloom-off.png)
- [Terrain fully occluded — Sun-off](after/terrain-full-sun-off.png)
- [Terrain removed — positive control](after/terrain-removed-all.png)

This is representative B4 evidence only, not the complete B5 occultation matrix.

## Exact pairing and audit

- [Automated pair audit](audit.json): PASS; 42 matched scene pairs, 84 PNG hashes verified, 24 invariant pairs, 28 byte-identical pairs.
- [Baseline raw report](before/result.json).
- [Candidate raw report](after/result.json).
- [Capture script](../../../../ci/m2.6.1-b4-atmospheric-glow-smoke.mjs).
- [Scene / probe fixtures](../../../../ci/m2.6.1-b4-fixtures.mjs).
- [Offline audit script](../../../../ci/m2.6.1-b4-audit.mjs).

No browser console errors, WebGPU errors or provider errors were reported. Renderer cleanup passed. The suite is static and single-device; it does not claim 120-frame temporal acceptance, the complete B5 occultation matrix, a WebGL differential or user visual acceptance.
