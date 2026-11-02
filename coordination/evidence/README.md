# Evidence storage and archive

Current Git tree stores concise M0/M1 acceptance, provenance, manifests, representative images, executable reproduction scripts and known issues. Full raw outputs and redundant historical images are retained in GitHub Actions Artifacts, plus recoverable immutable Git history.

**Complete pre-cleanup snapshot:** [Actions run 41437576266](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41437576266), artifact `historical-evidence-41437576266-1` (64,713,972 compressed bytes, 90-day retention, **expires 2027-01-31**). Its checkout is `b11444e0e8c64f3bb538aa86bba3da8ef671c93f`; the archive includes all original evidence and `evidence-archive-sha256.txt` with original file hashes. On 2026-11-02 this job completed successfully.

**Permanent fallback:** [pre-cleanup Git tree](https://github.com/pp123pp/cesium-webgpu-globe/tree/676061f40cd2a885b58963bea833f551c4feb90c/coordination/evidence), commit `676061f40cd2a885b58963bea833f551c4feb90c`. We did not rewrite Git history. Actions Artifacts are **not** permanent archival storage; re-run [the archive workflow](https://github.com/pp123pp/cesium-webgpu-globe/blob/chore/evidence-artifact-trim-20261102/.github/workflows/evidence-archive.yml) against that SHA if a renewed artifact is needed.

## Trimmed evidence inventory

- Before: 291 tracked files, 72,133,580 bytes.
- Removed: 69 files, 39,817,891 bytes (55.2%), comprising 33 byte-identical large image copies and 36 complete local logs/verbose diagnostics.
- After: 32,315,689 bytes of originally tracked evidence (excluding the new documentation).
- Preserved: M1 authoritative hosted summaries, baseline/checksum manifests, key test screenshots, `M1-NAV-001` unresolved evidence, all runtime code, tests and standard workflows.

The original local/hosted `manifest.json` files remain **unchanged original-capture inventories**: an entry can be archived but absent from the trimmed Git checkout. Map all removed paths with [M1/ARCHIVE_MAP.md](M1/ARCHIVE_MAP.md).

## Restore

While artifact is retained:

```bash
gh run download 41437576266 --repo pp123pp/cesium-webgpu-globe --name historical-evidence-41437576266-1 --dir evidence-archive
```

After expiration, restore the original tracked file from pre-cleanup Git history:

```bash
git show 676061f40cd2a885b58963bea833f551c4feb90c:coordination/evidence/M1/closeout/local/quality-1.log > quality-1.log
```

Future full-suite logs and large diagnostic reports should be uploaded with `actions/upload-artifact@v4`, not committed under `coordination/evidence`. Keep a concise index with source SHA, workflow run, artifact ID, SHA-256 and expiry; Git should retain critical problem reproductions and acceptance conclusions.
