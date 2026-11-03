# M2.6.1-B1 — Final WebGPU evidence

All images in this directory are direct `window.__m1.pixels()` captures from the actual WebGPU canvas. No compositing, synthetic imagery, or post-processing was applied.

## Capture environment

- Browser: Chromium 156, headed.
- GPU: Intel Xe-LPG / Intel Arc 130T; `isFallbackAdapter=false`.
- GPU timestamp queries: supported and enabled.
- Baseline commit: `5cb8eda655314119fa5567e1b4c023e2c4217906`.
- Final source branch: `feat/m2-6-1-b1-solar-disc-rays`.
- Matched comparison captures use the same scene time, camera, viewport, exposure and terrain/data state as the baseline subset.

## B1-specific captures

- `B01-disk-only-1920x1080.png`: disk close-up, 4° FOV, exposure 0.5; Rays/Halo/Corona/Tint disabled.
- `B02-rays-only-1920x1080.png`: 24° FOV, exposure 1.0; Rays enabled, other solar effects disabled.
- `B01-B02-combined-1920x1080.png`: normal 24° FOV, exposure 1.0, existing atmosphere and other effects enabled.
- `B01-B02-off-axis-1920x1080.png`: same combined setup with the Sun displaced from screen center.
- `B01-B02-combined-1280x720.png`: resized combined capture at 1280×720.

## Matched baseline comparisons

- `orbital-sunrise-1920x1080.png` pairs with `baseline/orbital-sunrise-1920x1080.png`.
- `low-orbit-1920x1080.png` pairs with `baseline/low-orbit-1920x1080.png`.
- `exposure-0.5/1.0/2.0-1920x1080.png` pair with the corresponding baseline exposure captures.

The B1 disk profile probe used a 1920×1080 viewport and 4° FOV. The measured projected solar radius was 127.83 pixels. Linear radiance decreased from approximately 6.23 at 10% radius to 4.21 red / 4.06 blue at 90% radius; the 90% sample remained fully covered, while the 120% sample had zero coverage. The physical angular radius remained 0.00465 rad.

The B1-specific browser result is in `b1-browser-result.json`. The broader M2.6 regression result and environment are retained as `m2.6-visual-regression-result.json` and `m2.6-visual-environment.json`.
