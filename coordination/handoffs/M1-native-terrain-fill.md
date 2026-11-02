# M1 continuation: native fill geometry and real ground flight

Date: 2026-11-02. Integration owner: root. Scope: M1/A05/A06 only. PR #2 remains dependent on unmerged PR #1; no main merge or M2 work.

## Problem and correction

The expanded real-terrain flight exposed a full-frame terrain hole on the earlier candidate. Atomic mesh/GPU readiness fixed one race but did not preserve a loaded fine descendant when native traversal kicked its pending siblings back to a coarse parent. A clipped-ancestor experiment then exposed internal child boundaries without matching skirts. Both failed approaches remain in `coordination/evidence/M1/terrain-fill/`.

The adapter now uses Cesium's native `TerrainFillMesh` CPU edge propagation and geometry. `TerrainFillMesh.js` has one optional resource factory; the default WebGL allocation branch is unchanged. Fill buffers are owned independently, released on real mesh arrival, eviction, provider replacement and destruction. Native imagery state processing supports its existing `skipLoading` contract during fill construction.

Selection keeps the native meaning of `tile.renderable`: a real uploaded mesh. An optional `canRenderWithFills` provider hook in `QuadtreePrimitive` lets WebGPU retain already selected real fine meshes and fill their pending neighbors. A subtree containing only fills falls back to its loaded parent, even when those fills were rendered in the previous frame. Providers without the hook retain the original `anyWereRenderedLastFrame` behavior. This fixes the observed disconnected all-fill selection after cache eviction without changing default WebGL policy.

Selection bounds conservatively include current native terrain, a loaded ancestor and the previous fill, which is rebuilt only after selection. A stale low fill cannot cull its own future update. The next real mesh restores normal native bounds. Geometry and imagery use the same half-open internal clipping rule, eliminating a separate untextured boundary pixel caused by mismatched clipping.

## Actual verification

- Native CPU regression suite: **8/8 PASS**, with retained RED cases for pure pending subtrees, previous-fill eviction and conservative bounds. It exercises real quadtree traversal, native heightmap/fill meshes, native ray picking, unavailable-child upsampling, neighbor edge agreement below one centimetre, and exactly-once resource ownership.
- Imagery regression adds the native cached-imagery `skipLoading` case. Scene event fixtures use the adapter's real begin/end update contract.
- Full live terrain candidate: **PASS** in `m1-native-fill-eviction-live/result.json`. Chrome 156.0.8078.4, Google SwiftShader software GPU, Xvfb, 1280×720. Actual World Terrain quantized meshes and ArcGIS World Imagery; 444 terrain and 653 imagery requests, no provider errors.
- Four LOD transitions: **zero background and zero untextured pixels**. The final successful candidate did not need the narrowly documented software raster exception.
- Space-to-ground flight: **18 observed frames**, zero background/untextured pixels, final camera 5299.6816 m above ellipsoid and terrain 5266.1022 m, **33.5793 m above ground**, levels 19–20.
- Independent native-pick imagery drape: **561/561 PASS**. Deliberately shifting GPU imagery mapping east by 1 km fails **535/561** samples.
- Destruction: **1360/1360 buffers**, **440/440 textures**, zero retained GPU bytes, pending requests, active textures or canvases.
- Independent reviewer found no remaining definite Critical/Important issue in the final native-fill/resource/selection/bounds change. Final committed-source full non-WebGL/WebGL and all browser gates are still required after this slice.

The candidate report honestly records a dirty working tree. `candidate-source.json` binds its files and bundle; it is not evidence for a later untested HEAD.

## Visual acceptance clarification

The user explicitly requested that images need not be completely identical. `docs/ACCEPTANCE.md`, `tasks/M1.md` and the M1 plan now allow differences that do not materially affect rendering or normal use. They retain the functional and regression gates.

Earlier fill experiments produced 4 and 7 isolated background pixels, each covered by native CPU triangles. Frozen no-cull, geometry-only and depth-disabled controls retained them. A minimal independent WebGPU program reproduced all pixels with both index widths, unindexed drawing, CPU-projected clip coordinates and identity-matrix NDC input. Reordering triangle indices did not remove them. This supports a software raster coverage limitation; the exact browser-internal cause was not established.

The terrain oracle records such a difference only on the observed SwiftShader environment at 1280×720, at most eight pixels, each intersecting a selected fill, and no connected component larger than two pixels. Settled views still require complete coverage. CPU tests reject uncovered geometry, real-mesh gaps, large/connected holes, incomplete samples, unknown hardware and missing imagery. This is a bounded recorded visual difference, not a generic tolerance for terrain defects. The later real 47,118/68,261-pixel gaps and excessive collision height failed and were fixed before the passing run.

## Reproduction and next action

Use the normal terrain command documented in `docs/WEBGPU_M1.md`. The retained minimal replay can be run with the local server on port 8090:

```bash
xvfb-run -a node coordination/evidence/M1/terrain-fill/m1-fill-replay.mjs
```

It writes `Build/m1-fill-replay-combined.json` and does not alter production rendering. The variant named `cpu-clip` performs CPU matrix projection into clip coordinates, not geometric clipping.

Next: run final build/lint/types, all focused suites, M0/M1 browser gates and complete non-WebGL/WebGL differential on the committed final source; publish evidence and update A03–A06. Retain the same inherited WebGL baseline failures. Only then make PR #2 ready for review and stop at M1.

## Subsequent committed-source repeat

The candidate PASS above was not the final conclusion: `5877be7` later reproduced an intermittent fast descent into a coarse real mesh, despite four normal LOD transitions remaining fully covered. The user explicitly permits this repeatedly unresolved navigation issue to remain nonblocking. `M1-NAV-001` and the original failed report/screenshots are retained in `../evidence/M1/final-navigation-issue/`; do not describe A06 as unconditionally passed. The native-fill corrections and their actual tests remain valid, and the remaining final gates continue.
