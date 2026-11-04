// Offline integrity/acceptance audit; no browser or GPU calls.
// node coordination/ci/m2.6.1-b3-audit.mjs <before-dir> <after-dir> [audit.json]
// A one-directory invocation verifies retained evidence and AFTER gates. BEFORE
// visual failures are recorded for comparison and never treated as acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const effectDefaults = { rays: 1, softHalo: 1, wideHalo: 1, corona: 1, tint: 1 };
const protocol = "M2.6.1-B3-v1";

function sameState(a, b, label) {
  for (const field of ["canvas", "viewport", "time", "exposure", "solarEffects", "resolutionScale", "devicePixelRatio", "clockShouldAnimate"]) {
    assert.deepEqual(a[field], b[field], `${label}: ${field}`);
  }
  for (const field of ["positionWC", "directionWC", "upWC", "rightWC"]) {
    const tolerance = field === "positionWC" ? 1e-7 : 32 * Number.EPSILON;
    assert.ok(a.camera[field].every((value, index) => Math.abs(value - b.camera[field][index]) <= tolerance), `${label}: ${field}`);
  }
  for (const field of ["fov", "fovy", "aspectRatio", "near", "far"]) { assert.equal(a.camera[field], b.camera[field], `${label}: ${field}`); }
  assert.deepEqual(a.providers, b.providers, `${label}: providers`);
  for (const field of ["sun", "atmosphere", "moon", "stars"]) { assert.deepEqual(a[field], b[field], `${label}: ${field}`); }
}

