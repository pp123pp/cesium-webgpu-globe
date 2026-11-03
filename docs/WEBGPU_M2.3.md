# M2.3 — Sun disk, occultation and restrained glare

Task 3 of `tasks/M2.md` adds the Sun to the existing WebGPU globe and physical
atmosphere. It preserves the M2.1 planet/time/depth contract and M2.2 medium.
M2.4 stars/Moon and M2.5 scene HDR/exposure/tone mapping are not implemented.
This is not whole-M2 or A07–A10 acceptance.

## Direction and angular size

`WebGPUPlanetState.update` remains the sole per-frame source of Earth-to-Sun
ECEF direction. It uses the actual scene time, native Cesium solar ephemeris
and celestial-to-fixed transform, after scene callbacks. The Sun disk and
atmospheric incoming light consume exactly that same uniform direction.

The Sun is a distant angular source. It does not use a 1 AU position outside
the terrain camera's finite far plane, acquire camera-translation parallax,
or receive an arbitrary screen-space position. Pixel rays use the existing
native camera basis and off-center perspective coefficients.

The default angular **radius** is 0.00465 radians: diameter about 0.5329 degrees.
NASA's [Sun fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)
reports 1919 arcseconds at 1 AU (about 0.5331 degrees). This is a fixed mean-size
approximation, without seasonal distance-dependent size, topocentric solar
parallax, atmospheric refraction or limb darkening. Scene-time direction still
changes normally. These approximations do not alter actual WGS84 terrain.

Small-angle comparison uses chord distance `length(ray - sun)` against
`2*sin(angularRadius/2)`, avoiding the cancellation of `acos(dot(ray,sun))`.
Pixel ray derivatives provide approximately one pixel of disk-edge filtering;
they are evaluated before divergent occlusion branches. Camera FOV, off-center
projection and viewport size determine the displayed pixel diameter.

## Settings and the LDR boundary

`scene.sun` is a WebGPU-only mutable settings object, not the native WebGL
`Sun` class. It defaults to enabled. Existing `Viewer` option `skyBox:false`
also hides this Sun initially, following the documented native Viewer meaning
of that option. It does not create a skybox, stars or Moon in WebGPU.

| Setting | Default | Unit / meaning |
| --- | --- | --- |
| `scene.sun.show` | `true` | Disk and artificial glare enabled |
| `scene.sun.angularRadius` | `0.00465` | Radians, half the apparent diameter |
| `scene.sun.displayScale` | `pi*sin(0.00465)^2/10` | About `6.793e-6` sr; Sun-only radiance-to-LDR scaling |
| `scene.sun.glowStrength` | `0.025` | Dimensionless maximum fraction of displayed disk radiance |
| `scene.sun.glowRadius` | `0.025` | Radians; soft finite outer support of the additional glare |
| `scene.atmosphere.lightIntensity` | `10` | The **single shared** normalized solar irradiance E, not lux |

