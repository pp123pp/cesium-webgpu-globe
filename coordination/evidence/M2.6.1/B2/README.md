# M2.6.1-B2 — Solar Halo & Corona Evidence

**Current delivery: technical PASS; B2 visual acceptance confirmed by the user on 2026-11-04; integration into main authorized.**

- [Round-two implementation, matched screenshots and validation](round2/README.md)
- [Current machine-readable summary](result.json)
- [Original round-one README, preserved verbatim](round1/README.md)
- [Original round-one result, preserved verbatim](round1/result.json)

## User acceptance — 2026-11-04

The user explicitly confirmed (Asia/Shanghai): “B2通过画面验收，将当前成果合并到main”. The accepted B2 B03/B04 publication head is `d5d7b84ecdb27091537d9a564b9ccf7942561cc6`. B1 B01/B02 was already visually accepted on 2026-11-03.

The instruction authorizes integrating the accepted results in dependency order: [PR #21](https://github.com/pp123pp/cesium-webgpu-globe/pull/21) into main, then [PR #22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22) retargeted to main. PR #21 merged as `eeaca1ddc3ef960ad23cd4aae9757b31ea98063a`; PR #22's merge record tracks the final B2 integration. B3–B5 and later milestones remain unauthorized.

The original capture reports, PNGs, audit measurements and historical failed/intermediate attempts are unchanged. PENDING/READY fields inside original run reports describe the capture-time checkpoint; the subsequent user decision is recorded here and in the current summary. The recorded soft outer Corona, exposure-2 contrast, scene-naturalness and single-device limitations remain; B2 acceptance does not close M2.6.1 as a whole.

## Historical clarification

The original six round-one images remain available at their original paths and in `round1/`. Their original runtime source is `44fb757a0e07f59c852807d41f2e0e437a087c26`. They used 12-degree FOV, Rays 0 and Bloom 0, including files historically named `combined`; they are diagnostic evidence, not normal full-effect captures.

The preserved round-one README contains transcription errors. Its raw JSON is authoritative: Halo isolation is **126,700 changed pixels / maximum difference 171**, and Corona isolation is **123,924 / 148**. The original README said 126,148 / 166 and 123,909 / 89. These old metrics do not establish the new round-two result.

The user's prior review remains part of the record: Halo falloff was basically sound; Corona still had traced curves, petals and ribbons, so B2 visual acceptance was open. Round two addresses that geometry with new evidence rather than relabeling the old images as accepted.
