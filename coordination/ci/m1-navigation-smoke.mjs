/* global Cesium, window, GPUDevice, GPUBuffer, GPUTexture, requestAnimationFrame, performance */
import assert from "node:assert/strict";
import console from "node:console";
import {
  runM1BrowserSuite,
  installM1Scene,
  captureM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";

// This is a real browser/GPU gate. Instrumentation delegates to the native GPU
// APIs; the deliberately incorrect depth pipeline is an explicit negative control.
await runM1BrowserSuite("navigation", async ({ page, report, output }) => {
  report.consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });
  await page.evaluate(() => {
    const buffers = new Map();
    const textures = new Map();
    const counts = {
      buffersCreated: 0,
      buffersDestroyed: 0,
      texturesCreated: 0,
      texturesDestroyed: 0,
      peakBuffers: 0,
      peakTextures: 0,
    };
    const original = {
      createBuffer: GPUDevice.prototype.createBuffer,
      destroyBuffer: GPUBuffer.prototype.destroy,
      createTexture: GPUDevice.prototype.createTexture,
      destroyTexture: GPUTexture.prototype.destroy,
      createPipeline: GPUDevice.prototype.createRenderPipelineAsync,
    };
    const gpu = (window.__navigationGpu = {
      snapshot: () => ({
        ...counts,
        activeBuffers: buffers.size,
        activeTextures: textures.size,
        bufferBytes: [...buffers.values()].reduce((sum, size) => sum + size, 0),
      }),
      restore: () => {
        GPUDevice.prototype.createBuffer = original.createBuffer;
        GPUBuffer.prototype.destroy = original.destroyBuffer;
        GPUDevice.prototype.createTexture = original.createTexture;
        GPUTexture.prototype.destroy = original.destroyTexture;
        GPUDevice.prototype.createRenderPipelineAsync = original.createPipeline;
      },
    });
    GPUDevice.prototype.createBuffer = function (descriptor) {
      const buffer = original.createBuffer.call(this, descriptor);
      buffers.set(buffer, buffer.size);
      ++counts.buffersCreated;
      counts.peakBuffers = Math.max(counts.peakBuffers, buffers.size);
      return buffer;
    };
    GPUBuffer.prototype.destroy = function () {
      if (buffers.delete(this)) {
        ++counts.buffersDestroyed;
      }
      return original.destroyBuffer.call(this);
    };
    GPUDevice.prototype.createTexture = function (descriptor) {
      const texture = original.createTexture.call(this, descriptor);
      textures.set(texture, descriptor.label ?? "unlabelled");
      ++counts.texturesCreated;
      counts.peakTextures = Math.max(counts.peakTextures, textures.size);
      return texture;
    };
    GPUTexture.prototype.destroy = function () {
      if (textures.delete(this)) {
        ++counts.texturesDestroyed;
      }
      return original.destroyTexture.call(this);
    };
    GPUDevice.prototype.createRenderPipelineAsync = function (descriptor) {
      if (descriptor.label === "WGS84 two-sided terrain") {
        gpu.opaqueDescriptor = descriptor;
      }
      return original.createPipeline.call(this, descriptor);
    };
  });
  await installM1Scene(page);
  await page.waitForFunction(
    () => window.__m1.viewer.imageryLayers.get(0).ready,
  );
  report.providers = await page.evaluate(() => {
    const state = window.__m1;
    const { viewer } = state;
    const provider = viewer.imageryLayers.get(0).imageryProvider;
    state.watchImagery(provider, "local NaturalEarthII");
    const nav = (window.__navigation = {});
    nav.camera = () => {
      const camera = viewer.camera;
      const { positionCartographic: p } = camera;
      const axes = [camera.directionWC, camera.upWC, camera.rightWC];
      return {
        position: [
          camera.positionWC.x,
          camera.positionWC.y,
          camera.positionWC.z,
        ],
        longitude: Cesium.Math.toDegrees(p.longitude),
        latitude: Cesium.Math.toDegrees(p.latitude),
        height: p.height,
        radius: Cesium.Cartesian3.magnitude(camera.positionWC),
        axesError: Math.max(
          ...axes.map((axis) =>
            Math.abs(Cesium.Cartesian3.magnitude(axis) - 1),
          ),
          Math.abs(Cesium.Cartesian3.dot(axes[0], axes[1])),
          Math.abs(Cesium.Cartesian3.dot(axes[1], axes[2])),
          Math.abs(Cesium.Cartesian3.dot(axes[2], axes[0])),
        ),
        finite: [
          ...Cesium.Matrix4.toArray(camera.viewMatrix),
          ...Cesium.Matrix4.toArray(camera.frustum.projectionMatrix),
        ].every(Number.isFinite),
      };
    };
    nav.tick = async (count) => {
      for (let i = 0; i < count; ++i) {
        try {
          viewer.render();
        } catch (error) {
          throw new Error(
            `Native render failed: ${String(error)}\n${error.stack}\n${state.errors.join("\n")}`,
            { cause: error },
          );
        }
        await new Promise(requestAnimationFrame);
      }
    };
    nav.difference = (a, b) => {
      let changed = 0;
      let maximum = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        );
        if (delta > 0) {
          ++changed;
        }
        maximum = Math.max(maximum, delta);
      }
      return { changedPixels: changed, maximumChannelDifference: maximum };
    };
    nav.coverage = () => {
      const { data, width, height } = state.pixels();
      let checked = 0;
      let expectedGlobe = 0;
      let disagreements = 0;
      let interiorBlackPixels = 0;
      for (let y = 16; y < height; y += 24) {
        for (let x = 16; x < width; x += 24) {
          const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
          const hit = Cesium.IntersectionTests.rayEllipsoid(
            ray,
            Cesium.Ellipsoid.WGS84,
          );
          const expected = !!hit && hit.stop > 0;
          const i = (y * width + x) * 4;
          const visible = data[i] + data[i + 1] + data[i + 2] > 0;
          ++checked;
          expectedGlobe += Number(expected);
          disagreements += Number(expected !== visible);
          if (
            x > width * 0.1 &&
            x < width * 0.9 &&
            y > height * 0.1 &&
            y < height * 0.9 &&
            !visible
          ) {
            ++interiorBlackPixels;
          }
        }
      }
      return {
        checked,
        expectedGlobe,
        disagreements,
        agreement: 1 - disagreements / checked,
        interiorBlackPixels,
      };
    };
    // Compare an actual uploaded per-draw RTC matrix with native double camera
    // projection. This measures arithmetic precision, not image landmark motion.
    nav.projectControl = (longitude, latitude) => {
      const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
      const world = Cesium.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
      );
      const renderer = viewer.scene._renderer;
      const index = renderer._draws.findIndex(({ rectangle }) =>
        Cesium.Rectangle.contains(rectangle, cartographic),
      );
      if (index < 0) {
        throw new Error(
          "No drawn native terrain tile contains the precision control point",
        );
      }
      const draw = renderer._draws[index];
      const local = Cesium.Cartesian3.subtract(
        world,
        draw.tile.data.mesh.center,
        new Cesium.Cartesian3(),
      );
      const input = new Float32Array([local.x, local.y, local.z, 1]);
      const offset = (index * renderer._uniformStride) / 4;
      const uploaded = renderer._uniformValues.slice(offset, offset + 16);
      const clip = [];
      for (let row = 0; row < 4; ++row) {
        let value = Math.fround(uploaded[row] * input[0]);
        for (let column = 1; column < 4; ++column) {
          value = Math.fround(
            value + Math.fround(uploaded[column * 4 + row] * input[column]),
          );
        }
        clip.push(value);
      }
      const eye = Cesium.Matrix4.multiplyByVector(
        viewer.camera.viewMatrix,
        new Cesium.Cartesian4(world.x, world.y, world.z, 1),
        new Cesium.Cartesian4(),
      );
      const native = Cesium.Matrix4.multiplyByVector(
        viewer.camera.frustum.projectionMatrix,
        eye,
        new Cesium.Cartesian4(),
      );
      const gpuPixel = [
        ((clip[0] / clip[3] + 1) * viewer.canvas.width) / 2,
        ((1 - clip[1] / clip[3]) * viewer.canvas.height) / 2,
      ];
      const nativePixel = [
        ((native.x / native.w + 1) * viewer.canvas.width) / 2,
        ((1 - native.y / native.w) * viewer.canvas.height) / 2,
      ];
      return {
        tile: `${draw.tile.level}/${draw.tile.x}/${draw.tile.y}`,
        gpuPixel,
        nativePixel,
        errorPixels: Math.hypot(
          gpuPixel[0] - nativePixel[0],
          gpuPixel[1] - nativePixel[1],
        ),
        reversedDepth: clip[2] / clip[3],
      };
    };
    return {
      terrain: viewer.terrainProvider.constructor.name,
      imagery: provider.constructor.name,
      maximumImageryLevel: provider.maximumLevel,
      localImageryUrl: provider.url,
    };
  });
  assert.equal(report.providers.terrain, "EllipsoidTerrainProvider");
  assert.equal(report.providers.imagery, "TileMapServiceImageryProvider");
  assert.equal(report.providers.maximumImageryLevel, 2);
  assert.match(report.providers.localImageryUrl, /NaturalEarthII/);
  report.checks.push(
    "real ellipsoid provider and local NaturalEarthII imagery",
  );

  report.rotations = [];
  for (const view of [
    { name: "dateline", longitude: 179.9, latitude: 20, height: 20000000 },
    { name: "north-pole", longitude: 40, latitude: 89.5, height: 20000000 },
    { name: "south-pole", longitude: -170, latitude: -89.5, height: 20000000 },
  ]) {
    const observation = await page.evaluate(async (view) => {
      const state = window.__m1;
      await state.settle({ ...view, imagery: true });
      const before = window.__navigation.camera();
      state.viewer.camera.rotate(
        Cesium.Cartesian3.UNIT_Z,
        Cesium.Math.toRadians(15),
      );
      await state.settle({ imagery: true });
      return {
        before,
        after: window.__navigation.camera(),
        coverage: window.__navigation.coverage(),
      };
    }, view);
    report.rotations.push({ ...view, ...observation });
    assert.ok(
      Math.abs(observation.after.radius - observation.before.radius) < 0.00001,
    );
    assert.ok(observation.after.finite && observation.after.axesError < 1e-12);
    assert.ok(observation.coverage.agreement > 0.99);
    assert.ok(observation.coverage.expectedGlobe > 40);
    await captureM1Scene(
      page,
      report,
      output,
      `${view.name}-rotation`,
      observation,
    );
  }
  report.checks.push("native orbital rotations across dateline and both poles");

  console.log("M1 navigation: real GPU depth positive and negative controls");
  report.depth = await page.evaluate(async () => {
    const state = window.__m1;
    const { viewer } = state;
    const renderer = viewer.scene._renderer;
    const globe = viewer.scene.globe;
    const original = {
      draw: renderer._draw,
      pipeline: renderer._pipelineNoCull,
      culling: globe.backFaceCulling,
      cache: globe.tileCacheSize,
    };
    globe.tileCacheSize = 4096;
    try {
      await state.settle({
        longitude: 180,
        latitude: 0,
        height: 1000000,
        imagery: true,
      });
      const farSide = [...renderer._draws];
      await state.settle({
        longitude: 0,
        latitude: 0,
        height: 20000000,
        imagery: true,
      });
      const camera = Cesium.Cartesian3.normalize(
        viewer.camera.positionWC,
        new Cesium.Cartesian3(),
      );
      const behind = farSide.filter(
        ({ tile }) =>
          tile.data?.gpu &&
          tile.level >= 2 &&
          Cesium.Cartesian3.dot(
            camera,
            Cesium.Cartesian3.normalize(
              tile.data.mesh.center,
              new Cesium.Cartesian3(),
            ),
          ) < -0.7,
      );
      if (!behind.length) {
        throw new Error(
          "The depth gate requires actual cached far-side GPU terrain",
        );
      }
      globe.backFaceCulling = false;
      const baseline = state.pixels().data;
      const baselineRepeat = window.__navigation.difference(
        baseline,
        state.pixels().data,
      );
      renderer._draw = function (pass, scene) {
        this._draws.push(...behind.toReversed());
        return original.draw.call(this, pass, scene);
      };
      const correct = window.__navigation.difference(
        baseline,
        state.pixels().data,
      );
      const descriptor = window.__navigationGpu.opaqueDescriptor;
      if (descriptor?.depthStencil.depthCompare !== "greater") {
        throw new Error(
          "Expected the renderer's real reversed-depth pipeline descriptor",
        );
      }
      renderer._pipelineNoCull =
        await renderer._device.createRenderPipelineAsync({
          ...descriptor,
          label: "TEST negative control: always depth",
          depthStencil: { ...descriptor.depthStencil, depthCompare: "always" },
        });
      const negative = window.__navigation.difference(
        baseline,
        state.pixels().data,
      );
      renderer._pipelineNoCull = original.pipeline;
      const restored = window.__navigation.difference(
        baseline,
        state.pixels().data,
      );
      return {
        injectedTiles: behind.length,
        baselineRepeat,
        correct,
        negative,
        restored,
        comparator: descriptor.depthStencil.depthCompare,
      };
    } finally {
      renderer._draw = original.draw;
      renderer._pipelineNoCull = original.pipeline;
      globe.backFaceCulling = original.culling;
      globe.tileCacheSize = original.cache;
    }
  });
  assert.equal(report.depth.baselineRepeat.changedPixels, 0);
  assert.equal(report.depth.correct.changedPixels, 0);
  assert.ok(
    report.depth.negative.changedPixels > 100,
    "Incorrect depth must visibly fail the same real GPU scene",
  );
  assert.ok(report.depth.negative.maximumChannelDifference > 20);
  assert.equal(report.depth.restored.changedPixels, 0);
  await captureM1Scene(page, report, output, "depth-restored", report.depth);
  report.checks.push(
    "reversed GPU depth preserves front imagery; always-depth negative control fails",
  );

  console.log("M1 navigation: native orbit-to-ground flight");
  report.flight = await page.evaluate(async () => {
    const state = window.__m1;
    const { viewer } = state;
    await state.settle({
      longitude: 86.925,
      latitude: 27.988,
      height: 40000000,
      imagery: true,
    });
    let completed = 0;
    let cancelled = 0;
    const samples = [];
    const coverageSamples = [];
    const coverageHeights = [
      10000000, 1000000, 100000, 10000, 1000, 100, 10.01,
    ];
    const target = Cesium.Cartesian3.fromDegrees(86.925, 27.988, 10);
    viewer.camera.flyTo({
      destination: target,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      duration: 4,
      complete: () => ++completed,
      cancel: () => ++cancelled,
    });
    const inputsDisabledDuringFlight =
      !viewer.scene.screenSpaceCameraController.enableInputs;
    const start = performance.now();
    while (!completed && !cancelled && performance.now() - start < 20000) {
      viewer.render();
      samples.push({
        timeMs: performance.now() - start,
        ...window.__navigation.camera(),
        draws: viewer.scene.debugStatistics.resources.drawCalls,
        imageryDraws: viewer.scene.debugStatistics.resources.imageryDrawCalls,
      });
      if (viewer.camera.positionCartographic.height < coverageHeights[0]) {
        const threshold = coverageHeights.shift();
        const coverage = window.__navigation.coverage();
        coverageSamples.push({
          threshold,
          camera: window.__navigation.camera(),
          coverage,
        });
      }
      await new Promise(requestAnimationFrame);
    }
    await state.settle({ imagery: true });
    return {
      completed,
      cancelled,
      inputsDisabledDuringFlight,
      inputsRestored: viewer.scene.screenSpaceCameraController.enableInputs,
      distanceToDestination: Cesium.Cartesian3.distance(
        target,
        viewer.camera.positionWC,
      ),
      samples,
      coverageSamples,
      final: window.__navigation.camera(),
      coverage: window.__navigation.coverage(),
    };
  });
  assert.equal(report.flight.completed, 1);
  assert.equal(report.flight.cancelled, 0);
  assert.equal(report.flight.inputsDisabledDuringFlight, true);
  assert.equal(report.flight.inputsRestored, true);
  assert.ok(report.flight.samples.length >= 8);
  assert.ok(report.flight.samples.some((sample) => sample.height > 10000000));
  assert.ok(
    report.flight.samples.some(
      (sample) => sample.height > 100 && sample.height < 100000,
    ),
  );
  assert.ok(
    report.flight.samples.every(
      (sample) =>
        sample.finite &&
        sample.axesError < 1e-10 &&
        sample.draws > 0 &&
        sample.imageryDraws > 0,
    ),
  );
  assert.ok(report.flight.coverageSamples.length >= 5);
  assert.ok(
    report.flight.coverageSamples.every(
      (sample) => sample.coverage.agreement > 0.99,
    ),
  );
  assert.ok(report.flight.distanceToDestination < 0.1);
  assert.equal(report.flight.coverage.interiorBlackPixels, 0);
  await captureM1Scene(page, report, output, "flight-ground", {
    final: report.flight.final,
  });
  report.checks.push(
    "real Camera.flyTo completes orbit-to-10m path and restores controller inputs",
  );

  report.defaultLoopFlight = await page.evaluate(async () => {
    const { viewer } = window.__m1;
    const before = viewer.scene.debugStatistics.frame;
    let completed = 0;
    const target = Cesium.Cartesian3.fromDegrees(86.925, 27.988, 50);
    try {
      viewer.useDefaultRenderLoop = true;
      viewer.camera.flyTo({
        destination: target,
        duration: 0.6,
        complete: () => ++completed,
      });
      const start = performance.now();
      while (!completed && performance.now() - start < 10000) {
        await new Promise(requestAnimationFrame);
      }
      return {
        completed,
        frames: viewer.scene.debugStatistics.frame - before,
        distanceToDestination: Cesium.Cartesian3.distance(
          target,
          viewer.camera.positionWC,
        ),
      };
    } finally {
      viewer.useDefaultRenderLoop = false;
    }
  });
  assert.equal(report.defaultLoopFlight.completed, 1);
  assert.ok(report.defaultLoopFlight.frames >= 2);
  assert.ok(report.defaultLoopFlight.distanceToDestination < 0.1);
  report.checks.push(
    "native flight also completes in the Viewer's default render loop",
  );

  report.meterStability = [];
  for (const height of [10, 1]) {
    const sample = await page.evaluate(async (height) => {
      const state = window.__m1;
      const { viewer } = state;
      await state.settle({
        longitude: 86.925,
        latitude: 27.988,
        height,
        imagery: true,
      });
      const step = height === 1 ? 0.25 : 1;
      viewer.camera.moveRight(-step);
      const positions = [];
      for (let i = 0; i < 3; ++i) {
        await state.settle({ imagery: true });
        positions.push({
          camera: window.__navigation.camera(),
          projection: window.__navigation.projectControl(86.925, 27.988),
          coverage: window.__navigation.coverage(),
        });
        if (i < 2) {
          viewer.camera.moveRight(step);
        }
      }
      const still = state.pixels().data;
      await window.__navigation.tick(3);
      return {
        height,
        step,
        positions,
        stationary: window.__navigation.difference(still, state.pixels().data),
      };
    }, height);
    report.meterStability.push(sample);
    for (let i = 0; i < sample.positions.length; ++i) {
      const current = sample.positions[i];
      assert.ok(current.camera.finite && current.camera.axesError < 1e-10);
      assert.ok(
        current.projection.errorPixels < 0.75,
        `RTC uploaded-matrix error at ${height} m: ${current.projection.errorPixels} px`,
      );
      assert.ok(
        Number.isFinite(current.projection.reversedDepth) &&
          current.projection.reversedDepth > 0 &&
          current.projection.reversedDepth <= 1.0001,
      );
      assert.equal(current.coverage.interiorBlackPixels, 0);
      if (i > 0) {
        const previous = sample.positions[i - 1];
        const distance = Math.hypot(
          ...current.camera.position.map(
            (value, component) => value - previous.camera.position[component],
          ),
        );
        assert.ok(Math.abs(distance - sample.step) < 0.001);
        assert.ok(
          current.projection.nativePixel[0] <
            previous.projection.nativePixel[0],
        );
      }
    }
    assert.equal(sample.stationary.changedPixels, 0);
    await captureM1Scene(page, report, output, `ground-${height}m`, {
      stepMetres: sample.step,
    });
  }
  report.precisionMethod =
    "Real rendered coverage/static-frame comparison plus float32 evaluation of actual uploaded RTC uniforms against native double camera projection; NaturalEarthII is too coarse for metre-scale image landmark tracking.";
  report.checks.push(
    "10m and 1m surface views: native metre/submetre movement, finite reversed depth, RTC reference agreement, stationary pixels",
  );

  console.log("M1 navigation: real mouse controller and resize");
  await page.evaluate(async () => {
    const state = window.__m1;
    await state.settle({
      longitude: 20,
      latitude: 20,
      height: 12000000,
      imagery: true,
    });
    const controller = state.viewer.scene.screenSpaceCameraController;
    controller.inertiaSpin = 0;
    controller.inertiaTranslate = 0;
    controller.inertiaZoom = 0;
    window.__navigation.beforeInput = {
      camera: window.__navigation.camera(),
      pixels: state.pixels().data,
    };
  });
  const bounds = await page.locator("canvas").first().boundingBox();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const moveMouse = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForFunction(
      ({ x, y }) => {
        const pointer =
          window.__m1.viewer.scene.screenSpaceCameraController._aggregator
            .currentMousePosition;
        return pointer.x === x && pointer.y === y;
      },
      { x: x - bounds.x, y: y - bounds.y },
    );
  };
  report.inputPointer = { canvasBounds: bounds, center: [cx, cy], inertia: 0 };
  await moveMouse(cx, cy);
  await page.mouse.down();
  await page.waitForFunction(() =>
    window.__m1.viewer.scene.screenSpaceCameraController._aggregator.isButtonDown(
      Cesium.CameraEventType.LEFT_DRAG,
    ),
  );
  for (let i = 1; i <= 5; ++i) {
    await moveMouse(cx + 24 * i, cy + 12 * i);
    await page.evaluate(() => window.__navigation.tick(1));
  }
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      !window.__m1.viewer.scene.screenSpaceCameraController._aggregator.isButtonDown(
        Cesium.CameraEventType.LEFT_DRAG,
      ),
  );
  report.drag = await page.evaluate(async () => {
    await window.__navigation.tick(30);
    await window.__m1.settle({ imagery: true });
    return {
      before: window.__navigation.beforeInput.camera,
      after: window.__navigation.camera(),
      pixels: window.__navigation.difference(
        window.__navigation.beforeInput.pixels,
        window.__m1.pixels().data,
      ),
      inertia: 0,
    };
  });
  assert.ok(
    Math.hypot(
      ...report.drag.after.position.map(
        (value, i) => value - report.drag.before.position[i],
      ),
    ) > 1000,
  );
  assert.ok(report.drag.pixels.changedPixels > 1000);
  assert.ok(report.drag.after.finite && report.drag.after.axesError < 1e-10);
  // Choose a legitimate native pick that exposes the controller's floating-point
  // edge case deterministically: n dot n rounds below one although n cross n is
  // exactly zero. No pick, camera method, or input event is replaced by this test.
  report.centerWheelPreparation = await page.evaluate(async () => {
    const state = window.__m1;
    const { viewer } = state;
    const candidates = [];
    for (const [longitude, latitude] of [
      [20, 20],
      [45, 45],
      [60, -25],
      [179.9, 20],
      [86.925, 27.988],
      [-80, 70],
      [50, -60],
      [2.9409120248434366, 26.787087083546744],
    ]) {
      await state.settle({
        longitude,
        latitude,
        height: 12000000,
        imagery: true,
      });
      const point = new Cesium.Cartesian2(
        viewer.canvas.clientWidth / 2,
        viewer.canvas.clientHeight / 2,
      );
      const ray = viewer.camera.getPickRay(point);
      const picked = viewer.scene.globe.pickWorldCoordinates(
        ray,
        viewer.scene,
        true,
        new Cesium.Cartesian3(),
      );
      const normal = Cesium.Cartesian3.normalize(
        picked,
        new Cesium.Cartesian3(),
      );
      const selfDot = Cesium.Cartesian3.dot(normal, normal);
      candidates.push({
        longitude,
        latitude,
        selfDot,
        normal: [normal.x, normal.y, normal.z],
      });
      if (selfDot < 1 && selfDot > 1 - 1e-14) {
        return {
          candidates,
          chosen: candidates.at(-1),
          camera: window.__navigation.camera(),
        };
      }
    }
    return { candidates };
  });
  assert.ok(
    report.centerWheelPreparation.chosen,
    "A real native center pick must exercise the zero-cross-product rounding regression",
  );
  await page.evaluate(() => {
    const camera = window.__m1.viewer.camera;
    const nav = window.__navigation;
    nav.originalRotate = camera.rotate;
    nav.wheelRotations = [];
    camera.rotate = function (axis, angle) {
      nav.wheelRotations.push({
        axis: [axis.x, axis.y, axis.z],
        axisMagnitude: Cesium.Cartesian3.magnitude(axis),
        angle,
        cameraHeight: camera.positionCartographic.height,
      });
      return nav.originalRotate.call(this, axis, angle);
    };
  });
  await moveMouse(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForFunction(() =>
    window.__m1.viewer.scene.screenSpaceCameraController._aggregator.isMoving(
      Cesium.CameraEventType.WHEEL,
    ),
  );
  report.wheel = await page.evaluate(async () => {
    const before = window.__navigation.camera();
    const mouse =
      window.__m1.viewer.scene.screenSpaceCameraController._aggregator.getStartMousePosition(
        Cesium.CameraEventType.WHEEL,
      );
    const pointer = [mouse.x, mouse.y];
    try {
      await window.__navigation.tick(5);
      await window.__m1.settle({ imagery: true });
      return {
        before,
        pointer,
        after: window.__navigation.camera(),
        rotations: window.__navigation.wheelRotations,
      };
    } catch (error) {
      return {
        before,
        pointer,
        error: String(error),
        rotations: window.__navigation.wheelRotations,
      };
    } finally {
      window.__m1.viewer.camera.rotate = window.__navigation.originalRotate;
    }
  });
  assert.equal(report.wheel.error, undefined, report.wheel.error);
  assert.deepEqual(report.wheel.pointer, [bounds.width / 2, bounds.height / 2]);
  assert.ok(report.wheel.after.height < report.wheel.before.height - 1000);
  report.publicCameraValidation = await page.evaluate(() => {
    const camera = window.__m1.viewer.camera;
    const before = Cesium.Cartesian3.clone(camera.positionWC);
    let message;
    try {
      camera.rotate(Cesium.Cartesian3.ZERO, 0.1);
    } catch (error) {
      message = String(error);
    }
    return {
      message,
      cameraUnchanged: Cesium.Cartesian3.equals(before, camera.positionWC),
    };
  });
  assert.match(
    report.publicCameraValidation.message,
    /normalized result is not a number/,
  );
  assert.equal(report.publicCameraValidation.cameraUnchanged, true);
  await captureM1Scene(page, report, output, "mouse-navigation");
  report.checks.push(
    "actual Playwright mouse drag and wheel drive the native controller",
  );

  await page.setViewportSize({ width: 960, height: 540 });
  report.resize = [];
  for (const scale of [1.5, 0.75, 1]) {
    const sample = await page.evaluate(async (scale) => {
      const { viewer } = window.__m1;
      viewer.resolutionScale = scale;
      viewer.resize();
      await window.__m1.settle({ imagery: true });
      const depth = viewer._webgpuProof._context._depthTexture;
      return {
        scale,
        client: [viewer.canvas.clientWidth, viewer.canvas.clientHeight],
        canvas: [viewer.canvas.width, viewer.canvas.height],
        drawingBuffer: [
          viewer.scene.drawingBufferWidth,
          viewer.scene.drawingBufferHeight,
        ],
        depth: [depth.width, depth.height],
        aspect: viewer.camera.frustum.aspectRatio,
        gpu: window.__navigationGpu.snapshot(),
      };
    }, scale);
    report.resize.push(sample);
    assert.deepEqual(
      sample.canvas,
      sample.client.map((dimension) => Math.floor(dimension * scale)),
    );
    assert.deepEqual(sample.drawingBuffer, sample.canvas);
    assert.deepEqual(sample.depth, sample.canvas);
    assert.ok(
      Math.abs(sample.aspect - sample.canvas[0] / sample.canvas[1]) < 1e-12,
    );
  }
  await captureM1Scene(page, report, output, "resized-960x540");
  report.checks.push(
    "viewport and resolutionScale recreate correctly sized depth attachments",
  );

  console.log(
    "M1 navigation: rapid churn and repeated waypoint resource bounds",
  );
  const waypoints = [
    { longitude: 0, latitude: 15, height: 12000000 },
    { longitude: 179.9, latitude: -25, height: 2000 },
    { longitude: -80, latitude: 70, height: 100000 },
    { longitude: 50, latitude: -60, height: 10000 },
  ];
  report.churn = await page.evaluate(async (waypoints) => {
    const state = window.__m1;
    const { viewer } = state;
    const globe = viewer.scene.globe;
    globe.tileCacheSize = 64;
    globe.maximumScreenSpaceError = 6;
    globe.preloadAncestors = false;
    globe.preloadSiblings = false;
    for (let visit = 0; visit < 8; ++visit) {
      const view = waypoints[visit % waypoints.length];
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          view.longitude,
          view.latitude,
          view.height,
        ),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
      viewer.render();
      await new Promise(requestAnimationFrame);
    }
    const samples = [];
    for (let cycle = 0; cycle < 3; ++cycle) {
      for (let waypoint = 0; waypoint < waypoints.length; ++waypoint) {
        await state.settle({ ...waypoints[waypoint], imagery: true });
        samples.push({
          cycle,
          waypoint,
          statistics: viewer.scene.debugStatistics,
          gpu: window.__navigationGpu.snapshot(),
          camera: window.__navigation.camera(),
        });
      }
    }
    return {
      cacheSize: globe.tileCacheSize,
      maximumScreenSpaceError: globe.maximumScreenSpaceError,
      rapidVisits: 8,
      samples,
      imageryRequests: state.imageryRequests,
      providerErrors: state.providerErrors,
      errors: state.errors,
    };
  }, waypoints);
  assert.deepEqual(report.churn.providerErrors, []);
  assert.deepEqual(report.churn.errors, []);
  for (const sample of report.churn.samples) {
    const resources = sample.statistics.resources;
    assert.ok(
      sample.gpu.activeBuffers <= 1026,
      "Bounded mesh working set must not grow without eviction",
    );
    assert.ok(
      sample.statistics.imagery.activeTextures <= 42,
      "NaturalEarthII has exactly 42 source tiles through level 2",
    );
    assert.equal(
      sample.gpu.activeBuffers,
      resources.buffersCreated - resources.buffersDestroyed,
    );
    assert.equal(
      sample.gpu.activeTextures,
      resources.texturesCreated - resources.texturesDestroyed + 1,
      "One actual depth attachment accompanies renderer imagery textures",
    );
    assert.ok(
      sample.camera.finite &&
        resources.drawCalls > 0 &&
        resources.imageryDrawCalls > 0,
    );
  }
  for (let waypoint = 0; waypoint < waypoints.length; ++waypoint) {
    const second = report.churn.samples[4 + waypoint];
    const third = report.churn.samples[8 + waypoint];
    assert.ok(
      third.gpu.activeBuffers <= second.gpu.activeBuffers,
      "Repeated visits must reach a bounded cache working set",
    );
    assert.ok(third.gpu.activeTextures <= second.gpu.activeTextures);
  }
  assert.ok(
    report.churn.imageryRequests.some((request) => request.level === 2),
  );
  assert.ok(
    new Set(report.churn.samples.flatMap((sample) => sample.statistics.levels))
      .size >= 4,
  );
  await captureM1Scene(page, report, output, "churn-final");
  report.checks.push(
    "rapid pending-request churn and three waypoint cycles keep actual GPU allocations bounded",
  );

  report.teardown = await destroyM1Scene(page);
  report.actualGpuTeardown = await page.evaluate(() => {
    const result = window.__navigationGpu.snapshot();
    window.__navigationGpu.restore();
    return result;
  });
  assert.equal(report.actualGpuTeardown.activeBuffers, 0);
  assert.equal(report.actualGpuTeardown.activeTextures, 0);
  assert.ok(report.actualGpuTeardown.peakBuffers <= 1026);
  assert.ok(
    report.actualGpuTeardown.peakTextures <= 43,
    "At most 42 NaturalEarthII tile textures plus the current depth attachment",
  );
  assert.equal(
    report.actualGpuTeardown.buffersCreated,
    report.actualGpuTeardown.buffersDestroyed,
  );
  assert.equal(
    report.actualGpuTeardown.texturesCreated,
    report.actualGpuTeardown.texturesDestroyed,
  );
  assert.deepEqual(report.consoleErrors, []);
  report.checks.push(
    "balanced native GPU buffer/texture teardown, no hidden WebGL or browser/GPU errors",
  );
});
