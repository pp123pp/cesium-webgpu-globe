# Live terrain evidence — verified subset

The actual successful run in `result.json` / `browser.txt` used native Cesium World Terrain and ArcGIS World Imagery. Five unchanged browser PNGs show regional Himalaya, oblique and near Everest, a top-down transition endpoint and the coordinate diagnostic. This is real quantized terrain and dynamic provider imagery, not a static texture on a sphere.

**Provenance limit:** the PASS report predates the newly added `groundFlight` block and the later center-wheel guard. It must not be cited as a PASS of the current entire terrain script or the pending real-terrain near-ground flight. `source-hashes.json` separates tested production files from saved checkpoint test files; the original untracked test did not have its own byte hash captured.

Verified results: 110 real terrain requests, 152 imagery requests; same-level edge discrepancies below 0.34 m; observed mixed LOD; no background/untextured pixels during four terrain level changes; 561/561 independent terrain-pick drape checks pass, while an actual approximately 1 km GPU mapping shift fails 535 samples. All 221 buffers / 304 imagery textures are released. See `coordination/handoffs/M1.3-live-terrain-checkpoint.md` for the full evidence boundaries and restart command.

Environment: Chrome 156.0.8078.4, 1280 × 720, headed Xvfb, Ubuntu 24.04, Google SwiftShader. Physical GPU is untested and explicitly waived as a blocker by the user.

Terrain: Cesium World Terrain, with native provider credits retained in the application. Imagery provider attribution recorded by the run: **Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community.** Browser canvas captures do not include the separate DOM credit display; attribution is preserved here and in the report. The coordinate-drape image uses the diagnostic generated tile provider solely to check alignment against native terrain picks.
