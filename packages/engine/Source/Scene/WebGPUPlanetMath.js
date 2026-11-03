import {
  Cartesian3,
  DeveloperError,
  Ellipsoid,
  IntersectionTests,
  Interval,
  Matrix3,
  Ray,
} from "@cesium/core";
import CelestialFrameTransforms from "../Core/CelestialFrameTransforms.js";
import Simon1994PlanetaryPositions from "../Core/Simon1994PlanetaryPositions.js";

const normalizedRay = new Ray();
const scaledOrigin = new Cartesian3();
const scaledDirection = new Cartesian3();
const earthInterval = new Interval();
const solarRotation = new Matrix3();
// A double-precision rounding allowance in dimensionless ellipsoid space.
// At the WGS84 surface this is about 12 nm, not a terrain-height tolerance.
const boundaryEpsilon = 16 * Number.EPSILON;

function checkEllipsoid(ellipsoid) {
  const r = ellipsoid?.radii;
  if (!r || ![r.x, r.y, r.z].every((v) => Number.isFinite(v) && v > 0)) {
    throw new DeveloperError("Planet radii must be finite positive meters.");
  }
}

/**
 * Defines a true ellipsoid and a separate enclosing atmosphere sphere in meters.
 * Atmosphere height is above the maximum radius, not height above every latitude.
 * The sphere must never replace the terrain ellipsoid.
 * @param {Ellipsoid} [ellipsoid=Ellipsoid.WGS84] The terrain ellipsoid.
 * @param {number} [atmosphereHeight=100000] Boundary height above the largest axis, in meters.
 * @returns {object} Planet parameters; maximumSphereError bounds the radial approximation.
 * @private
 */
export function createPlanetParameters(
  ellipsoid = Ellipsoid.WGS84,
  atmosphereHeight = 100000,
) {
  checkEllipsoid(ellipsoid);
  const atmosphereRadius = ellipsoid.maximumRadius + atmosphereHeight;
  if (
    !Number.isFinite(atmosphereHeight) ||
    atmosphereHeight <= 0 ||
    !Number.isFinite(atmosphereRadius) ||
    atmosphereRadius <= ellipsoid.maximumRadius
  ) {
    throw new DeveloperError(
      "Atmosphere height must be finite positive meters.",
    );
  }
  return {
    ellipsoid,
    radii: Cartesian3.clone(ellipsoid.radii),
    inverseRadii: Cartesian3.clone(ellipsoid.oneOverRadii),
    maximumRadius: ellipsoid.maximumRadius,
    minimumRadius: ellipsoid.minimumRadius,
    maximumSphereError: ellipsoid.maximumRadius - ellipsoid.minimumRadius,
    atmosphereHeight,
    atmosphereRadius,
    atmosphereEllipsoid: new Ellipsoid(
      atmosphereRadius,
      atmosphereRadius,
      atmosphereRadius,
    ),
  };
}

/**
 * Native Cesium geocentric Earth-to-Sun unit direction in Earth-fixed axes.
 * This is a direction, so camera translation is never subtracted. The native
 * celestial transform uses its TEME/pseudo-fixed fallback when ICRF data is absent.
 * @param {JulianDate} time Scene time, with native Cesium time-scale handling.
 * @param {Cartesian3} [result] Receives the Earth-fixed unit direction.
 * @returns {Cartesian3} The Earth-to-Sun direction.
 * @private
 */
export function computeSunDirectionWC(time, result = new Cartesian3()) {
  CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(
    time,
    solarRotation,
  );
  Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    time,
    result,
  );
  Matrix3.multiplyByVector(solarRotation, result, result);
  return Cartesian3.normalize(result, result);
}

function normalizeRay(ray) {
  const o = ray?.origin;
  const d = ray?.direction;
  if (!o || !d || ![o.x, o.y, o.z, d.x, d.y, d.z].every(Number.isFinite)) {
    throw new DeveloperError("Ray origin and direction must be finite.");
  }
  const scale = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
  if (scale === 0) {
    throw new DeveloperError("Ray direction must be nonzero.");
  }
  Cartesian3.clone(o, normalizedRay.origin);
  // Scale first so both very small and very large nonunit directions are valid.
  Cartesian3.fromElements(
    d.x / scale,
    d.y / scale,
    d.z / scale,
    normalizedRay.direction,
  );
  Cartesian3.normalize(normalizedRay.direction, normalizedRay.direction);
  return normalizedRay;
}

