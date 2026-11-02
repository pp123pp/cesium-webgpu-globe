# Cesium WebGPU Globe

**Current state:** the full **official CesiumJS 1.146.0 source tree has been imported into this repository root**, pinned to upstream commit `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`. The project is now ready for **M0 baseline investigation and incremental WebGPU implementation**. **No WebGPU backend implementation or build/test result is claimed yet.**

## Purpose

Preserve Cesium's original WebGL backend and add a separately selected WebGPU backend, starting from real WGS84 Globe, ImageryProvider and TerrainProvider, then UE5-inspired atmospheric scattering, Sun and stars, HDR, curved volumetric clouds, and cloud shadows. **3D Tiles and BIM are intentionally postponed** to V1.1+.

## First steps (Codex)

1. Read [AGENTS.md](AGENTS.md) (short default instructions), [coordination/STATUS.md](coordination/STATUS.md), [ROADMAP.md](ROADMAP.md), and [tasks/M0.md](tasks/M0.md).
2. Check [coordination/UPSTREAM_REVISION.txt](coordination/UPSTREAM_REVISION.txt). Inspect actual Cesium files before changing APIs.
3. Use Node **>=22** and npm (the upstream root uses npm workspaces). Inspect `package.json` and upstream `.npmrc` before dependency install.
4. Validate the upstream WebGL build, tests and Viewer example; record exact commands and results in STATUS/handoff **before implementing WebGPU**.
5. Start with the smallest scoped M0 task. For independent subtasks, follow [coordination/WORKFLOW.md](coordination/WORKFLOW.md) for worktrees/subagents.

## Plan and docs

| Milestone | Deliverable |
|---|---|
| [M0](tasks/M0.md) | WebGL baseline and minimal WebGPU setup |
| [M1](tasks/M1.md) | V0.1 WGS84 Globe, Imagery and Terrain |
| [M2](tasks/M2.md) | V0.2 atmosphere, Sun, space background, Moon, HDR |
| [M3](tasks/M3.md) | V0.3 global volumetric clouds, self-shadow |
| [M4](tasks/M4.md) | V0.4 cloud shadows on Globe/Terrain |
| [M5](tasks/M5.md) | V1.0 quality, temporal stability, regression |
| [M6](tasks/M6.md) | V1.1+ 3D Tiles/BIM (deferred) |

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
