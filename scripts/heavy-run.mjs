#!/usr/bin/env node
// Heavy runs (packaging, Playwright) one at a time, and never left stalled.
//
//   node scripts/heavy-run.mjs [options] -- <command…>     (or: yarn heavy [options] <command…>)
//   node scripts/heavy-run.mjs --status
//
// Options (minutes unless said):
//   --idle <min>     stop the run when it has printed nothing for this long (default 10)
//   --limit <min>    stop the run when it has taken this long in all (default 120)
//   --retries <n>    run again this many times after an idle stall (default 1; never after the overall limit)
//   --wait <min>     how long to wait for another run to finish first (default 120)
//   --log <file>     where the output goes as well as the screen (default: a new file in the temp folder)
//   --lock <file>    the lock file (default: HEAVY_RUN_LOCK, else lyre-heavy-run.lock in the temp folder: one per machine)
//
// Why: on the 2-core build machine two heavy runs at once fail each other's timing checks, so runs queue on one lock.
// A stalled run, or something an earlier run left behind (an Xvfb started by xvfb-run, say), used to hold that lock
// for hours with nobody noticing. This script:
//   - holds the lock as a file naming its owner (process, process group, command, log) and checks in every 30 s;
//   - takes over a lock whose owner has died or stopped checking in, after stopping everything left in that owner's
//     process group (no more locks kept by a stray child that inherited them);
//   - runs the command in a process group of its own, so the whole group (browsers, Electron, Xvfb) is stopped
//     together, whether the run ends, stalls or is interrupted;
//   - stops a run that prints nothing for --idle minutes, or runs longer than --limit, after writing a report beside
//     the log (<log>.stall-<n>.txt: why, the Playwright tests that never finished, the process tree, the last lines);
//   - runs it again once after an idle stall (a stall under load is often a one-off), and exits 124 if it stalls again;
//   - gives the command LYRE_HEAVY_RUN (the lock's path), so a script it starts that would take the lock itself
//     (scripts/package-test.mjs) runs straight away instead of waiting for its own parent.
// Exit code: the command's own, or 124 after a stall.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINUTE = 60_000;
const HEARTBEAT_MS = 30_000;
/** A live owner that has not checked in for this long is taken to be frozen. */
const STALE_HEARTBEAT_MS = 2 * MINUTE;
export const STALLED = 124;

/** One lock per machine, shared by every checkout and worktree. */
const DEFAULT_LOCK = process.env.HEAVY_RUN_LOCK ?? path.join(os.tmpdir(), "lyre-heavy-run.lock");

export function parseArgs(argv) {
  const args = { idleMs: 10 * MINUTE, limitMs: 120 * MINUTE, retries: 1, log: null, lock: DEFAULT_LOCK, waitMs: 120 * MINUTE, command: [], status: false };
  const minutes = { "--idle": "idleMs", "--limit": "limitMs", "--wait": "waitMs" };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (option === "--") {
      args.command = argv.slice(i + 1);
      break;
    }
    if (option === "--status") args.status = true;
    else if (option in minutes) args[minutes[option]] = Number(argv[++i]) * MINUTE;
    else if (option === "--retries") args.retries = Number(argv[++i]);
    else if (option === "--log") args.log = argv[++i];
    else if (option === "--lock") args.lock = argv[++i];
    else if (option.startsWith("--")) throw new Error(`Unknown option ${option}. See the top of scripts/heavy-run.mjs.`);
    else {
      // Yarn 1 drops the "--" in `yarn heavy -- <command>`: the first word that is not an option starts the command.
      args.command = argv.slice(i);
      break;
    }
  }
  if (!args.status && args.command.length === 0) throw new Error("Give the command after --, for example: node scripts/heavy-run.mjs -- yarn e2e");
  return args;
}

/** Whether a process is running. A zombie (ended, not yet collected by its parent) counts as ended. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === "EPERM";
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true; // no /proc (macOS): kill(0) is all there is
  }
}

export function readOwner(lock) {
  try {
    return JSON.parse(fs.readFileSync(lock, "utf8"));
  } catch {
    return null;
  }
}

/** Why a lock's owner no longer holds it, or null while it does. */
export function staleReason(owner, { alive = isAlive, now = Date.now() } = {}) {
  if (!owner || typeof owner.pid !== "number") return "the lock file is unreadable";
  if (!alive(owner.pid)) return `its owner (process ${owner.pid}, "${owner.command}") is no longer running`;
  if (now - (owner.heartbeatAt ?? 0) > STALE_HEARTBEAT_MS) return `its owner (process ${owner.pid}, "${owner.command}") has not checked in for ${Math.round((now - owner.heartbeatAt) / 1000)} s`;
  return null;
}

