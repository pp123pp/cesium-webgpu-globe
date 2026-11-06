/* global Cesium, document, window, ImageData, console */
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
} from "./m5-reference-harness.mjs";

process.env.M1_OUTPUT ??= "Build/m5-time-continuity";

// Run inside Chromium so the comparisons use the actual submitted framebuffer.
function sweep({
  name,
  center,
  step,
  half,
  terrain,
  distantTerrain,
  frozenInterior,
  evolution,
}) {
  const viewer = window.__referenceViewer;
  const { scene, camera } = viewer;
  const { clouds } = scene;
  const initialStars = scene.stars.show;
  const initialLighting = scene.globe.enableLighting;
  const initialAir = scene.atmosphere.show;
  const initial = Cesium.JulianDate.clone(viewer.clock.currentTime);
  const prior = {
    show: clouds.show,
    shadows: clouds.shadows,
    ambientShadows: clouds.ambientShadows,
    windSpeed: clouds.windSpeed,
    evolution: clouds.evolution,
  };
  const add = (date, seconds) =>
    Cesium.JulianDate.addSeconds(date, seconds, new Cesium.JulianDate());
  const iso = (date) => Cesium.JulianDate.toIso8601(date, 3);
  const scaled = scene.globe.ellipsoid.transformPositionToScaledSpace(
    camera.positionWC,
  );
  const horizonMu = -Math.sqrt(
    1 - 1 / Cesium.Cartesian3.magnitudeSquared(scaled),
  );
  const unitUp = Cesium.Cartesian3.normalize(scaled, new Cesium.Cartesian3());
  function clearance(date) {
    const sun = Cesium.WebGPUPlanetMath.computeSunDirectionWC(date);
    const scaledSun = scene.globe.ellipsoid.transformPositionToScaledSpace(sun);
    Cesium.Cartesian3.normalize(scaledSun, scaledSun);
    return Cesium.Cartesian3.dot(scaledSun, unitUp) - horizonMu;
  }
  let anchor = initial;
  if (["rise", "set", "cloud-cutoff", "golden-sunset"].includes(center)) {
    const rising = center === "rise";
    const start = Cesium.JulianDate.fromIso8601(
      center === "golden-sunset"
        ? "2026-03-21T01:00:00Z"
        : rising
          ? "2026-03-20T05:00:00Z"
          : "2026-03-20T17:00:00Z",
    );
    const target =
      center === "golden-sunset"
        ? -horizonMu
        : center === "cloud-cutoff"
          ? -scene.sun.angularRadius
          : 0;
    let lo = 0,
      hi = 7200;
    if (
      clearance(start) < target !== rising ||
      clearance(add(start, hi)) > target !== rising
    ) {
      throw new Error("Solar limb crossing is not bracketed");
    }
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (clearance(add(start, mid)) < target === rising) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    anchor = add(start, (lo + hi) / 2);
  } else if (center === "phase") {
    anchor = add(initial, 180 - (initial.secondsOfDay % 180));
  } else if (center === "julian-day") {
    anchor = add(initial, -initial.secondsOfDay);
  } else if (center === "midnight") {
    anchor = Cesium.JulianDate.fromIso8601("2026-03-21T00:00:00Z");
  }
  const images = {};
  const frames = new Map();
  const save = (key, pixels) => {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.getContext("2d").putImageData(pixels, 0, 0);
    images[key] = canvas.toDataURL().split(",")[1];
  };
  // In this fixed camera isolate distant terrain, where the atmosphere acts
  // on the drawn surface color. Sky pixels have no such receiver.
  let distant;
  function distantColors(image) {
    const { width, height } = image;
    if (!distant) {
      distant = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const ray = camera.getPickRay(
            new Cesium.Cartesian2(
              ((x + 0.5) * viewer.canvas.clientWidth) / width,
              ((y + 0.5) * viewer.canvas.clientHeight) / height,
            ),
          );
          const hit = Cesium.IntersectionTests.rayEllipsoid(
            ray,
            scene.globe.ellipsoid,
          );
          distant[y * width + x] = Number(hit && hit.start > 20000);
        }
      }
    }
    const masked = new ImageData(width, height);
    for (let p = 0; p < distant.length; p++) {
      if (distant[p]) {
        masked.data.set(image.data.subarray(p * 4, p * 4 + 3), p * 4);
      }
      masked.data[p * 4 + 3] = 255;
    }
    return masked;
  }
  const terms = terrain ? ["color", "direct", "ambient"] : ["color"];
  function mask(lighter, darker) {
    const data = new Uint8ClampedArray(lighter.data.length);
    let illuminated = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        data[i + c] = lighter.data[i + c] - darker.data[i + c];
      }
      data[i + 3] = 255;
      if (data[i] || data[i + 1] || data[i + 2]) {
        illuminated++;
      }
    }
    return {
      image: new ImageData(data, lighter.width, lighter.height),
      illuminated,
    };
  }
  function render(offset) {
    viewer.clock.currentTime = add(anchor, offset);
    const rendered = window.__referenceCapture();
    const color = distantTerrain ? distantColors(rendered) : rendered;
    const time = scene._planetState.time;
    if (!Cesium.JulianDate.equals(time, viewer.clock.currentTime)) {
      throw new Error("Renderer clock differs from requested UTC");
    }
    const result = { color, time: iso(time), clearance: clearance(time) };
    if (center === "wind-angle") {
      result.windAngle = scene._atmosphere._cloudVolume.values[25];
    }
    if (terrain) {
      clouds.ambientShadows = false;
      const directOnly = window.__referenceCapture();
      clouds.shadows = false;
      const off = window.__referenceCapture();
      clouds.shadows = true;
      clouds.ambientShadows = true;
      const direct = mask(off, directOnly),
        ambient = mask(directOnly, color);
      Object.assign(result, {
        direct: direct.image,
        ambient: ambient.image,
        directPixels: direct.illuminated,
        ambientPixels: ambient.illuminated,
      });
    }
    return result;
  }
  function frame(offset) {
    if (!frames.has(offset)) {
      frames.set(offset, render(offset));
    }
    return frames.get(offset);
  }
  function delta(first, second) {
    const { width, height } = first;
    const columns = Math.ceil(width / 8);
    const tiles = new Float32Array(columns * Math.ceil(height / 8));
    let total = 0,
      large = 0,
      maximum = 0,
      brightestPixel = 0;
    for (let i = 0; i < first.data.length; i += 4) {
      let difference = 0;
      for (let c = 0; c < 3; c++) {
        difference = Math.max(
          difference,
          Math.abs(first.data[i + c] - second.data[i + c]),
        );
      }
      const pixel = i / 4;
      tiles[
        Math.floor(pixel / width / 8) * columns +
          Math.floor((pixel % width) / 8)
      ] += difference;
      total += difference;
      if (difference >= 16) {
        large++;
      }
      if (difference > maximum) {
        maximum = difference;
        brightestPixel = pixel;
      }
    }
    const mean = total / (width * height),
      area = large / (width * height);
    const local = Math.max(...tiles) / 64;
    return {
      mean,
      area,
      local,
      maximum,
      peakPixel: [brightestPixel % width, Math.floor(brightestPixel / width)],
      score: Math.max(mean / 0.8, area / 0.005, local / 24),
    };
  }
  function interval(a, b, term) {
    return { a, b, ...delta(frame(a)[term], frame(b)[term]) };
  }
  function refine(coarse, term) {
    let peak = coarse;
    while (peak.b - peak.a > 0.125) {
      const mid = (peak.a + peak.b) / 2;
      const left = interval(peak.a, mid, term),
        right = interval(mid, peak.b, term);
      peak = left.score >= right.score ? left : right;
    }
    const dt = peak.b - peak.a;
    const before = interval(peak.a - dt, peak.a, term),
      after = interval(peak.b, peak.b + dt, term);
    const localized =
      peak.score >= 1 &&
      peak.score >= 2 * Math.max(0.1, before.score, after.score);
    return { coarse, peak, before, after, localized };
  }
  try {
    if (distantTerrain) {
      clouds.show = false;
      scene.globe.enableLighting = false;
    }
    const epoch = new Cesium.JulianDate(2451545, 0, Cesium.TimeStandard.TAI);
    const circumference = 2 * Math.PI * scene.globe.ellipsoid.maximumRadius;
    const elapsed = Cesium.JulianDate.secondsDifference(anchor, epoch);
    if (center === "wind-angle") {
      // Put an integral wind revolution at this daylight reference instant.
      clouds.windSpeed =
        (Math.round((elapsed * prior.windSpeed) / circumference) *
          circumference) /
        elapsed;
    }
    if (frozenInterior) {
      // Preserve the accepted midday cloud bank at sunset; zero wind changes
      // its absolute advection phase and can leave the camera in an opening.
      const referenceOffset =
        (Cesium.JulianDate.secondsDifference(initial, epoch) *
          prior.windSpeed) %
        circumference;
      clouds.windSpeed = referenceOffset / elapsed;
      scene.stars.show = false;
    }
    if (evolution) {
      clouds.evolution = true;
    }
    const middle = frame(0);
    const repeat = delta(middle.color, render(0).color);
    save(name, middle.color);
    const offsets = [...Array(2 * half + 1).keys()].map(
      (i) => (i - half) * step,
    );
    const samples = offsets.map((offset) => {
      const sample = frame(offset);
      return {
        offset,
        utc: sample.time,
        clearance: sample.clearance,
        directPixels: sample.directPixels,
        ambientPixels: sample.ambientPixels,
        windAngle: sample.windAngle,
      };
    });
    const analysis = {};
    for (const term of terms) {
      const adjacent = offsets
        .slice(1)
        .map((offset, i) => interval(offsets[i], offset, term));
      const candidates = [...adjacent].sort((a, b) => b.score - a.score);
      const examined = candidates
        .filter((row, i) => i === 0 || row.score >= 1)
        .map((row) => refine(row, term));
      for (const [i, row] of examined.entries()) {
        if (row.peak.score >= 1) {
          save(`${name}-${term}-${i}-before`, frame(row.peak.a)[term]);
          save(`${name}-${term}-${i}-after`, frame(row.peak.b)[term]);
        }
      }
      analysis[term] = { adjacent, examined };
    }
    let cutoffControls;
    if (center === "cloud-cutoff") {
      clouds.show = false;
      const cloudSignal = delta(middle.color, render(0).color);
      clouds.show = true;
      const peak = [...analysis.color.examined].sort(
        (left, right) => right.peak.maximum - left.peak.maximum,
      )[0].peak;
      const [x, y] = peak.peakPixel;
      const index = 4 * (y * middle.color.width + x);
      const pixelDifference = (a, b) =>
        Math.max(
          ...[0, 1, 2].map((channel) =>
            Math.abs(
              frame(a).color.data[index + channel] -
                frame(b).color.data[index + channel],
            ),
          ),
        );
      let a = peak.a,
        b = peak.b;
      while (b - a > 0.001) {
        const mid = (a + b) / 2;
        if (pixelDifference(a, mid) >= pixelDifference(mid, b)) {
          b = mid;
        } else {
          a = mid;
        }
      }
      const dt = b - a;
      cutoffControls = {
        peak,
        narrow: {
          a,
          b,
          firstUtc: iso(add(anchor, a)),
          secondUtc: iso(add(anchor, b)),
          dt,
          cloudDelta: pixelDifference(a, b),
          before: pixelDifference(a - dt, a),
          after: pixelDifference(b, b + dt),
        },
        cloudSignal,
        frozenWindSpeed: clouds.windSpeed,
        cases: [],
      };
      for (const [cloud, stars] of [
        [true, true],
        [false, true],
        [true, false],
        [false, false],
      ]) {
        clouds.show = cloud;
        scene.stars.show = stars;
        const first = render(a).color;
        const second = render(b).color;
        cutoffControls.cases.push({
          cloud,
          stars,
          atPeak: [
            Array.from(first.data.slice(index, index + 3)),
            Array.from(second.data.slice(index, index + 3)),
          ],
          difference: delta(first, second),
        });
        if (cloud && !stars) {
          save(`${name}-peak-before`, first);
          save(`${name}-peak-after`, second);
        }
      }
      clouds.show = true;
      scene.stars.show = false;
      // This interval contained the baseline sunset pulse. Keep it fixed for
      // before/after comparisons even when the strongest pixel moves elsewhere.
      const begin = -10 / 128;
      const start = render(begin).color;
      const end = render(0).color;
      const frames60Hz = [];
      let previous = start;
      for (let offset = begin; offset < 0;) {
        offset = Math.min(0, offset + 1 / 60);
        const next = render(offset).color;
        frames60Hz.push({ offset, difference: delta(previous, next) });
        previous = next;
      }
      clouds.show = false;
      const clearStart = render(begin).color;
      const clearEnd = render(0).color;
      clouds.show = true;
      cutoffControls.regression = {
        first: iso(add(anchor, begin)),
        second: iso(anchor),
        color: delta(start, end),
        clear: delta(clearStart, clearEnd),
        frames60Hz,
      };
      save(`${name}-regression-before`, start);
      save(`${name}-regression-after`, end);
    }
    const returned = delta(middle.color, render(0).color);
    let transport;
    if (distantTerrain) {
      scene.atmosphere.show = false;
      const vacuum = render(0).color;
      transport = {
        pixels: distant.reduce((sum, value) => sum + value, 0),
        onOff: delta(middle.color, vacuum),
      };
      save(`${name}-vacuum`, vacuum);
    }
    return {
      name,
      center,
      anchor: iso(anchor),
      samples,
      analysis,
      repeat,
      returned,
      transport,
      cutoffControls,
      renderedTimes: frames.size,
      images,
    };
  } finally {
    Object.assign(clouds, prior);
    scene.stars.show = initialStars;
    scene.atmosphere.show = initialAir;
    scene.globe.enableLighting = initialLighting;
    viewer.clock.currentTime = initial;
  }
}

