import assert from "node:assert/strict";
import { test } from "node:test";
import { assessTerrainFlight } from "./m1-terrain-flight.mjs";

function flight() {
  return {
    scenario: "space-to-real-terrain-ground",
    complete: true,
    frames: 18,
    maximumUntextured: 0,
    final: { background: 0, untextured: 0 },
    requestedHeight: 5300,
    minimumZoomDistance: 1,
    cameraHeight: 5300,
    terrainHeight: 5266,
    aboveGround: 34,
    settled: { statistics: { levels: [19, 20] } },
    observations: [
      {
        coverage: { accepted: true, untextured: 0 },
        height: 5300,
        globeHeight: 5266,
      },
    ],
  };
}

test("a successful real terrain flight remains an actual passing observation", () => {
  assert.equal(assessTerrainFlight(flight()).status, "PASS");
});

test("only the evidenced near-ground coarse-mesh collision is nonblocking", () => {
  const data = flight();
  data.observations.push({
    coverage: { accepted: false, background: 87, untextured: 0 },
    cameraUnderground: true,
    height: 5381,
    globeHeight: 5450,
    heightSources: [{ terrainState: 6 }],
    heightSource: { gpu: true, terrainState: 6, height: 5450 },
  });
  assert.equal(assessTerrainFlight(data).status, "KNOWN_UNRESOLVED");
});

test("an excessive final height requires evidence of the native collision clamp", () => {
  const data = flight();
  data.cameraHeight = 7364;
  data.aboveGround = 2098;
  assert.equal(assessTerrainFlight(data).status, "FAIL");
  data.observations.push({
    coverage: { accepted: true, untextured: 0 },
    height: 7364,
    globeHeight: 7363,
  });
  assert.equal(assessTerrainFlight(data).status, "KNOWN_UNRESOLVED");
});

test("holes outside the diagnosed underground descent still fail", () => {
  const data = flight();
  data.observations.push({
    coverage: { accepted: false, background: 47118, untextured: 0 },
    cameraUnderground: false,
    height: 24796,
    globeHeight: 3516,
  });
  assert.equal(assessTerrainFlight(data).status, "FAIL");
});

test("a READY ancestor does not authorize an unrelated fill-height failure", () => {
  const data = flight();
  data.observations.push({
    coverage: { accepted: false, background: 87, untextured: 0 },
    cameraUnderground: true,
    height: 5381,
    globeHeight: 5450,
    heightSources: [{ terrainState: 6 }],
    heightSource: { gpu: false, terrainState: 0, height: 5450 },
  });
  assert.equal(assessTerrainFlight(data).status, "FAIL");
});

test("an earlier clamp cannot authorize an unrelated higher endpoint", () => {
  const data = flight();
  data.cameraHeight = 50000;
  data.aboveGround = 44734;
  data.observations.push({
    coverage: { accepted: true, untextured: 0 },
    height: 7364,
    globeHeight: 7363,
  });
  assert.equal(assessTerrainFlight(data).status, "FAIL");
});

test("the exception cannot waive imagery, settled coverage, completion, LOD or below-ground endpoints", () => {
  const variants = [
    { maximumUntextured: 1 },
    { final: { background: 1, untextured: 0 } },
    { complete: false },
    { settled: { statistics: { levels: [5] } } },
    { aboveGround: -10 },
    { scenario: "ordinary-orbit" },
  ];
  for (const change of variants) {
    assert.equal(
      assessTerrainFlight({ ...flight(), ...change }).status,
      "FAIL",
    );
  }
});
