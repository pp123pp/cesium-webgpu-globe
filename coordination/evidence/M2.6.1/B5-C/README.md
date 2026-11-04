# B5-C performance and lifecycle — 2026-11-04

**Measurement integrity and native buffer/texture lifecycle: PASS.** GPU cost
increased in this observation; this is not a no-regression result. Under the
performance-observational policy in [ACCEPTANCE](../../../../docs/ACCEPTANCE.md),
no hard timing budget is specified. B5-C's reporting/lifetime work is complete;
**User confirmed B5-C acceptance on 2026-11-04**, after the observed cost increase
was disclosed, and also confirmed B5-B visual acceptance. Commit, push and main
merge are authorized. M2.6.1 final milestone closure is not claimed here.
See [user acceptance](user-acceptance.json).

[Evidence page](index.html) · [offline audit](audit.json) ·
[candidate raw report](candidate/result.json).

## Same-device comparison

Headed Chrome 156.0.8078.80, Intel Xe-LPG non-fallback adapter, Windows.
Each run has three batches, each with six warm-up iterations and 30 recorded
samples for each of three alternating modes. The valid A–B–A runs contain
810 recorded frame samples in total. GPU durations come from actual render-pass
timestamp queries; `wallRenderAndMapMs` is separately labelled and is not GPU time.

The selected view retains the M2.6 profiling camera: 400 km, limb +0.6°, FOV 24°,
2026-03-20T12:00:00Z, exposure 1, Bloom 0.35, 1920×1080. Both builds use native
ellipsoid meshes capped at level 8 and no imagery. This is a fresh paired
fixture, not the historical NaturalEarth timing scene. Its absolute values must
not be compared directly with the old 16.80 ms M2.6 report.

The audit verifies actual camera/time/Sun, viewport, effects, exposure, terrain
meshes, adapter/browser and identical capture dependencies. Production Mie
defaults intentionally differ: scattering 3.996e-6 → 1.998e-6, extinction
4.44e-6 → 2.22e-6, anisotropy 0.8 → 0.65. These are accepted B5-A runtime changes,
not a hidden mismatch or a newly altered performance setting.

| All-effects GPU render-pass sum | Samples | Mean (ms) | p95 (ms) |
| --- | ---: | ---: | ---: |
| M2.6 before | 90 | 10.593530 | 16.515072 |
| Current candidate | 90 | 11.409089 | 17.825792 |
| M2.6 return measurement | 90 | 10.105651 | 13.500416 |
| Pooled M2.6 before/after | 180 | 10.349591 | 14.286848 |

Against pooled baseline, candidate mean is **+1.059499 ms (+10.24%)**, p95 is
**+3.538944 ms (+24.77%)**. All p95 values are recomputed from the underlying
sample pool; batch p95 values are not averaged. Disabled-artwork and Bloom-off
results, first-to-last-pass spans, individual pass durations and batch summaries
remain in the raw reports and audit.

The measured excess is concentrated in the atmosphere/Sun HDR composite:
mean 9.812924 ms before, 10.589161 ms candidate, 9.330870 ms on baseline return.
That pass accounts for about 95–97% of the difference against the individual
baselines. Source changes since M2.6 add depth-based terrain surface lighting,
long-path atmosphere balancing and refined solar transport/artwork within this
pass. They are plausible contributors, not a measured per-feature causal split.
The Bloom blur changed from diagonal to normalized single-scale filtering;
the measured Bloom-pass contribution is much smaller.

Batch means vary substantially (candidate 9.485–13.306 ms; baseline
9.201–12.006 ms). Thus the observed increase is retained as a performance trend,
not dismissed as noise, but its exact causal size cannot be determined from this
single integrated GPU. Short passes quantize (approximately 0.065536 ms steps);
zero readings do not establish zero GPU work. No FPS guarantee, cross-device
claim or unsolicited runtime optimization is included.

## Native resource lifetime

