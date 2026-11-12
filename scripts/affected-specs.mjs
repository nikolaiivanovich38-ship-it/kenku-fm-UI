#!/usr/bin/env node
// Which acceptance specs and end-to-end tests a change needs, and whether they need the test package.
//
//   node scripts/affected-specs.mjs [--base <ref>] [--range <a..b>] [--json] [--why] [file …]     (or: yarn affected …)
//
// With no files and no --range, the change is everything since the merge base with --base (default b7, the
// integration branch of 0.5.1), uncommitted and new files included. --range takes any range `git diff` takes.
// Prints the spec files for each Playwright project, the end-to-end files, whether a package is needed, and the
// commands to run them (through `yarn heavy`, after `yarn package:test`). --json prints the same as JSON; --why
// prints what each changed file chose.
//
// The rules, in order (first match wins for each file):
//   - documents (outside src/), unit tests, workflows and the scripts' own files: nothing;
//   - the specs' support, the Playwright, webpack, forge and TypeScript configs, package.json, yarn.lock: everything;
//   - a spec file: that file in both projects; an end-to-end file: that file; design/prototype: the prototype project;
//   - an end-to-end fixture: the end-to-end files that import it, and every app spec when the specs' support does;
//   - src/lyre (and whatever it imports from src/player/engine): the screens whose folders import the file, through
//     any chain of imports, run their specs (screens/index.tsx's routes, named by target.ts's screenOfRoute) and their
//     sweeps; a file the shell, kit, api or any other shared part imports runs every app spec;
//   - the main-process areas in MAIN_AREAS: their specs and end-to-end files;
//   - anything else: everything ("when in doubt, run everything").
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The branch 0.5.1's streams start from. Change it with --base for the next release. */
export const DEFAULT_BASE = "b7";

const SPEC_DIR = "e2e/specs";
const specFile = (name) => `${SPEC_DIR}/${name}.spec.ts`;
const e2eFile = (name) => `e2e/${name}.spec.ts`;
const SWEEPS = specFile("sweeps");
const LYRE_ROUTER = "src/lyre/screens/index.tsx";

/** End-to-end files that open a screen by its route (openLyreRoute), by the spec that screen belongs to. */
export const SCREEN_E2E = {
  campaigns: ["lyre"],
  "session-planner": ["onAir"],
  playlists: ["onAir"],
  "pad-boards": ["padIcons"],
  "audio-profile": ["lyre"],
  look: ["lyre"],
  settings: ["remote"],
};

/**
 * Main-process (and player) areas: the app specs that use them ("all", a list of spec names, or "graph": the screens
 * that import the file decide) and the end-to-end files that do. "lyre" in e2e stands for every end-to-end file that
 * opens the Lyre page. Any other file under src/main is "when in doubt".
 */
export const MAIN_AREAS = [
  { prefix: "src/main/broadcast/", app: ["outputs", "live", "settings"], e2e: ["broadcast", "outputs", "rooms", "capture", "onAir"] },
  { prefix: "src/audioCapture/", app: ["outputs", "live"], e2e: ["broadcast", "outputs", "rooms", "capture", "onAir"] },
  { prefix: "src/main/remote/", app: ["settings"], e2e: ["remote", "settings"] },
  { prefix: "src/main/migration/", app: [], e2e: ["carryOver", "lyreLibrary", "persistence"] },
  { prefix: "src/main/transfer/", app: ["library-files"], e2e: ["lyreLibrary"] },
  { prefix: "src/main/diagnostics/", app: ["help"], e2e: [] },
  { prefix: "src/main/globalKeys.ts", app: ["live", "settings"], e2e: [] },
  { prefix: "src/main/media/", app: "all", e2e: ["lyreMedia", "mediaProtocol", "onAir", "lyreLibrary"] },
  { prefix: "src/main/data/", app: "all", e2e: ["carryOver"], lyreE2e: true },
  { prefix: "src/main/lyreApi/", app: "all", e2e: ["carryOver"], lyreE2e: true },
  { prefix: "src/player/engine/", app: "graph", e2e: ["engine", "rooms", "onAir"] },
];

