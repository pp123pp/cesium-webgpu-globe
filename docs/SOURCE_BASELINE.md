# Upstream source baseline

Target: official `CesiumGS/cesium` tag `1.146` (verify the actual tag is `1.146` or `1.146.0` against upstream before checkout). **Never use an unpinned `main` checkout**. Snapshot original tag and upstream commit SHA in `coordination/STATUS.md` after import. Preserve package notices and license texts. This planning repository is initially empty of Cesium sources.

## Preferred upstream strategy
Option A (recommended if continuing to pull upstream fixes): use an **upstream remote** and a clearly documented import/merge of the Cesium tag into your existing repository with a clean commit history.

Option B: copy source from a verified official tag snapshot into a separate tree and record exact commit SHA. Both must avoid silently replacing the planning files. These operations are destructive if performed incorrectly: inspect `git status` and remotes, **backup current work**, and merge planning docs back intentionally. Do not automatically force-push history.

## Research tasks for M0 (do not assume file paths)
1. Enumerate actual `packages/engine` scene/renderer/globe modules in pinned source.
2. Trace Viewer -> Scene frame -> Globe imagery/terrain tile update -> draw submission.
3. Document which internal parts require WebGL and which are CPU-side shared geospatial providers.
4. Inventory existing precision strategies, view frustums and depth policy using upstream code/tests.
5. Measure normal WebGL build/test commands and keep logs.

## Windows installation
Prefer manual, audited source import. A helper `scripts/import-cesium-1.146.ps1` **only fetches upstream into a distinct directory**; it never overwrites this repository. Developer chooses a safe merge method after verifying tag and commit.