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

describe("Specs on GitHub, split across machines (FND-15)", () => {
  const specs = workflow("specs.yml");
  const specsJobs = jobs(specs);

  it("runs on a push to a ci/ branch and by hand, never for a release", () => {
    assert.match(specs, /on:\n {2}push:\n {4}branches: \["ci\/\*\*"\]\n {2}workflow_dispatch:\n\n/);
    assert.doesNotMatch(specs, /tags:|workflow_call:|release/);
  });

  it("reads the repository and nothing more, and keeps no credentials in the checkout", () => {
    assert.match(specs, /\npermissions:\n {2}contents: read\n/);
    assert.doesNotMatch(specs, /: write/);
    const checkouts = specs.match(/uses: actions\/checkout@/g).length;
    assert.equal(specs.match(/persist-credentials: false/g).length, checkouts);
  });

  it("pins every action by full commit SHA with its version in a comment", () => {
    for (const use of specs.match(/uses: \S+/g)) assert.match(use, /@[0-9a-f]{40}$/, use);
    assert.equal(specs.match(/uses: \S+@[0-9a-f]{40} # v\d/g).length, specs.match(/uses: /g).length);
  });

  it("packages once and runs the app's specs in eight parts, one copy of the app at a time, against that package", () => {
    assert.match(specsJobs.package, /run: yarn package\n {8}env:\n {10}CUE_DESK_E2E_BUILD: "1"/);
    assert.match(specsJobs.app, /needs: package/);
    assert.match(specsJobs.app, /shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
    assert.match(specsJobs.app, /--project=app --shard=\$\{\{ matrix\.shard \}\}\/8 --reporter=list,blob,json/);
    assert.doesNotMatch(specsJobs.app, /--workers/);
    assert.match(specsJobs.prototype, /--project=prototype --reporter=list,blob,json/);
    assert.match(specsJobs.e2e, /needs: package/);
    assert.match(specsJobs.e2e, /yarn e2e --reporter=list,blob,json/);
  });

  it("keeps node_modules between runs, saved right after the install and before anything changes them", () => {
    for (const [name, block] of Object.entries(specsJobs)) {
      if (!block.includes("yarn install")) continue;
      assert.match(block, /uses: actions\/cache\/restore@[0-9a-f]{40} # v\d[\s\S]*?path: node_modules\n\s+key: node-modules-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-node22-\$\{\{ hashFiles\('yarn\.lock', 'package\.json'\) \}\}/, name);
      assert.match(block, /run: yarn install --frozen-lockfile --non-interactive\n {6}- name: Keep node_modules for the next run\n {8}if: steps\.modules\.outputs\.cache-hit != 'true'\n {8}uses: actions\/cache\/save@/, name);
      assert.match(block, /cache: \$\{\{ steps\.modules\.outputs\.cache-hit != 'true' && 'yarn' \|\| '' \}\}/, `${name}: yarn's download cache only when node_modules missed`);
    }
  });

  it("keeps Playwright's Chromium between runs, per Playwright version, in every job that installs it", () => {
    for (const name of ["app", "prototype", "e2e"]) {
      assert.match(specsJobs[name], /uses: actions\/cache@[0-9a-f]{40} # v\d[\s\S]*?path: ~\/\.cache\/ms-playwright\n\s+key: playwright-chromium-[^\n]*steps\.playwright\.outputs\.version[\s\S]*?run: npx playwright install chromium/, name);
    }
  });

  it("links each failed test in the summary to its job's failures artifact (artifact-url), from the job's own JSON report", () => {
    for (const name of ["app", "prototype", "e2e"]) {
      const block = specsJobs[name];
      assert.match(block, /PLAYWRIGHT_JSON_OUTPUT_FILE: reports\//, name);
      assert.match(block, /id: failures\n {8}if: failure\(\)/, name);
      assert.match(block, /URL: \$\{\{ steps\.failures\.outputs\.artifact-url \}\}\n {8}run: printf '%s\\n' "\$URL" > reports\/[\w${}. -]+\.failures-url/, name);
      // The address is written before the reports are kept, so it goes with them.
      assert.ok(block.indexOf(".failures-url") < block.indexOf("name: Keep the reports for the summary"), name);
    }
    assert.match(specsJobs.summary, /--artifact "\$1=\$2\.failures-url"/);
  });

  it("keeps Chromium's sandbox on: user namespaces allowed where the app starts, never --no-sandbox", () => {
    assert.doesNotMatch(specs, /no-sandbox|chromiumSandbox|ELECTRON_DISABLE_SANDBOX/);
    for (const name of ["app", "e2e"]) assert.match(specsJobs[name], /sudo sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0/, name);
  });

  it("keeps every job under 30 minutes", () => {
    for (const [name, block] of Object.entries(specsJobs)) {
      const minutes = Number(/timeout-minutes: (\d+)/.exec(block)?.[1]);
      assert.ok(minutes > 0 && minutes <= 30, `job ${name}: ${minutes}`);
    }
  });

  it("merges every report after all test jobs, even when some failed, and says the result in plain words", () => {
    assert.match(specsJobs.summary, /needs: \[package, app, prototype, e2e\]\n {4}if: \$\{\{ !cancelled\(\) \}\}/);
    assert.match(specsJobs.summary, /npx playwright merge-reports/);
    assert.match(specsJobs.summary, /node scripts\/test-summary\.mjs/);
  });

  it("keeps failures' screenshots and traces, and says in plain words what failed, in every job", () => {
    for (const name of ["app", "prototype", "e2e"]) assert.match(specsJobs[name], /name: failures-[\s\S]*?path: test-results\//, name);
    for (const [name, block] of Object.entries(specsJobs)) {
      assert.match(block, /if: failure\(\)[\s\S]*?::error title=/, `job ${name}`);
    }
  });
});