function validateTiming(report) {
  const timing = report.gpuTiming;
  assert.equal(timing?.status, "MEASURED", "GPU timestamps must be measured; wall-clock timing is insufficient");
  assert.deepEqual(timing.resolution, [1920, 1080]);
  assert.equal(timing.samplesPerMode, 30);
  for (const mode of ["baseline", "solarWithoutBloom", "allEnabled"]) {
    const rows = timing.samples[mode];
    assert.equal(rows.length, 30, `${mode}: raw timestamps retained`);
    assert.ok(rows.every((row) => row.passes.length > 0 && row.passes.every((pass) => Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0)));
    for (const metric of ["gpuPassSumMs", "gpuFrameSpanMs"]) {
      const values = rows.map((row) => row[metric]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const p95 = [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
      assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
      assert.ok(Math.abs(timing.summaries[mode][metric].mean - mean) < 1e-9);
      assert.equal(timing.summaries[mode][metric].p95, p95);
    }
  }
  const state = report.scenes.find((scene) => scene.name === "gpu-timing-state-full-60")?.state;
  assert.ok(state, "GPU profiling scene state retained");
  assert.equal(state.exposure, 1); assert.equal(state.bloomStrength, 0.35);
  assert.deepEqual(state.canvas, [1920, 1080]); assert.deepEqual(state.solarEffects, effectDefaults);
}

async function verifyFiles(directory, entries) {
  const checked = new Set();
  for (const entry of entries) {
    assert.ok(entry.filename && /^[a-f0-9]{64}$/.test(entry.sha256), "Evidence file needs an exact path and SHA-256");
    const filename = path.resolve(directory, entry.filename);
    assert.ok(filename.startsWith(`${path.resolve(directory)}${path.sep}`), "Evidence path must stay inside its output directory");
    if (checked.has(filename)) { continue; }
    const bytes = await readFile(filename);
    assert.equal(digest(bytes), entry.sha256, `Hash mismatch: ${entry.filename}`);
    if (entry.bytes !== undefined) { assert.equal(bytes.length, entry.bytes, `Byte count: ${entry.filename}`); }
    checked.add(filename);
  }
  return checked.size;
}

export async function auditDirectory(directory) {
  const report = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8"));
  assert.equal(report.captureProtocol, protocol, "Wrong or incomplete capture protocol");
  assert.ok(["before", "after"].includes(report.phase));
  assert.ok(["PASS", "PASS_WITH_KNOWN_ISSUES"].includes(report.status));
  assert.match(report.bundleSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.provenance.hashes, report.provenanceEnd.hashes, "Sources changed during capture");
  assert.ok(Object.keys(report.provenance.hashes).some((name) => name.endsWith("WebGPUSolarBloomShader.js")));
  assert.equal(report.productionDefaults.bloomStrength, 0.35);
  assert.deepEqual(report.productionDefaults.solarEffects, effectDefaults);
  assert.deepEqual(report.browserErrors, []);
  assert.ok(report.b3Gates.length > 0);
  assert.equal(report.bloomPairs.length, 12);
  const scenes = new Map(report.scenes.map((scene) => [scene.filename, scene]));
  assert.equal(scenes.size, report.scenes.length, "Duplicate output frame names");
  for (const pair of report.bloomPairs) {
    const full = scenes.get(pair.full), off = scenes.get(pair.bloomOff);
    assert.ok(full && off, `${pair.name}: both controls retained`);
    sameState(full.state, off.state, pair.name);
    assert.equal(full.state.bloomStrength, 0.35); assert.equal(off.state.bloomStrength, 0);
  }
  for (const placement of ["center", "offaxis", "edge"]) {
    for (const exposure of placement === "edge" ? [1] : [0.5, 1, 2]) {
      const scene = scenes.get(`normal-60-${placement}-exposure-${exposure}-full.png`);
      assert.ok(scene, `Missing ${placement}/${exposure} normal-FOV pair`);
      assert.equal(scene.state.exposure, exposure); assert.deepEqual(scene.state.canvas, [1920, 1080]);
      assert.ok(Math.abs(scene.state.camera.fovDegrees - 60) < 1e-10);
    }
  }
  assert.deepEqual(scenes.get("resize-720-full.png").state.canvas, [1280, 720]);
  assert.deepEqual(scenes.get("resize-restored-1080-full.png").state.canvas, [1920, 1080]);
  assert.equal(report.occlusion.length, 7);
  for (const observation of report.occlusion) {
    for (const [key, show, bloom] of [["fullOff", false, 0.35], ["fullOn", true, 0.35], ["zeroOff", false, 0], ["zeroOn", true, 0]]) {
      const state = scenes.get(observation.records[key])?.state;
      assert.ok(state, `${observation.name}/${key}: control image exists`);
      assert.equal(state.sun.show, show); assert.equal(state.bloomStrength, bloom);
      const reference = scenes.get(observation.records.fullOn).state;
      sameState({ ...state, sun: { ...state.sun, show: true } }, reference, `${observation.name}/${key}`);
    }
    assert.ok(observation.fullContribution.regions.clearSky.pixels > 0);
    assert.ok(observation.visibility.productionSunProbe.length > 0);
    for (const key of ["_linearTexture", "_bloomTextureA", "_bloomTextureB"]) {
      assert.ok(observation.hdrDelta.some((texture) => texture.key === key), `${observation.name}: ${key} readback`);
    }
  }
  const sequence = report.continuous;
  assert.equal(sequence.count, 120); assert.equal(sequence.frames.length, 120); assert.equal(sequence.contiguous, true);
  for (let index = 0; index < 120; index++) {
    const frame = sequence.frames[index];
    const scene = scenes.get(`motion/${frame.filename}`);
    assert.ok(scene, `Motion frame ${index} retained`); assert.equal(frame.index, index); assert.equal(frame.sha256, scene.sha256);
    assert.equal(scene.state.exposure, 1); assert.equal(scene.state.bloomStrength, 0.35);
    assert.deepEqual(scene.state.canvas, [1920, 1080]); assert.deepEqual(scene.state.solarEffects, effectDefaults);
    if (index) {
      assert.equal(frame.frame, sequence.frames[index - 1].frame + 1);
      assert.equal(Date.parse(frame.time) - Date.parse(sequence.frames[index - 1].time), 10000);
      assert.notDeepEqual(frame.cameraDirection, sequence.frames[index - 1].cameraDirection);
    }
  }
  assert.equal(report.lifecycle.length, 3);
  assert.ok(report.lifecycle.every((cycle) => cycle.captures.length === 3));
  validateTiming(report);
  const files = await verifyFiles(directory, [...report.scenes, ...report.lifecycle.flatMap((cycle) => cycle.captures), ...report.compiledShaders]);
  const failures = report.b3Gates.filter((gate) => !gate.passed);
  return { report, summary: { directory: path.resolve(directory), phase: report.phase, commit: report.provenance.commit,
    sourceStatus: report.provenance.status, bundleSha256: report.bundleSha256, filesVerified: files, failedGates: failures,
    gpuTiming: report.gpuTiming.summaries, status: failures.length ? "OBSERVATIONS_WITH_FAILED_GATES" : "AUTOMATED_GATES_PASS" } };
}

export async function compareCaptures(before, after) {
  assert.equal(before.phase, "before"); assert.equal(after.phase, "after");
  const helperHashes = (report) => Object.fromEntries(Object.entries(report.provenance.hashes).filter(([name]) => name.startsWith("coordination/ci/")));
  assert.deepEqual(helperHashes(before), helperHashes(after), "BEFORE and AFTER must run identical capture/helper files");
  assert.deepEqual(before.servedAssets, after.servedAssets, "Solar artwork assets changed during a Bloom-only comparison");
  assert.deepEqual(before.scenes.map((scene) => scene.name), after.scenes.map((scene) => scene.name));
  for (let index = 0; index < before.scenes.length; index++) {
    const a = before.scenes[index], b = after.scenes[index];
    sameState(a.state, b.state, `${a.name}: before/after`);
    assert.equal(a.state.bloomStrength, b.state.bloomStrength);
    assert.deepEqual(a.intent, b.intent);
  }
  const shaderHashes = (report) => report.compiledShaders.filter((shader) => /HDR bloom WGSL/.test(shader.label)).map((shader) => shader.sha256);
  return { matchingScenes: before.scenes.length, sameHarness: true, sameAssets: true,
    changedSourceFiles: Object.keys(after.provenance.hashes).filter((name) => before.provenance.hashes[name] !== after.provenance.hashes[name]),
    compiledBloomShaders: { before: [...new Set(shaderHashes(before))], after: [...new Set(shaderHashes(after))] },
    timingMeanDeltaMs: after.gpuTiming.summaries.allEnabled.gpuPassSumMs.mean - before.gpuTiming.summaries.allEnabled.gpuPassSumMs.mean };
}

async function main() {
  const [first, second, destination] = process.argv.slice(2);
  assert.ok(first, "Usage: node m2.6.1-b3-audit.mjs <before-dir> [after-dir] [audit.json]");
  const output = { protocol, auditedAt: new Date().toISOString(), captures: [] };
  const resultPath = destination ?? path.join(second ?? first, "b3-audit.json");
  let failure;
  try {
    const a = await auditDirectory(first); output.captures.push(a.summary);
    if (second) {
      const b = await auditDirectory(second); output.captures.push(b.summary);
      output.comparison = await compareCaptures(a.report, b.report);
    }
    const after = output.captures.find((capture) => capture.phase === "after");
    if (after) { assert.equal(after.failedGates.length, 0, `AFTER failed gates: ${after.failedGates.map((gate) => gate.name).join("; ")}`); }
    output.status = after ? "AUTOMATED_GATES_PASS_VISUAL_REVIEW_REQUIRED" : "BEFORE_INTEGRITY_ONLY";
  } catch (error) {
    failure = error; output.status = "FAIL"; output.error = String(error);
  }
  await writeFile(resultPath, JSON.stringify(output, null, 2));
  console.log(`${output.status}: ${resultPath}`);
  if (failure) { process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await main(); }
