/* global Cesium, window, document, requestAnimationFrame, performance */
import { URL } from "node:url";
import assert from "node:assert/strict";
import {
  runM1BrowserSuite,
  installM1Scene,
  captureM1Scene,
  destroyM1Scene,
} from "./m1-browser-harness.mjs";

// Live integration: coherent real terrain/imagery services, never duplicated
// single-tile fixtures. Service failures remain failures with retained evidence.
await runM1BrowserSuite("terrain", async ({ page, report, output, base }) => {
  await installM1Scene(page, { baseLayer: false });
  report.providers = await page.evaluate(async (edgeModuleUrl) => {
    const { compareTerrainEdges } = await import(edgeModuleUrl);
    const state = window.__m1;
    const [terrain, imagery] = await Promise.all([
      Cesium.createWorldTerrainAsync({
        requestVertexNormals: false,
        requestWaterMask: false,
      }),
      Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      ),
    ]);
    const request = terrain.requestTileGeometry;
    terrain.requestTileGeometry = function (x, y, level, requestOptions) {
      const promise = request.call(this, x, y, level, requestOptions);
      if (promise === undefined) {
        return undefined;
      }
      const record = { x, y, level, state: "pending" };
      state.terrainRequests.push(record);
      return promise.then(
        (data) => {
          Object.assign(record, {
            state: "resolved",
            quantized: data instanceof Cesium.QuantizedMeshTerrainData,
            minimumHeight: data._minimumHeight,
            maximumHeight: data._maximumHeight,
          });
          return data;
        },
        (error) => {
          record.state = "rejected";
          throw error;
        },
      );
    };
    terrain.errorEvent.addEventListener((error) =>
      state.providerErrors.push({
        label: "WorldTerrain",
        x: error.x,
        y: error.y,
        level: error.level,
        message: error.message,
      }),
    );
    state.watchImagery(imagery, "ArcGIS World Imagery");
    state.worldTerrain = terrain;
    state.realImagery = imagery;
    state.viewer.terrainProvider = terrain;
    state.viewer.imageryLayers.addImageryProvider(imagery);
    state.viewer.scene.globe.maximumScreenSpaceError = 4;
    state.viewer.scene.backgroundColor = Cesium.Color.clone(
      Cesium.Color.MAGENTA,
    );
    state.viewer.scene.globe.baseColor = Cesium.Color.clone(
      Cesium.Color.YELLOW,
    );
    state.terrainCoverage = () => {
      const { data } = state.pixels();
      let background = 0;
      let untextured = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) {
          ++background;
        }
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 0) {
          ++untextured;
        }
      }
      return { background, untextured };
    };
    state.meshEvidence = () => {
      const tiles = [
        ...new Set(
          state.viewer.scene._renderer._draws.map((draw) => draw.tile),
        ),
      ];
      const rows = tiles.map((tile) => {
        const mesh = tile.data.mesh;
        return {
          x: tile.x,
          y: tile.y,
          level: tile.level,
          quantized:
            tile.data.terrainData instanceof Cesium.QuantizedMeshTerrainData,
          upsampled: tile.data.terrainData.wasCreatedByUpsampling(),
          minimumHeight: mesh.minimumHeight,
          maximumHeight: mesh.maximumHeight,
          vertices: mesh.vertexCountWithoutSkirts,
          indices: mesh.indices.length,
          skirtIndices: mesh.indices.length - mesh.indexCountWithoutSkirts,
          quantization: mesh.encoding.quantization,
          mercatorT: mesh.encoding.hasWebMercatorT,
        };
      });
      const coordinate = Cesium.Cartographic.fromDegrees(86.925, 27.988);
      const centerHeight = state.viewer.scene.globe.getHeight(coordinate);
      const edge = (tile, property, axis) => {
        const mesh = tile.data.mesh;
        return Array.from(mesh[property], (index) => {
          const position = mesh.encoding.decodePosition(
            mesh.vertices,
            index,
            new Cesium.Cartesian3(),
          );
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          return {
            coordinate: cartographic[axis],
            height: cartographic.height,
          };
        }).sort((a, b) => a.coordinate - b.coordinate);
      };
      const adjacent = [];
      for (let i = 0; i < tiles.length; ++i) {
        for (let j = i + 1; j < tiles.length; ++j) {
          let a = tiles[i];
          let b = tiles[j];
          let axis;
          let first;
          let second;
          if (
            Math.abs(a.rectangle.east - b.rectangle.west) < 1e-12 ||
            Math.abs(b.rectangle.east - a.rectangle.west) < 1e-12
          ) {
            if (a.rectangle.west > b.rectangle.west) {
              [a, b] = [b, a];
            }
            axis = "latitude";
            first = "eastIndicesNorthToSouth";
            second = "westIndicesSouthToNorth";
          } else if (
            Math.abs(a.rectangle.north - b.rectangle.south) < 1e-12 ||
            Math.abs(b.rectangle.north - a.rectangle.south) < 1e-12
          ) {
            if (a.rectangle.south > b.rectangle.south) {
              [a, b] = [b, a];
            }
            axis = "longitude";
            first = "northIndicesWestToEast";
            second = "southIndicesEastToWest";
          } else {
            continue;
          }
          const samplesA = edge(a, first, axis);
          const samplesB = edge(b, second, axis);
          const low = Math.max(samplesA[0].coordinate, samplesB[0].coordinate);
          const high = Math.min(
            samplesA.at(-1).coordinate,
            samplesB.at(-1).coordinate,
          );
          if (high - low < 1e-10) {
            continue;
          }
          const comparison = compareTerrainEdges(samplesA, samplesB);
          if (!comparison.overlap) {
            continue;
          }
          adjacent.push({
            first: `${a.level}/${a.x}/${a.y}`,
            second: `${b.level}/${b.x}/${b.y}`,
            levelDifference: Math.abs(a.level - b.level),
            ...comparison,
          });
        }
      }
      return { tiles: rows, adjacent, centerHeight };
    };
    return {
      terrain: "Cesium.createWorldTerrainAsync",
      nativeTerrain: terrain instanceof Cesium.CesiumTerrainProvider,
      imagery: "ArcGIS World Imagery",
      nativeImagery: imagery instanceof Cesium.ArcGisMapServerImageryProvider,
      imageryMaximumLevel: imagery.maximumLevel,
      imageryCredit: imagery.credit?.html,
      ellipsoidRadii: [
        terrain.tilingScheme.ellipsoid.radii.x,
        terrain.tilingScheme.ellipsoid.radii.y,
        terrain.tilingScheme.ellipsoid.radii.z,
      ],
    };
  }, new URL("coordination/ci/m1-terrain-edges.mjs", base).href);
  assert.equal(report.providers.nativeTerrain, true);
  assert.equal(report.providers.nativeImagery, true);
  assert.ok(report.providers.imageryMaximumLevel >= 14);

  const regional = await page.evaluate(() =>
    window.__m1.settle({
      longitude: 86.925,
      latitude: 27.988,
      height: 1500000,
      imagery: true,
      timeout: 150000,
    }),
  );
  await captureM1Scene(page, report, output, "himalaya-region", {
    settled: regional,
  });
  for (const view of [
    { name: "everest-oblique", range: 35000, heading: 0, pitch: -45 },
    { name: "everest-near", range: 14000, heading: 35, pitch: -40 },
  ]) {
    const details = await page.evaluate(async (view) => {
      const state = window.__m1;
      state.viewer.camera.lookAt(
        Cesium.Cartesian3.fromDegrees(86.925, 27.988, 6000),
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(view.heading),
          Cesium.Math.toRadians(view.pitch),
          view.range,
        ),
      );
      state.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const settled = await state.settle({ imagery: true, timeout: 150000 });
      return {
        settled,
        mesh: state.meshEvidence(),
        coverage: state.terrainCoverage(),
        cameraHeight: state.viewer.camera.positionCartographic.height,
      };
    }, view);
    assert.ok(details.mesh.tiles.length > 5);
    assert.ok(
      details.mesh.tiles.every(
        (tile) => tile.quantized && tile.skirtIndices > 0,
      ),
    );
    assert.ok(
      details.mesh.tiles.some(
        (tile) => tile.maximumHeight > 7000 && !tile.upsampled,
      ),
    );
    assert.ok(
      details.mesh.centerHeight > 5000 && details.mesh.centerHeight < 10000,
    );
    const sameLevel = details.mesh.adjacent.filter(
      (pair) => pair.levelDifference === 0,
    );
    assert.ok(sameLevel.length > 5);
    assert.ok(
      details.mesh.adjacent.some((pair) => pair.levelDifference > 0),
      "Actual visible mixed-LOD boundary required",
    );
    assert.equal(details.coverage.background, 0);
    assert.equal(details.coverage.untextured, 0);
    assert.ok(
      sameLevel.every(
        (pair) =>
          Number.isFinite(pair.maximumHeightDifference) &&
          pair.maximumHeightDifference < 2,
      ),
      JSON.stringify(sameLevel),
    );
    await captureM1Scene(page, report, output, view.name, { view, ...details });
  }
  report.checks.push(
    "actual native quantized terrain and high-resolution provider imagery",
    "coherent adjacent mesh edges, native skirts and mixed LOD",
  );

  report.transitions = await page.evaluate(async () => {
    const state = window.__m1;
    await state.settle({
      longitude: 86.925,
      latitude: 27.988,
      height: 35000,
      imagery: true,
      timeout: 150000,
    });
    const results = [];
    for (const height of [70000, 15000, 50000, 25000]) {
      state.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(86.925, 27.988, height),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      const start = performance.now();
      let stable = 0;
      let frames = 0;
      const sourceKey = () =>
        state.viewer.scene._renderer._draws
          .map(({ tile }) => `${tile.level}/${tile.x}/${tile.y}`)
          .sort()
          .join("|");
      const initialSources = sourceKey();
      let sourceChanges = 0;
      let fallbackDraws = 0;
      let maximumBackground = 0;
      let maximumUntextured = 0;
      while (performance.now() - start < 120000) {
        const coverage = state.terrainCoverage();
        ++frames;
        if (sourceKey() !== initialSources) {
          ++sourceChanges;
        }
        fallbackDraws = Math.max(
          fallbackDraws,
          state.viewer.scene._renderer._draws.filter(
            ({ tile, rectangle }) =>
              !Cesium.Rectangle.equals(tile.rectangle, rectangle),
          ).length,
        );
        maximumBackground = Math.max(maximumBackground, coverage.background);
        maximumUntextured = Math.max(maximumUntextured, coverage.untextured);
        if (state.errors.length) {
          throw new Error(state.errors.join("\n"));
        }
        const stats = state.viewer.scene.debugStatistics;
        stable =
          state.viewer.scene.globe.tilesLoaded &&
          stats.imagery.pendingRequests === 0
            ? stable + 1
            : 0;
        if (stable >= 3) {
          break;
        }
        await new Promise(requestAnimationFrame);
      }
      if (stable < 3) {
        throw new Error("Real terrain LOD transition did not settle");
      }
      results.push({
        height,
        frames,
        sourceChanges,
        fallbackDraws,
        finalSources: sourceKey(),
        maximumBackground,
        maximumUntextured,
        final: state.terrainCoverage(),
        statistics: state.viewer.scene.debugStatistics,
      });
    }
    return results;
  });
  for (const transition of report.transitions) {
    assert.ok(
      transition.sourceChanges > 0,
      "Changing height must change selected terrain sources",
    );
    assert.equal(
      transition.maximumUntextured,
      0,
      "Ancestor imagery must cover loading children",
    );
    assert.equal(
      transition.maximumBackground,
      0,
      `Terrain holes during ${transition.height}m LOD transition`,
    );
    assert.equal(
      transition.final.untextured,
      0,
      "Settled terrain must have complete imagery coverage",
    );
  }
  assert.ok(
    new Set(
      report.transitions.map((transition) =>
        [...new Set(transition.statistics.levels)].sort().join(","),
      ),
    ).size > 1,
    "Terrain LOD levels must actually change",
  );
  await captureM1Scene(page, report, output, "everest-top-down", {
    transitions: report.transitions,
  });
  report.checks.push(
    "no geometry holes during real neighboring/parent-child LOD transitions",
  );

  report.groundFlight = await page.evaluate(async () => {
    const state = window.__m1;
    const coordinate = Cesium.Cartographic.fromDegrees(86.8526, 28.0024);
    const initialTerrainHeight = state.viewer.scene.globe.getHeight(coordinate);
    if (!Number.isFinite(initialTerrainHeight)) {
      throw new Error(
        "Base Camp terrain height must come from a loaded native mesh",
      );
    }
    await state.settle({
      longitude: 86.925,
      latitude: 27.988,
      height: 1500000,
      imagery: true,
      timeout: 150000,
    });
    let complete = false;
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        86.8526,
        28.0024,
        initialTerrainHeight + 50,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
      duration: 1.5,
      complete: () => {
        complete = true;
      },
    });
    const start = performance.now();
    let frames = 0;
    let maximumBackground = 0;
    let maximumUntextured = 0;
    while (!complete && performance.now() - start < 30000) {
      const coverage = state.terrainCoverage();
      ++frames;
      maximumBackground = Math.max(maximumBackground, coverage.background);
      maximumUntextured = Math.max(maximumUntextured, coverage.untextured);
      if (state.errors.length) {
        throw new Error(state.errors.join("\n"));
      }
      await new Promise(requestAnimationFrame);
    }
    if (!complete) {
      throw new Error("Live terrain flight failed to complete");
    }
    const settled = await state.settle({ imagery: true, timeout: 150000 });
    const camera = state.viewer.camera.positionCartographic;
    const terrainHeight = state.viewer.scene.globe.getHeight(camera);
    return {
      complete,
      frames,
      initialTerrainHeight,
      maximumBackground,
      maximumUntextured,
      cameraHeight: camera.height,
      terrainHeight,
      aboveGround: camera.height - terrainHeight,
      final: state.terrainCoverage(),
      settled,
      mesh: state.meshEvidence(),
    };
  });
  assert.equal(report.groundFlight.complete, true);
  assert.ok(report.groundFlight.frames > 2);
  assert.equal(report.groundFlight.maximumBackground, 0);
  assert.equal(report.groundFlight.final.background, 0);
  assert.equal(report.groundFlight.final.untextured, 0);
  assert.ok(
    report.groundFlight.aboveGround >= 0.8 &&
      report.groundFlight.aboveGround < 150,
    JSON.stringify(report.groundFlight),
  );
  assert.ok(Math.max(...report.groundFlight.settled.statistics.levels) >= 14);
  await captureM1Scene(page, report, output, "base-camp-ground", {
    groundFlight: report.groundFlight,
  });
  report.checks.push(
    "native flight from space to within 150m of real terrain with finer LOD",
  );

  report.drape = await page.evaluate(async () => {
    const state = window.__m1;
    const tilingScheme = new Cesium.GeographicTilingScheme();
    const provider = {
      tilingScheme,
      rectangle: tilingScheme.rectangle,
      tileWidth: 128,
      tileHeight: 128,
      minimumLevel: 0,
      maximumLevel: 14,
      errorEvent: new Cesium.Event(),
      getTileCredits: () => [],
      requestImage(x, y, level) {
        const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d");
        const data = context.createImageData(128, 128);
        for (let row = 0; row < 128; ++row) {
          const latitude =
            rectangle.south + (1 - (row + 0.5) / 128) * rectangle.height;
          for (let column = 0; column < 128; ++column) {
            const longitude =
              rectangle.west + ((column + 0.5) / 128) * rectangle.width;
            data.data.set(
              [
                Math.round(128 + 80 * Math.sin(longitude * 16000)),
                Math.round(128 + 80 * Math.sin(latitude * 16000)),
                60,
                255,
              ],
              (row * 128 + column) * 4,
            );
          }
        }
        context.putImageData(data, 0, 0);
        return Promise.resolve(canvas);
      },
    };
    state.viewer.imageryLayers.removeAll();
    state.viewer.imageryLayers.addImageryProvider(provider);
    state.viewer.camera.lookAt(
      Cesium.Cartesian3.fromDegrees(86.925, 27.988, 6000),
      new Cesium.HeadingPitchRange(0, -Math.PI / 4, 18000),
    );
    state.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    await state.settle({ imagery: true, timeout: 150000 });
    const measure = () => {
      const pixels = state.pixels();
      let checked = 0;
      let expectedSamples = 0;
      let maximumChannelError = 0;
      const failures = [];
      let minimumHitHeight = Infinity;
      let maximumHitHeight = -Infinity;
      for (let y = 60; y < pixels.height - 60; y += 36) {
        for (let x = 60; x < pixels.width - 60; x += 36) {
          ++expectedSamples;
          const ray = state.viewer.camera.getPickRay(
            new Cesium.Cartesian2(x + 0.5, y + 0.5),
          );
          const hit = state.viewer.scene.globe.pick(ray, state.viewer.scene);
          if (!hit) {
            continue;
          }
          const coordinate = Cesium.Cartographic.fromCartesian(hit);
          const expected = [
            128 + 80 * Math.sin(coordinate.longitude * 16000),
            128 + 80 * Math.sin(coordinate.latitude * 16000),
            60,
          ];
          const offset = (y * pixels.width + x) * 4;
          const actual = Array.from(pixels.data.slice(offset, offset + 3));
          const error = Math.max(
            ...expected.map((value, i) => Math.abs(value - actual[i])),
          );
          ++checked;
          maximumChannelError = Math.max(maximumChannelError, error);
          minimumHitHeight = Math.min(minimumHitHeight, coordinate.height);
          maximumHitHeight = Math.max(maximumHitHeight, coordinate.height);
          if (error > 5) {
            failures.push({ x, y, error, actual, expected });
          }
        }
      }
      return {
        checked,
        expectedSamples,
        missingPicks: expectedSamples - checked,
        maximumChannelError,
        minimumHitHeight,
        maximumHitHeight,
        failureCount: failures.length,
        failures: failures.slice(0, 12),
        coverage: state.terrainCoverage(),
      };
    };
    const original = measure();
    const associations = new Set(
      state.viewer.scene._renderer._draws.flatMap(
        ({ tile }) => tile.data.imagery,
      ),
    );
    const originalOffsets = new Map();
    const radians =
      1000 /
      (Cesium.Ellipsoid.WGS84.maximumRadius *
        Math.cos(Cesium.Math.toRadians(27.988)));
    for (const association of associations) {
      if (association.readyImagery && association.textureTranslationAndScale) {
        originalOffsets.set(
          association,
          association.textureTranslationAndScale.x,
        );
        association.textureTranslationAndScale.x +=
          radians / association.readyImagery.rectangle.width;
      }
    }
    const shifted = measure();
    for (const [association, originalX] of originalOffsets) {
      association.textureTranslationAndScale.x = originalX;
    }
    return {
      ...original,
      negativeControl: {
        eastwardOffsetMeters: 1000,
        modifiedAssociations: originalOffsets.size,
        failureCount: shifted.failureCount,
        checked: shifted.checked,
        maximumChannelError: shifted.maximumChannelError,
      },
    };
  });
  assert.ok(report.drape.checked > 100);
  assert.equal(report.drape.missingPicks, 0);
  assert.equal(report.drape.coverage.background, 0);
  assert.equal(report.drape.coverage.untextured, 0);
  assert.ok(report.drape.negativeControl.modifiedAssociations > 0);
  assert.ok(
    report.drape.negativeControl.failureCount >
      report.drape.negativeControl.checked / 2,
    "Real GPU imagery shifted by 1km must fail the coordinate oracle",
  );
  assert.equal(report.drape.failureCount, 0, JSON.stringify(report.drape));
  assert.ok(
    report.drape.maximumHitHeight - report.drape.minimumHitHeight > 500,
  );
  await captureM1Scene(page, report, output, "terrain-coordinate-drape", {
    drape: report.drape,
  });
  report.checks.push(
    "GPU imagery coordinates agree with independent native terrain ray picks",
  );
  report.requests = await page.evaluate(() => ({
    terrain: window.__m1.terrainRequests,
    imagery: window.__m1.imageryRequests,
    errors: window.__m1.providerErrors,
  }));
  assert.ok(
    report.requests.terrain.filter(
      (tile) => tile.state === "resolved" && tile.quantized,
    ).length > 30,
  );
  assert.ok(
    new Set(report.requests.terrain.map((tile) => tile.level)).size > 5,
  );
  assert.ok(
    Math.max(...report.requests.imagery.map((tile) => tile.level)) >= 12,
  );
  assert.deepEqual(report.requests.errors, []);
  report.destroy = await destroyM1Scene(page);
  report.checks.push("balanced terrain/imagery resource destruction");
});
