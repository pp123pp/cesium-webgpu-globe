# WebGPU Solar Visual Asset Pack (draft)

Original, repository-authored SVG texture sources for the M2.6 solar appearance work. These are neutral/grayscale masks and gradients intended to be sampled by a shader and tinted/weighted at runtime; they are not pre-rendered Sun sprites and do not encode a fixed screen-space Sun position.

## Contents

| Asset | Intended use | Suggested import |
|---|---|---|
| Rays/radial-rays-01.svg | Primary sparse radial rays | Linear mask / alpha |
| Rays/radial-rays-02.svg | Fine secondary rays | Linear mask / alpha |
| Rays/radial-rays-03.svg | Broad low-contrast rays | Linear mask / alpha |
| Halo/soft-halo.svg | Compact soft aureole | Linear mask |
| Halo/wide-halo.svg | Wide low-frequency halo | Linear mask |
| Corona/corona-fine.svg | Subtle irregular corona detail | Linear mask |
| Atmosphere/glow-gradient.svg | Warm-to-cool atmospheric tint ramp | Color lookup; explicitly treat as authored color data |
| Noise/radial-noise.svg | Radially weighted detail modulation | Linear noise |

All files use a 1024 × 1024 viewBox and are authored in-repository without external image dependencies. SVG is used as a lossless, editable source format; convert to GPU-friendly R8/RGBA8 textures during the asset import/build step if the runtime texture loader does not consume SVG directly. Do not assume browser SVG decoding is an acceptable production asset pipeline without testing it.

## Integration constraints

- The actual scene-time Sun direction, camera projection, WGS84/terrain depth and per-fragment occultation remain authoritative.
- Use rays/halo/corona as modulation masks only. They must not replace the physical solar disk, atmosphere integrator, transmittance or depth tests.
- Composite bloom in linear HDR before the single ACES tone-map and final sRGB encode.
- Occlusion must affect the effect, not only the Sun disk; no halo/rays may visibly leak through Earth or terrain.
- Validate at orbital sunrise, low Sun, day, twilight and night-adjacent views and at multiple exposures. Include enabled/disabled comparisons and temporal camera/time sweeps.
- Tune intensity at runtime; these source masks are intentionally neutral and do not prescribe final artistic strength.

## Status and verification

This commit adds source assets and documentation only. No engine code references these files yet, and no rendering effect is claimed implemented. Runtime SVG decoding, conversion, texture upload, GPU memory cost and visual acceptance remain to be verified when M2.6 integrates the assets.

All artwork is original and generated for this repository; no third-party image license or attribution is required for these files.