/**
 * Sorted forward intersection interval for a meter-valued ECEF ray. Nonunit
 * directions are normalized without mutating input; t is always meters.
 * Surface outward/tangent contact is [0,0]. A miss is undefined. The native
 * stable quadratic handles ordinary cases; only its exact-surface half-exit
 * and rounding-sensitive tangent cases are adapted here, outside WebGL.
 * @param {Ray} ray ECEF origin in meters and finite nonzero direction.
 * @param {Ellipsoid} [ellipsoid=Ellipsoid.WGS84] Intersection boundary.
 * @param {Interval} [result] Receives the interval.
 * @returns {Interval|undefined} Sorted nonnegative entry/exit distances, or no hit.
 * @private
 */
export function intersectEllipsoid(
  ray,
  ellipsoid = Ellipsoid.WGS84,
  result = new Interval(),
) {
  checkEllipsoid(ellipsoid);
  const unitRay = normalizeRay(ray);
  const q = Cartesian3.multiplyComponents(
    ellipsoid.oneOverRadii,
    unitRay.origin,
    scaledOrigin,
  );
  const w = Cartesian3.multiplyComponents(
    ellipsoid.oneOverRadii,
    unitRay.direction,
    scaledDirection,
  );
  const q2 = Cartesian3.magnitudeSquared(q);
  const w2 = Cartesian3.magnitudeSquared(w);
  const qw = Cartesian3.dot(q, w);
  if (!Number.isFinite(q2) || !Number.isFinite(w2) || w2 === 0) {
    throw new DeveloperError(
      "Ray or ellipsoid exceeds finite intersection precision.",
    );
  }
  if (Math.abs(q2 - 1) <= boundaryEpsilon) {
    const tangentTolerance = boundaryEpsilon * Math.sqrt(q2 * w2);
    result.start = 0;
    result.stop = qw < -tangentTolerance ? (-2 * qw) / w2 : 0;
    return result;
  }
  if (q2 > 1 && qw < 0) {
    const discriminant = qw * qw - w2 * (q2 - 1);
    if (Math.abs(discriminant) <= boundaryEpsilon * w2 * q2) {
      result.start = result.stop = -qw / w2;
      return result;
    }
  }
  const hit = IntersectionTests.rayEllipsoid(unitRay, ellipsoid);
  if (hit === undefined) {
    return undefined;
  }
  result.start = hit.start;
  result.stop = hit.stop;
  return result;
}

/**
 * Intersects the separate origin-centered atmosphere sphere in meters.
 * @param {Ray} ray ECEF ray; direction need not be normalized.
 * @param {object} planet Parameters from createPlanetParameters.
 * @param {Interval} [result] Receives the forward interval.
 * @returns {Interval|undefined} Atmospheric entry/exit distances.
 * @private
 */
export function intersectAtmosphere(ray, planet, result = new Interval()) {
  return intersectEllipsoid(ray, planet.atmosphereEllipsoid, result);
}

/**
 * Clips a visible atmosphere segment by the solid ellipsoid and measured terrain.
 * Zero-length tangent contacts do not occlude. A camera inside the solid body has
 * no visible atmosphere segment. Real scene depth may stop the ray before the
 * analytic ellipsoid, for example at a mountain. This does not modify M1 terrain.
 * @param {Ray} ray ECEF ray in meters.
 * @param {object} planet Planet parameters.
 * @param {number} [sceneDistance=Infinity] Unit-ray meters, Infinity for cleared depth.
 * @param {Interval} [result] Receives the visible segment.
 * @returns {Interval|undefined} Positive-length visible atmosphere segment.
 * @private
 */
export function clipAtmosphereRay(
  ray,
  planet,
  sceneDistance = Infinity,
  result = new Interval(),
) {
  if (
    !(sceneDistance >= 0) ||
    (sceneDistance !== Infinity && !Number.isFinite(sceneDistance))
  ) {
    throw new DeveloperError(
      "Scene distance must be nonnegative meters or Infinity.",
    );
  }
  if (intersectAtmosphere(ray, planet, result) === undefined) {
    return undefined;
  }
  const earth = intersectEllipsoid(ray, planet.ellipsoid, earthInterval);
  result.stop = Math.min(result.stop, sceneDistance);
  if (earth !== undefined && earth.stop > earth.start) {
    result.stop = Math.min(result.stop, earth.start);
  }
  return result.stop > result.start ? result : undefined;
}

const WebGPUPlanetMath = {
  createPlanetParameters,
  computeSunDirectionWC,
  intersectEllipsoid,
  intersectAtmosphere,
  clipAtmosphereRay,
};
export default WebGPUPlanetMath;
