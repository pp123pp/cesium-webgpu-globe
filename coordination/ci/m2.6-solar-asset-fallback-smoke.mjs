/* global window */
import assert from "node:assert/strict";
import process from "node:process";
import { runM1BrowserSuite, installM1Scene } from "./m1-browser-harness.mjs";

const corrupt = process.env.M26_CORRUPT_ASSET === "1";
await runM1BrowserSuite(`m2.6-solar-asset-${corrupt ? "corrupt" : "fallback"}`, async ({ page, report }) => {
  await page.route("**/Assets/Textures/WebGPU/Solar/GPU/glow-gradient.rgba8", async (route) => {
    await route.fulfill({ status: corrupt ? 200 : 404, body: "intentional M2.6 fallback test" });
  });
  await installM1Scene(page, { baseLayer: false });
  const result = await page.evaluate(async () => {
    const viewer = window.__m1.viewer;
    const renderer = viewer.scene._atmosphere;
    viewer.render();
    await viewer.scene.context._device.queue.onSubmittedWorkDone();
    return {
      solarAssetsLoaded: renderer.statistics.solarAssetsLoaded,
      solarAssetError: renderer._solarAssetError,
      textureCount: renderer._solarTextures.length,
      texturesCreated: renderer.statistics.texturesCreated,
      texturesDestroyed: renderer.statistics.texturesDestroyed,
    };
  });
  assert.equal(result.solarAssetsLoaded, false);
  assert.match(result.solarAssetError, corrupt ? /glow-gradient.*bytes; expected/ : /glow-gradient.*HTTP 404/);
  assert.equal(result.textureCount, 8);
  assert.equal(result.texturesDestroyed, 7);
  report.fallback = result;
  const lifecycle = await page.evaluate(() => {
    const viewer = window.__m1.viewer;
    const renderer = viewer.scene._atmosphere;
    viewer.destroy();
    return {
      destroyed: viewer.isDestroyed(),
      texturesCreated: renderer.statistics.texturesCreated,
      texturesDestroyed: renderer.statistics.texturesDestroyed,
      buffersCreated: renderer.statistics.buffersCreated,
      buffersDestroyed: renderer.statistics.buffersDestroyed,
    };
  });
  assert.equal(lifecycle.destroyed, true);
  assert.equal(lifecycle.texturesCreated, lifecycle.texturesDestroyed);
  assert.equal(lifecycle.buffersCreated, lifecycle.buffersDestroyed);
  report.lifecycle = lifecycle;
  report.checks.push("single failed solar payload falls back to neutral textures and releases every partial/fallback allocation");
});
