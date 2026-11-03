/* global Cesium, window, document, navigator, HTMLCanvasElement, GPUDevice,
          requestAnimationFrame, PageTransitionEvent, getComputedStyle, fetch,
          localStorage, sessionStorage */
import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import { classifyGpu } from "./m0-browser-config.mjs";

// The default gate includes real remote providers. The explicitly named local
// subset is useful for diagnosis; it never certifies live terrain or imagery.
const localOnly = process.env.M1_DEMO_LOCAL_ONLY === "1";
const providerMetadataMatch =
  /^https:\/\/api\.cesium\.com\/v1\/assets\/(1|3830182)\/endpoint(?:\?|$)/;

function observeDemo({ unavailable = false, holdAdapter = false } = {}) {
  const state = (window.__demo = {
    contexts: [],
    errors: [],
    allocations: [],
    frames: 0,
  });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    state.contexts.push(kind);
    return getContext.call(this, kind, ...args);
  };
  // Observe native allocations without replacing any GPU operation.
  if (typeof GPUDevice !== "undefined") {
    for (const kind of ["Buffer", "Texture"]) {
      const create = GPUDevice.prototype[`create${kind}`];
      GPUDevice.prototype[`create${kind}`] = function (...args) {
        const resource = create.apply(this, args);
        const row = { kind, destroyed: false };
        state.allocations.push(row);
        const destroy = resource.destroy;
        resource.destroy = function (...args) {
          row.destroyed = true;
          return destroy.apply(this, args);
        };
        return resource;
      };
    }
  }
  if (unavailable) {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: undefined,
    });
  } else if (holdAdapter) {
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await request(...args);
      await new Promise((resolve) => {
        state.releaseAdapter = resolve;
      });
      return adapter;
    };
  }
  // Capture the module-local Viewer through a prototype-preserving constructor
  // observer. The actual HTML and Cesium bundle are served byte-for-byte; no
  // test-only export, provider fixture or successful response is injected.
  let namespace;
  Object.defineProperty(window, "Cesium", {
    configurable: true,
    get: () => namespace,
    set(value) {
      const Viewer = new Proxy(value.Viewer, {
        construct(target, args, newTarget) {
          const viewer = Reflect.construct(target, args, newTarget);
          state.viewer = viewer;
          state.renderer = viewer.scene._renderer;
          state.imagery = viewer.scene._imagery;
          viewer.scene.postRender.addEventListener(() => ++state.frames);
          viewer.renderError.addEventListener((...event) =>
            state.errors.push(String(event[1])),
          );
          viewer.readyPromise.then(
            () => {
              state.ready = true;
              const info = viewer._webgpuProof._context._adapter.info;
              state.adapterInfo = {
                vendor: info.vendor,
                architecture: info.architecture,
                device: info.device,
                description: info.description,
                isFallbackAdapter: info.isFallbackAdapter,
              };
            },
            (error) => {
              state.readyError = String(error);
            },
          );
          return viewer;
        },
      });
      namespace = new Proxy(value, {
        get: (target, name, receiver) =>
          name === "Viewer" ? Viewer : Reflect.get(target, name, receiver),
      });
    },
  });
}

async function settle(page, { timeout = 90000, minimumFrames = 0 } = {}) {
  await page.waitForFunction(
    (minimumFrames) => {
      const state = window.__demo;
      if (!state?.ready || state.viewer.isDestroyed()) {
        return false;
      }
      if (state.errors.length) {
        throw new Error(state.errors.join("\n"));
      }
      const viewer = state.viewer;
      const statistics = viewer.scene.debugStatistics;
      const signature = viewer.scene._renderer._draws
        .map(({ tile }) => `${tile.level}/${tile.x}/${tile.y}`)
        .sort()
        .join("|");
      const loaded =
        viewer.scene.globe.tilesLoaded &&
        statistics.resources.drawCalls > 0 &&
        statistics.resources.imageryDrawCalls > 0 &&
        statistics.imagery.pendingRequests === 0;
      state.stable =
        loaded && state.signature === signature ? state.stable + 1 : 0;
      state.signature = signature;
      return state.stable >= 3 && state.frames >= minimumFrames;
    },
    minimumFrames,
    { timeout, polling: "raf" },
  );
}

