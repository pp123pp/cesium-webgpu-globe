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

process.env.M1_OUTPUT ??= "Build/m4-ellipsoid-shadows";
await runM1BrowserSuite(
  "m4-ellipsoid-shadows",
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
      class BoundedEllipsoid extends Cesium.EllipsoidTerrainProvider {
        getLevelMaximumGeometricError(level) {
          return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
        }
      }
      viewer.terrainProvider = new BoundedEllipsoid();
      scene.globe.baseColor = new Cesium.Color(0.45, 0.45, 0.45, 1);
      scene.globe.enableLighting = true;
      scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.clock.shouldAnimate = false;
      const start = Cesium.JulianDate.fromIso8601("2026-03-20T12:00:00Z");
      viewer.clock.currentTime = start;
      Object.assign(scene.clouds, {
        show: true,
        coverage: 0.78,
        quality: "low",
        windSpeed: 36,
        windDirection: 0,
        evolution: false,
        mist: false,
      });
      const masks = new Map();
      window.__m4 = {
        capture({ name, seconds, atmosphere, lighting, config, save }) {
          viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
            start,
            seconds,
            new Cesium.JulianDate(),
          );
          scene.atmosphere.show = atmosphere;
          scene.globe.enableLighting = lighting;
          Object.assign(scene.clouds, config);
          const capture = (enabled) => {
            scene.clouds.shadows = enabled;
            const image = pixels();
            if (!save) {
              return { image };
            }
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d").putImageData(image, 0, 0);
            return { image, png: canvas.toDataURL("image/png").split(",")[1] };
          };
          const off = capture(false);
          const on = capture(true);
          const mask = [];
          let darker = 0,
            brighter = 0,
            changed = 0,
            min = Infinity,
            max = -Infinity;
          for (let i = 0; i < off.image.data.length; i += 4) {
            const delta = off.image.data[i] - on.image.data[i];
            mask.push(delta);
            min = Math.min(min, delta);
            max = Math.max(max, delta);
            if (delta > 0) {
              darker++;
            }
            if (delta < 0) {
              brighter++;
            }
            if (
              [0, 1, 2].some(
                (c) => off.image.data[i + c] !== on.image.data[i + c],
              )
            ) {
              changed++;
            }
          }
          masks.set(name, mask);
          return {
            name,
            darker,
            brighter,
            changed,
            min,
            max,
            off: off.png,
            on: on.png,
          };
        },
        distance(a, b) {
          const first = masks.get(a),
            second = masks.get(b);
          return (
            first.reduce(
              (sum, value, i) => sum + Math.abs(value - second[i]),
              0,
            ) / first.length
          );
        },
      };
    });
    const settle = async (longitude) => {
      await page.evaluate(
        (longitude) =>
          window.__m1.settle({
            longitude,
            latitude: 0,
            height: 1800,
            heading: 90,
            pitch: -26,
          }),
        longitude,
      );
    };
    const capture = async (name, options = {}) => {
      const { on, off, ...metrics } = await page.evaluate(
        (options) => window.__m4.capture(options),
        {
          name,
          seconds: 0,
          atmosphere: false,
          lighting: true,
          config: {},
          save: true,
          ...options,
        },
      );
      if (on) {
        await writeFile(
          path.join(output, `${name}-on.png`),
          Buffer.from(on, "base64"),
        );
        await writeFile(
          path.join(output, `${name}-off.png`),
          Buffer.from(off, "base64"),
        );
      }
      report.scenes.push(metrics);
      return metrics;
    };
    const distance = (first, second) =>
      page.evaluate(([a, b]) => window.__m4.distance(a, b), [first, second]);

    // Below the 2 km base and looking down, no visible cloud can darken this image.
    // Use the first varied footprint along a fixed equatorial transect.
    let longitude;
    for (const position of [0, 0.1, -0.1, 0.3, -0.3, 0.7, -0.7, 2, -2, 5, -5]) {
      await settle(position);
      const row = await capture(`sample-${position}`, { save: false });
      if (row.darker > 500 && row.max - row.min >= 5) {
        longitude = position;
        break;
      }
    }
    assert.notEqual(
      longitude,
      undefined,
      "expected a spatially varied cloud shadow on the ellipsoid",
    );
    report.fixture = {
      longitude,
      latitude: 0,
      height: 1800,
      pitch: -26,
      maximumTerrainLevel: 8,
    };
    const initial = await capture("initial");
    assert.equal(
      initial.brighter,
      0,
      "cloud shadows only attenuate the receiver",
    );
    const air = await capture("atmosphere", { atmosphere: true });
    assert.ok(
      air.darker > 500 && air.brighter === 0,
      "ground direct light is also attenuated with atmosphere",
    );
    for (const [name, options] of [
      ["unlit", { lighting: false }],
      ["clear", { config: { coverage: 0 } }],
      ["hidden", { config: { show: false, coverage: 0.78 } }],
    ]) {
      const row = await capture(name, options);
      assert.equal(
        row.changed,
        0,
        `${name} must be identical with shadows on and off`,
      );
    }
    await capture("restored", { config: { show: true } });
    assert.equal(
      await distance("initial", "restored"),
      0,
      "restoring clouds restores the same shadow",
    );
    const seconds = 90;
    await capture("later-fixed", { seconds });
    // M3's zero wind direction advects about the WGS84 polar axis. A translated
    // observer at the equator should see the original geographical footprint.
    const offsetDegrees = (((36 * seconds) / 6378137) * 180) / Math.PI;
    await settle(longitude + offsetDegrees);
    await capture("later-advected", { seconds });
    const fixed = await distance("initial", "later-fixed");
    const advected = await distance("initial", "later-advected");
    report.motion = { seconds, offsetDegrees, fixed, advected };
    assert.ok(fixed > 0.5 && advected < fixed, JSON.stringify(report.motion));
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "paired direct-light attenuation, disabled controls, replay and WGS84 wind advection",
    );
    report.cleanup = await destroyM1Scene(page);
  },
);
