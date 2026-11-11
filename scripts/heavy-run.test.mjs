// Tests for the heavy-run watchdog (scripts/heavy-run.mjs). Run with `yarn test:scripts`.
// The integration tests start real process groups with short limits (milliseconds), so they need a POSIX shell.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isAlive, parseArgs, readOwner, runHeavy, staleReason, unfinishedTests } from "./heavy-run.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const posix = process.platform !== "win32";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "heavy-run-test-"));
const quiet = { write() {} };

describe("arguments", () => {
  it("reads limits in minutes, the log, the lock and the command after --", () => {
    const args = parseArgs(["--idle", "5", "--limit", "60", "--retries", "0", "--log", "out.log", "--lock", "/x/.lock", "--", "yarn", "e2e"]);
    assert.deepEqual(args, { idleMs: 300_000, limitMs: 3_600_000, retries: 0, log: "out.log", lock: "/x/.lock", waitMs: 7_200_000, command: ["yarn", "e2e"], status: false });
  });

  it("has defaults that suit a full spec project: 10 minutes idle, 120 minutes in all, one retry after a stall", () => {
    const args = parseArgs(["--", "true"]);
    assert.equal(args.idleMs, 600_000);
    assert.equal(args.limitMs, 7_200_000);
    assert.equal(args.retries, 1);
  });

  it("takes the first word that is not an option as the command, since yarn 1 drops the --", () => {
    assert.deepEqual(parseArgs(["--idle", "5", "xvfb-run", "-a", "yarn", "e2e", "--grep", "x"]).command, ["xvfb-run", "-a", "yarn", "e2e", "--grep", "x"]);
  });

  it("refuses a run without a command, and unknown options, in plain words", () => {
    assert.throws(() => parseArgs([]), /Give the command after --/);
    assert.throws(() => parseArgs(["--idel", "5", "--", "true"]), /Unknown option --idel/);
  });

  it("--status needs no command", () => {
    assert.equal(parseArgs(["--status"]).status, true);
  });
});

describe("a lock left behind", () => {
  const owner = { pid: 4242, pgid: 4242, command: "yarn e2e", startedAt: "2026-11-05T12:00:00.000Z", heartbeatAt: 1_000 };

  it("is stale when its owner has gone", () => {
    assert.match(staleReason(owner, { alive: () => false, now: 2_000 }), /no longer running/);
  });

  it("is stale when its owner is alive but has not checked in for 2 minutes (frozen watchdog)", () => {
    assert.match(staleReason(owner, { alive: () => true, now: 1_000 + 120_001 }), /not checked in/);
  });

  it("is kept while its owner runs and checks in", () => {
    assert.equal(staleReason(owner, { alive: () => true, now: 1_000 + 30_000 }), null);
  });

  it("an unreadable lock file counts as stale", () => {
    assert.match(staleReason(null, { alive: () => true, now: 0 }), /unreadable/);
  });
});

describe("which tests were running when a run stalled", () => {
  it("lists Playwright tests that started and never reported", () => {
    const log = [
      "Running 3 tests using 1 worker",
      "  ✓  1 e2e/a.spec.ts:3:5 › opens (1.2s)",
      "  ✘  2 e2e/b.spec.ts:9:5 › closes (3.0s)",
      "     3 e2e/c.spec.ts:14:5 › hangs",
    ].join("\n");
    assert.deepEqual(unfinishedTests(log), ["e2e/c.spec.ts:14:5 › hangs"]);
  });
});

