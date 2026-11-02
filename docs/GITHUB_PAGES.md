# Online WebGPU demo — GitHub Pages

The `gh-pages` branch is **generated build output**. Do not manually edit it. The actual application sources are on `main`.

## Entry points

- Site index: https://pp123pp.github.io/cesium-webgpu-globe/
- M1 interactive WGS84 Globe: https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUGlobe.html
- M0.4 WGSL triangle/depth proof: https://pp123pp.github.io/cesium-webgpu-globe/Apps/WebGPUProof.html

These URLs are available **only after the repository's Pages site has been enabled and its first deployment succeeded**.

## Initial configuration (repository admin)

1. Go to [Settings → Pages](https://github.com/pp123pp/cesium-webgpu-globe/settings/pages).
2. Under **Build and deployment → Source**, choose **GitHub Actions** (not "Deploy from a branch"). Save the change.
3. On [Actions → Publish WebGPU demos to GitHub Pages](https://github.com/pp123pp/cesium-webgpu-globe/actions/workflows/webgpu-pages.yml), use **Run workflow** on `main` if the initial run failed because Pages had not yet been enabled.
4. Verify both demos load and `Build/Cesium/Cesium.js`, `Workers/` and `Assets/` requests succeed.

Setting Pages source to GitHub Actions is important: a push to `gh-pages` made with the workflow's `GITHUB_TOKEN` does **not** itself trigger a Pages branch-source build. This repository therefore uses `actions/upload-pages-artifact` and `actions/deploy-pages` to publish directly, while retaining `gh-pages` as an inspectable snapshot of the deployed site.

## Automatic publishing

`.github/workflows/webgpu-pages.yml` runs on relevant changes to `main` and can be manually dispatched. It installs Node 22 workspaces, runs `npm run build-release`, stages the minified `Build/Cesium` (including assets and workers) plus the two demo HTML pages, rewrites those copied pages to load the minified bundle, checks essential output files, updates `gh-pages`, uploads a Pages artifact and deploys that artifact.

It adds no runtime options to the Cesium WebGPU implementation. The default demonstration loads bundled Natural Earth imagery and ellipsoid terrain without an external service token. "Load real terrain" makes external requests to Cesium World Terrain and ArcGIS World Imagery and may require valid credentials. Browsers must expose WebGPU; localhost is not involved for the HTTPS Pages site.

The current M1 rapid-terrain descent issue `M1-NAV-001` remains unresolved. Do not interpret site deployment as acceptance of that navigation limitation.
