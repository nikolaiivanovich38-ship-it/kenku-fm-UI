// Tests for one test package per commit (scripts/package-test.mjs). Run with `yarn test:scripts`.
// The tree's state is read from small git repositories made in the temp folder.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { asarPath, decide, dirtyAfterPackaging, freshlyMade, packageFolder, packageInputsChangedSince, readStamp, STAMP, treeState, writeStamp } from "./package-test.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "package-test-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A repository with one commit holding a source file and a test file. */
function repository() {
  const dir = tmp();
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Test");
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "e2e"));
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "e2e", "a.spec.ts"), "// a test\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "out/\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

const built = { size: 10, mtimeMs: 1000 };
const stampFor = (commit, extra = {}) => ({ commit, dirty: false, e2eBuild: "1", asar: built, ...extra });

describe("the tree's state", () => {
  it("is the commit, and clean when nothing that goes into the package has changed", () => {
    const dir = repository();
    const state = treeState(dir);
    assert.equal(state.commit, git(dir, "rev-parse", "HEAD").trim());
    assert.equal(state.dirty, false);
  });

  it("is dirty with a changed, staged or new file of the app's code", () => {
    for (const change of [
      (dir) => fs.appendFileSync(path.join(dir, "src", "app.ts"), "export const b = 2;\n"),
      (dir) => {
        fs.appendFileSync(path.join(dir, "src", "app.ts"), "export const b = 2;\n");
        git(dir, "add", ".");
      },
      (dir) => fs.writeFileSync(path.join(dir, "src", "new.ts"), "export {};\n"),
    ]) {
      const dir = repository();
      change(dir);
      const state = treeState(dir);
      assert.equal(state.dirty, true);
      assert.ok(state.dirtyFiles.some((f) => f.startsWith("src/")), state.dirtyFiles.join(", "));
    }
  });

  it("stays clean when only tests, documents or ignored files changed (they are not in the package)", () => {
    const dir = repository();
    fs.appendFileSync(path.join(dir, "e2e", "a.spec.ts"), "// more\n");
    fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n");
    fs.mkdirSync(path.join(dir, "out"));
    fs.writeFileSync(path.join(dir, "out", "x"), "built\n");
    assert.equal(treeState(dir).dirty, false);
  });
});

describe("whether the package in out/ can be used again", () => {
  const state = { commit: "abc", dirty: false, dirtyFiles: [] };

  it("is reused when it was made from this commit, from a clean tree, as a test build, and is still the same files", () => {
    assert.deepEqual(decide({ stamp: stampFor("abc"), state, asar: built }), { reuse: true, why: "made from this commit (abc) with nothing changed since" });
  });

  it("is made again when there is no stamp, or no package", () => {
    assert.equal(decide({ stamp: null, state, asar: built }).reuse, false);
    assert.match(decide({ stamp: stampFor("abc"), state, asar: null }).why, /no package/);
  });

  it("is made again for another commit when what changed since is unknown or goes into the package", () => {
    assert.match(decide({ stamp: stampFor("old"), state, asar: built }).why, /another commit \(old\)/);
    assert.match(decide({ stamp: stampFor("old"), state, asar: built, changedSince: ["src/app.ts"] }).why, /changed since old: src\/app\.ts/);
  });

  it("is reused for a later commit whose changes leave the package's inputs alone (tests, documents, tooling)", () => {
    assert.deepEqual(decide({ stamp: stampFor("old"), state, asar: built, changedSince: [] }), {
      reuse: true,
      why: "made from old; the commits since change nothing that goes into the package",
    });
  });

  it("is made again when it or the tree had uncommitted changes to the app's code", () => {
    assert.match(decide({ stamp: stampFor("abc", { dirty: true }), state, asar: built }).why, /uncommitted/);
    assert.match(decide({ stamp: stampFor("abc"), state: { commit: "abc", dirty: true, dirtyFiles: ["src/a.ts"] }, asar: built }).why, /uncommitted.*src\/a\.ts/);
  });

  it("is made again when it is not a test build", () => {
    assert.match(decide({ stamp: stampFor("abc", { e2eBuild: "" }), state, asar: built }).why, /not a test build/);
  });

  it("is made again when something else packaged over it since (a plain yarn package)", () => {
    assert.match(decide({ stamp: stampFor("abc"), state, asar: { size: 10, mtimeMs: 2000 } }).why, /packaged again/);
  });
});

describe("what changed since the package's commit", () => {
  it("lists the files that go into the package, and is null for a commit git does not know", () => {
    const dir = repository();
    const first = git(dir, "rev-parse", "HEAD").trim();
    fs.appendFileSync(path.join(dir, "e2e", "a.spec.ts"), "// more\n");
    git(dir, "commit", "-q", "-am", "a test");
    assert.deepEqual(packageInputsChangedSince(dir, first), []);
    fs.appendFileSync(path.join(dir, "src", "app.ts"), "export const b = 2;\n");
    git(dir, "commit", "-q", "-am", "the app");
    assert.deepEqual(packageInputsChangedSince(dir, first), ["src/app.ts"]);
    assert.equal(packageInputsChangedSince(dir, "0".repeat(40)), null);
  });
});

describe("the dirty flag after packaging", () => {
  it("is clean when nothing that goes into the package changed while it was made, even if a commit of tests was made", () => {
    const dir = repository();
    const before = treeState(dir);
    assert.equal(dirtyAfterPackaging(dir, before), false);
    fs.appendFileSync(path.join(dir, "e2e", "a.spec.ts"), "// more\n");
    git(dir, "commit", "-q", "-am", "a test");
    assert.equal(dirtyAfterPackaging(dir, before), false);
  });

  it("is dirty when the app's code changed while it was made, committed or not, or was dirty before", () => {
    const dir = repository();
    const before = treeState(dir);
    fs.appendFileSync(path.join(dir, "src", "app.ts"), "export const b = 2;\n");
    assert.equal(dirtyAfterPackaging(dir, before), true);
    git(dir, "commit", "-q", "-am", "the app");
    assert.equal(dirtyAfterPackaging(dir, before), true);
    assert.equal(dirtyAfterPackaging(repository(), { commit: "x", dirty: true, dirtyFiles: ["src/a.ts"] }), true);
  });
});

describe("a package that was really made", () => {
  it("has an app.asar written since packaging started; a run that ended early (exit 0, nothing written) has not", () => {
    const started = 1_000_000;
    assert.equal(freshlyMade({ size: 10, mtimeMs: started + 5_000 }, started), true);
    assert.equal(freshlyMade({ size: 10, mtimeMs: started - 60_000 }, started), false);
    assert.equal(freshlyMade(null, started), false);
  });
});

describe("where the package and its stamp are", () => {
  it("finds forge's folder and app.asar for each system", () => {
    assert.equal(packageFolder("/r", "linux", "x64"), path.join("/r", "out", "Lyre-linux-x64"));
    assert.equal(asarPath(path.join("/r", "out", "Lyre-win32-x64"), "win32"), path.join("/r", "out", "Lyre-win32-x64", "resources", "app.asar"));
    assert.equal(asarPath(path.join("/r", "out", "Lyre-darwin-arm64"), "darwin"), path.join("/r", "out", "Lyre-darwin-arm64", "Lyre.app", "Contents", "Resources", "app.asar"));
  });

  it("keeps the stamp in out/ and reads back what it wrote", () => {
    const dir = tmp();
    assert.equal(readStamp(dir), null);
    writeStamp(dir, stampFor("abc"));
    assert.ok(fs.existsSync(path.join(dir, STAMP)));
    assert.deepEqual(readStamp(dir), stampFor("abc"));
  });
});
