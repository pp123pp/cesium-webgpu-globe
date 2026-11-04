// Offline B4 evidence integrity and matched-state audit; no browser or GPU work.
// node coordination/ci/m2.6.1-b4-audit.mjs <baseline-dir> <candidate-dir> <output.json>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { hash } from "./m2.6.1-b4-fixtures.mjs";

const [beforeDir, afterDir, output] = process.argv.slice(2);
assert.ok(beforeDir && afterDir && output, "Supply baseline, candidate, and output paths");
const before = JSON.parse(await readFile(path.join(beforeDir, "result.json"), "utf8"));
const after = JSON.parse(await readFile(path.join(afterDir, "result.json"), "utf8"));
for (const report of [before, after]) {
  assert.equal(report.sourceStatus, "");
  assert.equal(report.provenance.harnessStatus, "");
  assert.equal(report.gpu.kind, "hardware-reported");
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.browserConsole, []);
  assert.ok(report.cleanup.destroyed);
  assert.equal(report.scenes.length, 42);
}
assert.equal(before.provenance.runtimeCommit, "5f18afc1b77f433892f14510b2599c374f8a4942");
assert.deepEqual(before.provenance.harnessFiles, after.provenance.harnessFiles);
assert.deepEqual(before.environment, after.environment);
assert.equal(before.browser, after.browser);
for (const file of ["packages/engine/Source/Scene/WebGPUSolarBloomShader.js", "package.json"]) {
  assert.equal(before.provenance.runtimeFiles[file], after.provenance.runtimeFiles[file]);
}
assert.deepEqual(before.scenes.map((s) => s.name), after.scenes.map((s) => s.name));
const pairs = [];
for (let i = 0; i < before.scenes.length; i++) {
  const a = before.scenes[i];
  const b = after.scenes[i];
  for (const field of ["camera", "time", "sun", "exposure", "mode", "atmosphere", "solarEffects",
    "bloomStrength", "viewport", "framing", "geometry"]) {
    assert.deepEqual(a[field], b[field], `${a.name  } mismatched ${  field}`);
  }
  // Windows reports 1 versus 1.0000000149011612 for the same configured DPR.
  // Keep raw values; require equal physical canvas size above and sub-ppm DPR.
  assert.ok(Math.abs(a.devicePixelRatio - b.devicePixelRatio) < 1e-6);
  assert.equal(a.terrain.provider, b.terrain.provider);
  assert.ok(a.terrain.tilesLoaded && b.terrain.tilesLoaded || a.framing.earthRays === 0);
  for (const [root, scene] of [[beforeDir, a], [afterDir, b]]) {
    assert.equal(hash(await readFile(path.join(root, `${scene.name  }.png`))), scene.pngSha256);
  }
  const identical = a.pngSha256 === b.pngSha256;
  const invariant = a.name.endsWith("atmosphere-off") ||
    a.name.includes("physical-only") || a.name.includes("physical-no-bloom") ||
    a.name.includes("sun-off") || a.name.startsWith("terrain-full") ||
    a.name.startsWith("ground-night") || a.name.startsWith("ground-transition");
  if (invariant) { assert.ok(identical, `${a.name  } must preserve the non-artwork baseline`); }
  pairs.push({ name: a.name, identical, invariant,
    baselinePngSha256: a.pngSha256, candidatePngSha256: b.pngSha256,
    diskLuminanceDelta: b.metrics.disk.displayLinearLuminanceMean - a.metrics.disk.displayLinearLuminanceMean,
    skyRgbDelta: b.metrics.sky.rgbMean.map((v, c) => v - a.metrics.sky.rgbMean[c]) });
}
const twilight = (report) => Object.fromEntries(Object.entries(report.twilight).map(([mode, value]) => {
  const row = value.samples.rows[0];
  const disk = value.metrics.disk.displayLinearLuminanceMean;
  const sky = value.metrics.annulus.displayLinearLuminanceMean;
  return [mode, { displayLinearDiskLuminance: disk, displayLinearAnnulusLuminance: sky,
    contrastAboveAnnulus: (disk - sky) / sky,
    farSkyRgb: value.metrics.sky.rgbMean,
    center: { solarBeforeTransport: row.slice(0, 3), transmittance: row.slice(4, 7),
      physicalAtmosphericRadiance: row.slice(8, 11),
      solarAfterTransport: row.slice(0, 3).map((v, c) => v * row[c + 4]) } }];
}));
const occlusion = (report) => ({
  earthPartial: { blockedDiskSamples: report.partialEarth.geometry.earthBlocked,
    clearDiskSamples: report.partialEarth.geometry.clear, hiddenReceiverMaxByteDelta: report.partialEarth.hiddenMax,
    hiddenReceiverSamples: report.partialEarth.hiddenSamples },
  terrainFull: { samples: report.terrainFull.geometry.samples, earthBlocked: report.terrainFull.geometry.earthBlocked,
    meshBlocked: report.terrainFull.geometry.meshBlocked, maxByteDelta: report.terrainFull.maxDelta,
    changedPixelsAbove1Byte: report.terrainFull.changedPixels },
  terrainRemoved: { clearDiskSamples: report.terrainRemoved.geometry.clear,
    centerSolarRadiance: report.terrainRemoved.gpu[0].slice(0, 3) },
  night: { maxByteDelta: report.nightResidual.maxDelta, visibleSky: report.nightResidual.visibleSky },
  twilight: { maxByteDelta: report.twilightResidual.maxDelta, visibleSky: report.twilightResidual.visibleSky },
});
const result = {
  status: "PASS", visualAcceptance: "AWAITING_USER_REVIEW", generatedAt: new Date().toISOString(),
  baseline: { source: before.source, sourceTree: before.provenance.runtimeTree, bundleSha256: before.bundleSha256 },
  candidate: { source: after.source, sourceTree: after.provenance.runtimeTree, bundleSha256: after.bundleSha256 },
  harnessCommit: after.provenance.harnessCommit, pairedCaptures: pairs.length, verifiedPngFiles: pairs.length * 2,
  sameState: true, invariantPairs: pairs.filter((p) => p.invariant).length,
  identicalPairs: pairs.filter((p) => p.identical).length,
  pairs, twilight: { baseline: twilight(before), candidate: twilight(after) },
  occlusion: { baseline: occlusion(before), candidate: occlusion(after) },
  limitations: [
    "Technical assertions and exact hashes do not constitute final visual acceptance.",
    "Yellow physical twilight and weak disk contrast remain; physical-only and Bloom-off controls are retained.",
    "The constant-color terrain is not solar shaded; its bright night-side appearance predates B4 and remains unresolved.",
    "Controlled smooth heightmap occluder, single GPU/browser and static captures; no B5 full matrix or temporal acceptance."
  ],
};
await writeFile(output, `${JSON.stringify(result, null, 2)  }\n`);
console.log(JSON.stringify({ status: result.status, pairedCaptures: result.pairedCaptures,
  verifiedPngFiles: result.verifiedPngFiles, invariantPairs: result.invariantPairs,
  identicalPairs: result.identicalPairs, baseline: result.baseline, candidate: result.candidate,
  twilight: result.twilight.candidate, occlusion: result.occlusion.candidate }, null, 2));
