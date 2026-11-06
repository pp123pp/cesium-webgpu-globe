/* global Cesium, window, document */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runM1BrowserSuite } from "./m1-browser-harness.mjs";
import {
  openReferenceDemo,
  scenes,
  selectReferenceScene,
  settleReferenceScene,
} from "./m5-reference-harness.mjs";

const channels = [
  "display",
  "sky",
  "clouds",
  "aerialPerspective",
  "terrainLight",
  "cirrus",
];
const shellBoundaries = [2000, 6000, 9000, 11000, 80000, 100000, 250000];

function sampleHeights(slug, center) {
  const heights = new Set(
    [-0.04, -0.02, 0, 0.02, 0.04].map((offset) =>
      Math.round(center * (1 + offset)),
    ),
  );
  if (slug === "inside-cloud") {
    for (let h = 1200; h < 320000; h *= 1.08) {
      heights.add(Math.round(h));
    }
    heights.add(320000);
    for (const limit of shellBoundaries) {
      for (const offset of [-50, -1, 0, 1, 50]) {
        heights.add(limit + offset);
      }
    }
  } else if (slug === "orbit-day") {
    for (let h = 320000; h < center; h *= 1.15) {
      heights.add(Math.round(h));
    }
  } else if (slug === "twilight") {
    for (let h = 9000; h <= 11000; h += 250) {
      heights.add(h);
    }
    for (const h of [9000, 11000]) {
      for (const offset of [-50, -1, 1, 50]) {
        heights.add(h + offset);
      }
    }
  }
  return [...heights].sort((a, b) => a - b);
}

async function capture(page, anchor, height) {
  await page.evaluate(
    ({ anchor, height }) => {
      const { camera } = window.__referenceViewer;
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
          anchor.longitude,
          anchor.latitude,
          height,
        ),
        orientation: {
          heading: anchor.heading,
          pitch: anchor.pitch,
          roll: anchor.roll,
        },
      });
    },
    { anchor, height },
  );
  await settleReferenceScene(page);
  const result = await page.evaluate(() => {
    const { scene, camera, canvas } = window.__referenceViewer;
    const initial = window.__referenceCapture();
    const copy = document.createElement("canvas");
    copy.width = initial.width;
    copy.height = initial.height;
    copy.getContext("2d").putImageData(initial, 0, 0);
    const png = copy.toDataURL().split(",")[1];
    const shown = scene.clouds.show;
    const lit = scene.globe.enableLighting;
    const air = scene.atmosphere.show;
    const cloudPass = scene._atmosphere._cloudsShown;
    let noCirrus;
    if (scene.clouds.cirrus) {
      scene.clouds.cirrus = false;
      noCirrus = window.__referenceCapture();
      scene.clouds.cirrus = true;
    }
    scene.clouds.show = false;
    const clear = window.__referenceCapture();
    scene.globe.enableLighting = false;
    const unlit = window.__referenceCapture();
    scene.atmosphere.show = false;
    const vacuum = window.__referenceCapture();
    scene.atmosphere.show = air;
    scene.globe.enableLighting = lit;
    scene.clouds.show = shown;
    const grid = [];
    const signals = [[], [], [], [], [], []];
    for (let y = 4; y < initial.height - 3; y += 8) {
      for (let x = 4; x < initial.width - 3; x += 8) {
        const ray = camera.getPickRay(
          new Cesium.Cartesian2(
            (x * canvas.clientWidth) / initial.width,
            (y * canvas.clientHeight) / initial.height,
          ),
        );
        const hit = Cesium.IntersectionTests.rayEllipsoid(
          ray,
          scene.globe.ellipsoid,
        );
        // The same direction can cross the limb as the eye rises. Only compare
        // sky with sky, or surface with surface; keep intersections beyond 20 km for haze.
        const kind = !hit ? 0 : hit.start >= 20000 ? 2 : 1;
        const values = [[], [], [], [], [], []];
        for (let c = 0; c < 3; c++) {
          let image = 0,
            clouds = 0,
            transport = 0,
            lighting = 0,
            cirrus = 0;
          for (let dy = -2; dy < 2; dy++) {
            for (let dx = -2; dx < 2; dx++) {
              const i = 4 * ((y + dy) * initial.width + x + dx) + c;
              image += initial.data[i];
              clouds += initial.data[i] - clear.data[i];
              transport += unlit.data[i] - vacuum.data[i];
              lighting += clear.data[i] - unlit.data[i];
              if (noCirrus) {
                cirrus += initial.data[i] - noCirrus.data[i];
              }
            }
          }
          values[0].push(image / 16);
          values[1].push(transport / 16);
          values[2].push(clouds / 16);
          values[3].push(transport / 16);
          values[4].push(lighting / 16);
          values[5].push(cirrus / 16);
        }
        const active = [
          true,
          kind === 0,
          true,
          kind === 2,
          kind !== 0,
          Boolean(noCirrus),
        ];
        for (let channel = 0; channel < values.length; channel++) {
          if (active[channel]) {
            signals[channel].push(Math.max(...values[channel].map(Math.abs)));
          } else {
            values[channel] = null;
          }
        }
        grid.push(values);
      }
    }
    const stats = scene.debugStatistics;
    return {
      png,
      grid,
      height: camera.positionCartographic.height,
      cloudPass,
      time: Cesium.JulianDate.toIso8601(scene._frameState.time),
      drawLevels: [...new Set(stats.levels)],
      componentMean: signals.map((values) =>
        values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0,
      ),
    };
  });
  assert.ok(
    Math.abs(result.height - height) < 0.1,
    `requested ${height}, rendered ${result.height}`,
  );
  assert.equal(result.time, anchor.time);
  return { ...result, height };
}

