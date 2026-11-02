import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareWebglRuns,
  normalizeFailureMessage,
  canonicalizeSpecList,
  createResultReporter,
  validateBaselineSource,
} from "./m0-webgl-regression.mjs";

function recount(run) {
  const count = (status) =>
    run.specs.filter((spec) => spec.status === status).length;
  const passed = count("passed");
  const failed = count("failed");
  const skipped = count("skipped");
  run.counts = {
    passed,
    failed,
    skipped,
    executed: passed + failed,
    total: passed + failed + skipped,
  };
  run.exitCode = failed ? 1 : 0;
  run.karmaResult = {
    success: passed,
    failed,
    skipped,
    error: false,
    disconnected: false,
    exitCode: run.exitCode,
  };
  run.browsers[0].lastResult = {
    success: passed,
    failed,
    skipped,
    total: run.counts.total,
    error: false,
    disconnected: false,
  };
  return run;
}

function fixture() {
  return recount({
    completed: true,
    specPreparation: {
      importPaths: ["../packages/engine/Specs/FixtureSpec.js"],
    },
    browserErrors: [],
    browsers: [
      {
        name: "Chrome Headless 156.0.0.0 (Linux 0.0.0)",
        fullName: "Mozilla/5.0 HeadlessChrome/156.0.0.0",
        version: "156.0.0.0",
        completed: true,
      },
    ],
    specs: Array.from({ length: 3005 }, function (_, i) {
      void _;
      return {
        suite: ["Renderer/Fixture"],
        description: `case ${i}`,
        status: i === 0 ? "failed" : i < 3002 ? "passed" : "skipped",
        errors:
          i === 0
            ? [
                "Expected [143, 1, 1, 255] to equal [143, 0, 0, 255].\n    at UserContext.test (http://localhost:9876/base/Build/Specs/SpecList.js:100:20)",
              ]
            : [],
      };
    }),
  });
}

test("identical failures remain visible while stack and build locations may change", () => {
  const baseline = fixture();
  const candidate = fixture();
  candidate.specs[0].errors[0] = candidate.specs[0].errors[0].replace(
    "SpecList.js:100:20",
    "SpecList.js:900:40",
  );
  const comparison = compareWebglRuns(baseline, candidate);
  assert.equal(comparison.baselineFailures, 1);
  assert.equal(comparison.candidateFailures, 1);
  assert.equal(comparison.unchangedFailures, 1);
  assert.deepEqual(comparison.fixedFailures, []);
  assert.equal(baseline.exitCode, 1);
  assert.equal(candidate.exitCode, 1);
});

test("a resolved baseline failure is reported as an improvement", () => {
  const candidate = fixture();
  candidate.specs[0].status = "passed";
  candidate.specs[0].errors = [];
  recount(candidate);
  const comparison = compareWebglRuns(fixture(), candidate);
  assert.equal(comparison.baselineFailures, 1);
  assert.equal(comparison.candidateFailures, 0);
  assert.equal(comparison.fixedFailures.length, 1);
  assert.deepEqual(comparison.fixedFailures[0].suite, ["Renderer/Fixture"]);
  assert.equal(comparison.fixedFailures[0].description, "case 0");
});

for (const side of ["baseline", "candidate"]) {
  test(`zero executed tests in ${side} cannot pass the differential gate`, () => {
    const baseline = fixture();
    const candidate = fixture();
    const target = side === "baseline" ? baseline : candidate;
    target.specs = [];
    recount(target);
    assert.throws(() => compareWebglRuns(baseline, candidate), /3000|executed/);
  });

  test(`an incomplete ${side} run cannot be accepted as known failures`, () => {
    const baseline = fixture();
    const candidate = fixture();
    (side === "baseline" ? baseline : candidate).completed = false;
    assert.throws(
      () => compareWebglRuns(baseline, candidate),
      /completed|incomplete/,
    );
  });
}