/** Changes that need every spec and every end-to-end test. */
const EVERYTHING = [
  /^e2e\/specs\/support\//,
  /^playwright\.spec\.config\.ts$/,
  /^e2e\/playwright\.config\.ts$/,
  /^e2e\/tsconfig\.json$/,
  /^package\.json$/,
  /^yarn\.lock$/,
  /^forge\.config\.js$/,
  /^webpack\.[a-z.]+\.js$/,
  /^tsconfig\.json$/,
  /^scripts\/(forge-options|ffmpeg-builds|third-party-licences)\.cjs$/,
];

/** Changes no spec or end-to-end test can see. */
const NOTHING = [
  /^(?!src\/).*\.md$/,
  /\.test\.(ts|tsx|mjs|js)$/,
  /^src\/test\//,
  /^docs\//,
  /^\.github\//,
  /^publish\//,
  /^design\/(?!prototype\/)/,
  /^scripts\/(?!demo-kit\/|forge-options|ffmpeg-builds|third-party-licences)/,
  /^(LICENSE|NOTICE|CHANGELOG\.md|README\.md|\.gitignore|\.gitattributes|eslint\.config\.mjs|vitest\.config\.mts|entitlements\.plist)$/,
];

/** What `electron-forge package` reads: a change here means the test package must be made again. */
export function isPackageInput(file) {
  if (/^src\//.test(file)) return !/\.test\.(ts|tsx|mjs|js)$/.test(file) && !/^src\/test\//.test(file);
  return /^(package\.json|yarn\.lock|forge\.config\.js|webpack\.[a-z.]+\.js|tsconfig\.json|NOTICE|LICENSE|entitlements\.plist|scripts\/(forge-options|ffmpeg-builds|third-party-licences)\.cjs)$/.test(file);
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the repository

const CODE = /\.(ts|tsx|js|mjs|cjs)$/;
const RESOLVE = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

function walk(root, dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(root, rel, out);
    } else out.push(rel);
  }
  return out;
}

/** The relative imports of a file (static, re-exports, side-effect, dynamic and require), resolved to repo paths. */
function importsOf(root, file, known) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const found = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["'](\.[^"'?]*)(?:\?[^"']*)?["']/g;
  for (const match of text.matchAll(pattern)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    const resolved = RESOLVE.map((ext) => base + ext).find((candidate) => known.has(candidate));
    if (resolved) found.push(resolved);
  }
  return found;
}

/** Who imports each file, for every code file under `dirs`. */
function importersMap(root, dirs) {
  const files = dirs.flatMap((dir) => (fs.existsSync(path.join(root, dir)) ? walk(root, dir) : []));
  const known = new Set(files);
  const importers = new Map();
  for (const file of files.filter((f) => CODE.test(f))) {
    for (const imported of importsOf(root, file, known)) {
      if (!importers.has(imported)) importers.set(imported, new Set());
      importers.get(imported).add(file);
    }
  }
  return importers;
}

