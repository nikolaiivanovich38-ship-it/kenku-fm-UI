// Tests for the affected-spec picker (scripts/affected-specs.mjs). Run with `yarn test:scripts`.
// Most tests read this repository as it is (its screens, specs and imports), so they show what `yarn affected` says
// for real changes; the last block checks that every file the rules name still exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { commands, isPackageInput, loadRepo, MAIN_AREAS, pick, SCREEN_E2E } from "./affected-specs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = loadRepo(root);
const spec = (name) => `e2e/specs/${name}.spec.ts`;
const e2e = (name) => `e2e/${name}.spec.ts`;

describe("what the repository tells the picker", () => {
  it("knows each screen folder's spec files from the routes it serves (screens/index.tsx and target.ts)", () => {
    assert.deepEqual(repo.specsOfFolder.get("live"), ["live"]);
    assert.deepEqual(repo.specsOfFolder.get("boards"), ["pad-boards"]);
    assert.deepEqual(repo.specsOfFolder.get("profile"), ["audio-profile"]);
    assert.deepEqual(repo.specsOfFolder.get("transfer"), ["library-files"]);
    assert.deepEqual(repo.specsOfFolder.get("tags"), ["tags"]);
    assert.deepEqual([...repo.specsOfFolder.get("campaigns")].sort(), ["campaigns", "session-planner"]);
    assert.deepEqual([...repo.specsOfFolder.get("library")].sort(), ["library", "playlists"]);
  });

  it("knows the sweep screens of each spec (sweeps.spec.ts names and owners)", () => {
    assert.deepEqual(repo.sweepScreens.get("pad-boards"), ["Pad boards", "A pad board"]);
    assert.ok(repo.sweepScreens.get("live").includes("Live, standby"));
  });

  it("knows which end-to-end files open the Lyre page (they import fixtures/lyre.ts)", () => {
    for (const name of ["lyre", "lyreLibrary", "onAir", "padIcons"]) assert.ok(repo.lyreE2e.includes(e2e(name)), name);
    assert.ok(!repo.lyreE2e.includes(e2e("tabs")));
  });
});

describe("picking specs for changed files", () => {
  it("a change inside one screen's folder runs that screen's specs and its sweeps, in the app only", () => {
    const picked = pick(["src/lyre/screens/look/LookScreen.tsx"], repo);
    assert.equal(picked.everything, null);
    assert.deepEqual(picked.app.files, [spec("look")]);
    assert.deepEqual(picked.app.sweepScreens, ["Look and feel"]);
    assert.equal(picked.prototype.all, false);
    assert.deepEqual(picked.prototype.files, []);
    assert.deepEqual(picked.e2e.files, [e2e("lyre")]);
    assert.equal(picked.package.needed, true);
    assert.equal(picked.package.inputsChanged, true);
  });

  it("follows imports between screens: a file another screen imports runs that screen's specs too", () => {
    // steps/ is a shared dialog with no route of its own; the screens that import it decide.
    const picked = pick(["src/lyre/screens/steps/StepsDialog.tsx"], repo);
    assert.equal(picked.everything, null);
    assert.equal(picked.app.all, false);
    for (const name of ["pad-boards", "live"]) assert.ok(picked.app.files.includes(spec(name)), name);
    assert.ok(!picked.app.files.includes(spec("look")));
  });

  it("the shell, or anything the shell imports, runs every app spec", () => {
    for (const file of ["src/lyre/shell/Shell.tsx", "src/lyre/kit/Expander.tsx", "src/lyre/api/index.ts"]) {
      const picked = pick([file], repo);
      assert.equal(picked.app.all, true, file);
      assert.equal(picked.prototype.all, false, file);
      assert.deepEqual(picked.e2e.files, repo.lyreE2e, file);
    }
  });

  it("the playback engine runs the app specs whose screens use it, and the engine's own end-to-end tests", () => {
    const picked = pick(["src/engine/engine.ts"], repo);
    assert.equal(picked.everything, null);
    assert.equal(picked.app.all, true, "the Lyre page's audio (src/lyre/audio) imports the engine");
    for (const name of ["broadcast", "onAir"]) assert.ok(picked.e2e.files.includes(e2e(name)), name);
  });

  it("a main-process area runs the specs and end-to-end tests that use it", () => {
    const picked = pick(["src/main/remote/remoteServer.ts"], repo);
    assert.equal(picked.everything, null);
    assert.deepEqual(picked.app.files, [spec("settings")]);
    assert.deepEqual(picked.e2e.files, [e2e("upgrade")], "the Settings screen's end-to-end file");
  });

  it("runs everything when in doubt: an unknown file, a main-process file outside the known areas, the specs' support, configs", () => {
    for (const file of [
      "src/index.ts",
      "src/main/security/ipcGuard.ts",
      "src/common/lyre/api.ts",
      "e2e/specs/support/target.ts",
      "playwright.spec.config.ts",
      "e2e/playwright.config.ts",
      "package.json",
      "yarn.lock",
      "forge.config.js",
      "webpack.renderer.config.js",
      "something/new.txt",
    ]) {
      const picked = pick([file], repo);
      assert.ok(picked.everything, file);
      assert.equal(picked.app.all && picked.prototype.all && picked.e2e.all, true, file);
    }
  });

  it("a changed spec file runs in both projects; a changed end-to-end file runs by itself", () => {
    const picked = pick([spec("tags"), e2e("broadcast")], repo);
    assert.deepEqual(picked.app.files, [spec("tags")]);
    assert.deepEqual(picked.prototype.files, [spec("tags")]);
    assert.deepEqual(picked.e2e.files, [e2e("broadcast")]);
    assert.equal(picked.package.needed, true);
    assert.equal(picked.package.inputsChanged, false, "a test file is not in the package");
  });

  it("the prototype runs every spec in the prototype project, and needs no package", () => {
    const picked = pick(["design/prototype/lyre-prototype.html"], repo);
    assert.equal(picked.prototype.all, true);
    assert.equal(picked.app.all, false);
    assert.deepEqual(picked.app.files, []);
    assert.equal(picked.package.needed, false);
  });

  it("an end-to-end fixture runs the files that import it, and every app spec when the specs' support imports it", () => {
    const discord = pick(["e2e/fixtures/discord.ts"], repo);
    assert.equal(discord.app.all, false);
    assert.ok(discord.e2e.files.includes(e2e("broadcast")));
    assert.ok(!discord.e2e.files.includes(e2e("padIcons")));
    const lyre = pick(["e2e/fixtures/lyre.ts"], repo);
    assert.equal(lyre.app.all, true, "e2e/specs/support/target.ts imports fixtures/lyre.ts");
  });

  it("documents, unit tests, workflows and the scripts' own files run nothing", () => {
    const picked = pick(["docs/testing.md", "src/lyre/screens/live/liveModel.test.ts", ".github/workflows/specs.yml", "scripts/heavy-run.mjs", "CHANGELOG.md", "e2e/specs/BUILD-LIST.md"], repo);
    assert.equal(picked.everything, null);
    assert.deepEqual([picked.app.files, picked.prototype.files, picked.e2e.files], [[], [], []]);
    assert.equal(picked.package.needed, false);
  });

  it("says why each file chose what it did", () => {
    const picked = pick(["src/lyre/screens/look/LookScreen.tsx", "docs/testing.md"], repo);
    assert.deepEqual(
      picked.why.map((w) => w.file),
      ["src/lyre/screens/look/LookScreen.tsx", "docs/testing.md"],
    );
    assert.match(picked.why[1].chose, /nothing/);
  });
});

