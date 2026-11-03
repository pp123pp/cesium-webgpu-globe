# WebGPU Solar Visual Asset Pack

Original, repository-authored SVG sources for M2.6. These are masks and a color ramp, not pre-rendered Sun sprites. The physical solar direction, angular disk, atmosphere and Earth/terrain depth remain authoritative.

## Source and GPU payloads

All nine SVG sources are 1024 × 1024 and remain editable in this directory. The reproducible `npm run build-solar-textures` step rasterizes them with the repository's Playwright Chromium dependency and writes fixed-size GPU payloads into `GPU/`.

| Source                         | GPU payload               | Format           | Meaning                                                                              |
| ------------------------------ | ------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `Rays/radial-rays-01.svg`      | `GPU/radial-rays-01.r8`   | R8, 512²         | Primary radial mask; linear coverage                                                 |
| `Rays/radial-rays-02.svg`      | `GPU/radial-rays-02.r8`   | R8, 512²         | Fine radial mask; linear coverage                                                    |
| `Rays/radial-rays-03.svg`      | `GPU/radial-rays-03.r8`   | R8, 512²         | Broad radial mask; linear coverage                                                   |
| `Halo/soft-halo.svg`           | `GPU/soft-halo.r8`        | R8, 512²         | Compact halo coverage                                                                |
| `Halo/wide-halo.svg`           | `GPU/wide-halo.r8`        | R8, 512²         | Wide halo coverage                                                                   |
| `Corona/corona-fine.svg`       | `GPU/corona-fine.r8`      | R8, 512²         | Fine irregular coronal filaments                                                     |
| `Corona/corona-mid.svg`        | `GPU/corona-mid.r8`       | R8, 512²         | Broad asymmetric coronal streamers                                                   |
| `Noise/radial-noise.svg`       | `GPU/radial-noise.r8`     | R8, 512²         | Radially weighted modulation; alpha channel                                          |
| `Atmosphere/glow-gradient.svg` | `GPU/glow-gradient.rgba8` | RGBA8 sRGB, 512² | Authored warm-to-neutral color ramp; automatically decoded to linear on GPU sampling |

The generated `GPU/manifest.json` records each source/payload path, source and output dimensions, GPU format, color-space semantics, alpha minimum/maximum/coverage and exact byte length. The eight R8 payloads use the SVG alpha channel, not the RGB luminance. The color ramp retains all four RGBA channels and is uploaded as `rgba8unorm-srgb`, so WebGPU sampling decodes the authored sRGB values to linear. No color-space transfer is applied to the scalar masks. The color ramp is an authored tint resource; it does not replace Rayleigh/Mie scattering or transmittance. GPU effects are generated in scene-linear HDR and pass through the existing single ACES and sRGB output stage.

## Runtime loading and ownership

`WebGPUAtmosphereRenderer` fetches the nine pre-rasterized payloads once during asynchronous initialization, validates exact byte lengths, creates R8Unorm/RGBA8Unorm-sRGB sampled textures and uploads them once. The payloads total 3,145,728 bytes (3.00 MiB) before driver allocation/alignment. The existing linear sampler is reused. Textures are retained for the renderer lifetime and destroyed by its owner; created/destroyed counts and payload bytes are exposed in renderer statistics.

If an optional solar payload is unavailable or malformed, partially loaded textures are destroyed and one-pixel neutral fallback textures are created. The physical Sun/atmosphere path remains available; fallback is observable through `statistics.solarAssetsLoaded` and `_solarAssetError`. A failed GPU device initialization remains a renderer initialization failure, not an asset fallback case.

## Provenance and constraints

All nine source SVGs are original repository-authored artwork with no external image dependencies or third-party artwork license. Keep the source SVGs alongside generated payloads. Do not replace the physical Sun disk, scene-time ephemeris, camera projection, per-fragment WGS84/terrain occultation, atmospheric transport or HDR composition with these textures.

The conversion step uses the already-installed Playwright Chromium dependency; it does not introduce a new runtime dependency. Do not decode SVG or upload textures per frame.

## Verification status

The source files have been rasterized in Chromium and their dimensions, alpha ranges and coverage have been inspected. The production loader and visual use are under M2.6 integration; successful build, production URL loading, GPU validation, visual acceptance and lifecycle evidence must be recorded against the final tested commit before claiming acceptance.
