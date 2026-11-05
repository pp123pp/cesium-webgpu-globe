# Cesium WebGPU Globe

**Current state:** M3 local volumetric clouds passed user visual acceptance on 2026-11-05. The WebGPU backend on CesiumJS **1.146.0** supports the WGS84 globe, imagery, terrain, physical sky and local clouds. WebGL is the default. Rapid real-terrain descent is a known M1 limitation (`M1-NAV-001`).

Build with `npm install` and `npm run build`, serve this directory, then open `Apps/WebGPUGlobe.html`. Read the [M1 API and usage guide](docs/WEBGPU_M1.md) for supported options, real Providers, navigation, errors and test commands. The [M3 acceptance record](coordination/evidence/M3/cloud-appearance/README.md) includes matched cloud images captured on a physical Intel Xe-LPG GPU.

## Online WebGPU demos

- [Interactive WebGPU Globe](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUGlobe.html)
- [WebGPU Proof (WGSL triangle)](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUProof.html)
- [Demo landing page](https://pp123pp.github.io/cesium-webgpu-globe/)

The published assets are generated on the `gh-pages` branch; [deployment guide](docs/GITHUB_PAGES.md).

## Purpose

Preserve Cesium's original WebGL backend and add a separately selected WebGPU backend, starting from real WGS84 Globe, ImageryProvider and TerrainProvider, then UE5-inspired atmospheric scattering, Sun and stars, HDR, curved volumetric clouds, and cloud shadows. **3D Tiles and BIM are intentionally postponed** to V1.1+.

## Continuing development

Read [AGENTS.md](AGENTS.md), [STATUS](coordination/STATUS.md), [ROADMAP](ROADMAP.md) and the active milestone task before editing. Follow [WORKFLOW](coordination/WORKFLOW.md), preserve existing results, and verify the current remote branch/PR head. M4 terrain cloud shadows are planned for a separately assigned task.

## Plan and docs

| Milestone         | Deliverable                                       | Progress                                                                               |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [M0](tasks/M0.md) | WebGL baseline and minimal WebGPU setup           | Integrated                                                                             |
| [M1](tasks/M1.md) | V0.1 WGS84 Globe, Imagery and Terrain             | Integrated                                                                             |
| [M2](tasks/M2.md) | V0.2 atmosphere, Sun, space background, Moon, HDR | Integrated                                                                             |
| [M3](tasks/M3.md) | V0.3 local volumetric clouds, self-shadow         | [Visually accepted on 2026-11-05](coordination/evidence/M3/cloud-appearance/README.md) |
| [M4](tasks/M4.md) | V0.4 cloud shadows on Globe/Terrain               | Planned next                                                                           |
| [M5](tasks/M5.md) | V1.0 quality, temporal stability, regression      | Planned                                                                                |
| [M6](tasks/M6.md) | V1.1+ 3D Tiles/BIM                                | Deferred                                                                               |

- [Product scope](docs/REQUIREMENTS.md) · [Acceptance criteria](docs/ACCEPTANCE.md)
- [Source and provenance](docs/SOURCE_BASELINE.md) · [Team workflow](coordination/WORKFLOW.md)
- [Context handoff template](coordination/HANDOFF_TEMPLATE.md)

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