function compare(first, second) {
  const metrics = {};
  for (const [index, name] of channels.entries()) {
    const delta = [];
    for (let i = 0; i < first.grid.length; i++) {
      const a = first.grid[i][index],
        b = second.grid[i][index];
      if (!a || !b) {
        continue;
      }
      delta.push(Math.max(...a.map((value, c) => Math.abs(value - b[c]))));
    }
    if (delta.length < 20) {
      continue;
    }
    delta.sort((a, b) => a - b);
    metrics[name] = {
      samples: delta.length,
      mean: delta.reduce((sum, v) => sum + v, 0) / delta.length,
      p95: delta[Math.floor(0.95 * delta.length)],
      fractionOver16: delta.filter((v) => v > 16).length / delta.length,
    };
  }
  return metrics;
}

function needsRefinement(metrics) {
  return Object.values(metrics).some(
    (row) => row.mean > 6 || row.fractionOver16 > 0.12,
  );
}

async function runSweep(page, output, report, slug) {
  await selectReferenceScene(page, slug);
  const anchor = await page.evaluate(() => {
    const { camera, scene } = window.__referenceViewer;
    const { longitude, latitude, height } = camera.positionCartographic;
    return {
      longitude,
      latitude,
      height,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
      time: Cesium.JulianDate.toIso8601(scene._frameState.time),
    };
  });
  const rows = {
    slug,
    anchor,
    captures: [],
    pairs: [],
    worst: {},
    thresholdPairs: {},
  };
  report.scenes.push(rows);
  if (slug === "terrain-shadow") {
    rows.sources = await page.evaluate(() => {
      const { scene } = window.__referenceViewer;
      const meshes = scene._renderer._draws.map(
        ({ tile }) => tile.data.renderedMesh,
      );
      return {
        status: { ...document.getElementById("source").dataset },
        provider: scene.terrainProvider.constructor.name,
        imageryDrawCalls: scene.debugStatistics.resources.imageryDrawCalls,
        minHeight: Math.min(...meshes.map((mesh) => mesh.minimumHeight)),
        maxHeight: Math.max(...meshes.map((mesh) => mesh.maximumHeight)),
      };
    });
    assert.equal(rows.sources.status.terrain, "live");
    assert.equal(rows.sources.status.imagery, "live");
    assert.equal(rows.sources.provider, "ArcGISTiledElevationTerrainProvider");
    assert.ok(
      rows.sources.imageryDrawCalls > 0 &&
        rows.sources.maxHeight - rows.sources.minHeight > 30,
    );
  }
  const evidence = new Map();
  const record = async (height) => {
    const shot = await capture(page, anchor, height);
    rows.captures.push({
      height,
      cloudPass: shot.cloudPass,
      drawLevels: shot.drawLevels,
      componentMean: shot.componentMean,
    });
    return shot;
  };
  async function measure(a, b) {
    const metrics = compare(a, b);
    const pair = { from: a.height, to: b.height, metrics };
    if (needsRefinement(metrics)) {
      if (b.height - a.height <= 1) {
        await writeFile(
          path.join(output, `${slug}-jump-from.png`),
          Buffer.from(a.png, "base64"),
        );
        await writeFile(
          path.join(output, `${slug}-jump-to.png`),
          Buffer.from(b.png, "base64"),
        );
        rows.failure = pair;
        throw new Error(
          `Persistent one-meter altitude discontinuity: ${slug} ${JSON.stringify(pair)}`,
        );
      }
      const mid = await record(Math.floor((a.height + b.height) / 2));
      await measure(a, mid);
      await measure(mid, b);
      return;
    }
    rows.pairs.push(pair);
    for (const [name, value] of Object.entries(metrics)) {
      if (!rows.worst[name] || rows.worst[name].mean < value.mean) {
        rows.worst[name] = { from: a.height, to: b.height, ...value };
        evidence.set(name, [a.png, b.png]);
      }
    }
    if (
      (slug === "inside-cloud" || slug === "twilight") &&
      shellBoundaries.includes(b.height) &&
      b.height - a.height === 1
    ) {
      rows.thresholdPairs[b.height] = pair;
      if (b.height === 250000 || b.height === 2000 || slug === "twilight") {
        evidence.set(`boundary-${b.height}`, [a.png, b.png]);
      }
    }
  }
  let previous, center;
  for (const h of sampleHeights(slug, anchor.height)) {
    const shot = await record(h);
    if (h === Math.round(anchor.height)) {
      center = shot;
    }
    if (previous) {
      await measure(previous, shot);
    }
    previous = shot;
  }
  const revisit = await capture(page, anchor, center.height);
  rows.revisit = {
    height: center.height,
    samePng: center.png === revisit.png,
    metrics: compare(center, revisit),
    originalDrawLevels: center.drawLevels,
    revisitDrawLevels: revisit.drawLevels,
  };
  if (!rows.revisit.samePng) {
    evidence.set("revisit", [center.png, revisit.png]);
  }
  for (const [name, pair] of evidence) {
    for (const [i, png] of pair.entries()) {
      await writeFile(
        path.join(output, `${slug}-${name}-${i ? "to" : "from"}.png`),
        Buffer.from(png, "base64"),
      );
    }
  }
  rows.captures.sort((a, b) => a.height - b.height);
  assert.ok(
    !needsRefinement(rows.revisit.metrics),
    `Revisiting the same pose changed the settled image: ${slug} ${JSON.stringify(rows.revisit)}`,
  );
  return rows;
}

