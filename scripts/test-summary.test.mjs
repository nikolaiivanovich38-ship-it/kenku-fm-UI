// Tests for the plain-words test summary of the specs workflow (scripts/test-summary.mjs). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { countTests, failureScreenshots, parseArgs, readReport, readUrl, summarise } from "./test-summary.mjs";

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

/** A failed test's last try with its screenshot, as a job's own JSON reporter writes it (absolute paths). */
function withScreenshots(rep, file = "/home/runner/work/kenku/kenku/test-results/specs/campaigns-going-back-app-retry1/test-failed-1.png") {
  const test = rep.suites[0].suites[0].specs[0].tests[0];
  test.results = [
    { retry: 0, attachments: [{ name: "screenshot", contentType: "image/png", path: file.replace("-retry1", "") }] },
    { retry: 1, attachments: [{ name: "trace", contentType: "application/zip", path: "/x/trace.zip" }, { name: "screenshot", contentType: "image/png", path: file }] },
  ];
  return rep;
}

describe("links to each failure's screenshot", () => {
  const failing = () => report([["going back", "unexpected", "passed", "app", 632]]);
  const url = "https://github.com/o/r/actions/runs/1/artifacts/99";

  it("finds the last try's screenshot of each failed test, as a path inside the failures artifact (test-results/)", () => {
    const shots = failureScreenshots(withScreenshots(failing()));
    assert.deepEqual([...shots], [["[app] campaigns.spec.ts:632 › round 6, part 7: Back is one history › going back", "specs/campaigns-going-back-app-retry1/test-failed-1.png"]]);
  });

  it("reads Windows paths too, and leaves out tests that passed", () => {
    const shots = failureScreenshots(withScreenshots(failing(), "D:\\a\\r\\r\\test-results\\carryOver-a-Cue-retry1\\test-failed-1.png"));
    assert.deepEqual([...shots.values()], ["carryOver-a-Cue-retry1/test-failed-1.png"]);
    assert.equal(failureScreenshots(withScreenshots(report([["fine", "expected"]]))).size, 0);
  });

  it("links each failure in the summary straight to the failures artifact of the part it ran in, naming the screenshot in it", () => {
    const { markdown } = summarise({
      runs: [{ label: "Acceptance specs", report: failing() }],
      parts: [
        { label: "App specs, part 2 of 8", report: report([["other", "expected"]]), artifactUrl: null },
        { label: "App specs, part 3 of 8", report: withScreenshots(failing()), artifactUrl: url },
      ],
    });
    assert.match(markdown, new RegExp(`going back · \\[screenshot\\]\\(${url.replace(/[/.]/g, "\\$&")}\\) \\(in it: \`specs/campaigns-going-back-app-retry1/test-failed-1\\.png\`\\)`));
    assert.match(markdown, /\| \[App specs, part 3 of 8\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/99\) \|/, "the part's row links its failures too");
  });

  it("links the artifact without a file name when the failure left no screenshot, and nothing when there is no artifact", () => {
    const linked = summarise({ runs: [{ label: "End-to-end tests", report: failing() }], parts: [{ label: "End-to-end tests", report: failing(), artifactUrl: url }] });
    assert.match(linked.markdown, /going back · \[screenshots and trace\]\(https:/);
    const bare = summarise({ runs: [{ label: "End-to-end tests", report: failing() }], parts: [] });
    assert.match(bare.markdown, /going back\n/);
  });
});

describe("arguments and files", () => {
  it("reads --run and --part as label=file, and --artifact as a part's label=the file holding its failures artifact's address", () => {
    assert.deepEqual(parseArgs(["--run", "Acceptance specs=r/specs.json", "--part", "app 1 of 8=r/app-1.json", "--artifact", "app 1 of 8=r/app-1.failures-url"]), {
      runs: [{ label: "Acceptance specs", file: "r/specs.json" }],
      parts: [{ label: "app 1 of 8", file: "r/app-1.json" }],
      artifacts: [{ label: "app 1 of 8", file: "r/app-1.failures-url" }],
    });
  });

  it("reads an artifact's address from its file, and gives null for a missing file or anything but a GitHub address", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-summary-"));
    fs.writeFileSync(path.join(dir, "ok"), "https://github.com/o/r/actions/runs/1/artifacts/99\n");
    fs.writeFileSync(path.join(dir, "odd"), "javascript:alert(1)\n");
    assert.equal(readUrl(path.join(dir, "ok")), "https://github.com/o/r/actions/runs/1/artifacts/99");
    assert.equal(readUrl(path.join(dir, "odd")), null);
    assert.equal(readUrl(path.join(dir, "missing")), null);
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
