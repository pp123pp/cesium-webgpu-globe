import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const fullLabel = "ci:full";
const shaPattern = /^[0-9a-f]{40}$/i;

export function isSharedCiPath(path) {
  if (
    path.startsWith("packages/engine/Source/") &&
    /\/WebGPU[^/]*\.js$/.test(path)
  ) {
    return false;
  }
  return (
    path.startsWith("packages/core/") ||
    path.startsWith("packages/engine/") ||
    path.startsWith("packages/widgets/") ||
    path.startsWith("Specs/") ||
    path.startsWith("scripts/") ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("coordination/ci/") ||
    /(^|\/)package(-lock)?\.json$/.test(path) ||
    /^(?:eslint\.config\.js|server\.js|tsconfig(?:\.[^/]+)?\.json)$/.test(
      path,
    ) ||
    /^gulpfile(?:\.[^/]+)?\.js$/.test(path)
  );
}

function usableSha(value) {
  return (
    typeof value === "string" && shaPattern.test(value) && !/^0+$/.test(value)
  );
}

function changedFiles(event, cwd) {
  const head = event.pull_request.head.sha;
  const incremental = event.action === "synchronize";
  const before = incremental ? event.before : event.pull_request.base.sha;
  const comparison = incremental ? "before..head" : "base...head";
  if (!usableSha(before) || !usableSha(head)) {
    return { comparison, comparisonAvailable: false, changedFiles: [] };
  }
  try {
    // Read the whole local diff: no REST pagination/file-limit truncation. Keep
    // deletions separate so a rename cannot hide a shared source's old path.
    const result = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        ...(incremental ? [before, head] : [`${before}...${head}`]),
        "--",
      ],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return {
      comparison,
      comparisonAvailable: true,
      changedFiles: result.split("\0").filter(Boolean),
    };
  } catch {
    // In particular, a force-pushed previous SHA may no longer be fetchable.
    // Missing comparison evidence must not silently downgrade a shared change.
    return { comparison, comparisonAvailable: false, changedFiles: [] };
  }
}

export function selectFullRun({ eventName, event, cwd = process.cwd() }) {
  const report = {
    runFull: false,
    reason: "unsupported-event",
    headSha: event.pull_request?.head?.sha ?? process.env.GITHUB_SHA ?? null,
    changedFiles: [],
    comparison: "not-required",
  };
  if (eventName === "workflow_dispatch") {
    return { ...report, runFull: true, reason: "manual-dispatch" };
  }
  if (eventName !== "pull_request") {
    return report;
  }
  if (event.action === "labeled") {
    const requested = event.label?.name?.toLowerCase() === fullLabel;
    return {
      ...report,
      runFull: requested,
      reason: requested ? "manual-label" : "unrelated-label",
    };
  }
  if (
    !["opened", "reopened", "synchronize", "ready_for_review"].includes(
      event.action,
    )
  ) {
    return report;
  }
  const pullRequest = event.pull_request;
  if (
    !pullRequest?.head ||
    !pullRequest.base ||
    typeof pullRequest.draft !== "boolean"
  ) {
    return { ...report, runFull: true, reason: "incomplete-pr-context" };
  }
  if (event.action === "ready_for_review") {
    return { ...report, runFull: true, reason: "ready-for-review" };
  }
  if (!pullRequest.draft) {
    return { ...report, runFull: true, reason: "ready-pr-update" };
  }
  if (
    pullRequest.labels?.some((label) => label.name?.toLowerCase() === fullLabel)
  ) {
    return { ...report, runFull: true, reason: "retained-full-label" };
  }
  const difference = changedFiles(event, cwd);
  if (!difference.comparisonAvailable) {
    return {
      ...report,
      ...difference,
      runFull: true,
      reason: "comparison-unavailable",
    };
  }
  const shared = difference.changedFiles.some(isSharedCiPath);
  return {
    ...report,
    ...difference,
    runFull: shared,
    reason: shared ? "shared-code-update" : "draft-fast-only",
  };
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const report = selectFullRun({
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run_full=${report.runFull}\nreason=${report.reason}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Full regression selection\n\n- Run: **${report.runFull}**\n- Reason: \`${report.reason}\`\n- Head: \`${report.headSha}\`\n- Comparison: \`${report.comparison}\`\n- Changed files: ${report.changedFiles.length}\n\nA skipped Full is not final M1 acceptance. Final acceptance requires a successful Full on the latest PR head.\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
