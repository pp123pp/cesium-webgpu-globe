// Differential WebGL evidence. Existing failures retain their raw Karma exit code.
// Run from a prebuilt candidate checkout with a separate prebuilt baseline.
// Only ignored test entrypoints/bundles are regenerated.
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clientArgs = [
  "WebGL",
  "",
  false,
  false,
  false,
  undefined,
  undefined,
  "--grep",
  "",
];

export function validateBaselineSource(source) {
  assert.equal(
    source.commit,
    "724b5db8f258d0ce00c4f6b774bd38529e24252b",
    "Baseline must be the pinned pre-WebGPU commit",
  );
  assert.equal(source.status.trim(), "", "Baseline working tree must be clean");
  assert.equal(
    source.trackedSourceDiffSha256,
    sha256(""),
    "Baseline tracked source must be clean",
  );
}

export function createResultReporter(record) {
  const completedBrowsers = new Set();
  function Reporter() {
    this.onSpecComplete = (browser, result) => {
      const errors = (result.log ?? []).map((entry) =>
        typeof entry === "string" ? entry : JSON.stringify(entry),
      );
      record.specs.push({
        suite: [...result.suite],
        description: result.description,
        id: result.id,
        completionIndex: record.specs.length,
        browserName: browser.name,
        durationMs: result.time,
        status: result.skipped
          ? "skipped"
          : result.success
            ? "passed"
            : "failed",
        errors,
        errorMessages: errors.map(normalizeFailureMessage),
      });
    };
    this.onBrowserError = (browser, error) =>
      record.browserErrors.push({
        browserName: browser.name,
        error: String(error),
      });
    this.onBrowserComplete = (browser) => completedBrowsers.add(browser.id);
    this.onRunComplete = (browsers, results) => {
      record.completed = true;
      record.karmaResult = { ...results };
      record.browsers = browsers.map((browser) => ({
        id: browser.id,
        name: browser.name,
        fullName: browser.fullName,
        version: /\b\d+(?:\.\d+)+/.exec(browser.name)?.[0],
        completed: completedBrowsers.has(browser.id),
        lastResult: { ...browser.lastResult },
      }));
    };
  }
  Reporter.$inject = [];
  return Reporter;
}

export function normalizeFailureMessage(message) {
  return stripVTControlCharacters(String(message))
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:at\s+|<Jasmine>)/.test(line))
    .filter(
      (line) =>
        !/^\s*[^\s@]*@(?:https?|file):\/\/.*:\d+(?::\d+)?\s*$/.test(line),
    )
    .map((line) =>
      line
        .replace(
          /(?:https?:\/\/[^\s)]+?\/(?:base|absolute)\/|(?:[^\s()]*\/)?)(Build\/[^\s():]+):\d+(?::\d+)?/g,
          "$1:<location>",
        )
        .trimEnd(),
    )
    .join("\n")
    .trim();
}

export function canonicalizeSpecList(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
  const headers = lines.filter((line) =>
    /^export const VERSION = ['"][^'"]+['"];$/u.test(line),
  );
  assert.equal(
    headers.length,
    1,
    "Generated SpecList must have one VERSION header",
  );
  const imports = [];
  for (const line of lines) {
    if (line === headers[0]) {
      continue;
    }
    const match = /^import ['"](\.\.\/[^'"]+)['"];$/u.exec(line);
    assert.ok(match, `Unexpected generated SpecList code: ${line}`);
    imports.push(match[1]);
  }
  assert.ok(imports.length > 0, "Generated SpecList imports are empty");
  assert.equal(
    new Set(imports).size,
    imports.length,
    "Duplicate generated spec imports",
  );
  imports.sort();
  return {
    importPaths: imports,
    importPathsSha256: sha256(imports.join("\n")),
    source: `${headers[0]}\n${imports.map((entry) => `import '${entry}';`).join("\n")}\n`,
  };
}

function specIdentity(spec) {
  assert.ok(
    Array.isArray(spec.suite) &&
      spec.suite.every((part) => typeof part === "string"),
    "Invalid spec suite",
  );
  assert.equal(typeof spec.description, "string", "Invalid spec description");
  return JSON.stringify([...spec.suite, spec.description]);
}

