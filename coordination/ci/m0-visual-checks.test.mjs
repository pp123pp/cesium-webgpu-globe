import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePixels, inspectGlobePixels } from "./m0-visual-checks.mjs";

const background = [8, 12, 20, 255];
const surface = [48, 112, 168, 255];
function fixture() {
  const pixels = Buffer.alloc(40 * 40 * 4);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      pixels.set(
        Math.hypot(x - 20, y - 20) < 12 ? surface : background,
        (y * 40 + x) * 4,
      );
    }
  }
  return pixels;
}
test("visible globe requires opaque center surface, background and coverage", () => {
  const pixels = fixture();
  const result = inspectGlobePixels(pixels, 40, 40, { background, surface });
  assert.ok(result.surfaceFraction > 0.2);
  const blank = Buffer.from(pixels);
  for (let i = 0; i < blank.length; i += 4) {
    blank.set(background, i);
  }
  assert.throws(
    () => inspectGlobePixels(blank, 40, 40, { background, surface }),
    /surface|Globe/,
  );
  assert.throws(
    () =>
      inspectGlobePixels(Buffer.alloc(pixels.length), 40, 40, {
        background,
        surface,
      }),
    /opaque|surface|Globe/,
  );
});
test("comparison tolerates tiny raster differences but rejects missing or shifted surfaces", () => {
  const expected = fixture();
  assert.equal(comparePixels(expected, expected).changedPixels, 0);
  const noise = Buffer.from(expected);
  noise[0] += 2;
  assert.equal(comparePixels(noise, expected).changedPixels, 0);
  const shifted = Buffer.from(expected);
  shifted.copyWithin(4 * 40 * 3, 0, shifted.length - 4 * 40 * 3);
  assert.throws(() => comparePixels(shifted, expected), /reference/);
  assert.throws(
    () => comparePixels(Buffer.alloc(expected.length), expected),
    /reference/,
  );
  assert.throws(
    () => comparePixels(expected.subarray(4), expected),
    /dimensions/,
  );
});
