# M2.1 — shared planet mathematics and depth

**M2.2 continuation:** the historical foundation contract below remains in
force. [Physical atmosphere](WEBGPU_M2.2.md) now consumes these helpers and
readable depth, adds its own LUTs/uniforms and a separate color-composite pass.
Its radial density height and spherical LUT approximation supplement the
boundary error discussion below. M2.1's acceptance record is preserved.

This is the foundation for task 1 in `tasks/M2.md`. It supplies coordinates,
units, time-dependent solar direction, ray intervals, a CPU/WGSL frame interface
and readable scene depth. It does not render atmosphere, a Sun disk, stars, the
Moon or HDR. A07–A10 belong to later M2 work and are not accepted by this task.

## Coordinate and precision contract

All world positions use WGS84 Earth-centered, Earth-fixed axes: X through
longitude 0° at the equator, Y through longitude 90° east, Z through the north
pole. Distances are **meters**, including ray parameters, terrain vertices,
camera height, clipping planes and atmosphere boundaries. Directions are
dimensionless unit vectors. No JavaScript/WGSL kilometer conversion is implicit.

The native `Camera.positionWC`, `viewMatrix` and perspective frustum remain the
authority, including when `Camera.transform` is a local reference frame. Eye
space looks along negative Z. Matrices use Cesium's column-major convention.

M1 terrain still uses `decodeTerrainMesh` and `computeRelativeViewProjection`:
subtract the tile center and cancel the Earth-sized camera translation in CPU
double precision before uploading float32 vertices/matrices. The new state does
not change terrain encoding, tile positions, camera control or LOD selection.

`WebGPUPlanetState` separately uses native `EncodedCartesian3` for camera ECEF
position. For an encoded world point, WGSL computes
`(pointHigh - cameraHigh) + (pointLow - cameraLow)`. Never add high and low first
and then subtract absolute float32 ECEF positions. CPU geodetic height and
geocentric distance remain separate values; subtracting a single sphere radius
from geocentric distance does not produce WGS84 height at general latitudes.

## Planet and atmosphere parameters

| Parameter                                   | Value / meaning                                    |
| ------------------------------------------- | -------------------------------------------------- |
| WGS84 equatorial semiaxes                   | 6,378,137 m, taken from `Ellipsoid.WGS84`          |
| WGS84 polar semiaxis                        | 6,356,752.3142451793 m                             |
| Default atmosphere height                   | 100,000 m above the maximum ellipsoid radius       |
| Default atmosphere radius                   | 6,478,137 m, centered at the Earth center          |
| Maximum reference-sphere radial discrepancy | 21,384.6857548207 m, equatorial minus polar radius |
| Outer boundary height over the pole         | 121,384.6857548207 m                               |

The enclosing sphere is an explicit integration boundary for future atmosphere
work. It is not a constant-geodetic-height surface, an atmosphere density model,
or a replacement for terrain's true ellipsoid. M2.2 must decide its density and
scattering approximation against this documented boundary. Parameters can be
created with another positive height through `createPlanetParameters` or the
internal `WebGPUPlanetState` constructor; no new public Viewer option is added.

## Sun and scene time

`computeSunDirectionWC(time, result)` follows the existing native
`Renderer/UniformState.js` path: `Simon1994PlanetaryPositions` computes the
Earth-centered inertial Sun position, `CelestialFrameTransforms` rotates it into
fixed axes, then the result is normalized. The default native transform attempts
ICRF data and falls back to TEME/pseudo-fixed when that data is unavailable. The
fallback approximates UT1 by UTC; this is the existing Cesium lighting convention,
not a new ephemeris or an astronomical precision claim.

The direction is **Earth center to Sun**. It is independent of camera
translation at ground, low orbit and high orbit. `sunDirectionEC` applies only
the view rotation. Future incoming-light propagation uses its negative; future
surface-to-Sun visibility rays use the positive direction.

`WebGPUScene._planetState.update(camera, frame.time)` runs after `postUpdate`
and `preRender` callbacks and before the same frame's culling/drawing. Explicit
render times and the existing scene Clock are supported. No visible lighting is
applied in M2.1.

