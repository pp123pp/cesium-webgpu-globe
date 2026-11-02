// The user explicitly permits the repeatedly reproduced fast real-terrain
// descent issue to remain nonblocking. Keep it a failure observation, not PASS.
// Ordinary navigation, LOD transitions, imagery and cleanup have separate gates.
import TerrainState from "../../packages/engine/Source/Scene/TerrainState.js";
export function assessTerrainFlight(flight) {
  const failures = [];
  const known = [];
  if (
    flight.scenario !== "space-to-real-terrain-ground" ||
    !flight.complete ||
    flight.frames <= 2
  ) {
    failures.push("flight scenario or completion");
  }
  if (
    flight.maximumUntextured !== 0 ||
    flight.final.background !== 0 ||
    flight.final.untextured !== 0
  ) {
    failures.push("imagery or settled terrain coverage");
  }
  if (
    !Number.isFinite(flight.aboveGround) ||
    flight.aboveGround < 0.8 ||
    !Number.isFinite(flight.terrainHeight) ||
    Math.max(...flight.settled.statistics.levels) < 14
  ) {
    failures.push("settled terrain height or LOD");
  }
  const uncovered = flight.observations.filter(
    ({ coverage }) => !coverage.accepted,
  );
  if (uncovered.length) {
    if (
      uncovered.every(
        (sample) =>
          sample.cameraUnderground &&
          sample.height < 15000 &&
          sample.globeHeight > sample.height &&
          sample.coverage.untextured === 0 &&
          sample.heightSource?.gpu &&
          sample.heightSource.terrainState === TerrainState.READY &&
          Math.abs(sample.heightSource.height - sample.globeHeight) < 1e-6,
      )
    ) {
      known.push(
        "transient entry into loaded coarse terrain during fast descent",
      );
    } else {
      failures.push("unexplained in-flight terrain coverage");
    }
  }
  if (flight.aboveGround >= 150) {
    const clamped = flight.observations.some(
      ({ height, globeHeight }) =>
        Number.isFinite(globeHeight) &&
        globeHeight > flight.requestedHeight &&
        Math.abs(height - flight.cameraHeight) < 0.01 &&
        Math.abs(height - globeHeight - flight.minimumZoomDistance) < 0.01,
    );
    if (flight.cameraHeight > flight.requestedHeight && clamped) {
      known.push(
        "coarse-terrain collision leaves the flight above its requested height",
      );
    } else {
      failures.push("unexplained flight destination height");
    }
  }
  return {
    status: failures.length
      ? "FAIL"
      : known.length
        ? "KNOWN_UNRESOLVED"
        : "PASS",
    failures,
    known,
  };
}