function countSpecs(specs) {
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    executed: 0,
    total: specs.length,
  };
  for (const spec of specs) {
    assert.ok(
      ["passed", "failed", "skipped"].includes(spec.status),
      "Unknown recorded spec status",
    );
    counts[spec.status]++;
  }
  counts.executed = counts.passed + counts.failed;
  return counts;
}

function validateRun(run, label) {
  assert.equal(
    run.completed,
    true,
    `${label} run is incomplete: run_complete was not received`,
  );
  assert.ok(!run.runnerError, `${label} runner error: ${run.runnerError}`);
  assert.deepEqual(run.browserErrors, [], `${label} has browser errors`);
  assert.ok(Array.isArray(run.specs), `${label} has no recorded specs`);
  const counts = countSpecs(run.specs);
  assert.ok(
    counts.executed > 3000,
    `${label} must have more than 3000 executed specs; got ${counts.executed}`,
  );
  assert.deepEqual(
    run.counts,
    counts,
    `${label} recorded spec counts do not match reported counts`,
  );
  assert.equal(run.browsers.length, 1, `${label} requires exactly one browser`);
  const browser = run.browsers[0];
  assert.ok(
    browser.name && browser.fullName && browser.version,
    `${label} browser identity is missing`,
  );
  assert.equal(browser.completed, true, `${label} browser did not complete`);
  assert.equal(browser.lastResult.error, false, `${label} browser error flag`);
  assert.equal(
    browser.lastResult.disconnected,
    false,
    `${label} browser disconnected`,
  );
  assert.equal(
    browser.lastResult.total,
    counts.total,
    `${label} browser total differs from recorded results`,
  );
  for (const [karmaKey, countKey] of [
    ["success", "passed"],
    ["failed", "failed"],
    ["skipped", "skipped"],
  ]) {
    assert.equal(
      browser.lastResult[karmaKey],
      counts[countKey],
      `${label} browser counts differ`,
    );
    assert.equal(
      run.karmaResult[karmaKey],
      counts[countKey],
      `${label} Karma counts differ`,
    );
  }
  assert.equal(run.karmaResult.error, false, `${label} Karma error flag`);
  assert.equal(
    run.karmaResult.disconnected,
    false,
    `${label} Karma disconnected`,
  );
  assert.equal(
    run.exitCode,
    counts.failed ? 1 : 0,
    `${label} unexpected process exit code`,
  );
  assert.equal(
    run.karmaResult.exitCode,
    run.exitCode,
    `${label} Karma/process exit code mismatch`,
  );
  return counts;
}

function failuresOf(run) {
  return run.specs
    .filter((spec) => spec.status === "failed")
    .map((spec) => {
      assert.ok(
        Array.isArray(spec.errors) && spec.errors.length > 0,
        "Failed spec is missing assertion details",
      );
      const messages = spec.errors.map(normalizeFailureMessage);
      assert.ok(
        messages.every((message) => message.length > 0),
        "Failed spec has an empty assertion signature",
      );
      return {
        suite: spec.suite,
        description: spec.description,
        identity: specIdentity(spec),
        errors: spec.errors,
        messages,
        signature: JSON.stringify(messages),
      };
    });
}

// Observed SwiftShader/Chrome fluctuation in these two inherited failures only.
// Keep all other assertion values and error shapes strict.
function isToleratedShadowPixelDrift(known, failure) {
  const targets = [
    "Model with cutout texture casts shadows onto another model",
    "enable soft shadows",
  ].map((description) => JSON.stringify(["Scene/ShadowMap", description]));
  if (
    known.identity !== failure.identity ||
    !targets.includes(known.identity)
  ) {
    return false;
  }
  if (known.messages.length !== 1 || failure.messages.length !== 1) {
    return false;
  }

  const pattern =
    /^Expected Uint8Array \[ (\d+), (\d+), (\d+), (\d+) \] not to equal Uint8Array \[ (\d+), (\d+), (\d+), (\d+) \]\.$/;
  const before = known.messages[0].match(pattern);
  const after = failure.messages[0].match(pattern);
  if (!before || !after) {
    return false;
  }

  const baseline = before.slice(1).map(Number);
  const candidate = after.slice(1).map(Number);
  if (
    !baseline.every((value) => value <= 255) ||
    !candidate.every((value) => value <= 255)
  ) {
    return false;
  }

  // Both failures must still represent two identical pixels where the
  // spec expected a shadow difference; RGB may drift by one level, alpha cannot.
  const sameWithinRun = (rgba) =>
    rgba.slice(0, 4).every((value, index) => value === rgba[index + 4]);
  return (
    sameWithinRun(baseline) &&
    sameWithinRun(candidate) &&
    baseline
      .slice(0, 3)
      .every((value, index) => Math.abs(value - candidate[index]) <= 1) &&
    baseline[3] === candidate[3]
  );
}

