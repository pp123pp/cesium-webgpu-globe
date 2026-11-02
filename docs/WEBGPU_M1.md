# M1 WebGPU Globe API and usage

M1 adds a separately selected WebGPU renderer to official CesiumJS 1.146.0. It reuses native WGS84 Globe, Camera, terrain/imagery Providers, quadtree traversal, workers, request scheduling and layer collections. WebGL remains the default. The supported WebGPU surface is listed below; this is not the complete Cesium Viewer/Scene API.

## Run the demonstration

Use Node 22 or newer and the repository's npm workspaces:

```sh
npm install --no-audit --no-fund
npm run build
python3 -m http.server 8090 --bind 127.0.0.1
```

Open `http://127.0.0.1:8090/Apps/WebGPUGlobe.html` in a browser that exposes WebGPU. A secure context (HTTPS or localhost) is required. The default scene requests the bundled Natural Earth TMS tiles and uses native ellipsoid terrain, without external credentials. Drag to orbit, scroll to zoom and Ctrl-drag to tilt. **Load real terrain** requests Cesium World Terrain and ArcGIS World Imagery; **Everest** and **Orbit** navigate with native `camera.flyTo`.

Real services require network access and applicable service credentials/authorization. The upstream development ion token is intended for evaluation and may display its notice; use your own authorized `Cesium.Ion.defaultAccessToken` for an application. The demo preserves native provider and per-tile attributions. Provider-initialization failures remain visible and retryable in the demo. Subsequent tile failures are reported through the native Provider error events described below. Device loss is terminal and requires a fresh Viewer.

## Create a Globe

```js
const viewer = new Cesium.Viewer("cesiumContainer", {
  renderingBackend: "webgpu",
});
viewer.renderError.addEventListener((source, error) => {
  console.error(error);
});
await viewer.readyPromise;
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(20, 20, 20000000),
  orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
});
```

Wait for `readyPromise` before normal rendering/navigation. This promise covers GPU initialization; it does not mean every Provider tile is loaded. Native `globe.tileLoadProgressEvent` and `globe.tilesLoaded` describe tile progress. Dispose the Viewer when its container/page is removed, including while initialization or Provider requests are pending.

### Constructor options

