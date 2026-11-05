import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "coordination/evidence/M2.8/compaction";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const audit = { protocol: "M2.8-compaction-integrity-v1", checkedAt: new Date().toISOString(), reports: {}, pngs: [], checks: [] };
const reports = {};
for (const key of ["baseline", "reference", "visual", "limb"]) {
  reports[key] = await report(`${key}/result.json`);
  const value = reports[key];
  assert.equal(value.status, "PASS", key);
  assert.equal(value.configuration.mode, "hardware");
  assert.equal(value.configuration.requirePhysicalGpu, true);
  assert.equal(value.gpu.kind, "hardware-reported");
  assert.deepEqual(value.browserErrors, []);
  assert.deepEqual(value.browserConsole, []);
  for (const scene of value.scenes) { await png(`${key}/${scene.name}.png`, scene.pngSha256); }
}
const { baseline, reference, visual, limb } = reports;
assert.notEqual(baseline.bundleSha256, reference.bundleSha256);
assert.deepEqual(baseline.adapter, reference.adapter);
assert.equal(baseline.browser, reference.browser);
assert.equal(hash(await readFile("Build/CesiumUnminified/Cesium.js")), reference.bundleSha256);
for (const value of [reference, visual, limb]) {
  assert.equal(value.bundleSha256, reference.bundleSha256);
  for (const [file, expected] of Object.entries(value.runtimeHashes)) {
    assert.equal(hash(await readFile(`packages/engine/Source/Scene/${file}`)), expected, file);
    assert.equal(expected, reference.runtimeHashes[file]);
    if (file !== "WebGPULensFlareShader.js") { assert.equal(expected, baseline.runtimeHashes[file]); }
  }
}
const stateKeys = ["camera", "time", "exposure", "viewport", "solarEffects", "bloomStrength", "terrain", "sun", "atmosphere"];
for (const current of reference.scenes) {
  const before = baseline.scenes.find((scene) => scene.name === current.name);
  assert.ok(before, current.name);
  for (const key of [...stateKeys, "lensFlare"]) { assert.deepEqual(current[key], before[key], `${current.name}: ${key}`); }
  if (current.name.endsWith("-off") || current.name.includes("layer-reflection")) { assert.equal(current.pngSha256, before.pngSha256); }
}
audit.compaction = reference.compactionComparison;
assert.equal(audit.compaction.exactUnchanged.length, 13);
assert.ok(audit.compaction.exactUnchanged.every((row) => row.equal));
assert.equal(audit.compaction.ratios.length, 2);
for (const row of audit.compaction.ratios) {
  for (const key of ["core", "shortRays"]) { assert.ok(row[key] >= 0.5 && row[key] <= 0.7); }
  for (const key of ["warmShoulder", "warmSpread"]) { assert.ok(row[key] >= 0.6 && row[key] <= 0.8); }
}
const red = await report("red-self-comparison/error.json");
assert.equal(red.status, "FAIL");
assert.match(red.error, /core width ratio 1/);
assert.ok(red.compactionComparison.ratios.every((row) => ["core", "shortRays", "warmShoulder", "warmSpread"].every((key) => row[key] === 1)));
audit.checks.push("Same-state before/after native frames; fixed rendered compaction bounds fail old-shader self-comparison; 12 disabled frames and isolated reflection/arc are exact.");

const main = await report("../baseline/result.json");
audit.independentMainMatches = [];
for (const match of main.matches) {
  const before = main.scenes.find((scene) => scene.name === match.name);
  const current = visual.scenes.find((scene) => scene.name === match.name);
  assert.equal(hash(await readFile(path.join(root, "../baseline", `${before.name}.png`))), before.pngSha256);
  assert.equal(current.pngSha256, before.pngSha256, match.name);
  for (const key of stateKeys) { assert.deepEqual(current[key], before[key], `${match.name}: ${key}`); }
  audit.independentMainMatches.push({ name: match.name, sha256: current.pngSha256 });
}
assert.equal(audit.independentMainMatches.length, 42);
for (const [key, directory] of [["visual", "motion-120"], ["limb", "limb-120"]]) {
  const motion = reports[key].motion;
  assert.equal(motion.frames.length, 120);
  for (const frame of motion.frames) { await png(`${key}/${directory}/${frame.file}`, frame.sha256); }
}
assert.ok(limb.motion.frames.some(({ geometry }) => geometry.clear === geometry.samples));
assert.ok(limb.motion.frames.some(({ geometry }) => geometry.earthBlocked > 0 && geometry.clear > 0));
assert.ok(limb.motion.frames.some(({ geometry }) => geometry.earthBlocked === geometry.samples));
for (const [key, pairs] of [["reference", reference.pairs], ["visual", visual.pairs], ["limb", limb.controls]]) {
  for (const pair of pairs) {
    assert.equal(pair.delta.restoredMaximum, 0, `${key}: restored off`);
    assert.equal(pair.delta.hiddenMaximum, 0, `${key}: hidden receivers`);
  }
}
for (const key of ["earthHidden", "meshHidden", "zeroIrradiance"]) { assert.equal(visual[key].delta.maximum, 0); }
assert.ok(visual.meshRemoved.delta.changedPixels > 0);
audit.checks.push("42 independent historical-main disabled views remain exact; every PNG hash verified; clear/partial/hidden traversal and existing receiver/source occultation checks pass.");

const webgl = await report("webgl/webgl-smoke.json");
assert.equal(webgl.bundleHash, reference.bundleSha256);
assert.equal(webgl.gpu.kind, "hardware-reported");
assert.equal(webgl.results.length, 3);
for (const row of webgl.results) { await png(`webgl/webgl-${row.fixture}.png`, row.screenshotSha256); }
audit.provenance = { baselineSource: baseline.source, baselineDirty: baseline.sourceStatus,
  candidateSource: reference.source, candidateDirty: reference.sourceStatus,
  baselineBundle: baseline.bundleSha256, candidateBundle: reference.bundleSha256,
  baselineAdapter: baseline.adapter, candidateAdapter: reference.adapter, browser: reference.browser,
  runtimeHashes: reference.runtimeHashes };
audit.pngCount = audit.pngs.length;
audit.status = "PASS";
await writeFile(path.join(root, "integrity-audit.json"), JSON.stringify(audit, null, 2));

async function report(file) {
  const bytes = await readFile(path.join(root, file));
  audit.reports[file] = hash(bytes);
  return JSON.parse(bytes);
}
async function png(file, expected) {
  const actual = hash(await readFile(path.join(root, file)));
  assert.equal(actual, expected, file);
  audit.pngs.push({ file, sha256: actual });
}
