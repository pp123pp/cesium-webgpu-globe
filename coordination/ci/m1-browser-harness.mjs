/* global Cesium, window, document, HTMLCanvasElement, requestAnimationFrame, performance, fetch */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  getBrowserConfiguration,
  classifyGpu,
  assertPhysicalGpu,
} from "./m0-browser-config.mjs";

export async function runM1BrowserSuite(name, run) {
  const output = path.resolve(process.env.M1_OUTPUT ?? `Build/m1-${name}`);
  const base = process.env.M1_BASE_URL ?? "http://127.0.0.1:8090/";
  const configuration = getBrowserConfiguration();
  if (process.env.M1_CA_SPKI) {
    assert.match(process.env.M1_CA_SPKI, /^[A-Za-z0-9+/]{43}=$/);
    configuration.launchOptions.args.push(
      `--ignore-certificate-errors-spki-list=${process.env.M1_CA_SPKI}`,
    );
  }
  await mkdir(output, { recursive: true });
  const resultPath = path.join(output, "result.json");
  const errorPath = path.join(output, "error.json");
  await rm(resultPath, { force: true });
  await rm(errorPath, { force: true });
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  const bundle = await readFile("Build/CesiumUnminified/Cesium.js");
  const served = await fetch(
    new URL("Build/CesiumUnminified/Cesium.js", base),
  ).then((r) => r.arrayBuffer());
  assert.equal(
    hash(bundle),
    hash(new Uint8Array(served)),
    "The browser must run this checkout's bundle",
  );
  const report = {
    suite: name,
    browserConsole: [],
    capturedAt: new Date().toISOString(),
    configuration,
    source: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceStatus: execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    bundleSha256: hash(bundle),
    browserErrors: [],
    checks: [],
    scenes: [],
  };
  let browser;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void browser?.close();
  }, 480000);
  try {
    browser = await chromium.launch(configuration.launchOptions);
    report.browser = browser.version();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (error) => report.browserErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        report.browserConsole.push({ type: message.type(), text: message.text() });
      }
    });
    await page.goto(new URL("Specs/e2e/cesium.html", base).href);
    await page.addScriptTag({
      url: new URL("Build/CesiumUnminified/Cesium.js", base).href,
    });
    await run({ page, report, output, base });
    const environment = await page.evaluate(() => {
      const info = window.__m1?.adapterInfo;
      return {
        cesium: Cesium.VERSION,
        adapter: info,
        viewport: [window.innerWidth, window.innerHeight],
      };
    });
    report.environment = environment;
    report.gpu = classifyGpu(environment.adapter ?? {});
    assertPhysicalGpu(report.gpu, configuration);
    assert.deepEqual(report.browserErrors, []);
    await browser.close();
    browser = undefined;
    assert.equal(timedOut, false, "Browser suite exceeded its deadline");
    report.status = report.knownIssues?.length
      ? "PASS_WITH_KNOWN_ISSUES"
      : "PASS";
    await writeFile(resultPath, JSON.stringify(report, null, 2));
    assert.equal(timedOut, false);
    console.log(`M1 ${name} ${report.status}: ${report.checks.join(", ")}`);
  } catch (error) {
    await rm(resultPath, { force: true });
    await writeFile(
      errorPath,
      JSON.stringify(
        { ...report, status: "FAIL", error: String(error), timedOut },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    clearTimeout(deadline);
    await browser?.close();
  }
}

export async function installM1Scene(page, options = {}) {
  await page.evaluate(async (options) => {
    const contexts = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      contexts.push(kind);
      return original.call(this, kind, ...args);
    };
    const viewer = new Cesium.Viewer("cesiumContainer", {
      renderingBackend: "webgpu",
      useDefaultRenderLoop: false,
      // These suites isolate M1 terrain/imagery behavior and retain their
      // original color assertions. The dedicated M2 suite enables the actual
      // atmosphere; the public demo also exercises it with its default on.
      skyAtmosphere: false,
      skyBox: false, // Also hide Sun; dedicated M2 gates enable their consumer.
      ...options,
    });
    const errors = [];
    viewer.renderError.addEventListener((...event) =>
      errors.push(String(event[1])),
    );
    try {
      await viewer.readyPromise;
    } catch (error) {
      const detail = viewer._webgpuProof?._context?._error?.message;
      throw new Error(`${error.message}; WebGPU context: ${detail ?? "unavailable"}`, { cause: error });
    }
    viewer.scene.globe.maximumScreenSpaceError = 3;
    const info = viewer._webgpuProof._context._adapter.info;
    const state = (window.__m1 = {
      viewer,
      errors,
      contexts,
      imageryRequests: [],
      terrainRequests: [],
      providerErrors: [],
      adapterInfo: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter,
      },
    });
    state.watchImagery = (provider, label) => {
      const request = provider.requestImage;
      provider.requestImage = function (x, y, level, requestOptions) {
        const result = request.call(this, x, y, level, requestOptions);
        if (result !== undefined) {
          state.imageryRequests.push({ label, x, y, level });
        }
        return result;
      };
      provider.errorEvent?.addEventListener((error) =>
        state.providerErrors.push({
          label,
          x: error.x,
          y: error.y,
          level: error.level,
          message: error.message,
        }),
      );
    };
    state.pixels = () => {
      // Read the frame while its current WebGPU canvas texture is still owned
      // by this task; a later task may observe the next, cleared swap texture.
      viewer.render();
      const copy = document.createElement("canvas");
      copy.width = viewer.canvas.width;
      copy.height = viewer.canvas.height;
      const context = copy.getContext("2d", { willReadFrequently: true });
      context.drawImage(viewer.canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height);
    };
    state.settle = async (view = {}) => {
      if (view.longitude !== undefined) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            view.longitude,
            view.latitude,
            view.height,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(view.heading ?? 0),
            pitch: Cesium.Math.toRadians(view.pitch ?? -90),
            roll: 0,
          },
        });
      }
      const start = performance.now();
      let stable = 0;
      let key;
      let frames = 0;
      while (performance.now() - start < (view.timeout ?? 90000)) {
        viewer.render();
        ++frames;
        if (errors.length) {
          throw new Error(errors.join("\n"));
        }
        const stats = viewer.scene.debugStatistics;
        const next = viewer.scene._renderer._draws
          .map(
            ({ tile, rectangle }) =>
              `${tile.level}/${tile.x}/${tile.y}:${rectangle.west}:${rectangle.south}`,
          )
          .sort()
          .join("|");
        const loaded =
          viewer.scene.globe.tilesLoaded &&
          stats.resources.drawCalls > 0 &&
          stats.imagery.pendingRequests === 0 &&
          (!view.imagery || stats.resources.imageryDrawCalls > 0);
        stable = loaded && next === key ? stable + 1 : 0;
        key = next;
        if (stable >= 3) {
          await viewer._webgpuProof._context._device.queue.onSubmittedWorkDone();
          await new Promise(requestAnimationFrame);
          viewer.render();
          return {
            frames,
            elapsedMs: performance.now() - start,
            statistics: viewer.scene.debugStatistics,
          };
        }
        await new Promise(requestAnimationFrame);
      }
      throw new Error(
        `Scene did not settle: ${JSON.stringify(viewer.scene.debugStatistics)}`,
      );
    };
  }, options);
}

