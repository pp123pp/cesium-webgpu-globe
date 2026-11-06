/* global Cesium, window, document, location, queueMicrotask */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import {
  scenes,
  services,
  sourceOf,
  settleReferenceScene,
  initializeReferenceViewer,
} from "./m5-reference-harness.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sample(page, output, name, control) {
  await settleReferenceScene(page);
  const { png, ...result } = await page.evaluate((control) => {
    const viewer = window.__referenceViewer;
    const { scene, camera } = viewer;
    const copy = document.createElement("canvas");
    copy.width = viewer.canvas.width;
    copy.height = viewer.canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    function render() {
      viewer.render();
      context.drawImage(viewer.canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height).data;
    }
    const pixels = render();
    const png = copy.toDataURL().split(",")[1];
    const occupied = new Set();
    let sum = 0;
    let signal = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const maximum = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      occupied.add(maximum);
      signal += Number(maximum > 0);
      sum += maximum;
    }
    let changedPixels = 0;
    if (control) {
      const previous = scene.clouds[control];
      scene.clouds[control] = false;
      const neutral = render();
      for (let i = 0; i < pixels.length; i += 4) {
        const difference = Math.max(
          ...[0, 1, 2].map((c) => Math.abs(pixels[i + c] - neutral[i + c])),
        );
        changedPixels += Number(difference >= 2);
      }
      scene.clouds[control] = previous;
      render();
    }
    const position = camera.positionCartographic;
    const normal =
      scene.globe.ellipsoid.geodeticSurfaceNormalCartographic(position);
    const sun = scene._planetState.sunDirectionWC;
    const stats = scene.debugStatistics;
    let goldenGate;
    if (location.hash === "#terrain-shadow") {
      let lighter = 0;
      let darker = 0;
      const prior = window.__goldenPixels;
      if (prior) {
        for (let i = 0; i < pixels.length; i += 4) {
          const dr = pixels[i] - prior[i];
          const dg = pixels[i + 1] - prior[i + 1];
          const db = pixels[i + 2] - prior[i + 2];
          lighter += Number(Math.max(dr, dg, db) > 0);
          darker += Number(Math.min(dr, dg, db) < 0);
        }
      }
      window.__goldenPixels = pixels;
      const meshes = scene._renderer._draws.map(
        ({ tile }) => tile.data.renderedMesh,
      );
      goldenGate = {
        lighter,
        darker,
        minHeight: Math.min(...meshes.map((mesh) => mesh.minimumHeight)),
        maxHeight: Math.max(...meshes.map((mesh) => mesh.maximumHeight)),
      };
    }
    return {
      slug: location.hash.slice(1),
      png,
      frame: Number(document.querySelector("#frame").dataset.frame),
      utc: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
      position: [
        Cesium.Math.toDegrees(position.longitude),
        Cesium.Math.toDegrees(position.latitude),
        position.height,
      ],
      orientation: [camera.heading, camera.pitch, camera.roll],
      solarElevation: Cesium.Math.toDegrees(
        Math.asin(Cesium.Cartesian3.dot(normal, sun)),
      ),
      dimensions: [copy.width, copy.height],
      drawCalls: stats.resources.drawCalls,
      cloudsShown: scene._atmosphere._cloudsShown,
      coverage: scene.clouds.coverage,
      terrainProvider: viewer.terrainProvider.constructor.name,
      terrainDrawLevels: [...new Set(stats.levels)],
      imageryDrawCalls: stats.resources.imageryDrawCalls,
      imagerySources: [...Array(scene.imageryLayers.length).keys()].map((i) => {
        const layer = scene.imageryLayers.get(i);
        return {
          provider: layer.imageryProvider?.constructor.name,
          shown: layer.show,
        };
      }),
      sourceStatus: { ...document.getElementById("source").dataset },
      signalPixels: signal,
      intensityLevels: occupied.size,
      meanPeakChannel: sum / (pixels.length / 4),
      ...(control ? { control, changedPixels } : {}),
      ...(goldenGate ? { goldenGate } : {}),
    };
  }, control);
  const bytes = Buffer.from(png, "base64");
  await writeFile(path.join(output, `${name}.png`), bytes);
  assert.ok(
    result.signalPixels > 100 && result.intensityLevels > 7,
    `${name} must contain rendered detail`,
  );
  if (control) {
    assert.ok(
      result.changedPixels > 100,
      `${name} must visibly respond to ${control}: ${result.changedPixels}`,
    );
  }
  return { ...result, capture: `${name}.png`, sha256: sha256(bytes) };
}

