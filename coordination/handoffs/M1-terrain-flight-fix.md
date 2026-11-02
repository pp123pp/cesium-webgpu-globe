# M1 real-terrain flight continuation — 2026-11-02

## Reproduced failure and cause

The previously unexecuted ground-flight block was run against public checkpoint `8b37878` with real Cesium World Terrain and ArcGIS World Imagery. It failed the unchanged zero-hole assertion: 921,600 background pixels in a 1280×720 frame. A diagnostic repeat captured camera height 5,558.44 m and native cached height 5,267.21 m while drawing only coarse tile `5/47/11`; the next frame drew `12/6072/1410` and recovered. A separate repeat was collision-clamped to the coarse surface and settled 2,098.89 m above finer terrain, also correctly failing acceptance. All attempts are retained; a later pass does not erase them.

The adapter published an asynchronously created GPU mesh before initializing imagery associations and setting `tile.renderable`. Native `Globe.getHeight` could therefore use a finer surface one frame before quadtree traversal was allowed to render it. A focused CPU test reproduced exactly this inconsistent state. The mesh completion now immediately finishes the existing ready-tile load path, including imagery parent fallback and renderability, before another camera/selection frame. Native traversal, collision, Camera, WebGL and LOD rules are unchanged.

## Actual validation

- New atomic-readiness test: RED before fix; all nine tile-provider tests GREEN after it, including deferral, eviction, cancellation, reentrant error handling and upsampling.
- Full expanded real-terrain script: PASS after rebuilding the candidate. Native flight sampled 14 frames; **zero background and zero untextured pixels throughout**; final camera 33.58 m above the native terrain surface; settled levels 19–20. Original height/LOD/coverage assertions remain unchanged. Full-flight untextured coverage is now also asserted.
- Other live checks in that run pass: quantized terrain, actual imagery, full edge-knot adjacency comparisons, mixed LOD, four changing-source transitions, independent native-pick imagery alignment and its deliberately offset negative control, balanced destruction.
- Build and targeted ESLint passed. Environment: Chrome 156.0.8078.4, headed Xvfb, Google SwiftShader software GPU, Node 24.22.1. No physical GPU evidence.

Evidence: `coordination/evidence/M1/terrain-continuation/`, including original failures, first failing-frame screenshot, final actual screenshots, reports, unit RED/GREEN and source/bundle hashes. Diagnostic `heightSources` are captured after rendering and may already reflect endFrame loads; they do not claim pre-selection state. The dedicated readiness unit establishes the publication ordering directly.

The pinned installed proxy CA is a local environment setting only; hosted CI uses ordinary HTTPS verification. The workflow now runs this expanded terrain script against the PR's actual head and uploads its logs/screenshots even on failure. GitHub service errors remain failures. Final whole-source regression and hosted verification are still required before M1 acceptance.

Owner: root; files: WebGPU terrain adapter, terrain browser gate, provider tests, CI, this handoff and selected raw evidence. Next: integrate verified demo/API documentation, run all gates on final source, review, and update A03–A06.
