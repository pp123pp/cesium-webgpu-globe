import { writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

// Authored, fixed shape parameters. This runs offline, before the existing
// build-solar-textures pipeline; the renderer never generates random noise.
// Rows: angle, radial end, half width, bend, shoulder, opacity, root radius.
const broad = [
  [-173, 410, 66, 24, -18, 0.14, 18],
  [-148, 345, 84, -30, 23, 0.26, 12],
  [-121, 455, 58, 37, 15, 0.12, 25],
  [-98, 375, 71, 16, -25, 0.16, 18],
  [-76, 475, 63, -44, 27, 0.20, 30],
  [-53, 326, 81, 29, -19, 0.27, 15],
  [-29, 428, 60, -35, 22, 0.10, 22],
  [-7, 385, 76, 18, -30, 0.18, 14],
  [21, 465, 65, 34, 16, 0.23, 23],
  [48, 350, 83, -25, 24, 0.24, 16],
  [70, 420, 57, 39, -18, 0.08, 27],
  [94, 310, 76, -18, -25, 0.13, 10],
  [117, 465, 69, -41, 21, 0.24, 21],
  [143, 390, 80, 32, -17, 0.18, 17],
  [165, 470, 58, -26, 26, 0.14, 24],
];

const fine = [
  [-178, 365, 12, 26, -8, 0.18, 25], [-169, 278, 20, -18, 12, 0.19, 42],
  [-143, 420, 11, 35, 9, 0.14, 32], [-133, 332, 17, -24, -13, 0.17, 28],
  [-127, 452, 13, 19, 11, 0.15, 46], [-109, 268, 21, 30, -10, 0.20, 24],
  [-100, 390, 14, -34, 14, 0.17, 34], [-92, 440, 10, 27, -7, 0.14, 37],
  [-65, 305, 19, -17, 13, 0.20, 25], [-57, 405, 15, 38, -12, 0.17, 31],
  [-37, 280, 22, -26, 9, 0.18, 45], [-29, 455, 12, -20, -11, 0.14, 26],
  [-24, 355, 17, 29, 13, 0.19, 35], [-2, 290, 20, -17, -8, 0.18, 20],
  [9, 435, 11, 36, 10, 0.16, 33], [17, 340, 18, -30, 13, 0.17, 44],
  [58, 278, 23, 19, -9, 0.21, 29], [65, 415, 13, -33, 12, 0.15, 36],
  [77, 355, 17, 24, -14, 0.18, 22], [88, 255, 22, -16, 11, 0.20, 39],
  [105, 448, 12, 38, 9, 0.15, 27], [115, 388, 16, -23, -13, 0.17, 32],
  [122, 302, 21, 31, 12, 0.19, 41], [149, 458, 12, -36, 8, 0.14, 28],
  [157, 340, 18, 22, -12, 0.18, 36], [164, 410, 13, -27, 10, 0.16, 24],
];

const number = (value) => value.toFixed(2);

function silhouette(row, index, widthScale) {
  const [, end, width, bend, shoulder, , start] = row;
  const side = (sign) => {
    const points = [];
    for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const x = start + (end - start) * t;
    const center = bend * t * t + shoulder * Math.sin(Math.PI * t);
    const taper = Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.75);
    const shoulderWidth = 0.78 + 0.22 * Math.sin(5.1 * t + index * 1.7);
    const asymmetricSide = 1 + sign * 0.12 * Math.sin(4.3 * t + index);
    const y = center + sign * width * widthScale * taper * shoulderWidth * asymmetricSide;
    points.push(`${number(x)} ${number(y)}`);
    }
    return points;
  };
  const points = [...side(1), ...side(-1).reverse()];
  return `M${points.join(" L")} Z`;
}

function artwork(rows, isFine) {
  const band = isFine ? "fine" : "mid";
  const blur = isFine ? 8 : 22;
  const definitions = rows.map((row, i) => {
    const [, end, , , , , start] = row;
    // Coordinates follow each rotated plume, not a shared object-bounding-box
    // diagonal. Zero-opacity endpoints remove recognizable caps and cutoffs.
    const middle = isFine ? 0.48 + (i % 3) * 0.06 : 0.62;
    const peak = (0.14 + ((i * 7) % 9) * 0.018).toFixed(3);
    const shoulder = (0.38 + ((i * 3) % 5) * 0.027).toFixed(3);
    const fade = (0.62 + ((i * 5) % 7) * 0.012).toFixed(3);
    return `    <linearGradient id="plume${i}" gradientUnits="userSpaceOnUse" x1="${start}" y1="0" x2="${end}" y2="0">
      <stop stop-color="#fff" stop-opacity="0"/>
      <stop offset=".10" stop-color="#fff" stop-opacity=".72"/>
      <stop offset="${peak}" stop-color="#fff" stop-opacity="1"/>
      <stop offset="${shoulder}" stop-color="#fff" stop-opacity="${middle}"/>
      <stop offset="${fade}" stop-color="#fff" stop-opacity=".27"/>
      <stop offset=".84" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`;
  });
  const shapes = rows.map((row, i) => {
    const [angle, , , , , energy] = row;
    const opacity = energy * (isFine ? 1 : 0.90);
    // Each core is nested inside a wider, lower-density support. Overlapping
    // supports merge the roots and shoulders without drawing closed rims.
    return `  <g transform="translate(512 512) rotate(${angle})" fill="url(#plume${i})">
    <path d="${silhouette(row, i, 1.7)}" opacity="${number(opacity * 0.42)}" filter="url(#diffuse)"/>
    <path d="${silhouette(row, i, 1)}" opacity="${number(opacity)}" filter="url(#feather)"/>
  </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- Original deterministic ${band}-scale corona artwork. Regenerate with coordination/ci/generate-corona-artwork.mjs. -->
  <defs>
    <filter id="feather" x="-60%" y="-300%" width="220%" height="700%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}"/></filter>
    <filter id="diffuse" x="-60%" y="-300%" width="220%" height="700%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur * 1.65}"/></filter>
    <radialGradient id="core">
      <stop stop-color="#fff" stop-opacity="${isFine ? ".25" : ".19"}"/>
      <stop offset=".20" stop-color="#fff" stop-opacity="${isFine ? ".10" : ".11"}"/>
      <stop offset=".55" stop-color="#fff" stop-opacity="${isFine ? ".025" : ".045"}"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
${definitions.join("\n")}
  </defs>
  <circle cx="512" cy="512" r="495" fill="url(#core)"/>
${shapes.join("\n")}
</svg>\n`;
}

const directory = new URL("../../packages/engine/Source/Assets/Textures/WebGPU/Solar/Corona/", import.meta.url);
for (const [name, rows, isFine] of [["corona-mid.svg", broad, false], ["corona-fine.svg", fine, true]]) {
  await writeFile(fileURLToPath(new URL(name, directory)), artwork(rows, isFine));
}
