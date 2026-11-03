# M2.6.1-B1 continuation verification

Status: **implementation and technical evidence delivered; human visual acceptance pending**. No merge or B2 authorization.

## Source and method

Tested clean commit: `4da1baceb9567288ff1e5ac06227968dd1f6d851`. Its engine, shader, SVGs and GPU payloads are byte-identical in Git to `59f6089`; this continuation changes only tests/evidence/documentation. Bundle SHA-256: `465ce843e64ae88f7e3a9e372b6c405ef220c5ea5cc57e48de454dc865b3a1ec`.

Browser 156.0.8078.4, headed Windows Chromium; adapter intel / xe-lpg, fallback=false. The prior OS inventory identifies Intel Arc 130T. All images below are unmodified captures of actual WebGPU canvas pixels.

The original pre-edit baseline remains in [../baseline](../baseline/). The new four-way comparison compiles the exact historical Sun WGSL and three R8 payloads from `5cb8eda`, B01-only, B02-only, and combined WGSL on the real GPU. This is test-only shader/asset substitution in the current bundle, not a separately rebuilt historical bundle and not image synthesis. A guard rejects any non-B1 runtime change, and the harness records shader/payload hashes and every replacement. No production feature flags or render passes were added.

The four versions use exactly equal camera position/direction/up, time, exposure, viewport, angular radius, terrain provider and imagery state. [comparison/matched-state.json](comparison/matched-state.json) asserts this for every capture. Fixtures use native ellipsoid terrain and no imagery, avoiding asynchronous provider differences. These controlled comparisons supplement, not replace, the earlier NaturalEarth images and actual heightmap-mesh occlusion checks.

## Four-way comparison

Same low-orbit camera, UTC 2026-03-20 12:00:00, exposure 1, 1920x1080:

| Version | Actual browser image |
| --- | --- |
| Before B1 | [Baseline](comparison/baseline/low-orbit-1920-exposure-1.png) |
| B01 only; original rays | [B01](comparison/B01/low-orbit-1920-exposure-1.png) |
| B02 only; original disk | [B02](comparison/B02/low-orbit-1920-exposure-1.png) |
| B01 + B02 | [Combined](comparison/combined/low-orbit-1920-exposure-1.png) |

Each version includes exposure 0.5/1/2 at 1920x1080 and 1280x720, plus Sun-facing high orbit, orbital limb and off-axis views at 1920x1080. There are 36 comparison images and two matching timing-state captures. See each variant's result.json for exact state and image hash.

The earlier disk-only/rays-only images used different FOVs and were effect diagnostics, not this four-stage comparison. The old M2.6 high-orbit image faced Earth; the new [high-orbit Sun view](comparison/combined/high-orbit-1920-exposure-1.png) supplies the missing Sun-facing case.

## Physics and motion

[physics-motion/result.json](physics-motion/result.json) reads 4096 production-WGSL samples distributed uniformly in projected solid angle. Expected integrated mean luminance is 5; measured 4.994053 (relative quadrature error 0.1189%, below the 1% pixel-integration tolerance). Physical radius remains 0.00465 rad. This verifies redistribution of radiance, not increased irradiance.

The new 120-frame sequence fixes exposure at 1 while changing camera and scene time. It tracks 1536 samples per frame in the projected Sun's ray region, excluding the bright disk and unrelated black sky. Maximum mean frame delta is 0.002448; maximum p99 delta 0.024072; fixed-state repeat maximum 0. No new textures/buffers are created during steady-state motion. Native destruction balances 32/32. Original frames [0](physics-motion/motion-0.png), [60](physics-motion/motion-60.png), [119](physics-motion/motion-119.png) and all 120 observations are retained. These bounded metrics do not replace subjective review or multi-device testing.

The unchanged existing Sun browser suite also passed on runtime `59f6089`: independent ephemerides, true angular diameter, orbital and ground partial/full Earth occultation, real rendered heightmap terrain, removed-mountain negative control, HDR composition, resize and native teardown. Its raw report is [sun/result.json](sun/result.json). This is real mesh-depth coverage, not a new claim about live global terrain services.

## Same-device GPU timestamps

All-enabled pass sum, identical 1920x1080 low-orbit camera/time/exposure, 30 samples per version:

| Version | Mean ms | p95 ms |
| --- | ---: | ---: |
| Historical Sun / rays | 8.378 | 8.716 |
| Combined B1 | 7.181 | 7.668 |

Observed mean delta: -1.197 ms. Raw timestamp samples are in the baseline/combined reports. Runs were sequential, so thermal/frequency/order variation prevents interpreting this as a reliable speed-up. No material slowdown was observed in this sample. This fixture differs from the older M2.6 16.80 ms scene; those numbers are not directly comparable. CPU wall-clock fields remain separately labelled in raw reports and are not used as GPU durations. Resident VRAM remains unverified.

Textures: 0 added; three modified 512x512 R8 payloads; total solar payload 2,883,584 bytes, delta 0. Three ray texture samples / eight solar samples and render-pass count are unchanged. Native comparison resources balance 669/669 for baseline and 671/671 for combined.

## Device-loss interpretation

The earlier harness fix measures zero new Bloom-frame counts after the loss notification. Instrumented phase counters are retained in both initial and final comparison reports: a counter can advance between device.destroy() and device.lost resolution even with the unmodified historical Sun. It does not advance after notification, and the loop stops with one error and balanced destruction.

The prior wording "already-submitted in-flight GPU frame" was too strong: these are CPU-side renderer counters, not proof of GPU execution. This continuation records the transition without assigning it GPU duration or claiming a new device-loss runtime fix. Original rendering assertions are retained; no production lifecycle path changed.

## Checks and remaining review

- Focused Node tests: 9 pass, 0 fail. The B1 test was renamed to `m2-b1-solar.test.mjs` so existing CI discovery includes it; no test or assertion was removed.
- Changed-file ESLint and commit hooks passed. No new runtime build was needed: the unchanged previously built bundle was hash-verified by every browser run.
- Four comparison runs, GPU integration/motion run and existing Sun regression passed. No manual Full dispatch or rerun was made.
- Runtime `59f6089` had successful Fast run 41637159139 and an actually executed successful Full run 41637158767. These historical results do not certify later documentation/test commits; final-head CI is reported on PR #21.

Manual observation: B02 makes the rays less dense/strong and less regularly aligned. B01's bright core remains near-white; its display-space change is subtle under the existing ACES highlight compression, especially exposure 2. Narrow radial lines and the existing round golden halo remain visible. Halo/corona/Bloom changes are deliberately outside B1. Do not mark B1-01/02/03 or all of M2.6.1 as visually accepted solely because technical checks pass. Await the user's visual review; do not merge or begin B2.

## Reproduction

Use the existing local server at port 8090 and the current built bundle. Set `M0_GPU_MODE=hardware`, `M0_HEADLESS=0`, `M0_REQUIRE_PHYSICAL_GPU=1`, then run:

`node coordination/ci/m2-b1-comparison-smoke.mjs`

`node coordination/ci/m2-b1-physics-motion-smoke.mjs`

`node --test coordination/ci/m2-b1-solar.test.mjs coordination/ci/m2-sun.test.mjs coordination/ci/m2-solar-assets.test.mjs coordination/ci/m2-solar-lifecycle.test.mjs`