test("browser errors fail even when all recorded spec outcomes match", () => {
  const candidate = fixture();
  candidate.browserErrors.push({
    browserName: candidate.browsers[0].name,
    error: "GPU process crashed",
  });
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /browser errors/i,
  );
});

test("a dropped executed test cannot be hidden by a smaller failure set", () => {
  const candidate = fixture();
  candidate.specs.splice(0, 1);
  recount(candidate);
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /executed.*count|counts differ/i,
  );
});

test("a changed skipped count fails", () => {
  const candidate = fixture();
  candidate.specs.pop();
  recount(candidate);
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /skipped.*count|counts differ/i,
  );
});

test("browser version changes require a new controlled baseline", () => {
  const candidate = fixture();
  candidate.browsers[0].version = "157.0.0.0";
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /browser identity/i,
  );
});

test("a newly failed spec fails even if total failures stay unchanged", () => {
  const candidate = fixture();
  candidate.specs[0].status = "passed";
  candidate.specs[1].status = "failed";
  candidate.specs[1].errors = candidate.specs[0].errors;
  candidate.specs[0].errors = [];
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /new failed spec/i,
  );
});

test("the same failed spec with changed assertion values is a regression", () => {
  const candidate = fixture();
  candidate.specs[0].errors[0] = candidate.specs[0].errors[0].replace(
    "143, 1, 1, 255",
    "143, 2, 2, 255",
  );
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /changed.*assertion|signature/i,
  );
});

test("an extra assertion in an already failing spec cannot be ignored", () => {
  const candidate = fixture();
  candidate.specs[0].errors.push(
    "Expected context to render white, but rendered black.",
  );
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /changed.*assertion|signature/i,
  );
});

test("identical selected specs executed in a different order are rejected", () => {
  const candidate = fixture();
  [candidate.specs[1], candidate.specs[2]] = [
    candidate.specs[2],
    candidate.specs[1],
  ];
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /execution order.*rebuild/i,
  );
});

test("reported counters cannot hide missing spec result records", () => {
  const candidate = fixture();
  candidate.specs.pop();
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /recorded.*counts|counts.*recorded/i,
  );
});

test("an unexplained process failure is not treated as a baseline assertion failure", () => {
  const candidate = fixture();
  candidate.exitCode = 2;
  assert.throws(() => compareWebglRuns(fixture(), candidate), /exit code/i);
});

test("a failed spec without assertion details cannot become an empty known signature", () => {
  const candidate = fixture();
  candidate.specs[0].errors = [
    "    at UserContext.test (http://localhost:9876/base/Build/Specs/SpecList.js:1:2)",
  ];
  assert.throws(
    () => compareWebglRuns(fixture(), candidate),
    /empty.*signature|assertion details/i,
  );
});

test("normalization preserves every assertion and numeric value", () => {
  const text =
    "Expected 143 to equal 144.\nExpected 2 failures, observed 3.\n    at test (http://localhost:9876/base/Build/Specs/SpecList.js:10:20)\nError at http://localhost:9876/base/Build/CesiumUnminified/Cesium.js:100:2";
  assert.equal(
    normalizeFailureMessage(text),
    "Expected 143 to equal 144.\nExpected 2 failures, observed 3.\nError at Build/CesiumUnminified/Cesium.js:<location>",
  );
});

test("generated spec imports are sorted without changing VERSION or the import set", () => {
  const result = canonicalizeSpecList(
    "export const VERSION = '1.146.0';\nimport '../z/Spec.js';\nimport '../a/Spec.js';\n",
  );
  assert.deepEqual(result.importPaths, ["../a/Spec.js", "../z/Spec.js"]);
  assert.equal(
    result.source,
    "export const VERSION = '1.146.0';\nimport '../a/Spec.js';\nimport '../z/Spec.js';\n",
  );
});

test("generated spec input with duplicate imports is rejected", () => {
  assert.throws(
    () =>
      canonicalizeSpecList(
        "export const VERSION = '1.146.0';\nimport '../a.js';\nimport '../a.js';\n",
      ),
    /duplicate/i,
  );
});

