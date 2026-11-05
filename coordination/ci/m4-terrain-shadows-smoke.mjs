/* global Cesium, window, document */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  runM1BrowserSuite,
  installM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";
import { assertPhysicalGpu, classifyGpu } from "./m0-browser-config.mjs";

process.env.M1_OUTPUT ??= "Build/m4-terrain-shadows";
await runM1BrowserSuite(
  "m4-terrain-shadows",
  async ({ page, report, output }) => {
    await page.setViewportSize({ width: 320, height: 180 });
    await installM1Scene(page, { baseLayer: false });
    assertPhysicalGpu(
      classifyGpu(await page.evaluate(() => window.__m1.adapterInfo)),
      report.configuration,
    );
    await page.evaluate(() => {
      const { viewer, pixels } = window.__m1;
      const { scene } = viewer;
      scene.globe.baseColor = new Cesium.Color(0.45, 0.45, 0.45, 1);
      scene.globe.enableLighting = true;
      scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.clock.shouldAnimate = false;
      Object.assign(scene.clouds, {
        show: true,
        coverage: 0.78,
        quality: "low",
        windSpeed: 36,
        windDirection: 0,
      });
      const start = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
      const scheme = new Cesium.GeographicTilingScheme();
      class BoundedRelief extends Cesium.CustomHeightmapTerrainProvider {
        getLevelMaximumGeometricError(level) {
          return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
        }
      }
      window.__terrainShadow = {
        async settle(base) {
          const size = 33;
          viewer.terrainProvider = new BoundedRelief({
            tilingScheme: scheme,
            width: size,
            height: size,
            callback(x, y, level) {
              const rectangle = scheme.tileXYToRectangle(x, y, level);
              const heights = new Float32Array(size * size);
              for (let i = 0; i < heights.length; i++) {
                const lon =
                  rectangle.west + (rectangle.width * (i % size)) / (size - 1);
                const lat =
                  rectangle.north -
                  (rectangle.height * Math.floor(i / size)) / (size - 1);
                heights[i] =
                  base + 250 * Math.sin(lon * 800) * Math.cos(lat * 800);
              }
              return heights;
            },
          });
          await window.__m1.settle({
            longitude: 0,
            latitude: 0,
            height: base + 1200,
            heading: 90,
            pitch: -26,
          });
          const picks = [];
          for (const [x, y] of [
            [159, 90],
            [160, 90],
            [100, 45],
            [220, 135],
          ]) {
            const ray = viewer.camera.getPickRay(
              new Cesium.Cartesian2(x + 0.5, y + 0.5),
            );
            const hit = scene.globe.pick(ray, scene);
            if (!hit) {
              throw new Error("receiver must be a real terrain mesh");
            }
            const location = scene.globe.ellipsoid.cartesianToCartographic(hit);
            const draw = scene._renderer._draws.find(({ tile }) =>
              Cesium.Rectangle.contains(tile.rectangle, location),
            );
            picks.push({
              x,
              y,
              height: location.height,
              tile: [draw.tile.level, draw.tile.x, draw.tile.y],
            });
          }
          return picks;
        },
        capture({ seconds, coverage, show, lighting, air, save }) {
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
            start,
            seconds,
            new Cesium.JulianDate(),
          );
          Object.assign(scene.clouds, { coverage, show });
          scene.globe.enableLighting = lighting;
          scene.atmosphere.show = air;
          const images = [
            [false, false],
            [true, false],
            [true, true],
          ].map(([shadows, ambientShadows]) => {
            Object.assign(scene.clouds, { shadows, ambientShadows });
            return pixels();
          });
          const { width, height } = images[0];
          const difference = (from, to) => {
            let darker = 0,
              brighter = 0,
              maximum = 0;
            const mask = [];
            for (let i = 0; i < from.data.length; i += 4) {
              const deltas = [0, 1, 2].map(
                (c) => from.data[i + c] - to.data[i + c],
              );
              if (Math.max(...deltas) > 0) {
                darker++;
              }
              if (Math.min(...deltas) < 0) {
                brighter++;
              }
              maximum = Math.max(maximum, ...deltas);
              mask.push(deltas[0]);
            }
            const seams = [],
              neighbors = [];
            // East-facing camera: the equator falls between the two center columns.
            for (let y = 0; y < height; y++) {
              const mid = y * width + width / 2;
              seams.push(Math.abs(mask[mid] - mask[mid - 1]));
              for (const offset of [-3, -2, -1, 1, 2, 3]) {
                neighbors.push(
                  Math.abs(mask[mid + offset] - mask[mid + offset - 1]),
                );
              }
            }
            const p95 = (a) =>
              a.sort((a, b) => a - b)[Math.floor(a.length * 0.95)];
            return {
              darker,
              brighter,
              maximum,
              seamP95: p95(seams),
              neighborP95: p95(neighbors),
              mask,
            };
          };
          const direct = difference(images[0], images[1]);
          const ambient = difference(images[1], images[2]);
          const previous = window.__terrainShadow.initialMask;
          const motion = previous
            ? direct.mask.reduce(
                (a, v, i) => a + Math.abs(v - previous[i]),
                0,
              ) / direct.mask.length
            : 0;
          window.__terrainShadow.initialMask ??= direct.mask;
          delete direct.mask;
          delete ambient.mask;
          const pngs = save
            ? images.map((image) => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                canvas.getContext("2d").putImageData(image, 0, 0);
                return canvas.toDataURL().split(",")[1];
              })
            : [];
          const solarElevation = Cesium.Math.toDegrees(
            Math.asin(scene._planetState.sunDirectionWC.x),
          ); // Local up at the equatorial fixture is +X.
          return { direct, ambient, motion, solarElevation, pngs };
        },
      };
    });
    const settle = (base) =>
      page.evaluate((base) => window.__terrainShadow.settle(base), base);
    const capture = async (name, options = {}) => {
      const { pngs, ...row } = await page.evaluate(
        (options) => window.__terrainShadow.capture(options),
        {
          seconds: 0,
          coverage: 0.78,
          show: true,
          lighting: true,
          air: false,
          save: false,
          ...options,
        },
      );
      for (const [i, png] of pngs.entries()) {
        await writeFile(
          path.join(output, `${name}-${["off", "direct", "both"][i]}.png`),
          Buffer.from(png, "base64"),
        );
      }
      report.scenes.push({ name, ...row });
      return row;
    };
    report.lowPicks = await settle(500);
    assert.notDeepEqual(
      report.lowPicks[0].tile,
      report.lowPicks[1].tile,
      "adjacent center pixels hit separate native tiles",
    );
    const heights = report.lowPicks.map((p) => p.height);
    assert.ok(
      Math.min(...heights) > 200 &&
        Math.max(...heights) - Math.min(...heights) > 10,
      JSON.stringify(heights),
    );
    for (const air of [false, true]) {
      const row = await capture(air ? "day-air" : "day-vacuum", {
        air,
        save: true,
      });
      for (const [name, delta] of Object.entries({
        direct: row.direct,
        ambient: row.ambient,
      })) {
        assert.ok(
          delta.darker > 100 && delta.brighter === 0,
          `${name}: ${JSON.stringify(delta)}`,
        );
        assert.ok(
          delta.seamP95 <= delta.neighborP95 + 2,
          "cloud-shadow signal has a jump across the equatorial tile edge",
        );
      }
    }
    assert.ok((await capture("wind", { seconds: 90 })).motion > 0.5);
    const grazing = await capture("low-sun", {
      seconds: 5.5 * 3600,
      coverage: 1,
    });
    assert.ok(grazing.solarElevation > 0 && grazing.solarElevation < 15);
    assert.ok(grazing.direct.darker > 100 && grazing.direct.brighter === 0);
    assert.equal(grazing.ambient.brighter, 0);
    for (const [name, options] of [
      ["clear", { coverage: 0 }],
      ["hidden", { show: false }],
      ["unlit", { lighting: false }],
    ]) {
      const row = await capture(name, options);
      assert.equal(
        row.direct.darker +
          row.direct.brighter +
          row.ambient.darker +
          row.ambient.brighter,
        0,
        name,
      );
    }
    const night = await capture("night", { seconds: 43200 });
    assert.equal(
      night.direct.darker +
        night.direct.brighter +
        night.ambient.darker +
        night.ambient.brighter,
      0,
    );
    await page.evaluate(() =>
      window.__m1.settle({
        longitude: 0,
        latitude: 0,
        height: 300000,
        pitch: -90,
      }),
    );
    const orbit = await capture("clear-far-orbit", { coverage: 1 });
    assert.equal(
      orbit.direct.darker +
        orbit.direct.brighter +
        orbit.ambient.darker +
        orbit.ambient.brighter,
      0,
    );
    assert.equal(
      await page.evaluate(
        () => window.__m1.viewer.scene._atmosphere._cloudsShown,
      ),
      false,
    );
    report.highPicks = await settle(8000);
    assert.ok(report.highPicks.every((p) => p.height > 7500));
    const high = await capture("above-cloud-top");
    assert.equal(
      high.direct.darker +
        high.direct.brighter +
        high.ambient.darker +
        high.ambient.brighter,
      0,
      "a receiver above the entire cloud layer must see clear sky even when its ellipsoid footprint is shadowed",
    );
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "Native relief meshes, tile-edge continuity, direct/ambient separation, moving clouds, controls and above-cloud terrain clearance",
    );
    report.cleanup = await destroyM1Scene(page);
  },
);
