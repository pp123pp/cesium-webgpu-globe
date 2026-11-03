import assert from "node:assert/strict";

// Every capture is a complete recipe. Changing capture order must not change
// Bloom, effect isolation, exposure, or camera orientation in a later image.
export function b1CaptureConfig({
  mode = "combined", view = "low-orbit", width = 1920, exposure = 1,
  fov = 24, yaw = 0, pitch = 0, seconds = 0, elevationOffset = 0.05,
} = {}) {
  assert.ok(["disc-only", "rays-only", "combined"].includes(mode));
  const combined = mode === "combined";
  return {
    time: new Date(Date.parse("2026-03-20T12:00:00Z") + seconds * 1000).toISOString(),
    shouldAnimate: false,
    viewport: { width, height: width * 9 / 16 },
    resolutionScale: 1,
    useBrowserRecommendedResolution: true,
    camera: { view, height: view === "high-orbit" ? 35786000 : 400000,
      fovDegrees: fov, yaw, pitch, elevationOffset, near: 0.1, far: 500000000 },
    controls: {
      exposure,
      bloomStrength: combined ? 0.35 : 0,
      solarEffects: { rays: mode === "disc-only" ? 0 : 1,
        softHalo: combined ? 1 : 0, wideHalo: combined ? 1 : 0,
        corona: combined ? 1 : 0, tint: combined ? 1 : 0 },
      sun: { show: true, angularRadius: 0.00465,
        displayScale: Math.PI * Math.sin(0.00465) ** 2 / 2,
        glowStrength: 0.08, glowRadius: 0.05 },
      atmosphere: { show: true, rayleighScattering: [5.802e-6, 13.558e-6, 33.1e-6],
        mieScattering: 3.996e-6, mieExtinction: 4.44e-6,
        rayleighScaleHeight: 8000, mieScaleHeight: 1200, mieAnisotropy: 0.8,
        lightIntensity: 10, multipleScatteringStrength: 1 },
      moon: { show: false, moonlightIntensity: 0.0025 },
      stars: { show: false, intensity: 1 },
    },
    mode,
    role: combined ? "primary-comparison" : "effect-isolation-diagnostic",
    isolation: mode === "rays-only"
      ? "Ray effects isolated; the physical analytic disc is retained."
      : combined ? "All existing solar effects and Bloom enabled."
        : "Analytic disc; rays, halo, corona, tint and Bloom disabled.",
  };
}

// This function is also serialized verbatim into the browser; keep it free of
// module closures so the unit regression exercises the actual reset operation.
export function applyB1Controls(scene, controls) {
  for (const name of ["sun", "atmosphere", "moon", "stars"]) {
    Object.assign(scene[name], JSON.parse(JSON.stringify(controls[name])));
  }
  scene.exposure = controls.exposure;
  scene._atmosphere.bloomStrength = controls.bloomStrength;
  Object.assign(scene._atmosphere.solarEffects, controls.solarEffects);
}

export function assertB1Pair(first, second, change = "none") {
  const left = JSON.parse(JSON.stringify(first));
  const right = JSON.parse(JSON.stringify(second));
  if (change === "exposure") {
    delete left.controls.exposure;
    delete right.controls.exposure;
  } else if (change === "resolution") {
    delete left.viewport;
    delete right.viewport;
  } else if (change === "orientation") {
    assert.deepEqual(left.camera.position, right.camera.position, "off-axis camera origin must stay fixed");
    for (const state of [left, right]) {
      delete state.camera.direction;
      delete state.camera.up;
      delete state.camera.right;
    }
  } else {
    assert.equal(change, "none");
  }
  assert.deepEqual(left, right, `capture pair may differ only by ${change}`);
}

export function b1StaticCaptures(preview = false) {
  const rows = [];
  const add = (id, options) => rows.push({ id, config: b1CaptureConfig(options) });
  for (const exposure of [0.5, 1, 2]) {
    add(`disc-low-1080-e${exposure}`, { mode: "disc-only", exposure });
    add(`disc-zoom-1080-e${exposure}`, { mode: "disc-only", exposure, fov: 4 });
  }
  add("rays-low-1080-e1", { mode: "rays-only" });
  add("combined-low-1080-e1", {});
  for (const effect of ["corona", "rays"]) {
    const config = b1CaptureConfig();
    config.controls.solarEffects[effect] = 0;
    config.role = "layer-attribution-diagnostic";
    config.isolation = `Combined scene with only ${effect} disabled; all other controls, including Bloom=0.35, retained.`;
    rows.push({ id: `diagnostic-${effect}-off-1080-e1`, config });
  }
  if (preview) { return rows; }
  add("rays-low-720-e1", { mode: "rays-only", width: 1280 });
  for (const exposure of [0.5, 2]) {
    add(`combined-low-1080-e${exposure}`, { exposure });
  }
  add("combined-off-axis-1080-e1", { yaw: 0.09 });
  // Deliberately follows the off-axis capture: this caught the original
  // inherited Bloom=0 / inherited camera regression.
  add("combined-low-720-e1", { width: 1280 });
  add("combined-high-1080-e1", { view: "high-orbit" });
  add("combined-limb-1080-e1", { view: "limb" });
  add("combined-normal60-1080-e1", { fov: 60 });
  return rows;
}

