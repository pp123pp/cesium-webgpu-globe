# Solar Rendering Vision — Game-Engine-Quality Real-Time Sun

**Status:** Long-term visual direction; planning only.  
**Current implementation gate:** M2.6.1-B1, limited to B01 Solar Disc Polish and B02 Solar Rays Polish.  
**Non-goal:** Replacing Cesium's physical/geospatial solar and atmosphere implementation with another engine.

## 1. Vision

Raise the project's real-time Sun presentation toward the visual quality expected from mature game-engine renderers such as Unreal Engine and Unity HDRP, while retaining Cesium's defining strengths:

- Correct scene-time solar direction and apparent angular size.
- WGS84 Earth intersection, actual terrain-depth occlusion and partial / full solar occultation.
- Existing Rayleigh / Mie atmospheric transport and aerial perspective.
- Linear HDR composition, one ACES tone-map and final sRGB encoding.
- WebGPU-native implementation, bounded GPU cost and deterministic resource lifecycle.

“Game-engine quality” means coherent layering, controlled highlight roll-off, rich but restrained detail, stable temporal behavior and consistent appearance across viewpoints. It does **not** mean exaggerated lens flare or a physically simulated solar magnetic field.

## 2. Reference implementations to study

These are technical references, not dependencies to vendor wholesale or instructions to copy assets.

