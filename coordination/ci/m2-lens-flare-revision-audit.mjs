import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve("coordination/evidence/M2.8/revision");
const output = path.resolve(process.env.M28_AUDIT_OUTPUT ?? "Build/m2-lens-revision-audit.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const audit = { protocol: "M2.8-revision-offline-integrity-v1", status: "RUNNING", checkedAt: new Date().toISOString(),
  scope: "Offline verification of native evidence and current runtime identity; no new GPU execution or user visual acceptance.",
  reports: {}, pngs: [], checks: [] };
await mkdir(path.dirname(output), { recursive: true });
try {
  const reports = {};
  for (const key of ["reference", "visual", "limb", "timing", "lifecycle"]) {
    reports[key] = await report(`${key}/result.json`);
    const value = reports[key];
    assert.equal(value.status, "PASS", key);
    assert.equal(value.sourceStatus, "", `${key}: clean final capture`);
    assert.equal(value.configuration.mode, "hardware");
    assert.equal(value.configuration.requirePhysicalGpu, true);
    assert.equal(value.gpu.kind, "hardware-reported");
    assert.deepEqual(value.browserErrors, []);
    assert.deepEqual(value.browserConsole, []);
  }
  const { reference, visual, limb, timing, lifecycle } = reports;
  const webgl = await report("webgl/webgl-smoke.json");
  const baseline = await report("../baseline/result.json");
  assert.equal(baseline.status, "PASS");
  assert.equal(baseline.sourceStatus, "");
  assert.equal(baseline.gpu.kind, "hardware-reported");
  assert.equal(baseline.configuration.requirePhysicalGpu, true);
  assert.equal(webgl.config.mode, "hardware");
  assert.equal(webgl.config.requirePhysicalGpu, true);
  assert.equal(webgl.gpu.kind, "hardware-reported");
  assert.deepEqual(webgl.browserErrors, []);
  assert.deepEqual(webgl.browserWarnings, []);
  assert.equal(webgl.bundleHash, visual.bundleSha256);
  assert.equal(webgl.sourceCommit, visual.source);
  assert.equal(hash(await readFile("Build/CesiumUnminified/Cesium.js")), visual.bundleSha256);
  assert.notEqual(baseline.bundleSha256, visual.bundleSha256);
  for (const [key, value] of Object.entries(reports)) {
    assert.equal(value.source, visual.source, `${key}: same committed candidate`);
    assert.equal(value.bundleSha256, visual.bundleSha256, `${key}: same production bundle`);
    assert.ok(Object.keys(value.runtimeHashes).length >= 3);
    for (const [file, expected] of Object.entries(value.runtimeHashes)) {
      assert.equal(hash(await readFile(`packages/engine/Source/Scene/${file}`)), expected, `${key}: current ${file}`);
      assert.equal(visual.runtimeHashes[file], expected, `${key}: shared ${file}`);
    }
  }
  audit.provenance = { candidateCommit: visual.source, candidateBundle: visual.bundleSha256,
    baselineCommit: baseline.source, baselineBundle: baseline.bundleSha256, runtimeHashes: visual.runtimeHashes };
  audit.checks.push("Clean committed hardware captures, one current candidate runtime/bundle, independent historical main baseline.");

  for (const [key, value] of Object.entries(reports)) {
    for (const scene of value.scenes) { await png(`${key}/${scene.name}.png`, scene.pngSha256); }
  }
  for (const row of webgl.results) {
    await png(`webgl/webgl-${row.fixture}.png`, row.screenshotSha256);
    assert.equal(row.repeatCaptureEqual, true);
    assert.ok(row.comparison.changedFraction <= row.comparison.maxChangedFraction);
  }
  assert.equal(webgl.results.length, 3);
  audit.motion = {};
  for (const [key, directory] of [["visual", "motion-120"], ["limb", "limb-120"]]) {
    const motion = reports[key].motion;
    assert.equal(motion.count, 120);
    assert.equal(motion.frames.length, 120);
    for (const [index, frame] of motion.frames.entries()) {
      assert.equal(frame.index, index);
      assert.equal(frame.file, `frame-${String(index).padStart(4, "0")}.png`);
      await png(`${key}/${directory}/${frame.file}`, frame.sha256);
      assert.deepEqual(frame.errors, []);
      assert.equal(frame.lensFlare.enabled, true);
      if (index > 0) {
        const previous = motion.frames[index - 1];
        assert.equal(frame.frame, previous.frame + 1);
        assert.equal(Date.parse(frame.state.time) - Date.parse(previous.state.time), 1000);
        assert.notDeepEqual(frame.state.camera, previous.state.camera);
        assert.deepEqual(frame.lensFlare, previous.lensFlare);
        assert.equal(frame.state.exposure, previous.state.exposure);
      }
    }
    audit.motion[key] = { count: 120, firstFrame: motion.frames[0].frame, lastFrame: motion.frames.at(-1).frame,
      firstTime: motion.frames[0].state.time, lastTime: motion.frames.at(-1).state.time };
  }
  assert.ok(limb.motion.frames.some(({ geometry }) => geometry.clear === geometry.samples));
  assert.ok(limb.motion.frames.some(({ geometry }) => geometry.earthBlocked > 0 && geometry.clear > 0));
  assert.ok(limb.motion.frames.some(({ geometry }) => geometry.earthBlocked === geometry.samples));
  audit.checks.push("Every native candidate PNG hashed; two complete 120-frame camera/time sequences, including clear/partial/hidden Earth.");

  assert.equal(baseline.matches.length, 42);
  audit.baselineMatches = [];
  for (const match of baseline.matches) {
    const base = baseline.scenes.find((scene) => scene.name === match.name);
    const candidate = visual.scenes.find((scene) => scene.name === match.name);
    assert.ok(base && candidate, match.name);
    assert.equal(hash(await readFile(path.join(root, "../baseline", `${base.name}.png`))), base.pngSha256);
    assert.equal(base.pngSha256, candidate.pngSha256, `${match.name}: exact unchanged disabled output`);
    assert.equal(candidate.lensFlare.enabled, false);
    for (const key of ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain", "sun", "atmosphere"]) {
      assert.deepEqual(base[key], candidate[key], `${match.name}: baseline/candidate ${key}`);
    }
    audit.baselineMatches.push({ name: match.name, sha256: base.pngSha256 });
  }
  for (const [key, pairs] of [["visual", visual.pairs], ["reference", reference.pairs], ["limb", limb.controls]]) {
    for (const pair of pairs) {
      assert.equal(pair.delta.restoredMaximum, 0, `${key}/${pair.name}: restored off`);
      assert.equal(pair.delta.hiddenMaximum, 0, `${key}/${pair.name}: receiver mask`);
      if (pair.name.startsWith("high-front")) { assert.equal(pair.delta.cornerMaximum, 0); }
    }
  }
  assert.equal(visual.earthHidden.delta.maximum, 0);
  assert.equal(visual.meshHidden.delta.maximum, 0);
  assert.equal(visual.zeroIrradiance.delta.maximum, 0);
  assert.ok(visual.meshRemoved.delta.changedPixels > 0);
  assert.equal(limb.controls.find((row) => row.name === "hidden").delta.maximum, 0);
  for (const name of ["clear", "partial"]) { assert.ok(limb.controls.find((row) => row.name === name).delta.changedPixels > 0); }
  assert.ok(reference.referenceReadability.meanByteIncrease >= 40);
  assert.ok(reference.referenceReadability.saturatedWhitePixels > 0);
  audit.referenceReadability = reference.referenceReadability;
  audit.checks.push("42 same-state native baseline hashes exactly match disabled output; zero hidden-source/receiver residual and reference readability lower bounds.");

  audit.resources = {};
  for (const key of ["reference", "visual", "limb", "timing"]) {
    const rows = reports[key].allocations;
    released(rows, key);
    audit.resources[key] = resourceCounts(rows);
  }
  const lifecycleRows = [];
  for (const item of lifecycle.cases) {
    assert.equal(item.failure, undefined);
    assert.equal(item.viewerDestroyed, true);
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
    if (item.kind === "pipeline-rejection") {
      assert.match(item.initializationRejection, /Intentional M2.8 lens pipeline rejection/);
      continue;
    }
    assert.deepEqual(item.gpuErrors, []);
    assert.deepEqual(item.idempotentInitialization.after, item.idempotentInitialization.before);
    if (item.kind === "device-loss") { assert.equal(item.afterLoss.live, 0); assert.equal(item.rendererDestroyedByLoss, true); }
    if (item.kind === "asset-corrupt") { assert.equal(item.asset.loaded, false); }
    if (item.kind === "resize") {
      for (const key of ["live", "textures", "buffers", "payloadBytes"]) { assert.equal(item.captures[0].after[key], item.captures[2].after[key]); }
    }
  }
  assert.deepEqual(lifecycle.cases.map((item) => item.kind), ["resize", "asset-corrupt", "device-loss", "recreate-after-loss", "pipeline-rejection"]);
  audit.resources.lifecycle = resourceCounts(lifecycleRows);
  audit.timing = timing.timing.map((batch) => {
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
    const mean = summary.on.mean - summary.off.mean, p95 = summary.on.p95 - summary.off.p95;
    close(mean, batch.incrementalMeanMs); close(p95, batch.incrementalP95Ms);
    assert.ok(mean <= 0.5); assert.ok(p95 <= 1);
    return { resolution: batch.resolution, summary, incrementalMeanMs: mean, incrementalP95Ms: p95 };
  });
  assert.equal(timing.timing.length, 3);
  audit.checks.push("Native allocations destroyed once, lifecycle recovery/resize stable, timestamp sums and original +0.5/+1 ms mean/p95 budgets recomputed.");
  audit.pngs.sort((a, b) => a.file.localeCompare(b.file));
  assert.deepEqual((await findPngs(root)).sort(), audit.pngs.map((row) => row.file).sort(), "No unlisted candidate PNGs");
  audit.pngCount = audit.pngs.length;
  audit.pngManifestSha256 = hash(audit.pngs.map((row) => `${row.file} ${row.sha256}\n`).join(""));
  audit.status = "PASS";
} catch (error) {
  audit.status = "FAIL";
  audit.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: audit.status, output, pngCount: audit.pngCount, error: audit.error })}\n`);
}

async function report(file) {
  const bytes = await readFile(path.join(root, file));
  audit.reports[file] = hash(bytes);
  return JSON.parse(bytes);
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
function resourceCounts(rows) {
  return { allocations: rows.length, buffers: rows.filter((row) => row.kind === "Buffer").length,
    textures: rows.filter((row) => row.kind === "Texture").length, destroyedOnce: rows.filter((row) => row.destroyed && row.destroyCalls === 1).length };
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
