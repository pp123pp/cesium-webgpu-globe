import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import { hash } from "./m2.6.1-b4-fixtures.mjs";

// Offline audit only: baseline-before, candidate, baseline-after, output JSON.
const [beforeDir, candidateDir, afterDir, output] = process.argv.slice(2);
assert.ok(beforeDir && candidateDir && afterDir && output);
const directories = [beforeDir, candidateDir, afterDir];
const reports = await Promise.all(directories.map(async (dir) => JSON.parse(await readFile(path.join(dir, "result.json"), "utf8"))));
const [before, candidate, after] = reports;
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)],
    minimum: sorted[0], maximum: sorted.at(-1) };
};
let pngCount = 0;
for (let index = 0; index < reports.length; index++) {
  const report = reports[index];
  assert.equal(report.status, "PASS");
  assert.equal(report.phase, index === 1 ? "candidate" : "baseline");
  assert.equal(report.protocol, "B5-C-v1");
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.browserConsole, []);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(report.networkFailures, []);
  assert.deepEqual(report.sceneErrors, { render: [], provider: [] });
  assert.equal(report.gpu.kind, "hardware-reported");
  assert.equal(report.harnessSha256, hash(await readFile(fileURLToPath(new URL("m2.6.1-b5-c-performance.mjs", import.meta.url)))));
  for (const [name, digest] of Object.entries(report.harnessDependencies)) {
    assert.equal(digest, hash(await readFile(new URL(name, import.meta.url))));
  }
  assert.equal(hash(await readFile(path.join(directories[index], "timing-scene.png"))), report.timingScene.pngSha256);
  pngCount++;
  assert.deepEqual(report.timingScene.errors, []);
  assert.equal(report.measurements.length, 3);
  for (const batch of report.measurements) {
    assert.equal(batch.status, "MEASURED");
    assert.deepEqual(batch.resolution, [1920, 1080]);
    assert.deepEqual(batch.rendererAllocationsDuringMeasurement, { textures: 0, buffers: 0 });
    for (const mode of ["baseline", "solarWithoutBloom", "allEnabled"]) {
      assert.equal(batch.samples[mode].length, 30);
      for (const sample of batch.samples[mode]) {
        assert.ok(sample.passes.length > 0 && sample.passes.every((pass) => Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0));
        assert.ok(Math.abs(sample.gpuPassSumMs - sample.passes.reduce((sum, pass) => sum + pass.gpuMs, 0)) < 1e-9);
      }
      for (const metric of ["gpuPassSumMs", "gpuFrameSpanMs"]) {
        const summary = summarize(batch.samples[mode].map((sample) => sample[metric]));
        assert.ok(Math.abs(summary.mean - batch.summaries[mode][metric].mean) < 1e-9);
        assert.equal(summary.p95, batch.summaries[mode][metric].p95);
      }
    }
  }
  assert.ok(report.timingNativeAllocations.length > 0 && report.timingNativeAllocations.every((row) => row.destroyed && row.destroyCalls === 1));
}
for (const report of [candidate, after]) {
  assert.deepEqual(report.adapter, before.adapter);
  assert.equal(report.browser, before.browser);
  assert.deepEqual(report.fixture, before.fixture);
  assert.equal(report.harnessSha256, before.harnessSha256);
  assert.deepEqual(report.harnessDependencies, before.harnessDependencies);
  for (const field of ["camera", "time", "viewport", "devicePixelRatio", "exposure", "bloomStrength", "solarEffects", "sun", "terrain"]) {
    assert.deepEqual(report.timingScene[field], before.timingScene[field], `Matched actual ${field}`);
  }
}
assert.equal(before.source, "cf2c1d1bc4f368a02d126bab203ee32da5d4064c");
assert.equal(after.source, before.source);
assert.equal(after.bundleSha256, before.bundleSha256);
assert.deepEqual(after.timingScene.atmosphere, before.timingScene.atmosphere);
const atmosphereChanges = Object.fromEntries(Object.keys(before.timingScene.atmosphere)
  .filter((key) => JSON.stringify(before.timingScene.atmosphere[key]) !== JSON.stringify(candidate.timingScene.atmosphere[key]))
  .map((key) => [key, { before: before.timingScene.atmosphere[key], candidate: candidate.timingScene.atmosphere[key] }]));
