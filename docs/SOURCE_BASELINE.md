# Source baseline and provenance

**Imported:** official `CesiumGS/cesium` tagged version `1.146`, package version `1.146.0` on 2026-11-02.

- Official source: https://github.com/CesiumGS/cesium
- Release: https://github.com/CesiumGS/cesium/releases/tag/1.146
- Pinned commit: `b8d3a36fe98a3e432eb89253c95d5f20e605e0f1`
- GitHub Actions import: `.github/workflows/import-cesium.yml`; report: `coordination/UPSTREAM_REVISION.txt`.
- Pinned source copied into **repository root** (not a submodule). Git metadata and upstream CI workflows excluded; Codex plan README/AGENTS/ROADMAP preserved.
- Cesium Apache-2.0 and other source notices retained. Review `LICENSE.md` and upstream third-party notices before adapting source.
- Original upstream README preserved at `docs/UPSTREAM_CESIUM_README.md`.

## Actual startup gate

1. Check `node --version` (Cesium requires Node >=22), `npm --version`, root `package.json`, `.npmrc`, and `packages/engine/package.json`. The upstream monorepo uses **npm workspaces**.
2. Use upstream documented install/build/test commands. Do not silently substitute pnpm or introduce a new package manager.
3. Run original WebGL scene and official build/tests without changing source. Record commands, pass/fail and environment in `coordination/STATUS.md`.
4. Trace Viewer/Scene/Globe -> tile providers -> draw command -> WebGL renderer in **actual source**, including precision/depth and resource lifecycle.
5. Introduce WebGPU backend only after WebGL baseline is verified.

## Development caveats

- The official Cesium monorepo includes many modules and examples; do not reformat or mass-rewrite upstream code.
- The import workflow is **one-time guarded**: it refuses to run if `package.json` already exists.
- The existing `scripts/import-cesium-1.146.ps1` clones to an **independent directory for audit**, never overwriting the repo.
- Historical upstream git metadata was not imported as a merge history. Instead, a fixed commit SHA and tag are recorded so future updates can be considered explicitly.
