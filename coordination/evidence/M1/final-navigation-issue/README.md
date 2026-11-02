# M1-NAV-001 — known unresolved rapid terrain descent

The user explicitly authorized this repeatedly unresolved navigation issue to remain nonblocking for M1 on 2026-11-02. The instruction is preserved in `authorization.json`. This is separate from the global policy allowing harmless image differences: the navigation defect is a real limitation and is not classified as a harmless image difference or a passing A06 observation.

## Actual failing committed-source run

`error.json` and screenshots come from source `5877be73efd1dcda3ae3e08c7d4e016c645e9cb9`, after multiple native-fill/selection/bounds corrections. All four ordinary LOD transitions had zero background and zero untextured pixels. The fast flight still entered coarse terrain in two frames:

| Frame | Camera height | Sampled terrain height | Background pixels |
| --- | --- | --- | --- |
| 15 | 5381.2678 m | 5450.9429 m | 87 |
| 16 | 5299.6816 m | 5450.9805 m | 83 |

Both frames report `cameraUnderground=true`. The image shows remote continental surfaces and skirt walls through the interior, not a correct Everest near-ground view. The final settled camera is approximately 33.579 m above the refined terrain and has no background/untextured pixels; that does not erase the transient failure.

## Narrow nonblocking classification

The scenario continues to execute and retain its observations. The report uses `KNOWN_UNRESOLVED` for the demonstrated near-ground collision or a final elevation demonstrably retained from a coarse-terrain collision clamp. It records the native pick that actually supplies `Globe.getHeight`, not merely the presence of a READY ancestor. The whole terrain report explicitly uses `PASS_WITH_KNOWN_ISSUES`; even a later passing sample does not claim the intermittent issue is fixed.

Unknown in-flight holes, missing imagery, holes in the final settled frame, a final underground position, insufficient terrain LOD, incomplete flights, browser errors, and timeouts remain failures. Ordinary terrain LOD, imagery drape and its negative control, resource destruction, other navigation tests and full upstream regressions still run independently.

The seven classification tests include counterexamples for an unrelated fill-height source and an unrelated high endpoint after an earlier clamp. Their original RED and corrected GREEN logs are retained here.