/** Playwright list-reporter lines for tests that started ("     3 file:line › name") and never reported ✓ ✘ or -. */
export function unfinishedTests(log) {
  const started = new Map();
  for (const line of log.split("\n")) {
    const match = /^\s*([✓✘-]?)\s+(\d+)\s+(\S+\.spec\.ts:\d+:\d+ › .*?)(?:\s+\(\d+(?:\.\d+)?m?s\))?\s*$/.exec(line);
    if (!match) continue;
    if (match[1]) started.delete(match[2]);
    else started.set(match[2], match[3]);
  }
  return [...started.values()];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ownGroup() {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });
  return Number(result.stdout.trim());
}

/** Every process in a group, as `ps` lists them (pid, parent, run time, CPU, state, command). */
function groupTree(pgid) {
  const result = spawnSync("ps", ["-eo", "pid,ppid,pgid,etime,pcpu,stat,args"], { encoding: "utf8" });
  const [header, ...rows] = (result.stdout ?? "").split("\n");
  const inGroup = rows.filter((row) => Number(row.trim().split(/\s+/)[2]) === pgid);
  return [header, ...inGroup].join("\n");
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Stops a whole process group: TERM, then KILL after graceMs. Never this script's own group. */
async function stopGroup(pgid, graceMs) {
  if (!pgid || pgid === ownGroup()) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  const until = Date.now() + graceMs;
  while (Date.now() < until && groupAlive(pgid)) await sleep(50);
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // already gone
  }
}

