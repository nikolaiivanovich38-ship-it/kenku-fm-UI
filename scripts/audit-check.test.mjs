// Tests for the dependency audit gate (FND-5). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAudit, main, parseAuditOutput, validateAllowlist } from "./audit-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.join(here, "fixtures", "audit-sample.ndjson"), "utf8");

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
