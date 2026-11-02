# M1 final closeout evidence

This directory preserves the actual 2026-11-02 closeout observations. The user authorized only the repeatedly unresolved rapid real-terrain descent issue (`M1-NAV-001`) to remain nonblocking. It is not fixed, and A06 is not unconditionally passed.

## Verified local source

Local clean source `f2b99213d61046b9a528dd5a2dc87067941d1714` and published source `03233dae8b524d6b3f4498a48a2fd7e89fffa806` have the identical Git tree `48142ced46a15cdf435db7902b9ba601449b5358`. GitHub API publication changes commit metadata, not the verified files. No previous work was rewritten or discarded.

| Preserved local work | Published commit | Exact tree |
| --- | --- | --- |
| `fd0cae8` (previous CI compatibility fix) | `6ffe437` | `caaac5d4127da4da4b4775a6fc3354cbd8aec8fc` |
| `5877be7`, recovered as `d6f6484` (native terrain fill) | `d016081` | `03e9ea7f0f85cbcdef2231343aadcb964a8c552f` |
| `656cb08`, recovered as `a31efa3` (specific navigation classification) | `a4be6b0` | `d89ca13dd98320229b13ef3e8df235c4038fbded` |
| `f2b9921` (closeout plan, clean browser source) | `03233da` | `48142ced46a15cdf435db7902b9ba601449b5358` |

`local/manifest.json` records the result identities and SHA-256 checksums. Local evidence uses Node 24.22.1, Chromium 156.0.8078.4, headed Xvfb, Google SwiftShader software GPU and a 1280×720 viewport. There is no physical GPU or hardware performance claim.

## Local observations

- Build, ESLint, generated declarations and TypeScript checks: PASS.
- Focused M0/M1 tests: 160 PASS. The CI-policy suite's original sandbox `EPERM` is retained separately; the unchanged 28 tests passed after normal child-process execution was allowed.
- Live terrain: `PASS_WITH_KNOWN_ISSUES`. Four ordinary LOD transitions have zero background/untextured pixels. This particular rapid flight passes (13 sampled frames, final 33.579 m above terrain); `observedThisRun=false` does not resolve the intermittent issue.
- Drape: 561/561 independently picked samples pass; the actual 1 km GPU mapping offset makes 535 samples fail. All 1,334 buffers / 419 imagery textures are destroyed, with zero retained bytes, requests or canvases.
- Demo: all 10 checks PASS; 1,004/1,004 buffers and 324/324 native GPU textures, including depth textures, are destroyed. Real terrain/imagery, attribution, buttons, provider retry, terminal device loss and page exit all execute.
- Inspected screenshots: near-ground terrain, coordinate-pattern drape and live Everest demo. The near-ground image is naturally limited by the provider imagery resolution; acceptance does not require pixel-identical output.

## Hosted verification

Published source `03233da` passed [Fast 41430449080](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449080) and [Full 41430449094](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094). Full regression job `125227480660` actually executed every required gate. The source-specific results below are distinct from the earlier local run.

| Hosted gate | Result |
| --- | --- |
| Build / lint / declarations / TypeScript | PASS |
| Focused M0/M1 suites | 160 passed across 17 suites; zero failed or skipped |
| Non-WebGL | 10,353 passed / 5,537 skipped |
| Full WebGL differential | 3,811 passed / same 11 failed / 12,068 skipped per side; 3,822 executed, no new failures |
| WGS84 / imagery / ordinary navigation | PASS; each raw report identifies `03233da` |
| Real terrain | PASS_WITH_KNOWN_ISSUES; all A05, drape/control and cleanup checks passed |
| Live demo | 10/10 checks PASS |

**This hosted run observed M1-NAV-001.** Its rapid real-terrain flight completed, but coarse-terrain collision left the endpoint 2,098.890 m above loaded terrain and above the requested height. `knownIssues[0].observedThisRun=true` and `groundFlight.acceptance.status=KNOWN_UNRESOLVED`; this must not be replaced by the local 33.579 m passing sample. All later mandatory checks ran: 561/561 drape samples, 535 failing samples under the deliberate 1 km offset, and complete release of 1,184 buffers / 424 imagery textures. Demo released 884 buffers / 242 native GPU textures.

`hosted/manifest.json` identifies original [artifact 13134792351](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41430449094/artifacts/13134792351), its verified ZIP SHA-256, and each retained file. Raw browser reports and representative screenshots are byte-for-byte copies. `hosted/m0-webgl-regression/summary.json` retains all failure signatures and source/order identities from the full baseline/candidate reports, whose original hashes are included. The large full reports remain in the Actions artifact. `hosted/job-conclusions.log` contains selected verbatim log lines; complete job logs remain in Actions.

All five M1 browser reports explicitly name source `03233dae8b524d6b3f4498a48a2fd7e89fffa806`. Hosted environment: Node 22.23.4, Chromium 156.0.8078.4, Ubuntu 24.04, Xvfb, Google SwiftShader software GPU. Terrain/demo viewport is 1280×720; navigation also checks 960×540.

The closeout commit changes only records/evidence. Under `docs/CI.md`, its final PR head must independently receive successful Fast and executed Full before the newly authorized main integration. The live [PR #2 checks](https://github.com/pp123pp/cesium-webgpu-globe/pull/2/checks) and merge record are the publication authority. Merge M0 dependency PR #1 before PR #2; stop at M1.

## Retained limitation and failures

Original navigation failures remain unchanged in `../final-navigation-issue/`; previous attempted terrain corrections and controls remain in `../terrain-fill/`. The original failed run stops before drape/cleanup and does not prove those checks passed. The new complete local report does execute them.

The navigation classifier does not waive ordinary coverage/LOD, imagery, settled-frame holes, below-ground endpoints, insufficient LOD, incomplete flight, browser/provider errors, drape controls, timeouts or resource leaks. The broad visual policy allows harmless differences only and does not supply a general exception for functional failures.

## Post-acceptance evidence archive (2026-11-02)

The original complete local and hosted capture is retained in [GitHub Actions artifact `historical-evidence-41437576266-1`](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41437576266) through 2027-01-31 and forever in Git history at `676061f40cd2a885b58963bea833f551c4feb90c`. To avoid committing duplicate imagery and large local raw outputs, the current tree was trimmed **after** archival. The existing `local/manifest.json` and `hosted/manifest.json` intentionally remain authentic inventories of the **original full captured set**, not of the smaller checkout. See [archive path map](../ARCHIVE_MAP.md). This changes no test conclusion and does not resolve `M1-NAV-001`.
