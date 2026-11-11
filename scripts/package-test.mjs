#!/usr/bin/env node
// One test package per commit: packages the app for testing (CUE_DESK_E2E_BUILD=1 yarn package) only when the
// package in out/ was not made from this commit and tree.
//
//   node scripts/package-test.mjs [--check] [--force]        (or: yarn package:test)
//
// After each package it writes out/lyre-test-build.json: the commit, whether the app's code had uncommitted changes
// (the dirty flag), CUE_DESK_E2E_BUILD, and app.asar's size and time. The next run uses the package again when all of
// these hold:
//   - it was made from the commit checked out now;
//   - neither then nor now were there uncommitted changes to what goes into the package (the app's code and the build's
//     configuration, scripts/affected-specs.mjs isPackageInput: a changed test or document does not count);
//   - it is a test build (CUE_DESK_E2E_BUILD=1);
//   - app.asar is the one it made (a plain `yarn package` since then made a new one).
// Otherwise it packages, through `yarn heavy` (one heavy run at a time per machine) unless it already runs inside
// one. --check only says whether it would package (exit 0: the package is reused; 1: it would package). --force
// packages whatever the stamp says. The release workflow packages by itself and never reads the stamp.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPackageInput } from "./affected-specs.mjs";

export const STAMP = path.join("out", "lyre-test-build.json");
const E2E_BUILD = "1";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** forge's output folder for this system (forge.config.js packagerConfig.out, named after productName). */
export function packageFolder(root, platform = process.platform, arch = process.arch) {
  let productName = "Lyre";
  try {
    productName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).productName ?? productName;
  } catch {
    // no package.json (the tests): the default name
  }
  return path.join(root, "out", `${productName}-${platform}-${arch}`);
}

/** Where app.asar is inside a packaged app. */
export function asarPath(folder, platform = process.platform) {
  if (platform === "darwin") {
    const app = fs.existsSync(folder) ? fs.readdirSync(folder).find((name) => name.endsWith(".app")) : null;
    return path.join(folder, app ?? `${path.basename(folder).split("-")[0]}.app`, "Contents", "Resources", "app.asar");
  }
  return path.join(folder, "resources", "app.asar");
}

/** app.asar's size and modification time, or null when there is no package. */
export function fingerprint(file) {
  try {
    const stat = fs.statSync(file);
    return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  }
}

/** The commit checked out, and the uncommitted (changed, staged or new) files that go into the package. */
export function treeState(root) {
  const commit = git(["rev-parse", "HEAD"], root).trim();
  const entries = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"], root).split("\0").filter(Boolean);
  const dirtyFiles = entries.map((entry) => entry.slice(3)).filter(isPackageInput);
  return { commit, dirty: dirtyFiles.length > 0, dirtyFiles };
}

export function readStamp(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STAMP), "utf8"));
  } catch {
    return null;
  }
}

export function writeStamp(root, stamp) {
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  fs.writeFileSync(path.join(root, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
}

const short = (commit) => String(commit).slice(0, 7);

/** Whether the package in out/ can be used again, and why, in plain words. */
export function decide({ stamp, state, asar }) {
  if (!stamp) return { reuse: false, why: "no record of the last test package (out/lyre-test-build.json)" };
  if (!asar) return { reuse: false, why: "no package in out/" };
  if (stamp.e2eBuild !== E2E_BUILD) return { reuse: false, why: "the package in out/ is not a test build" };
  if (stamp.asar?.size !== asar.size || stamp.asar?.mtimeMs !== asar.mtimeMs) return { reuse: false, why: "the app was packaged again since the last test package (a plain yarn package?)" };
  if (stamp.dirty) return { reuse: false, why: "the last test package was made with uncommitted changes to the app's code" };
  if (state.dirty) return { reuse: false, why: `uncommitted changes to the app's code: ${state.dirtyFiles.slice(0, 5).join(", ")}${state.dirtyFiles.length > 5 ? ", …" : ""}` };
  if (stamp.commit !== state.commit) return { reuse: false, why: `the package in out/ was made from another commit (${short(stamp.commit)})` };
  return { reuse: true, why: `made from this commit (${short(state.commit)}) with nothing changed since` };
}

/** Runs a command with the screen's output; resolves its exit code. */
function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(`Could not start ${command}: ${error.message}`);
      resolve(127);
    });
  });
}

async function main(argv) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const check = argv.includes("--check");
  const force = argv.includes("--force");
  const unknown = argv.find((a) => !["--check", "--force"].includes(a));
  if (unknown) {
    console.error(`Unknown option ${unknown}. See the top of scripts/package-test.mjs.`);
    return 2;
  }
  const folder = packageFolder(root);
  const before = treeState(root);
  const decision = force ? { reuse: false, why: "--force" } : decide({ stamp: readStamp(root), state: before, asar: fingerprint(asarPath(folder)) });
  if (decision.reuse) {
    console.log(`package:test: using the test package in ${path.relative(root, folder)}: ${decision.why}.`);
    return 0;
  }
  console.log(`package:test: packaging, because ${decision.why}.`);
  if (check) return 1;

  // A package that fails half-way leaves no stamp claiming it is good.
  fs.rmSync(path.join(root, STAMP), { force: true });
  const env = { ...process.env, CUE_DESK_E2E_BUILD: E2E_BUILD };
  const code = process.env.LYRE_HEAVY_RUN
    ? await run("yarn", ["package"], env)
    : await run(process.execPath, [path.join(root, "scripts", "heavy-run.mjs"), "--log", path.join(os.tmpdir(), `package-test-${Date.now()}.log`), "--", "yarn", "package"], env);
  if (code !== 0) return code;

  // The tree is read again: a file changed while packaging may or may not be in the package, so it counts as dirty.
  const after = treeState(root);
  const dirty = before.dirty || after.dirty || before.commit !== after.commit;
  writeStamp(root, { commit: before.commit, dirty, e2eBuild: E2E_BUILD, asar: fingerprint(asarPath(folder)), builtAt: new Date().toISOString() });
  console.log(`package:test: test package made from ${short(before.commit)}${dirty ? " with uncommitted changes (it will be made again next time)" : ""}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => (process.exitCode = code));
}
