import { Cartesian3, DeveloperError, Ellipsoid, Interval } from "@cesium/core";
import { intersectEllipsoid } from "./WebGPUPlanetMath.js";

/**
 * Curved ECEF cloud geometry only. Axis expansion approximates constant geodetic
 * height; maximumHeightError bounds its shortfall for an oblate ellipsoid.
 * No density, lighting or GPU resources are created by this private model.
 * @private
 */
class WebGPUCloudLayer {
  constructor(options = {}) {
    const ellipsoid = options.ellipsoid ?? Ellipsoid.WGS84;
    const base = options.baseHeight ?? 2000;
    const top = options.topHeight ?? 6000;
    const { x, y, z } = ellipsoid.radii;
    if (
      ![x, y, z, base, top].every(Number.isFinite) ||
      x <= 0 ||
      y !== x ||
      z <= 0 ||
      z > x ||
      base < 0 ||
      top <= base
    ) {
      throw new DeveloperError(
        "Clouds require an oblate ellipsoid and 0 <= baseHeight < topHeight in meters.",
      );
    }
    this.ellipsoid = ellipsoid;
    this.baseHeight = base;
    this.topHeight = top;
    this.innerEllipsoid = new Ellipsoid(x + base, y + base, z + base);
    this.outerEllipsoid = new Ellipsoid(x + top, y + top, z + top);
    // Support-function bound between axis expansion and a geodetic normal offset.
    this.maximumHeightError = top * (1 - (2 * Math.sqrt(x * z)) / (x + z));
    this.uniformValues = new Float32Array(24);
  }

  /** Pack split reciprocal radii and CPU-double camera constants for WGSL. */
  update(planetState) {
    const position = planetState.cameraPositionWC;
    for (const [i, boundary] of [
      this.innerEllipsoid,
      this.outerEllipsoid,
      this.ellipsoid,
    ].entries()) {
      const inverse = boundary.oneOverRadii;
      const q = Cartesian3.multiplyComponents(
        position,
        inverse,
        new Cartesian3(),
      );
      let c = Cartesian3.magnitudeSquared(q) - 1;
      if (Math.abs(c) <= 16 * Number.EPSILON) {
        c = 0;
      }
      const values = [inverse.x, inverse.y, inverse.z, c];
      for (let j = 0; j < 4; ++j) {
        const high = Math.fround(values[j]);
        this.uniformValues[i * 8 + j] = high;
        this.uniformValues[i * 8 + 4 + j] = values[j] - high;
      }
    }
    return this;
  }

  /**
   * Up to two ordered visible shell segments; unit-ray distances are meters.
   * Outer tangency is a zero-length contact. Positive-length solid Earth and
   * measured terrain stop the ray; an inner tangent does not remove material.
   */
  intersect(ray, sceneDistance = Infinity) {
    if (
      !(sceneDistance >= 0) ||
      (sceneDistance !== Infinity && !Number.isFinite(sceneDistance))
    ) {
      throw new DeveloperError(
        "Scene distance must be nonnegative meters or Infinity.",
      );
    }
    const outer = intersectEllipsoid(ray, this.outerEllipsoid);
    if (outer === undefined) {
      return [];
    }
    const inner = intersectEllipsoid(ray, this.innerEllipsoid);
    const earth = intersectEllipsoid(ray, this.ellipsoid);
    const stop = Math.min(
      outer.stop,
      sceneDistance,
      earth !== undefined && earth.stop > earth.start ? earth.start : Infinity,
    );
    if (stop < outer.start) {
      return [];
    }
    if (
      inner === undefined ||
      inner.stop <= inner.start ||
      inner.stop < outer.start ||
      inner.start > stop
    ) {
      return [new Interval(outer.start, stop)];
    }
    const segments = [];
    if (inner.start > outer.start) {
      segments.push(new Interval(outer.start, Math.min(inner.start, stop)));
    }
    if (inner.stop < stop) {
      segments.push(new Interval(Math.max(inner.stop, outer.start), stop));
    }
    return segments;
  }
}

export default WebGPUCloudLayer;
