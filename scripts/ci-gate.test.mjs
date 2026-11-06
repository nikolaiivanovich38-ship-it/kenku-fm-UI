// FND-5: the quality gate in .github/workflows. Checked as text, so no YAML library is needed. Run with
// `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = (name) => fs.readFileSync(path.join(root, ".github", "workflows", name), "utf8");

/** The jobs of a workflow: name to the text of its block (two-space job keys under `jobs:`). */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  const found = {};
  for (const block of body.split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)) {
    const name = /^ {2}([a-z][a-z0-9-]*):/.exec(block)?.[1];
    if (name) found[name] = block;
  }
  return found;
}

describe("CI quality gate (FND-5)", () => {
  const ci = workflow("ci.yml");
  const ciJobs = jobs(ci);

  it("runs on every push to any branch, on pull requests, and when the release calls it", () => {
    assert.match(ci, /on:\n {2}push:\n {4}branches: \["\*\*"\]/);
    assert.match(ci, /\n {2}pull_request:/);
    assert.match(ci, /\n {2}workflow_call:/);
  });

  it("checks types, lint, unit tests, script tests, the dependency audit and secrets", () => {
    for (const command of ["yarn typecheck", "yarn lint", "yarn test:coverage", "yarn test:scripts", "node scripts/audit-check.mjs"]) {
      assert.ok(ci.includes(`run: ${command}`), command);
    }
    assert.match(ci, /uses: gitleaks\/gitleaks-action@[0-9a-f]{40}/);
  });

  it("on every push starts the packaged app (smoke test) and runs the axe accessibility checks", () => {
    assert.match(ciJobs.e2e, /yarn e2e smoke\.spec lyre\.spec/);
    assert.doesNotMatch(ciJobs.e2e, /\n {4}if:/, "the e2e job must not be skipped on a push");
  });

  it("runs every end-to-end test for pull requests, by hand and for a release", () => {
    assert.match(ci, /full-e2e:\n {8}description: [^\n]+\n {8}type: boolean/);
    assert.match(ciJobs.e2e, /inputs\.full-e2e \|\| github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch'/);
  });

  it("says in plain words what failed and what to do, in every job", () => {
    for (const [name, block] of Object.entries(ciJobs)) {
      assert.match(block, /if: failure\(\)[\s\S]*?::error title=/, `job ${name}`);
    }
  });

  it("CodeQL can be called by the release", () => {
    assert.match(workflow("codeql.yml"), /\n {2}workflow_call:/);
  });
});

describe("Release waits for the gate (FND-5)", () => {
  const release = workflow("release.yml");
  const releaseJobs = jobs(release);

  it("runs the whole gate, with every end-to-end test, and CodeQL", () => {
    assert.match(releaseJobs.gate, /uses: \.\/\.github\/workflows\/ci\.yml\n {4}with:\n {6}full-e2e: true/);
    assert.match(releaseJobs.codeql, /uses: \.\/\.github\/workflows\/codeql\.yml/);
  });

  it("builds only after both have passed, and publishes only after the build", () => {
    assert.match(releaseJobs.build, /needs: \[gate, codeql\]/);
    assert.match(releaseJobs.publish, /needs: build/);
  });

  it("gives CodeQL the one write permission it needs, and nothing else gets write access but publish", () => {
    assert.match(releaseJobs.codeql, /security-events: write/);
    for (const [name, block] of Object.entries(releaseJobs)) {
      if (name === "publish" || name === "codeql") continue;
      assert.doesNotMatch(block, /: write/, `job ${name}`);
    }
  });
});
