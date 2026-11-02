// Real-browser M0.4 acceptance checks. Run after build with the server on :8080.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = "http://localhost:8080";
const outputDir = "Build/m0-webgpu";
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const browserErrors = [];
const browserMessages = [];
const checks = [];
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserMessages.push(message.text());
  });
  await page.goto(`${base}/Specs/e2e/cesium.html`);
  await page.addScriptTag({ url: `${base}/Build/CesiumUnminified/Cesium.js` });
  const drawing = await page.evaluate(async () => {
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const requestedContexts = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      requestedContexts.push(kind);
      return original.call(this, kind, ...args);
    };
    const viewer = new Cesium.Viewer("cesiumContainer", {
      renderingBackend: "webgpu",
      useDefaultRenderLoop: false,
      globe: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      animation: false,
      timeline: false,
      skyBox: false,
      skyAtmosphere: false,
    });
    check(viewer.renderingBackend === "webgpu", "Viewer did not select WebGPU");
    check(viewer instanceof Cesium.Viewer, "Viewer identity changed");
    try {
      viewer.renderingBackend = "webgl";
    } catch {
      /* Read-only in strict mode. */
    }
    check(viewer.renderingBackend === "webgpu", "Backend was hot-switched");
    const errors = [];
    globalThis.__m0Diagnostics = { errors, stage: "initializing", lost: [] };
    viewer.renderError.addEventListener((source, error) =>
      errors.push(String(error)),
    );
    await viewer.readyPromise;
    check(
      !requestedContexts.some((kind) => /webgl|experimental-webgl/.test(kind)),
      "WebGPU initialized WebGL",
    );
    check(requestedContexts.includes("webgpu"), "No WebGPU canvas acquired");
    let sceneRejected = false;
    try {
      void viewer.scene;
    } catch (error) {
      sceneRejected = /M0|WebGPU/.test(String(error));
    }
    check(sceneRejected, "WebGPU must not pretend to expose a Cesium Scene");

    const gpuContext = viewer._webgpuProof._context;
    const diagnostics = globalThis.__m0Diagnostics;
    diagnostics.stage = "drawing";
    diagnostics.adapter = {
      vendor: gpuContext._adapter.info.vendor,
      architecture: gpuContext._adapter.info.architecture,
      device: gpuContext._adapter.info.device,
      description: gpuContext._adapter.info.description,
    };
    gpuContext._device.lost.then((info) =>
      diagnostics.lost.push({ reason: info.reason, message: info.message }),
    );
    // Read the submitted GPU texture directly instead of relying on Canvas2D
    // snapshot/presentation timing. COPY_SRC is enabled only by this test.
    gpuContext._canvasContext.configure({
      device: gpuContext._device,
      format: gpuContext._format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const sample = async (manual = true) => {
      const device = gpuContext._device;
      device.pushErrorScope("validation");
      if (manual) viewer.render();
      const buffer = device.createBuffer({
        size: 512,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      try {
        const texture = gpuContext._canvasContext.getCurrentTexture();
        const encoder = device.createCommandEncoder();
        for (const [offset, x, y] of [
          [0, 2, 2],
          [
            256,
            Math.floor(viewer.canvas.width / 2),
            Math.floor(viewer.canvas.height / 2),
          ],
        ]) {
          encoder.copyTextureToBuffer(
            { texture, origin: [x, y] },
            { buffer, offset, bytesPerRow: 256 },
            [1, 1],
          );
        }
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(buffer.getMappedRange());
        const rgba = (offset) => {
          const value = Array.from(bytes.slice(offset, offset + 4));
          if (gpuContext._format.startsWith("bgra"))
            [value[0], value[2]] = [value[2], value[0]];
          return value;
        };
        return { background: rgba(0), center: rgba(256) };
      } finally {
        buffer.destroy();
        let validation;
        try {
          validation = await device.popErrorScope();
        } catch (error) {
          throw new Error(
            `${error}; context error: ${gpuContext._error}; diagnostics: ${JSON.stringify(diagnostics)}`,
          );
        }
        check(
          !validation,
          `GPU draw/readback validation: ${validation?.message}`,
        );
      }
    };
    const pixels = await sample();
    check(
      pixels.background[0] < 30 &&
        pixels.background[1] < 40 &&
        pixels.background[2] < 55 &&
        pixels.background[3] === 255,
      `Clear color missing: ${JSON.stringify({ pixels, width: viewer.canvas.width, height: viewer.canvas.height, canRender: viewer._webgpuProof._canRender, errors })}`,
    );
    check(
      pixels.center[0] > 85 &&
        pixels.center[0] < 175 &&
        pixels.center[1] > 35 &&
        pixels.center[2] > 35 &&
        pixels.center[2] < 110,
      "RGB triangle/depth test failed (far magenta must stay occluded)",
    );
    const initialDepth = gpuContext._depthTexture;
    const container = viewer.container;
    container.style.width = "640px";
    container.style.height = "360px";
    viewer.resize();
    check(
      viewer.canvas.width === 640 && viewer.canvas.height === 360,
      "Resize did not match CSS dimensions",
    );
    check(
      gpuContext._depthTexture !== initialDepth,
      "Depth attachment was not resized",
    );
    const resized = await sample();
    check(resized.center[1] > 35, "Triangle missing after resize");
    check(window.devicePixelRatio === 2, "DPR fixture did not apply");
    viewer.useBrowserRecommendedResolution = false;
    check(
      viewer.canvas.width === 1280 && viewer.canvas.height === 720,
      "Device pixel ratio ignored",
    );
    viewer.useBrowserRecommendedResolution = true;
    viewer.resolutionScale = 0.5;
    viewer.resize();
    check(
      viewer.canvas.width === 320 && viewer.canvas.height === 180,
      "Resolution scale ignored",
    );
    container.style.display = "none";
    viewer.resize();
    viewer.render();
    container.style.display = "block";
    viewer.resolutionScale = 1;
    container.style.width = "1280px";
    container.style.height = "720px";
    viewer.forceResize();
    await sample();
    await gpuContext._device.queue.onSubmittedWorkDone();
    check(errors.length === 0, `Unexpected GPU errors: ${errors}`);
    globalThis.__m0Viewer = viewer;
    globalThis.__m0ReadPixels = sample;
    return {
      adapter: {
        ...gpuContext._adapter.info,
        vendor: gpuContext._adapter.info.vendor,
        architecture: gpuContext._adapter.info.architecture,
        device: gpuContext._adapter.info.device,
        description: gpuContext._adapter.info.description,
      },
      format: gpuContext._format,
      canvas: [viewer.canvas.width, viewer.canvas.height],
      pixels,
      resizedPixels: resized,
      requestedContexts,
      validationErrors: errors,
    };
  });
  checks.push(
    "Viewer selection and identity",
    "clear and depth-tested RGB pixels",
    "resize and hidden container",
    "resolution scale",
  );
  await page.evaluate(() => {
    globalThis.__m0Viewer.useDefaultRenderLoop = true;
  });
  await page.screenshot({
    path: `${outputDir}/webgpu-smoke.png`,
    scale: "css",
  });
  const lifecycle = await page.evaluate(async () => {
    const viewer = globalThis.__m0Viewer;
    const events = [];
    viewer.renderError.addEventListener((source, error) =>
      events.push(String(error)),
    );
    const device = viewer._webgpuProof._context._device;
    viewer.useDefaultRenderLoop = true;
    viewer.container.style.width = "800px";
    viewer.container.style.height = "400px";
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (viewer.canvas.width !== 800 || viewer.canvas.height !== 400)
      throw new Error("Default loop did not resize");
    const automaticPixels = await new Promise((resolve, reject) =>
      requestAnimationFrame(() =>
        globalThis.__m0ReadPixels(false).then(resolve, reject),
      ),
    );
    if (automaticPixels.center[1] < 35)
      throw new Error("Default loop did not draw the triangle");
    device.destroy();
    await device.lost;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (events.length !== 1 || viewer.useDefaultRenderLoop)
      throw new Error("Device loss was not surfaced and stopped");
    viewer.destroy();
    if (
      !viewer.isDestroyed() ||
      document.querySelector("#cesiumContainer canvas")
    )
      throw new Error("Viewer did not dispose its DOM");
    return events;
  });
  checks.push(
    "DPR-scaled resize",
    "default loop draws and resizes",
    "device loss stops rendering",
    "destroy removes canvas",
  );

  const failures = await page.evaluate(async () => {
    const originalGpu = navigator.gpu;
    const container = document.getElementById("cesiumContainer");
    const results = [];
    const setGpu = (value) =>
      Object.defineProperty(navigator, "gpu", { configurable: true, value });
    const expectFailure = async (name, gpu) => {
      setGpu(gpu);
      const viewer = new Cesium.Viewer(container, {
        renderingBackend: "webgpu",
      });
      let rejected = false;
      try {
        await viewer.readyPromise;
      } catch {
        rejected = true;
      }
      if (!rejected || viewer.useDefaultRenderLoop)
        throw new Error(`${name}: startup did not fail explicitly`);
      viewer.destroy();
      if (container.querySelector("canvas"))
        throw new Error(`${name}: leaked canvas`);
      results.push(name);
    };
    await expectFailure("WebGPU unavailable", undefined);
    await expectFailure("null adapter", { requestAdapter: async () => null });
    await expectFailure("adapter rejection", {
      requestAdapter: async () => {
        throw new Error("adapter denied");
      },
    });
    await expectFailure("device rejection", {
      requestAdapter: async () => ({
        requestDevice: async () => {
          throw new Error("device denied");
        },
      }),
    });
    setGpu(originalGpu);
    for (const options of [
      { renderingBackend: "invalid" },
      { renderingBackend: "webgpu", sceneMode: Cesium.SceneMode.SCENE2D },
      { renderingBackend: "webgpu", terrainProvider: {} },
    ]) {
      let rejected = false;
      try {
        new Cesium.Viewer(container, options);
      } catch {
        rejected = true;
      }
      if (!rejected || container.querySelector("canvas"))
        throw new Error("Unsupported options were accepted or leaked DOM");
    }
    results.push("invalid backend and unsupported features");

    const adapter = await originalGpu.requestAdapter();
    let release;
    let destroyed = 0;
    setGpu({
      requestAdapter: async () => ({
        requestDevice: () =>
          new Promise((resolve) => {
            release = async () => {
              const device = await adapter.requestDevice();
              const originalDestroy = device.destroy.bind(device);
              device.destroy = () => {
                destroyed++;
                originalDestroy();
              };
              resolve(device);
            };
          }),
      }),
      getPreferredCanvasFormat: () => originalGpu.getPreferredCanvasFormat(),
    });
    const pending = new Cesium.Viewer(container, {
      renderingBackend: "webgpu",
    });
    const readiness = pending.readyPromise.then(
      () => "resolved",
      () => "rejected",
    );
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    pending.destroy();
    await release();
    if (
      (await readiness) !== "rejected" ||
      destroyed !== 1 ||
      container.querySelector("canvas")
    )
      throw new Error("Late device leaked or destroyed Viewer restarted");
    results.push("destroy while device request pending");
    setGpu(originalGpu);

    const viewer = new Cesium.Viewer(container, { renderingBackend: "webgpu" });
    await viewer.readyPromise;
    const errors = [];
    const failed = new Promise((resolve) =>
      viewer.renderError.addEventListener((source, error) => {
        errors.push(String(error));
        resolve();
      }),
    );
    viewer._webgpuProof._context._device.createBuffer({ size: 4, usage: 0 });
    await Promise.race([
      failed,
      new Promise((resolve, reject) =>
        setTimeout(
          () => reject(new Error("Validation error was not surfaced")),
          5000,
        ),
      ),
    ]);
    if (viewer.useDefaultRenderLoop || errors.length !== 1)
      throw new Error("Validation error did not stop rendering");
    viewer.destroy();
    results.push("uncaptured validation error");
    const webgl = new Cesium.Viewer(container, {
      renderingBackend: "webgl",
      useDefaultRenderLoop: false,
      globe: false,
      baseLayer: false,
      baseLayerPicker: false,
      skyBox: false,
      skyAtmosphere: false,
      geocoder: false,
      animation: false,
      timeline: false,
    });
    webgl.render();
    if (
      webgl.renderingBackend !== "webgl" ||
      webgl.scene.context._gl.isContextLost()
    )
      throw new Error("Explicit WebGL selection failed");
    webgl.destroy();
    results.push("explicit WebGL selection");
    return { checks: results, expectedValidationErrors: errors };
  });
  checks.push(...failures.checks);
  assert.deepEqual(browserErrors, [], "Unhandled browser errors");
  const result = {
    browser: browser.version(),
    drawing,
    lifecycle,
    failures,
    checks,
    browserErrors,
  };
  await writeFile(
    `${outputDir}/webgpu-smoke.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log("M0 WEBGPU SMOKE PASS", JSON.stringify(result));
} catch (error) {
  const diagnostics = page
    ? await page
        .evaluate(() => globalThis.__m0Diagnostics)
        .catch(() => undefined)
    : undefined;
  await writeFile(
    `${outputDir}/webgpu-smoke-error.json`,
    `${JSON.stringify({ error: String(error), checks, browserErrors, browserMessages, diagnostics }, null, 2)}\n`,
  );
  if (page)
    await page
      .screenshot({ path: `${outputDir}/webgpu-smoke-failure.png` })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
