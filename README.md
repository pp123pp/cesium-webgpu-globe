# Cesium WebGPU Globe

A **development plan and Codex execution kit**, not a finished renderer. Starting from official CesiumJS **1.146.0** source; preserve existing WebGL while adding an independent WebGPU backend for 3D Globe.

**Priority:** Globe + imagery + Terrain → physical atmosphere, Sun and space sky → volumetric clouds → cloud shadows → quality/stability → (later) 3D Tiles/BIM.

## Start here

1. Read [AGENTS.md](AGENTS.md), [ROADMAP.md](ROADMAP.md), and [coordination/STATUS.md](coordination/STATUS.md).
2. Read [docs/SOURCE_BASELINE.md](docs/SOURCE_BASELINE.md); import and verify official Cesium source. `scripts/import-cesium-1.146.ps1` is an **optional** source-import helper, and does not run until you execute it.
3. Open the current milestone, initially [tasks/M0.md](tasks/M0.md). Complete the smallest independently verifiable task first.
4. Use worktrees and subagents **only** for disjoint files/tasks. Follow [coordination/WORKFLOW.md](coordination/WORKFLOW.md).
5. Keep state in `coordination/STATUS.md`; use `coordination/HANDOFF_TEMPLATE.md` when context gets large.

| Milestone | Deliverable |
|---|---|
| M0 | clean upstream + WebGL baseline + minimal WebGPU triangle/depth |
| M1 | V0.1 Globe, imagery, Terrain, camera, precision |
| M2 | V0.2 atmosphere, Sun, skybox, Moon, HDR |
| M3 | V0.3 spherical volumetric clouds |
| M4 | V0.4 terrain cloud shadows and lighting |
| M5 | V1.0 visual and regression verification |
| M6 | V1.1+ mesh-based 3D Tiles, BIM; **not a V1.0 blocker** |

## Key references

- [CesiumJS official releases](https://github.com/CesiumGS/cesium/releases)
- [UE Sky Atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine)
- [UE Volumetric Cloud](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine)
- [Bruneton scattering reference](https://github.com/ebruneton/precomputed_atmospheric_scattering)

Reference implementations are for research, **not automatically approved to copy**. Check their license and compatibility before adapting code.