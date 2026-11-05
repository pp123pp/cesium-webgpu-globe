/**
 * Periodic RGBA8 volume shared by weather, shape and erosion sampling.
 * R combines gradient and cellular noise. GBA contain progressively finer
 * cellular bands so a distant ray can drop detail without changing weather.
 * @private
 */
export default function createCloudNoise() {
  const size = 32;
  const coarse = makeLattice(4, 0x51ee0371);
  const medium = makeLattice(8, 0x71ad3619);
  const fine = makeLattice(12, 0x2cc531b7);
  const data = new Uint8Array(size ** 3 * 4);
  let offset = 0;
  for (let z = 0; z < size; ++z) {
    for (let y = 0; y < size; ++y) {
      for (let x = 0; x < size; ++x) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const w = (z + 0.5) / size;
        const cells = cellular(coarse, u, v, w);
        const body = 0.47 + 0.7 * gradient(coarse, u, v, w) + 0.35 * (cells - 0.5);
        data[offset++] = Math.round(255 * Math.min(1, Math.max(0, body)));
        data[offset++] = Math.round(255 * cells);
        data[offset++] = Math.round(255 * cellular(medium, u, v, w));
        data[offset++] = Math.round(255 * cellular(fine, u, v, w));
      }
    }
  }
  return { size, data };
}

function makeLattice(period, seed) {
  const points = new Float32Array(period ** 3 * 3);
  const gradients = new Float32Array(points.length);
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < points.length; i += 3) {
    for (let axis = 0; axis < 3; ++axis) {
      points[i + axis] = 0.12 + 0.76 * random();
    }
    const angle = 2 * Math.PI * random();
    const z = 2 * random() - 1;
    const radius = Math.sqrt(1 - z * z);
    gradients[i] = radius * Math.cos(angle);
    gradients[i + 1] = radius * Math.sin(angle);
    gradients[i + 2] = z;
  }
  return { period, points, gradients };
}

function latticeIndex(x, y, z, period) {
  const wrap = (v) => (v + period) % period;
  return 3 * (wrap(x) + period * (wrap(y) + period * wrap(z)));
}

function cellular({ period, points }, u, v, w) {
  const x = u * period;
  const y = v * period;
  const z = w * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let nearest = 1;
  for (let k = iz - 1; k <= iz + 1; ++k) {
    for (let j = iy - 1; j <= iy + 1; ++j) {
      for (let i = ix - 1; i <= ix + 1; ++i) {
        const index = latticeIndex(i, j, k, period);
        const dx = i + points[index] - x;
        const dy = j + points[index + 1] - y;
        const dz = k + points[index + 2] - z;
        nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
      }
    }
  }
  return 1 - Math.sqrt(nearest);
}

function gradient({ period, gradients }, u, v, w) {
  const x = u * period;
  const y = v * period;
  const z = w * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  let sum = 0;
  for (let k = 0; k < 2; ++k) {
    for (let j = 0; j < 2; ++j) {
      for (let i = 0; i < 2; ++i) {
        const index = latticeIndex(ix + i, iy + j, iz + k, period);
        const projected =
          gradients[index] * (x - ix - i) +
          gradients[index + 1] * (y - iy - j) +
          gradients[index + 2] * (z - iz - k);
        sum += projected * (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
      }
    }
  }
  return sum;
}
