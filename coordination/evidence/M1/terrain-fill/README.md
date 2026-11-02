# Native terrain-fill evidence

See `../../../handoffs/M1-native-terrain-fill.md` for the correction and actual candidate results.

| Evidence | Meaning |
| --- | --- |
| `final-attempt-99185d2/` | Earlier expanded ground-flight failure, including full-frame missing terrain. |
| `rejected-clipped-fill.patch`, `rejected-clipped-fill-tests.txt`, `m1-terrain-fill-live-*` | Rejected clipped-parent coverage candidate and retained failures. |
| `m1-native-fill-triangles/`, `m1-native-fill-depth-control/` | Original isolated software raster pixels with native triangle/CPU coverage and renderer control experiments. |
| `m1-fill-replay*.json`, `m1-fill-replay.mjs` | Independent real WebGPU reproduction, including buffer/index/matrix/topology controls. No Cesium renderer or depth/imagery pass. |
| `m1-native-fill-upload-control/` | Failure evidence that also exposed stale fill selection bounds. |
| `m1-native-fill-bounds-live/`, `m1-native-fill-selection-live/` | Real all-fill gaps and over-raised flight height; these runs failed and are not accepted. |
| `m1-native-fill-eviction-live/` | Complete passing candidate terrain/flight/drape/lifecycle run; software GPU. |
| `*-red.txt`, `*-green.txt` | CPU regression and coverage-oracle failure/correction logs. |
| `candidate-source.json` | Exact candidate source/bundle hashes; final HEAD verification is recorded separately. |

Screenshots are actual browser output. Historical failed comparisons are preserved. Pixel-identical images are not required by `docs/ACCEPTANCE.md`; no terrain test is omitted on that basis.

`m1-fill-ci-policy.txt` retains an environment-only sandbox `spawnSync EPERM` failure. The subsequent committed-source focused run used the authorized execution environment and passed all 153 checks, including the same 28 policy tests; see the final acceptance records. Raw transcript whitespace is preserved intentionally.
