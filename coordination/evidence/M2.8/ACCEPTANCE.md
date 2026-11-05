# M2.8 A/B user visual acceptance and delivery

Date: 2026-11-05 (Asia/Shanghai).

The user explicitly confirmed **“现在视觉验收通过”** for the compact cinematic Sun, adjustable diffusion size and proportionally linked outer spectral halo. Accepted implementation commit: `27e8cefbd7cfb8e6886cfae024fa18d5903f6223` on `feat/m2-8-lens-flare`.

The user then authorized recording acceptance, pushing the latest changes, updating [PR #31](https://github.com/pp123pp/cesium-webgpu-globe/pull/31), waiting for its latest CI and merging into `main`. The follow-up explicitly includes the existing `package.json` change adding `npm run demo:webgpu` (`npm run build && node server.js --port 8090 --production`). No dependency or runtime-rendering change is included in this delivery supplement.

**Boundary:** M2.8 A/B only. Do not start C, M2.7 or M3. Do not manually dispatch/rerun Full or add a Full-trigger label. The existing automatic PR checks remain required; the PR records the exact delivered head, actual jobs and eventual merge SHA.

## Evidence and provenance

- [Final parameter and linked-halo evidence](diffusion-size/README.md): 47 final native PNGs and two retained failed-attempt PNGs; physical Intel Xe-LPG; actual Demo input; exact default equivalence, size response, source/receiver occultation and the minimum-size ray-support fix.
- [Intermediate compact evidence](compaction/README.md): original matched before/after captures, two 120-frame sequences, exact disabled comparisons and physical WebGL smoke. Final default equivalence supports the documented reuse; these are not new final-runtime matrices.
- The final runtime has 16 passing focused tests, scoped lint/format, engine TypeScript and a production build. A separate closeout reviewer verified all ten recorded runtime hashes, the Demo and bundle hashes, all 49 final-archive PNG hashes and all 26 exact default matches without rerunning rendering or a broad suite.
- The capture-time reports, manifests, README files, earlier rejected treatments and failures are preserved unchanged. Their earlier pending-acceptance wording records their original review state; this acceptance record supersedes that state without changing capture provenance.

The accepted runtime and Demo bytes remain the inputs identified by the final hardware evidence. This closeout adds acceptance documentation and the user-requested npm command only. Single integrated GPU, bounded terrain/offline fixtures and historical timing limits remain disclosed; visual acceptance does not create new multi-device, timing or resident-VRAM evidence.