export function compareWebglRuns(baseline, candidate) {
  const before = validateRun(baseline, "baseline");
  const after = validateRun(candidate, "candidate");
  assert.equal(after.executed, before.executed, "Executed spec counts differ");
  assert.equal(after.skipped, before.skipped, "Skipped spec counts differ");
  const identity = (run) =>
    run.browsers.map(({ name, fullName, version }) => ({
      name,
      fullName,
      version,
    }));
  assert.deepEqual(
    identity(candidate),
    identity(baseline),
    "Browser identity differs; use the same browser for both runs",
  );
  assert.ok(
    baseline.specPreparation?.importPaths?.length > 0,
    "Baseline generated import lists are missing",
  );
  assert.deepEqual(
    candidate.specPreparation?.importPaths,
    baseline.specPreparation.importPaths,
    "Generated spec import lists differ; rebuild both checkouts",
  );
  const order = (run) =>
    run.specs.filter((spec) => spec.status !== "skipped").map(specIdentity);
  const baselineOrder = order(baseline);
  const candidateOrder = order(candidate);
  assert.ok(
    candidateOrder.every((spec, i) => spec === baselineOrder[i]),
    "Execution order differs; rebuild both ignored spec bundles with the canonical import order",
  );
  const coverage = (run) =>
    run.specs
      .map(
        (spec) =>
          `${spec.status === "skipped" ? "skipped" : "executed"}:${specIdentity(spec)}`,
      )
      .sort();
  assert.deepEqual(
    coverage(candidate),
    coverage(baseline),
    "Recorded spec coverage differs",
  );
  const remaining = failuresOf(baseline);
  const currentFailures = failuresOf(candidate);
  const toleratedPixelDrifts = [];
  for (const failure of currentFailures) {
    const sameSpec = remaining.filter(
      (known) => known.identity === failure.identity,
    );
    assert.ok(sameSpec.length > 0, `New failed spec: ${failure.identity}`);
    const match = sameSpec.find(
      (known) =>
        known.signature === failure.signature ||
        isToleratedShadowPixelDrift(known, failure),
    );
    assert.ok(
      match,
      `Changed assertion signature for ${failure.identity}: ${failure.signature}`,
    );
    if (match.signature !== failure.signature) {
      toleratedPixelDrifts.push({
        suite: failure.suite,
        description: failure.description,
        baselineMessages: match.messages,
        candidateMessages: failure.messages,
      });
    }
    remaining.splice(remaining.indexOf(match), 1);
  }
  return {
    baselineFailures: before.failed,
    candidateFailures: after.failed,
    unchangedFailures: currentFailures.length,
    fixedFailures: remaining,
    toleratedPixelDrifts,
    executed: after.executed,
    skipped: after.skipped,
    executionOrderSha256: sha256(JSON.stringify(candidateOrder)),
  };
}

function git(checkout, args) {
  return execFileSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function sourceSnapshot(checkout) {
  return {
    commit: git(checkout, ["rev-parse", "HEAD"]).trim(),
    treeHash: git(checkout, ["rev-parse", "HEAD^{tree}"]).trim(),
    trackedSourceDiffSha256: sha256(
      git(checkout, [
        "diff",
        "HEAD",
        "--binary",
        "--",
        "packages",
        "Source",
        "Specs",
        "scripts",
        "package.json",
        "gulpfile.js",
      ]),
    ),
    status: git(checkout, ["status", "--porcelain"]),
  };
}

async function bundleHashes(checkout) {
  const files = [
    "Build/CesiumUnminified/Cesium.js",
    "Build/Specs/karma-main.js",
    "Build/Specs/SpecList.js",
    "Specs/karma.conf.cjs",
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        sha256(await readFile(path.join(checkout, name))),
      ]),
    ),
  );
}

