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
- Preserve the existing 192-byte M2.1 planet record unless an explicitly versioned ABI extension is made consistently in CPU and WGSL.
- Keep all radiance operations in linear RGB. Do not introduce exposure, tone mapping or bloom; those remain M2.5.
- All GPU resources must have deterministic resize, device-loss and destruction behavior.

## Acceptance

Ground, low-orbit and high-orbit views; lunar ephemeris/time progression; phase changes; Earth occultation; camera translation without star parallax; solar/lunar day-night transition; resize and resource teardown. Capture actual browser screenshots and diagnostics. Pixel-identical WebGL/WebGPU images are not required.

## Known inherited issue

Preserve the M2.3 transient terrain-gap observation and its original diagnostic artifact. It is not declared fixed by M2.4.
