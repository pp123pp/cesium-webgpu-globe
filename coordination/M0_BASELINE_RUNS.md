# M0.2 baseline execution log — 2026-11-02

Scope: **original imported CesiumJS 1.146.0, no engine/renderer edits**. Source baseline is anchored by `coordination/M0_SOURCE_AUDIT.md`.

## Attempt 1 — upstream source, unmodified build tooling

- Branch: `feat/m0-webgl-baseline`, workflow commit `5cba6a4af5f383e3add0129a35abf583b27f5ddd`.
- CI: https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41385544464
- Environment: GitHub Actions `ubuntu-24.04`, Node 22 (via `actions/setup-node@v4`), npm workspaces; exact version printed in job logs.
- `npm install --no-audit --no-fund`: **PASS**, 1037 packages installed.
- `npm run build`: **FAIL**, at worker bundle after `packages/core` and engine ESM were emitted.
- Exact diagnostic: `node_modules/draco3d/draco_decoder_nodejs.js:74:117: ERROR: Could not resolve "node:fs"`.
- `npx playwright install --with-deps chromium`, WebGL Viewer browser smoke, and `npm run test-non-webgl`: **NOT RUN** due to the build failure.
- Original `scripts/build-utilities.js` `bundleWorkers` sets `workerConfig.external = ["fs", "path"]`; this does not match the explicit `node:fs` module identifier emitted by the `draco3d` dependency.

## Scope-controlled remediation

This build failure is **not** a WebGL regression from a WebGPU change: the WebGPU backend has not been started and no upstream runtime renderer source was modified. To unblock M0.2, try the minimal bundler-only change of treating the Node built-in `node:fs` (and counterpart `node:path`) as external for browser worker bundling. Keep this change isolated in `scripts/build-utilities.js`; do not change Cesium core or renderer behavior. Re-run the entire M0 baseline workflow, not just the failing build step.

**Gate:** Until a real browser screenshot and tests pass, the WebGL baseline remains **BLOCKED / NOT VERIFIED**. Any subsequent failure must be appended with run ID and diagnostic; do not relabel M0 complete.

## Subsequent verified baseline

The build-only blocker above was resolved by the isolated worker externals fix. Run [41386475484](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41386475484) passed the build and original WebGL smoke, but its non-WebGL tests failed to launch Chrome; the gulp default incorrectly left the job green.

The corrected launcher and `--failTaskOnError` produced the first verified non-WebGL baseline in run [41389237203](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41389237203): **10,353 passed, 5,537 skipped**. That run passed WebGL smoke and deliberately failed the new WebGPU assertion before implementation. Current M0.4 state and later results are recorded in `coordination/STATUS.md` and `coordination/handoffs/M0.4-webgpu-proof.md`.