async function prepareSpecs(checkout, canonical, esbuild) {
  assert.equal(
    git(checkout, [
      "ls-files",
      "--",
      "Specs/SpecList.js",
      "Build/Specs",
    ]).trim(),
    "",
    "Spec preparation may only write untracked generated outputs",
  );
  const input = path.join(checkout, "Specs/SpecList.js");
  const originalSha256 = sha256(await readFile(input));
  await writeFile(input, canonical.source);
  // Adapted from CesiumJS 1.146 scripts/build.js, externalResolvePlugin and
  // bundleCombinedSpecs (Apache-2.0; see LICENSE.md). Keep the actual IIFE under
  // test: imports in the spec bundle resolve to the global Cesium, not source.
  await esbuild.build({
    absWorkingDir: checkout,
    entryPoints: [
      "Specs/spec-main.js",
      "Specs/SpecList.js",
      "Specs/karma-main.js",
    ],
    bundle: true,
    format: "esm",
    sourcemap: true,
    outdir: "Build/Specs",
    plugins: [
      {
        name: "external-cesium",
        setup(build) {
          const resolve = () => ({
            path: "Cesium",
            namespace: "external-cesium",
          });
          build.onResolve({ filter: /index\.js$/ }, resolve);
          build.onResolve({ filter: /@cesium/ }, resolve);
          build.onLoad(
            { filter: /^Cesium$/, namespace: "external-cesium" },
            () => ({ contents: "module.exports = Cesium" }),
          );
        },
      },
    ],
    write: true,
  });
  return {
    importPaths: canonical.importPaths,
    importPathsSha256: canonical.importPathsSha256,
    originalSha256,
    canonicalSha256: sha256(canonical.source),
  };
}

function emptyRun(role, checkout) {
  return {
    schemaVersion: 1,
    role,
    checkout,
    completed: false,
    exitCode: null,
    browserErrors: [],
    browsers: [],
    specs: [],
    counts: countSpecs([]),
  };
}

