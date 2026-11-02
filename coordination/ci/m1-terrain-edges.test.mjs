import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTerrainEdges } from "./m1-terrain-edges.mjs";

test("all edge knots detect a localized 100m seam missed by nine uniform samples", () => {
  const first = [0, 0.05, 0.1, 1].map((coordinate) => ({
    coordinate,
    height: coordinate === 0.05 ? 100 : 0,
  }));
  const second = [
    { coordinate: 0, height: 0 },
    { coordinate: 1, height: 0 },
  ];
  const result = compareTerrainEdges(first, second);
  assert.equal(result.maximumHeightDifference, 100);
  assert.equal(result.coordinateAtMaximum, 0.05);
  assert.equal(result.knots, 4);
});
test("shared overlap uses both profiles' knots and handles equal repeated knots", () => {
  const first = [
    { coordinate: 0, height: 0 },
    { coordinate: 1, height: 2 },
    { coordinate: 1, height: 2 },
  ];
  const second = [
    { coordinate: 0.25, height: 0.5 },
    { coordinate: 0.5, height: 4 },
    { coordinate: 2, height: 4 },
  ];
  const result = compareTerrainEdges(first, second);
  assert.equal(result.maximumHeightDifference, 3);
  assert.equal(result.coordinateAtMaximum, 0.5);
});
test("invalid profiles cannot silently pass through NaN or conflicting duplicate knots", () => {
  const valid = [
    { coordinate: 0, height: 0 },
    { coordinate: 1, height: 0 },
  ];
  assert.throws(
    () =>
      compareTerrainEdges([{ coordinate: 0, height: NaN }, valid[1]], valid),
    /finite/,
  );
  assert.throws(
    () =>
      compareTerrainEdges([...valid, { coordinate: 1, height: 100 }], valid),
    /inconsistent/,
  );
  assert.throws(
    () => compareTerrainEdges([valid[0], valid[0]], valid),
    /nonzero/,
  );
});