export async function captureM1Scene(page, report, output, name, details = {}) {
  const observation = await page.evaluate(() => {
    const state = window.__m1;
    const { data, width, height } = state.pixels();
    const center = ((height >> 1) * width + (width >> 1)) * 4;
    const colors = new Set();
    let backgroundPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) {
        ++backgroundPixels;
      }
      if (i % 400 === 0) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
    }
    return {
      statistics: state.viewer.scene.debugStatistics,
      center: Array.from(data.slice(center, center + 4)),
      distinctSampledColors: colors.size,
      backgroundPixels,
      contexts: [...new Set(state.contexts)],
      errors: [...state.errors],
    };
  });
  assert.deepEqual(observation.errors, []);
  assert.ok(!observation.contexts.some((kind) => /webgl/i.test(kind)));
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: path.join(output, `${name}.png`) });
  const result = { name, ...details, ...observation };
  report.scenes.push(result);
  console.log(
    `M1 ${name}: ${observation.statistics.selectedTiles} terrain tiles, ${observation.statistics.resources.imageryDrawCalls} imagery draws`,
  );
  return result;
}

export async function destroyM1Scene(page) {
  const result = await page.evaluate(() => {
    const { viewer } = window.__m1;
    const renderer = viewer.scene._renderer;
    const imagery = viewer.scene._imagery;
    viewer.destroy();
    return {
      resources: { ...renderer.statistics },
      imagery: { ...imagery.statistics },
      canvases: document.querySelectorAll("canvas").length,
      destroyed: viewer.isDestroyed(),
    };
  });
  assert.equal(result.resources.bufferBytes, 0);
  assert.equal(result.resources.textureBytes, 0);
  assert.equal(
    result.resources.buffersCreated,
    result.resources.buffersDestroyed,
  );
  assert.equal(
    result.resources.texturesCreated,
    result.resources.texturesDestroyed,
  );
  assert.equal(result.imagery.activeTextures, 0);
  assert.equal(result.imagery.pendingRequests, 0);
  assert.equal(result.canvases, 0);
  assert.equal(result.destroyed, true);
  return result;
}
