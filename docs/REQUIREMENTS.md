# Requirements baseline v2.0

## Product boundaries

- CesiumJS 1.146.0 source as pinned upstream; maintain original WebGL functionality and behavior.
- Add independently selected WebGPU backend at Viewer construction; keep supported Cesium public APIs as compatible as practical.
- Scope: SceneMode.SCENE3D only. First release must support WGS84 ellipsoid, globe imagery, Terrain, camera navigation from orbital to ground, proper horizon/occlusion and LOD.
- Reuse Cesium ImageryProvider and TerrainProvider. Preserve tiled loading, data-source semantics and resource release. Multiple imagery layers should not be gratuitously removed from accepted globe functionality; detailed imagery-layer compatibility validated during M1.

## Visual specifications

- Atmosphere: Rayleigh/Mie, plausible multiple scattering, aerial perspective and continuous orbital-to-ground appearance; sunlight attenuation and horizon scattering.
- Sun: real solar position, plausible apparent angular size, Earth occlusion, HDR highlight and restrained Bloom. Distinguish atmospheric scattering from optional lens flare.
- Space background: star/cubemap appearance, no camera translation parallax, transitions appropriately into bright atmosphere. Moon/star positions need only look convincing; preserve scene skybox hooks where possible.
- Clouds: Earth-curved, geographically anchored procedural volumes, visible locally in every region on approach, fading to clear at far orbit. Zero coverage gives clear skies. Support coverage/wind settings, closeup and in-cloud detail, scattering, self-shadow and silver lining.
- Shadows: moving cloud shadows on Globe/Terrain in geodetic alignment; sunlight reduction and approximated ambient attenuation. 3D Tiles cloud receivers deferred.
- Output: HDR lighting and coherent tone mapping/exposure control so Sun, clouds, Earth and dark sky do not visually contradict.

## Nonfunctional

- No obvious double-precision jitter, tile discontinuity, depth conflict, horizon or shadow misregistration from space to ground.
- No severe flicker, ghosting or abrupt cloud density transitions during navigation.
- Preserve official WebGL functionality by regression tests.
- Quality over performance until a reference GPU/resolution/scene is specified; measure GPU pass times and memory, never promise fixed 30fps without baseline.
- New features only in WebGPU; no modification of WebGL output required.

## Deferred

- 3D Tiles 1.0/1.1 common mesh types, photogrammetry/BIM, needed Draco/KTX2, PBR/material lighting and cloud shadows on models: M7 (formerly M6).
- No point clouds, complete 3D Tiles extensions, metadata/picking/styling/classification/clipping, comprehensive Cesium primitives, real weather and modern GI/post effects in first release.

## Remaining acceptance decisions

Define target OS/browser/GPU/resolution, expected behavior when WebGPU is unavailable, exact imagery and terrain providers, fixed UE5 comparison views, and a representative 3D Tiles dataset **before their respective acceptance gates**. Do not block M0 on choices not needed yet.

## Approved extension: M6 Global Ocean — next priority

The owner requested M6 to begin next from the existing repository; M5's remaining work is not silently completed or discarded. The [M6 ocean plan](OCEAN_PLAN.md) and [design specification](superpowers/specs/2026-11-06-m6-global-ocean-design.md) define the extension, with [separate acceptance IDs](M6_ACCEPTANCE.md). The original V1.0 scope above remains traceable.

- Single main camera, desktop WebGPU, free navigation from orbit to any ocean region; oceans only, excluding inland lakes/rivers/reservoirs.
- Tidewater guides near-water visual quality and implementation study. Use multi-scale spectral waves and a camera-centered curved surface with geographic anchoring. Far/high views retain the existing imagery ocean color; near detail may appear progressively.
- Reuse scene sky, Sun and clouds. Approximate their reflected radiance and Sun glint; SSR is optional enhancement and never the sole environment-reflection path.
- Manual sea-state controls, no real-weather requirement. Display tides use controllable amplitude/period/phase and are not predictive real-world tidal data. Additional shoreline and bathymetry data are allowed.
- Cesium Clock is the single scene-time source. Wave/tide state follows the target time on a seek; historical foam/wetness may reset and rebuild with bounded work and progressive appearance. Pause, reverse and large time changes have explicit semantics.
- Deliver open ocean first (O0–O3), display tides (O4), coast/bathymetry data (O5), nearshore appearance (O6), and full underwater rendering **last (O7)**. Earlier minimal camera-medium/depth checks are integration safeguards, not an early full underwater milestone.
- Global basic coverage and data-dependent coastal/seabed detail are allowed. Never claim uniform high-resolution coast or seafloor coverage. No buoyancy, ship/wake/game-physics system or paid-service dependency is implied.
- Prioritize the target appearance, record cost as work proceeds, and conduct formal performance acceptance at O3/O6/O7 on recorded hardware/resolution. Follow the existing risk-based verification and physical-GPU rules.
