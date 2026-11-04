// Tests for check-release-fuses.mjs (SEC-13). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { releaseFuseProblems } from "./check-release-fuses.mjs";

const require = createRequire(import.meta.url);
const { FuseV1Options } = require("@electron/fuses");

/** A fuse wire as @electron/fuses reads it: one character code per fuse. */
function wire(overrides = {}) {
  const fuses = Array(8).fill("1".charCodeAt(0));
  fuses[FuseV1Options.RunAsNode] = "0".charCodeAt(0);
  fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable] = "0".charCodeAt(0);
  fuses[FuseV1Options.EnableNodeCliInspectArguments] = "0".charCodeAt(0);
  for (const [fuse, on] of Object.entries(overrides)) {
    fuses[FuseV1Options[fuse]] = (on ? "1" : "0").charCodeAt(0);
  }
  return fuses;
}

describe("releaseFuseProblems (SEC-13)", () => {
  it("accepts a release build", () => {
    assert.deepEqual(releaseFuseProblems(wire()), []);
  });

  it("rejects a test build that accepts --inspect", () => {
    assert.match(releaseFuseProblems(wire({ EnableNodeCliInspectArguments: true })).join("\n"), /inspect/i);
  });

  it("rejects every other loosened fuse", () => {
    for (const [fuse, on] of [
      ["RunAsNode", true],
      ["EnableNodeOptionsEnvironmentVariable", true],
      ["EnableEmbeddedAsarIntegrityValidation", false],
      ["OnlyLoadAppFromAsar", false],
      ["EnableCookieEncryption", false],
    ]) {
      assert.equal(releaseFuseProblems(wire({ [fuse]: on })).length, 1, fuse);
    }
  });

  it("rejects a wire too short to hold the fuses", () => {
    assert.equal(releaseFuseProblems([]).length > 0, true);
  });
});