async function executeRun(record, canonical, runtime, outputFile) {
  record.startedAt = new Date().toISOString();
  try {
    record.source = sourceSnapshot(record.checkout);
    if (record.role === "baseline") {
      validateBaselineSource(record.source);
    }
    record.specPreparation = await prepareSpecs(
      record.checkout,
      canonical,
      runtime.esbuild,
    );
    record.bundleHashes = await bundleHashes(record.checkout);
    record.environment = {
      node: process.version,
      os: { platform: os.platform(), release: os.release(), arch: os.arch() },
      karma: runtime.karmaVersion,
      esbuild: runtime.esbuild.version,
      chromeBin: process.env.CHROME_BIN ?? null,
      browserExecutable: process.env.M0_BROWSER_EXECUTABLE ?? null,
    };
    const configFile = path.join(record.checkout, "Specs/karma.conf.cjs");
    const config = await runtime.karma.config.parseConfig(
      configFile,
      {
        browsers: ["ChromeHeadless"],
        singleRun: true,
        autoWatch: false,
        port: 9876,
        failOnFailingTestSuite: true,
        failOnEmptyTestSuite: true,
        client: {
          args: clientArgs,
          captureConsole: false,
          jasmine: { random: false },
        },
      },
      { promiseConfig: true, throwErrors: true },
    );
    config.reporters = [...config.reporters, "m0-json"];
    config.plugins = [
      ...config.plugins,
      { "reporter:m0-json": ["type", createResultReporter(record)] },
    ];
    record.configuration = {
      configFile,
      browsers: config.browsers,
      port: config.port,
      clientArgs,
      reporters: config.reporters,
    };
    record.exitCode = await new Promise((resolve, reject) => {
      const server = new runtime.karma.Server(config, resolve);
      server.on("listening", (port) => {
        record.actualPort = port;
      });
      server.start().catch(reject);
    });
    record.sourceAfter = sourceSnapshot(record.checkout);
    assert.deepEqual(
      record.sourceAfter,
      record.source,
      "Checkout source changed during the test run",
    );
    assert.deepEqual(
      await bundleHashes(record.checkout),
      record.bundleHashes,
      "Test bundles changed during the run",
    );
    assert.equal(record.actualPort, 9876, "Karma port 9876 was unavailable");
  } catch (error) {
    record.runnerError = String(error);
  }
  record.finishedAt = new Date().toISOString();
  record.counts = countSpecs(record.specs);
  record.specOrderSha256 = sha256(
    JSON.stringify(record.specs.map(specIdentity)),
  );
  record.executionOrderSha256 = sha256(
    JSON.stringify(
      record.specs
        .filter((spec) => spec.status !== "skipped")
        .map(specIdentity),
    ),
  );
  record.failures = record.specs.filter((spec) => spec.status === "failed");
  await writeFile(outputFile, `${JSON.stringify(record, null, 2)}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      output: { type: "string", default: "Build/m0-webgl-regression" },
    },
    strict: true,
  });
  assert.ok(
    values.baseline && path.isAbsolute(values.baseline),
    "Usage: node coordination/ci/m0-webgl-regression.mjs --baseline <absolute prebuilt checkout> [--output <directory>]",
  );
  const candidatePath = await realpath(process.cwd());
  const baselinePath = await realpath(values.baseline);
  assert.notEqual(
    candidatePath,
    baselinePath,
    "Baseline and candidate must be separate checkouts",
  );
  const output = path.resolve(values.output);
  await mkdir(output, { recursive: true });
  const runs = [
    emptyRun("baseline", baselinePath),
    emptyRun("candidate", candidatePath),
  ];
  const reportFile = path.join(output, "comparison.json");
  await Promise.all(
    runs.map((run) =>
      writeFile(
        path.join(output, `${run.role}.json`),
        `${JSON.stringify(run, null, 2)}\n`,
      ),
    ),
  );
  await writeFile(
    reportFile,
    `${JSON.stringify({ status: "running" }, null, 2)}\n`,
  );
  try {
    runs[0].source = sourceSnapshot(baselinePath);
    validateBaselineSource(runs[0].source);
    const canonical = await Promise.all(
      runs.map(async (run) =>
        canonicalizeSpecList(
          await readFile(path.join(run.checkout, "Specs/SpecList.js"), "utf8"),
        ),
      ),
    );
    assert.deepEqual(
      canonical[0].importPaths,
      canonical[1].importPaths,
      "Generated spec import lists differ; build matching baseline/candidate spec sets before running",
    );
    const require = createRequire(path.join(candidatePath, "package.json"));
    const runtime = {
      karma: require("karma"),
      esbuild: require("esbuild"),
      karmaVersion: require("karma/package.json").version,
    };
    const harnessSha256 = sha256(
      await readFile(fileURLToPath(import.meta.url)),
    );
    for (let i = 0; i < runs.length; i++) {
      runs[i].harnessSha256 = harnessSha256;
      await executeRun(
        runs[i],
        canonical[i],
        runtime,
        path.join(output, `${runs[i].role}.json`),
      );
    }
    const comparison = compareWebglRuns(runs[0], runs[1]);
    const message = `WEBGL REGRESSION: no new failures (baseline ${comparison.baselineFailures} failures, current ${comparison.candidateFailures} failures)`;
    await writeFile(
      reportFile,
      `${JSON.stringify({ status: "no-new-failures", message, ...comparison }, null, 2)}\n`,
    );
    console.log(message);
  } catch (error) {
    await Promise.all(
      runs.map((run) =>
        writeFile(
          path.join(output, `${run.role}.json`),
          `${JSON.stringify(run, null, 2)}\n`,
        ),
      ),
    );
    await writeFile(
      reportFile,
      `${JSON.stringify({ status: "failed", error: String(error), runs: runs.map(({ role, completed, exitCode, counts, runnerError }) => ({ role, completed, exitCode, counts, runnerError })) }, null, 2)}\n`,
    );
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error("WEBGL REGRESSION FAILED:", String(error));
    process.exitCode = 1;
  });
}
