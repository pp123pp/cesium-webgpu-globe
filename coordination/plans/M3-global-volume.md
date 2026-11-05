# M3 global cloud volume

**Revised after first physical capture (2026-11-05).** The user rejected the
white orbital patches and requested Takram-like local volumes at every zoomed-in
location. A11 now checks optically clear far orbit, gradual local appearance,
and geographic persistence. The user selected local cloud availability at every
region for positive coverage; zero is exactly clear. The original orbital
visibility objective elsewhere in this design records the first iteration.
Use an 80–250 km smoothstep for camera altitude and sample range, and skip the
cloud pass entirely above 250 km. Today's selected thresholds are engineering
defaults. Wind and local noise remain anchored to Earth. Check cloud-top relief,
openings, self-shadow and grazing sunlight on captured frames.

The user's local visual reference is `D:/myProject/web3dEng-new/examples/clouds`.
`main.ts` configures the physical sky and local cloud demo. Its implementation
in `src/engine/Scene/internal/NodeTidewaterClouds.ts` combines a forward and
a backscattering lobe, attenuated higher orders, powder, underside darkening
and altitude-dependent skylight. Adapt these lighting principles to the shared
WGS84 density, M2 solar transmittance and HDR buffer with original equations
and coefficients. The reference demo's terrain shadow maps and external binary
noise assets are outside this integration.

Local starting point: M3-01 `e2cb35e1`, including geometry implementation
`0ed4fb5` and physical-GPU capture source `07e00af`. The user closed M3-01.
Local and remote main were `bc649cc8` at inspection. Keep both shell intervals,
split reciprocal radii, camera constants, native depth, diagnostic overlay and
its existing evidence. A11–A13 concern the illuminated volume.

## Source review

These are source inspections, not target-machine benchmarks. All four use
programmable sampling/integration that can be expressed in WGSL. We use original
code and procedural data. None of their shaders, noise assets or maps are imported.