## CPU ray intervals

The internal default export `WebGPUPlanetMath` exposes:

| Interface                                               | Contract                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `createPlanetParameters(ellipsoid, atmosphereHeight)`   | True ellipsoid, separate enclosing sphere, meter values and approximation bound |
| `computeSunDirectionWC(time, result)`                   | Native fixed-frame Earth-to-Sun unit direction                                  |
| `intersectEllipsoid(ray, ellipsoid, result)`            | Sorted forward `Interval` in meters, or `undefined`                             |
| `intersectAtmosphere(ray, planet, result)`              | Same contract for the outer sphere                                              |
| `clipAtmosphereRay(ray, planet, sceneDistance, result)` | Visible positive-length atmosphere segment clipped by Earth and scene depth     |

Input origins and directions must be finite; a zero direction throws. Nonunit
directions are normalized without mutating the input, so returned `t` is always
meters. Entry precedes exit. Interior starts clamp to zero. A surface
outward/tangent contact is `[0,0]`; an exterior tangent has equal positive entry
and exit; a miss is `undefined`. Zero-length contact does not occlude.

Ordinary intersection uses native `IntersectionTests.rayEllipsoid`. The
WebGPU-local adapter corrects the pinned native exact-surface inward half-exit
case and handles rounding-sensitive tangencies. Neither native core nor the
WebGL path is patched. The double boundary tolerance is `16 * Number.EPSILON`
in scaled ellipsoid space (about 12 nm radial at WGS84); the surface dot-product
tolerance scales with the ray coefficients. It is not a terrain-height allowance.

`sceneDistance` is distance along a normalized ray, not axial camera distance.
It defaults to `Infinity` for no scene surface. A mountain may stop the ray
before the ellipsoid. An origin inside the solid ellipsoid produces no visible
atmosphere. These helpers do not replace M1 terrain intersection or collision.

## CPU/WGSL frame interface

`WebGPUPlanetState.uniformValues` is a reused 48-float / **192-byte** array.
`WebGPUPlanetShader` is a binding-free WGSL snippet with the matching
`WebGPUPlanet` structure. Each row occupies one 16-byte vec4:

| Float offset | Field             | xyz / w                                                                     |
| ------------ | ----------------- | --------------------------------------------------------------------------- |
| 0            | `radii`           | Ellipsoid radii / atmosphere radius, meters                                 |
| 4            | `inverseRadii`    | Reciprocal radii / reciprocal atmosphere radius                             |
| 8            | `cameraHigh`      | Encoded ECEF high / geocentric distance                                     |
| 12           | `cameraLow`       | Encoded ECEF low / geodetic height                                          |
| 16           | `sunDirectionWC`  | Earth-to-Sun in ECEF / reserved zero                                        |
| 20           | `sunDirectionEC`  | Earth-to-Sun in eye axes / reserved zero                                    |
| 24           | `cameraRightWC`   | Camera right / reserved zero                                                |
| 28           | `cameraUpWC`      | Camera up / reserved zero                                                   |
| 32           | `cameraForwardWC` | Camera forward / reserved zero                                              |
| 36           | `projection`      | Native matrix entries `[0], [5], [8], [9]`                                  |
| 40           | `depth`           | Near, far, reversed A, reversed B                                           |
| 44           | `surface`         | Ellipsoid quadratic c, sphere quadratic c, atmosphere height, reserved zero |

