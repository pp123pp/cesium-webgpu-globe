import { Cartesian3, DeveloperError, Matrix4 } from "@cesium/core";

function validateFrustum(near, far) {
  if (
    !Number.isFinite(near) ||
    !Number.isFinite(far) ||
    near <= 0 ||
    far <= near
  ) {
    throw new DeveloperError(
      "WebGPU requires finite perspective distances with 0 < near < far.",
    );
  }
}

/**
 * Retains native Cesium X/Y projection, mapping near to 1 and far to 0. Compute
 * analytic coefficients in double precision before float32 upload, avoiding
 * cancellation between distant OpenGL clip Z and W. Does not mutate the frustum.
 * @param {PerspectiveFrustum|PerspectiveOffCenterFrustum} frustum Finite native frustum.
 * @param {Matrix4} [result] Receives the WebGPU projection.
 * @returns {Matrix4} Finite reversed-Z projection.
 * @private
 */
export function computeProjection(frustum, result = new Matrix4()) {
  const { near, far } = frustum;
  validateFrustum(near, far);
  Matrix4.clone(frustum.projectionMatrix, result);
  if (result[11] !== -1 || result[15] !== 0) {
    throw new DeveloperError("WebGPU requires a perspective frustum.");
  }
  result[2] = 0;
  result[6] = 0;
  result[10] = near / (far - near);
  result[14] = near * (far / (far - near));
  return result;
}

/**
 * Reconstructs positive axial eye distance, in meters. Zero means background;
 * the exact far plane is not distinguishable from clear under greater comparison.
 * @param {number} depth Stored reversed depth in [0,1].
 * @param {number} near Positive near plane in meters.
 * @param {number} far Finite far plane in meters.
 * @returns {number} Axial distance in meters, or Infinity for cleared depth.
 * @private
 */
export function reconstructEyeDistance(depth, near, far) {
  validateFrustum(near, far);
  if (!Number.isFinite(depth) || depth < 0 || depth > 1) {
    throw new DeveloperError(
      "Stored WebGPU depth must be finite and in [0,1].",
    );
  }
  return depth === 0 ? Infinity : near * (far / (near + depth * (far - near)));
}

/**
 * Converts axial depth to distance along a forward world-space ray.
 * @param {number} depth Stored reversed depth.
 * @param {Cartesian3} directionWC Ray direction in ECEF axes.
 * @param {Cartesian3} cameraDirectionWC Camera forward direction in ECEF axes.
 * @param {number} near Near distance in meters.
 * @param {number} far Far distance in meters.
 * @returns {number} Unit-ray distance in meters, or Infinity for clear.
 * @private
 */
export function reconstructRayDistance(
  depth,
  directionWC,
  cameraDirectionWC,
  near,
  far,
) {
  const eyeDistance = reconstructEyeDistance(depth, near, far);
  const cosine =
    Cartesian3.dot(directionWC, cameraDirectionWC) /
    (Math.hypot(directionWC.x, directionWC.y, directionWC.z) *
      Math.hypot(
        cameraDirectionWC.x,
        cameraDirectionWC.y,
        cameraDirectionWC.z,
      ));
  if (!Number.isFinite(cosine) || cosine <= 0) {
    throw new DeveloperError(
      "Depth reconstruction requires a finite forward ray.",
    );
  }
  return eyeDistance / cosine;
}

/**
 * Shared by the existing Globe pipeline and future separate atmosphere passes.
 * @type {object}
 * @private
 */
const WebGPUDepth = {
  format: "depth32float",
  clearValue: 0,
  compare: "greater",
  imageryCompare: "equal",
  defaultNear: 0.1,
  defaultFar: 500000000,
  computeProjection,
  reconstructEyeDistance,
  reconstructRayDistance,
};
export default WebGPUDepth;