describe("what goes into the package", () => {
  it("is the app's code (help articles included) and the build's configuration, not tests, documents or the prototype", () => {
    for (const file of ["src/lyre/shell/Shell.tsx", "src/main/startup.ts", "package.json", "yarn.lock", "forge.config.js", "webpack.rules.js", "scripts/forge-options.cjs", "NOTICE", "src/lyre/help/articles/10-live.md"]) {
      assert.equal(isPackageInput(file), true, file);
    }
    for (const file of ["src/main/startup.test.ts", "src/test/setupUi.ts", "e2e/broadcast.spec.ts", "docs/testing.md", "design/prototype/lyre-prototype.html", "scripts/heavy-run.mjs"]) {
      assert.equal(isPackageInput(file), false, file);
    }
  });
});

describe("commands to run", () => {
  it("packages only when needed, and runs the picked files through heavy-run", () => {
    const lines = commands(pick(["src/lyre/screens/look/LookScreen.tsx"], repo), { platform: "linux" });
    assert.equal(lines[0], "yarn package:test");
    assert.ok(lines.some((l) => /^yarn heavy --log app-specs\.log xvfb-run -a npx playwright test -c playwright\.spec\.config\.ts --project=app e2e\/specs\/look\.spec\.ts$/.test(l)), lines.join("\n"));
    assert.ok(lines.some((l) => l.includes('--project=app e2e/specs/sweeps.spec.ts --grep "(?:^| )(?:Look and feel)(?: at |: )"')), lines.join("\n"));
    assert.ok(lines.some((l) => l === "yarn heavy --log e2e.log xvfb-run -a yarn e2e lyre.spec.ts"), lines.join("\n"));
  });

  it("leaves xvfb-run out on Windows and macOS", () => {
    const lines = commands(pick([e2e("broadcast")], repo), { platform: "win32" });
    assert.ok(lines.includes("yarn heavy --log e2e.log yarn e2e broadcast.spec.ts"), lines.join("\n"));
  });

  it("names the whole app project, and suggests a GitHub run for it", () => {
    const lines = commands(pick(["package.json"], repo), { platform: "linux" });
    assert.ok(lines.some((l) => /--project=app$/.test(l)));
    assert.ok(lines.some((l) => /ci\//.test(l)), "suggests a push to a ci/ branch");
  });

  it("says when there is nothing to run", () => {
    assert.deepEqual(commands(pick(["docs/testing.md"], repo), { platform: "linux" }), []);
  });
});

describe("the rules stay true to the repository", () => {
  const exists = (file) => fs.existsSync(path.join(root, file));

  it("every end-to-end file and spec the rules name exists (update scripts/affected-specs.mjs when one is renamed or deleted)", () => {
    const named = [
      ...Object.values(SCREEN_E2E).flat().map(e2e),
      ...MAIN_AREAS.flatMap((area) => [...area.e2e.map(e2e), ...(area.app === "all" || area.app === "graph" ? [] : area.app.map(spec))]),
    ];
    const missing = [...new Set(named)].filter((file) => !exists(file));
    assert.deepEqual(missing, []);
  });

  it("every screen folder serves at least one spec, or is imported by screens that do", () => {
    for (const folder of fs.readdirSync(path.join(root, "src/lyre/screens"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = fs.readdirSync(path.join(root, "src/lyre/screens", folder.name)).find((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
      const picked = pick([`src/lyre/screens/${folder.name}/${file}`], repo);
      assert.ok(picked.app.all || picked.app.files.length > 0, folder.name);
    }
  });
});