process.env.M1_OUTPUT ??= "Build/m5-reference-scenes";
await runM1BrowserSuite(
  "m5-reference-scenes",
  async ({ page, report, output, base }) => {
    const app = "Apps/WebGPUReferenceScenes.html";
    const url = new URL(app, base);
    const externalRequests = [];
    let currentScene = "sunrise";
    report.liveSources = Object.fromEntries(
      Object.entries(services).map(([key, url]) => [
        key,
        { url, tileCount: 0, firstTile: undefined },
      ]),
    );
    page.on("response", (response) => {
      const key = sourceOf(response.url());
      if (
        key &&
        response.ok() &&
        /\/tile\/\d+\/\d+\/\d+\b/.test(response.url())
      ) {
        const info = report.liveSources[key];
        info.tileCount++;
        info.firstTile ??= new URL(response.url()).pathname;
      }
    });
    await page.route("**/*", (route) => {
      const request = new URL(route.request().url());
      if (
        request.origin === url.origin ||
        request.protocol === "data:" ||
        request.protocol === "blob:"
      ) {
        return route.continue();
      }
      if (currentScene === "terrain-shadow" && sourceOf(request.href)) {
        return route.continue();
      }
      externalRequests.push(request.href);
      return route.abort();
    });
    await page.setViewportSize({ width: 640, height: 360 });
    const response = await page.goto(`${url.href}#sunrise`);
    report.demoSha256 = sha256(await readFile(app));
    assert.equal(
      sha256(await response.body()),
      report.demoSha256,
      "serve the unchanged local demo",
    );
    await page.waitForFunction(
      () => !document.getElementById("controls").disabled,
      undefined,
      { timeout: 60000 },
    );
    assert.equal(await page.locator("#scene").inputValue(), "sunrise");
    await initializeReferenceViewer(page, report.configuration);
    assert.deepEqual(
      await page
        .locator("#scene option")
        .evaluateAll((options) => options.map((option) => option.value)),
      scenes,
    );
    for (const slug of scenes) {
      currentScene = slug;
      await page.locator("#scene").selectOption(slug);
      await page.waitForFunction((slug) => location.hash === `#${slug}`, slug);
      if (slug === "terrain-shadow") {
        await page
          .locator("#source[data-terrain=live][data-imagery=live]")
          .waitFor({ state: "attached", timeout: 90000 });
      }
      const control = ["cloud-sea", "inside-cloud"].includes(slug)
        ? "show"
        : undefined;
      const reference = await sample(page, output, slug, control);
      report.scenes.push(reference);
      if (slug === "terrain-shadow") {
        assert.equal(
          reference.terrainProvider,
          "ArcGISTiledElevationTerrainProvider",
        );
        assert.ok(
          reference.imagerySources.some(
            (layer) =>
              layer.shown &&
              layer.provider === "ArcGisMapServerImageryProvider",
          ),
        );
        assert.ok(reference.imageryDrawCalls > 0);
        assert.ok(
          reference.goldenGate.maxHeight - reference.goldenGate.minHeight > 30,
        );
        assert.ok(
          Object.values(report.liveSources).every(
            (source) => source.tileCount > 0,
          ),
          "real terrain and imagery tiles must be served",
        );
        const demoCapture = "golden-gate-demo.png";
        await page.screenshot({
          path: path.join(output, demoCapture),
          fullPage: true,
        });
        report.goldenDemo = demoCapture;
        await page.locator("#ambient").uncheck();
        const direct = await sample(page, output, "terrain-shadow-direct");
        await page.locator("#shadows").uncheck();
        assert.equal(await page.locator("#ambient").isDisabled(), true);
        const off = await sample(page, output, "terrain-shadow-off");
        for (const exposure of [direct, off]) {
          assert.ok(
            exposure.goldenGate.lighter > 100 &&
              exposure.goldenGate.darker === 0,
            `Removing an attenuation term must brighten terrain: ${JSON.stringify(exposure.goldenGate)}`,
          );
        }
        report.goldenControls = { direct, off };
      }
      await page.locator("#reset").click();
      const replay = await sample(page, output, `${slug}-reset`);
      reference.resetSha256 = replay.sha256;
      assert.equal(replay.utc, reference.utc, slug);
      assert.deepEqual(replay.position, reference.position, slug);
      assert.deepEqual(replay.orientation, reference.orientation, slug);
      assert.equal(
        replay.sha256,
        reference.sha256,
        `${slug} reset must reproduce the rendered reference`,
      );
    }
    const [orbit, sunrise, twilight, night, cloudSea, inside, terrain, start] =
      report.scenes;
    assert.equal(
      new Set(report.scenes.map((row) => row.sha256)).size,
      scenes.length,
    );
    assert.ok(orbit.position[2] > 250000 && orbit.solarElevation > 10);
    assert.ok(
      Math.abs(sunrise.solarElevation) < 8 &&
        twilight.solarElevation < sunrise.solarElevation &&
        night.solarElevation < -12,
    );
    assert.ok(
      cloudSea.cloudsShown &&
        inside.cloudsShown &&
        cloudSea.position[2] > inside.position[2],
    );
    assert.ok(inside.position[2] > 2000 && inside.position[2] < 6000);
    const [longitude, latitude, height] = terrain.position;
    assert.ok(
      Math.abs(longitude + 122.489) < 1e-6 &&
        Math.abs(latitude - 37.8113) < 1e-6 &&
        Math.abs(height - 1900) < 1,
    );
    assert.equal(Date.parse(terrain.utc), Date.parse("2026-03-20T20:00:00Z"));
    assert.equal(terrain.coverage, 0.78);
    const lastFrame = Number(
      await page.locator("#frame").getAttribute("data-last-frame"),
    );
    for (let i = 0; i < 3; i++) {
      await page.locator("#step").click();
    }
    const stepped = await sample(page, output, "rapid-motion-step");
    assert.equal(stepped.frame, 3);
    assert.notDeepEqual(stepped.position, start.position);
    assert.notEqual(stepped.utc, start.utc);
    assert.notEqual(stepped.sha256, start.sha256);
    await page.evaluate(() => {
      const { scene } = window.__referenceViewer;
      const output = document.querySelector("#frame");
      document.querySelector("#replay").addEventListener(
        "click",
        () => {
          window.__motionTimes = [];
          scene.postRender.addEventListener(() => {
            const rendered = Cesium.JulianDate.toIso8601(
              scene._frameState.time,
              0,
            );
            queueMicrotask(() => {
              const frame = Number(output.dataset.frame);
              const utc = document.querySelector("#date").textContent;
              if (
                window.__motionTimes.at(-1)?.frame !== frame ||
                utc !== rendered
              ) {
                window.__motionTimes.push({ frame, utc, rendered });
              }
            });
          });
        },
        { once: true },
      );
    });
    await page.locator("#replay").click();
    await page.waitForFunction(
      (last) => window.__motionTimes?.at(-1)?.frame === last,
      lastFrame,
      { timeout: 120000 },
    );
    const playback = await page.evaluate(() => window.__motionTimes.slice());
    assert.ok(
      playback.every((row) => row.utc === row.rendered),
      `Playback displayed a different UTC from the rendered frame: ${JSON.stringify(playback.filter((row) => row.utc !== row.rendered).slice(0, 3))}`,
    );
    assert.equal(
      new Set(playback.filter((row) => row.frame > 0).map((row) => row.frame))
        .size,
      lastFrame,
    );
    const end = await sample(page, output, "rapid-motion-end");
    assert.notEqual(end.sha256, stepped.sha256);
    assert.notDeepEqual(end.position, start.position);
    await page.locator("#reset").click();
    const reset = await sample(page, output, "rapid-motion-reset");
    assert.equal(reset.frame, 0);
    assert.equal(reset.utc, start.utc);
    assert.deepEqual(reset.position, start.position);
    assert.equal(reset.sha256, start.sha256);
    for (let i = 0; i < stepped.frame; i++) {
      await page.locator("#step").click();
    }
    const repeatedStep = await sample(page, output, "rapid-motion-step-repeat");
    assert.equal(
      repeatedStep.sha256,
      stepped.sha256,
      "repeat the same intermediate flight frame",
    );
    assert.equal(repeatedStep.utc, stepped.utc);
    assert.deepEqual(repeatedStep.position, stepped.position);
    report.motion = { lastFrame, stepped, end, reset, repeatedStep, playback };
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "Seven offline presets plus Golden Gate live terrain and imagery, deterministic reset, solar angles, cloud and shadow color controls, actual rapid flight and replay",
    );
  },
);