export function b1MotionCapture(frame) {
  const limb = frame >= 120;
  const exposure = frame < 128 ? 1 : frame < 136 ? 0.5 : frame < 152 ? 2 : 1;
  const config = b1CaptureConfig({ view: limb ? "limb" : "high-orbit",
    width: frame < 144 ? 1920 : 1280,
    exposure, seconds: frame * 0.5,
    yaw: limb ? -0.012 + (frame - 120) * 0.0006 : -0.035 + frame * 0.0006,
    pitch: 0.003 * Math.sin(frame * Math.PI / 60),
    elevationOffset: limb ? 0.45 - (frame - 120) * 0.9 / 39 : 0.05 });
  const intentionalDiscontinuities = [];
  if (frame === 120) { intentionalDiscontinuities.push("high-orbit-to-limb-scene-reset"); }
  if ([128, 136, 152].includes(frame)) { intentionalDiscontinuities.push("exposure"); }
  if (frame === 144) { intentionalDiscontinuities.push("resize"); }
  return { id: `motion-${String(frame).padStart(3, "0")}`, config, frame,
    intentionalDiscontinuities };
}

// Display-encoded pixels from the unmodified canvas. Regional statistics are
// descriptive evidence, not a substitute for physical radiance/occlusion gates.
// Ray samples use projected solar tangent directions supplied by the browser,
// so camera motion cannot rotate a screen-space sampling pattern over the rays.
export function diagnoseB1Canvas(image, geometry) {
  const { width, height, data } = image;
  const { center, diskRadiusPixels: disk, glowRadiusPixels: glow, rayPoints } = geometry;
  const luminance = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const definitions = [
    ["discCore", 0, disk * 0.5], ["discLimb", disk * 0.75, disk],
    ["discEdge", disk * 0.95, disk * 1.1],
    ["innerGlow", disk * 1.3, glow * 0.25],
    ["raysInner", glow * 0.25, glow * 0.55],
    ["raysOuter", glow * 0.55, glow * 0.9],
    ["outsideSource", glow * 1.05, glow * 1.3],
  ];
  const buckets = definitions.map(([name, inner, outer]) => ({ name, inner, outer,
    sum: [0, 0, 0], values: [], white: 0, clipped: 0 }));
  const extent = glow * 1.3;
  for (let y = Math.max(0, Math.floor(center[1] - extent)); y < Math.min(height, Math.ceil(center[1] + extent)); y++) {
    for (let x = Math.max(0, Math.floor(center[0] - extent)); x < Math.min(width, Math.ceil(center[0] + extent)); x++) {
      const radius = Math.hypot(x + 0.5 - center[0], y + 0.5 - center[1]);
      const offset = (y * width + x) * 4;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      for (const region of buckets) {
        if (radius < region.inner || radius >= region.outer) { continue; }
        region.values.push(luminance(rgb));
        for (let channel = 0; channel < 3; channel++) { region.sum[channel] += rgb[channel]; }
        region.white += Number(rgb.every((channel) => channel >= 250));
        region.clipped += Number(rgb.some((channel) => channel === 255));
      }
    }
  }
  const regions = {};
  for (const region of buckets) {
    const values = region.values.sort((a, b) => a - b);
    const count = values.length;
    regions[region.name] = { innerRadiusPixels: region.inner, outerRadiusPixels: region.outer,
      count, meanRgb: count ? region.sum.map((sum) => sum / count) : null,
      meanLuminance: count ? values.reduce((a, b) => a + b, 0) / count : null,
      p05: count ? values[Math.floor((count - 1) * 0.05)] : null,
      p50: count ? values[Math.floor((count - 1) * 0.5)] : null,
      p95: count ? values[Math.floor((count - 1) * 0.95)] : null,
      nearlyWhiteFraction: count ? region.white / count : null,
      anyChannel255Fraction: count ? region.clipped / count : null,
      clippedByViewport: center[0] < region.outer || center[1] < region.outer ||
        center[0] + region.outer >= width || center[1] + region.outer >= height };
  }
  const sample = (point) => {
    // Projected positions describe pixel centers; subtract 0.5 before bilinear sampling.
    const x = point[0] - 0.5, y = point[1] - 0.5;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) { return null; }
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const read = (px, py) => {
      const offset = (py * width + px) * 4;
      return luminance([data[offset], data[offset + 1], data[offset + 2]]);
    };
    return (1 - fy) * ((1 - fx) * read(ix, iy) + fx * read(ix + 1, iy)) +
      fy * ((1 - fx) * read(ix, iy + 1) + fx * read(ix + 1, iy + 1));
  };
  const trackedRayLuminance = rayPoints.map(sample);
  return { space: "display-encoded RGB, Rec.709 weighted; no pixel editing",
    regions, trackedRayLuminance,
    validTrackedSamples: trackedRayLuminance.filter((value) => value !== null).length };
}

export function b1TrackedDelta(previous, current) {
  assert.equal(previous.length, current.length);
  const differences = current.flatMap((value, i) => value === null || previous[i] === null
    ? [] : [Math.abs(value - previous[i])]).sort((a, b) => a - b);
  assert.ok(differences.length, "tracked region must have overlapping visible samples");
  return { samples: differences.length,
    mean: differences.reduce((a, b) => a + b, 0) / differences.length,
    p99: differences[Math.floor((differences.length - 1) * 0.99)],
    max: differences.at(-1) };
}
