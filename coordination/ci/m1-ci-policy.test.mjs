import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runInNewContext } from "node:vm";
import { after, before, test } from "node:test";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = join(root, "coordination/ci/m1-ci-policy.mjs");
let temporary;
let repository;
let initial;
let shared;
let documentation;

function git(...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(path, contents) {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  git("add", "--", path);
  git(
    "-c",
    "user.name=CI policy test",
    "-c",
    "user.email=ci-policy@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    path,
  );
  return git("rev-parse", "HEAD");
}

before(() => {
  temporary = mkdtempSync(join(tmpdir(), "m1-ci-policy-"));
  repository = join(temporary, "repo");
  mkdirSync(repository);
  git("init", "--quiet");
  initial = commit("README.md", "base\n");
  shared = commit("packages/widgets/Source/Viewer/Viewer.js", "shared\n");
  documentation = commit("docs/CI.md", "documentation only\n");
});

after(() => rmSync(temporary, { recursive: true, force: true }));

function event(action = "synchronize", overrides = {}) {
  return {
    action,
    number: 2,
    before: shared,
    after: documentation,
    pull_request: {
      number: 2,
      draft: true,
      labels: [],
      base: { sha: initial, ref: "feat/m0-webgpu-backend" },
      head: { sha: documentation, ref: "feat/m1-wgs84-globe" },
    },
    ...overrides,
  };
}

function runPolicy(payload, eventName = "pull_request") {
  const files = mkdtempSync(join(temporary, "event-"));
  const eventPath = join(files, "event.json");
  const outputPath = join(files, "output");
  const summaryPath = join(files, "summary");
  writeFileSync(eventPath, JSON.stringify(payload));
  const result = spawnSync(process.execPath, [script], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    readFileSync(outputPath, "utf8").includes(`run_full=${report.runFull}\n`),
    true,
    "the workflow must consume the actual policy decision",
  );
  return report;
}

test("a draft documentation update does not inherit an older Viewer change", () => {
  const report = runPolicy(event());
  assert.equal(report.runFull, false);
  assert.deepEqual(report.changedFiles, ["docs/CI.md"]);
});

for (const action of ["opened", "reopened"]) {
  test(`${action} checks the full PR difference conservatively`, () => {
    assert.equal(runPolicy(event(action)).runFull, true);
  });
}

test("a newly changed shared Viewer forces Full on a draft", () => {
  const payload = event();
  payload.before = initial;
  payload.after = shared;
  payload.pull_request.head.sha = shared;
  assert.equal(runPolicy(payload).runFull, true);
});

test("WebGPU-only production updates remain eligible for Fast on a draft", () => {
  const head = commit(
    "packages/engine/Source/Scene/WebGPUScene.js",
    "webgpu\n",
  );
  const payload = event();
  payload.before = documentation;
  payload.after = head;
  payload.pull_request.head.sha = head;
  assert.equal(runPolicy(payload).runFull, false);
});

for (const path of [
  "packages/core/Source/Cartesian3.js",
  "packages/engine/Source/Renderer/Context.js",
  "packages/engine/Source/Scene/Globe.js",
  ".github/workflows/m0-webgl-baseline.yml",
  "coordination/ci/m1-terrain-smoke.mjs",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.js",
]) {
  test(`a change to ${path} forces the complete gate`, () => {
    const before = git("rev-parse", "HEAD");
    const head = commit(path, `${path}\n`);
    const payload = event();
    payload.before = before;
    payload.after = head;
    payload.pull_request.head.sha = head;
    assert.equal(runPolicy(payload).runFull, true);
  });
}

test("renaming a shared file into a WebGPU path cannot hide the deletion", () => {
  const before = git("rev-parse", "HEAD");
  git(
    "mv",
    "packages/engine/Source/Scene/Globe.js",
    "packages/engine/Source/Scene/WebGPUMoved.js",
  );
  const head = commit("README.md", "rename\n");
  const payload = event();
  payload.before = before;
  payload.after = head;
  payload.pull_request.head.sha = head;
  assert.equal(runPolicy(payload).runFull, true);
});

test("ready_for_review always runs Full on the exact PR head", () => {
  const report = runPolicy(event("ready_for_review"));
  assert.equal(report.runFull, true);
  assert.equal(report.headSha, documentation);
});

test("a ready PR's later documentation commit still runs Full", () => {
  const payload = event();
  payload.pull_request.draft = false;
  assert.equal(runPolicy(payload).runFull, true);
});

test("ci:full is an immediate manual trigger without changing draft state", () => {
  assert.equal(
    runPolicy(event("labeled", { label: { name: "ci:full" } })).runFull,
    true,
  );
});

test("a retained ci:full label requests Full on later draft updates", () => {
  const payload = event();
  payload.pull_request.labels = [{ name: "ci:full" }];
  assert.equal(runPolicy(payload).runFull, true);
  payload.pull_request.labels = [];
  assert.equal(runPolicy(payload).runFull, false);
});

test("an unrelated label does not restart Full even on a ready PR", () => {
  const payload = event("labeled", { label: { name: "documentation" } });
  payload.pull_request.draft = false;
  assert.equal(runPolicy(payload).runFull, false);
});

for (const before of [undefined, "0".repeat(40), "f".repeat(40), "--help"]) {
  test(`an unavailable synchronize comparison fails closed (${before})`, () => {
    assert.equal(runPolicy(event("synchronize", { before })).runFull, true);
  });
}

test("manual dispatch selects Full when GitHub can deliver that event", () => {
  assert.equal(runPolicy({}, "workflow_dispatch").runFull, true);
});

function workflows() {
  const fastPath = join(root, ".github/workflows/m0-webgl-baseline.yml");
  const fullPath = join(root, ".github/workflows/m1-full-regression.yml");
  assert.equal(existsSync(fullPath), true, "Full must have its own workflow");
  return {
    fast: yaml.load(readFileSync(fastPath, "utf8")),
    full: yaml.load(readFileSync(fullPath, "utf8")),
  };
}

function expression(value, context) {
  const format = (pattern, ...args) =>
    pattern.replace(/\{(\d+)\}/g, (...match) => args[match[1]]);
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (...match) =>
    String(
      runInNewContext(match[1], { ...context, format }, { timeout: 1000 }),
    ),
  );
}

