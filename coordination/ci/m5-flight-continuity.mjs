/* global document, window, Cesium */
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

process.env.M1_OUTPUT ??= "Build/m5-flight-continuity";
await runM1BrowserSuite("m5-flight-continuity", async (args) => {
  const { page, report, output } = args;
  await openReferenceDemo(args);
  await selectReferenceScene(page, "rapid-motion");
  // Capture the submitted canvas once per actual demo pose. Calling render
  // from postRender would submit a second frame and mask a one-frame flash.
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const viewer = window.__referenceViewer;
        const frameLabel = document.querySelector("#frame");
        const canvas = document.createElement("canvas");
        canvas.width = viewer.canvas.width;
        canvas.height = viewer.canvas.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const frames = [];
        let previous;
        const remove = viewer.scene.postRender.addEventListener(() => {
          const index = Number(frameLabel.dataset.frame);
          if (frames.at(-1)?.index === index) {
            return;
          }
          ctx.drawImage(viewer.canvas, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let luminance = 0;
          let change = 0;
          for (let i = 0; i < data.length; i += 4) {
            luminance +=
              0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            if (previous) {
              change += Math.max(
                Math.abs(data[i] - previous[i]),
                Math.abs(data[i + 1] - previous[i + 1]),
                Math.abs(data[i + 2] - previous[i + 2]),
              );
            }
          }
          const pixels = data.length / 4;
          frames.push({
            index,
            height: viewer.camera.positionCartographic.height,
            longitude: viewer.camera.positionCartographic.longitude,
            latitude: viewer.camera.positionCartographic.latitude,
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            utc: Cesium.JulianDate.toIso8601(viewer.scene._frameState.time),
            luminance: luminance / pixels,
            change: change / pixels,
            png: canvas.toDataURL().split(",")[1],
          });
          previous = data;
          if (index === Number(frameLabel.dataset.lastFrame)) {
            remove();
            resolve(frames);
          }
        });
        document.querySelector("#replay").click();
      }),
  );
  const extreme = frames.reduce((a, b) => (a.change > b.change ? a : b));
  report.strongestPair = [extreme.index - 1, extreme.index];
  for (const { png, ...row } of frames) {
    if (report.strongestPair.includes(row.index) || row.index % 10 === 0) {
      row.image = `flight-${row.index}.png`;
      await writeFile(path.join(output, row.image), Buffer.from(png, "base64"));
    }
    report.scenes.push(row);
  }
  // A large difference between two widely spaced poses can be ordinary motion
  // through a cloud. Resolve the strongest pair in both height and time.
  report.substeps = await page.evaluate(
    ([a, b]) => {
      const viewer = window.__referenceViewer;
      const start = Cesium.JulianDate.fromIso8601(a.utc);
      let previous;
      const steps = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const lerp = (x, y) => Cesium.Math.lerp(x, y, t);
        const height = a.height * (b.height / a.height) ** t;
        viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
          start,
          t,
          new Cesium.JulianDate(),
        );
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromRadians(
            lerp(a.longitude, b.longitude),
            lerp(a.latitude, b.latitude),
            height,
          ),
          orientation: {
            heading: lerp(a.heading, b.heading),
            pitch: lerp(a.pitch, b.pitch),
            roll: 0,
          },
        });
        const { data } = window.__referenceCapture();
        if (previous) {
          let difference = 0;
          for (let j = 0; j < data.length; j += 4) {
            difference += Math.max(
              Math.abs(data[j] - previous[j]),
              Math.abs(data[j + 1] - previous[j + 1]),
              Math.abs(data[j + 2] - previous[j + 2]),
            );
          }
          steps.push({ t, height, meanChange: (4 * difference) / data.length });
        }
        previous = data;
      }
      return steps;
    },
    report.strongestPair.map((index) => report.scenes[index]),
  );
  assert.ok(
    report.substeps.every((step) => step.meanChange < 6),
    "A 1/64-second movement within the largest pose change still produces a broad color jump",
  );
  assert.equal(frames.length, 61);
  for (let i = 1; i < frames.length; i++) {
    assert.equal(frames[i].index, i);
    assert.ok(frames[i].height < frames[i - 1].height);
    assert.equal(
      Date.parse(frames[i].utc) - Date.parse(frames[i - 1].utc),
      1000,
    );
    if (i < frames.length - 1) {
      const current = frames[i].luminance;
      const before = current - frames[i - 1].luminance;
      const after = current - frames[i + 1].luminance;
      assert.ok(
        before * after <= 0 || Math.min(Math.abs(before), Math.abs(after)) < 10,
        `Transient whole-frame brightness change at pose ${i}: ${before}, ${after}`,
      );
    }
  }
  assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
  assert.deepEqual(report.browserConsole, []);
  report.checks.push(
    "Combined height and time replay, adjacent-frame RGB changes and one-pose brightness reversals.",
  );
});
