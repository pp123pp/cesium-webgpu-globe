/* global document, window, location, performance, requestAnimationFrame */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { assertPhysicalGpu, classifyGpu } from "./m0-browser-config.mjs";

export const scenes = [
  "orbit-day",
  "sunrise",
  "twilight",
  "night",
  "cloud-sea",
  "inside-cloud",
  "terrain-shadow",
  "rapid-motion",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const services = {
  elevation:
    "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
  imagery:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
};
export function sourceOf(url) {
  const resource = new URL(url);
  return Object.keys(services).find(
    (key) =>
      resource.origin + resource.pathname === services[key] ||
      (resource.origin + resource.pathname).startsWith(`${services[key]}/`),
  );
}

// Read the actual Viewer's live instance without replacing production code or options.
async function attachViewer(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const prototype = await session.send("Runtime.evaluate", {
      expression: "Cesium.Viewer.prototype",
      objectGroup: "m5-viewer",
    });
    const { objects } = await session.send("Runtime.queryObjects", {
      prototypeObjectId: prototype.result.objectId,
      objectGroup: "m5-viewer",
    });
    const result = await session.send("Runtime.callFunctionOn", {
      objectId: objects.objectId,
      functionDeclaration:
        "function () { const viewers = this.filter(viewer => !viewer.isDestroyed()); if (viewers.length !== 1) throw Error('Expected one reference viewer: ' + viewers.length); window.__referenceViewer = viewers[0]; }",
    });
    assert.equal(
      result.exceptionDetails,
      undefined,
      JSON.stringify(result.exceptionDetails),
    );
    await session.send("Runtime.releaseObjectGroup", {
      objectGroup: "m5-viewer",
    });
  } finally {
    await session.detach();
  }
}

export async function settleReferenceScene(page) {
  await page.evaluate(async () => {
    const viewer = window.__referenceViewer;
    const scene = viewer.scene;
    let previous;
    let stable = 0;
    const start = performance.now();
    while (performance.now() - start < 60000) {
      await new Promise(requestAnimationFrame);
      viewer.render();
      const stats = scene.debugStatistics;
      const draws = scene._renderer._draws.map(({ tile }) => [
        tile.level,
        tile.x,
        tile.y,
      ]);
      const key = JSON.stringify([draws, stats.imagery.texturesCreated]);
      const loaded =
        scene.globe.tilesLoaded &&
        (draws.length || location.hash === "#night") &&
        !stats.imagery.pendingRequests;
      stable = loaded && key === previous ? stable + 1 : 0;
      if (stable >= 6) {
        return;
      }
      previous = key;
    }
    throw new Error(
      `Reference terrain did not settle: ${JSON.stringify(scene.debugStatistics)}`,
    );
  });
}

export async function initializeReferenceViewer(page, configuration) {
  await attachViewer(page);
  const adapter = await page.evaluate(() => {
    const viewer = window.__referenceViewer;
    const { _adapter, _device } = viewer.scene.context;
    const { vendor, architecture, device, description, isFallbackAdapter } =
      _adapter.info;
    const adapterInfo = {
      vendor,
      architecture,
      device,
      description,
      isFallbackAdapter,
    };
    window.__m1 = { adapterInfo, errors: [] };
    _device.addEventListener("uncapturederror", (event) =>
      window.__m1.errors.push(String(event.error)),
    );
    viewer.renderError.addEventListener((...args) =>
      window.__m1.errors.push(String(args[1])),
    );
    return adapterInfo;
  });
  assertPhysicalGpu(classifyGpu(adapter), configuration);
}

export async function openReferenceDemo(
  { page, base, report },
  width = 320,
  height = 180,
) {
  const app = "Apps/WebGPUReferenceScenes.html";
  const url = new URL(app, base);
  await page.route("**/*", (route) => {
    const request = new URL(route.request().url());
    if (
      request.origin === url.origin ||
      ["data:", "blob:"].includes(request.protocol) ||
      sourceOf(request.href)
    ) {
      return route.continue();
    }
    return route.abort();
  });
  await page.setViewportSize({ width, height });
  const response = await page.goto(`${url.href}#orbit-day`);
  report.demoSha256 = sha256(await readFile(app));
  assert.equal(sha256(await response.body()), report.demoSha256);
  await page.waitForFunction(
    () => !document.getElementById("controls").disabled,
  );
  if (!(await page.locator("details").evaluate((element) => element.open))) {
    await page.locator("summary").click();
  }
  await initializeReferenceViewer(page, report.configuration);
  await page.evaluate(() => {
    const viewer = window.__referenceViewer;
    const copy = document.createElement("canvas");
    copy.width = viewer.canvas.width;
    copy.height = viewer.canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    window.__referenceCapture = () => {
      viewer.render();
      context.drawImage(viewer.canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height);
    };
  });
}

export async function selectReferenceScene(page, slug) {
  await page.locator("#scene").selectOption(slug);
  await page.waitForFunction(
    (slug) =>
      location.hash === `#${slug}` &&
      !document.getElementById("controls").disabled,
    slug,
  );
  if (slug === "terrain-shadow") {
    await page
      .locator("#source[data-terrain=live][data-imagery=live]")
      .waitFor({ state: "attached", timeout: 90000 });
  }
  await settleReferenceScene(page);
}
