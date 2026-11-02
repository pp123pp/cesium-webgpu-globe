# M0 WebGL references

These are bottom-up RGBA canvas pixels compressed with gzip, captured from the
separately built **pre-WebGPU** M0.2/M0.3 baseline
`724b5db8f258d0ce00c4f6b774bd38529e24252b`. That baseline includes the previously
verified Node-only worker dependency build fix and leaves the WebGL renderer
unchanged. Each JSON records source/fixture/harness hashes, colors, camera,
viewport, browser, adapter and payload SHA-256.

The fixture uses the real Cesium WGS84 Globe and EllipsoidTerrainProvider,
with local solid color and no network imagery. It is **M0 WebGL regression
evidence only**, not M1 imagery or terrain acceptance.

Normal runs never update these files. A channel difference over 4 counts as a
changed pixel; at most 0.5% of the full frame may differ to allow small raster
edge differences. Opaque center/background and Globe coverage checks are
independent of reference comparison. The missing-Globe negative control and
synthetic shifted-image test establish that the gate rejects regressions.

## Reproduce

Build the integration checkout, start its production server, then run:

```sh
node coordination/ci/m0-visual-checks.test.mjs
node coordination/ci/m0-browser-config.test.mjs
xvfb-run --auto-servernum node coordination/ci/m0-webgl-smoke.mjs
xvfb-run --auto-servernum node coordination/ci/m0-webgpu-smoke.mjs
```

On a desktop with a display, omit `xvfb-run`. If needed, set
`M0_BROWSER_EXECUTABLE` to an installed Chromium executable. By default the
scripts use a headed software Vulkan/SwiftShader profile and explicitly label
their evidence software. `M0_GPU_MODE=hardware` removes software flags;
`M0_BROWSER_CHANNEL=chrome` or `msedge` selects an installed target browser.
`M0_REQUIRE_PHYSICAL_GPU=1` additionally rejects software/unknown identities
and headless runs. Match hardware-reported identities with host diagnostics
before describing them as physical GPU evidence. The user waived unavailable
physical GPU testing as a blocker on 2026-11-02.

To regenerate deliberately, build a clean separate checkout of the pinned
reference commit, serve that directory on an unused port, and execute the
integration checkout's smoke script **with the reference checkout as cwd**:

```sh
M0_BASE_URL=http://127.0.0.1:8088 M0_UPDATE_WEBGL_REFERENCE=1 \
  xvfb-run --auto-servernum node /path/to/integration/coordination/ci/m0-webgl-smoke.mjs
```

The script rejects any other source commit or modified reference source. A
plain static server avoids the upstream development server's fixed secondary
Sandcastle port 8081 when two builds are served concurrently. Inspect the
screenshots and review reference changes before committing them.
