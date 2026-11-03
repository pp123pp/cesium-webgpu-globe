# Roadmap (dependency-driven, not calendar-driven)

| Stage | Prerequisite | Main result | Gate |
|---|---|---|---|
| M0 | clean repository | reproducible CesiumJS upstream + WebGL regression + minimal WebGPU | both renderers initialize separately |
| M1 | M0 | globe ellipsoid, imagery and terrain with correct depth/camera | space-to-surface camera and tile LOD correct |
| M2 | M1 | physical sky, Sun, night background, HDR | sun/atmosphere/terrain coherent across altitudes |
| M2.6.1 | M2.6 | focused polish of existing solar artwork and HDR presentation | visual comparisons pass without rendering regressions |
| M3 | M2 | spherical global volumetric clouds | clouds visible from orbit; camera can enter them |
| M4 | M3 | cloud shadows and terrain lighting coupling | geo-registered moving shadows and dimmed sunlight |
| M5 | M4 | image-quality stabilization, time stability, profiling | visual acceptance and WebGL no-regression |
| M6 (later) | V1.0 | common mesh-based 3D Tiles and BIM | representative mesh datasets render properly |

## M2.6.1 placement and boundary

M2.6.1 is a focused visual-polish task after the merged M2.6 solar implementation. It refines existing rays, halos, corona, authored tint and HDR bloom; it does not reopen M2.6 A07–A10 or introduce a new rendering subsystem. M3 remains the next major milestone. Optional cinematic lens effects are not a dependency of M3 and require a separate task.

## Strict scope gate
M0–M5 must **not depend on** implementing 3D Tiles, general GPU material engine, complex RenderGraph or full Cesium WebGPU coverage. Add abstraction only when two real consumers prove necessity. Each milestone: vertical slice → tests → demonstration → handoff.

## Task assignment protocol
Before coding: select **one** numbered bullet from `tasks/MX.md`, state owned files, output, acceptance test and whether it may run in parallel. If a task cannot be independently tested, split it further. Do not implement future milestones in the same PR.