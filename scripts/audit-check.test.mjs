// Tests for the dependency audit gate (FND-5). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  combineAudits,
  evaluateAudit,
  expiredEntries,
  main,
  parseAuditOutput,
  selectPackages,
  SHIPPED_DEV_PACKAGES,
  validateAllowlist,
} from "./audit-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.join(here, "fixtures", "audit-sample.ndjson"), "utf8");
const devSample = fs.readFileSync(path.join(here, "fixtures", "audit-dev-sample.ndjson"), "utf8");

const fullAllowlist = {
  entries: [
    { id: "GHSA-p68q-wchp-6fh7", package: "fastify", reason: "r", backlog: "SEC-9" },
    { id: "GHSA-jqcg-44mw-7w3h", package: "proxy-addr", reason: "r", backlog: "SEC-9" },
    { id: "GHSA-v2hh-gcrm-f6hx", package: "fast-uri", reason: "r", backlog: "SEC-9" },
  ],
};

function withTempFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-check-"));
  const file = path.join(dir, "file.json");
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function silenced(run) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return run();
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("parseAuditOutput", () => {
  it("merges duplicate advisories and keeps every version and path", () => {
    const { summary, advisories } = parseAuditOutput(sample);
    assert.equal(summary.vulnerabilities.critical, 1);
    assert.equal(advisories.length, 4);
    const fastUri = advisories.find((advisory) => advisory.package === "fast-uri");
    assert.deepEqual(fastUri.versions, ["2.4.0", "3.0.6"]);
    assert.deepEqual(fastUri.paths, ["fastify>a>fast-uri", "fastify>b>fast-uri"]);
  });

  it("refuses output without a summary, so a broken audit cannot pass", () => {
    assert.throws(() => parseAuditOutput('{"type":"info","data":"x"}\n'), /no summary/);
  });

  it("reports yarn errors", () => {
    assert.throws(() => parseAuditOutput('{"type":"error","data":"registry down"}\n'), /registry down/);
  });
});

describe("Electron, the shipped runtime", () => {
  it("is audited even though package.json lists it as a devDependency", () => {
    assert.deepEqual(SHIPPED_DEV_PACKAGES, ["electron"]);
  });

  it("keeps only Electron's advisories from the devDependencies audit, not build tools", () => {
    const electron = selectPackages(parseAuditOutput(devSample), SHIPPED_DEV_PACKAGES);
    assert.deepEqual(
      electron.advisories.map((advisory) => advisory.id),
      ["GHSA-8337-3p73-46f4", "GHSA-5rqw-r77c-jp79"],
    );
    assert.deepEqual(electron.summary.vulnerabilities, { info: 0, low: 0, moderate: 1, high: 1, critical: 0 });
  });

  it("blocks a new Electron advisory like any shipped library", () => {
    const combined = combineAudits(parseAuditOutput(sample), selectPackages(parseAuditOutput(devSample), SHIPPED_DEV_PACKAGES));
    const { blocking } = evaluateAudit(combined.advisories, fullAllowlist);
    assert.deepEqual(
      blocking.map((advisory) => advisory.package),
      ["electron"],
    );
    assert.equal(combined.summary.vulnerabilities.high, 4);
  });
});

