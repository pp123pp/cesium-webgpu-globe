# M1 evidence archival cleanup

Date: 2026-11-02. Documentation/evidence-only cleanup based on main `676061f40cd2a885b58963bea833f551c4feb90c`. M2 was not started.

- Full original evidence uploaded and verified by [GitHub Actions run 41437576266](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41437576266), artifact `historical-evidence-41437576266-1`, 64,713,972 compressed bytes and file SHA-256 manifest; expires 2027-01-31.
- Original `coordination/evidence`: 291 files / 72,133,580 bytes. Deleted 69 tracked entries: 33 large identical images and 36 archived full logs/diagnostics; 39,817,891 bytes saved (55.2%). Remaining historical evidence bytes: 32,315,689.
- Path mapping: [evidence archive map](../evidence/M1/ARCHIVE_MAP.md); authoritative manifests preserve original byte lengths and checksums.
- Source/test/standard CI behavior unchanged. Core A03–A06 hosted reports and `M1-NAV-001` key evidence remain tracked. Do not mistake archived raw files for unexecuted tests.
- Verification: successful upload, preserved Git blobs for duplicates, exact deletion inventory, branch-tree validation. No fresh GPU or renderer testing claimed.
- GitHub artifacts expire; restore from source commit `676061f40cd2a885b58963bea833f551c4feb90c` or re-run archival workflow against that SHA. Deleting files from HEAD **does not shrink old Git history**.

Next: review PR, honor its checks, merge without rewriting Git history.