test("Fast and Full avoid push/PR duplication and cover final acceptance events", () => {
  const { fast, full } = workflows();
  assert.equal(fast.on.push, undefined);
  assert.equal(full.on.push, undefined);
  for (const action of ["opened", "reopened", "synchronize"]) {
    assert.ok(fast.on.pull_request.types.includes(action));
    assert.ok(full.on.pull_request.types.includes(action));
  }
  assert.ok(full.on.pull_request.types.includes("ready_for_review"));
  assert.ok(full.on.pull_request.types.includes("labeled"));
  assert.ok(Object.hasOwn(full.on, "workflow_dispatch"));
});

test("new PR revisions cancel the same tier without cancelling the other tier", () => {
  const { fast, full } = workflows();
  assert.equal(fast.concurrency["cancel-in-progress"], true);
  assert.equal(full.concurrency["cancel-in-progress"], true);
  const context = {
    github: {
      event_name: "pull_request",
      event: event(),
      ref: "refs/pull/2/merge",
      run_id: 100,
    },
  };
  const fastKey = expression(fast.concurrency.group, context);
  const fullKey = expression(full.concurrency.group, context);
  assert.notEqual(fastKey, fullKey);
  context.github.event.after = shared;
  context.github.run_id = 101;
  assert.equal(expression(fast.concurrency.group, context), fastKey);
  assert.equal(expression(full.concurrency.group, context), fullKey);
  context.github.event.action = "labeled";
  context.github.event.label = { name: "documentation" };
  assert.notEqual(expression(full.concurrency.group, context), fullKey);
  context.github.event.label.name = "ci:full";
  assert.equal(expression(full.concurrency.group, context), fullKey);
});

test("Full keeps every browser gate and both complete upstream suite commands", () => {
  const { fast, full } = workflows();
  const commands = (workflow) =>
    Object.values(workflow.jobs)
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");
  const fullCommands = commands(full);
  for (const gate of [
    "m0-webgl-smoke.mjs",
    "m0-webgpu-smoke.mjs",
    "m1-globe-smoke.mjs",
    "m1-imagery-smoke.mjs",
    "m1-navigation-smoke.mjs",
    "m1-terrain-smoke.mjs",
    "m1-demo-smoke.mjs",
    "m0-webgl-regression.mjs",
  ]) {
    assert.ok(fullCommands.includes(`node coordination/ci/${gate}`), gate);
  }
  assert.ok(
    fullCommands.includes(
      "npm run test-non-webgl -- --browsers ChromeHeadless --failTaskOnError",
    ),
  );
  const fastCommands = commands(fast);
  for (const gate of [
    "m0-webgl-smoke.mjs",
    "m0-webgpu-smoke.mjs",
    "m1-globe-smoke.mjs",
  ]) {
    assert.ok(fastCommands.includes(`node coordination/ci/${gate}`), gate);
  }
  assert.ok(fastCommands.includes("coordination/ci/m1-*.test.mjs"));
  assert.ok(fullCommands.includes("coordination/ci/m1-*.test.mjs"));
});

test("each tier builds the candidate once and retains lint and generated API checks", () => {
  const { fast, full } = workflows();
  for (const workflow of [fast, full]) {
    const steps = Object.values(workflow.jobs).flatMap(
      (job) => job.steps ?? [],
    );
    const candidateBuilds = steps.filter(
      (step) =>
        !step["working-directory"] && /^npm run build$/m.test(step.run ?? ""),
    );
    assert.equal(candidateBuilds.length, 1);
    const commands = steps.map((step) => step.run ?? "").join("\n");
    for (const command of [
      "npx eslint",
      "npm run build-ts",
      "packages/sandcastle/templates/tsconfig.lib.json",
      "npm run tsc",
      "M0_NEGATIVE_CONTROL=missing-globe",
    ]) {
      assert.ok(commands.includes(command), command);
    }
    assert.equal(
      steps.some((step) => step["continue-on-error"]),
      false,
    );
    const candidateCheckouts = steps.filter(
      (step) => step.uses === "actions/checkout@v4" && !step.with?.path,
    );
    assert.ok(candidateCheckouts.length > 0);
    assert.ok(
      candidateCheckouts.every(
        (step) =>
          step.with.ref ===
          "${{ github.event.pull_request.head.sha || github.sha }}",
      ),
    );
  }
});
