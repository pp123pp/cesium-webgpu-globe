import { Cartesian2, Cartesian3, DeveloperError, Matrix4 } from "@cesium/core";

const centerEyeScratch = new Cartesian3();
const relativeViewScratch = new Matrix4();
const projectionScratch = new Matrix4();
const positionScratch = new Cartesian3();
const textureCoordinatesScratch = new Cartesian2();

/**
 * Computes the M1 perspective transform for positions relative to a terrain
 * mesh's center. All cancellation of Earth-sized coordinates happens in CPU
 * double precision, before the caller uploads the matrix as float32.
 *
 * The result uses reversed WebGPU depth: near maps to one and far to zero.
 * Pair it with depth32float, a clear value of zero and a greater comparison.
 * The native camera and its projection matrix are not modified.
 *
 * @param {Camera} camera The camera with a finite perspective frustum.
 * @param {Cartesian3} center The mesh's Earth-fixed center.
 * @param {Matrix4} [result] The matrix to receive the result.
 * @returns {Matrix4} The relative-position to WebGPU clip-space transform.
 * @private
 */
export function computeRelativeViewProjection(
  camera,
  center,
  result = new Matrix4(),
) {
  const frustum = camera.frustum;
  const near = frustum.near;
  const far = frustum.far;
  if (
    !Number.isFinite(near) ||
    !Number.isFinite(far) ||
    near <= 0 ||
    far <= near
  ) {
    throw new DeveloperError(
      "M1 requires finite perspective distances with 0 < near < far.",
    );
  }

  const projection = Matrix4.clone(frustum.projectionMatrix, projectionScratch);
  if (projection[11] !== -1 || projection[15] !== 0) {
    throw new DeveloperError("M1 requires a perspective frustum.");
  }

  // zWebGPU = (wOpenGL - zOpenGL) / 2. Bake this into the projection
  // before float32 conversion; doing the subtraction in a shader loses
  // distant depth when float32 rounds zOpenGL and wOpenGL to the same value.
  // Use the analytic coefficients to avoid subtracting nearly equal doubles.
  // All X/Y entries, including off-center offsets, remain native Cesium values.
  projection[2] = 0;
  projection[6] = 0;
  projection[10] = near / (far - near);
  projection[14] = near * (far / (far - near));

  const view = camera.viewMatrix;
  Matrix4.multiplyByPoint(view, center, centerEyeScratch);
  Matrix4.setTranslation(view, centerEyeScratch, relativeViewScratch);
  return Matrix4.multiply(projection, relativeViewScratch, result);
}

/**
 * Converts native TerrainEncoding layouts into the M1 WebGPU vertex layout.
 * Native decodePosition returns Earth-fixed coordinates for both NONE and
 * BITS12 encodings; subtract the center before writing a float32 component.
 * Surface and skirt vertices are retained. Index and center ownership stays
 * with the supplied mesh.
 *
 * @param {TerrainMesh} mesh The native, decoded terrain mesh.
 * @returns {{vertices: Float32Array, indices: Uint8Array|Uint16Array|Uint32Array, center: Cartesian3}}
 *          Six floats per vertex: relative X/Y/Z, U/V, Web Mercator T (or V).
 * @private
 */
export function decodeTerrainMesh(mesh) {
  const source = mesh.vertices;
  const encoding = mesh.encoding;
  const vertexCount = source.length / encoding.stride;
  const vertices = new Float32Array(vertexCount * 6);

  for (let index = 0; index < vertexCount; index++) {
    encoding.decodePosition(source, index, positionScratch);
    Cartesian3.subtract(positionScratch, mesh.center, positionScratch);
    encoding.decodeTextureCoordinates(source, index, textureCoordinatesScratch);
    const offset = index * 6;
    vertices[offset] = positionScratch.x;
    vertices[offset + 1] = positionScratch.y;
    vertices[offset + 2] = positionScratch.z;
    vertices[offset + 3] = textureCoordinatesScratch.x;
    vertices[offset + 4] = textureCoordinatesScratch.y;
    vertices[offset + 5] = encoding.hasWebMercatorT
      ? encoding.decodeWebMercatorT(source, index)
      : textureCoordinatesScratch.y;
  }

  return { vertices, indices: mesh.indices, center: mesh.center };
}

const WebGPUGlobeMath = { computeRelativeViewProjection, decodeTerrainMesh };
export default WebGPUGlobeMath;
