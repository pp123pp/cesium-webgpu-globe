/* global Cesium, window, document */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import {
  openReferenceDemo,
  selectReferenceScene,
} from "./m5-reference-harness.mjs";

process.env.M1_OUTPUT ??= "Build/m5-star-continuity";
await runM1BrowserSuite(
  "m5-star-continuity",
  async ({ page, base, output, report }) => {
    await openReferenceDemo({ page, base, report });
    for (const [slug, start, crossing, pixel] of [
      ["night", "2026-03-03T11:30:12.15625Z", 7, [221, 41]],
      ["inside-cloud", "2026-03-20T18:15:38.1875Z", 4, [141, 2]],
    ]) {
      await selectReferenceScene(page, slug);
      const { images, ...row } = await page.evaluate(
        ({ slug, start, crossing, pixel }) => {
          const viewer = window.__referenceViewer;
          const { scene } = viewer;
          if (slug === "inside-cloud") {
            scene.clouds.windSpeed = 0;
            scene.clouds.evolution = false;
          }
          const initial = Cesium.JulianDate.fromIso8601(start);
          function frame(tick) {
            viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
              initial,
              tick / 64,
              new Cesium.JulianDate(),
            );
            scene.stars.show = false;
            const off = window.__referenceCapture();
            scene.stars.show = true;
            const on = window.__referenceCapture();
            return { on, off };
          }
          function png(image) {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d").putImageData(image, 0, 0);
            return canvas.toDataURL().split(",")[1];
          }
          const samples = [];
          let images,
            crossingRgb,
            worst = -1;
          let previous = frame(0);
          for (let tick = 1; tick <= 12; tick++) {
            const current = frame(tick);
            let maximum = -1,
              control = 0,
              index = 0,
              visible = 0,
              bright = 0,
              brightest = 0;
            const { data, width } = current.on;
            for (let i = 0; i < data.length; i += 4) {
              let difference = 0,
                signal = 0;
              for (let c = 0; c < 3; c++) {
                const j = i + c;
                const now = data[j] - current.off.data[j];
                const before = previous.on.data[j] - previous.off.data[j];
                signal = Math.max(signal, now);
                difference = Math.max(difference, Math.abs(now - before));
                control = Math.max(
                  control,
                  Math.abs(current.off.data[j] - previous.off.data[j]),
                );
              }
              if (signal >= 16) {visible++;}
              if (signal >= 64) {bright++;}
              brightest = Math.max(brightest, signal);
              if (difference > maximum) {
                maximum = difference;
                index = i;
              }
            }
            samples.push({
              tick,
              maximum,
              control,
              visible,
              bright,
              brightest,
              pixel: [(index / 4) % width, Math.floor(index / 4 / width)],
              on: [previous.on, current.on].map((im) =>
                Array.from(im.data.slice(index, index + 3)),
              ),
              off: [previous.off, current.off].map((im) =>
                Array.from(im.data.slice(index, index + 3)),
              ),
            });
            worst = Math.max(worst, maximum);
            if (tick === crossing) {
              const origin = (pixel[1] * width + pixel[0]) * 4;
              crossingRgb = [
                previous.on,
                current.on,
                previous.off,
                current.off,
              ].map((im) => Array.from(im.data.slice(origin, origin + 3)));
              images = [previous.on, current.on, previous.off, current.off].map(
                png,
              );
            }
            previous = current;
          }
          return {
            slug,
            start,
            secondsPerTick: 1 / 64,
            worst,
            crossing,
            pixel,
            crossingRgb,
            samples,
            images,
          };
        },
        { slug, start, crossing, pixel },
      );
      report.scenes.push(row);
      for (const [i, suffix] of [
        "before",
        "after",
        "before-off",
        "after-off",
      ].entries()) {
        await writeFile(
          path.join(output, `${slug}-${suffix}.png`),
          Buffer.from(images[i], "base64"),
        );
      }
    }
    for (const row of report.scenes) {
      // Before the repair, the two cameras resolved 72/57 star pixels, including
      // 47/41 brighter than 64 levels. Require a populated sky and bright cores.
      const night = row.slug === "night";
      assert.ok(
        row.samples.every(
          (s) =>
            s.visible >= (night ? 36 : 28) &&
            s.bright >= 20 &&
            s.brightest >= (night ? 150 : 100),
        ),
        `${row.slug}: resolved bright stars`,
      );
      assert.ok(
        row.worst <= 24,
        `${row.slug}: star contribution changed by ${row.worst} display levels in 1/64 s`,
      );
    }
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    report.checks.push(
      "Actual night and twilight star contributions change continuously over 1/64-second intervals.",
    );
  },
);
