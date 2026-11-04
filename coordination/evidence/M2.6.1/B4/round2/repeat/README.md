# Supplementary round-two recapture metadata

These original reports were initially published at 016dd3b and are preserved without rewriting their versions or hashes. The main round-two report uses the earlier complete ac7884d capture as canonical because its exact clean build checkouts and successful build logs are retained.

- Baseline: baseline-result.json, runtime reference 5f18afc, checkout/harness f58881f.
- Candidate: candidate-result.json, runtime reference ff06e96, checkout/harness 10e3d08; bundle SHA-256 349a9cc9e5c12d60c4bd81e3d5f4c3e02532aeb355e53f303f799f41e7a07793.
- audit.json is the original supplementary-run audit.
- All 42 PNG hashes per side equal the canonical ../before and ../after files. Images are shared without duplication; this metadata folder is not a self-contained rerunnable capture package.
- verification.json records that cross-run image comparison. Canonical build claims apply to ../build-manifest.json, not to the supplementary candidate bundle.

No new GPU test or visual acceptance is implied by preserving this metadata.
