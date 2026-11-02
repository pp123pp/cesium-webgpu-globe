# Navigation evidence — 2026-11-02

`result.json` and `browser.txt` are the actual successful Chrome 156 / Xvfb / Google SwiftShader run. All ten PNGs are unchanged browser captures. The physical GPU requirement was explicitly waived; these files are software GPU evidence.

- Native WGS84 rotations across dateline and poles: at least 99.81% analytic silhouette agreement.
- Actual far-side GPU draws: correct reversed depth changes zero front-frame pixels; deliberately using `always` changes 231,214 pixels. Restoring depth restores identical pixels.
- Native flight from 40,000 km to 10 m, plus default render loop, actual mouse drag/wheel, resize, metre/quarter-metre motion and bounded repeated waypoint churn.
- Actual GPU observations: 420 buffers and 49 textures created and destroyed; zero remaining after teardown. Renderer imagery-only counters separately count 44 textures; the independent total includes depth attachments.
- `failures/center-wheel-deterministic-red.*` retains the real zero-axis wheel failure. The successful run exercises the same case after the scoped controller fix and preserves invalid public rotation rejection.

`source-hashes.json` records the identical tested/integrated production tree and the separate test commit. Different worktree dependency paths embedded by esbuild produce different bundle bytes; the browser checked the served isolated bundle against its local bundle. No claim is made that the later integration build was byte-identical.

The provider is native ellipsoid terrain with the bundled Natural Earth TMS imagery. It is deliberately too coarse for metre-scale visual landmark tracking; metre-scale evidence is actual rendered coverage, stationary pixels and Float32 uploaded-uniform agreement with native double projection. The separate live terrain checkpoint does not yet include its newly added near-ground flight.

See `coordination/handoffs/M1.4-navigation-tests.md` for commands and `coordination/handoffs/M1-pause-checkpoint.md` for remaining work. This bounded resource test does not claim M5/A17 duration soak.