const selectedScene = process.env.M5_ALTITUDE_SCENE;
if (selectedScene) {
  assert.ok(scenes.includes(selectedScene), "Unknown reference scene");
}
const suite = selectedScene
  ? `m5-altitude-continuity-${selectedScene}`
  : "m5-altitude-continuity";
process.env.M1_OUTPUT ??= `Build/${suite}`;
await runM1BrowserSuite(suite, async ({ page, report, output, base }) => {
  await openReferenceDemo({ page, report, base });
  if (!(await page.locator("#scene").isVisible())) {
    await page.locator("summary").click();
  }
  report.measurement = {
    channels,
    region:
      "4x4 box RGB samples every eight screen pixels. Ellipsoid miss for sky, intersection at 20 km or farther for aerial perspective, all surface hits for terrain lighting.",
    controls:
      "display = original, cloud = original minus no clouds, transport = unlit surface/sky with atmosphere minus its vacuum result, terrain light = clear lit minus clear unlit, cirrus = original minus the same cloud field with only its high deck disabled.",
    refinement:
      "Bisect any adjacent pair with a component mean over six RGB codes, or over 12% of common blocks changing by more than 16 codes. Persistent signals at one meter fail with both native images.",
  };
  for (const slug of selectedScene ? [selectedScene] : scenes) {
    await runSweep(page, output, report, slug);
  }
  for (let i = 1; !selectedScene && i < channels.length; i++) {
    assert.ok(
      report.scenes.some((row) =>
        row.captures.some((shot) => shot.componentMean[i] > 1),
      ),
      `missing measurable ${channels[i]} response`,
    );
  }
  const inside = report.scenes.find((row) => row.slug === "inside-cloud");
  if (inside) {
    assert.equal(
      Object.keys(inside.thresholdPairs).length,
      shellBoundaries.length,
    );
  }
  const twilight = report.scenes.find((row) => row.slug === "twilight");
  if (twilight) {
    assert.ok(
      twilight.captures.some(
        (row) => row.componentMean[channels.indexOf("cirrus")] > 1,
      ),
      "twilight must contain measurable high-deck imagery",
    );
    assert.deepEqual(Object.keys(twilight.thresholdPairs), ["9000", "11000"]);
  }
  assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
  assert.deepEqual(report.browserConsole, []);
  report.checks.push(
    `${report.scenes.length} fixed-time reference altitude sweeps with paired physical output, layer controls and one-meter boundary refinement`,
  );
});
