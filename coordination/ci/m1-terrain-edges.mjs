// Pure acceptance oracle: exact maximum between piecewise-linear edge profiles.
export function compareTerrainEdges(first, second) {
  function normalize(profile) {
    if (profile.length < 2) {
      throw new Error("An edge needs at least two knots");
    }
    const sorted = [...profile].sort((a, b) => a.coordinate - b.coordinate);
    const result = [];
    for (const point of sorted) {
      if (
        !Number.isFinite(point.coordinate) ||
        !Number.isFinite(point.height)
      ) {
        throw new Error("Edge coordinates and heights must be finite");
      }
      const previous = result.at(-1);
      if (previous?.coordinate === point.coordinate) {
        if (Math.abs(previous.height - point.height) > 1e-6) {
          throw new Error("Repeated edge coordinate has inconsistent heights");
        }
      } else {
        result.push(point);
      }
    }
    if (result.length < 2) {
      throw new Error("An edge needs a nonzero interval");
    }
    return result;
  }
  const a = normalize(first);
  const b = normalize(second);
  const low = Math.max(a[0].coordinate, b[0].coordinate);
  const high = Math.min(a.at(-1).coordinate, b.at(-1).coordinate);
  if (high <= low) {
    return { overlap: false, knots: 0, maximumHeightDifference: 0 };
  }
  const knots = [
    ...new Set([
      low,
      high,
      ...a.map((p) => p.coordinate),
      ...b.map((p) => p.coordinate),
    ]),
  ]
    .filter((x) => x >= low && x <= high)
    .sort((x, y) => x - y);
  function at(profile, x) {
    let i = 1;
    while (i < profile.length - 1 && profile[i].coordinate < x) {
      ++i;
    }
    const p = profile[i - 1];
    const q = profile[i];
    return (
      p.height +
      ((q.height - p.height) * (x - p.coordinate)) /
        (q.coordinate - p.coordinate)
    );
  }
  let maximumHeightDifference = 0;
  let coordinateAtMaximum = low;
  for (const x of knots) {
    const difference = Math.abs(at(a, x) - at(b, x));
    if (difference > maximumHeightDifference) {
      maximumHeightDifference = difference;
      coordinateAtMaximum = x;
    }
  }
  return {
    overlap: true,
    knots: knots.length,
    maximumHeightDifference,
    coordinateAtMaximum,
  };
}
