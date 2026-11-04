# M2.6.1-B2 — Solar Halo & Corona Evidence

**Current delivery: round-two technical verification complete; user visual acceptance pending.**

- [Round-two implementation, matched screenshots and validation](round2/README.md)
- [Current machine-readable summary](result.json)
- [Original round-one README, preserved verbatim](round1/README.md)
- [Original round-one result, preserved verbatim](round1/result.json)

B1 B01/B02 was visually accepted by the user on 2026-11-03. B2 B03/B04 remains on [PR #22](https://github.com/pp123pp/cesium-webgpu-globe/pull/22), based on the B1 branch. This delivery does not grant user acceptance, merge either PR, or authorize B3–B5 or later milestones.

## Historical clarification

The original six round-one images remain available at their original paths and in `round1/`. Their original runtime source is `44fb757a0e07f59c852807d41f2e0e437a087c26`. They used 12-degree FOV, Rays 0 and Bloom 0, including files historically named `combined`; they are diagnostic evidence, not normal full-effect captures.

The preserved round-one README contains transcription errors. Its raw JSON is authoritative: Halo isolation is **126,700 changed pixels / maximum difference 171**, and Corona isolation is **123,924 / 148**. The original README said 126,148 / 166 and 123,909 / 89. These old metrics do not establish the new round-two result.

The user's prior review remains part of the record: Halo falloff was basically sound; Corona still had traced curves, petals and ribbons, so B2 visual acceptance was open. Round two addresses that geometry with new evidence rather than relabeling the old images as accepted.
