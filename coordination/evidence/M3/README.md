# M3 local volumetric clouds — physical GPU handoff

**User visual acceptance passed on 2026-11-05.** The user accepted clear far
orbit as the revised A11 requirement, then reviewed and accepted the cloud
crowns, interior lighting and flight striations in the
[final matched physical GPU comparisons](cloud-appearance/README.md).
The measurements below describe the earlier capture at `5a0a22b`.

M3 closed on 2026-11-05 with all five enhancements visually accepted:
[sky lighting](sky-lighting/README.md), [cloud types and distance](cloud-types-and-distance/README.md),
and [cloud evolution and morning light shafts](evolution-and-mist/README.md).

## Replay and results

- **Actual Demo.** Run `npm run demo:webgpu`, open
  `http://localhost:8067/Apps/WebGPUGlobe.html`, enable **Render clouds**, then
  use **Fly above local clouds** over a sunlit location. It targets the center
  of the view and descends to 8.5 km. The optional cyan shell preview is the
  earlier M3-01 diagnostic. [Actual controls and teardown](demo/result.json).
- **Orbit and descent.** At GEO and at the orbital limb, maximum-coverage or
  enabled clouds respectively matched the disabled image and issued zero cloud
  passes. The approach sweep records enabled/disabled pairs at 10 km intervals.
  At the fixed test angle the first visible 8-bit difference was at 230 km.
  The 80–250 km camera transition and the view-distance fade are separate.
  [Orbital frame](volume/01-orbit-enabled.png) · [measurements and camera poses](volume/result.json).
- **Local availability.** Matched on/off views at the equator, North Atlantic and
  South Indian Ocean show clouds in all three regions. Replaying the equatorial
  pose at the same date reproduced the exact image. Coverage zero reproduced
  clear output. A separate compute probe ran 53,256 samples of the real WGSL,
  including six geographic regions, 57 meridian/pole pairs and wind progression.
  [Field evidence](field/result.json) · [North Atlantic](volume/03-local-north-atlantic-on.png).
- **Clouds and lighting.** The 192 original volume frames cover orbital descent,
  cloud sea, top/interior/base traversal, sunrise and sunset, fast pan/zoom/flight,
  wind, coverage, raised terrain, exposure, lens, vacuum, date changes, resize
  and polar views. An 8 km native terrain mesh fully occluded the cloud column at
  nadir. [720p ground view](volume/13-ground-afternoon-720p.png) ·
  [720p cloud sea](volume/13-cloud-sea-720p.png) · [interior](volume/05-cloud-interior.png) ·
  [sunset](volume/06-sunset.png) · [20 captured flight frames, slowed for inspection](flight.webp).

## Performance and resources

The [follow-up performance experiment](performance/README.md) records the zero-coverage fix, both rejected shader candidates and 120-frame physical GPU profiles on the accepted cloud scenes.

Clean capture revision `5a0a22b6a9150e307aaf666acf8c3d1977debd9a`,
headed Chrome 156.0.8078.80, Intel Xe-LPG WebGPU. WebGL identifies the host
GPU as Intel Arc 130T. Numbers are cloud-only GPU timestamps with ten measured
frames per row after warmup. Whole-frame FPS, resident VRAM and additional
adapters are unmeasured. [Per-pass samples, budgets and allocations](volume/result.json).

| View and quality | Output | Trace target | Mean ms | p95 ms |
| --- | --- | --- | ---: | ---: |
| GEO, any enabled coverage | 480×270 | culled | — | — |
| Cloud sea, Low | 480×270 | 240×135 | 2.64 | 2.95 |
| Cloud sea, Medium | 480×270 | 240×135 | 6.96 | 7.80 |
| Cloud sea, High | 480×270 | 480×270 | 17.66 | 22.94 |
| Interior, Medium | 480×270 | 240×135 | 5.00 | 5.83 |
| Fast flight, Medium | 480×270 | 240×135 | 4.37 | 5.83 |
| Cloud sea, Medium | 1280×720 | 640×360 | 17.96 | 18.87 |

At 720p/Medium, tracing took 16.02 ms mean and depth-guided reconstruction
1.93 ms. Native foreground samples with incompatible neighbors are retraced.
Low/Medium/High share the field and use primary/secondary budgets of 96/2,
192/4 and 224/6. Outside the timing window, replayed native-pixel rays in the
three Medium probe views executed 192 primary iterations and 0–204 secondary
density evaluations. These samples are separate from whole-frame statistics.
The 32³ RGBA8 volume uses 131,072 bytes, the cloud parameter buffer 128 bytes,
and the 640×360 RGBA16F target 1,843,200 bytes. The High path draws directly
into the scene-linear target. All six recorded cloud resource allocations were
destroyed exactly once across tier changes, resize and teardown.

## Visual limits and follow-up

Sparse cloud banks remain anchored in ECEF as the camera moves. Compared with
the rejected orbital and 48-step prototypes, the final version removes the orbital
white patches and substantially reduces horizontal layering in the North Atlantic
and interior views. The 720p crowns and bases still look soft, some crowns have
pointed profiles, sunset silver lining is restrained, and some distant flight
frames retain fine striations. The ordered flight sequence is a bounded camera
path, not a long-duration stability test. The fixture uses plain native terrain
to isolate the volume. Live network imagery, artist parity with Takram/Tidewater
and cross-device performance are outside the measurements.

The build, 17 focused unit cases and the applicable commit-time lint/types passed.
The production Demo verified toggles, the 8.5 km fly-to and cleanup. Three native
WebGL smoke views passed against the repository reference. [WebGL report](webgl/webgl-smoke.json).
No manual Full or software rendering was used.

For reproduction, run the tests from the repository root with the build served
locally. Set `M0_BROWSER_EXECUTABLE` to the installed physical-GPU Chrome,
`M1_BASE_URL` and `M0_BASE_URL` to that server. Invoke
`node coordination/ci/m3-volume-smoke.mjs`, `node coordination/ci/m3-cloud-demo-smoke.mjs`,
`node coordination/ci/m3-cloud-density-probe.mjs` and
`node coordination/ci/m0-webgl-smoke.mjs` with separate output directories.

The [source study and architecture](../../plans/M3-global-volume.md) describes
the four pinned upstream projects and the local visual reference. M4 can reuse
the georeferenced `cloudDensity`, wind angle and existing Sun direction. Its
terrain shadow projections must sample the underlying density independently of
the M3 camera visibility fade. Terrain shadow receivers remain M4 work.