describe("running under the watchdog", { skip: !posix }, () => {
  it("passes a finished command's exit code through and frees the lock", async () => {
    const dir = tmp();
    const lock = path.join(dir, ".heavy.lock");
    const code = await runHeavy({ ...parseArgs(["--lock", lock, "--log", path.join(dir, "run.log"), "--", "sh", "-c", "echo done; exit 3"]) }, { out: quiet });
    assert.equal(code, 3);
    assert.equal(fs.existsSync(lock), false);
    assert.match(fs.readFileSync(path.join(dir, "run.log"), "utf8"), /done/);
  });

  it("stops a run that prints nothing for the idle time, kills its whole group, writes a report and retries once", async () => {
    const dir = tmp();
    const log = path.join(dir, "run.log");
    const pidFile = path.join(dir, "child.pid");
    // A background grandchild (like Xvfb under xvfb-run) that would outlive its parent.
    const script = `sleep 30 & echo $! >> ${pidFile}; echo "     1 e2e/x.spec.ts:1:1 › waits"; sleep 30`;
    const args = { ...parseArgs(["--lock", path.join(dir, ".lock"), "--log", log, "--retries", "1", "--", "sh", "-c", script]), idleMs: 400 };
    const started = Date.now();
    const code = await runHeavy(args, { out: quiet, graceMs: 200 });
    assert.equal(code, 124);
    assert.ok(Date.now() - started < 10_000, "stopped well before the commands would end");
    const pids = fs.readFileSync(pidFile, "utf8").trim().split("\n").map(Number);
    assert.equal(pids.length, 2, "ran twice: the run and one retry");
    for (const pid of pids) assert.equal(isAlive(pid), false, `background process ${pid} was stopped`);
    const report = fs.readFileSync(`${log}.stall-1.txt`, "utf8");
    assert.match(report, /No output for 0 min/);
    assert.match(report, /e2e\/x\.spec\.ts:1:1 › waits/);
    assert.match(report, /sleep 30/, "the report lists the process tree");
    assert.ok(fs.existsSync(`${log}.stall-2.txt`));
  });

  it("stops a run that keeps printing but passes the overall limit, without retrying", async () => {
    const dir = tmp();
    const log = path.join(dir, "run.log");
    const args = { ...parseArgs(["--lock", path.join(dir, ".lock"), "--log", log, "--", "sh", "-c", "while true; do echo tick; sleep 0.05; done"]), limitMs: 500 };
    const code = await runHeavy(args, { out: quiet, graceMs: 200 });
    assert.equal(code, 124);
    assert.match(fs.readFileSync(`${log}.stall-1.txt`, "utf8"), /Ran longer than/);
    assert.equal(fs.existsSync(`${log}.stall-2.txt`), false);
  });

  it("takes over a lock whose owner has died, and stops what that owner left running", async () => {
    const dir = tmp();
    const lock = path.join(dir, ".lock");
    // An orphan from an earlier run: its own process group, still running.
    const orphan = spawnSync("sh", ["-c", "setsid sleep 30 > /dev/null 2>&1 & echo $!"], { encoding: "utf8" });
    const orphanPid = Number(orphan.stdout.trim());
    const pgid = Number(spawnSync("ps", ["-o", "pgid=", "-p", String(orphanPid)], { encoding: "utf8" }).stdout.trim());
    fs.writeFileSync(lock, JSON.stringify({ pid: 999_999, pgid, command: "old run", startedAt: "earlier", heartbeatAt: Date.now() }));
    const lines = [];
    const code = await runHeavy(parseArgs(["--lock", lock, "--log", path.join(dir, "run.log"), "--", "true"]), { out: { write: (s) => lines.push(s) }, graceMs: 200 });
    assert.equal(code, 0);
    assert.equal(isAlive(orphanPid), false, "the dead owner's leftover process was stopped");
    assert.match(lines.join(""), /no longer running/);
  });

  it("waits for a live owner, then runs", async () => {
    const dir = tmp();
    const lock = path.join(dir, ".lock");
    const first = runHeavy(parseArgs(["--lock", lock, "--log", path.join(dir, "a.log"), "--", "sh", "-c", "sleep 0.6"]), { out: quiet });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(readOwner(lock)?.command, "sh -c sleep 0.6");
    const started = Date.now();
    const code = await runHeavy(parseArgs(["--lock", lock, "--log", path.join(dir, "b.log"), "--", "true"]), { out: quiet, pollMs: 50 });
    assert.equal(code, 0);
    assert.ok(Date.now() - started >= 300, "waited for the first run");
    assert.equal(await first, 0);
  });

  it("a run that waited for the lock checks in as it takes it, so the next run does not think it stale", async () => {
    const dir = tmp();
    const lock = path.join(dir, ".lock");
    const first = runHeavy(parseArgs(["--lock", lock, "--log", path.join(dir, "a.log"), "--", "sh", "-c", "sleep 0.5"]), { out: quiet });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const log = path.join(dir, "b.log");
    const second = runHeavy(parseArgs(["--lock", lock, "--log", log, "--", "cat", lock]), { out: quiet, pollMs: 50 });
    await first;
    const firstEnded = Date.now();
    assert.equal(await second, 0);
    const owner = JSON.parse(fs.readFileSync(log, "utf8"));
    assert.ok(owner.heartbeatAt >= firstEnded - 100, `checked in ${firstEnded - owner.heartbeatAt} ms before taking the lock`);
  });

  it("the command line prints the lock's owner with --status", () => {
    const dir = tmp();
    const result = spawnSync(process.execPath, [path.join(here, "heavy-run.mjs"), "--status", "--lock", path.join(dir, ".lock")], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /free/);
  });
});
