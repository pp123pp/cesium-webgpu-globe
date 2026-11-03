# M2.6.1-B1 — Baseline captures

Captured before B01/B02 changes from main commit `5cb8eda655314119fa5567e1b4c023e2c4217906`.

- Browser: Chromium 156, headed; physical Intel Arc 130T GPU (Intel Xe-LPG), driver 32.0.101.8801.
- Renderer: actual WebGPU; `isFallbackAdapter=false`; source worktree clean.
- Runtime bundle SHA-256: `554479fae644de144388930d5777eb98bf1f04086e327e3545d69356f4e9a876`.
- Primary viewport: 1920×1080. The baseline run also completed 1280×720 resize and 120-frame camera/time movement.
- `orbital-sunrise`: scene time `2026-03-20T06:00:00Z`, 400 km orbital view, sun at the limb + 0.05°.
- `low-orbit`: scene time `2026-03-20T12:00:00Z`, 400 km orbital view, sun at the limb + 2°.
- Exposure captures: same scene and camera at 0.5 / 1.0 / 2.0.
- PNGs are unmodified captures from `window.__m1.pixels()` on the real WebGPU canvas.

Only the representative baseline PNG subset is committed here. The original full baseline run report was not retained when the final regression run reused the temporary `Build/m2.6-solar-visual/` output directory.
