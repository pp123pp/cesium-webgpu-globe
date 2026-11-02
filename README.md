# Cesium WebGPU Globe

**Current state:** official CesiumJS **1.146.0** is pinned at upstream `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`. M0 is accepted. M1 implements a separately selected WebGPU WGS84 Globe with dynamic imagery and quantized terrain; its final A03–A06 acceptance is in progress on [PR #2](https://github.com/pp123pp/cesium-webgpu-globe/pull/2), dependent on unmerged PR #1. WebGL remains the default.

Build with `npm install` and `npm run build`, serve this directory, then open `Apps/WebGPUGlobe.html`. Read the [M1 API and usage guide](docs/WEBGPU_M1.md) for supported options, real Providers, navigation, errors and test commands. Current evidence is explicitly labeled software GPU.

## Purpose

Preserve Cesium's original WebGL backend and add a separately selected WebGPU backend, starting from real WGS84 Globe, ImageryProvider and TerrainProvider, then UE5-inspired atmospheric scattering, Sun and stars, HDR, curved volumetric clouds, and cloud shadows. **3D Tiles and BIM are intentionally postponed** to V1.1+.

## Continuing development

Read [AGENTS.md](AGENTS.md), [STATUS](coordination/STATUS.md), [ROADMAP](ROADMAP.md) and the active milestone task before editing. Follow [WORKFLOW](coordination/WORKFLOW.md), preserve existing results, and verify the current remote branch/PR head. Source is already imported; do not rerun import or restart M0. M1 is the only currently authorized scope; main merges and M2 need a separate instruction.

## Plan and docs

| Milestone         | Deliverable                                       |
| ----------------- | ------------------------------------------------- |
| [M0](tasks/M0.md) | WebGL baseline and minimal WebGPU setup           |
| [M1](tasks/M1.md) | V0.1 WGS84 Globe, Imagery and Terrain             |
| [M2](tasks/M2.md) | V0.2 atmosphere, Sun, space background, Moon, HDR |
| [M3](tasks/M3.md) | V0.3 global volumetric clouds, self-shadow        |
| [M4](tasks/M4.md) | V0.4 cloud shadows on Globe/Terrain               |
| [M5](tasks/M5.md) | V1.0 quality, temporal stability, regression      |
| [M6](tasks/M6.md) | V1.1+ 3D Tiles/BIM (deferred)                     |

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
