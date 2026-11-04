# B5-A-R round-three implementation plan

**Goal:** Resolve bright unlit terrain and reduce the remaining solar/corona and low-Sun contrast defects without closing B5 or changing WebGL.

**Architecture:** Keep the existing WGS84/depth, Rayleigh/Mie transport, authored GPU textures and single linear HDR / ACES / sRGB pipeline. Apply surface irradiance separately from camera-path in-scattering, with explicit Globe lighting control. Calibrate the existing clear-sky aerosol preset only after matched parameter attribution; do not replace the renderer or introduce lens effects.

**Spec:** `tasks/M2.6.1.md`, the B5-A and B5-A-R reviews, and the user's direct implementation authorization. Work only in `D:\github\cesium-webgpu-globe` on `feat/m2-6-1-b5-a-remediation`.

## Tasks and verification

- [x] Recover existing edits, verify clean baseline `85ea6ad`, correct the local workspace junctions and inspect the built shader.
- [x] Attribute the bright night surface to unlit albedo; distinguish the corona contribution from Rays using per-effect-disabled captures.
- [x] Compare Mie presets at identical A05/A07 views, exposure and resolution in `Build/b5-parameter-attribution/`.
- [ ] Add behavioural browser assertions for twilight disk contrast, real-depth day/night terrain and solar irradiance response. Run against the current candidate and retain the failure.
- [ ] Finish `WebGPUAtmosphereShader.js` surface lighting, `WebGPUAtmosphereRenderer.js` control packing, and WebGPU-only default lighting; preserve the explicit unlit path. Keep original Sun/atmosphere oracle tolerance and all occultation cases.
- [ ] Calibrate existing aerosol settings and solar corona/rays based on matched controls. No new LUT, render pass or asset. Keep physical media controls available.
- [ ] Run one combined focused Node/lint/build check followed by the affected hardware suites and matched captures. Diagnose and rerun only failed suites. Do not launch Full locally.
- [ ] Preserve old evidence, save round-three captures/reports/source identity and reference notes. Commit and push the existing PR branch; no main push or merge.

## Review focus

Sky pixels must never receive terrain lighting; Sun visibility toggles must not toggle the physical illuminant; explicit unlit scenes retain M1 behaviour; zero solar irradiance must remove direct surface sunlight; atmosphere-disabled lighting must not require atmosphere LUT bindings. Actual visual review remains distinct from the automated checks.
