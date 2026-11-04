# M2.6.1-B1 - Original baseline captures

Captured before B01/B02 changes from main commit `5cb8eda655314119fa5567e1b4c023e2c4217906`.

- Runtime bundle SHA-256: `554479fae644de144388930d5777eb98bf1f04086e327e3545d69356f4e9a876`.
- Browser: Chromium 156, headed; hardware reported Intel Xe-LPG. OS inventory: Intel Arc 130T, driver 32.0.101.8801.
- Actual WebGPU rendering; the initial successful run had clean source and no browser console/page errors.
- The low-orbit (A09) capture uses `2026-03-20T12:00:00Z`.
- The orbital-sunrise (A07) and exposure 0.5/1.0/2.0 (A10) captures use `2026-03-20T06:00:00Z`. The earlier README incorrectly grouped A10 with the noon A09 capture; the PNGs have not changed.
- These five images are 1920x1080 unmodified `window.__m1.pixels()` captures. The initial smoke also exercised resize and 120 frames, but those additional initial images were not preserved in this subset.

The [continuation verification](../continuation/README.md) adds matched baseline/B01-only/B02-only/combined captures with explicit per-image state and source hashes. Its historical version is a documented test-only replay of the original WGSL/R8 assets in a runtime whose non-B1 files remain unchanged, rather than a claim that the original five PNGs cover all new scenarios.