| Option                            | Supported value and meaning                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderingBackend`                | `"webgpu"` opts in; omission or `"webgl"` preserves the native WebGL path. Backend selection is fixed at construction.                                                       |
| `sceneMode`                       | Omitted or `Cesium.SceneMode.SCENE3D`.                                                                                                                                       |
| `globe`                           | Omitted/`true` creates WGS84; a fresh, unowned native `Globe` is accepted. `false` selects the retained M0 triangle/depth proof and disallows terrain/clock/imagery options. |
| `terrainProvider`                 | A ready native TerrainProvider with the same ellipsoid as the Globe. Default: `EllipsoidTerrainProvider`.                                                                    |
| `baseLayer`                       | Native `ImageryLayer`, or `false` for no imagery. Default: bundled Natural Earth TMS.                                                                                        |
| `clock`                           | Native `Cesium.Clock`.                                                                                                                                                       |
| `useDefaultRenderLoop`            | Boolean; defaults to `true`. With `false`, the application calls `resize()` and `render()`.                                                                                  |
| `useBrowserRecommendedResolution` | Boolean; defaults to `true`, matching the widget's CSS-pixel behavior.                                                                                                       |

Standard UI/sky options `skyBox`, `skyAtmosphere`, `animation`, `baseLayerPicker`, `fullscreenButton`, `vrButton`, `geocoder`, `homeButton`, `infoBox`, `sceneModePicker`, `selectionIndicator`, `timeline`, `navigationHelpButton`, `projectionPicker` and `shadows` may be passed only as `false`. They are not constructed by this backend. Other non-undefined constructor options throw explicitly. In particular, constructor options `terrain`, `requestRenderMode`, `targetFrameRate` and `resolutionScale` are not accepted; change `viewer.resolutionScale` after construction instead.

## Dynamic native Providers

```js
const terrain = await Cesium.createWorldTerrainAsync({
  requestVertexNormals: false,
  requestWaterMask: false,
});
const imagery = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
);
if (!viewer.isDestroyed()) {
  viewer.terrainProvider = terrain;
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(imagery);
}
```

Provider replacement cancels/releases the previous terrain generation and guards late completions. New root data must load; replacement itself does not promise a continuous picture across different datasets. In ordinary terrain LOD transitions, native parent imagery and connected `TerrainFillMesh` geometry preserve coverage while descendants load. Loaded parent terrain stays visible until a selected finer real mesh can anchor the neighboring fills. The adapter uses conservative current/ancestor/fill bounds during selection and releases temporary fill buffers when real terrain arrives. Per-tile dataset credits are published for the terrain providing coverage, including an ancestor fallback.

The verified terrain paths are native ellipsoid terrain and CesiumTerrainProvider quantized-mesh terrain, including native skirts, quantization, availability/upsampling and GPU index width handling. CPU fixture coverage also exercises other mesh encodings; it is not a claim of rendered acceptance for every TerrainProvider implementation.

Imagery uses real Provider tile requests, native geographic/Web Mercator tiling and level selection. The tested paths include local TileMapServiceImageryProvider and live ArcGisMapServerImageryProvider, polar/Mercator mapping, rectangle coverage, multiple layers, ordering, `show`, numeric `alpha`, removal and cancellation. Call the normal `ImageryLayerCollection` add/remove/raise/lower methods. Arbitrary imagery color adjustments and every third-party provider are not certified by M1.

## Supported runtime surface

| Surface              | M1 behavior                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `viewer.camera`      | Native 3D `Camera`: `setView`, `lookAt`, `lookAtTransform`, `flyTo`, rotations, movement, picking rays and perspective frustum. Use **`viewer.camera.flyTo`**; the high-level entity/tileset `viewer.flyTo` is outside M1.                                   |
| `viewer.scene.globe` | Native Globe with WebGPU surface adapter. `show`, `baseColor`, `backFaceCulling`, `showSkirts`, tile cache/error/loading controls, `getHeight`, `pick`, load/terrain-change events and imagery collection are retained.                                      |
| Terrain height       | `Globe.getHeight` samples available native meshes; it is not a remote most-detailed-height query. Camera destination heights are above the ellipsoid, not automatically above terrain. Native collision may raise a position below currently loaded terrain. |
| Scene/clock          | Native `Clock`, camera controller/tweens, `preUpdate`, `postUpdate`, `preRender`, `postRender`, `renderError`; SCENE3D only.                                                                                                                                 |
| Sizing/rendering     | `viewer.resize()`, `forceResize()`, `render()`, `useDefaultRenderLoop`, `useBrowserRecommendedResolution`, and positive finite `resolutionScale`.                                                                                                            |
| Lifecycle            | `readyPromise`, `isDestroyed()`, `destroy()`, canvas/container access and native credit display. Pending requests and GPU resources have explicit disposal.                                                                                                  |
| Diagnostics          | `scene.debugStatistics` exposes selected levels, queues and GPU resource counts for this prototype. It is diagnostic data, not a stable cross-backend API.                                                                                                   |

The Globe owns the passed native Globe and its imagery layers; use a fresh Globe per Viewer. There is no backend hot switch or hidden WebGL rendering canvas.

## Errors and limits

Unsupported WebGPU, adapter/device initialization failure, GPU validation failure, render failure or device loss reports an error; there is no silent fallback. Render/device failure stops the loop and releases scene/device resources. Destroy the failed Viewer and create another to recover. `scene.rethrowRenderErrors = false` suppresses the immediate synchronous rethrow, but does not make a failed GPU context usable again.

M1 does not implement entities/data sources, primitives/models/3D Tiles/BIM, scene morphing, 2D/Columbus View, picking GPU depth, atmosphere, Sun/sky, clouds, HDR, lighting/water effects, shadows, material/clipping/translucency systems, terrain exaggeration, or general post-processing. Unsupported Viewer members and the explicitly checked constructor/scene options throw. Some inherited native Globe/layer properties still exist without an implemented effect; this does not imply support, and not every such property is guarded.

## Reproduce validation

After `npm run build`, serve this checkout on port 8090:

```sh
node coordination/ci/m1-tile-provider.test.mjs
M1_BASE_URL=http://127.0.0.1:8090/ xvfb-run -a node coordination/ci/m1-globe-smoke.mjs
M1_BASE_URL=http://127.0.0.1:8090/ xvfb-run -a node coordination/ci/m1-imagery-smoke.mjs
M1_BASE_URL=http://127.0.0.1:8090/ xvfb-run -a node coordination/ci/m1-terrain-smoke.mjs
M1_BASE_URL=http://127.0.0.1:8090/ xvfb-run -a node coordination/ci/m1-navigation-smoke.mjs
M1_BASE_URL=http://127.0.0.1:8090/ xvfb-run -a node coordination/ci/m1-demo-smoke.mjs
```

For TypeScript, generate the native declarations before the full upstream check:

```sh
npm run build-ts
npm exec --package=typescript --offline -- tsc --project packages/sandcastle/templates/tsconfig.lib.json
npm run tsc
```

Browser gates record source/bundle identity, viewport, adapter/browser, screenshots and actual results. `M0_BROWSER_EXECUTABLE` selects an installed Chromium; default software mode uses SwiftShader. No physical GPU performance claim follows from software results. Hosted CI additionally runs the M0 proof, full non-WebGL suite, exact WebGL visual comparison and complete WebGL differential. See [A03–A06 acceptance](ACCEPTANCE.md), [STATUS](../coordination/STATUS.md) and the M1 handoffs for actual outcomes and inherited upstream failures.
