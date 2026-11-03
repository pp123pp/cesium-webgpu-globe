import {
  Cartesian3,
  Cartographic,
  DeveloperError,
  Ellipsoid,
  EncodedCartesian3,
  JulianDate,
  Matrix3,
  Matrix4,
} from "@cesium/core";
import WebGPUDepth from "../Renderer/WebGPUDepth.js";
import {
  createPlanetParameters,
  computeSunDirectionWC,
} from "./WebGPUPlanetMath.js";
import CelestialFrameTransforms from "../Core/CelestialFrameTransforms.js";
import Simon1994PlanetaryPositions from "../Core/Simon1994PlanetaryPositions.js";
import { validateMoonParameters, validateStarParameters } from "./WebGPUSpace.js";

/**
 * Double-precision planet/camera state with the vec4-aligned WebGPUPlanet WGSL
 * layout. This record allocates no GPU resources and renders no atmosphere.
 * Positions/distances are meters; rotations/directions are dimensionless.
 * @private
 */
class WebGPUPlanetState {
  constructor(ellipsoid = Ellipsoid.WGS84, atmosphereHeight = 100000) {
    this.planet = createPlanetParameters(ellipsoid, atmosphereHeight);
    this.cameraPositionWC = new Cartesian3();
    this.cameraGeocentricDistance = 0;
    this.cameraHeight = 0;
    this.sunDirectionWC = new Cartesian3();
    this.sunDirectionEC = new Cartesian3();
    this.moonDirectionWC = new Cartesian3();
    this.moonDistance = 0;
    this.moonAngularRadius = 0;
    this.moonIllumination = 0;
    this._moonPosition = new Cartesian3();
    this._moonRotation = new Matrix3();
    this.time = new JulianDate();
    // Seventeen vec4 records: M2.1 planet state, lunar data and ICRF star-frame rotation.
    this.uniformValues = new Float32Array(68);
    this._encodedCamera = new EncodedCartesian3();
    this._cartographic = new Cartographic();
    this._projection = new Matrix4();
    this._scaledCamera = new Cartesian3();
  }

  /**
   * Updates after scene callbacks, using the same time and native camera as terrain.
   * @param {Camera} camera Native Cesium camera, including its reference transform.
   * @param {JulianDate} time Actual scene render time.
   * @returns {WebGPUPlanetState} This reused frame record.
   */
  update(camera, time, moon = { show: true, moonlightIntensity: 0.0025 }, stars = { show: true, intensity: 1 }) {
    const planet = this.planet;
    validateMoonParameters(moon);
    validateStarParameters(stars);
    const position = Cartesian3.clone(camera.positionWC, this.cameraPositionWC);
    this.cameraGeocentricDistance = Cartesian3.magnitude(position);
    const cartographic = planet.ellipsoid.cartesianToCartographic(
      position,
      this._cartographic,
    );
    if (cartographic === undefined) {
      throw new DeveloperError(
        "Planet camera must have a defined geodetic height.",
      );
    }
    this.cameraHeight = cartographic.height;
    JulianDate.clone(time, this.time);
    computeSunDirectionWC(time, this.sunDirectionWC);
    CelestialFrameTransforms.computeIcrfToCentralBodyFixedMatrix(
      time,
      this._moonRotation,
    );
    Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
      time,
      this._moonPosition,
    );
    Matrix3.multiplyByVector(
      this._moonRotation,
      this._moonPosition,
      this._moonPosition,
    );
    Cartesian3.subtract(
      this._moonPosition,
      position,
      this.moonDirectionWC,
    );
    this.moonDistance = Cartesian3.magnitude(this.moonDirectionWC);
    if (!(this.moonDistance > 1)) {
      throw new DeveloperError("Moon ephemeris produced an invalid camera distance.");
    }
    Cartesian3.divideByScalar(
      this.moonDirectionWC,
      this.moonDistance,
      this.moonDirectionWC,
    );
    this.moonAngularRadius = moon.show ? Math.asin(Math.min(1, 1737400 / this.moonDistance)) : 0;
    // Full Moon occurs when the Moon lies opposite the Sun as seen from Earth.
    this.moonIllumination = Math.max(
      0,
      Math.min(1, (1 - Cartesian3.dot(this.moonDirectionWC, this.sunDirectionWC)) * 0.5),
    );
    Matrix4.multiplyByPointAsVector(
      camera.viewMatrix,
      this.sunDirectionWC,
      this.sunDirectionEC,
    );
    Cartesian3.normalize(this.sunDirectionEC, this.sunDirectionEC);
    EncodedCartesian3.fromCartesian(position, this._encodedCamera);
    const projection = WebGPUDepth.computeProjection(
      camera.frustum,
      this._projection,
    );
    const q = Cartesian3.multiplyComponents(
      position,
      planet.inverseRadii,
      this._scaledCamera,
    );
    const q2 = Cartesian3.magnitudeSquared(q);
    const sphereQ = this.cameraGeocentricDistance / planet.atmosphereRadius;
    // Compute cancellation-sensitive constants in double precision. In particular,
    // a 1 cm camera height must not disappear in a float32 dot(q,q)-1 operation.
    let ellipsoidC = q2 - 1;
    let atmosphereC = (sphereQ - 1) * (sphereQ + 1);
    if (Math.abs(ellipsoidC) <= 16 * Number.EPSILON) {
      ellipsoidC = 0;
    }
    if (Math.abs(atmosphereC) <= 16 * Number.EPSILON) {
      atmosphereC = 0;
    }
    const values = this.uniformValues;
    const write = (offset, vector, w = 0) => {
      values[offset] = vector.x;
      values[offset + 1] = vector.y;
      values[offset + 2] = vector.z;
      values[offset + 3] = w;
    };
    write(0, planet.radii, planet.atmosphereRadius);
    write(4, planet.inverseRadii, 1 / planet.atmosphereRadius);
    write(8, this._encodedCamera.high, this.cameraGeocentricDistance);
    write(12, this._encodedCamera.low, this.cameraHeight);
    write(16, this.sunDirectionWC);
    write(20, this.sunDirectionEC);
    write(24, camera.rightWC);
    write(28, camera.upWC);
    write(32, camera.directionWC);
    values.set(
      [projection[0], projection[5], projection[8], projection[9]],
      36,
    );
    values.set(
      [camera.frustum.near, camera.frustum.far, projection[10], projection[14]],
      40,
    );
    values.set([ellipsoidC, atmosphereC, planet.atmosphereHeight, 0], 44);
    write(48, this.moonDirectionWC, this.moonAngularRadius);
    values.set([this.moonIllumination, this.moonDistance, stars.show ? stars.intensity : 0, moon.moonlightIntensity], 52);
    // Inverse ICRF-to-ECEF rotation is the transpose of the orthonormal
    // celestial matrix. Pack its three rows for a per-ray inertial star lookup.
    values.set([this._moonRotation[0], this._moonRotation[1], this._moonRotation[2], 0], 56);
    values.set([this._moonRotation[3], this._moonRotation[4], this._moonRotation[5], 0], 60);
    values.set([this._moonRotation[6], this._moonRotation[7], this._moonRotation[8], 0], 64);
    if (!values.every(Number.isFinite)) {
      throw new DeveloperError(
        "Planet state exceeds finite float32 shader precision.",
      );
    }
    return this;
  }
}

export default WebGPUPlanetState;
