#!/usr/bin/env node
/* eslint n/hashbang: "off", n/no-unpublished-require: "off" -- CI executable uses a dev dependency. */
"use strict";
// Chromium launcher for the isolated M0 test environment. Production is unaffected.
const { spawn } = require("node:child_process");
const { chromium } = require("@playwright/test");

const child = spawn(
  chromium.executablePath(),
  [
    "--no-sandbox",
    "--enable-webgl",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