| Reference | Verified in the implementation | Transfer decision and limits |
| --- | --- | --- |
| Takram three-geospatial | [Ray integration, light march, atmospheric perspective, camera inside/outside and depth clipping](https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/packages/clouds/src/shaders/clouds.frag#L472-L851). [Temporal resolve](https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/packages/clouds/src/shaders/cloudsResolve.frag#L63-L101) uses motion and neighborhood clipping. | Planetary layers and internal views are implemented. Representative-depth aerial perspective is useful. Their 2D weather mapping and temporal reconstruction have documented [seams, wispy-cloud trails and disocclusion issues](https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/packages/clouds/README.md#L180-L196). Quarter-axis tracing saves primary samples but needs full-size history targets. Cascaded Beer shadows would expand M3. [Package license and third-party notices](https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/packages/clouds/LICENSE). |
| Unity HDRP | [Planetary shell cases](https://github.com/Unity-Technologies/Graphics/blob/0efc28ea742b1966b9dd9cc4489e58b986a13faf/Packages/com.unity.render-pipelines.high-definition/Runtime/Sky/CloudUtils.hlsl#L8-L36) support camera above, inside and below. [Density, lighting and adaptive steps](https://github.com/Unity-Technologies/Graphics/blob/0efc28ea742b1966b9dd9cc4489e58b986a13faf/Packages/com.unity.render-pipelines.high-definition/Runtime/Lighting/VolumetricClouds/VolumetricCloudsUtilities.hlsl#L199-L605) combine shape and erosion, cheap sun samples and transmittance termination. | One visible interval and an XZ custom-map path cannot represent our two-limb-segment case and global weather. [Depth-based history rejection](https://github.com/Unity-Technologies/Graphics/blob/0efc28ea742b1966b9dd9cc4489e58b986a13faf/Packages/com.unity.render-pipelines.high-definition/Runtime/Lighting/VolumetricClouds/VolumetricClouds.compute#L77-L149) addresses camera motion at a history-memory cost. Low-resolution tracing and accumulation require additional buffers. Camera-relative geometry alone does not establish WGS84 precision. Study only under the [Unity Companion License](https://github.com/Unity-Technologies/Graphics/blob/0efc28ea742b1966b9dd9cc4489e58b986a13faf/LICENSE.md). |
| Cesium Volumetric Cloud Lab | [Ellipsoid coordinates, directional weather, height and nearest shell segment](https://github.com/tatsuya-ogawa/cesium-volumetric-clouds/blob/810a680a78ea32a533ec1d02ed92fd8a8524d900/app/cloud-field-shader.ts#L67-L176). [Scene depth and volume march](https://github.com/tatsuya-ogawa/cesium-volumetric-clouds/blob/810a680a78ea32a533ec1d02ed92fd8a8524d900/app/cloud-fragment-shader.ts#L125-L217) use a 220 km cap and bounded primary/light steps. | Supports planetary views including entry. A nearest-only interval can omit a visible limb segment. Every-axis 0.4 tracing plus simple filtered enlargement can bleed across terrain silhouettes. Its [multiscale Beer maps](https://github.com/tatsuya-ogawa/cesium-volumetric-clouds/blob/810a680a78ea32a533ec1d02ed92fd8a8524d900/app/beer-shadow-sampling-shader.ts#L217-L349) belong to M4. [MIT](https://github.com/tatsuya-ogawa/cesium-volumetric-clouds/blob/810a680a78ea32a533ec1d02ed92fd8a8524d900/LICENSE), [third-party notices](https://github.com/tatsuya-ogawa/cesium-volumetric-clouds/blob/810a680a78ea32a533ec1d02ed92fd8a8524d900/THIRD_PARTY_NOTICES.md). |
| Three Planet Clouds | [Direction-based seeded fronts and weather channels](https://github.com/rsteth/three-planet-clouds/blob/9354e96ce7e4fcc79e376b3e3082f0bfcf48beb9/src/cloud-weather.js#L67-L218), [cube faces from that field](https://github.com/rsteth/three-planet-clouds/blob/9354e96ce7e4fcc79e376b3e3082f0bfcf48beb9/src/cloud-volume-data.js#L219-L240), [two segments, detail fade, self-shadow, depth-guided resolve](https://github.com/rsteth/three-planet-clouds/blob/9354e96ce7e4fcc79e376b3e3082f0bfcf48beb9/src/cloud-high.js#L79-L280). | Spherical planet and in-volume rays, but its units and tier switch to instanced clouds do not satisfy our WGS84 and shared-volume requirements. Author reports [689,152 bytes of field/noise textures, excluding RTs](https://github.com/rsteth/three-planet-clouds/blob/9354e96ce7e4fcc79e376b3e3082f0bfcf48beb9/docs/PERFORMANCE.md). [MIT and third-party notices](https://github.com/rsteth/three-planet-clouds/blob/9354e96ce7e4fcc79e376b3e3082f0bfcf48beb9/THIRD_PARTY_NOTICES.md). |

No reference establishes pop-free motion, resident VRAM or frame time on this
GPU. A latitude/longitude weather raster brings a seam and pole filtering.
Sampling a continuous 3D function on a rotated unit direction avoids both.
Periodic filtered 3D noise can service the regional and near scales without a
second weather system. A cube bake is an alternative if profiling warrants it.

## Data and pass order

```text
Cesium render time + fixed seeded field + wind rotation
                        |
WGS84 sample direction -> regional weather -> vertical profile -> 3D shape/erosion
                                                                       |
native camera, reversed terrain depth -> M3-01 shell segments -> optical integrals
                                                                       |
linear terrain/space/Sun/atmosphere -> foreground air + volume blend -> Bloom
                                  -> optional lens -> exposure/ACES/sRGB -> canvas
```

Rebase samples at shell entry using split camera ECEF and distances in meters.
For a sample p, derive radial altitude from ellipsoid-scaled p; geodetic and
radial height differ slightly inside this shallow envelope. Regional fields
control coverage, type, development, local base/top and extinction within the
existing 2–6 km shell. Wind uses the Cesium date and a smooth rotation of the
shared field. Filter high frequencies with a continuous footprint/distance
weight. Optional local enhancement admits wisps at low nonzero macro coverage;
zero coverage must remain exactly clear. This deliberately raises near-view
contrast relative to the physically filtered view. Default enhancement off.

Use original Beer–Lambert segment weights, positive source radiance, forward HG
and a bounded secondary march into the same density toward the existing Sun.
Atmospheric direct-light attenuation and foreground air use M2 transport.
With premultiplied cloud C, transmittance T, contribution-weighted distance d
and clear HDR background B, blend T*B + Tair(d)*C + (1-T)*Lair(d).
This single effective depth is approximate for separated cloud banks. With
atmosphere hidden, use unit air transmittance and zero foreground air.

Start with native-depth, full-resolution output, stable sampling without history,
early extinction termination and Low/Medium/High primary/light budgets.
This avoids a depth reconstruction or temporal failure being mistaken for a
weather defect. Request GPU timestamps through the benchmark harness. If cost
requires reduced resolution, use a separate radiance/transmittance target and
depth-guided reconstruction. Enable temporal accumulation only after a motion
failure is reproduced; then reproject using camera and wind, reject depth mismatch
and reset on resize, clock jumps and configuration changes.

## Implementation and verification batches

1. **M3-02** — deterministic shared weather, periodic detail, wind clock and
   density; verify longitude wrap, poles, coverage extremes and time continuity.
2. **M3-03/04** — one integrator owns shader bindings, cloud resources and
   linear HDR composition. Expose an opt-in Scene control and actual demo controls.
   Use the existing shell/depth, account for both intervals and test both
   atmosphere modes, thin edges, interior, terrain and clear/off restoration.
3. **M3-05/06** — fixed coordinates, dates and camera path for orbit, limb,
   continuous descent, sea, cloud-top/interior/base, low Sun, fast pan/zoom/flight,
   wind and date changes, coverage sweep, terrain/HDR, resize/disposal and poles.
   Capture physical adapter identity, images, dimensions, sample budgets, target
   bytes, pass timestamps by altitude and motion, and record uncovered evidence.
   Only claim A11–A13 after reviewing actual output. Use the focused WebGL smoke
   for shared integration. No manual Full, software GPU, external assets or merge.
4. **M4 handoff** — the receiver can evaluate the same field, altitude and time
   along the same solar direction. Terrain shading, projected shadow maps and
   their lifetimes belong to M4.