- Candidate timing Viewer: all 434 instrumented GPUBuffer/GPUTexture allocations
  explicitly destroyed exactly once. Both valid baseline runs also balance.
- Three independent lifecycle Viewers: 104 allocations each, **312 total**, all
  destroyed exactly once; final live count 0 in every cycle.
- Each cycle renders real bounded terrain at 1080p → 720p → 1080p, with 16
  repeated render/same-size-resize iterations per size and active solar assets,
  atmosphere and Bloom. No allocations or retained-count growth during these
  repeated-render intervals.
- Restored 1080p state matches initial live state: **72 objects = 56 buffers +
  16 textures**, logical payload 47,127,784 bytes. Native output is saved in nine
  same-task PNGs. The audit checks all twelve PNGs, including the three timing
  captures.
- No render/provider/browser/console/GPU/network errors in the accepted runs.

The native ledger covers explicitly created GPUBuffer/GPUTexture objects, not
pipelines, bind groups, implicit swap-chain resources or physical residency.
`residentVram.value` is null with the WebGPU observability reason. Logical payload
is not resident VRAM. This is bounded repetition, not a long-duration soak.

## Provenance, failures and checks

Baseline: clean detached `cf2c1d1bc4f368a02d126bab203ee32da5d4064c` in
`Build/b5-c-m26-baseline`. Independent workspace dependency links point inside
that checkout. Existing official `gulp prepare` and `npm run build` passed.
Fresh bundle SHA-256:
`340b831d3181d7268101e6dab9289eec82f46c0c97ae67ae5a506fdd2eee08f0`.
This fresh build is not mislabelled as the old M2.6 bundle hash.

Candidate source: `8e7c53c09f3b0e2ae6b38ab4593d818282b979a4`, with new untracked
verification/evidence files. No runtime diff. Reused B5-A bundle SHA-256:
`410f39366223a6a611e2072945c39d682507b2b152e2105a964325887cab9980`.
Both served bundles match their local files; browser atmosphere shader text
matches the selected checkout's source. Harness/dependency hashes are recorded
and independently checked. No commit or push occurred during capture; later
publication is separately authorized by the acceptance record above.

The first baseline build lacked prepare-generated zip-worker content; its failure
log and subsequent prepare/build logs are retained. The first baseline capture
failed the console gate with four `ERR_CONNECTION_REFUSED` entries, preserved in
[baseline-first-error.json](baseline-first-error.json). Their exact request URLs
were not recorded in that attempt. Request/console-location diagnostics were
added; a page-only loading probe and both subsequent complete baseline runs did
not reproduce the errors. No engine fix or proven network root cause is claimed;
the failed timing data is excluded from comparison.

Final checks: baseline build; hardware baseline-before/candidate/baseline-after;
independent audit of 810 samples, 12 image hashes and lifecycle records;
targeted ESLint for all three new scripts and syntax checks. No Full,
SwiftShader, complete WebGL differential or redundant B5-B recapture ran.

## Reproduction

Serve the repository at port 8090. Run the same absolute capture script from each
build's checkout; it resolves the runtime bundle and shader from that working
directory. Use a new output path on every attempt.

```powershell
$env:M0_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:B5C_PHASE = 'candidate'
$env:M1_BASE_URL = 'http://127.0.0.1:8090/'
$env:M1_OUTPUT = 'Build/b5-c-candidate-new'
node coordination/ci/m2.6.1-b5-c-performance.mjs
```

For the baseline, use its checkout as cwd, `B5C_PHASE=baseline`, base URL
`http://127.0.0.1:8090/Build/b5-c-m26-baseline/`, an absolute new output path, and
the main checkout's absolute script path. Do not run two GPU measurements at once.

Offline archived-evidence check:

```powershell
node coordination/ci/m2.6.1-b5-c-audit.mjs coordination/evidence/M2.6.1/B5-C/baseline-before coordination/evidence/M2.6.1/B5-C/candidate coordination/evidence/M2.6.1/B5-C/baseline-after Build/b5-c-audit-recheck.json
```