async function terrainRenderState(page) {
  return page.evaluate(() => {
    const { viewer, frames, adapterInfo } = window.__demo;
    const scene = viewer.scene;
    return {
      frames,
      adapterInfo,
      css: [viewer.canvas.clientWidth, viewer.canvas.clientHeight],
      canvas: [viewer.canvas.width, viewer.canvas.height],
      scale: viewer.resolutionScale,
      pixelRatio: scene.pixelRatio,
      sseHeight: scene.drawingBufferHeight / scene.pixelRatio,
      atmosphereShown: scene.atmosphere.show,
      lutBuilds: scene.debugStatistics.atmosphere.lutBuilds,
      tiles: [
        ...new Set(
          scene._renderer._draws.map(
            ({ tile }) => `${tile.level}/${tile.x}/${tile.y}`,
          ),
        ),
      ].sort(),
    };
  });
}

async function snapshot(page, output, name) {
  const observation = await page.evaluate(() => {
    const { viewer, contexts, errors, frames } = window.__demo;
    viewer.render();
    const canvas = document.createElement("canvas");
    canvas.width = viewer.canvas.width;
    canvas.height = viewer.canvas.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(viewer.canvas, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set();
    let coloredPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 30) {
        ++coloredPixels;
      }
      if (index % 400 === 0) {
        colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      }
    }
    const coordinate = viewer.camera.positionCartographic;
    return {
      status: document.getElementById("status").textContent,
      statusColor: getComputedStyle(document.getElementById("status")).color,
      viewerIdentity: viewer instanceof Cesium.Viewer,
      backend: viewer.renderingBackend,
      camera: {
        longitude: Cesium.Math.toDegrees(coordinate.longitude),
        latitude: Cesium.Math.toDegrees(coordinate.latitude),
        height: coordinate.height,
        pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
      },
      canvas: [viewer.canvas.width, viewer.canvas.height],
      statistics: viewer.scene.debugStatistics,
      contexts: [...new Set(contexts)],
      errors: [...errors],
      frames,
      coloredPixels,
      sampledColors: colors.size,
      credits: viewer.creditDisplay.container.textContent,
      creditImages: [...viewer.creditDisplay.container.querySelectorAll("img")]
        .filter((image) => image.getClientRects().length > 0)
        .map((image) => ({
          alt: image.alt,
          loaded: image.complete && image.naturalWidth > 0,
        })),
    };
  });
  const attribution = page.getByRole("button", {
    name: "Data attribution",
    exact: true,
  });
  if (await attribution.isVisible()) {
    await attribution.click();
    observation.credits += ` ${await page.getByRole("dialog", { name: "Data attribution" }).innerText()}`;
    observation.creditImages.push(
      ...(await page
        .getByRole("dialog", { name: "Data attribution" })
        .locator("img")
        .evaluateAll((images) =>
          images
            .filter((image) => image.getClientRects().length > 0)
            .map((image) => ({
              alt: image.alt,
              loaded: image.complete && image.naturalWidth > 0,
            })),
        )),
    );
    await page.getByRole("button", { name: "Close data attribution" }).click();
  }
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  assert.deepEqual(observation.errors, []);
  assert.ok(!observation.contexts.some((kind) => /webgl/i.test(kind)));
  assert.ok(
    observation.coloredPixels > 10000,
    "The demo must display a visible globe",
  );
  assert.ok(
    observation.sampledColors > 40,
    "The demo must display real tiled imagery",
  );
  return { name, ...observation };
}

async function lifecycle(page) {
  return page.evaluate(async () => {
    const state = window.__demo;
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const frames = state.frames;
    for (let index = 0; index < 3; ++index) {
      await new Promise(requestAnimationFrame);
    }
    return {
      destroyed: state.viewer.isDestroyed(),
      framesBefore: frames,
      framesAfter: state.frames,
      canvases: document.querySelectorAll("canvas").length,
      allocations: ["Buffer", "Texture"].map((kind) => ({
        kind,
        created: state.allocations.filter((row) => row.kind === kind).length,
        destroyed: state.allocations.filter(
          (row) => row.kind === kind && row.destroyed,
        ).length,
      })),
      resources: { ...state.renderer.statistics },
      imagery: { ...state.imagery.statistics },
    };
  });
}

function assertReleased(result) {
  assert.equal(result.destroyed, true, "pagehide must destroy the Viewer");
  assert.equal(result.canvases, 0);
  assert.equal(result.framesAfter, result.framesBefore);
  for (const row of result.allocations) {
    assert.equal(row.destroyed, row.created, `Leaked native GPU ${row.kind}`);
  }
  assert.equal(result.resources.bufferBytes, 0);
  assert.equal(result.resources.textureBytes, 0);
  assert.equal(result.imagery.pendingRequests, 0);
}

