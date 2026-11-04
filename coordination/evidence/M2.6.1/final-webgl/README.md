# M2.6.1 — final complete WebGL differential (2026-11-05)

**Final result: PASS — no new failures**, confirmed by the original `coordination/ci/m0-webgl-regression.mjs` comparator (exit code 0, status `no-new-failures`). This is the standalone complete WebGL gate; hosted Fast/Full are non-rendering and are not substituted for this run.

## Exact tested identities

| Item | Baseline | Candidate |
| --- | --- | --- |
| Commit | `724b5db8f258d0ce00c4f6b774bd38529e24252b` | merged `main` `b5422e5c9885cfba06efb26ada7d7b5cf6ced22c` (PR #29) |
| Bundle SHA-256 | `e3e4a92f94f7b24e914831a50cf3fe747f72ca8630bc5d3057af42874c397845` | `c63b041cca2094b5f07174acf19f8c964b2066709e55191be77754678e59e085` |
| Karma server | `127.0.0.1:9876` | `127.0.0.1:9876` |
| Passed | 3,819 | 3,819 |
| Failed (retained) | 3 | 3 |
| Skipped | 12,068 | 12,068 |
| Executed | 3,822 | 3,822 |
| Raw Karma exit | 1 | 1 |

Both runs used the same 720-spec-file canonical import list, order, configuration, test browser, physical GPU and source-clean checkouts. The raw Karma exits are **1** because baseline failures are retained; the independent comparator exit is **0**. The comparator validates complete execution, source/bundle integrity, matching tests/order and exact inherited failure signatures. No exclusions, assertion edits, timing extensions, test deletion or software renderers were used.

Browser: Google Chrome 156.0.8078.80, Headless 156 user agent, Windows. Physical hardware: Intel Arc 130T GPU (16 GB), ANGLE Direct3D 11. A separate real-WebGL2 `WEBGL_debug_renderer_info` probe positively identified that adapter under the identical launch flags. The actual Karma Chrome command line was independently observed with `--use-gl=angle --use-angle=d3d11 --enable-webgl --disable-software-rasterizer` and without `--disable-gpu` or SwiftShader. This is **single-device** WebGL regression evidence, not a multi-vendor result.

## Preserved inherited failures

The final comparator found **3 unchanged failures, 0 new failures, 0 changed signatures and 0 tolerated pixel-drift exceptions**:

1. `Renderer/AutomaticUniforms — has czm_pass and czm_passOverlay`: the baseline and candidate both rendered `0,0,0,255` where the assertion expected `255,255,255,255`.
2. `Scene/Cesium3DTileset — Restrict tileset memory usage with maximumCacheOverflowBytes`: same 10-second asynchronous timeout on both.
3. `Scene/Cesium3DTileset — Unloads cached tiles outside of the view frustum using cacheBytes`: same 10-second polling timeout on both.

Passing the **no-new-regression** criterion is not claiming that these baseline failures are fixed.

## Diagnostics retained rather than concealed

- `port-blocked-*`: first complete run used Karma's default `0.0.0.0` bind; Windows could not bind ports 9876–9879 there, so Karma selected 9880. The original comparator correctly failed its fixed-port guard. A separate binding probe confirmed 9876 is available on `127.0.0.1`. The local-only launcher therefore binds Karma to loopback on 9876 without modifying the original suite.
- `timing-unstable-*`: second complete hardware run bound 9876, but two Cesium3DTileset 10-second timeouts occurred only on the candidate while the baseline passed them. Original comparator correctly reported FAIL. Both affected original specs then passed **2/2 on each revision** in isolated hardware reruns, with the original timeout unchanged.
- `accepted-*`: third complete hardware run bound the required 9876. All 3,822 executed spec identities and order matched; all candidate failures had identical baseline signatures. Original comparator returned PASS.

The first two attempts are diagnostic failures, **not** retroactively described as passes. Their full raw baseline/candidate reports, logs and original failed comparison files remain in this archive. Their alternating timeouts indicate workload-sensitive behavior, not proof that future executions can never be flaky.

## Evidence files and reproduction

[Accepted comparison](accepted-comparison.json) · [SHA-256 manifest](manifest.json) · `accepted-baseline.json.gz` · `accepted-candidate.json.gz` · `accepted-run.log.gz`. The archive also contains both earlier complete-run reports and two scoped rerun reports; all `.gz` files losslessly preserve original bytes and have raw/stored hashes in the manifest.

`hardware-launch.cjs.txt` is the byte-exact local-only Karma Chrome adapter source (copy to an ignored `.cjs` path to run). It removes the launcher default `--disable-gpu`, requests hardware D3D11 and binds the test webserver to loopback; it does not change test code or the differential comparator. `hardware-probe.cjs.txt` preserves the independent physical-WebGL verification script (copy to `.cjs` to run). For the targeted diagnostic, copy `targeted-runner.mjs.txt` back to the repository's ignored `Build/m2-6-1-webgl-targeted.mjs` path so its relative import resolves.

Reproduce from the clean, built candidate checkout with a separate clean built baseline checkout at `724b5db` and equal canonical `Specs/SpecList.js` imports:

```powershell
$env:CHROME_BIN = "C:/Program Files/Google/Chrome/Application/chrome.exe"
Copy-Item coordination/evidence/M2.6.1/final-webgl/hardware-launch.cjs.txt Build/m2-6-1-webgl-hardware-launch.cjs
$env:NODE_OPTIONS = "--require=$((Resolve-Path Build/m2-6-1-webgl-hardware-launch.cjs).Path)"
node coordination/ci/m0-webgl-regression.mjs --baseline "D:/github/cesium-webgpu-globe/Build/m26-webgl-baseline" --output Build/new-final-webgl-differential
```

The baseline path is host-specific; supply another absolute, prepared baseline path as needed. Do not confuse the accepted fixed-port run with the failed diagnostics. No engine, WebGL/WebGPU shader, acceptance assertion, production bundle source or upstream test was modified by this verification.

## Integration boundary

M2.6.1 B1–B5 visual/temporal/occlusion/performance evidence was accepted previously. This separate differential closes the outstanding **technical WebGL no-new-regression gate on the merged implementation runtime**. Stage acceptance can be recorded with the prior user-confirmed SVP-01–SVP-10 results, but evidence publication and any PR merge remain separate actions. Existing A02 thin limb, A05 haze, B5-C GPU cost trend and M1-NAV-001 remain disclosed. Do not enter M2.7/M2.8/M3 here.