test("generated spec input with unexpected code is not silently discarded", () => {
  assert.throws(
    () =>
      canonicalizeSpecList(
        "export const VERSION = '1.146.0';\nimport '../a.js';\nexcludeSomeSpecs();\n",
      ),
    /unexpected|unsupported/i,
  );
});

test("different generated import lists fail despite identical recorded results", () => {
  const candidate = fixture();
  candidate.specPreparation.importPaths.push(
    "../packages/engine/Specs/OtherSpec.js",
  );
  assert.throws(() => compareWebglRuns(fixture(), candidate), /import lists/i);
});

test("the reporter preserves ordered raw failures, completion and browser diagnostics", () => {
  const record = { completed: false, specs: [], browserErrors: [] };
  const Reporter = createResultReporter(record);
  const reporter = new Reporter();
  const browser = {
    id: "browser-1",
    name: "Chrome Headless 156.0.0.0 (Linux)",
    fullName: "Mozilla/5.0 HeadlessChrome/156.0.0.0",
    lastResult: {
      total: 2,
      success: 0,
      failed: 1,
      skipped: 1,
      error: false,
      disconnected: false,
    },
  };
  const raw =
    "Expected 143 to equal 144.\n    at test (http://localhost:9876/base/Build/Specs/SpecList.js:100:20)";
  reporter.onSpecComplete(browser, {
    id: "spec0",
    suite: ["Scene/ShadowMap", "nested"],
    description: "renders",
    success: false,
    skipped: false,
    log: [raw],
    time: 20,
  });
  reporter.onSpecComplete(browser, {
    id: "spec1",
    suite: ["Core"],
    description: "excluded by category",
    success: false,
    skipped: true,
    log: [],
    time: 0,
  });
  reporter.onBrowserError(browser, "GPU process crashed");
  reporter.onBrowserComplete(browser);
  reporter.onRunComplete([browser], {
    success: 0,
    failed: 1,
    skipped: 1,
    exitCode: 1,
    error: false,
    disconnected: false,
  });
  assert.equal(record.completed, true);
  assert.deepEqual(
    record.specs.map(({ suite, description, status }) => ({
      suite,
      description,
      status,
    })),
    [
      {
        suite: ["Scene/ShadowMap", "nested"],
        description: "renders",
        status: "failed",
      },
      {
        suite: ["Core"],
        description: "excluded by category",
        status: "skipped",
      },
    ],
  );
  assert.deepEqual(record.specs[0].errors, [raw]);
  assert.deepEqual(record.specs[0].errorMessages, [
    "Expected 143 to equal 144.",
  ]);
  assert.deepEqual(record.browserErrors, [
    { browserName: browser.name, error: "GPU process crashed" },
  ]);
  assert.equal(record.browsers[0].completed, true);
  assert.equal(record.browsers[0].version, "156.0.0.0");
  assert.equal(record.karmaResult.exitCode, 1);
});

const cleanBaseline = {
  commit: "724b5db8f258d0ce00c4f6b774bd38529e24252b",
  status: "",
  trackedSourceDiffSha256:
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};
test("only the pinned clean pre-WebGPU baseline is accepted", () => {
  assert.doesNotThrow(() => validateBaselineSource(cleanBaseline));
});
test("a separate candidate checkout cannot stand in for the pre-WebGPU baseline", () => {
  assert.throws(
    () => validateBaselineSource({ ...cleanBaseline, commit: "9afc958" }),
    /pinned|pre-WebGPU/i,
  );
});
test("a dirty baseline cannot generate accepted differential evidence", () => {
  assert.throws(
    () =>
      validateBaselineSource({
        ...cleanBaseline,
        status: " M packages/engine/Source/Renderer/Context.js\n",
      }),
    /clean|dirty/i,
  );
  assert.throws(
    () =>
      validateBaselineSource({
        ...cleanBaseline,
        trackedSourceDiffSha256: "changed-source",
      }),
    /clean|dirty/i,
  );
});
