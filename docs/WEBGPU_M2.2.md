# M2.2 — physical atmosphere and aerial perspective

This implements task 2 of `tasks/M2.md`, consuming the unchanged M2.1 ECEF,
meter, solar-direction and reversed-depth contracts. It renders Rayleigh/Mie
single scattering, approximate multiple scattering, colored transmittance and
real-terrain aerial perspective. It does not complete M2 or A07–A10 and draws no
Sun disk, stars, Moon, bloom or tone-mapping/exposure system.

## Sources and implementation provenance

The implementation is independently written from the equations below. No UE,
third-party shader or other implementation source is copied into this repository.
Existing Cesium/Apache-2.0 notices remain unchanged.

1. Sébastien Hillaire, **A Scalable and Production Ready Sky and Atmosphere
   Rendering Technique**, Computer Graphics Forum 39(4), 2020,
   [author's paper](https://sebh.github.io/publications/egsr2020.pdf),
   [publisher identity and DOI](https://doi.org/10.1111/cgf.14050).
   Sections 4, 5.2 and 5.5 supply exponential media, phase functions,
   transmittance lookup and the isotropic geometric-series closure.
2. Eric Bruneton and Fabrice Neyret, **Precomputed Atmospheric Scattering**,
   [author's reference and derivation](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html).
   The [documented model parameters](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/demo/demo.cc.html)
   distinguish Mie extinction from scattering using single-scattering albedo 0.9.
3. **Physically Based Rendering, fourth edition**, section 11.2,
   [Transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance),
   for Beer attenuation, zero-path identity and multiplicative transmittance.
4. Epic Games, [Sky Atmosphere technical documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine),
   for ground-to-space behavior, the separate roles of scattering and LUTs,
   and the quality risks of insufficient near-ground ray samples.

This is a smaller method than the complete Hillaire/UE system: two medium LUTs
and direct per-pixel integration, without sky-view/froxel caches, temporal
reprojection, ground bounce, ozone, spectral conversion or volumetric shadows
from mountains. Earth's actual ellipsoid casts the direct-sun shadow.

## Settings, units and density

`scene.atmosphere` is the WebGPU-only mutable settings object. It is enabled by
default; `new Viewer(..., {renderingBackend: "webgpu", skyAtmosphere: false})`
disables it initially. After readiness, `scene.atmosphere.show = true/false`
changes only the atmosphere consumer, without changing the rendering backend.
This object is not the native WebGL `Atmosphere` implementation and does not
claim support for that class's color-correction or dynamic-lighting properties.

| Setting | Default | Unit / meaning |
| --- | --- | --- |
| `rayleighScattering` | `[5.802e-6, 13.558e-6, 33.1e-6]` | RGB scattering and extinction, m⁻¹ |
| `mieScattering` | `3.996e-6` | Achromatic aerosol scattering, m⁻¹ |
| `mieExtinction` | `4.44e-6` | Aerosol scattering **plus absorption**, m⁻¹ |
| `rayleighScaleHeight` | `8000` | Meters |
| `mieScaleHeight` | `1200` | Meters |
| `mieAnisotropy` | `0.8` | Dimensionless Cornette–Shanks g |
| `lightIntensity` | `10` | Normalized RGB solar irradiance, not calibrated lux |
| `multipleScatteringStrength` | `1` | Approximate multiple scattering multiplier; zero isolates single scattering |

Mie absorption is therefore `0.444e-6 m⁻¹`, with scattering albedo 0.9.
Hillaire's table labels a different Mie absorption value; this implementation
explicitly chooses the internally consistent Bruneton extinction/albedo
parameterization (`5.328e-3 / 1200 = 4.44e-6 m⁻¹`). It does not add the
extinction coefficient a second time as absorption. RGB Rayleigh values and
scale heights follow Hillaire's Earth parameterization.

At height h, `rhoR = exp(-h / HR)` and `rhoM = exp(-h / HM)`.
`sigmaS = betaR * rhoR + betaMScattering * rhoM` and
`sigmaT = betaR * rhoR + betaMExtinction * rhoM`, componentwise.
The medium is zero at or above the configured atmosphere height (100,000 m
by default). No implicit kilometers occur in CPU, uniforms, LUTs or WGSL.

Invalid edits throw when the enabled atmosphere is updated. Supported numerical
ranges are total extinction per channel from 0 to 1 m⁻¹, Mie scattering no larger
than extinction, scale heights from 1 to 1,000,000 m, light intensity from 0 to
1,000,000, multiple-scattering strength from 0 to 1, and g from -0.99 to 0.99.
Inputs must remain finite in float32; unsupported values are rejected, not
silently clamped. These are numerical safety ranges, not a quality guarantee for
all exotic media. Acceptance covers the Earth defaults and representative edits.

## WGS84 geometry and precision

Terrain retains the real WGS84 ellipsoid and its M1 RTC path. The enclosing
atmosphere sphere remains `maximumRadius + atmosphereHeight`, as in M2.1;
its top is about 121,384.686 m over the pole for the default 100 km equatorial
height. Density is **not** `length(position) - maximumRadius`.

For an ECEF sample p, define q = length(p / radii) and r = length(p).
The radial distance to the ellipsoid is evaluated as

`h = max(0, r * (q² - 1) / (q * (q + 1)))`.

It is zero on the ellipsoid at every latitude. Radial height is not exactly
geodetic normal height; the distinction and float32 numerical error remain
separate. The outer sphere is only an integration bound. Above 100 km radial
height, the default medium is zero, including the extra polar portion of that
sphere; it does not extend the LUT's calibrated density model to 121 km.

LUT curvature uses the equatorial reference sphere. The runtime solar-zenith
cosine uses the **ellipsoid normal** `normalize(p / radii²)`, which avoids the
leading error from using geocentric up near sunrise. A separate true-ellipsoid
Sun-ray intersection decides direct visibility. When a true visible path falls
below the reference sphere's lookup horizon, the lookup is clamped to that
horizon. This is a small directional-curvature approximation, not an exact
ellipsoidal optical path; no universal radiance-error bound is claimed.

The view integrator reuses the CPU-double `planet.surface.x` near the camera,
expanding the implicit ellipsoid equation in local offsets. Space rays rebase
at atmosphere entry with fused multiplication/addition and the encoded camera
parts before integrating short offsets. This prevents large camera quadratic
terms from cancelling at every sample. M2.1 float32 entry/direction tolerances
still apply; this is not double-precision GPU transport.

## Phase, optical thickness and integration

Let d point from the camera toward the sample and s point from Earth toward
the Sun. Both are normalized ECEF directions, and `mu = dot(d,s)`. The incoming
photon and outgoing-to-camera directions are both negated, leaving the same
cosine. Positive g peaks when looking toward the Sun, at mu = 1.

`pR(mu) = 3 * (1 + mu²) / (16*pi)`.

`pM(mu,g) = 3*(1-g²)*(1+mu²) /
            (8*pi*(2+g²)*(1+g²-2*g*mu)^(3/2))`.

Both are normalized densities per steradian. The Mie denominator is evaluated
in an equivalent squared form to avoid cancellation near its supported extrema.

For a ray segment, `tau = integral(sigmaT dt)` and `T = exp(-tau)` in RGB.
The source at a sample is

`Q = E * (Tsun * (sigmaR*pR + sigmaM*pM) + sigmaS * MS * strength)`.

`Tsun` is zero when the true ellipsoid blocks the sample-to-Sun ray. Elevated
samples beyond the surface terminator can still receive sunlight. Multiple
scattering can remain visible at twilight; no arbitrary constant night ambient
or blue gradient is added.

Thirty-two intervals concentrate near the minimum scaled-ellipsoid radius along
the visible segment, which can be its start, end or an interior limb point.
This is necessary for the 1,200 m aerosol layer: uniformly sampling a vertical
100 km segment in 32 steps would undersample it. Each interval uses midpoint
density and the exact constant-source Beer integral:

`L += T_before * Q * dt * phi(tau)`; `T *= exp(-tau)`;
`phi(tau) = (1-exp(-tau))/tau`.

Near zero, `phi = 1 - tau/2 + tau²/6`, including a finite empty/vacuum limit.
This avoids division by zero and subtractive loss of very small scattering.

## Approximate multiple scattering

The LUT follows the reduced isotropic closure in Hillaire equations 5–10.
For each height and solar zenith, 32 deterministic equal-solid-angle Fibonacci
directions sample surrounding transport, with 64 midpoint intervals per ray.
Rays end at the reference sphere ground or atmosphere top. The ground boundary
is black: reflected ground contribution is deliberately omitted.

`J1` is the angular mean of ray-integrated direct single scattering using the
isotropic `1/(4*pi)` phase. `f` is the angular mean of `integral(T*sigmaS dt)`;
it contains neither the solar shadow term nor another phase factor.
The angular mean already performs the receiving isotropic normalization.

`MS = J1 / (1 - min(f, 0.95))`, in RGB per unit solar irradiance.

The cap limits the geometric-series amplification to 20. Default Earth LUT
generation measures a maximum f of about 0.3337023, below the cap. This preserves
a finite positive contribution but is not a complete multi-order solver or a
validated dense-atmosphere solution. Omitting ozone and ground bounce also limits
absolute color matching, particularly twilight. UE/Bruneton pixel identity is
not an acceptance criterion.

## LUT layout and update contract

| LUT | Dimensions / format | Coordinates and contents |
| --- | --- | --- |
| Transmittance | 256 × 64, RGBA16Float | RGB transmittance to top; alpha 1 |
| Multiple scattering | 32 × 32, RGBA16Float | RGB MS transfer per unit solar irradiance; alpha 1 |

For transmittance, endpoint texel coordinates u,v map to
`h = H*v²`, `muH = -sqrt(h*(2R+h))/(R+h)`,
`mu = muH + (1-muH)*u²`. This concentrates samples near low heights and the
horizon. Multiple scattering uses `h = H*v²`, `muSun = 2*u-1`.
Runtime normalized texture coordinates include the half-texel offset so both
endpoint and bilinear interpolation conventions match CPU generation.

The CPU integrates in double precision (128 transmittance samples) and returns
Float32Array tables. The renderer converts to IEEE binary16, including
subnormals, and uploads 136 KiB total. Half precision introduces quantization;
no optional `float32-filterable` device feature is needed. Bilinear clamp-to-edge
sampling is explicit. Values exceeding finite half range fail with an error.

LUTs are built lazily for the first enabled frame and regenerated in place only
when coefficients, density heights or planet geometry change. The cache key
observes in-place RGB array edits. Camera, scene time, g, intensity and MS strength
update uniforms without rebuilding the tables. g is absent from the isotropic
multiple-scattering approximation. Repeated medium edits synchronously rebuild
CPU tables and can stall a frame; production optimization is not claimed here.

## Rendering, color, depth and resource ownership

The original terrain/imagery shaders retain their displayed RGB appearance.
Context sends their completed output to a separate same-format color texture
only when an atmosphere consumer is active. Their existing depth32float
attachment still clears to zero and uses greater/equal reversed-depth tests.
The opaque pass ends before the atmosphere samples either attachment.

The composite reconstructs a unit ray with M2.1 projection/camera helpers. A
nonzero reversed depth is converted from axial eye distance to **ray meters**
by dividing by `dot(ray,cameraForward)`. Clear depth means no scene endpoint.
The visible interval is clipped by both the actual terrain distance and true
solid ellipsoid, preventing transport through Earth or behind mountains.

In the second pass the source color is explicitly sRGB-decoded, then
`linearOutput = sourceLinear * T_rgb + L_rgb`, and finally sRGB-encoded into the
existing LDR canvas. The source color and depth are read-only and the swapchain
texture is the only writable attachment. The disabled path retains the original
direct canvas rendering, without a decode/encode round trip.

This is the minimum color conversion required for physical atmosphere blending.
The M1 imagery remains unlit surface appearance, including on Earth's night side;
it is not newly interpreted as albedo or given a surface BRDF. Earth shadowing
here suppresses **atmospheric direct sunlight**. Scene-linear surface lighting,
photometric exposure, HDR presentation and highlight tone mapping are not
implemented by this task. LDR output can clip a bright Mie lobe, while diagnostic
GPU probes retain the unclipped transport values.

Context owns the full-resolution intermediate color and existing depth. Resize
destroys old attachments and the next composite reacquires both; disabled scenes
do not allocate a new color attachment. `WebGPUAtmosphereRenderer` owns two uniform
buffers (192/64 bytes), the two LUT textures, sampler, bind group and pipeline.
Destroy is idempotent, including partial initialization; device-loss/error handling
uses the existing Widget → Scene destruction path before Context releases the
device. A failed new LUT upload destroys the unassigned texture. No per-frame
native buffer/texture allocation occurs at stable size and medium.

WGSL binding 0 is the unchanged planet record; 1 is the 64-byte atmosphere
record; 2/3 are LUT textures; 4 is their sampler; 5/6 are completed color/depth.
The four parameter vec4 rows are Rayleigh RGB/height, Mie scattering/extinction/
height/g, intensity/MS strength/reference radius/height, and viewport width/height.

## Verification and continuation

Focused numerical tests live in `coordination/ci/m2-atmosphere-model.test.mjs`;
Context pass/lifetime tests in `m2-atmosphere-lifecycle.test.mjs`. The real-browser
`m2-atmosphere-smoke.mjs` executes production WGSL, reads actual LUTs/depth and
canvas pixels, compares native terrain mesh picks, and instruments real native
resource creation/destruction. Representative ground/low/high orbit, day/night,
terminator, boundary, mountain and resize captures go to `Build/m2-atmosphere/`.

The oblique mountain comparison accounts for projected-vertex raster precision:
native picks at the four corners of a fixed ±1/16-pixel neighborhood bound the
depth, with the existing 1 cm + 2 ppm numerical allowance. The fixture requires
the center and all four corner picks to remain on terrain, with their distance
span below 25 m; it cannot accept an arbitrary large depth difference. The
measured center discrepancy was 2.00364 m at 41.321 km, equivalent to about
0.015 pixel on this slope. GPU/native direction differences accounted for only
1.55 mm. A ±1/256-pixel diagnostic was insufficient; ±0.05 pixel enclosed the
observation. SwiftShader's [configuration](https://swiftshader.googlesource.com/SwiftShader/+/master/src/Vulkan/VkConfig.hpp)
and [upstream precision change](https://swiftshader.googlesource.com/SwiftShader/+/2c5db716d2d32111e1a2722df28b2cd07db26570)
document four subpixel bits for Chromium's legacy GN configuration. This is a
conservative raster bound, not a queried property of the installed binary or a
new world-space precision guarantee. Existing M2.1 2 ppm assertions are unchanged.
The M2.2 gate separately requires bit-identical terrain depth with atmosphere
enabled/disabled, correct real-depth interval termination, and an ellipsoid-only
control that materially overestimates extinction. An analytic vertical exponential
column also checks meter units and actual GPU quadrature independently of LUTs.

M1-specific browser fixtures explicitly disable atmosphere while preserving their
existing functional/color assertions. The dedicated M2 gate enables it, and the
public live demo uses its enabled default. Fast and Full run both the retained
foundation gate and new atmosphere gate. See `docs/CI.md`, the M2.2 handoff and
compact evidence for actual results; source documentation alone is not a pass.

M2.3 may reuse the planet state, solar direction and the atmosphere transmittance
model only after explicit authorization. It must account for solar occultation
and the documented LDR boundary. This task leaves PR #8 open and stops at M2.2.