describe("allowlist review dates", () => {
  const entry = { id: "GHSA-8337-3p73-46f4", package: "electron", reason: "r", backlog: "SEC-1", reviewBy: "2026-12-15" };

  it("keeps an entry valid up to and including its reviewBy date", () => {
    assert.deepEqual(expiredEntries({ entries: [entry] }, "2026-12-15"), []);
  });

  it("reports an entry once its reviewBy date has passed", () => {
    assert.deepEqual(expiredEntries({ entries: [entry, { ...entry, reviewBy: undefined }] }, "2026-12-16"), [entry]);
  });

  it("rejects a reviewBy that is not a YYYY-MM-DD date", () => {
    assert.match(validateAllowlist({ entries: [{ ...entry, reviewBy: "15/12/2026" }] })[0], /reviewBy/);
  });

  it("fails the gate with a clear message when an entry has expired", () => {
    const allowlist = { entries: [...fullAllowlist.entries, { ...entry, reviewBy: "2020-01-01" }] };
    const errors = [];
    const { error } = console;
    console.error = (message) => errors.push(message);
    try {
      withTempFile(allowlist, (allowlistFile) =>
        withTempFile(sample, (input) => assert.equal(main(["--input", input, "--allowlist", allowlistFile]), 1)),
      );
    } finally {
      console.error = error;
    }
    assert.match(errors.join("\n"), /GHSA-8337-3p73-46f4 electron .*review date 2020-01-01 has passed/);
  });

  it("gives any Electron entry in the checked-in allowlist a review date and SEC-1", () => {
    // Electron 44.9.2 has no open high or critical advisories, so the list may
    // hold none; any future entry must still expire and point at SEC-1.
    const allowlist = JSON.parse(fs.readFileSync(path.join(here, "audit-allowlist.json"), "utf8"));
    const electron = allowlist.entries.filter((item) => item.package === "electron");
    for (const item of electron) {
      assert.match(item.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(item.backlog, "SEC-1");
    }
  });
});

describe("evaluateAudit", () => {
  it("passes when every high/critical advisory is allowlisted, ignoring moderate ones", () => {
    const { blocking, allowed, unused } = evaluateAudit(parseAuditOutput(sample).advisories, fullAllowlist);
    assert.equal(blocking.length, 0);
    assert.equal(allowed.length, 3);
    assert.equal(unused.length, 0);
  });

  it("blocks a new high or critical advisory", () => {
    const allowlist = { entries: fullAllowlist.entries.filter((entry) => entry.package !== "proxy-addr") };
    const { blocking } = evaluateAudit(parseAuditOutput(sample).advisories, allowlist);
    assert.deepEqual(
      blocking.map((advisory) => advisory.id),
      ["GHSA-jqcg-44mw-7w3h"],
    );
  });

  it("matches on advisory and package together", () => {
    const allowlist = {
      entries: [...fullAllowlist.entries.slice(0, 2), { id: "GHSA-v2hh-gcrm-f6hx", package: "other", reason: "r", backlog: "x" }],
    };
    const { blocking, unused } = evaluateAudit(parseAuditOutput(sample).advisories, allowlist);
    assert.equal(blocking[0].package, "fast-uri");
    assert.equal(unused[0].package, "other");
  });
});

describe("validateAllowlist", () => {
  it("requires id, package, reason and backlog on every entry", () => {
    const problems = validateAllowlist({ entries: [{ id: "GHSA-p68q-wchp-6fh7", package: "fastify" }] });
    assert.deepEqual(problems, ['Entry 1 is missing "reason".', 'Entry 1 is missing "backlog".']);
  });

  it("rejects a malformed id", () => {
    const problems = validateAllowlist({ entries: [{ id: "CVE-1", package: "a", reason: "b", backlog: "c" }] });
    assert.match(problems[0], /not a GHSA id/);
  });

  it("accepts the checked-in allowlist", () => {
    const allowlist = JSON.parse(fs.readFileSync(path.join(here, "audit-allowlist.json"), "utf8"));
    assert.deepEqual(validateAllowlist(allowlist), []);
  });
});

describe("main (command line)", () => {
  it("checks a saved Electron audit too (--dev-input)", () => {
    withTempFile(fullAllowlist, (allowlist) =>
      withTempFile(sample, (input) =>
        withTempFile(devSample, (devInput) =>
          assert.equal(
            silenced(() => main(["--input", input, "--dev-input", devInput, "--allowlist", allowlist])),
            1,
          ),
        ),
      ),
    );
  });

  it("exits 0 when everything severe is allowlisted", () => {
    withTempFile(fullAllowlist, (allowlist) =>
      withTempFile(sample, (input) =>
        assert.equal(silenced(() => main(["--input", input, "--allowlist", allowlist])), 0),
      ),
    );
  });

  it("exits 1 on a new advisory", () => {
    withTempFile({ entries: [] }, (allowlist) =>
      withTempFile(sample, (input) =>
        assert.equal(silenced(() => main(["--input", input, "--allowlist", allowlist])), 1),
      ),
    );
  });

  it("exits 2 when the audit output or allowlist is unusable", () => {
    withTempFile(fullAllowlist, (allowlist) =>
      withTempFile("not json", (input) =>
        assert.equal(silenced(() => main(["--input", input, "--allowlist", allowlist])), 2),
      ),
    );
    withTempFile({ entries: [{}] }, (allowlist) =>
      assert.equal(silenced(() => main(["--allowlist", allowlist])), 2),
    );
  });
});
