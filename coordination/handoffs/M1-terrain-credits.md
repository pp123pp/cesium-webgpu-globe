# M1 native terrain attribution — 2026-11-02

The demo's real-browser inspection found per-tile World Terrain dataset credits present on the native QuantizedMeshTerrainData but missing from the credit panel. Native GlobeSurfaceTileProvider publishes `terrainData.credits` during command construction; the WebGPU adapter previously published only provider-level and imagery credits.

The WebGPU adapter now adds the native credits of the terrain source actually drawn in `showTileThisFrame`, including a ready ancestor used for a clipped child fallback. The native CreditDisplay remains responsible for deduplication and presentation. No source notices or Provider data are rewritten.

A focused test exercising the real adapter/parent fallback failed with no published credit, then passed after the change; all ten provider tests pass. Build and targeted lint are required alongside the demo's integration browser assertion. RED/GREEN evidence: `coordination/evidence/M1/terrain-credits/`. The actual browser report/screenshot and final gate are integrated with the separate demo slice.

Owner: root. Changed files: WebGPUGlobeTileProvider, focused provider test, evidence and this handoff. Next: final demo assertion and full M1 regression on the integrated source.