await runM1BrowserSuite(
  "m5-time-continuity",
  async ({ page, base, output, report }) => {
    await openReferenceDemo({ page, base, report });
    const problems = [];
    const selected = process.env.M5_TIME_CASE;
    for (const slug of scenes) {
      const cases = [
        {
          name: slug,
          center: "preset",
          step: 15,
          half: 4,
          terrain: slug === "terrain-shadow",
        },
      ];
      if (slug === "sunrise" || slug === "twilight") {
        if (slug === "sunrise")
          {cases.push({
            name: "sunrise-distant-air",
            center: "rise",
            step: 45,
            half: 6,
            distantTerrain: true,
          });}
        cases.push({
          name: `${slug}-horizon`,
          center: slug === "sunrise" ? "rise" : "set",
          step: 15,
          half: 6,
        });
      }
      if (slug === "inside-cloud") {
        cases.push(
          {
            name: "cloud-sunset",
            center: "cloud-cutoff",
            step: 10,
            half: 12,
            frozenInterior: true,
          },
          {
            name: "cloud-evolution-wrap",
            center: "phase",
            step: 1,
            half: 4,
            evolution: true,
          },
          { name: "cloud-julian-day", center: "julian-day", step: 1, half: 4 },
          { name: "cloud-wind-wrap", center: "wind-angle", step: 1, half: 4 },
        );
      }
      if (slug === "terrain-shadow") {
        cases.push({
          name: "golden-sunset",
          center: "golden-sunset",
          step: 120,
          half: 10,
          terrain: true,
        });
        cases.push({
          name: "golden-midnight",
          center: "midnight",
          step: 15,
          half: 4,
          terrain: true,
        });
      }
      const activeCases = cases.filter(
        (options) => !selected || options.name === selected,
      );
      if (!activeCases.length) {
        continue;
      }
      await selectReferenceScene(page, slug);
      for (const options of activeCases) {
        const { images, ...result } = await page.evaluate(sweep, options);
        result.scene = slug;
        result.images = Object.keys(images);
        for (const [name, encoded] of Object.entries(images)) {
          await writeFile(
            path.join(output, `${name}.png`),
            Buffer.from(encoded, "base64"),
          );
        }
        report.scenes.push(result);
        if (options.center === "wind-angle") {
          assert.ok(
            result.samples[3].windAngle > 6.28 &&
              result.samples[5].windAngle < 0.001,
            "Production wind angle must straddle a full revolution",
          );
        }
        if (result.cutoffControls) {
          assert.ok(
            result.cutoffControls.cloudSignal.mean > 1,
            "Cloud cutoff needs visible cloud contrast against clear sky.",
          );
          const { narrow, cases, peak } = result.cutoffControls;
          const { color, clear: noCloud } = result.cutoffControls.regression;
          if (color.maximum >= 4 && color.local >= 1 && noCloud.maximum <= 1) {
            problems.push(
              `Cloud-only local pulse at ${result.cutoffControls.regression.first}: peak ${color.maximum}, strongest 8×8 mean ${color.local.toFixed(3)}, clear peak ${noCloud.maximum} in 78.125ms.`,
            );
          }
          const clear = cases.find((row) => !row.cloud && !row.stars);
          const clearDelta = Math.max(
            ...clear.atPeak[0].map((value, index) =>
              Math.abs(value - clear.atPeak[1][index]),
            ),
          );
          if (
            narrow.cloudDelta > 2 &&
            clearDelta <= 1 &&
            narrow.before <= 1 &&
            narrow.after <= 1
          ) {
            problems.push(
              `Cloud-only cutoff: ${narrow.firstUtc} to ${narrow.secondUtc} at (${peak.peakPixel}), ${narrow.cloudDelta}/255 in ${(narrow.dt * 1000).toFixed(3)}ms.`,
            );
          }
        }
        if (result.repeat.maximum || result.returned.maximum) {
          problems.push(`${options.name}: unstable fixed-time image`);
        }
        for (const [term, group] of Object.entries(result.analysis)) {
          for (const item of group.examined.filter(
            (item) => item.peak.score >= 1,
          )) {
            problems.push(
              `${options.name}/${term} ${result.anchor}+${item.peak.a}s to +${item.peak.b}s, score ${item.peak.score.toFixed(2)}, localized=${item.localized}`,
            );
          }
        }
        if (options.distantTerrain) {
          assert.ok(
            result.transport.pixels > 1000 && result.transport.onOff.mean > 1,
            "Far terrain must have measurable atmospheric transport",
          );
        }
        if (options.center === "golden-sunset") {
          const first = result.samples[0],
            last = result.samples.at(-1);
          assert.ok(
            first.directPixels > 0 && first.ambientPixels > 0,
            "The sunlit hillside must receive direct and ambient attenuation before local sunset",
          );
          assert.equal(
            last.directPixels + last.ambientPixels,
            0,
            "Both cloud-shadow controls should be neutral after local sunset",
          );
        } else if (options.terrain) {
          assert.ok(
            result.samples.every(
              (row) => row.directPixels > 0 && row.ambientPixels > 0,
            ),
            `Missing terrain lighting contribution at ${options.name}`,
          );
        }
        console.log(
          options.name,
          result.anchor,
          result.renderedTimes,
          problems.length,
        );
      }
    }
    report.temporalSuspects = problems;
    assert.ok(report.scenes.length > 0, "Requested time case must exist");
    assert.deepEqual(await page.evaluate(() => window.__m1.errors), []);
    assert.deepEqual(
      problems,
      [],
      "Inspect saved fine-step frame pairs before clearing temporal discontinuity",
    );
    report.checks.push(
      selected
        ? `Focused time continuity: ${selected}.`
        : "Eight fixed cameras, solar upper/lower limb transit, cloud sunset and phase/day seams, local direct and ambient lighting masks.",
    );
  },
);