assert.deepEqual(atmosphereChanges, { mieScattering: { before: 3.996e-6, candidate: 1.998e-6 },
  mieExtinction: { before: 4.44e-6, candidate: 2.22e-6 }, mieAnisotropy: { before: 0.8, candidate: 0.65 } });
assert.equal(candidate.lifecycle.length, 3);
for (const cycle of candidate.lifecycle) {
  assert.equal(cycle.failure, undefined);
  assert.deepEqual(cycle.errors, []); assert.deepEqual(cycle.gpuErrors, []);
  assert.deepEqual(cycle.adapter, candidate.adapter);
  assert.equal(cycle.afterDestroy.live, 0);
  assert.equal(cycle.priorLive, 0); assert.equal(cycle.globalLiveAfterDestroy, 0);
  assert.ok(cycle.allocations.length > 0 && cycle.allocations.every((row) => row.destroyed && row.destroyCalls === 1));
  assert.equal(cycle.captures.length, 3);
  for (const capture of cycle.captures) {
    assert.equal(hash(await readFile(path.join(candidateDir, capture.filename))), capture.sha256); pngCount++;
    assert.deepEqual(capture.canvas, capture.intended);
    assert.deepEqual(capture.nativeBeforeRepeatedRendering, capture.nativeAfterRepeatedRendering);
  }
  for (const field of ["live", "buffers", "textures", "logicalBytes"]) {
    assert.equal(cycle.captures[0].nativeAfterRepeatedRendering[field], cycle.captures[2].nativeAfterRepeatedRendering[field]);
  }
}
const collect = (runs) => Object.fromEntries(["baseline", "solarWithoutBloom", "allEnabled"].map((mode) => [mode,
  Object.fromEntries(["gpuPassSumMs", "gpuFrameSpanMs"].map((metric) => [metric,
    summarize(runs.flatMap((run) => run.measurements.flatMap((batch) => batch.samples[mode].map((sample) => sample[metric]))))]))]));
const baseline = collect([before, after]), current = collect([candidate]);
const measuredChange = Object.fromEntries(["mean", "p95"].map((metric) => [metric, {
  milliseconds: current.allEnabled.gpuPassSumMs[metric] - baseline.allEnabled.gpuPassSumMs[metric],
  percent: 100 * (current.allEnabled.gpuPassSumMs[metric] / baseline.allEnabled.gpuPassSumMs[metric] - 1),
}]));
const passMeans = reports.map((report) => {
  const values = report.measurements.flatMap((batch) => batch.samples.allEnabled);
  const means = {};
  for (const row of values) { for (const pass of row.passes) { means[pass.name] = (means[pass.name] ?? 0) + pass.gpuMs / values.length; } }
  return { phase: report.phase, passMeans: means, batchMeans: report.measurements.map((batch) => batch.summaries.allEnabled.gpuPassSumMs.mean) };
});
const result = { status: "PASS", scope: "Measurement integrity and native buffer/texture lifetime; not a no-regression performance assertion",
  pngCount, matchedScene: true, expectedProductionAtmosphereChanges: atmosphereChanges,
  baselineBefore: collect([before]), baselineAfter: collect([after]), baselinePooled: baseline, candidate: current,
  measuredChange, passMeans, sources: reports.map(({ source, bundleSha256, phase }) => ({ source, bundleSha256, phase })),
  limitations: ["Single integrated GPU; batch variability prevents precise causal attribution", "No performance budget specified; observed increase is retained, not waived or called zero cost", "GPU timestamps quantize short passes; zero does not mean no work", "Logical payload and explicit buffer/texture counts are not resident VRAM"] };
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, pngCount, measuredChange }, null, 2));
