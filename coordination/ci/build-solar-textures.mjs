/* global Image, document */
import { Buffer } from "node:buffer";
import console from "node:console";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/engine/Source/Assets/Textures/WebGPU/Solar",
);
const masks = [
  "Rays/radial-rays-01.svg",
  "Rays/radial-rays-02.svg",
  "Rays/radial-rays-03.svg",
  "Halo/soft-halo.svg",
  "Halo/wide-halo.svg",
  "Corona/corona-fine.svg",
  "Noise/radial-noise.svg",
];
const color = "Atmosphere/glow-gradient.svg";
const size = 512;
const manifest = [];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await fs.mkdir(path.join(root, "GPU"), { recursive: true });
  for (const relative of [...masks, color]) {
    const source = await fs.readFile(path.join(root, relative), "utf8");
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
    const pixels = await page.evaluate(async ({ dataUrl, size, isColor }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      const rgba = context.getImageData(0, 0, size, size).data;
      if (isColor) {
        return Array.from(rgba);
      }
      const alpha = new Uint8Array(size * size);
      for (let i = 0; i < alpha.length; i++) {
        alpha[i] = rgba[i * 4 + 3];
      }
      return Array.from(alpha);
    }, { dataUrl, size, isColor: relative === color });
    const bytes = Buffer.from(pixels);
    const output = path.join(
      root,
      "GPU",
      `${path.basename(relative, ".svg")}.${relative === color ? "rgba8" : "r8"}`,
    );
    await fs.writeFile(output, bytes);
    const alphaValues = relative === color
      ? bytes.filter((value, index) => index % 4 === 3 && value <= 255)
      : bytes;
    const stats = alphaValues.reduce((result, value) => ({
      min: Math.min(result.min, value),
      max: Math.max(result.max, value),
      covered: result.covered + (value > 0 ? 1 : 0),
    }), { min: 255, max: 0, covered: 0 });
    const { min, max, covered } = stats;
    manifest.push({
      source: relative,
      payload: path.relative(root, output).split(path.sep).join("/"),
      sourceDimensions: [1024, 1024],
      textureDimensions: [size, size],
      format: relative === color ? "rgba8unorm-srgb" : "r8unorm",
      colorSpace: relative === color ? "sRGB source, decoded to linear on GPU sampling" : "linear scalar coverage",
      channelSemantic: relative === color ? "authored RGBA tint ramp" : "SVG alpha coverage in R channel",
      alphaMin: min,
      alphaMax: max,
      alphaNonZeroCoverage: covered / alphaValues.length,
      byteLength: bytes.byteLength,
    });
    console.log(`${relative} -> ${path.relative(root, output)} (${bytes.byteLength} bytes; alpha ${min}..${max}; coverage ${covered / alphaValues.length})`);
  }
  await fs.writeFile(
    path.join(root, "GPU", "manifest.json"),
    JSON.stringify({ textureSize: size, assets: manifest }, null, 2),
  );
} finally {
  await browser.close();
}
