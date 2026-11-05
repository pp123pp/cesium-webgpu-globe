import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve("coordination/evidence/M2.8");
const output = path.resolve(process.env.M28_AUDIT_OUTPUT ?? "Build/m2-lens-audit.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const audit = { protocol: "M2.8-offline-integrity-v1", status: "RUNNING", checkedAt: new Date().toISOString(),
  scope: "Offline file integrity and recorded assertions; no new GPU execution or user visual acceptance.",
  reportHashes: {}, pngs: [], checks: [] };
await mkdir(path.dirname(output), { recursive: true });
try {
  const reports = {};
  for (const [key, file] of Object.entries({ visual: "visual/result.json", timing: "timing/result.json", lifecycle: "lifecycle/result.json", baseline: "baseline/result.json", round1: "earlier-attempts/visual-round1.json", webgl: "webgl/webgl-smoke.json" })) {
    const bytes = await readFile(path.join(root, file));
    audit.reportHashes[file] = hash(bytes);
    reports[key] = JSON.parse(bytes);
  }
  const { visual, timing, lifecycle, baseline, round1, webgl } = reports;
  for (const key of ["visual", "timing", "lifecycle", "baseline"]) {
    const report = reports[key];
    assert.equal(report.status, "PASS", `${key}: recorded suite passes`);
    assert.equal(report.sourceStatus, "", `${key}: capture was source-clean`);
    assert.equal(report.configuration.mode, "hardware");
    assert.equal(report.configuration.requirePhysicalGpu, true);
    assert.equal(report.gpu.kind, "hardware-reported");
    assert.deepEqual(report.browserErrors, []);
    assert.deepEqual(report.browserConsole, []);
  }
  assert.equal(visual.source, timing.source);
  assert.equal(visual.bundleSha256, timing.bundleSha256);
  assert.equal(visual.bundleSha256, lifecycle.bundleSha256);
  assert.equal(visual.bundleSha256, webgl.bundleHash);
  assert.equal(webgl.sourceCommit, visual.source);
  assert.equal(hash(await readFile("Build/CesiumUnminified/Cesium.js")), visual.bundleSha256, "Current built bundle equals captured production bundle");
  assert.notEqual(baseline.bundleSha256, visual.bundleSha256, "Independent baseline is a distinct build");
  const changedRuntime = execFileSync("git", ["diff", "--name-only", visual.source, lifecycle.source, "--", "packages/engine/Source", "packages/widgets/Source"], { encoding: "utf8" }).trim();
  assert.equal(changedRuntime, "", "Lifecycle's later capture commit preserves visual/timing runtime");
  audit.provenance = { visualAndTimingCommit: visual.source, lifecycleCommit: lifecycle.source, lifecycleRuntimeDiff: [],
    productionBundleSha256: visual.bundleSha256, baselineCommit: baseline.source, baselineBundleSha256: baseline.bundleSha256,
    preliminaryCandidateCommit: round1.source, preliminaryCandidateWasDirty: Boolean(round1.sourceStatus) };
  audit.runtime = {};
  for (const key of ["visual", "timing", "lifecycle"]) {
    const entries = Object.entries(reports[key].runtimeHashes);
    assert.ok(entries.length >= 3);
    for (const [file, expected] of entries) {
      assert.equal(hash(await readFile(`packages/engine/Source/Scene/${file}`)), expected, `${key}: current runtime ${file}`);
      assert.equal(visual.runtimeHashes[file], expected, `${key}: shared runtime identity ${file}`);
    }
    audit.runtime[key] = { verifiedCurrentFiles: entries.length, hashes: reports[key].runtimeHashes };
  }
  audit.checks.push("Clean capture provenance, identical candidate bundle, unchanged later lifecycle runtime, current runtime hashes.");

  for (const [key, report] of [["visual", visual], ["baseline", baseline], ["timing", timing]]) {
    for (const scene of report.scenes) { await png(`${key}/${scene.name}.png`, scene.pngSha256); }
  }
  assert.equal(visual.motion.count, 120);
  assert.equal(visual.motion.frames.length, 120);
  for (const [index, frame] of visual.motion.frames.entries()) {
    assert.equal(frame.index, index);
    assert.equal(frame.file, `frame-${String(index).padStart(4, "0")}.png`);
    await png(`visual/motion-120/${frame.file}`, frame.sha256);
    assert.deepEqual(frame.errors, []);
    assert.equal(frame.lensFlare.enabled, true);
    if (index > 0) {
      const previous = visual.motion.frames[index - 1];
      assert.equal(frame.frame, previous.frame + 1);
      assert.equal(Date.parse(frame.state.time) - Date.parse(previous.state.time), 1000);
      assert.notDeepEqual(frame.state.camera, previous.state.camera);
      assert.deepEqual(frame.lensFlare, previous.lensFlare);
      assert.equal(frame.state.exposure, previous.state.exposure);
    }
  }
  const first = visual.motion.frames[0];
  const last = visual.motion.frames.at(-1);
  audit.motion = { frames: 120, firstFrame: first.frame, lastFrame: last.frame, firstTime: first.state.time, lastTime: last.state.time, frameStep: 1, timeStepSeconds: 1 };
  for (const row of webgl.results) { await png(`webgl/webgl-${row.fixture}.png`, row.screenshotSha256); }
  const historicalCenter = round1.scenes.find((scene) => scene.name === "high-front-1920-e1-on");
  assert.ok(historicalCenter);
  await png("earlier-attempts/centered-veiling-defect.png", historicalCenter.pngSha256);
  audit.checks.push("Native visual, baseline, timing and WebGL PNG hashes; 120 consecutive camera/time frames.");

  assert.equal(hash(await readFile(path.join(root, "earlier-attempts/visual-round1.json"))), baseline.candidate.reportSha256);
  assert.equal(baseline.candidate.source, round1.source);
  assert.equal(baseline.candidate.bundleSha256, round1.bundleSha256);
  assert.equal(baseline.candidate.sourceStatus, round1.sourceStatus);
  assert.equal(baseline.matches.length, 42);
  audit.baselineTransitivity = [];
  for (const match of baseline.matches) {
    const base = baseline.scenes.find((scene) => scene.name === match.name);
    const preliminary = round1.scenes.find((scene) => scene.name === match.name);
    const final = visual.scenes.find((scene) => scene.name === match.name);
    assert.ok(base && preliminary && final, match.name);
    assert.equal(match.identical, true);
    assert.deepEqual(match.stateDifferences, []);
    assert.equal(match.baselinePngSha256, base.pngSha256);
    assert.equal(match.candidatePngSha256, preliminary.pngSha256);
    assert.equal(base.pngSha256, preliminary.pngSha256);
    assert.equal(base.pngSha256, final.pngSha256, `${match.name}: independent baseline = preliminary off = final off`);
    assert.equal(final.lensFlare.enabled, false);
    for (const key of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain", "sun", "atmosphere"]) {
      assert.deepEqual(base[key], preliminary[key], `${match.name}: baseline/preliminary ${key}`);
      assert.deepEqual(base[key], final[key], `${match.name}: baseline/final ${key}`);
    }
    audit.baselineTransitivity.push({ name: match.name, baselinePngSha256: base.pngSha256, preliminaryOffPngSha256: preliminary.pngSha256, finalOffPngSha256: final.pngSha256 });
  }
  audit.checks.push("42 exact independent baseline = preliminary candidate off = final candidate off chains, with exact states and archived preliminary report digest.");
  for (const pair of visual.pairs) {
    assert.equal(pair.delta.restoredMaximum, 0);
    assert.equal(pair.delta.hiddenMaximum, 0);
    if (pair.name.startsWith("high-front")) { assert.equal(pair.delta.cornerMaximum, 0); }
  }
  assert.equal(visual.earthHidden.delta.maximum, 0);
  assert.equal(visual.meshHidden.delta.maximum, 0);
  assert.equal(visual.zeroIrradiance.delta.maximum, 0);
  assert.ok(visual.meshRemoved.delta.changedPixels > 0);
  audit.checks.push("Recorded restoration, receiver masking, centered corners, full occlusion and zero-irradiance checks remain exact.");

  audit.nativeResources = {};
  for (const key of ["visual", "timing"]) {
    const rows = reports[key].allocations;
    released(rows, key);
    audit.nativeResources[key] = counts(rows);
  }
  const lifecycleRows = [];
  for (const item of lifecycle.cases) {
    assert.equal(item.failure, undefined);
    assert.equal(item.afterDestroy.live, 0);
    assert.equal(item.afterDestroy.payloadBytes, 0);
    assert.equal(item.globalLiveAfterDestroy, item.priorLive);
    released(item.allocations, item.kind);
    lifecycleRows.push(...item.allocations);
    for (const capture of item.captures) {
      assert.deepEqual(capture.after, capture.before);
      assert.equal(capture.terrainDraws, 0);
      assert.equal(capture.lensFlareTextureBytes, 8);
    }
    if (item.kind === "device-loss") { assert.equal(item.afterLoss.live, 0); assert.equal(item.rendererDestroyedByLoss, true); }
    if (item.kind === "resize") {
      for (const key of ["live", "textures", "buffers", "payloadBytes"]) { assert.equal(item.captures[0].after[key], item.captures[2].after[key]); }
    }
  }
  audit.nativeResources.lifecycle = counts(lifecycleRows);
  audit.checks.push("Every recorded native allocation destroyed exactly once; lifecycle and timing steady-state allocations unchanged.");

  audit.timing = [];
  for (const batch of timing.timing) {
    assert.equal(batch.status, "MEASURED");
    assert.equal(batch.samplesPerMode, 60);
    assert.deepEqual(batch.allocationChanges, { textures: 0, buffers: 0 });
    assert.equal(batch.flareTextureBytes, 8);
    const summary = {};
    for (const mode of ["off", "on"]) {
      const rows = batch.samples[mode];
      assert.equal(rows.length, 60);
      for (const row of rows) {
        assert.ok(row.passes.every((pass) => Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0));
        close(row.passes.reduce((sum, pass) => sum + pass.gpuMs, 0), row.gpuPassSumMs);
      }
      const values = rows.map((row) => row.gpuPassSumMs).sort((a, b) => a - b);
      summary[mode] = { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: values[Math.floor(values.length * 0.95)] };
      close(summary[mode].mean, batch.summary[mode].gpuPassSumMs.mean);
      close(summary[mode].p95, batch.summary[mode].gpuPassSumMs.p95);
    }
    const mean = summary.on.mean - summary.off.mean;
    const p95 = summary.on.p95 - summary.off.p95;
    close(mean, batch.incrementalMeanMs); close(p95, batch.incrementalP95Ms);
    assert.ok(mean <= 0.5, "Original mean budget unchanged");
    assert.ok(p95 <= 1, "Original p95 budget unchanged");
    audit.timing.push({ resolution: batch.resolution, summary, incrementalMeanMs: mean, incrementalP95Ms: p95, budget: { meanMs: 0.5, p95Ms: 1 } });
  }
  assert.equal(timing.timing.length, 3);
  audit.checks.push("Raw timestamp pass sums, 60 samples/mode/batch, mean/p95 recomputed, original +0.5/+1.0 ms budgets retained.");

  audit.pngs.sort((a, b) => a.file.localeCompare(b.file));
  const listed = audit.pngs.map((row) => row.file).sort();
  const actual = (await findPngs(root)).sort();
  assert.deepEqual(actual, listed, "Every archived PNG has been checked, with no unlisted files");
  audit.pngCounts = { visualStatic: visual.scenes.length, visualMotion: visual.motion.frames.length, baseline: baseline.scenes.length, timing: timing.scenes.length, webgl: webgl.results.length, historicalDefect: 1, total: audit.pngs.length };
  audit.pngManifestSha256 = hash(audit.pngs.map((row) => `${row.file} ${row.sha256}\n`).join(""));
  audit.status = "PASS";
} catch (error) {
  audit.status = "FAIL";
  audit.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: audit.status, output, pngCounts: audit.pngCounts, pngManifestSha256: audit.pngManifestSha256, error: audit.error })}\n`);
}

async function png(file, expected) {
  const actual = hash(await readFile(path.join(root, file)));
  assert.equal(actual, expected, file);
  assert.ok(!audit.pngs.some((row) => row.file === file), `Duplicate PNG ${file}`);
  audit.pngs.push({ file, sha256: actual });
}
function released(rows, label) {
  assert.ok(rows.length > 0, label);
  assert.ok(rows.every((row) => row.destroyed && row.destroyCalls === 1), `${label}: native resource release`);
}
function counts(rows) {
  return { allocations: rows.length, buffers: rows.filter((row) => row.kind === "Buffer").length, textures: rows.filter((row) => row.kind === "Texture").length,
    destroyedOnce: rows.filter((row) => row.destroyed && row.destroyCalls === 1).length, retained: rows.filter((row) => !row.destroyed).length };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }
async function findPngs(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { files.push(...await findPngs(path.join(directory, entry.name), `${relative}/`)); }
    else if (entry.name.endsWith(".png")) { files.push(relative); }
  }
  return files;
}
