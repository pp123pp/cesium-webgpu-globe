# Online WebGPU demo — GitHub Pages

**GitHub Pages deployment is enabled and working from `gh-pages`** (branch `/(root)`): the original site was published by [Pages build and deployment run 41440455191](https://github.com/pp123pp/cesium-webgpu-globe/actions/runs/41440455191) with a `success` conclusion on 2026-11-02.

## Live demo entry points

- [Demo landing page](https://pp123pp.github.io/cesium-webgpu-globe/)
- [Interactive M1 WGS84 Globe](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUGlobe.html)
- [M0.4 WebGPU proof](https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUProof.html)

The [source index](../Apps/WebGPUIndex.html) lists Globe, volumetric clouds, terrain cloud shadows, the M5 reference scenes and the triangle proof. The publish job stages each demo and checks its root-index link. New local examples become public after integration and Pages publication.

The online site uses HTTPS and requires a WebGPU-capable browser. Real Cesium World Terrain and ArcGIS World Imagery require connectivity and any applicable service authorization.

## Publishing and updating

The source of truth is `main`; the `gh-pages` branch is generated output, not a development branch.

[`webgpu-pages.yml`](../.github/workflows/webgpu-pages.yml) runs when relevant `main` files change, and supports `workflow_dispatch`. It installs Node.js 22 workspaces, builds `Build/Cesium` with `npm run build-release`, includes the required `Workers` and `Assets`, rewrites copies of the HTML demos to refer to the minified bundle, and writes a static site to `gh-pages`.

**Important:** GitHub Pages is configured to publish from the **`gh-pages` branch**. A `GITHUB_TOKEN`-authored push does not by itself trigger GitHub's built-in Pages publisher. After updating the branch, the workflow explicitly requests a new Pages build via GitHub's `POST /repos/{owner}/{repo}/pages/builds` endpoint with `pages: write` permission. Monitor the resulting **pages build and deployment** workflow to confirm publication. The workflow also uploads a `github-pages` artifact for diagnostic use.

A separate `actions/deploy-pages` job from `main` was intentionally removed because this Pages site uses the **branch-source** publishing mode, not the **GitHub Actions-source** publishing mode. Do not switch modes without updating the workflow.

If Pages settings change, visit [Settings → Pages](https://github.com/pp123pp/cesium-webgpu-globe/settings/pages) and use **Deploy from a branch → gh-pages → /(root)**. The site does not need a custom domain.

## Limitations

- M1 contains WGS84 Globe, imagery, terrain and camera navigation, but not M2 atmosphere, sky/HDR or later features.
- Known `M1-NAV-001`: rapid real-terrain descent can stop above the target altitude. A passing Pages build does not resolve it.
- A successful static build proves that files were published, **not** that a physical GPU/browser has been tested on the deployed website.
