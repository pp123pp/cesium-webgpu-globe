# M1 implementation and acceptance plan

M0.5 is accepted locally at published commit `7a689426af4b4b5f9c510d91e68ff45623f20090`; PR #1 remains unmerged. Full WebGL comparison retains the same 12 inherited failures on both sides. The user waived unavailable physical GPU testing as a blocker; software evidence remains explicitly labeled.

**Branch:** `feat/m1-wgs84-globe`, separate PR targeting `feat/m0-webgpu-backend` until M0 merges. **Owner:** root is the sole integrator for Viewer, widget, scene/globe submission and STATUS. At most one independent feature implementer and one read-only reviewer. No M2, sky, atmosphere, clouds, 3D Tiles or generic render graph.

## Source audit and design

- Keep the native WGS84 `Globe`, `Camera`, `PerspectiveFrustum`, `ScreenSpaceCameraController`, `TweenCollection` and `QuadtreePrimitive`. Replace the Globe's private surface adapter only for this separately constructed WebGPU scene. Never invoke the native WebGL Scene/context or allocate a hidden WebGL canvas.
- Preserve provider data, request scheduling, geometric error, visibility, horizon culling, fallback, replacement queue and CPU mesh workers. Upload `TerrainMesh` after `createMesh`; retain its skirts, encoding, bounds and index width.
- Decode positions relative to the mesh center. Transform that center with the camera view in CPU double precision before uploading floats. Bake reversed WebGPU depth into the projection in double precision; use `depth32float`, `greater`, and clear zero.
- Reuse `ImageryLayerCollection`, native layer/terrain overlap and imagery LOD skeletons, reference counting and parent fallback. Adapt the texture state to WebGPU; preserve geographic/Mercator coordinates, north/south orientation, multiple layers, alpha, visibility, ordering and removal.
- Preserve M0's triangle proof through explicit `globe: false`; the WebGPU Globe path exposes the supported native camera/globe APIs. WebGL remains the default. Unsupported features fail explicitly.
- Real offline Natural Earth TMS supplies geographic imagery at levels 0–2. Native quantized fixtures provide parser/encoding/upsample coverage. A coherent real terrain service is probed before selecting A05 evidence; a single duplicated test tile cannot prove adjacent-LOD correctness.

## Ordered slices and gates

1. **M1.1 — source audit, WGS84/precision foundation (A03).** Root owns new `WebGPUScene`, `WebGPUGlobeTileProvider`, `WebGPUGlobeRenderer` and the small Viewer/widget/context integration. Independent owner may implement only `WebGPUGlobeMath` and its numerical tests in a separate worktree. Output: real WGS84 terrain meshes, native camera/frustum/navigation, horizon and reversed depth. Tests: numerical RED/GREEN cases, native CPU mesh decoding, browser orbital silhouettes/rotations, zero WebGL contexts, original M0 proof and WebGL smoke.
2. **M1.2 — dynamic imagery (A04).** Root owns new `WebGPUImagery` adapter and renderer bindings. Output: actual ImageryProvider requests, native overlap/LOD, parent fallback, texture upload and layer lifecycle. Tests: Natural Earth tiles/levels change during navigation; geographic/Mercator orientation; layer alpha/show/order/removal; delayed/failed requests; no late upload after removal.
3. **M1.3 — real terrain (A05).** Root extends the same narrow tile adapter with provider availability, deferred requests/workers and native upsampling. Independent fixture tests may run separately. Output: ellipsoid and quantized-mesh providers with real heights, imagery alignment, adjacent edges and stable parent/child transitions. Tests: 16/32-bit indices, quantization, skirts, metadata availability, real neighboring tiles/LOD and crack checks. Do not present synthetic or duplicated single-tile fixtures as real terrain acceptance.
4. **M1.4 — navigation, regression and evidence (A06).** Root owns browser harness, demo, CI, task/status/handoff. Output: orbit-to-ground flight, resize, data/texture churn, bounded resource lifetimes and a reviewable PR. Tests: high latitude/dateline, meter-scale movement, near/far occlusion, native input/flight, provider replacement, destroy during pending requests, cache eviction, screenshots and frame diagnostics; build, focused units, 17 M0 proof checks, non-WebGL suite and complete WebGL differential.

Each slice ends in a small reviewable commit with commands/results, residual risks and next action. Browser evidence must contain browser/GPU identity, viewport, provider identity and requested tile keys, source commit/tree, readiness, draw/load statistics and validation errors. Screenshots must come from the actual renderer. Performance is observational on SwiftShader; physical performance remains unmeasured and nonblocking under the user's instruction.

## Progress

- [x] Read M1, REQUIREMENTS and ACCEPTANCE after the M0.5 local gate passed.
- [x] Audit actual provider/mesh/imagery boundaries and existing offline assets.
- [x] Create isolated M1 branch/worktree from the published accepted M0 tree.
- [ ] M1.1 / A03 accepted.
- [x] M1.2 / A04 accepted locally; actual provider/browser evidence in `coordination/evidence/M1/imagery/`.
- [ ] M1.3 / A05 accepted.
- [ ] M1.4 / A06 and WebGL regression accepted; evidence and dependent PR published.
