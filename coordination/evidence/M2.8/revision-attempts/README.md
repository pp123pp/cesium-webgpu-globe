# Preserved visual and performance attempts

These are historical development evidence, not the final accepted output. Final evidence is [the revision index](../revision/README.md).

- `oversaturated-ring.png`: early excessive spectral saturation, corrected with broader low-intensity overlapping bands.
- `needle-rays.png`: overlong thin ray treatment, corrected by shorter optical support, angular filtering and an irregular bright core.
- `unbounded-rays-timing-fail.json`: mean +0.807 ms exceeded the original 0.5 ms budget. Restricting nine ray-mask samples to their effective footprint reduced work.
- `bounded-rays-short-warmup-fail.json`: mean +0.519 ms and unstable whole-frame tail. Increased warmup without changing budgets.
- `shared-receiver-60-samples-fail.json`: final resize p95 +2.425 ms; receiver sharing and zero-support reflection skipping were already present. Retain the failure.
- `shared-receiver-180-samples-fail.json`: clean final-runtime capture, final resize p95 +1.376 ms. Pass-level records showed a large unchanged-atmosphere tail imbalance. Mean remained below budget.
- `shared-receiver-600-preliminary.json`: larger-sample exploratory PASS, dirty only because validation scripts were being revised. It is not substituted for the final clean capture. The final 600-sample capture is separately committed and linked from the revision index.

All failed assertions remained active. Final performance reporting uses the clean 600-sample protocol with all raw data retained; neither negative tail differences nor preliminary passes are called a guaranteed speedup.