The cancellation-sensitive quadratic constants are computed in CPU double
precision before upload. A 1 cm ground height must not be rounded into a surface
contact by a shader-sized epsilon. WGSL only treats CPU-canonicalized `c == 0`
as an exact surface start. The shared layout follows
[WGSL host-shareable layout constraints](https://www.w3.org/TR/WGSL/#address-space-layout-constraints).

WGSL functions are `webgpuRelativePosition`, `webgpuRayDirection`,
`webgpuSceneRayDistance`, `webgpuRayEllipsoid`, `webgpuRayAtmosphere`, and
`webgpuAtmosphereSegment`. Intersection functions start at the packed camera and
accept normalized ECEF directions. A miss is `vec2(-1)`; cleared scene depth
produces distance `-1`. Callers must not treat that sentinel as an occluder.

For a top-left-origin pixel `(x,y)`, pass NDC
`(2*(x+0.5)/width-1, 1-2*(y+0.5)/height)`. The ray helper includes native
off-center offsets and camera rotation. No camera-translation term is applied
to directions.

GPU intersections use stable quadratic roots with a float32 grazing band of
four machine epsilons times the coefficient-product magnitudes. This avoids
invented positive chords from tangent rounding but is not CPU-double precision
at the limb. Real scene depth remains the surface-occlusion authority. Local
software-GPU samples measured up to 20 m analytic entry error at 35,786 km
altitude and under 0.004 m encoded local-position error; these are observations,
not universal hardware bounds. The separate actual terrain-depth versus native
rendered-mesh-pick comparison measured up to 68.2364 m at that height. Browser
acceptance uses `max(0.005 m, distance * 1e-5)` for analytic intervals,
`max(0.01 m, distance * 2e-6)` for actual depth/pick distance, and 0.004 m for
encoded local offsets. These distinguish large-distance float32 error from local
coordinate precision. No physical-GPU performance claim is made.

## Depth and future pass ordering

| Setting            | Globe                                   | Isolated M0 proof      |
| ------------------ | --------------------------------------- | ---------------------- |
| Format             | `depth32float`                          | `depth24plus`          |
| Clear              | 0                                       | 1                      |
| Opaque comparison  | `greater`, writes depth                 | `less`, writes depth   |
| Imagery comparison | `equal`, does not write depth           | Not applicable         |
| Default near/far   | 0.1 / 500,000,000 m, finite perspective | Proof clip coordinates |
| Texture usage      | Render attachment + texture binding     | Render attachment      |

With positive axial eye distance `d`, reversed depth is `z = B/d - A`, where
`A = near/(far-near)` and `B = near*far/(far-near)`. CPU
`reconstructEyeDistance(z, near, far)` reverses that mapping; zero is background
and returns `Infinity`. The exact far plane also maps to zero and cannot pass a
strict greater comparison against clear. Infinite-far and orthographic frusta
are not introduced.

For a unit ray `r`, divide axial distance by
`dot(r, camera.directionWC)` to obtain ray meters. The CPU helper rejects invalid
or non-forward inputs; normal WGSL camera rays use the same conversion.

`WebGPUContext.sceneDepthTexture` exposes the current Globe attachment. Reacquire
it after resize, and sample it **only in a subsequent pass**, after the opaque
terrain/imagery pass ends. Do not bind the writable attachment for simultaneous
sampling. Resize and destruction retain existing ownership. This is consistent
with [WebGPU resource usage rules](https://www.w3.org/TR/webgpu/#resource-usages).
M2.1 allocates no persistent atmosphere buffer, texture or compositing pass.

## Verification and next task

Run `node coordination/ci/m2-planet-math.test.mjs`, `m2-planet-state.test.mjs` and
`m2-depth.test.mjs` from the repository root, using their full paths.
`m1-scene-events.test.mjs` additionally verifies same-frame state and Sun time.
After building and serving the repository, run
`xvfb-run --auto-servernum node coordination/ci/m2-foundation-smoke.mjs` with
`M1_BASE_URL` set to the local server. The browser gate executes the shared WGSL,
reads actual terrain depth, compares native rendered-mesh picks, checks three
altitudes, boundary cases, sky misses, resize and all native resource lifetimes.

Fast and Full include these checks and retain every M0/M1 gate. See the
[handoff](../coordination/handoffs/M2.1-mathematical-foundation.md) and
[compact evidence](../coordination/evidence/M2.1/README.md). M2.2 may consume this
record/depth contract only after explicit user authorization. Start with one
physical scattering consumer; do not add a general RenderGraph or change terrain
coordinate conventions.
