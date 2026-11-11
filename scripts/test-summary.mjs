#!/usr/bin/env node
// The plain-words summary at the end of the specs workflow (.github/workflows/specs.yml).
//
//   node scripts/test-summary.mjs --run "<label>=<report.json>" … [--part "<label>=<report.json>" …]
//
// Each file is a Playwright JSON report (merge-reports --reporter=json). A --run is a whole suite (the acceptance
// specs, the end-to-end tests); a --part is one job of it (one shard), shown as a row of a table. The summary goes to
// the run's summary page ($GITHUB_STEP_SUMMARY, or the screen when that is not set), and every failed test becomes an
// error on the run (GitHub shows ten per step). A missing or unreadable report means the job stopped before its tests
// finished, and is said as such. Exit code 0: the test jobs themselves fail when a test fails.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** GitHub shows at most ten error annotations for one step. */
const MAX_ANNOTATIONS = 10;

/** A workflow command's message and title are cut at a new line, and a title also at ":" or ","; GitHub's escapes. */
const escapeData = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeTitle = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function parseArgs(argv) {
  const args = { runs: [], parts: [] };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    const list = option === "--run" ? args.runs : option === "--part" ? args.parts : null;
    if (!list) throw new Error(`Unknown option ${option}. See the top of scripts/test-summary.mjs.`);
    const value = argv[++i] ?? "";
    const at = value.lastIndexOf("=");
    if (at <= 0 || at === value.length - 1) throw new Error(`${option} takes label=file, not "${value}".`);
    list.push({ label: value.slice(0, at), file: value.slice(at + 1) });
  }
  return args;
}

/** The report in a file, or null when the file is missing or not a report (the job left none). */
export function readReport(file) {
  try {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(report.suites) ? report : null;
  } catch {
    return null;
  }
}

/** Every test of a report with the titles of the describe blocks around it (the file's own block left out). */
function* testsOf(suites, titles = [], depth = 0) {
  for (const suite of suites ?? []) {
    const inner = depth === 0 ? titles : [...titles, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) yield { spec, test, titles: [...inner, spec.title] };
    }
    yield* testsOf(suite.suites, inner, depth + 1);
  }
}

function testName({ spec, test, titles }) {
  const project = test.projectName ? `[${test.projectName}] ` : "";
  return `${project}${spec.file}:${spec.line} › ${titles.join(" › ")}`;
}

/**
 * Counts by outcome. Playwright's "expected" covers both a pass and a test.fail() that failed (a screen or stream not
 * built yet); expectedStatus tells them apart. "unexpected" is a failure, or a test.fail() that passed.
 */
export function countTests(report) {
  const counts = { passed: 0, failed: [], flaky: [], expectedToFail: 0, skipped: 0, durationMs: report.stats?.duration ?? 0 };
  for (const entry of testsOf(report.suites)) {
    const { status, expectedStatus } = entry.test;
    if (status === "skipped") counts.skipped++;
    else if (status === "flaky") counts.flaky.push(testName(entry));
    else if (status === "unexpected") counts.failed.push({ name: testName(entry), passedAlthoughExpectedToFail: expectedStatus === "failed" });
    else if (expectedStatus === "failed") counts.expectedToFail++;
    else counts.passed++;
  }
  return counts;
}

function line(label, c) {
  const parts = [`${c.passed} passed`, `${c.failed.length} failed`];
  if (c.flaky.length) parts.push(`${c.flaky.length} flaky (failed once, passed on the second try)`);
  if (c.expectedToFail) parts.push(`${c.expectedToFail} expected to fail (not built yet)`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  return `- **${label}**: ${parts.join(", ")}.`;
}

/** Markdown for the summary page, the error annotations, and whether anything failed or left no results. */
export function summarise({ runs, parts }) {
  const out = ["## Test results", ""];
  const annotations = [];
  const failures = [];
  const flaky = [];
  let anyFailed = false;
  const say = (title, text) => {
    if (annotations.length < MAX_ANNOTATIONS) annotations.push(`::error title=${escapeTitle(title)}::${escapeData(text)}`);
  };

  for (const { label, report } of runs) {
    if (!report) {
      anyFailed = true;
      const text = "its job stopped before the tests finished (packaging or set-up failed, or it ran out of time). Open the job's log.";
      out.push(`- **${label}**: no results: ${text}`);
      say(`No results from ${label}`, text);
      continue;
    }
    const counts = countTests(report);
    out.push(line(label, counts));
    if (counts.failed.length) anyFailed = true;
    failures.push(...counts.failed);
    flaky.push(...counts.flaky);
  }

  out.push("");
  if (failures.length) {
    out.push("### What failed", "");
    for (const f of failures) {
      const why = f.passedAlthoughExpectedToFail ? " (passed although expected to fail: its screen or stream works now, so take it off the not-built list)" : "";
      out.push(`- ${f.name}${why}`);
      say(f.passedAlthoughExpectedToFail ? "A test passed that was expected to fail" : "A test failed", f.name);
    }
    out.push("", "Download the **test-report** artifact and open `specs/index.html` or `e2e/index.html`: each failure has its screen, its steps and a trace.", "");
  } else if (!anyFailed && runs.length) {
    out.push("Everything passed.", "");
  }
  if (flaky.length) {
    out.push("### Flaky (failed once, passed on the second try)", "", ...flaky.map((name) => `- ${name}`), "");
  }

  if (parts.length) {
    out.push("### Each part", "", "| Part | Passed | Failed | Flaky | Expected to fail | Skipped | Time |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const { label, report } of parts) {
      if (!report) {
        out.push(`| ${label} | no results | | | | | |`);
        continue;
      }
      const c = countTests(report);
      out.push(`| ${label} | ${c.passed} | ${c.failed.length} | ${c.flaky.length} | ${c.expectedToFail} | ${c.skipped} | ${(c.durationMs / 60_000).toFixed(1)} min |`);
    }
    out.push("");
  }
  return { markdown: out.join("\n"), annotations, anyFailed };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const load = (list) => list.map(({ label, file }) => ({ label, report: readReport(file) }));
  const { markdown, annotations } = summarise({ runs: load(args.runs), parts: load(args.parts) });
  for (const annotation of annotations) console.log(annotation);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.log(markdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
