import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBrowserConfiguration,
  classifyGpu,
  assertPhysicalGpu,
} from "./m0-browser-config.mjs";

test("software identity cannot satisfy hardware acceptance", () => {
  for (const renderer of [
    "Google SwiftShader",
    "llvmpipe",
    "Microsoft Basic Render Driver",
  ]) {
    const classification = classifyGpu({ renderer });
    assert.equal(classification.kind, "software");
    assert.throws(
      () => assertPhysicalGpu(classification, { requirePhysicalGpu: true }),
      /physical/,
    );
  }
  assert.equal(
    classifyGpu({
      vendor: "nvidia",
      description: "RTX 4060",
      isFallbackAdapter: true,
    }).kind,
    "software",
  );
  assert.equal(classifyGpu({ renderer: "WebKit WebGL" }).kind, "unknown");
  assert.equal(
    classifyGpu({ renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060, Vulkan)" })
      .kind,
    "hardware-reported",
  );
});
test("hardware profile does not force software and invalid configuration fails", () => {
  const config = getBrowserConfiguration({
    M0_GPU_MODE: "hardware",
    M0_BROWSER_CHANNEL: "msedge",
  });
  assert.equal(config.launchOptions.channel, "msedge");
  assert.deepEqual(config.launchOptions.args, []);
  assert.equal(config.launchOptions.headless, false);
  assert.throws(() => getBrowserConfiguration({ M0_GPU_MODE: "typo" }), /mode/);
  for (const physical of [undefined, "0", "1"]) {
    const defaults = getBrowserConfiguration({
      M0_REQUIRE_PHYSICAL_GPU: physical,
    });
    assert.equal(defaults.mode, "hardware");
    assert.equal(defaults.requirePhysicalGpu, true);
    assert.deepEqual(defaults.launchOptions.args, []);
    assert.throws(
      () =>
        assertPhysicalGpu(
          classifyGpu({ renderer: "Google SwiftShader" }),
          defaults,
        ),
      /physical/,
    );
  }
  assert.throws(
    () => getBrowserConfiguration({ M0_GPU_MODE: "software" }),
    /software.*not permitted/i,
  );
  assert.throws(
    () =>
      getBrowserConfiguration({
        M0_GPU_MODE: "hardware",
        M0_REQUIRE_PHYSICAL_GPU: "0",
        M0_HEADLESS: "1",
      }),
    /headed/,
  );
});
