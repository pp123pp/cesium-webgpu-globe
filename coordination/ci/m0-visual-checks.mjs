import assert from "node:assert/strict";

const near = (pixel, color, tolerance = 4) =>
  color.every((value, i) => Math.abs(pixel[i] - value) <= tolerance);

export function inspectGlobePixels(
  pixels,
  width,
  height,
  { background, surface },
) {
  assert.equal(pixels.length, width * height * 4, "Invalid pixel dimensions");
  const sample = (x, y) =>
    Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
  const center = sample(Math.floor(width / 2), Math.floor(height / 2));
  const corner = sample(2, 2);
  assert.ok(near(center, surface), `Globe center surface missing: ${center}`);
  assert.ok(near(corner, background), `Background mismatch: ${corner}`);
  let surfacePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    assert.equal(pixels[i + 3], 255, "Rendered frame must be opaque");
    if (near(pixels.subarray(i, i + 4), surface)) {
      surfacePixels++;
    }
  }
  const surfaceFraction = surfacePixels / (width * height);
  assert.ok(
    surfaceFraction > 0.05 && surfaceFraction < 0.9,
    `Globe coverage invalid: ${surfaceFraction}`,
  );
  return { center, corner, surfacePixels, surfaceFraction };
}

// Tolerate raster edge differences across drivers; a missing or shifted globe
// changes far more than 0.5% of the full canvas. Never regenerate a reference here.
export function comparePixels(
  actual,
  expected,
  { channelTolerance = 4, maxChangedFraction = 0.005 } = {},
) {
  assert.equal(
    actual.length,
    expected.length,
    "Reference pixel dimensions differ",
  );
  assert.ok(
    actual.length > 0 && actual.length % 4 === 0,
    "Invalid pixel dimensions",
  );
  let changedPixels = 0;
  let maxDifference = 0;
  for (let i = 0; i < actual.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const difference = Math.abs(actual[i + c] - expected[i + c]);
      maxDifference = Math.max(maxDifference, difference);
      changed ||= difference > channelTolerance;
    }
    if (changed) {
      changedPixels++;
    }
  }
  const changedFraction = changedPixels / (actual.length / 4);
  const result = {
    changedPixels,
    changedFraction,
    maxDifference,
    channelTolerance,
    maxChangedFraction,
  };
  assert.ok(
    changedFraction <= maxChangedFraction,
    `Rendered pixels differ from reference: ${JSON.stringify(result)}`,
  );
  return result;
}
