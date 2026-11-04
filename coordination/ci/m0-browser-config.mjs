import process from "node:process";
import assert from "node:assert/strict";

export function getBrowserConfiguration(env = process.env) {
  const mode = env.M0_GPU_MODE ?? "hardware";
  assert.equal(
    mode,
    "hardware",
    `GPU mode ${mode} is not permitted; rendering validation requires local hardware, not software rendering.`,
  );
  const requirePhysicalGpu = true;
  const headless = env.M0_HEADLESS === "1";
  assert.equal(
    headless,
    false,
    "Physical acceptance requires a headed browser",
  );
  const launchOptions = {
    headless,
    timeout: 30000,
    ...(env.M0_BROWSER_EXECUTABLE
      ? { executablePath: env.M0_BROWSER_EXECUTABLE }
      : { channel: env.M0_BROWSER_CHANNEL ?? "chromium" }),
    args: [],
  };
  return { mode, requirePhysicalGpu, launchOptions };
}

export function classifyGpu(info) {
  const identity = [
    info.renderer,
    info.vendor,
    info.architecture,
    info.device,
    info.description,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    info.isFallbackAdapter ||
    /swiftshader|llvmpipe|lavapipe|software|basic render|softpipe/i.test(
      identity,
    )
  ) {
    return { kind: "software", reason: identity || "fallback adapter" };
  }
  if (
    /nvidia|geforce|quadro|radeon|intel|apple|adreno|mali|amd/i.test(identity)
  ) {
    return { kind: "hardware-reported", reason: identity };
  }
  return {
    kind: "unknown",
    reason: identity || "Adapter identity unavailable",
  };
}

export function assertPhysicalGpu(classification, config) {
  if (config.requirePhysicalGpu) {
    assert.equal(
      classification.kind,
      "hardware-reported",
      `No physical GPU evidence: ${classification.reason}`,
    );
  }
}