async function acquire(args, owner, { out, graceMs, pollMs }) {
  const until = Date.now() + args.waitMs;
  let announced = false;
  for (;;) {
    try {
      // Checked in as the lock is taken: a run that waited long would otherwise look stale to the next one.
      owner.heartbeatAt = Date.now();
      owner.startedAt = new Date().toISOString();
      fs.writeFileSync(args.lock, JSON.stringify(owner), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const held = readOwner(args.lock);
    const reason = staleReason(held);
    if (reason) {
      out.write(`heavy-run: taking over the lock: ${reason}. Stopping what it left running.\n`);
      if (held?.pgid) await stopGroup(held.pgid, graceMs);
      fs.rmSync(args.lock, { force: true });
      continue;
    }
    if (!announced) {
      out.write(`heavy-run: waiting for "${held.command}" (started ${held.startedAt}, log ${held.log}).\n`);
      announced = true;
    }
    if (Date.now() > until) {
      out.write(`heavy-run: gave up waiting after ${Math.round(args.waitMs / MINUTE)} min; "${held.command}" still holds the lock.\n`);
      return false;
    }
    await sleep(pollMs);
  }
}

function writeReport(file, { why, args, log, pgid }) {
  const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  const unfinished = unfinishedTests(text);
  const report = [
    `Stalled run: ${args.command.join(" ")}`,
    `When: ${new Date().toISOString()}`,
    `Why: ${why}`,
    "",
    "Tests that started and never finished:",
    ...(unfinished.length ? unfinished.map((name) => `  ${name}`) : ["  (none found in the log)"]),
    "",
    "Processes in the run's group when it was stopped:",
    groupTree(pgid),
    "",
    "Last 60 lines of the log:",
    ...text.split("\n").slice(-60),
  ].join("\n");
  fs.writeFileSync(file, report);
}

/** One attempt: runs the command in its own process group; resolves its exit code, or STALLED with the reason. */
function attempt(args, log, { out, graceMs }) {
  return new Promise((resolve) => {
    // LYRE_HEAVY_RUN: a script the command starts (yarn package:test) knows the lock is held already, and does not queue for it.
    const env = { ...process.env, LYRE_HEAVY_RUN: args.lock };
    const child = spawn(args.command[0], args.command.slice(1), { detached: true, stdio: ["ignore", "pipe", "pipe"], env });
    const pgid = child.pid;
    const started = Date.now();
    let lastOutput = started;
    let stalled = null;
    const sink = fs.createWriteStream(log, { flags: "a" });
    const onData = (chunk) => {
      lastOutput = Date.now();
      sink.write(chunk);
      out.write(chunk.toString());
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const check = setInterval(
      () => {
        if (stalled) return;
        const now = Date.now();
        if (now - started > args.limitMs) stalled = { retry: false, why: `Ran longer than ${Math.round(args.limitMs / MINUTE)} min in all.` };
        else if (now - lastOutput > args.idleMs) stalled = { retry: true, why: `No output for ${Math.round((now - lastOutput) / MINUTE)} min (limit ${Math.round(args.idleMs / MINUTE)} min).` };
        if (stalled) {
          clearInterval(check);
          sink.end(() => {
            stalled.pgid = pgid;
            resolve({ stalled, pgid, child });
          });
        }
      },
      Math.max(20, Math.min(1000, args.idleMs / 4, args.limitMs / 4)),
    );
    child.on("close", async (code, signal) => {
      clearInterval(check);
      if (stalled) return;
      sink.end();
      // Whatever the command left running in its group (an Xvfb, a browser) goes with it.
      await stopGroup(pgid, graceMs);
      resolve({ code: code ?? (signal ? 128 : 1), pgid });
    });
    child.on("error", (error) => {
      clearInterval(check);
      out.write(`heavy-run: could not start ${args.command[0]}: ${error.message}\n`);
      resolve({ code: 127, pgid });
    });
  });
}

/** Runs `args.command` under the lock and the watchdog; resolves the exit code. */
export async function runHeavy(args, { out = process.stdout, graceMs = 10_000, pollMs = 5_000 } = {}) {
  const log = args.log ?? path.join(os.tmpdir(), `heavy-run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const owner = { pid: process.pid, pgid: null, command: args.command.join(" "), startedAt: new Date().toISOString(), log, heartbeatAt: Date.now() };
  if (!(await acquire(args, owner, { out, graceMs, pollMs }))) return STALLED;
  const heartbeat = setInterval(() => {
    owner.heartbeatAt = Date.now();
    try {
      fs.writeFileSync(args.lock, JSON.stringify(owner));
    } catch {
      // the lock file went away; the run finishes anyway
    }
  }, HEARTBEAT_MS);
  try {
    for (let n = 1; ; n++) {
      const result = await attempt(args, log, { out, graceMs });
      owner.pgid = result.pgid;
      if (!result.stalled) return result.code;
      const report = `${log}.stall-${n}.txt`;
      writeReport(report, { why: result.stalled.why, args, log, pgid: result.pgid });
      await stopGroup(result.pgid, graceMs);
      out.write(`\nheavy-run: ${result.stalled.why} Stopped the run; report in ${report}.\n`);
      if (!result.stalled.retry || n > args.retries) return STALLED;
      out.write(`heavy-run: running it again (${n} of ${args.retries} retries).\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (readOwner(args.lock)?.pid === process.pid) fs.rmSync(args.lock, { force: true });
  }
}

function status(args) {
  const owner = readOwner(args.lock);
  if (!fs.existsSync(args.lock)) return console.log(`The heavy-run lock is free (${args.lock}).`);
  const reason = staleReason(owner);
  console.log(`Held by "${owner?.command}" since ${owner?.startedAt} (process ${owner?.pid}, log ${owner?.log}).`);
  if (reason) console.log(`Stale: ${reason}. The next run takes it over.`);
  else if (owner?.log && fs.existsSync(owner.log)) {
    const idle = Math.round((Date.now() - fs.statSync(owner.log).mtimeMs) / 1000);
    console.log(`Last output ${idle} s ago.`);
  }
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (args.status) {
    status(args);
    return 0;
  }
  return runHeavy(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Interrupted (Ctrl+C, a timeout): stop the run's group too, then free the lock.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      const owner = readOwner(parseArgs(process.argv.slice(2)).lock);
      if (owner?.pid === process.pid) {
        if (owner.pgid) {
          try {
            process.kill(-owner.pgid, "SIGKILL");
          } catch {
            // already gone
          }
        }
        fs.rmSync(parseArgs(process.argv.slice(2)).lock, { force: true });
      }
      process.exit(130);
    });
  }
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
