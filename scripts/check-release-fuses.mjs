#!/usr/bin/env node
/**
 * SEC-13: check the Electron fuses of a packaged app before it is released.
 *
 * Release builds must have RunAsNode, NODE_OPTIONS and --inspect switched off
 * and asar integrity, asar-only loading and cookie encryption switched on.
 * A test build (CUE_DESK_E2E_BUILD=1) keeps --inspect on and must never be
 * released; .github/workflows/release.yml runs this on the built app.
 *
 * Usage: node scripts/check-release-fuses.mjs <path to the app executable>
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");

const ON = "1".charCodeAt(0);

/** Fuse, required state, and what it means when it is wrong. */
const REQUIRED = [
  ["RunAsNode", false, "the app can be run as a plain Node.js runtime"],
  ["EnableNodeOptionsEnvironmentVariable", false, "NODE_OPTIONS can inject code at start-up"],
  ["EnableNodeCliInspectArguments", false, "--inspect is accepted (a test build)"],
  ["EnableEmbeddedAsarIntegrityValidation", true, "app.asar is not checked at start-up"],
  ["OnlyLoadAppFromAsar", true, "app code can be loaded from outside app.asar"],
  ["EnableCookieEncryption", true, "website-tab cookies are stored unencrypted"],
];

/**
 * Problems with a fuse wire, as read by `getCurrentFuseWire`; empty when the
 * build may be released.
 */
export function releaseFuseProblems(wire) {
  const problems = [];
  for (const [name, wantOn, meaning] of REQUIRED) {
    const index = FuseV1Options[name];
    if (index >= wire.length) {
      problems.push(`${name}: missing from the fuse wire`);
      continue;
    }
    if ((wire[index] === ON) !== wantOn) {
      problems.push(`${name} is ${wantOn ? "off" : "on"}: ${meaning}`);
    }
  }
  return problems;
}

async function main(argv) {
  const executable = argv[2];
  if (!executable) {
    console.error("Usage: node scripts/check-release-fuses.mjs <path to the app executable>");
    return 2;
  }
  const problems = releaseFuseProblems(await getCurrentFuseWire(executable));
  if (problems.length > 0) {
    console.error(`Do not release ${executable}:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(`Fuses OK for release: ${executable}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv);
}