| Reference | Study areas | Application to this project |
|---|---|---|
| [Unreal Engine Sky Atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine) | Rayleigh / Mie scattering, transmittance, multiple scattering, aerial perspective and view-dependent atmosphere | Compare physical atmosphere behavior and solar integration. Reuse the existing Cesium atmosphere unless a measured gap justifies a targeted change. |
| [Unity Graphics / HDRP](https://github.com/Unity-Technologies/Graphics) | Physically based sky, celestial body controls, exposure, bloom and high-dynamic-range presentation | Study separation of physical light parameters from artistic presentation controls. |
| [pmndrs/sky](https://github.com/pmndrs/sky) | WebGPU-oriented atmosphere architecture, LUT generation, compute workflows and integration with a real-time scene | Study implementation patterns that map naturally to WebGPU; do not duplicate the project's existing atmosphere without demonstrated need. |
| [three.js WebGPU examples](https://threejs.org/examples/?q=webgpu) | WebGPU post-processing, bloom, render-target scaling, shader composition and effect isolation | Study small, reusable post-processing techniques and performance trade-offs rather than importing an entire rendering framework. |

Before adopting any implementation, verify its current license, version, API compatibility, color-space assumptions and whether the technique preserves the project's depth / occlusion model.

## 3. Target rendering architecture

Keep the physical source, authored solar appearance, atmosphere and camera/post-processing effects conceptually separate:

1. **Physical Sun source:** scene-time direction, angular radius, irradiance and visibility. This remains authoritative and is not artistically altered.
2. **Photosphere / solar disk:** disk coverage, limb darkening, restrained surface detail and a smooth transition from a near-white core to its edge.
3. **Solar artwork:** authored rays, inner glow, multi-scale halo and restrained irregular corona. These are visual representations, not replacements for physical radiance or atmospheric transport.
4. **Atmospheric transport:** existing Rayleigh / Mie scattering, transmittance and aerial perspective. Avoid double-counting scattering in solar artwork.
5. **Linear-HDR composition:** preserve highlight energy and disk readability; perform bloom before the single ACES / sRGB output path.
6. **Display / optical effects:** optional camera effects belong in a separately scoped layer and must not alter the physical Sun or geospatial visibility.

All solar contributions must follow the projected true Sun position and scene time. Earth and real terrain occlusion must remain effective for the disk, rays, halo, corona and blurred Bloom contribution.

## 4. M2.6.1 — current bounded polish track

M2.6.1 is the immediate, finite improvement to the already integrated M2.6 renderer. Its phase plan is defined in [tasks/M2.6.1.md](../tasks/M2.6.1.md).

| Phase | Scope | Completion boundary |
|---|---|---|
| B1 | Solar Disc and Solar Rays (B01–B02) | Current development phase. Visual acceptance is still required. |
| B2 | Solar Halo and Corona | Start only after B1 visual acceptance and a separate instruction. |
| B3 | HDR Bloom refinement | Improve the existing Bloom path; no general-purpose post-processing framework. |
| B4 | Atmospheric Glow integration | Tune interaction with the existing physical atmosphere; no duplicate scattering model. |
| B5 | Integrated visual acceptance | Complete SVP-01–SVP-10 evidence and regression gates. |

The active B1 PR must remain limited to B01 and B02 runtime work. Planning later phases does not authorize their implementation.

## 5. M2.7 — Advanced Solar Rendering (future proposal)

**Intent:** Extend beyond the bounded polish of M2.6.1 toward a more distinctive, high-end real-time solar presentation.

Candidate work, to be re-scoped before implementation:

- **Photosphere detail:** multi-scale, texture-driven or procedural surface detail with controlled spatial frequency, natural luminance variation and stable sampling. Avoid an obviously tiled texture or noisy animated surface.
- **Advanced corona:** richer directional / filament-like structure, multi-scale variation and smooth falloff. Keep it an authored visual model unless a separately justified physical model is developed.
- **Adaptive quality:** choose sampling / texture detail / effect resolution based on projected solar size, viewport resolution and GPU capability, without visible popping.
- **Temporal stability:** deterministic animation or slowly evolving detail with no swimming, flicker or discontinuities during camera and time changes.
- **Color and radiometry:** maintain separation between physical irradiance and display-oriented artistic controls; validate color-space and exposure behavior.
- **Performance engineering:** profile GPU timestamps, memory payloads and resource lifetimes on multiple representative adapters. Define quality tiers only from measured capability, not user-agent guesses.

M2.7 must not silently add solar flares, magnetic-field simulation, a general PBR system, a new RenderGraph or unrelated camera effects. Those require independent technical justification and acceptance.

**Candidate acceptance:** matched captures at high / low orbit, limb, horizon and ground views; exposure and resolution comparisons; visible / partial / fully occluded Sun; at least 120-frame temporal stability; no new occlusion leaks; GPU mean / p95 and memory/resource accounting on more than one representative adapter; no WebGL regression.

**Scheduling:** optional post-M5 visual track. It must not block M3, M4, M5 or V1.0.

## 6. M2.8 — Cinematic Optical Effects (future proposal)

**Intent:** Add optional camera-oriented presentation effects after the core solar rendering is mature.

Potential independently controllable effects:

- Restrained lens flare and optical ghost chains.
- Subtle lens-dirt modulation.
- Optional anamorphic streaks.
- Camera / exposure-dependent response with carefully bounded intensity.

These are optical / artistic effects, not solar-corona or atmospheric-scattering features. They must be disabled by default, remain user-controllable, preserve black-space contrast and never bypass Earth / terrain visibility. They must not be used to disguise weaknesses in the physical Sun, corona or Bloom.

M2.8 is optional and separate from M2.6.1 and M2.7. It is not a V1.0 blocker.

## 7. Global acceptance principles

A future game-engine-quality claim requires evidence, not a single attractive screenshot:

- **Visual coherence:** disk, inner glow, rays, corona, atmosphere and Bloom read as one coherent source without looking like stacked stickers or a decorative badge.
- **Physical/geospatial correctness:** true solar direction, angular size, WGS84 and terrain-depth occlusion remain authoritative.
- **Dynamic range:** near-white core, controlled edge roll-off, restrained outer color and preserved black-space contrast across manual exposure settings.
- **View consistency:** high orbit, low orbit, orbital limb / sunrise, low-Sun horizon and ground-facing views.
- **Temporal stability:** no popping, texture swimming, aliasing shimmer or abrupt intensity changes during camera / time progression.
- **Resolution robustness:** stable appearance at representative viewport sizes and off-axis positions.
- **Performance and lifecycle:** measured GPU cost, documented memory / texture footprint, stable resource counts through resize, destroy and recreate.
- **Regression safety:** no unintended WebGL behavior changes; existing M2.6 A07–A10 acceptance remains preserved.

Pixel-identical reference matching is not required. Compare equivalent camera, time, exposure, viewport and provider state, and document harmless rendering differences.

## 8. Governance and scope

- M2.6.1 remains the active solar task until B1–B5 are accepted.
- M2.7 and M2.8 are planning proposals only. Each requires a dedicated task specification, explicit authorization, branch / PR boundary and acceptance evidence before code changes.
- M2.7 / M2.8 do not become prerequisites for M3–M5 or V1.0.
- Prefer targeted reuse and measured improvements over broad renderer abstractions.
- Preserve the repository's batched-testing policy: combine related checks, use focused validation during development and execute required final gates on the final PR head.
