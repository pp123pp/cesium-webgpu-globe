// Focused control-flow verification for the M0 smoke harnesses.
// No browser is launched, no network is used, and every filesystem mutation
// made by a harness is intercepted in memory. Renderer tests are not simulated.
// Run: node coordination/evidence/M0.5/control-flow-probes.mjs /absolute/path/to/cesium-webgpu-globe
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { readFile as realReadFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(process.argv[2] ?? process.cwd());
const ci = path.join(repo, "coordination/ci");
const referenceDir = path.join(ci, "references/m0-webgl");
const browserHelpers = await import(
  pathToFileURL(path.join(ci, "m0-browser-config.mjs"))
);
const visualHelpers = await import(
  pathToFileURL(path.join(ci, "m0-visual-checks.mjs"))
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const localBundle = await realReadFile(
  path.join(repo, "Build/CesiumUnminified/Cesium.js"),
);
const originals = new Map();
const references = {};
for (const name of ["orbit", "oblique", "resized"]) {
  const metadataFile = path.join(referenceDir, `${name}.json`);
  const pixelsFile = path.join(referenceDir, `${name}.rgba.gz`);
  const metadataBytes = await realReadFile(metadataFile);
  const pixelBytes = await realReadFile(pixelsFile);
  const metadata = JSON.parse(metadataBytes);
  const pixels = gunzipSync(pixelBytes);
  assert.equal(hash(pixels), metadata.pixelHash, `${name}: reference hash`);
  visualHelpers.inspectGlobePixels(
    pixels,
    metadata.fixture.width,
    metadata.fixture.height,
    metadata.colors,
  );
  originals.set(metadataFile, metadataBytes);
  originals.set(pixelsFile, pixelBytes);
  references[name] = { metadata, pixels };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sourceHashes = {};

async function probe({
  name,
  backend,
  update = false,
  teardownFailure = false,
  finalWriteTimeout = false,
}) {
  const sourceFile = path.join(ci, `m0-${backend}-smoke.mjs`);
  const source = await realReadFile(sourceFile, "utf8");
  sourceHashes[backend] = hash(source);
  const executable = source
    .replace(/^import[\s\S]*?;\s*/gm, "")
    .replaceAll(
      "import.meta.url",
      JSON.stringify(pathToFileURL(sourceFile).href),
    );
  const files = new Map(
    [...originals].map(([name, bytes]) => [name, Buffer.from(bytes)]),
  );
  const directories = new Set([referenceDir]);
  const logs = [];
  const writes = [];
  let deadline;
  let closed = 0;
  let nextTimerId = 0;
  let expiryInjected = false;
  let glTeardownReached = false;
  const outputDir = `/__m0_probe_output__/${backend}`;
  const successFile = `${outputDir}/${backend}-smoke.json`;
  const errorFile = `${outputDir}/${backend}-smoke-error.json`;
  // Require both startup cleanup and failure cleanup to remove a prior PASS.
  files.set(successFile, Buffer.from('{"staleSuccess":true}'));
  const absolute = (value) =>
    path.resolve(
      repo,
      value instanceof URL ? fileURLToPath(value) : String(value),
    );
  const descendants = (candidate, parent) =>
    candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

  const locator = {
    filter: () => locator,
    waitFor: async () => {},
    screenshot: async () => Buffer.alloc(2048, 1),
  };
  const page = {
    on() {},
    route: async () => {},
    goto: async () => {},
    addScriptTag: async () => {},
    setViewportSize: async () => {},
    screenshot: async () => {},
    locator: () => locator,
    evaluate: async (callback, argument) => {
      if (backend === "webgl") {
        if (argument?.colors) {
          return references.orbit.metadata.environment;
        }
        if (argument?.fixture) {
          const { fixture } = argument;
          return {
            pixels: references[fixture.name].pixels.toString("base64"),
            frames: 3,
            readyTiles: 4,
            tilesLoaded: true,
            width: fixture.width,
            height: fixture.height,
          };
        }
        glTeardownReached = true;
        if (teardownFailure) {
          throw new Error("injected teardown failure");
        }
        return undefined;
      }
      const body = callback.toString();
      if (body.includes("HTMLCanvasElement.prototype.getContext")) {
        return {
          adapter: {
            vendor: "google",
            architecture: "swiftshader",
            description: "SwiftShader",
            isFallbackAdapter: true,
          },
          validationErrors: [],
          requestedContexts: ["webgpu"],
        };
      }
      if (body.includes("const originalGpu = navigator.gpu")) {
        return {
          checks: [...Array(8).keys()].map(
            (i) => `mock expected failure ${i + 1}`,
          ),
          expectedValidationErrors: [],
        };
      }
      if (body.includes("const events = []")) {
        return ["mock expected device loss"];
      }
      if (body.includes("__m0Diagnostics")) {
        return { stage: "control-flow-probe", errors: [] };
      }
      return undefined;
    },
  };
  const browser = {
    newPage: async () => page,
    version: () => "mock-browser",
    close: async () => {
      closed++;
    },
  };
  const bindings = {
    console: { log: (...args) => logs.push(args) },
    Buffer,
    process: {
      env: {
        M0_UPDATE_WEBGL_REFERENCE: update ? "1" : "0",
        M0_REFERENCE_DIR: referenceDir,
        M0_WEBGL_OUTPUT: outputDir,
        M0_WEBGPU_OUTPUT: outputDir,
      },
      pid: process.pid,
      platform: process.platform,
      version: process.version,
      cwd: () => repo,
    },
    setTimeout: (callback, delay) => {
      const id = ++nextTimerId;
      if (delay === 120000 || delay === 180000) {
        deadline = { callback, id };
      }
      return id;
    },
    clearTimeout: (id) => {
      if (deadline?.id === id) {
        deadline = undefined;
      }
    },
    AbortSignal: { timeout: () => undefined },
    assert,
    createHash,
    gzipSync,
    gunzipSync,
    os,
    path,
    URL,
    fileURLToPath,
    mkdir: async (target) => {
      directories.add(absolute(target));
    },
    readFile: async (target, options) => {
      const key = absolute(target);
      const bytes = files.get(key) ?? (await realReadFile(key));
      const encoding =
        typeof options === "string" ? options : options?.encoding;
      return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
    },
    writeFile: async (target, value) => {
      const key = absolute(target);
      writes.push(key);
      files.set(key, Buffer.from(value));
      if (finalWriteTimeout && key === successFile) {
        assert.ok(deadline, `${name}: live deadline required at final write`);
        expiryInjected = true;
        deadline.callback();
      }
    },
    rm: async (target) => {
      const key = absolute(target);
      for (const candidate of [...files.keys()]) {
        if (descendants(candidate, key)) {
          files.delete(candidate);
        }
      }
      for (const candidate of [...directories]) {
        if (descendants(candidate, key)) {
          directories.delete(candidate);
        }
      }
    },
    rename: async (from, to) => {
      const source = absolute(from);
      const target = absolute(to);
      const affected = [...files.keys()].filter((candidate) =>
        descendants(candidate, source),
      );
      if (!affected.length && !directories.has(source)) {
        const error = new Error(`ENOENT: ${source}`);
        error.code = "ENOENT";
        throw error;
      }
      for (const candidate of affected) {
        const bytes = files.get(candidate);
        files.delete(candidate);
        files.set(target + candidate.slice(source.length), bytes);
      }
      for (const candidate of [...directories]) {
        if (descendants(candidate, source)) {
          directories.delete(candidate);
          directories.add(target + candidate.slice(source.length));
        }
      }
    },
    fetch: async () => ({ ok: true, arrayBuffer: async () => localBundle }),
    execFileSync: (command, args) => {
      assert.equal(command, "git");
      if (args[0] === "diff") {
        return "";
      }
      assert.deepEqual(args, ["rev-parse", "HEAD"]);
      return update
        ? "724b5db8f258d0ce00c4f6b774bd38529e24252b"
        : "control-probe-current";
    },
    chromium: { launch: async () => browser },
    getBrowserConfiguration: () => browserHelpers.getBrowserConfiguration({}),
    classifyGpu: browserHelpers.classifyGpu,
    assertPhysicalGpu: browserHelpers.assertPhysicalGpu,
    ...visualHelpers,
  };
  let error;
  try {
    await new AsyncFunction(...Object.keys(bindings), executable)(
      ...Object.values(bindings),
    );
  } catch (value) {
    error = value;
  }
  const reportedPass = logs.some((args) =>
    /M0 WEB(?:GL|GPU).* PASS/.test(String(args[0])),
  );
  const expectedFailure = teardownFailure || finalWriteTimeout;
  assert.equal(reportedPass, !expectedFailure, `${name}: PASS message`);
  assert.equal(
    files.has(successFile),
    !expectedFailure,
    `${name}: success report present`,
  );
  assert.equal(
    files.has(errorFile),
    expectedFailure,
    `${name}: error report present`,
  );
  assert.ok(closed > 0, `${name}: browser cleanup`);
  if (teardownFailure) {
    assert.ok(glTeardownReached, `${name}: teardown reached`);
    assert.match(String(error), /injected teardown failure/);
  } else if (finalWriteTimeout) {
    assert.ok(expiryInjected, `${name}: timeout was actually injected`);
    assert.match(String(error), /Overall Web(?:GL|GPU) deadline exceeded/);
    assert.match(
      files.get(errorFile).toString(),
      /Overall Web(?:GL|GPU) deadline exceeded/,
    );
  } else {
    assert.equal(error, undefined, `${name}: healthy control completes`);
  }
  const referencesUnchanged = [...originals].every(([key, bytes]) =>
    files.get(key)?.equals(bytes),
  );
  if (expectedFailure) {
    assert.ok(referencesUnchanged, `${name}: original references unchanged`);
  }
  return {
    name,
    result: "PASS",
    injectedFailure: error ? String(error) : null,
    reportedPass,
    successReportPresent: files.has(successFile),
    errorReportPresent: files.has(errorFile),
    referencesUnchanged,
    directReferenceWrites: writes.filter((key) =>
      descendants(key, referenceDir),
    ).length,
  };
}

const results = [];
for (const specification of [
  { name: "WebGL healthy comparison control", backend: "webgl" },
  { name: "WebGPU healthy control", backend: "webgpu" },
  {
    name: "WebGL reference generation final teardown failure",
    backend: "webgl",
    update: true,
    teardownFailure: true,
  },
  {
    name: "WebGL deadline during final report write",
    backend: "webgl",
    finalWriteTimeout: true,
  },
  {
    name: "WebGPU deadline during final report write",
    backend: "webgpu",
    finalWriteTimeout: true,
  },
]) {
  const result = await probe(specification);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    result: "PASS",
    probes: results.length,
    sourceHashes,
    scope:
      "Mocked control flow only; no browser, network, or harness filesystem writes.",
  }),
);
