# M1 terrain provider error recovery — 2026-11-02

The continuation review reproduced a terminal error from the old terrain generation after a provider error listener had already replaced the terrain or destroyed its owner. `TileProviderError.reportError` invokes listeners synchronously; `_terrainFailure` previously continued after that callback and raised the stale root error through the new scene's fatal error path.

The adapter now checks its existing released/destroyed ownership guard again after the callback. Native provider notification still occurs; active generations keep the original retry/parent fallback/failure policy. No WebGL source changes.

Executed `node coordination/ci/m1-tile-provider.test.mjs`: both new scenarios failed against the original adapter, then all eight tests passed with the guard. The replacement scenario loads/renders the new generation and releases its GPU allocation. The destruction scenario emits no stale fatal error. RED/GREEN logs (`red.txt`, `green.txt`): `coordination/evidence/M1/provider-reentrancy/`. Targeted ESLint passed.

Owner: root. Files: `WebGPUGlobeTileProvider.js`, its focused test, this handoff and the two logs. M1 remains in progress: expanded live terrain flight has a separate confirmed transient full-frame hole, and final demo/regression/review gates remain required.
