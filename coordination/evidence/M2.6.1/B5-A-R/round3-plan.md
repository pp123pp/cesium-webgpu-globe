# B5-A-R round-three implementation plan

**Goal:** Resolve bright unlit terrain and reduce the remaining solar/corona and low-Sun contrast defects without closing B5 or changing WebGL.

**Architecture:** Keep the existing WGS84/depth, Rayleigh/Mie transport, authored GPU textures and single linear HDR / ACES / sRGB pipeline. Apply surface irradiance separately from camera-path in-scattering, with explicit Globe lighting control. Calibrate the existing clear-sky aerosol preset only after matched parameter attribution; do not replace the renderer or introduce lens effects.

**Spec:** `tasks/M2.6.1.md`, the B5-A and B5-A-R reviews, and the user's direct implementation authorization. Work only in `D:\github\cesium-webgpu-globe` on `feat/m2-6-1-b5-a-remediation`.

## Implementation and verification ledger

- [x] Recover existing edits from baseline `85ea6ad`, correct the local workspace junctions and inspect the built shader.
- [x] Attribute the bright night surface to unlit albedo; distinguish the corona contribution from Rays using per-effect-disabled captures.
- [x] Compare Mie presets at identical A05/A07 views, exposure and resolution; retain the parameter-attribution report.
- [x] Add behavioural browser assertions for twilight disk contrast, actual-depth night terrain, irradiance response and explicit unlit mode. Retain four pre-fix failures and the passing result.
- [x] Finish surface lighting, existing-uniform control packing and WebGPU default lighting; preserve explicit unlit mode, original pixel tolerances and occultation cases.
- [x] Calibrate aerosol settings and Corona/Rays from matched controls without new LUTs, render passes or assets. Runtime controls retain the old hazy-medium option.
- [x] Complete 40 focused Node checks, targeted lint/build, commit-hook types and five hardware browser suites. No manual Full run.
- [x] Commit runtime as `9a3a1f2`, then capture 70 images from that clean source with bundle/Shader identity and original PNG hash checks. Preserve old evidence separately.

The final evidence-publication commit and remote branch identity are recorded on existing PR #27 after publication; no main push or merge is authorized. See [the round-three report](round3/README.md) for measured improvements and residual visual concerns. A02's thin rim and A05's haze remain open for visual review; this ledger does not declare B5-A PASS.

## Rulings and review focus

Surface illumination now responds to shared solar irradiance independently of visible-disk toggles. Clear-depth sky pixels receive no surface term. Cold atmosphere-disabled rendering has a separate LUT-free lighting path. `0.025` is an explicitly artistic ambient floor, not physically calibrated indirect irradiance.

A05's generic lower-left image ROI contains atmospheric in-scattering and cannot by itself validate surface albedo illumination. Use actual depth and a separate ground-facing irradiance test; do not classify a bright haze pixel as proof that surface lighting failed. The generic A06 lower-left ROI is sky, not ground.

The existing Corona coefficient assertions were updated to the intentional new blend; numeric texture-edge and energy limits remain unchanged. The first medium diagnostic now restores the same all-effects state before comparison. No independent subagent reviewer was available; the diff and risks were reviewed directly, followed by the recorded tests.