/** The file and everything that imports it, directly or through others; `stop` files are not followed. */
function reach(file, importers, stop = new Set()) {
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length) {
    for (const importer of importers.get(queue.shift()) ?? []) {
      if (seen.has(importer) || stop.has(importer) || /\.test\./.test(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return seen;
}

/** Each screen folder's spec names: the routes screens/index.tsx gives its components, named as target.ts does. */
function specsOfFolders(root) {
  const router = fs.readFileSync(path.join(root, LYRE_ROUTER), "utf8");
  const folderOf = new Map();
  for (const [, names, from] of router.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([a-z]+)[^"]*"/g)) {
    for (const name of names.split(",").map((n) => n.trim()).filter(Boolean)) folderOf.set(name, from);
  }
  const target = fs.readFileSync(path.join(root, SPEC_DIR, "support/target.ts"), "utf8");
  const body = /function screenOfRoute[\s\S]*?\{([\s\S]*?)\n\s*\};/.exec(target)?.[1] ?? "";
  const screenOf = new Map([...body.matchAll(/(\w+):\s*"([\w-]+)"/g)].map(([, route, screen]) => [route, screen]));
  const table = /SCREENS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(router)?.[1] ?? "";
  const specs = new Map();
  for (const [, route, component] of table.matchAll(/^\s*(\w+):\s*(\w+),/gm)) {
    const folder = folderOf.get(component);
    if (!folder) continue;
    const screen = screenOf.get(route) ?? route;
    if (!specs.has(folder)) specs.set(folder, []);
    if (!specs.get(folder).includes(screen)) specs.get(folder).push(screen);
  }
  return specs;
}

/** The sweep screens' names by the spec that owns them (sweeps.spec.ts's screen list). */
function sweepScreensOf(root) {
  const text = fs.readFileSync(path.join(root, SWEEPS), "utf8");
  const screens = new Map();
  for (const [, name, owner] of text.matchAll(/name:\s*"([^"]+)",\s*owner:\s*"([\w-]+)"/g)) {
    if (!screens.has(owner)) screens.set(owner, []);
    screens.get(owner).push(name);
  }
  return screens;
}

/** Everything the rules need to know about the repository at `root`. */
export function loadRepo(root) {
  const e2eImporters = importersMap(root, ["e2e"]);
  const specs = fs.readdirSync(path.join(root, SPEC_DIR)).filter((f) => f.endsWith(".spec.ts")).map((f) => `${SPEC_DIR}/${f}`).sort();
  const e2e = fs.readdirSync(path.join(root, "e2e")).filter((f) => f.endsWith(".spec.ts")).map((f) => `e2e/${f}`).sort();
  const lyreE2e = [...reach("e2e/fixtures/lyre.ts", e2eImporters)].filter((f) => e2e.includes(f)).sort();
  return {
    root,
    specs,
    e2e,
    lyreE2e,
    e2eImporters,
    srcImporters: importersMap(root, ["src"]),
    specsOfFolder: specsOfFolders(root),
    sweepScreens: sweepScreensOf(root),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Picking

function emptySelection() {
  return { app: { all: false, files: new Set(), sweepOwners: new Set() }, prototype: { all: false, files: new Set() }, e2e: { all: false, files: new Set() } };
}

/** What one Lyre-side file needs: every app spec when a shared part imports it, else its screens' specs. */
function lyreSide(file, repo) {
  const reached = [...reach(file, repo.srcImporters, new Set([LYRE_ROUTER]))].filter((f) => f.startsWith("src/lyre/"));
  if (reached.length === 0) return null;
  const folders = new Set();
  for (const f of reached) {
    const folder = /^src\/lyre\/screens\/([a-z]+)\//.exec(f)?.[1];
    if (!folder) return { all: true, why: `${f === file ? "a shared part of the Lyre page" : `imported by ${f}, a shared part of the Lyre page`}: every app spec` };
    folders.add(folder);
  }
  const screens = [...new Set([...folders].flatMap((folder) => repo.specsOfFolder.get(folder) ?? []))];
  if (screens.length === 0) return { all: true, why: `screen folders with no route of their own (${[...folders].join(", ")}): every app spec` };
  return { screens, why: `the ${screens.join(", ")} screen${screens.length > 1 ? "s" : ""}` };
}

/** Adds one file's needs to the selection; returns why, in a few words. */
function addFile(file, repo, sel) {
  const everything = (why) => {
    sel.app.all = sel.prototype.all = sel.e2e.all = true;
    sel.everything ??= `${file}: ${why}`;
    return `everything (${why})`;
  };
  const appScreens = (screens) => {
    for (const screen of screens) {
      sel.app.files.add(specFile(screen));
      sel.app.sweepOwners.add(screen);
      for (const name of SCREEN_E2E[screen] ?? []) sel.e2e.files.add(e2eFile(name));
    }
  };
  const allApp = () => {
    sel.app.all = true;
    for (const f of repo.lyreE2e) sel.e2e.files.add(f);
  };

  if (EVERYTHING.some((rule) => rule.test(file))) return everything("a configuration or support file every test uses");
  if (NOTHING.some((rule) => rule.test(file))) return "nothing (no spec or end-to-end test can see it)";

  if (file.startsWith(`${SPEC_DIR}/`) && file.endsWith(".spec.ts")) {
    sel.app.files.add(file);
    sel.prototype.files.add(file);
    if (file === SWEEPS) sel.app.sweepOwners.add("*");
    return "itself, in both projects";
  }
  if (file.startsWith(`${SPEC_DIR}/`) && !file.endsWith(".ts")) return "nothing (not a test file)";
  if (/^e2e\/[^/]+\.spec\.ts$/.test(file)) {
    sel.e2e.files.add(file);
    return "itself";
  }
  if (file.startsWith("e2e/fixtures/")) {
    const reached = reach(file, repo.e2eImporters);
    const files = [...reached].filter((f) => /^e2e\/[^/]+\.spec\.ts$/.test(f));
    for (const f of files) sel.e2e.files.add(f);
    if ([...reached].some((f) => f.startsWith(`${SPEC_DIR}/support/`))) {
      sel.app.all = true;
      return `the end-to-end files that import it, and every app spec (the specs' support imports it)`;
    }
    return `the end-to-end files that import it (${files.length})`;
  }
  if (file.startsWith("design/prototype/")) {
    sel.prototype.all = true;
    return "every spec in the prototype project";
  }
  if (file.startsWith("scripts/demo-kit/")) {
    sel.e2e.files.add(e2eFile("demoKit"));
    return "the demo kit's end-to-end test";
  }

  const area = MAIN_AREAS.find((a) => file.startsWith(a.prefix));
  if (area) {
    for (const name of area.e2e) sel.e2e.files.add(e2eFile(name));
    if (area.lyreE2e) for (const f of repo.lyreE2e) sel.e2e.files.add(f);
    if (area.app === "all") {
      allApp();
      return `every app spec and ${area.prefix}'s end-to-end tests`;
    }
    if (area.app === "graph") {
      const side = lyreSide(file, repo);
      if (side?.all) allApp();
      else if (side) appScreens(side.screens);
      return `${side ? side.why : "no app spec"}, and ${area.prefix}'s end-to-end tests`;
    }
    appScreens(area.app);
    return area.app.length ? `the ${area.app.join(", ")} specs and ${area.prefix}'s end-to-end tests` : `${area.prefix}'s end-to-end tests`;
  }

  if (file.startsWith("src/lyre/")) {
    const side = lyreSide(file, repo) ?? { all: true, why: "a part of the Lyre page: every app spec" };
    if (side.all) allApp();
    else appScreens(side.screens);
    return side.why;
  }
  if (file.startsWith("src/player/")) {
    // The old player: its end-to-end tests, and the app specs only if the Lyre page imports the file.
    sel.e2e.all = true;
    const side = lyreSide(file, repo);
    if (side?.all) allApp();
    else if (side) appScreens(side.screens);
    return `every end-to-end test (the old player)${side ? `, and ${side.why}` : ""}`;
  }
  return everything("not covered by a narrower rule");
}

const sorted = (set) => [...set].sort();

/**
 * The specs, end-to-end tests and package a list of changed files needs. Files the rules name that no longer exist
 * (a spec deleted in the same change) are left out.
 */
export function pick(files, repo) {
  const sel = emptySelection();
  sel.everything = null;
  const why = files.map((file) => ({ file, chose: addFile(file, repo, sel) }));
  const existing = (list, all) => sorted(list).filter((f) => all.includes(f));
  const appAll = sel.app.all;
  const appFiles = appAll ? [] : existing(sel.app.files, repo.specs).filter((f) => f !== SWEEPS);
  const wholeSweeps = appAll || sel.app.sweepOwners.has("*");
  const sweepScreens = wholeSweeps ? [] : [...sel.app.sweepOwners].flatMap((owner) => repo.sweepScreens.get(owner) ?? []);
  if (wholeSweeps && !appAll) appFiles.push(SWEEPS);
  const e2eFiles = sel.e2e.all ? [] : existing(sel.e2e.files, repo.e2e);
  const needsApp = appAll || appFiles.length > 0 || sweepScreens.length > 0;
  const needsE2e = sel.e2e.all || e2eFiles.length > 0;
  return {
    everything: sel.everything,
    app: { all: appAll, files: appFiles, sweepScreens },
    prototype: { all: sel.prototype.all, files: sel.prototype.all ? [] : existing(sel.prototype.files, repo.specs) },
    e2e: { all: sel.e2e.all, files: e2eFiles },
    package: { needed: needsApp || needsE2e, inputsChanged: files.some(isPackageInput) },
    why,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Commands and the command line

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The commands that run a pick, one per line: the package, then each project, each through heavy-run. */
export function commands(picked, { platform = process.platform } = {}) {
  const xvfb = platform === "linux" ? "xvfb-run -a " : "";
  const specs = "npx playwright test -c playwright.spec.config.ts";
  const lines = [];
  if (picked.package.needed) lines.push("yarn package:test");
  if (picked.app.all) {
    lines.push("# The whole app project takes about 95 minutes on a 2-core machine; GitHub runs it in about 15 (push to a ci/ branch, docs/testing.md > Specs > On GitHub).");
    lines.push(`yarn heavy --log app-specs.log ${xvfb}${specs} --project=app`);
  } else {
    if (picked.app.files.length) lines.push(`yarn heavy --log app-specs.log ${xvfb}${specs} --project=app ${picked.app.files.join(" ")}`);
    if (picked.app.sweepScreens.length) {
      const grep = `(?:^| )(?:${picked.app.sweepScreens.map(escapeRegExp).join("|")})(?: at |: )`;
      lines.push(`yarn heavy --log app-sweeps.log ${xvfb}${specs} --project=app ${SWEEPS} --grep "${grep}"`);
    }
  }
  if (picked.prototype.all) lines.push(`yarn heavy --log prototype-specs.log ${specs} --project=prototype`);
  else if (picked.prototype.files.length) lines.push(`yarn heavy --log prototype-specs.log ${specs} --project=prototype ${picked.prototype.files.join(" ")}`);
  if (picked.e2e.all) lines.push(`yarn heavy --log e2e.log ${xvfb}yarn e2e`);
  else if (picked.e2e.files.length) lines.push(`yarn heavy --log e2e.log ${xvfb}yarn e2e ${picked.e2e.files.map((f) => path.posix.basename(f)).join(" ")}`);
  return lines;
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** The changed files: of a range, or since the merge base with `base`, uncommitted and new files included. */
export function changedFiles({ cwd, base = DEFAULT_BASE, range = null }) {
  if (range) return lines(git(["diff", "--name-only", "--no-renames", range], cwd));
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  } catch {
    throw new Error(`No branch or commit called "${base}" here. Give another with --base <ref>, or a --range.`);
  }
  const changed = lines(git(["diff", "--name-only", "--no-renames", mergeBase], cwd));
  const added = lines(git(["ls-files", "--others", "--exclude-standard"], cwd));
  return [...new Set([...changed, ...added])].sort();
}

export function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, range: null, json: false, why: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (option === "--base") args.base = argv[++i];
    else if (option === "--range") args.range = argv[++i];
    else if (option === "--json") args.json = true;
    else if (option === "--why") args.why = true;
    else if (option.startsWith("--")) throw new Error(`Unknown option ${option}. See the top of scripts/affected-specs.mjs.`);
    else args.files.push(option.replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return args;
}

function describe(picked, files, source) {
  const out = [`${files.length} changed file${files.length === 1 ? "" : "s"} (${source}).`, ""];
  const list = (label, all, chosen, allWords) => {
    if (all) out.push(`${label}: ${allWords}`);
    else if (chosen.length) out.push(`${label}:`, ...chosen.map((f) => `  ${f}`));
    else out.push(`${label}: none`);
  };
  if (picked.everything) out.push(`Everything: ${picked.everything}.`, "");
  list("App specs", picked.app.all, picked.app.files, "all of them");
  if (picked.app.sweepScreens.length) out.push(`  e2e/specs/sweeps.spec.ts, only for: ${picked.app.sweepScreens.join("; ")}`);
  list("Prototype specs", picked.prototype.all, picked.prototype.files, "all of them");
  list("End-to-end tests", picked.e2e.all, picked.e2e.files, "all of them");
  out.push(
    "",
    picked.package.needed
      ? `Package: needed${picked.package.inputsChanged ? " (the change is in the app's code, so a package made before it is out of date)" : " (the app's code did not change; yarn package:test reuses a package of this commit)"}.`
      : "Package: not needed.",
  );
  const run = commands(picked);
  out.push("", run.length ? "Run:" : "Nothing to run.", ...run.map((l) => `  ${l}`));
  return out.join("\n");
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  let files;
  let source;
  try {
    files = args.files.length ? args.files : changedFiles({ cwd: root, base: args.base, range: args.range });
    source = args.files.length ? "as given" : args.range ? args.range : `since the merge base with ${args.base}, uncommitted ones included`;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const picked = pick(files, loadRepo(root));
  if (args.json) console.log(JSON.stringify({ files, ...picked, commands: commands(picked) }, null, 2));
  else {
    console.log(describe(picked, files, source));
    if (args.why) console.log(["", "Why:", ...picked.why.map((w) => `  ${w.file}: ${w.chose}`)].join("\n"));
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
