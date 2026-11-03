import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const demo = await readFile(new URL("../../Apps/WebGPUGlobe.html", import.meta.url), "utf8");

test("public WebGPU globe demo exposes Moon and star controls", () => {
  for (const id of [
    "space-controls",
    "show-moon",
    "show-stars",
    "moonlight",
    "look-moon",
    "advance-day",
    "moon-readout",
    "space-time",
  ]) {
    assert.match(demo, new RegExp(`id=["']${id}["']`), `missing demo control: ${id}`);
  }
  assert.match(demo, /spaceControls\.disabled = false/);
  assert.match(demo, /spaceControls\.disabled = true/);
});

test("Moon and star controls update the production WebGPU scene settings", () => {
  assert.match(demo, /viewer\.scene\.moon\.show = event\.target\.checked/);
  assert.match(demo, /viewer\.scene\.stars\.show = event\.target\.checked/);
  assert.match(demo, /viewer\.scene\.moon\.moonlightIntensity = Number\(event\.target\.value\)/);
  assert.match(demo, /scene\._planetState\?\.moonIllumination/);
});

test("Look at Moon uses the current ephemeris position and camera-relative direction", () => {
  assert.match(demo, /scene\._planetState\?\._moonPosition/);
  assert.match(demo, /Cesium\.Cartesian3\.subtract\([\s\S]*?moonPosition,[\s\S]*?viewer\.camera\.positionWC/);
  assert.match(demo, /viewer\.camera\.setView\(\{ orientation: \{ direction, up \} \}\)/);
});

test("expanded control panel remains usable on short viewports", () => {
  assert.match(demo, /max-height: calc\(100vh - 40px\)/);
  assert.match(demo, /overflow-y: auto/);
});
