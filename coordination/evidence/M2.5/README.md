# M2.5 focused HDR / exposure acceptance — 2026-11-03

Verdict: **PASS for M2.5's scoped HDR/exposure behavior**, with the high-exposure
quality limitations below. This is not final M2.6 acceptance or a complete WebGL
regression claim.

## Source and environment

- PR: [#14](https://github.com/pp123pp/cesium-webgpu-globe/pull/14).
- Final capture source: `e22d4361ccdf3310e12431a740a4f8606a567722`, clean checkout.
- Served/local bundle SHA-256: `b7f18bcca8cc05a8399f0ddb25570306a8189a8501bbda5e9a0f256e364bd27c`.
- Windows 11, headed Chromium `156.0.8078.4`, Intel `xe-lpg`, non-fallback WebGPU
  adapter; viewport 800 x 450. This adds physical-adapter rendering evidence,
  not a performance benchmark or a multi-device certification.
- [Raw capture report](hardware-result.json) records all 20 frames, camera/time,
  actual display pixels, production WGSL probes, adapter, bundle and source.
- [Reproduction script](capture.mjs) reuses the repository browser harness and
  production atmosphere/Sun fixtures. Build with `npm run build`, serve the root
  at `http://127.0.0.1:8090/`, and run:

```powershell
$env:M0_GPU_MODE = 'hardware'
$env:M0_HEADLESS = '0'
$env:M0_REQUIRE_PHYSICAL_GPU = '1'
$env:M1_OUTPUT = 'Build/m25-acceptance/final-hardware'
node coordination/evidence/M2.5/capture.mjs
```

The local development server could not import the missing Sandcastle `vite`
dependency. The capture used the already installed Express static middleware to
serve the built checkout; the harness checked local/served bundle equality.

## Exposure and visual observations

| Fixed view | Mean display RGB at exposure 0.5 / 1 / 2 | Observation |
| --- | --- | --- |
| Day, 400 km | 94.05 / 120.48 / 140.10 | Horizon and surface variation remain visible; lower exposure preserves more bright-surface contrast. |
| Terminator, 400 km | 80.15 / 108.73 / 132.66 | Surface and atmospheric rim brighten without filling black space with gray. |
| Night, 400 km | 22.13 / 39.04 / 62.44 | Higher exposure reveals more night-side surface detail while stars remain visible. |

These nine frames have zero pixels with any RGB channel at or above 254. This
is an actual display-pixel diagnostic, not a measurement of the display's HDR
range or proof that exposure creates information. Increasing exposure trades
highlight contrast for dark-detail visibility; it does not improve every view.

- [Day 0.5](day-exposure-0.5.png), [day 1](day-exposure-1.png),
  [day 2](day-exposure-2.png): no broad white clipping at the tested settings.
- [Night 0.5](night-exposure-0.5.png), [night 1](night-exposure-1.png),
  [night 2](night-exposure-2.png): usable manual dark-detail adjustment.
- [Orbital Sun at 2](sun-orbit-exposure-2.png): white core is localized to
  approximately 0.2744% of the frame; surrounding space stays black. At default
  exposure no channel reaches the 254 diagnostic threshold.
- [Low Sun at 1](sun-low-elevation-exposure-1.png) remains distinguishable from
  its sky. [At 2](sun-low-elevation-exposure-2.png), approximately 19.6717% of
  pixels reach 254 in at least one channel, but none is all-white. The yellow
  sky looks washed out and disk contrast weakens. **Known high-exposure quality
  tradeoff; exposure 2 is not recommended as a universal preset.** The solar
  diagnostic uses a 12-degree field of view and a blue base color, not a live
  landscape quality fixture.
- Fixed ground camera at -20/-10/0/+10/+20 minutes around sunset: the Sun moves
  below the horizon, the sky changes from pale daylight through orange twilight
  to a dark star-visible sky. Mean RGB decreases 149.71 / 136.59 / 112.32 /
  77.66 / 59.06. See [before](temporal-twilight--20min.png),
  [horizon](temporal-twilight-0min.png), [after](temporal-twilight-20min.png).
  Five snapshots establish ordered progression, not continuous-animation or
  temporal-stability acceptance.

## Found and fixed during acceptance

Custom `scene.backgroundColor` had been written directly into linear
`rgba16float`, while the same terrain base color was sRGB-decoded. The actual
GPU regression reproduced gray background `[206,206,206]` versus gray terrain
`[154,154,154]`: [original failure](background-red.json).

Commit `e22d436` decodes the HDR clear RGB once, preserving alpha, caller-owned
color and the direct M0 path. The existing space smoke now checks same-color
terrain/background equality. [Passing report](background-green.json) records
both as `[154,154,154,255]`, no browser errors, and all 1,376 tracked native
resources destroyed. Its source field is the parent revision with the three
fix/test files dirty: it tested the exact fix before commit, not a clean parent.

- Focused context lifecycle test: failed before fix, 3/3 passed afterward.
- Actual `m2-space-smoke.mjs`: failed before fix and passed afterward, including
  exposure, Moon, stars, moonlight, resize and destruction.
- Actual `m0-webgpu-smoke.mjs`: 17 checks passed on Intel Xe-LPG; expected
  device-loss/invalid-buffer negative controls are not unexpected GPU errors.
- Build, targeted ESLint, commit-hook TypeScript and diff checks passed.

## CI and limits

Original `c11494b7a81d26396f413aa2c3afdd8dc5737ae1` passed
[Fast 41596565861](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41596565861)
and [executed Full 41596565848](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41596565848).
Fast artifact `13213031066` was downloaded and its atmosphere, Sun and space
screenshots reviewed. Those runs predate the background fix; final publication
must pass the updated PR checks. Full's current scope excludes rendering and
complete WebGL differential tests.

NaturalEarth imagery over ellipsoid terrain remains coarse and has a visible
inherited seam, also present in the original Fast atmosphere-disabled capture.
This work does not claim to fix it or `M1-NAV-001`, certify live terrain, prove
photometric calibration, or complete A07-A10 for M2.6. Default black-background
images are unaffected by the custom-color fix. No runtime changes beyond that
fix were introduced during acceptance.
