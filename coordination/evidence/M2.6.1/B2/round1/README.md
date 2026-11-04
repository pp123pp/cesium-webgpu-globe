# M2.6.1-B2 — Solar Halo & Corona Evidence

**Result:** Technical validation PASS. Human visual acceptance is pending.

## Environment

- Windows host; Intel Arc 130T / Xe-LPG GPU, driver 32.0.101.8801
- Chrome 156.0.8078.76
- Cesium 1.146.0
- Physical WebGPU adapter reported by the browser; no fallback adapter
- Primary capture: 1920×1080; resize capture: 1280×720
- Fixed scene time: 2026-03-20T12:00:00Z
- Camera height: approximately 400 km
- Solar exposure captures: 0.5, 1.0 and 2.0

## Implementation

- Three overlapping halo falloffs: compact inner, intermediate and low-energy outer.
- Two authored corona frequency bands: fine curved filaments and broad asymmetric streamers.
- Warm-to-neutral solar tint ramp; no blue/cyan halo cast.
- Corona and halo remain independently switchable through the existing effect controls.
- Nine solar textures load successfully; total payload 3,145,728 bytes (3.00 MiB).

## Actual WebGPU captures

- `halo-only-1920x1080.png`
- `corona-only-1920x1080.png`
- `combined-exposure-0.5-1920x1080.png`
- `combined-exposure-1.0-1920x1080.png`
- `combined-exposure-2.0-1920x1080.png`
- `combined-resized-1280x720.png`

`result.json` records the browser, adapter, bundle hash, asset load records, shader diagnostics, effect-isolation pixel deltas and final renderer statistics.

## Validation

- B2 browser smoke: PASS; six actual WebGPU canvas captures.
- Halo isolation: 126,148 changed pixels in the 360×360 solar ROI; maximum channel delta 166.
- Corona isolation: 123,909 changed pixels in the 360×360 solar ROI; maximum channel delta 89.
- WGSL shader diagnostics: no errors.
- Browser errors: none.
- Nine of nine solar payloads loaded.
- 1280×720 resize completed with solar assets retained.
- M2.6 A07–A10 visual regression smoke: PASS; orbital sunrise, day/night, high/low orbit, near-ground, terrain/atmosphere and HDR exposure cases.
- Focused Node tests: 8/8 PASS.
- Targeted ESLint: PASS.
- `npm run build-solar-textures`: PASS.
- `npm run build`: PASS.

These results establish implementation and runtime correctness, not subjective visual acceptance. B2 remains open for user review. B3 and later phases have not been started.
