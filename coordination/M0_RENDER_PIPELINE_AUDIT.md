# M0.3 — Read-only source audit: WebGL submission pipeline

**State:** SOURCE-TRACED, browser behavior not yet reverified. 2026-11-02.
**Branch/owner:** `docs/m0-render-pipeline-audit` / independent read-only audit.
**Owned file:** this document only; no Viewer/Scene/Renderer source edits.

## Observed call graph (CesiumJS 1.146.0)

1. **Public Viewer to engine widget.** `packages/widgets/Source/Viewer/Viewer.js:509–547` constructs `CesiumWidget`, passing `contextOptions` and lifecycle/camera parameters. Viewer does **not** directly own a GPU context.
2. **Canvas to Scene.** `packages/engine/Source/Widget/CesiumWidget.js:315–346` creates `new Scene({ canvas, contextOptions, ... })`, sets up the camera and defaults to `new Globe(ellipsoid)`. `CesiumWidget.js:49–84` contains the requestAnimationFrame-driven render loop.
3. **WebGL-specific context initialization.** `packages/engine/Source/Scene/Scene.js:149–154` synchronously constructs `new Context(canvas, contextOptions)`, except the `SharedContext` branch. `packages/engine/Source/Renderer/Context.js:43–80` acquires a WebGL context, calls `gl.getParameter(...)`, and instantiates WebGL-bound shader/texture/uniform caches.
4. **Globe ownership.** `packages/engine/Source/Scene/Globe.js:49–79` creates `EllipsoidTerrainProvider`, `ImageryLayerCollection`, `GlobeSurfaceTileProvider` and `QuadtreePrimitive`. `Globe.js:981–990` forwards update; `Globe.js:1088–1098` forwards render.
5. **CPU terrain/imagery LOD and command generation.** `packages/engine/Source/Scene/QuadtreePrimitive.js:361–374` runs `tileProvider.beginUpdate`, selects visible tiles, calls `createRenderCommandsForSelectedTiles`, then `tileProvider.endUpdate`. `QuadtreePrimitive.js:1582–1588` calls `tileProvider.showTileThisFrame`. `packages/engine/Source/Scene/GlobeSurfaceTileProvider.js:684+` loads selected tile data and delays imagery until terrain bounds are sufficiently accurate; `GlobeSurfaceTileProvider.js:605–626` calls `addDrawCommandsForTile` for selected tiles. `GlobeSurfaceTile.js:60–83` stores imagery and vertex-array references.
6. **Command construction.** `GlobeSurfaceTileProvider.js:2804–2818` allocates/reuses `DrawCommand`; `GlobeSurfaceTileProvider.js:3277–3294` configures shader program, render state, mesh vertex array, uniform map and `Pass.GLOBE`. Commands are submitted to `frameState.commandList` (e.g. `GlobeSurfaceTileProvider.js:1551`).
7. **Pass sorting/depth and actual GPU submit.** `Scene.js:3403,3652` invokes `View.createPotentiallyVisibleSet`; `packages/engine/Source/Scene/View.js:287+` groups commands per frustum/pass. `Scene.js:2779+` executes render passes with uniform/camera state, and `Scene.js:3959` invokes Globe rendering. `packages/engine/Source/Renderer/DrawCommand.js:667–669` calls `context.draw(this, passState)`. `Context.js:1407+` issues WebGL drawing operations; `Context.js:1370,1393` includes `gl.drawElements`/`gl.drawArrays`.
8. **Precision/depth considerations.** `Scene.js:363–383` documents near/far ratios for multi-frustum vs logarithmic depth; `View.js:203–260` partitions work into frustums. These and terrain mesh positions/uniforms must be audited before porting depth semantics; do not assume a single WebGPU depth pass matches WebGL behavior.

## CPU vs GPU boundary

- **Preserve/reuse initially (CPU):** Viewer UI and camera input; ellipsoid/WGS84 transforms; terrain and imagery provider requests; quadtree tile traversal; visibility/LOD selection; frame-state organization; existing scene events.
- **WebGL-bound (requires a separate WebGPU path):** synchronous `Context` creation, WebGL shader programs/GLSL, vertex arrays/buffers/textures, `DrawCommand.execute → context.draw`, framebuffer/depth/transparency, render targets and GPU lifecycle.
- **Shared-file integration hotspots (one owner):** `Viewer.js`, `CesiumWidget.js`, `Scene.js`, `View.js`, `Context.js`, and the Globe command submission adapter. No independent subagent should write these concurrently.
- **Async initialization blocker for M0.4:** current `Viewer → CesiumWidget → Scene → Context` construction is synchronous; WebGPU adapter/device acquisition is asynchronous. A separately designed creation path is required; do not silently force `navigator.gpu` into the current `Context` constructor or alter default WebGL behavior.

## Verification and handoff

**Done:** source paths and call sites inspected at pinned version; no code modifications or invented APIs.
**Not yet done:** runtime GPU diagnostics, visual test, renderer compatibility and WebGPU implementation.
**Next step:** finish M0.2's actual WebGL build/browser regression, then choose the smallest backend opt-in and asynchronous bootstrap contract (M0.4) with a single integration owner. Do not start Globe/terrain shaders until M1.
