// SEC-1: Lyre stays on a standard, supported Electron, and nothing points back at Kenku FM's Electron 37 (the
// castlabs build with Widevine). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * The oldest Electron major still receiving security fixes (Electron supports its three newest majors; 45 is the
 * newest in November 2026). The monthly step in docs/RELEASE_CHECKLIST.md raises it.
 */
const OLDEST_SUPPORTED_MAJOR = 43;

/** Folders that are not Lyre's own text: libraries, builds, history and test fixtures recording old audits. */
const SKIPPED = new Set(["node_modules", ".git", ".webpack", "out", "coverage", "test-results", "playwright-report", "fixtures"]);
const TEXT = /\.(m?[jt]sx?|cjs|json|ya?ml|md|html|css|sh|txt)$/;
/** CHANGELOG.md tells the story of the move off Electron 37, so it may name it; this file names what it looks for. */
const HISTORY = new Set(["CHANGELOG.md", "scripts/electron-support.test.mjs"]);

function textFiles(folder = root, found = []) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) textFiles(full, found);
    else if (TEXT.test(entry.name) && !HISTORY.has(path.relative(root, full))) found.push(full);
  }
  return found;
}

describe("Electron version (SEC-1)", () => {
  const pkg = JSON.parse(read("package.json"));
  const version = pkg.devDependencies.electron;

  it("is pinned to one exact standard release, not a range or the castlabs build", () => {
    assert.match(version, /^\d+\.\d+\.\d+$/, `electron is "${version}"`);
  });

  it("is a supported major", () => {
    assert.ok(Number(version.split(".")[0]) >= OLDEST_SUPPORTED_MAJOR, `Electron ${version} no longer gets security fixes`);
  });

  it("comes from the npm registry in yarn.lock, at the same version", () => {
    const entry = /^electron@[^\n]*:\n {2}version "([^"]+)"\n {2}resolved "([^"]+)"/m.exec(read("yarn.lock"));
    assert.ok(entry, "no electron entry in yarn.lock");
    assert.equal(entry[1], version);
    assert.match(entry[2], /^https:\/\/registry\.(yarnpkg\.com|npmjs\.org)\/electron\/-\/electron-/);
  });

  it("matches the Chromium the documents name", () => {
    const architecture = read("docs/ARCHITECTURE.md");
    assert.match(architecture, new RegExp(`Electron ${version.split(".")[0]}\\b`));
  });
});

describe("nothing ties Lyre to Electron 37 or the castlabs build (SEC-1)", () => {
  it("no document, workflow, script or source file names them", () => {
    const ties = /castlabs|\+wvcus|electron-releases\/|\bElectron 37\b|electron@37|"37\.\d+\.\d+/i;
    const offenders = textFiles()
      .filter((file) => ties.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    assert.deepEqual(offenders, []);
  });

  it("the release checklist has the monthly Electron update step", () => {
    const checklist = read("docs/RELEASE_CHECKLIST.md");
    assert.match(checklist, /Electron update \(monthly/);
    assert.match(checklist, /releases\.electronjs\.org/);
  });
});
