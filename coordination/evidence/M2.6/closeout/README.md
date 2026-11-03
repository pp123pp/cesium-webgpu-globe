# M2.6 closeout evidence

Date: 2026-11-03. Runtime and harness revision:
`cf2c1d1bc4f368a02d126bab203ee32da5d4064c` (clean checkout for every browser suite).
Bundle SHA-256: `554479fae644de144388930d5777eb98bf1f04086e327e3545d69356f4e9a876`.
Later evidence/documentation commits do not change this runtime.

This supersedes the preliminary parent-directory captures. Images are actual
WebGPU canvas pixels copied in the same JavaScript task as rendering, avoiding
discarded swap-texture frames. Reports preserve exact source, bundle and environment.

## Environment and executed checks

- Windows, headed Chromium 156.0.8078.4, Intel Xe-LPG non-fallback adapter.
- Visual scenes: 1920 x 1080; resize and continuous sequence: 1280 x 720.
- `npm run build`: passed. Targeted ESLint and commit-hook TypeScript: passed.
- Asset, lifecycle and Sun unit tests: 7 passed.
- Actual-browser visual, production Bloom WGSL, combined solar occlusion,
  optional-asset 404 and malformed-payload fallback, existing Sun and atmosphere
  suites: passed. Each subdirectory contains its original `result.json`.
- Complete WebGL differential: no new failures. Baseline and candidate each
  execute 3,822 specs: 3,811 pass, the same 11 fail, 12,068 skip. Execution order
  and failure signatures match; no tolerated pixel differences or browser errors.
  Raw suites retain exit 1; the differential runner exits 0.
- Final publication CI is recorded in PR #18. A skipped Full job is not a
  passing regression; final implementation publication requires executed Full.

Run from this checkout with its built bundle served on `http://127.0.0.1:8090/`:

```powershell
$env:M0_GPU_MODE = 'hardware'
$env:M0_REQUIRE_PHYSICAL_GPU = '1'
$env:M1_OUTPUT = 'Build/m26-final/visual'
node coordination/ci/m2.6-solar-visual-smoke.mjs
```

The other suites use the same harness and their matching
`coordination/ci/<suite>-smoke.mjs`. Run the fallback suite again with
`M26_CORRUPT_ASSET=1` for malformed HTTP-200 payloads. Unit command:

```text
node --test coordination/ci/m2-solar-assets.test.mjs coordination/ci/m2-solar-lifecycle.test.mjs coordination/ci/m2-sun.test.mjs
```

## Visual and functional observations

| Gate | Evidence and observation |
| --- | --- |
| A07 | `visual/evidence/A07/orbital-sunrise.png` shows a partly exposed solar disk on the limb. `m2-solar-occlusion` verifies whole/partial/hidden disks; all blocked Earth pixels remain unchanged and the fully hidden source contributes zero changed pixels. |
| A08 | `visual/evidence/A08/continuous-*.png` and 120 observations cover moving time/camera through sunset. The four UTC-labelled orbital views are direction diagnostics, not local-daytime claims. Ground day/terminator/night evidence is in `m2-atmosphere`; see its fixed-camera +12-hour check. |
| A09 | Ground, low/high orbit and 200 km regional atmosphere on/off views show coherent horizons and attenuated ground. Native mesh picks and GPU transport establish actual terrain. The 20 km narrow view is low-detail NaturalEarth imagery with strong long-path scattering, not missing geometry. |
| A10 | All five authored effects and Bloom have paired same-state pixel controls. Sun boundary and black space remain visible. Exposure 0.5/1/2 is captured at orbital sunrise, ground horizon, daytime and terminator. Exposure 2 reduces low-Sun contrast and can saturate individual channels; this is not a claim that every exposure improves quality. |

The controlled production-WGSL test preserves a single HDR 4.0 texel as
`(4 - 1) / 16 = 0.1875` after extraction, rejects Bloom over non-clear terrain
depth and analytic Earth, and confirms visible sky still receives Bloom. The
real heightmap mesh occluder blocks a ray that misses the ellipsoid; removing
the terrain reveals the same solar ray. These are actual depth/mesh tests,
not image-hash proxies or downloaded World Terrain acceptance.

The 120-frame sequence has a maximum mean sampled frame change of about 0.52%
and zero difference for repeated identical states. This excludes obvious flashes
in the sampled sequence, not every possible temporal artifact. The three saved
sequence frames show the source disappearing behind the horizon.

## GPU timing and resource lifetime

The adapter **does support** `timestamp-query`; the earlier device had not enabled
it. The benchmark alone requests it. Production does not require the feature.
There are 30 alternating samples per mode with six warm-up iterations:

| Current implementation mode | Mean render-pass sum | p95 |
| --- | ---: | ---: |
| Authored effects and Bloom disabled | 16.47 ms | 20.25 ms |
| Authored effects enabled, Bloom disabled | 16.53 ms | 20.51 ms |
| All enabled | 16.80 ms | 20.45 ms |

Mean Bloom increment is approximately 0.27 ms; all-enabled first-to-last-pass
span is 20.64 ms. These are GPU timestamp observations, not wall-clock queue
latency, an FPS guarantee or a cross-device performance pass. The disabled mode
is the current renderer with effect weights zero; it still samples textures and
is **not** a pre-M2.6 cost baseline. Short passes can quantize to zero.

- The main scene releases 6,896/6,896 instrumented native buffers/textures.
- Renderer totals balance at 16/16 textures and 3/3 buffers, including resize.
- The continuous sequence creates no new renderer textures/buffers and reuses
  assets; sampled live native allocations remain flat.
- Device destruction raises the expected loss event and stops drawing; explicit
  recreation succeeds three times with no retained native resources.
- HTTP 404 and corrupt payload cases both release seven partially loaded
  textures and render using eight neutral fallbacks; final counters balance.
- Byte counts are logical allocation payloads. Resident VRAM and long-duration
  multi-device memory trends remain unverified.

## Preserved limits

`M1-NAV-001`, low-resolution NaturalEarth imagery/seams, stylized golden rays and
high-exposure low-Sun contrast remain documented. This does not accept M3 clouds,
M4 shadows, M5 long-duration soak or multi-device performance. No merge or
production deployment is performed by this closeout.

## WebGL regression reproduction

`webgl-comparison.json` is the compact result. `webgl-raw.zip` contains original
baseline/candidate reports, full console log, Windows launch adapter, and the
two unsuccessful browser-launch attempts. The candidate runtime is `cf2c1d1`
with no tracked runtime-source diff; documentation/evidence edits existed before
the test and remained unchanged throughout. Baseline is the separate clean
`724b5db8f258d0ce00c4f6b774bd38529e24252b` checkout.

The sandbox prevented browser startup. The next default Windows Karma launch
also did not connect. The successful unsandboxed run used the archived CJS
preload to append exactly the existing `m0-chrome.cjs` flags (`--no-sandbox`,
`--enable-webgl`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`) to
Chrome Headless 156, identically for both checkouts. Assertions were unchanged.
Run the existing `coordination/ci/m0-webgl-regression.mjs` with the absolute
`--baseline` checkout and set `CHROME_BIN` to that Chromium executable;
`NODE_OPTIONS=--require=<absolute chrome-launch-flags.cjs>` reproduces the
Windows launch adaptation.