// Register before navigation: automatic provider loading must not race the
// fallback/lifecycle checks. Only the network boundary is delayed or failed;
// successful provider metadata and tiles always come from the real services.
async function holdProviderMetadata(page) {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const requests = [];
  const handled = [];
  const handler = (route) => {
    const url = new URL(route.request().url());
    const asset = Number(url.pathname.match(/\/assets\/(\d+)\//)[1]);
    const request = { asset, url: `${url.origin}${url.pathname}` };
    requests.push(request);
    const handling = (async () => {
      const failedAssets = await hold;
      request.aborted = failedAssets.includes(asset);
      if (request.aborted) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    })();
    handled.push(handling);
    return handling;
  };
  await page.route(providerMetadataMatch, handler);
  const ready = Promise.all(
    [1, 3830182].map((asset) =>
      page.waitForRequest(
        (request) => {
          const url = new URL(request.url());
          return (
            url.hostname === "api.cesium.com" &&
            url.pathname === `/v1/assets/${asset}/endpoint`
          );
        },
        { timeout: 30000 },
      ),
    ),
  );
  return {
    requests,
    ready,
    async release(failedAssets = [1, 3830182]) {
      release(failedAssets);
      // Finish each intercepted request before disabling interception; otherwise
      // Chromium may resume it while its abort/continue operation is in flight.
      await Promise.all(handled);
      await page.unroute(providerMetadataMatch, handler);
      await page.waitForLoadState("networkidle");
    },
  };
}

await runM1BrowserSuite(
  localOnly ? "demo-local" : "demo",
  async ({ page, report, output, base }) => {
    report.liveProvidersRequired = !localOnly;
    const redact = (message) =>
      message
        .replace(
          /([?&](?:access_token|token|key|session)=)[^&\s)]+/gi,
          "$1[redacted]",
        )
        .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-token]");
    report.network = {
      terrainTiles: 0,
      imageryTiles: 0,
      metadataAssets: [],
      failures: [],
      httpErrors: [],
    };
    const pendingRequests = new Map();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "http:" || url.protocol === "https:") {
        pendingRequests.set(request, {
          url: `${url.origin}${url.pathname}`,
          startedAt: Date.now(),
        });
      }
    });
    page.on("requestfinished", (request) => pendingRequests.delete(request));
    report.consoleMessages = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        report.consoleMessages.push(redact(message.text()));
      }
    });
    page.on("requestfailed", (request) => {
      pendingRequests.delete(request);
      const url = new URL(request.url());
      report.network.failures.push({
        url: `${url.origin}${url.pathname}`,
        error: request.failure()?.errorText,
      });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!response.ok()) {
        if (response.status() >= 400) {
          report.network.httpErrors.push({
            url: `${url.origin}${url.pathname}`,
            status: response.status(),
          });
        }
        return;
      }
      if (url.pathname.endsWith(".terrain")) {
        ++report.network.terrainTiles;
      }
      if (/\/v1\/2dtiles\/\d+\/\d+\/\d+$/.test(url.pathname)) {
        ++report.network.imageryTiles;
      }
      if (providerMetadataMatch.test(response.url())) {
        report.network.metadataAssets.push(
          Number(url.pathname.match(/\/assets\/(\d+)\//)[1]),
        );
      }
    });
    const check = (message) => {
      report.checks.push(message);
      console.log(`M1 demo: ${message}`);
    };
    const captureReadinessFailure = async (target, error, options = {}) => {
      if (report.readinessFailure) {
        return;
      }
      const state = await target
        .evaluate(() => {
          const state = window.__demo;
          const viewer = state?.viewer;
          const destroyed = viewer?.isDestroyed();
          const scene = destroyed ? undefined : viewer?.scene;
          const surface = scene?.globe?._surface;
          const queues = surface
            ? [
                surface._tileLoadQueueHigh,
                surface._tileLoadQueueMedium,
                surface._tileLoadQueueLow,
              ]
            : [];
          return {
            ready: state?.ready,
            destroyed,
            frames: state?.frames,
            stable: state?.stable,
            hardwareConcurrency: navigator.hardwareConcurrency,
            useDefaultRenderLoop: scene && viewer.useDefaultRenderLoop,
            canvas: scene && [viewer.canvas.width, viewer.canvas.height],
            pixelRatio: scene?.pixelRatio,
            tilesLoaded: scene?.globe.tilesLoaded,
            statistics: scene?.debugStatistics,
            queues: queues.map((queue) => queue.length),
            queueSamples: queues.map((queue) =>
              queue.slice(0, 12).map((tile) => ({
                id: `${tile.level}/${tile.x}/${tile.y}`,
                state: tile.state,
                renderable: tile.renderable,
                terrainState: tile.data?.terrainState,
                mesh: !!tile.data?.mesh,
                imagery: tile.data?.imagery?.slice(0, 4).map((imagery) => ({
                  ready: imagery.readyImagery?.state,
                  loading: imagery.loadingImagery?.state,
                })),
              })),
            ),
            requests: Cesium.RequestScheduler.statistics,
            renderErrors: state?.errors,
            providerErrors: state?.providerErrors,
          };
        })
        .catch((captureError) => ({ captureError: redact(String(captureError)) }));
      state.renderErrors = state.renderErrors?.map(redact);
      state.providerErrors = state.providerErrors?.map((error) => ({
        ...error,
        message: redact(error.message),
      }));
      report.readinessFailure = {
        ...state,
        error: redact(String(error)),
        timeoutMs: options.timeout ?? 90000,
        minimumFrames: options.minimumFrames ?? 0,
        phase: report.terrainLoadBudget?.phase ?? "scene",
        pendingRequests:
          target === page
            ? [...pendingRequests.values()].map((request) => ({
                url: request.url,
                ageMs: Date.now() - request.startedAt,
              }))
            : undefined,
      };
      await target
        .screenshot({
          path: path.join(output, "readiness-failure.png"),
          timeout: 5000,
        })
        .catch((screenshotError) => {
          report.readinessFailure.screenshotError = redact(
            String(screenshotError),
          );
        });
    };
    const waitForScene = async (target, options) => {
      try {
        await settle(target, options);
      } catch (error) {
        await captureReadinessFailure(target, error, options);
        throw error;
      }
    };
    const url = new URL("Apps/WebGPUGlobe.html", base).href;
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const html = await readFile("Apps/WebGPUGlobe.html");
    const served = await fetch(url).then((response) => response.arrayBuffer());
    assert.equal(hash(html), hash(new Uint8Array(served)));
    report.demoSha256 = hash(html);
    report.testSha256 = hash(
      await readFile("coordination/ci/m1-demo-smoke.mjs"),
    );
    await page.addInitScript(observeDemo, {});
    const initialMetadata = await holdProviderMetadata(page);
    await page.goto(url, { waitUntil: "commit" });
    await initialMetadata.ready;
    await waitForScene(page);
    report.scenes.push(await snapshot(page, output, "natural-earth"));
    assert.equal(report.scenes[0].viewerIdentity, true);
    assert.equal(report.scenes[0].backend, "webgpu");
    assert.equal(await page.locator("#everest").isDisabled(), true);
    assert.equal(await page.locator("#terrain").isDisabled(), true);
    assert.equal(await page.locator("#apply-token").isDisabled(), true);
    assert.match(report.scenes[0].credits, /Natural Earth/);
    check(
      "automatic provider loading retains a visible Natural Earth fallback while real metadata is pending",
    );

    // Fail World Terrain, while allowing the real Google metadata promise to
    // complete. Native IonImageryProvider caches rejected promises; a failed
    // Google endpoint cannot currently be recovered by this demo's token UI.
    // Do not clear that native cache or claim that separate limitation fixed.
    await initialMetadata.release(localOnly ? [1, 3830182] : [1]);
    await page.waitForFunction(
      () => !document.getElementById("terrain").disabled,
    );
    report.rejectedProviderRequests = initialMetadata.requests.filter(
      (request) => request.aborted,
    );
    assert.deepEqual(
      initialMetadata.requests
        .map((request) => request.asset)
        .sort((a, b) => a - b),
      [1, 3830182],
    );
    assert.ok(
      report.rejectedProviderRequests.some((request) => request.asset === 1),
    );
    report.providerFailure = await page.evaluate(() => ({
      status: document.getElementById("status").textContent,
      statusColor: getComputedStyle(document.getElementById("status")).color,
      ellipsoid:
        window.__demo.viewer.terrainProvider instanceof
        Cesium.EllipsoidTerrainProvider,
      naturalEarth:
        window.__demo.viewer.imageryLayers.get(0).imageryProvider instanceof
        Cesium.TileMapServiceImageryProvider,
      orbitEnabled: !document.getElementById("orbit").disabled,
      everestDisabled: document.getElementById("everest").disabled,
      tokenEnabled: !document.getElementById("apply-token").disabled,
    }));
    report.providerFailure.status = redact(report.providerFailure.status);
    assert.equal(report.providerFailure.ellipsoid, true);
    assert.equal(report.providerFailure.naturalEarth, true);
    assert.equal(report.providerFailure.orbitEnabled, true);
    assert.equal(report.providerFailure.everestDisabled, true);
    assert.equal(report.providerFailure.tokenEnabled, true);
    assert.match(
      report.providerFailure.status,
      /Could not load Google satellite \/ Cesium World Terrain/,
    );
    assert.notEqual(
      report.providerFailure.statusColor,
      report.scenes[0].statusColor,
    );
    await page.screenshot({ path: path.join(output, "provider-error.png") });
    check(
      "automatic terrain metadata failure preserves the fallback and enables retry/token controls",
    );

    await page.locator("#ion-token").fill("   ");
    await page.locator("#apply-token").click();
    assert.match(
      await page.locator("#status").textContent(),
      /Enter a Cesium ion access token/,
    );
    check(
      "the token form rejects blank input without replacing the working fallback",
    );

    await page.evaluate(() =>
      window.__demo.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-70, -25, 12000000),
      }),
    );
    await page.locator("#orbit").click();
    await page.waitForFunction(
      () => {
        const c = window.__demo.viewer.camera.positionCartographic;
        return (
          Math.abs(Cesium.Math.toDegrees(c.longitude) - 20) < 0.001 &&
          Math.abs(Cesium.Math.toDegrees(c.latitude) - 20) < 0.001 &&
          Math.abs(c.height - 20000000) < 1
        );
      },
      undefined,
      { timeout: 45000 },
    );
    await waitForScene(page);
    report.scenes.push(await snapshot(page, output, "orbit-button"));
    check("Orbit button completes the actual native camera flight");

    const secondary = async (options, run, beforeNavigation) => {
      const testPage = await page
        .context()
        .browser()
        .newPage({
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
        });
      const errors = [];
      testPage.on("pageerror", (error) => errors.push(String(error)));
      try {
        await testPage.addInitScript(observeDemo, options);
        const setup = await beforeNavigation?.(testPage);
        await testPage.goto(url, { waitUntil: "commit" });
        await run(testPage, errors, setup);
        assert.deepEqual(errors, []);
      } finally {
        await testPage.close();
        await page.bringToFront();
      }
    };
    await secondary({ holdAdapter: true }, async (testPage, errors) => {
      await testPage.waitForFunction(() => window.__demo.releaseAdapter);
      report.pendingInitialization = await lifecycle(testPage);
      report.pendingInitialization.browserErrors = errors;
      assertReleased(report.pendingInitialization);
      await testPage.evaluate(() => window.__demo.releaseAdapter());
      await testPage.waitForFunction(() => window.__demo.readyError);
      check("pagehide cancels pending initialization before readiness");
    });

    await secondary({ unavailable: true }, async (testPage, errors) => {
      await testPage.waitForFunction(() => window.__demo.readyError);
      report.unavailable = await testPage.evaluate(() => ({
        status: document.getElementById("status").textContent,
        disabled: [...document.querySelectorAll("nav button")].every(
          (button) => button.disabled,
        ),
      }));
      report.unavailable.browserErrors = errors;
      assert.match(report.unavailable.status, /WebGPU.*unavailable/);
      assert.equal(report.unavailable.disabled, true);
      await testPage.screenshot({
        path: path.join(output, "webgpu-unavailable.png"),
      });
      report.unavailable.cleanup = await lifecycle(testPage);
      assertReleased(report.unavailable.cleanup);
      check("unsupported WebGPU gives visible feedback and clean teardown");
    });

    await secondary(
      {},
      async (testPage, errors, metadata) => {
        await metadata.ready;
        await waitForScene(testPage);
        await testPage.evaluate(() =>
          window.__demo.viewer._webgpuProof._context._device.destroy(),
        );
        await testPage.waitForFunction(() =>
          /device lost/i.test(document.getElementById("status").textContent),
        );
        report.deviceLost = await testPage.evaluate(() => ({
          status: document.getElementById("status").textContent,
          disabled: [
            ...document.querySelectorAll("nav button, #apply-token"),
          ].every((button) => button.disabled),
          errors: [...window.__demo.errors],
        }));
        report.deviceLost.browserErrors = errors;
        assert.equal(
          report.deviceLost.disabled,
          true,
          "Fatal rendering errors must disable controls",
        );
        await testPage.screenshot({
          path: path.join(output, "device-lost.png"),
        });
        await metadata.release();
        report.deviceLost.afterProviderFailure = await testPage.evaluate(
          () => ({
            status: document.getElementById("status").textContent,
            disabled: [
              ...document.querySelectorAll("nav button, #apply-token"),
            ].every((button) => button.disabled),
          }),
        );
        assert.equal(
          report.deviceLost.afterProviderFailure.status,
          report.deviceLost.status,
          "A late provider failure must preserve the fatal renderer error",
        );
        assert.equal(report.deviceLost.afterProviderFailure.disabled, true);
        report.deviceLost.cleanup = await lifecycle(testPage);
        assertReleased(report.deviceLost.cleanup);
        check(
          "actual GPU device loss is visible and disables unavailable controls",
        );
      },
      holdProviderMetadata,
    );

    await secondary(
      {},
      async (testPage, errors, metadata) => {
        await metadata.ready;
        await waitForScene(testPage);
        const before = await testPage.locator("#status").textContent();
        report.pendingProviders = await lifecycle(testPage);
        report.pendingProviders.browserErrors = errors;
        assertReleased(report.pendingProviders);
        await metadata.release();
        report.pendingProviders.statusAfter = await testPage
          .locator("#status")
          .textContent();
        assert.equal(
          report.pendingProviders.statusAfter,
          before,
          "A provider completion must not mutate an exited demo",
        );
        check(
          "pagehide during provider loading releases resources and ignores late failures",
        );
      },
      holdProviderMetadata,
    );

    if (!localOnly) {
      const originalUrl = page.url();
      // Exercise the real form with the current built-in token without exposing
      // its value to logs, reports, URLs or a test-side replacement provider.
      await page.evaluate(() => {
        document.getElementById("ion-token").value =
          Cesium.Ion.defaultAccessToken;
      });
      await page.locator("#apply-token").click();
      await page.waitForFunction(
        () =>
          !document.getElementById("everest").disabled ||
          !document.getElementById("terrain").disabled,
        undefined,
        { timeout: 120000 },
      );
      report.providers = await page.evaluate(() => ({
        status: document.getElementById("status").textContent,
        statusColor: getComputedStyle(document.getElementById("status")).color,
        terrain:
          window.__demo.viewer.terrainProvider instanceof
          Cesium.CesiumTerrainProvider,
        imagery:
          window.__demo.viewer.imageryLayers.get(0).imageryProvider instanceof
          Cesium.IonImageryProvider,
        googleImagery:
          window.__demo.viewer.imageryLayers.get(0).imageryProvider
            ._imageryProvider instanceof Cesium.Google2DImageryProvider,
        everestEnabled: !document.getElementById("everest").disabled,
      }));
      report.providers.status = redact(report.providers.status);
      assert.equal(
        report.providers.terrain,
        true,
        JSON.stringify(report.providers),
      );
      assert.equal(report.providers.imagery, true);
      assert.equal(report.providers.googleImagery, true);
      assert.equal(report.providers.everestEnabled, true);
      report.tokenForm = await page.evaluate(() => {
        const token = Cesium.Ion.defaultAccessToken;
        return {
          inputCleared: document.getElementById("ion-token").value === "",
          stored: [localStorage, sessionStorage].some((storage) =>
            Object.values(storage).some((value) => value.includes(token)),
          ),
        };
      });
      assert.equal(report.tokenForm.inputCleared, true);
      assert.equal(report.tokenForm.stored, false);
      assert.equal(page.url(), originalUrl);
      assert.deepEqual(
        [...new Set(report.network.metadataAssets)].sort((a, b) => a - b),
        [1, 3830182],
      );
      check(
        "the actual token form retries failed terrain loading with real Google ion metadata and keeps the token transient",
      );
      await page.evaluate(() => {
        const state = window.__demo;
        state.beforeReload = {
          terrain: state.viewer.terrainProvider,
          imagery: state.viewer.imageryLayers.get(0).imageryProvider,
        };
      });
      await page.locator("#terrain").click();
      await page.waitForFunction(
        () => !document.getElementById("terrain").disabled,
      );
      report.reload = await page.evaluate(() => {
        const state = window.__demo;
        const terrain = state.viewer.terrainProvider;
        const imagery = state.viewer.imageryLayers.get(0).imageryProvider;
        return {
          replacedTerrain:
            terrain !== state.beforeReload.terrain &&
            terrain instanceof Cesium.CesiumTerrainProvider,
          replacedImagery:
            imagery !== state.beforeReload.imagery &&
            imagery instanceof Cesium.IonImageryProvider,
          googleImagery:
            imagery._imageryProvider instanceof Cesium.Google2DImageryProvider,
          everestEnabled: !document.getElementById("everest").disabled,
        };
      });
      assert.deepEqual(report.reload, {
        replacedTerrain: true,
        replacedImagery: true,
        googleImagery: true,
        everestEnabled: true,
      });
      check(
        "Reload imagery + terrain replaces both native providers and preserves the live controls",
      );
      await page.evaluate(() => {
        const state = window.__demo;
        state.providerErrors = [];
        for (const [name, provider] of [
          ["World Terrain", state.viewer.terrainProvider],
          [
            "Google satellite",
            state.viewer.imageryLayers.get(0).imageryProvider,
          ],
        ]) {
          provider.errorEvent.addEventListener((error) =>
            state.providerErrors.push({
              name,
              x: error.x,
              y: error.y,
              level: error.level,
              message: error.message,
            }),
          );
        }
      });
      assert.equal(
        report.providers.statusColor,
        report.scenes[0].statusColor,
        "A successful provider retry must clear error styling",
      );
      await page.locator("#everest").click();
      await page.waitForFunction(
        () => {
          const c = window.__demo.viewer.camera.positionCartographic;
          return (
            Math.abs(Cesium.Math.toDegrees(c.longitude) - 86.925) < 0.001 &&
            Math.abs(Cesium.Math.toDegrees(c.latitude) - 27.9) < 0.001 &&
            Math.abs(c.height - 18000) < 1
          );
        },
        undefined,
        { timeout: 45000 },
      );
      const readinessStart = Date.now();
      const deadline = readinessStart + 90000;
      const remaining = () => {
        const milliseconds = deadline - Date.now();
        assert.ok(
          milliseconds > 0,
          "Everest shared 90-second readiness budget exhausted",
        );
        return milliseconds;
      };
      const before = await terrainRenderState(page);
      const software = classifyGpu(before.adapterInfo).kind === "software";
      report.terrainLoadBudget = {
        applied: software,
        budgetMs: 90000,
        before,
        phase: "streaming",
      };
      try {
        if (software) {
          // Keep the CSS viewport and native SSE budget: 540 / 0.75 = 720.
          // This bounds software fragment work during streaming. Restore the
          // original targets and verify actual rendered frames in the SAME
          // 90-second budget before the original full-resolution assertions.
          await page.evaluate(() => {
            window.__demo.viewer.resolutionScale = 0.75;
          });
        }
        await waitForScene(page, { timeout: remaining() });
        if (software) {
          const reduced = await terrainRenderState(page);
          report.terrainLoadBudget.reduced = reduced;
          assert.deepEqual(reduced.css, before.css);
          assert.equal(reduced.sseHeight, before.sseHeight);
          assert.equal(reduced.atmosphereShown, true);
          report.terrainLoadBudget.phase = "restored frames";
          const minimumFrames = await page.evaluate(() => {
            const state = window.__demo;
            state.viewer.resolutionScale = 1;
            state.stable = 0;
            state.signature = undefined;
            return state.frames + 3;
          });
          await waitForScene(page, { timeout: remaining(), minimumFrames });
          report.terrainLoadBudget.phase = "GPU completion";
          await page.evaluate(() => {
            const state = window.__demo;
            state.restoredGpuDone = false;
            state.viewer._webgpuProof._context._device.queue
              .onSubmittedWorkDone()
              .then(() => {
                state.restoredGpuDone = true;
              });
          });
          await page.waitForFunction(
            () => window.__demo.restoredGpuDone,
            undefined,
            { timeout: remaining() },
          );
          const restored = await terrainRenderState(page);
          report.terrainLoadBudget.restored = restored;
          assert.deepEqual(restored.canvas, before.canvas);
          assert.deepEqual(restored.canvas, [1280, 720]);
          assert.equal(restored.scale, 1);
          assert.equal(restored.sseHeight, before.sseHeight);
          assert.equal(restored.atmosphereShown, true);
          assert.ok(restored.frames >= minimumFrames);
          assert.deepEqual(restored.tiles, reduced.tiles);
          assert.equal(restored.lutBuilds, reduced.lutBuilds);
        }
        report.terrainLoadBudget.elapsedMs = Date.now() - readinessStart;
        assert.ok(report.terrainLoadBudget.elapsedMs <= 90000);
        report.terrainLoadBudget.phase = "complete";
      } catch (error) {
        await captureReadinessFailure(page, error);
        throw error;
      }
      report.scenes.push(await snapshot(page, output, "everest"));
      assert.ok(Math.abs(report.scenes.at(-1).camera.pitch + 45) < 0.01);
      report.liveTerrain = await page.evaluate(() => {
        const draws = window.__demo.viewer.scene._renderer._draws;
        const tiles = [...new Set(draws.map(({ tile }) => tile))];
        return {
          quantizedMeshes: tiles.filter(
            (tile) =>
              tile.data.terrainData instanceof Cesium.QuantizedMeshTerrainData,
          ).length,
          maximumHeight: Math.max(
            ...tiles.map((tile) => tile.data.mesh.maximumHeight),
          ),
          levels: [...new Set(tiles.map((tile) => tile.level))],
        };
      });
      assert.ok(report.liveTerrain.quantizedMeshes > 0);
      assert.ok(report.liveTerrain.maximumHeight > 8000);
      assert.ok(Math.max(...report.liveTerrain.levels) >= 9);
      assert.ok(
        report.network.terrainTiles > 10,
        "Real terrain responses are required",
      );
      assert.ok(
        report.network.imageryTiles > 10,
        "Real imagery responses are required",
      );
      assert.ok(
        /Google/i.test(report.scenes.at(-1).credits) ||
          report.scenes
            .at(-1)
            .creditImages.some(
              (image) => /Google/i.test(image.alt) && image.loaded,
            ),
        "The live demo must display native Google attribution",
      );
      report.terrainAttribution = await page.evaluate(() => {
        const credits = window.__demo.viewer.scene._renderer._draws.flatMap(
          ({ tile }) => tile.data.terrainData.credits ?? [],
        );
        return {
          requiredText: [...new Set(credits)]
            .map((credit) => {
              const element = document.createElement("div");
              element.innerHTML = credit.html;
              return element.textContent.replace(/\s+/g, " ").trim();
            })
            .filter(Boolean),
        };
      });
      report.terrainAttribution.visibleText = report.scenes
        .at(-1)
        .credits.replace(/\s+/g, " ")
        .trim();
      assert.ok(
        report.terrainAttribution.requiredText.length > 0,
        "Real World Terrain must supply native attribution for this check",
      );
      for (const credit of report.terrainAttribution.requiredText) {
        assert.ok(
          report.terrainAttribution.visibleText.includes(credit),
          `The demo must display native terrain attribution: ${credit}`,
        );
      }
      check(
        "real World Terrain and Google satellite load through the UI; Everest renders quantized mountains with attribution",
      );
      await page.locator("#orbit").click();
      await page.waitForFunction(
        () =>
          Math.abs(
            window.__demo.viewer.camera.positionCartographic.height - 20000000,
          ) < 1,
        undefined,
        { timeout: 45000 },
      );
      await waitForScene(page);
      report.scenes.push(await snapshot(page, output, "live-orbit"));
      const orbit = report.scenes.at(-1).camera;
      assert.ok(Math.abs(orbit.longitude - 20) < 0.001);
      assert.ok(Math.abs(orbit.latitude - 20) < 0.001);
      assert.ok(Math.abs(orbit.pitch + 90) < 0.01);
      report.providerErrors = await page.evaluate(
        () => window.__demo.providerErrors,
      );
      for (const error of report.providerErrors) {
        error.message = redact(error.message);
      }
      assert.deepEqual(report.providerErrors, []);
      check("live Everest-to-Orbit flight retains tiled imagery");

      await secondary(
        {},
        async (testPage, errors, metadataAssets) => {
          await testPage.waitForFunction(
            () =>
              window.__demo?.ready &&
              !document.getElementById("terrain").disabled,
            undefined,
            { timeout: 120000 },
          );
          report.automaticProviders = await testPage.evaluate(() => ({
            terrain:
              window.__demo.viewer.terrainProvider instanceof
              Cesium.CesiumTerrainProvider,
            imagery:
              window.__demo.viewer.imageryLayers.get(0)
                .imageryProvider instanceof Cesium.IonImageryProvider,
            googleImagery:
              window.__demo.viewer.imageryLayers.get(0).imageryProvider
                ._imageryProvider instanceof Cesium.Google2DImageryProvider,
            everestEnabled: !document.getElementById("everest").disabled,
          }));
          assert.deepEqual(report.automaticProviders, {
            terrain: true,
            imagery: true,
            googleImagery: true,
            everestEnabled: true,
          });
          report.automaticProviders.browserErrors = errors;
          assert.deepEqual(
            [...new Set(metadataAssets)].sort((a, b) => a - b),
            [1, 3830182],
          );
          report.automaticProviders.metadataAssets = metadataAssets;
          await waitForScene(testPage);
          report.scenes.push(
            await snapshot(testPage, output, "automatic-google-orbit"),
          );
          report.automaticProviders.cleanup = await lifecycle(testPage);
          assertReleased(report.automaticProviders.cleanup);
          check(
            "a fresh unmodified demo automatically loads real Google satellite and World Terrain without clicking controls",
          );
        },
        (testPage) => {
          const assets = [];
          testPage.on("response", (response) => {
            if (response.ok() && providerMetadataMatch.test(response.url())) {
              assets.push(
                Number(
                  new URL(response.url()).pathname.match(
                    /\/assets\/(\d+)\//,
                  )[1],
                ),
              );
            }
          });
          return assets;
        },
      );
    }
    await page.evaluate(() => {
      window.__m1 = { adapterInfo: window.__demo.adapterInfo };
    });
    report.destroy = await lifecycle(page);
    assertReleased(report.destroy);
    check(
      "pagehide releases every observed native GPU allocation and stops rendering",
    );
  },
);
