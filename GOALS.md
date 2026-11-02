# Product north star

Build a high-fidelity **CesiumJS WebGPU 3D Earth**, UE5-inspired visual quality, correctness before speed. Support globe from space to ground, imagery and Terrain, Sun with earth occlusion, realistic atmospheric scattering, starry sky, visually credible Moon, HDR and tone mapping, a spherical/global volumetric cloud field, cloud self-shadow and cloud shadow on Globe/Terrain. Preserve Cesium public API wherever used by the supported scope.

## Fixed decisions
- Clean upstream source baseline; **do not migrate previous custom renderer**.
- Official WebGL unchanged. Backend chosen at Viewer creation; no runtime switching.
- WebGPU first release supports only 3D globe mode.
- Use Cesium ImageryProvider / TerrainProvider data sources.
- Procedural global cloud distribution with coverage/wind controls.
- Real solar position, visually plausible Moon/stars; no astronomy-grade simulation.
- Accept approximate ambient occlusion by clouds; consistent visual lighting preferred over fully physical simulation.
- Image quality first. 30 fps acceptable but **no fixed target GPU/resolution yet**; do not claim performance acceptance until platform is fixed.
- 3D Tiles (1.0/1.1 mesh, Draco/KTX2), tilted photogrammetry, BIM deferred to V1.1+. Point clouds and full extensions are beyond first milestone.

## Not in V1.0
SSR, SSGI, Lumen, full engine PBR/lighting framework, real-world weather, rain/snow, ocean, full Entity/Primitive/Label support in WebGPU, runtime back-end hot swap, 2D and Columbus View, automated sync with all future Cesium releases.