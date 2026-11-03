# M2.4 — Stars, Moon and moonlight

## Scope

M2.4 extends the existing WebGPU-only WGS84 scene without changing the WebGL renderer, M1 terrain/depth contract, M2.1 planet math, M2.2 atmospheric transport or M2.3 solar disk.

## Required implementation

- Render a direction-anchored procedural star field only on unobstructed sky rays. Derive directions from the camera ray in ECEF/world axes so camera translation cannot introduce sky parallax.
- Compute the Moon's geocentric position from Cesium's Simon 1994 lunar ephemeris and transform ICRF to Earth-fixed coordinates at the scene time.
- Subtract the camera position in CPU double precision before normalizing the Moon direction. Derive apparent angular radius from the physical lunar radius and camera distance.
- Shade the lunar disk using its surface-normal approximation and the Earth-to-Sun direction. The illuminated fraction must vary with scene time.
- Add a bounded, low-intensity moonlight contribution to night-side terrain and atmospheric transport. Earth and measured terrain depth remain authoritative occluders.
- Fade stars and moonlight through twilight against the existing physical atmosphere and Sun.

## Numerical and rendering conventions

- Positions and distances are meters; directions are normalized and expressed in ECEF/world coordinates.
- Extend the shared planet uniform from 192 to 272 bytes (17 aligned vec4 records) in both CPU and WGSL. The final three vec4 records carry the transpose of the native ICRF-to-ECEF rotation so star directions remain inertial as Earth rotates.
- Keep all radiance operations in linear RGB. Do not introduce exposure, tone mapping or bloom; those remain M2.5.
- All GPU resources must have deterministic resize, device-loss and destruction behavior.

## Acceptance

Ground, low-orbit and high-orbit views; lunar ephemeris/time progression; phase changes; Earth occultation; camera translation without star parallax; solar/lunar day-night transition; resize and resource teardown. Capture actual browser screenshots and diagnostics. Pixel-identical WebGL/WebGPU images are not required.

## Known inherited issue

Preserve the M2.3 transient terrain-gap observation and its original diagnostic artifact. It is not declared fixed by M2.4.

## Implemented M2.4 path

- `WebGPUPlanetState` evaluates the native Simon 1994 Moon ephemeris at the scene time, transforms the inertial position into ECEF, subtracts the camera in double precision and uploads a normalized camera-relative direction and angular radius.
- The 272-byte planet ABI includes the lunar phase fraction, distance, star/moonlight controls and three rows for ECEF-to-ICRF ray transformation. The GPU compositor therefore hashes inertial sky directions rather than camera-relative positions or Earth-fixed star directions.
- The Moon is shaded as a finite angular disk. Per-pixel surface normals provide the illuminated limb; the same ECEF ellipsoid ray and completed scene depth prevent drawing the Moon through Earth or terrain.
- The procedural star field is evaluated only for unobstructed sky rays, fades through twilight using the observer's solar elevation, and does not use camera translation.
- Moonlight is a bounded additive linear-radiance approximation on night-side terrain and in the atmospheric scattering source. It is deliberately not a full PBR relighting system; M2.5 remains responsible for HDR/exposure/tone mapping.
- `scene.moon` and `scene.stars` expose validated runtime controls. `skyBox:false` retains the existing test/demo opt-out for all celestial sky effects.
- No additional GPU texture or buffer lifecycle was introduced beyond the existing shared planet uniform; its size is now 272 bytes and is released with the atmosphere renderer.

The dedicated M2.4 unit and real-browser smoke tests are `coordination/ci/m2-space.test.mjs`, `coordination/ci/m2-planet-state.test.mjs` and `coordination/ci/m2-space-smoke.mjs`. Fast and Full workflows both execute the browser gate and upload `Build/m2-space/`.
