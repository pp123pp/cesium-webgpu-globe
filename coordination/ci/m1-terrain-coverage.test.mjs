import assert from "node:assert/strict";
import { test } from "node:test";
import { assessTerrainCoverage } from "./m1-terrain-coverage.mjs";

const software = { description: "SwiftShader Device (Subzero)" };
const sample = (x, y, fill = true) => ({
  x,
  y,
  hits: [{ fill, distance: 10, key: "12/6075/1410" }],
});
const assessment = (pixels, extra = {}) =>
  assessTerrainCoverage({
    background: pixels.length,
    untextured: 0,
    pixels,
    adapter: software,
    width: 1280,
    height: 720,
    ...extra,
  });

test("fully covered geometry needs no visual exception", () => {
  assert.equal(assessment([]).classification, "complete");
});

test("isolated software fill samples with actual CPU geometry are recorded", () => {
  const result = assessment([
    sample(1259, 98),
    sample(1256, 100),
    sample(1253, 102),
    sample(1194, 141),
  ]);
  assert.equal(result.accepted, true);
  assert.equal(result.classification, "software-fill-raster-difference");
});

test("the same difference is not implicitly waived on an unverified GPU", () => {
  assert.equal(
    assessment([sample(10, 10)], { adapter: { vendor: "NVIDIA" } }).accepted,
    false,
  );
});

test("real missing geometry and uncovered imagery still fail", () => {
  assert.equal(assessment([{ x: 10, y: 10, hits: [] }]).accepted, false);
  assert.equal(assessment([sample(10, 10, false)]).accepted, false);
  assert.equal(assessment([], { untextured: 1 }).accepted, false);
});

test("large gaps, connected cracks and incomplete sampling still fail", () => {
  assert.equal(
    assessment([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => sample(i * 3, 10)))
      .accepted,
    false,
  );
  assert.equal(
    assessment([sample(10, 10), sample(11, 11), sample(12, 12)]).accepted,
    false,
  );
  assert.equal(assessment([sample(10, 10)], { background: 4 }).accepted, false);
});
