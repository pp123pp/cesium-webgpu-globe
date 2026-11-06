# Cesium WebGPU Globe

**Current state:** M4 passed technical and user visual acceptance on 2026-11-06 and is integrated into local `main`. M3 is complete. The local volumetric cloud baseline and all [five visual enhancements](tasks/M3.md#planned-visual-enhancements) passed user visual acceptance on 2026-11-05. The WebGPU backend on CesiumJS **1.146.0** supports the WGS84 globe, imagery, terrain, physical sky and local clouds. WebGL is the default. Rapid real-terrain descent is a known M1 limitation (`M1-NAV-001`).

**Next development stage: [M6 Global Ocean](tasks/M6.md), starting at O0 / O0-01.** The owner prioritized freely explorable global oceans, with near-water appearance guided by [Tidewater](https://github.com/dgreenheck/tidewater), followed by tides, coasts and full underwater rendering last. See the [final phased plan](docs/OCEAN_PLAN.md), [current ocean task/status](coordination/M6-STATUS.md) and [AI continuation prompts](coordination/M6-AI-START.md). These are planning files; ocean runtime is not implemented yet. M5's remaining work stays open, and the former M6 3D Tiles/BIM stage moves to [M7](tasks/M7.md).

Build with `npm install` and `npm run build`, serve this directory, then open `Apps/WebGPUGlobe.html`. Read the [M1 API and usage guide](docs/WEBGPU_M1.md) for supported options, real Providers, navigation, errors and test commands. The [M3 baseline acceptance record](coordination/evidence/M3/cloud-appearance/README.md) includes matched cloud images captured on a physical Intel Xe-LPG GPU.

For a cloud-only demo, run `npm run demo:webgpu` and open [the cloud showcase](http://localhost:8067/Apps/WebGPUClouds.html). Select an effect to switch the camera and lighting, then collapse the panel for an unobstructed view.

For M4, open the [terrain cloud-shadow demo](http://localhost:8067/Apps/WebGPUCloudShadows.html) on the same server. It shows the Golden Gate Strait with live Esri World Elevation 3D terrain, Esri World Imagery and a local Natural Earth II imagery base layer. Pause the Cesium clock and toggle shadows to compare the same hillside. With shadows enabled, toggle ambient attenuation to isolate the smaller change in sky lighting. Scrub the native timeline or use the animation dial to follow the moving clouds. Use the height presets to move from 1.9 km through the cloud layer to 300 km. At a fixed time, compare the physical solar disk against the near-point and enlarged controls to inspect the shadow edge. [M4 acceptance images and regression results](coordination/evidence/M4/final-acceptance/README.md).

Open the [local demo index](http://localhost:8067/Apps/WebGPUIndex.html) for Globe, volumetric clouds, terrain cloud shadows, M5 reference scenes and the minimal WebGPU proof. The [M5 example](http://localhost:8067/Apps/WebGPUReferenceScenes.html) provides direct links to eight repeatable scenes, including a camera path that can be replayed or stepped one frame at a time. Its [Golden Gate terrain-shadow reference](http://localhost:8067/Apps/WebGPUReferenceScenes.html#terrain-shadow) uses the M4 camera and live Esri elevation and imagery.

## Online WebGPU demos

- [Interactive WebGPU Globe](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUGlobe.html)
- [WebGPU Proof (WGSL triangle)](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUProof.html)
- [Demo landing page](https://pp123pp.github.io/cesium-webgpu-globe/)

The published assets are generated on the `gh-pages` branch; [deployment guide](docs/GITHUB_PAGES.md).

## Purpose

Preserve Cesium's original WebGL backend and add a separately selected WebGPU backend, starting from real WGS84 Globe, ImageryProvider and TerrainProvider, then UE5-inspired atmospheric scattering, Sun and stars, HDR, curved volumetric clouds, and cloud shadows. **3D Tiles and BIM are intentionally postponed** to V1.1+.

## Continuing development

Read [AGENTS.md](AGENTS.md), [STATUS](coordination/STATUS.md), [ROADMAP](ROADMAP.md) and the active milestone task before editing. Follow [WORKFLOW](coordination/WORKFLOW.md), preserve existing results, and verify the current remote branch/PR head.

## Plan and docs

| Milestone         | Deliverable                                       | Progress                                                        |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| [M0](tasks/M0.md) | WebGL baseline and minimal WebGPU setup           | Integrated                                                      |
| [M1](tasks/M1.md) | V0.1 WGS84 Globe, Imagery and Terrain             | Integrated                                                      |
| [M2](tasks/M2.md) | V0.2 atmosphere, Sun, space background, Moon, HDR | Integrated                                                      |
| [M3](tasks/M3.md) | V0.3 local volumetric clouds, self-shadow         | Complete. Baseline and all five enhancements visually accepted. |
| [M4](tasks/M4.md) | V0.4 cloud shadows on Globe/Terrain               | A14/A15 visually accepted; full WebGL differential passed       |
| [M5](tasks/M5.md) | V1.0 quality, temporal stability, regression      | Tasks 1–2 complete locally; other work remains open              |
| [M6](tasks/M6.md) | Global ocean: open sea → tides/coasts → underwater | **Next priority. O0 / O0-01; implementation NOT_STARTED**        |
| [M7](tasks/M7.md) | V1.1+ 3D Tiles/BIM (formerly M6)                  | Deferred                                                        |

- [Product scope](docs/REQUIREMENTS.md) · [Acceptance criteria](docs/ACCEPTANCE.md)
- [Source and provenance](docs/SOURCE_BASELINE.md) · [Team workflow](coordination/WORKFLOW.md)
- [Context handoff template](coordination/HANDOFF_TEMPLATE.md)
- [M6 ocean plan](docs/OCEAN_PLAN.md) · [Ocean acceptance](docs/M6_ACCEPTANCE.md) · [AI entry](coordination/M6-AI-START.md)

## Upstream source

- Official repository: https://github.com/CesiumGS/cesium
- Pinned release: https://github.com/CesiumGS/cesium/releases/tag/1.146
- Exact imported revision is tracked in `coordination/UPSTREAM_REVISION.txt`.
- Imported source retains CesiumJS licensing notices; see [LICENSE.md](LICENSE.md).
- [Import workflow](.github/workflows/import-cesium.yml) is a guarded, one-time importer; do not rerun it after code modifications.

## Research references

- [Unreal Engine Sky Atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine)
- [Unreal Engine Volumetric Cloud](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine)
- [Bruneton atmosphere reference](https://github.com/ebruneton/precomputed_atmospheric_scattering)

External reference implementations are not automatically cleared for code copying: verify license and attribution.
