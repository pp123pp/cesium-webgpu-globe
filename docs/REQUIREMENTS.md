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

- 3D Tiles 1.0/1.1 common mesh types, photogrammetry/BIM, needed Draco/KTX2, PBR/material lighting and cloud shadows on models: M6.
- No point clouds, complete 3D Tiles extensions, metadata/picking/styling/classification/clipping, comprehensive Cesium primitives, real weather and modern GI/post effects in first release.

## Remaining acceptance decisions

Define target OS/browser/GPU/resolution, expected behavior when WebGPU is unavailable, exact imagery and terrain providers, fixed UE5 comparison views, and a representative 3D Tiles dataset **before their respective acceptance gates**. Do not block M0 on choices not needed yet.
