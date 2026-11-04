# M2.6.1-B4 — B05 Atmospheric Glow Integration

**B4 implementation and scoped technical verification completed; awaiting user visual acceptance.** This is not B5 integrated acceptance and does not authorize merge to main.

## Change summary

- WebGPUSunShader.js now receives the actual view-path Rayleigh/Mie transmittance in the atmosphere composite.
- Only authored Rays / Halo / Corona artwork is gently attenuated as the view path becomes optically thick. A Rec.709 luminance measure drives a bounded factor from 0.58 to 1.0; the analytic solar disk remains unchanged and continues to receive the existing physical Beer-Lambert transmittance in the compositor.
- The Sun-only path supplies unit transmittance, preserving its prior behavior when atmospheric integration is disabled. Existing Earth/terrain occlusion and Sun direction/radius/radiance remain authoritative.
- No new render pass, texture, uniform buffer, texture asset, or WebGL change. Existing scene-linear HDR → Bloom → ACES → sRGB order is unchanged.

## Before / after WebGPU captures

Both sets use the same 1920×1080 headed Chrome / Intel Xe-LPG adapter, same smoke script and controlled scene sequence. Before is the unmodified main runtime at 5f18afc1b77f433892f14510b2599c374f8a4942; after is the B4 runtime committed as ff06e9691ae98550cc965e1f8c6313a730c0bab6 (PR #25), built from the same base. Bundle hashes are recorded in the respective result files.

| Scenario | Before | After |
| --- | --- | --- |
| High orbit, direct Sun | [PNG](before/high-orbit-direct-atmosphere-on.png) | [PNG](after/high-orbit-direct-atmosphere-on.png) |
| Orbital sunrise / limb | [PNG](before/orbital-sunrise-atmosphere-on.png) | [PNG](after/orbital-sunrise-atmosphere-on.png) |
| Low orbit / low Sun | [PNG](before/low-orbit-low-sun-atmosphere-on.png) | [PNG](after/low-orbit-low-sun-atmosphere-on.png) |
| Near-ground low Sun | [PNG](before/near-ground-low-sun-atmosphere-on.png) | [PNG](after/near-ground-low-sun-atmosphere-on.png) |
| Ground daylight | [PNG](before/ground-day-atmosphere-on.png) | [PNG](after/ground-day-atmosphere-on.png) |
| Ground twilight | [PNG](before/ground-twilight-atmosphere-on.png) | [PNG](after/ground-twilight-atmosphere-on.png) |
| Ground night | [PNG](before/ground-night-atmosphere-on.png) | [PNG](after/ground-night-atmosphere-on.png) |
| Exposure 0.5 / 1 / 2 | [0.5](before/orbital-limb-exposure-0.5.png) · [1](before/orbital-limb-exposure-1.png) · [2](before/orbital-limb-exposure-2.png) | [0.5](after/orbital-limb-exposure-0.5.png) · [1](after/orbital-limb-exposure-1.png) · [2](after/orbital-limb-exposure-2.png) |

Each directory also contains the corresponding atmosphere-off diagnostic controls. All 17 PNGs per side are retained, together with raw [before report](before/result.json) and [after report](after/result.json).

The before/after image difference is intentionally subtle and localized to the solar artwork contribution; it is not a pixel-perfect visual acceptance claim. The orbital-sunrise full-frame RGB mean absolute difference is 0.0452 byte levels; near-ground low-Sun is 0.1323. Manual review of the complete set remains with the user.

## Environment and performance

- Windows, Chrome **156.0.8078.80**, Cesium **1.146.0**, Node **22.20.0**.
- WebGPU adapter: **Intel Xe-LPG**, non-fallback; OS device record: Intel Arc 130T, driver **32.0.101.8801**.
- 1920×1080, exposure 1 for the timing scene, Bloom 0.35, all five solar effect strengths 1.
- Timestamp-query available; 15 samples per mode, 5 render passes when Bloom is enabled.
- Before / after all-enabled GPU pass-sum mean: **5.0244 / 4.9720 ms**; p95 **5.7672 / 5.5050 ms**. GPU frame-span mean: **5.9288 / 5.6186 ms**. The approximately 1% mean difference is within run-to-run variation; no material B4 regression is indicated.
- Renderer allocation payload: **21,808,128 bytes** both sides; no new textures/buffers during timing. Physical resident VRAM is not exposed by portable WebGPU APIs and is unverified.
- Full raw samples and pass breakdowns are in [before/result.json](before/result.json) and [after/result.json](after/result.json).

## Verification

- npm run build — PASS.
- Focused Node batch — **19 passed, 0 failed** (B4 shader integration, atmosphere model/lifecycle, solar lifecycle and B1 solar invariants).
- Targeted ESLint and smoke-script syntax check — PASS.
- Real hardware WebGPU smoke — PASS; 17 captures per run, no browser errors. Scenarios: high orbit, orbital sunrise, low orbit, near-ground low Sun, ground day/twilight/night, atmosphere on/off controls, and exposure 0.5/1/2.
- Existing HDR/Bloom pass count and texture payload unchanged. No new rendering pass or GPU texture introduced.
- This B4 suite does not execute B5's full integrated acceptance, a 120-frame temporal acceptance, the complete occultation matrix, or a new WebGL differential. These are not claimed complete.

## Status

**Implementation and B4-scoped verification complete — awaiting user visual acceptance.** Do not merge main or start B5 until separately instructed.
