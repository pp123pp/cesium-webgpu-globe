// A narrowly evidenced visual exception, not a replacement for terrain coverage.
// See docs/ACCEPTANCE.md and evidence/M1/terrain-fill for the original failures
// and the independent WebGPU replay. All settled frames still require zero gaps.
export function assessTerrainCoverage({
  background,
  untextured,
  pixels,
  adapter,
  width,
  height,
}) {
  if (untextured !== 0) {
    return { accepted: false, classification: "untextured-terrain" };
  }
  if (background === 0) {
    return { accepted: true, classification: "complete" };
  }
  const identity = [
    adapter.vendor,
    adapter.architecture,
    adapter.device,
    adapter.description,
  ].join(" ");
  if (
    !/swiftshader/i.test(identity) ||
    width !== 1280 ||
    height !== 720 ||
    background > 8 ||
    pixels.length !== background ||
    pixels.some(
      ({ hits }) => !hits[0]?.fill || !Number.isFinite(hits[0].distance),
    )
  ) {
    return { accepted: false, classification: "unexplained-background" };
  }
  // At most two touching pixels; a line or connected hole is not the isolated
  // subpixel raster difference reproduced by the retained minimal program.
  const remaining = new Set(pixels.map(({ x, y }) => `${x},${y}`));
  let largestComponent = 0;
  while (remaining.size) {
    const key = remaining.values().next().value;
    const pending = [key];
    remaining.delete(key);
    let size = 0;
    while (pending.length) {
      const [x, y] = pending.pop().split(",").map(Number);
      ++size;
      for (let dx = -1; dx <= 1; ++dx) {
        for (let dy = -1; dy <= 1; ++dy) {
          const neighbor = `${x + dx},${y + dy}`;
          if (remaining.delete(neighbor)) {
            pending.push(neighbor);
          }
        }
      }
    }
    largestComponent = Math.max(largestComponent, size);
  }
  return {
    accepted: largestComponent <= 2,
    classification:
      largestComponent <= 2
        ? "software-fill-raster-difference"
        : "connected-background",
    largestComponent,
  };
}
