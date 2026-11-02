# M0.1 — Pinned-source verification (2026-11-02)

**State: VERIFIED (source provenance and manifest inspection only).**
**Branch:** `feat/m0-webgl-baseline`. **Owned files:** coordination documentation and M0 CI harness; no upstream renderer source modifications.

## Evidence
- Canonical upstream ref: `CesiumGS/cesium`, annotated tag `1.146`.
- GitHub REST `git/ref/tags/1.146` returns tag-object SHA `b90bf5fa30c8f573072181165c9462d987e26580`.
- Dereferencing `git/tags/b90bf5fa30c8f573072181165c9462d987e26580` returns commit `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`; matches `coordination/UPSTREAM_REVISION.txt` and import workflow's expected SHA. A tag-object SHA is not the commit SHA.
- Root `package.json` declares version `1.146.0`, npm workspaces (`packages/core`, `packages/engine`, `packages/widgets`, `packages/sandcastle`) and Node `>=22.0.0`.
- `packages/engine/package.json` declares `@cesium/engine` version `26.4.0`.
- Verified representative existing paths: `packages/engine/Source/Scene/Globe.js`, `packages/engine/Source/Scene/Scene.js`, `packages/engine/Source/Renderer/Context.js`, `packages/engine/Source/Widget/CesiumWidget.js`, `packages/widgets/Source/Viewer/Viewer.js`, `LICENSE.md`.
- `LICENSE.md` contains Apache License 2.0 and third-party license notices. Existing notices must be retained.
- The one-time `.github/workflows/import-cesium.yml` explicitly asserts upstream commit equality prior to copying the source. The import workflow had a successful run; this is **not** equivalent to successfully building or rendering Cesium.

## M0.2 task contract
**Goal:** establish an independently reproducible, unmodified Cesium WebGL build and a real Chromium Viewer smoke.
**File ownership:** `.github/workflows/m0-webgl-baseline.yml`, `coordination/ci/m0-webgl-smoke.mjs`, and M0 task evidence/handoffs. No changes to `packages/`, `Source/`, or `Specs/`.
**Test gate:** npm workspace install; `npm run build`; upstream `npm run test-non-webgl`; browser open official `Specs/e2e/cesium.html`, instantiate WebGL Viewer with offline ellipsoid/no ion assets, render and capture screenshot.
**Parallelism:** upstream source read-only audit may run separately; workflow and tests must not edit shared Renderer/Scene/Viewer files. Feature work on M0.4 is blocked until M0.2 is actually verified.

## Environment limitation
The chat's local runtime has Node `v22.16.0`, npm `10.9.2`, Chromium `/usr/bin/chromium`, but GitHub DNS access is unavailable (`git ls-remote`: "Could not resolve host: github.com"). Therefore no local checkout or local test result is claimed. A GitHub-hosted CI run is required to establish browser/build evidence.