For a uniform circular source of radius alpha, the cosine-weighted solid-angle
integral gives `E = pi * L * sin(alpha)^2`. This follows the radiance/irradiance
integral in [PBRT's radiometry chapter](https://pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Radiometry).
The displayed unattenuated disk value is therefore

`Ldisplay = E * displayScale / (pi * sin(alpha)^2)`.

At the defaults, `Ldisplay=1`. Changing the shared E changes both the disk and
atmospheric illumination; E=0 removes both solar contributions. Changing the
angular radius at constant E preserves the underlying irradiance convention.
`displayScale` is explicitly a local accommodation for the current LDR canvas.
It is not photometric calibration, a global exposure, a tone mapper or a claim
that the physically enormous solar radiance fits an 8-bit scene target.
Scattering and M1 surface appearance retain their existing interpretation.

Visible settings are validated before uniform writes. Supported angular radius
is [1e-5, 0.05] rad, displayScale [0, 1], glowStrength [0, 0.25], glowRadius
[angularRadius, 0.1] rad, and shared E [0, 1e6]. Nonfinite/out-of-range inputs
throw. These are bounded numerical controls, not a quality guarantee for
unphysical choices; large values can still clip at the existing LDR boundary.

## Real geometry and depth occultation

Each disk fragment uses its own reconstructed ray. Any non-clear reversed-Z
scene depth blocks the infinitely distant Sun, including real terrain above
the ellipsoid horizon. Clear depth is exactly zero. The depth attachment is
read after the opaque terrain/imagery pass and is never overwritten by the Sun.

For empty-depth pixels, the existing stable high/low-ECEF WGS84 ray intersection
supplies an additional solid-Earth occluder. A positive-length forward chord
blocks the source; a miss or isolated tangential contact does not. A single
Sun-center visibility boolean never hides/shows the entire disk: the visible
part follows the limb or mountain silhouette as it crosses the disk.

The existing float32 grazing-contact rounding band remains unchanged, as do
M2.1 CPU-double near-surface constants. Actual rendered terrain depth is
primary. Finite raster/subpixel and float32 limb precision still apply; this is
not an exact double-precision GPU silhouette. No terrain shadow volumes or
surface lighting/BRDF system is added.

## Atmospheric attenuation and composition

The enabled-atmosphere path reuses the existing per-ray M2.2 integrator result:

`outputLinear = (sourceLinear + visibleSunLinear) * viewT + atmosphereL`.

The RGB view transmittance is applied **once**. It is the same Beer attenuation
used by aerial perspective, including a space ray's entry into and full path
through the atmosphere. Merely looking up a high-orbit camera height in a
surface-to-Sun LUT would miss that path; this implementation does not do that.
The existing medium LUTs continue to supply atmospheric illumination and
multiple scattering. No second solar ray march is added.

Disk and sky use the same linear RGB space before the existing sRGB encode and
LDR clamp. Near the horizon, blue is attenuated more than red and the solar
contribution dims along the longer path. Existing Earth direct-light shadow,
night scattering and approximate multiple scattering are retained. The model
still omits ozone, refraction, spectral conversion and terrain-cast atmospheric
shadows; M1 surface imagery remains unlit, including at night.

With atmosphere disabled, `sunOnlyFragment` uses T=1 and L=0. It reads the same
real depth and completed color, preserving source pixels exactly when no solar
contribution is present. This pipeline requires no medium textures or LUT build.
With both effects disabled, Context retains the original direct-to-canvas path.

## Restrained angular glare

The optional glare is a small analytic angular aureole around the disk, not
scene bloom extraction or a blur chain. For chord distance c and outer chord
radius h, its profile is `exp(-6*(c/h)^2) * (1-smoothstep(0.7,1,c/h))` inside h,
and zero outside. It has no hard outer edge, lens ghosts, dirt or streaks.

Each glare fragment also passes actual depth and WGS84 visibility. A fixed
16-point equal-area disk sample estimate further scales the weak aureole by
source visibility, checking exact Earth rays and the completed depth mask.
Bilinear depth-mask interpolation limits sample changes at a mountain edge.
Each source sample must first lie in a clear depth texel; a covered sample
cannot borrow visibility from adjacent sky outside the disk.
A fully hidden disk produces no artificial halo above the occluder. The disk
itself does **not** use this coarse area estimate. Tiny visible slivers can have
no added glare until a sample becomes visible; the default small strength bounds
that approximation. Offscreen disk samples contribute zero, so the effect fades
as its source leaves the viewport rather than guessing offscreen terrain depth.
Natural Mie forward scattering remains part of the separate atmosphere model.

## Resources and lifecycle

The unchanged 192-byte planet uniform and existing parameter buffer are shared.
The parameter buffer grows from 64 to **80 bytes**, adding one Sun vec4; existing
bindings 0–6 remain, as do the acceptance probe's test-only bindings 7/8.
The viewport row's spare components hold atmosphere/Sun enable flags.

One additional pipeline entry serves Sun-only frames. It binds only 0,1,5,6;
the atmospheric pipeline also binds the existing two LUTs and sampler. Bind-group
caching includes the active pipeline plus color/depth attachments, so toggling
modes or resizing cannot retain the wrong resource layout. Stable frames do not
allocate native buffers or textures. Sun settings, time, camera and shared light
intensity do not invalidate medium LUTs.

The same owners handle teardown: Context owns completed-color/depth attachments,
and WebGPUAtmosphereRenderer owns two uniform buffers, its two pipelines and
medium resources. The additional pipeline is compiled before uniform allocation;
partial failure follows existing Widget/Scene cleanup. `statistics.frames`
continues to count atmospheric frames; `sunFrames` counts frames drawing the
solar consumer and is only a diagnostic, not rendering acceptance evidence.

## Demo, acceptance and continuation

`Apps/WebGPUGlobe.html` retains its real imagery/terrain loading, Orbit/Everest,
ion-token controls and navigation. The added controls toggle Sun/atmosphere,
change shared sunlight, aim the current camera toward the Sun and advance the
scene clock by 10 minutes. A UTC time label exposes the actual scene time.
A Sun on the far side of Earth remains hidden when using Look at Sun.

`m2-sun.test.mjs` covers parameter safety/shared irradiance and the no-LUT Sun-only
update. The dedicated browser gate executes production WGSL, actual canvas and
native depth, independent camera/ellipsoid/mesh checks, and native resource
tracking. Both existing workflows require it and upload `Build/m2-sun/` beside
prior M2 evidence. M1 geometry and M2.2 atmosphere fixtures explicitly hide Sun
and retain their original assertions; the public demo exercises enabled defaults.

The M2.2 navigation accounting fix and the Everest software-GPU loading fixture
remain intact: identical native SSE/terrain LOD, atmosphere enabled, original
resolution restored, actual frames/GPU completion and the original shared
90-second deadline. This remains a CI functional-load arrangement, not a
production full-resolution loading optimization. `M1-NAV-001` stays
**KNOWN_UNRESOLVED**, without an expanded waiver. Google ion rejected endpoint
retry caching and inherited coarse imagery seams also remain unchanged.

See the [M2.3 handoff](../coordination/handoffs/M2.3-sun-rendering.md) and
[compact evidence](../coordination/evidence/M2.3/README.md) for **actual**
validation results and limits. Final acceptance requires successful Fast and an actually executed Full
on the latest PR #8 head; this document alone certifies neither. Stop after M2.3,
leave the PR unmerged, and wait for separate M2.4 authorization.
