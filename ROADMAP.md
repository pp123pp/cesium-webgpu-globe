# Roadmap (dependency-driven, not calendar-driven)

| Stage                      | Prerequisite     | Main result                                                                                                                   | Gate                                                                              |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| M0                         | clean repository | reproducible CesiumJS upstream + WebGL regression + minimal WebGPU                                                            | both renderers initialize separately                                              |
| M1                         | M0               | globe ellipsoid, imagery and terrain with correct depth/camera                                                                | space-to-surface camera and tile LOD correct                                      |
| M2                         | M1               | physical sky, Sun, night background, HDR                                                                                      | sun/atmosphere/terrain coherent across altitudes                                  |
| M2.6.1                     | M2.6             | phased solar visual polish: disc/rays → halo/corona → HDR Bloom → atmospheric integration → integrated acceptance             | SVP-01–SVP-10 pass with matched WebGPU evidence; no rendering regressions         |
| M2.7 (optional, post-M5)   | M2.6.1 + M5      | advanced game-engine-quality solar rendering: richer photosphere / corona detail, adaptive quality and cross-device profiling | dedicated visual, temporal, occlusion and GPU-cost acceptance; not a V1.0 blocker |
| M2.8 (optional, post-M2.7) | M2.7             | cinematic optical effects: restrained lens flare, ghosts, dirt and anamorphic effects as opt-in presentation                  | independent optical-effects acceptance; disabled by default; not a V1.0 blocker   |
| M3                         | M2               | spherical global volumetric clouds                                                                                            | clouds visible from orbit; camera can enter them                                  |
| M4                         | M3               | cloud shadows and terrain lighting coupling                                                                                   | geo-registered moving shadows and dimmed sunlight                                 |
| M5                         | M4               | image-quality stabilization, time stability, profiling                                                                        | visual acceptance and WebGL no-regression                                         |
| M6 (later)                 | V1.0             | common mesh-based 3D Tiles and BIM                                                                                            | representative mesh datasets render properly                                      |

## M2.6.1 placement and boundary

M2.6.1 is a focused visual-polish task after the merged M2.6 solar implementation. It refines existing rays, halos, corona, authored tint and HDR bloom; it does not reopen M2.6 A07–A10 or introduce a new rendering subsystem. M3 remains the next major milestone. Optional cinematic lens effects are not a dependency of M3 and require a separate task.

## Advanced solar visual direction

The long-term visual target is **real-time solar rendering with mature game-engine visual quality while preserving Cesium's geospatial correctness**. The staged direction, reference implementations, architecture boundaries and future acceptance principles are documented in [Solar Rendering Vision](docs/SOLAR_RENDERING_VISION.md).

M2.6.1 remains the current, bounded polish task. B1–B5 are sequential review phases. B1 B01/B02 was visually accepted and merged through PR #21; B2 B03/B04 was visually accepted and merged through PR #22; B3 B06 HDR Bloom was visually accepted and merged through PR #23. B4 B05 Atmospheric Glow Integration was visually accepted by the user on 2026-11-04 and merged through PR #25 at `34f2571b80ee1854e4a7b8369c845aa506a0b24d`. B5 B07 static, temporal, performance and lifecycle acceptance were user-confirmed on 2026-11-04 and merged through PR #27 and PR #28. The SVP-01–SVP-10 evidence matrix is indexed in `coordination/evidence/M2.6.1/README.md`; final milestone closure still awaits the separately authorized WebGL differential. M2.7 and M2.8 are optional future tracks after M5: they must not delay or become prerequisites for M3 volumetric clouds, M4 cloud lighting, M5 stabilization or V1.0. They require separate task definitions and explicit authorization before implementation. No full RenderGraph, general PBR engine or broad renderer rewrite is implied.

## Strict scope gate

M0–M5 must **not depend on** implementing 3D Tiles, general GPU material engine, complex RenderGraph or full Cesium WebGPU coverage. Add abstraction only when two real consumers prove necessity. Each milestone: vertical slice → tests → demonstration → handoff.

## Task assignment protocol

Before coding: select **one** numbered bullet from `tasks/MX.md`, state owned files, output, acceptance test and whether it may run in parallel. If a task cannot be independently tested, split it further. Do not implement future milestones in the same PR.
