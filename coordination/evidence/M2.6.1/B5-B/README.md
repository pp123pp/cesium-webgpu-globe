# B5-B temporal acceptance — 2026-11-04

Technical acceptance **PASS** on Intel Xe-LPG (non-fallback), headed Chrome
156.0.8078.80. **User visual acceptance PASS, confirmed 2026-11-04.** B5-C was
subsequently accepted separately. Commit, push and main merge of this evidence
are now authorized; final milestone closure is not claimed here.
See [user acceptance](user-acceptance.json). Raw capture-time `AWAITING_REVIEW`
fields are historical and remain unchanged; this confirmation supersedes them.

Open [the playback index](index.html). The 288 PNG files are unmodified canvas
captures. [result.json](result.json) retains state, hashes and checks;
[summary.json](summary.json) summarizes sequence metrics. The original complete
report, including all tracked samples and geometry points, is preserved losslessly
as [raw-result.json.gz](raw-result.json.gz). Playback rate is an inspection aid,
not measured FPS or GPU time.

| Check | Result |
| --- | --- |
| Fixed repeats | Six groups of eight frames; maximum RGB byte difference 0 |
| Camera/time motion | 120 frames at 1920×1080, renderer frames 15–134, +1 second and 0.015° yaw per frame |
| Solar-aligned motion ROI | 1536 valid samples per frame; maximum adjacent mean 0.00050502047 and p99 0.00216813007, below existing B1 bounds 0.03 / 0.2 |
| Resize / off-axis | 1920×1080 → 1280×720 → 1920×1080; off-axis solar state retained, eight stable captures per resized state |
| Earth-limb progression | 120 consecutive frames at 1280×720; 34 visible, 52 partial, 34 fully hidden |
| Partial Earth control | 23,910 hidden receiver samples; maximum Sun on/off difference 0 |
| Fully hidden Earth | Sun on/off full-frame difference 0 |
| Real mountain control | 81/81 disk rays blocked by mesh, 0 by analytic Earth; positive depth and zero solar radiance; full-frame Sun on/off difference 0 |
| Mountain removal | Removing the mesh restores solar radiance; eight stable captures |
| Integrity | Independent audit verified all 288 PNG hashes, sequence continuity and source/harness hashes |
| Errors | Browser, console, GPU and provider errors all empty |

The bounded native ellipsoid and Gaussian mountain fixtures cap refinement at
level 8 and use no external providers. This is solar temporal/occlusion evidence,
not real-terrain streaming or LOD acceptance. Motion sequences are capture-paced;
they do not establish real-time frame rate. Fixed exposure is 1 and Bloom is 0.35.
Explicit setup/resize/provider transitions occur between separately named
sequences, not inside their claimed contiguous frame ranges.

## Provenance and reproduction

- Source: `8e7c53c09f3b0e2ae6b38ab4593d818282b979a4`; only STATUS differs from
  accepted main merge `0cf85063a4c63251b71be95375da03ba6354f869`.
- Bundle SHA-256: `410f39366223a6a611e2072945c39d682507b2b152e2105a964325887cab9980`.
  Existing accepted B5-A bundle reused after verifying runtime source equality;
  no fresh build is claimed.
- Production atmosphere shader SHA-256:
  `2258c916682dea891f86d5370774259189a0c66ebb899354b33654429073c81f`.
  Browser shader text equals the imported current source.
- The new capture script was untracked during execution. Its exact hash and six
  harness dependency/six runtime file hashes are recorded in the report.
- Full original local run: `Build/m2.6.1-b5-b-run2/`.

With this checkout served on port 8090:

```powershell
$env:M0_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:M1_OUTPUT = 'Build/m2.6.1-b5-b-new-attempt'
node coordination/ci/m2.6.1-b5-b-temporal.mjs
```

Choose a new output directory for each attempt. Hardware is mandatory. No
SwiftShader, Full regression, GPU timing or resource-lifecycle acceptance ran.
Fresh syntax and targeted ESLint checks passed after the final harness change.

## Failure retained and visual observations

[Run 1](run1-error.json) stopped before capture: the terrain settling helper
required a nonzero terrain draw count in a sky-only camera. The new harness now
uses GPU completion for that sky-only setup, matching the existing B4 approach;
terrain views still require settled native meshes. Run 2 passed without an
engine change or weakened image/occlusion assertions.

Agent image inspection covered the motion endpoints, the largest aligned-mean
motion transition (90→91), limb states 0/60/61/100, resized output and hidden/
removed mountain controls. These samples show a stable solar structure and
progressive Earth occultation without a visible flash. The complete sequences
are available for user playback review; sampled inspection is not represented
as user visual approval. Existing accepted B5-A limb/haze limitations remain.
