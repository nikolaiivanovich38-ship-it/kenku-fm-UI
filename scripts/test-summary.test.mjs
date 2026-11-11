// Tests for the plain-words test summary of the specs workflow (scripts/test-summary.mjs). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { countTests, parseArgs, readReport, summarise } from "./test-summary.mjs";

/** A Playwright JSON report (reporter "json") with the given tests, as merge-reports writes it. */
function report(tests, duration = 61_000) {
  return {
    stats: { duration },
    suites: [
      {
        title: "campaigns.spec.ts",
        file: "campaigns.spec.ts",
        specs: [],
        suites: [
          {
            title: "round 6, part 7: Back is one history",
            file: "campaigns.spec.ts",
            specs: tests.map(([title, status, expectedStatus = "passed", projectName = "app", line = 10]) => ({
              title,
              file: "campaigns.spec.ts",
              line,
              tests: [{ projectName, status, expectedStatus }],
            })),
          },
        ],
      },
    ],
  };
}

describe("counting", () => {
  it("tells passed, failed, flaky, expected to fail and skipped apart", () => {
    const counts = countTests(
      report([
        ["a", "expected"],
        ["b", "expected"],
        ["c", "unexpected"],
        ["d", "flaky"],
        ["e", "expected", "failed"],
        ["f", "skipped", "skipped"],
      ]),
    );
    assert.deepEqual(
      { passed: counts.passed, failed: counts.failed.length, flaky: counts.flaky.length, expectedToFail: counts.expectedToFail, skipped: counts.skipped },
      { passed: 2, failed: 1, flaky: 1, expectedToFail: 1, skipped: 1 },
    );
  });

  it("names each failed test by project, file, line and its titles", () => {
    const { failed } = countTests(report([["going back returns to the same place", "unexpected", "passed", "app", 632]]));
    assert.deepEqual(failed, [
      { name: "[app] campaigns.spec.ts:632 › round 6, part 7: Back is one history › going back returns to the same place", passedAlthoughExpectedToFail: false },
    ]);
  });

  it("marks a test that passed although it was expected to fail (its screen is built: take it off the list)", () => {
    const { failed } = countTests(report([["x", "unexpected", "failed"]]));
    assert.equal(failed[0].passedAlthoughExpectedToFail, true);
  });
});

describe("the summary", () => {
  it("says in plain words how many passed and failed, and which failed, with an error for each", () => {
    const { markdown, annotations, anyFailed } = summarise({
      runs: [{ label: "Acceptance specs", report: report([["a", "expected"], ["b", "unexpected", "passed", "app", 632]]) }],
      parts: [],
    });
    assert.equal(anyFailed, true);
    assert.match(markdown, /\*\*Acceptance specs\*\*: 1 passed, 1 failed/);
    assert.match(markdown, /campaigns\.spec\.ts:632/);
    assert.equal(annotations.length, 1);
    assert.match(annotations[0], /^::error title=A test failed::\[app\] campaigns\.spec\.ts:632/);
  });

  it("says all passed when nothing failed, and gives no errors", () => {
    const { markdown, annotations, anyFailed } = summarise({ runs: [{ label: "End-to-end tests", report: report([["a", "expected"]]) }], parts: [] });
    assert.equal(anyFailed, false);
    assert.match(markdown, /\*\*End-to-end tests\*\*: 1 passed, 0 failed/);
    assert.match(markdown, /Everything passed/);
    assert.deepEqual(annotations, []);
  });

  it("says when a job left no results (it stopped before its tests finished)", () => {
    const { markdown, annotations, anyFailed } = summarise({ runs: [{ label: "End-to-end tests", report: null }], parts: [] });
    assert.equal(anyFailed, true);
    assert.match(markdown, /End-to-end tests[^\n]*no results/);
    assert.match(annotations[0], /^::error title=No results from End-to-end tests::/);
  });

  it("escapes what would cut an error short (a comma or colon in its title, a new line)", () => {
    const { annotations } = summarise({ runs: [{ label: "App, part 1: of 8", report: null }], parts: [] });
    assert.match(annotations[0], /^::error title=No results from App%2C part 1%3A of 8::/);
  });

  it("lists flaky tests apart, as passed on the second try", () => {
    const { markdown, anyFailed } = summarise({ runs: [{ label: "Acceptance specs", report: report([["wobbly", "flaky"]]) }], parts: [] });
    assert.equal(anyFailed, false);
    assert.match(markdown, /1 flaky \(failed once, passed on the second try\)/);
    assert.match(markdown, /wobbly/);
  });

  it("has a table with a row per part, its counts and its time in minutes", () => {
    const { markdown } = summarise({
      runs: [],
      parts: [
        { label: "app 1 of 8", report: report([["a", "expected"], ["b", "unexpected"]], 600_000) },
        { label: "e2e", report: null },
      ],
    });
    assert.match(markdown, /\| app 1 of 8 \| 1 \| 1 \| 0 \| 0 \| 0 \| 10\.0 min \|/);
    assert.match(markdown, /\| e2e \| no results \|/);
  });

  it("keeps errors to ten, as GitHub shows no more for one step", () => {
    const many = Array.from({ length: 14 }, (_, i) => [`t${i}`, "unexpected", "passed", "app", i + 1]);
    const { annotations, markdown } = summarise({ runs: [{ label: "Acceptance specs", report: report(many) }], parts: [] });
    assert.equal(annotations.length, 10);
    assert.match(markdown, /t13/, "the summary still lists every failure");
  });
});

describe("arguments and files", () => {
  it("reads --run and --part as label=file", () => {
    assert.deepEqual(parseArgs(["--run", "Acceptance specs=r/specs.json", "--part", "app 1 of 8=r/app-1.json"]), {
      runs: [{ label: "Acceptance specs", file: "r/specs.json" }],
      parts: [{ label: "app 1 of 8", file: "r/app-1.json" }],
    });
  });

  it("refuses anything else, in plain words", () => {
    assert.throws(() => parseArgs(["--run", "no-equals-sign"]), /label=file/);
    assert.throws(() => parseArgs(["--other", "a=b"]), /Unknown option --other/);
  });

  it("reads a report, and gives null for a missing or broken one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-summary-"));
    fs.writeFileSync(path.join(dir, "ok.json"), JSON.stringify(report([])));
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    assert.ok(readReport(path.join(dir, "ok.json")));
    assert.equal(readReport(path.join(dir, "broken.json")), null);
    assert.equal(readReport(path.join(dir, "missing.json")), null);
  });
});
