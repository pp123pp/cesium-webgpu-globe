/* global window, Cesium */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function installB4Probe(page) {
  await page.evaluate(() => {
    const { viewer } = window.__m1;
    const scene = viewer.scene;
    const sun = window.__m2Sun;
    const b4 = (window.__b4 = {});
    b4.effects = { ...scene._atmosphere.solarEffects };
    b4.mode = (mode = "all") => {
      scene.sun.show = mode !== "sun-off";
      scene.sun.glowStrength = mode === "physical-only" || mode === "physical-no-bloom" ? 0 : 0.08;
      scene.sun.glowRadius = 0.05;
      for (const key of Object.keys(b4.effects)) {
        scene._atmosphere.solarEffects[key] =
          mode === "physical-only" || mode === "physical-no-bloom" ? 0 : b4.effects[key];
      }
      scene._atmosphere.bloomStrength = mode === "bloom-off" || mode === "physical-no-bloom" ? 0 : 0.35;
      b4.currentMode = mode;
      viewer.render();
    };
    b4.view = ({ height, elevation, limbOffset, cameraElevation, groundFacing = false, fov = 12 }) => {
      const limb = sun.limbElevation(height);
      const actualElevation = limbOffset === undefined ? elevation : limb + limbOffset;
      const origin = sun.originAtElevation(height, actualElevation);
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin, new Cesium.Cartesian3());
      let direction = sun.nativeSun();
      if (groundFacing) {
        direction = Cesium.Cartesian3.negate(normal, new Cesium.Cartesian3());
      } else if (cameraElevation !== undefined) {
        const tangent = Cesium.Cartesian3.subtract(direction,
          Cesium.Cartesian3.multiplyByScalar(normal, Cesium.Cartesian3.dot(direction, normal), new Cesium.Cartesian3()),
          new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(tangent, tangent);
        const angle = Cesium.Math.toRadians(cameraElevation);
        direction = Cesium.Cartesian3.add(
          Cesium.Cartesian3.multiplyByScalar(tangent, Math.cos(angle), tangent),
          Cesium.Cartesian3.multiplyByScalar(normal, Math.sin(angle), new Cesium.Cartesian3()),
          new Cesium.Cartesian3());
      }
      viewer.camera.frustum = new Cesium.PerspectiveFrustum({
        fov: Cesium.Math.toRadians(fov), aspectRatio: viewer.canvas.width / viewer.canvas.height,
        near: 0.1, far: 500000000,
      });
      sun.look(origin, direction);
      scene.exposure = 1;
      scene.atmosphere.show = true;
      b4.mode();
      return { height, sunElevationDegrees: actualElevation, limbElevationDegrees: limb,
        limbOffsetDegrees: actualElevation - limb, cameraElevation, groundFacing };
    };
    b4.snapshot = () => {
      const camera = viewer.camera;
      const position = camera.positionCartographic;
      const vector = (v) => [v.x, v.y, v.z];
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(camera.positionWC, new Cesium.Cartesian3());
      let earth = 0;
      let sky = 0;
      for (const y of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          if (sun.earthHit(sun.rayAt(x * viewer.canvas.width, y * viewer.canvas.height))) { earth++; }
          else { sky++; }
        }
      }
      return {
        time: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
        camera: { position: vector(camera.positionWC), direction: vector(camera.directionWC), up: vector(camera.upWC),
          longitudeDegrees: Cesium.Math.toDegrees(position.longitude), latitudeDegrees: Cesium.Math.toDegrees(position.latitude),
          heightMeters: position.height, elevationDegrees: Cesium.Math.toDegrees(Math.asin(Cesium.Cartesian3.dot(camera.directionWC, normal))),
          fovRadians: camera.frustum.fov, fovyRadians: camera.frustum.fovy,
          aspectRatio: camera.frustum.aspectRatio, near: camera.frustum.near, far: camera.frustum.far },
        sun: { direction: vector(sun.nativeSun()), elevationDegrees: Cesium.Math.toDegrees(Math.asin(Cesium.Cartesian3.dot(sun.nativeSun(), normal))),
          angularRadius: scene.sun.angularRadius, projectedCenter: sun.project(sun.nativeSun()), show: scene.sun.show,
          glowStrength: scene.sun.glowStrength, glowRadius: scene.sun.glowRadius },
        exposure: scene.exposure, mode: b4.currentMode, atmosphere: window.__m2Atmosphere.settings(),
        solarEffects: { ...scene._atmosphere.solarEffects }, bloomStrength: scene._atmosphere.bloomStrength,
        viewport: [viewer.canvas.width, viewer.canvas.height], devicePixelRatio: window.devicePixelRatio,
        framing: { skyRays: sky, earthRays: earth },
        terrain: { provider: b4.mountain ? "6000 m Gaussian CustomHeightmapTerrainProvider, real rendered mesh" : "EllipsoidTerrainProvider",
          tilesLoaded: scene.globe.tilesLoaded,
          selectedMeshes: scene._renderer._draws.map(({ tile }) => [tile.level, tile.x, tile.y]) },
      };
    };
    b4.diskGeometry = () => {
      const center = sun.project(sun.nativeSun());
      const radius = Math.tan(scene.sun.angularRadius) * viewer.canvas.width * viewer.camera.frustum.projectionMatrix[0] / 2;
      const points = [];
      for (let y = -5; y <= 5; y++) {
        for (let x = -5; x <= 5; x++) {
          if (x * x + y * y > 25) { continue; }
          const pixel = [center[0] + radius * 0.98 * x / 5, center[1] + radius * 0.98 * y / 5];
          const ray = sun.rayAt(...pixel);
          const earth = Boolean(sun.earthHit(ray));
          const picked = scene.globe.pick(ray, scene);
          points.push({ pixel, earth, mesh: Boolean(picked),
            meshHeight: picked ? Cesium.Ellipsoid.WGS84.cartesianToCartographic(picked).height : null });
        }
      }
      return { center, radiusPixels: radius, samples: points.length,
        earthBlocked: points.filter((p) => p.earth).length,
        meshBlocked: points.filter((p) => p.mesh).length,
        clear: points.filter((p) => !p.earth && !p.mesh).length, points };
    };
    b4.imageMetrics = (image) => {
      const center = sun.project(sun.nativeSun());
      const radius = Math.tan(scene.sun.angularRadius) * image.width * viewer.camera.frustum.projectionMatrix[0] / 2;
      const groups = { disk: [], annulus: [], sky: [], surface: [] };
      const decode = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      for (let y = 0; y < image.height; y += 3) {
        for (let x = 0; x < image.width; x += 3) {
          const offset = (y * image.width + x) * 4;
          const rgb = Array.from(image.data.slice(offset, offset + 3));
          const distance = Math.hypot(x - center[0], y - center[1]) / radius;
          if (distance < 0.65) { groups.disk.push(rgb); }
          else if (distance > 1.5 && distance < 2.5) { groups.annulus.push(rgb); }
          if (x < image.width * 0.2 && y < image.height * 0.2) { groups.sky.push(rgb); }
          if (x < image.width * 0.2 && y > image.height * 0.8) { groups.surface.push(rgb); }
        }
      }
      return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, {
        count: values.length,
        rgbMean: [0, 1, 2].map((c) => values.reduce((sum, v) => sum + v[c], 0) / Math.max(values.length, 1)),
        displayLinearLuminanceMean: values.reduce((sum, v) => sum + 0.2126 * decode(v[0]) + 0.7152 * decode(v[1]) + 0.0722 * decode(v[2]), 0) / Math.max(values.length, 1),
        anyChannel254Fraction: values.filter((v) => Math.max(...v) >= 254).length / Math.max(values.length, 1),
      }]));
    };
    b4.occlusion = async () => {
      const current = b4.currentMode;
      b4.mode("sun-off");
      const off = window.__m1.pixels();
      b4.mode("all");
      const on = window.__m1.pixels();
      let maxDelta = 0;
      let changedPixels = 0;
      let hiddenMax = 0;
      let hiddenSamples = 0;
      for (let i = 0; i < on.data.length; i += 4) {
        const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(on.data[i + c] - off.data[i + c])));
        maxDelta = Math.max(maxDelta, delta);
        if (delta > 1) { changedPixels++; }
      }
      const center = sun.centerPixel();
      const radius = Math.ceil(Math.tan(scene.sun.glowRadius) * on.width * viewer.camera.frustum.projectionMatrix[0] / 2) + 24;
      for (let y = Math.max(3, center[1] - radius); y < Math.min(on.height - 3, center[1] + radius); y += 3) {
        for (let x = Math.max(3, center[0] - radius); x < Math.min(on.width - 3, center[0] + radius); x += 3) {
          const hidden = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
            Boolean(sun.earthHit(sun.rayAt(x + dx + 0.5, y + dy + 0.5))));
          if (hidden) {
            hiddenSamples++;
            const i = (y * on.width + x) * 4;
            hiddenMax = Math.max(hiddenMax, ...[0, 1, 2].map((c) => Math.abs(on.data[i + c] - off.data[i + c])));
          }
        }
      }
      const geometry = b4.diskGeometry();
      const samplePixels = [center, ...[[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]].map(([x, y]) =>
        [Math.floor(center[0] + x * geometry.radiusPixels), Math.floor(center[1] + y * geometry.radiusPixels)])];
      const gpu = await sun.probe(samplePixels);
      b4.mode(current);
      return { maxDelta, changedPixels, hiddenMax, hiddenSamples, geometry, samplePixels, gpu,
        note: "Sun toggles do not disable physical atmospheric illumination; residual twilight is tested by same-state subtraction." };
    };
  });
}

export async function captureB4(page, report, output, name, details = {}) {
  const captured = await page.evaluate(() => {
    const state = window.__m1;
    const image = state.pixels();
    const snapshot = window.__b4.snapshot();
    // Preserve the native WebGPU canvas in the same task as the render/readback.
    // No rescaling, recoloring or generated pixels.
    return { png: state.viewer.canvas.toDataURL("image/png"), snapshot,
      metrics: window.__b4.imageMetrics(image), errors: [...state.errors] };
  });
  const bytes = Buffer.from(captured.png.split(",")[1], "base64");
  const result = { name, ...details, ...captured.snapshot, metrics: captured.metrics, errors: captured.errors,
    pngSha256: hash(bytes) };
  await writeFile(path.join(output, `${name  }.png`), bytes);
  report.scenes.push(result);
  return result;
}

export async function fileHashes(root, files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(path.join(root, file)))])));
}
