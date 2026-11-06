/* global Cesium, window, document */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  destroyM1Scene,
  installM1Scene,
  runM1BrowserSuite,
} from "./m1-browser-harness.mjs";
import { assertPhysicalGpu, classifyGpu } from "./m0-browser-config.mjs";

process.env.M1_OUTPUT ??= "Build/m4-altitude-continuity";
await runM1BrowserSuite(
  "m4-altitude-continuity",
  async ({ page, report, output }) => {
    await page.setViewportSize({ width: 320, height: 180 });
    await installM1Scene(page, { baseLayer: false });
    assertPhysicalGpu(
      classifyGpu(await page.evaluate(() => window.__m1.adapterInfo)),
      report.configuration,
    );
    await page.evaluate(() => {
      const { viewer } = window.__m1;
      const { scene } = viewer;
      class BoundedPlateau extends Cesium.CustomHeightmapTerrainProvider {
        getLevelMaximumGeometricError(level) {
          return level >= 8 ? 0 : super.getLevelMaximumGeometricError(level);
        }
      }
      viewer.terrainProvider = new BoundedPlateau({
        width: 17,
        height: 17,
        callback: () => new Float32Array(17 * 17).fill(400),
      });
      scene.globe.baseColor = new Cesium.Color(0.45, 0.45, 0.45, 1);
      scene.globe.enableLighting = true;
      scene.screenSpaceCameraController.enableCollisionDetection = false;
      scene.atmosphere.show = true;
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(
        "2026-03-20T12:00:00Z",
      );
      Object.assign(scene.clouds, {
        show: true,
        coverage: 0.78,
        quality: "low",
        windSpeed: 0,
        evolution: false,
        mist: false,
        ambientShadows: true,
      });
    });
    // The equator/prime-meridian intersection is a shared terrain tile vertex.
    const anchor = { longitude: 0.013, latitude: 0.017 };
    async function capture(height, footprint, name) {
      const { pngs, ...row } = await page.evaluate(
        async ({ height, footprint, anchor }) => {
          const { viewer, settle, pixels } = window.__m1;
          const { scene, camera } = viewer;
          // At altitude, a constant FOV moves each pixel onto different terrain.
          // The second series holds a 20 km ground patch at the fixed anchor.
          camera.frustum.fov = footprint
            ? 2 * Math.atan(10000 / (height - 400))
            : Math.PI / 3;
          await settle({ ...anchor, height, pitch: -90 });
          const center = new Cesium.Cartesian2(
            viewer.canvas.clientWidth / 2,
            viewer.canvas.clientHeight / 2,
          );
          const hit = scene.globe.pick(camera.getPickRay(center), scene);
          if (!hit) {
            throw new Error(
              `No terrain intersection at the image center at ${height} m`,
            );
          }
          const receiver = scene.globe.ellipsoid.cartesianToCartographic(hit);
          const images = [false, true].map((enabled) => {
            scene.clouds.shadows = enabled;
            return pixels();
          });
          const [off, on] = images;
          let darker = 0,
            brighter = 0,
            sum = 0,
            maximum = 0,
            lit = 0;
          for (let i = 0; i < off.data.length; i += 4) {
            const r = off.data[i] - on.data[i];
            const g = off.data[i + 1] - on.data[i + 1];
            const b = off.data[i + 2] - on.data[i + 2];
            darker += Number(Math.max(r, g, b) > 0);
            brighter += Number(Math.min(r, g, b) < 0);
            sum += (r + g + b) / 3;
            maximum = Math.max(maximum, r, g, b);
            lit += Number(off.data[i] > 15);
          }
          const pngs = images.map((image) => {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d").putImageData(image, 0, 0);
            return canvas.toDataURL().split(",")[1];
          });
          return {
            height,
            fov: camera.frustum.fov,
            cloudsShown: scene._atmosphere._cloudsShown,
            receiver: [
              Cesium.Math.toDegrees(receiver.longitude),
              Cesium.Math.toDegrees(receiver.latitude),
              receiver.height,
            ],
            darker,
            brighter,
            maximum,
            mean: sum / (off.width * off.height),
            lit,
            pngs,
          };
        },
        { height, footprint, anchor },
      );
      report.scenes.push({ name, ...row });
      for (const [i, png] of pngs.entries()) {
        await writeFile(
          path.join(output, `${name}-${i === 0 ? "off" : "on"}.png`),
          Buffer.from(png, "base64"),
        );
      }
      assert.ok(row.lit > 100, `${name}: ground visible`);
      assert.ok(
        Math.abs(row.receiver[0] - anchor.longitude) < 0.0001 &&
          Math.abs(row.receiver[1] - anchor.latitude) < 0.0001 &&
          Math.abs(row.receiver[2] - 400) < 50,
        `${name}: fixed terrain receiver ${row.receiver}`,
      );
      assert.equal(
        row.brighter,
        0,
        `${name}: cloud shadows must not brighten terrain`,
      );
      if (height >= 250000) {
        assert.equal(row.cloudsShown, false, name);
        assert.equal(row.darker, 0, `${name}: far-orbit shadows neutral`);
      }
      return row;
    }
    for (const height of [
      1800, 4000, 12000, 80000, 160000, 245000, 250000, 300000, 4500000,
    ]) {
      const row = await capture(height, false, `view-${height}`);
      if (height === 1800) {
        assert.ok(row.darker > 100, "near-ground shadow visible");
      }
    }
    const rows = [];
    for (const height of [
      80000, 100000, 125000, 150000, 175000, 200000, 225000, 245000, 250000,
    ]) {
      rows.push(await capture(height, true, `patch-${height}`));
    }
    const peak = Math.max(...rows.map((row) => row.mean));
    assert.ok(
      peak > 1 && rows[0].mean > 0,
      "terrain shadows measurable at start of fade",
    );
    assert.ok(
      rows.some(
        (row) =>
          row.height > 80000 &&
          row.mean > 0.05 * peak &&
          row.mean < 0.75 * peak,
      ),
      "measured intermediate attenuation",
    );
    assert.ok(
      rows.at(-2).maximum <= 2,
      "shadow signal must approach zero before the orbital cutoff",
    );
    const revisit = await capture(80000, true, "patch-80000-return");
    assert.ok(
      Math.abs(revisit.mean - rows[0].mean) <= 0.1,
      "same ground footprint on descent",
    );
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    assert.deepEqual(report.browserConsole, []);
    report.checks.push(
      "Fixed-time paired cloud-shadow images from ground through orbit; fixed 20 km footprint across the fade, including an 80 km revisit.",
    );
    report.cleanup = await destroyM1Scene(page);
  },
);
