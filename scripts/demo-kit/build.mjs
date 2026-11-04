// Lyre demo kit: music, ambience, effects and a small local web page, all
// made by this script, so the product owner can try every feature of a
// release without his own library. Node.js only: no libraries, no network.
// The same Node.js version always builds a byte-identical kit.
//
//   node scripts/demo-kit/build.mjs              # writes out/demo-kit/Lyre-demo-kit/ and out/make/Lyre-<version>-demo-kit.zip
//   node scripts/demo-kit/build.mjs --out <dir>  # the same under <dir> instead of out/
//
// See docs/DEVELOPING.md > Demo kit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav, master } from "./audio.mjs";
import { heroicSting, melancholyDrift, tavernWarmth, tenseCrossing } from "./music.mjs";
import { coinPouch, doorKnock, hearthFire, magicChime, rainAndWind, swordClash, thunder } from "./sounds.mjs";
import { createZip } from "./zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");

export const KIT_FOLDER = "Lyre-demo-kit";

/** Loudness each kind of sound is mastered to (LUFS); peaks stay under -1.5 dBFS. */
export const TARGET_LUFS = { music: -16, ambience: -22, effect: -18 };

/**
 * Every sound in the kit: where it goes, how it is made and how loud it is.
 * Names follow the film-cue style of the owner's own library: "Title -
 * description (how to use it)".
 */
export const SOUNDS = [
  { file: "Music/Tavern Warmth - lute-like plucks, gentle (loops well).wav", make: tavernWarmth, kind: "music" },
  { file: "Music/Tense Crossing - low pulse, builds.wav", make: tenseCrossing, kind: "music" },
  { file: "Music/Heroic Sting - short rise, don't loop.wav", make: heroicSting, kind: "music" },
  { file: "Music/Melancholy Drift - pad, fades.wav", make: melancholyDrift, kind: "music" },
  { file: "Ambience/Rain and Wind - steady rain, soft gusts (loops well).wav", make: rainAndWind, kind: "ambience" },
  { file: "Ambience/Hearth Fire - crackle and low roar (loops well).wav", make: hearthFire, kind: "ambience" },
  { file: "Effects/Sword Clash - steel on steel.wav", make: swordClash, kind: "effect" },
  { file: "Effects/Door Knock - three knocks on wood.wav", make: doorKnock, kind: "effect" },
  { file: "Effects/Magic Chime - rising sparkle.wav", make: magicChime, kind: "effect" },
  { file: "Effects/Thunder - near crack, long rumble.wav", make: thunder, kind: "effect" },
  { file: "Effects/Coin Pouch - coins jingle.wav", make: coinPouch, kind: "effect" },
];

/** Effects copied next to the local web page, under the short names its buttons use. */
export const SOUNDBOARD_COPIES = {
  "Local soundboard/sounds/sword-clash.wav": "Effects/Sword Clash - steel on steel.wav",
  "Local soundboard/sounds/door-knock.wav": "Effects/Door Knock - three knocks on wood.wav",
  "Local soundboard/sounds/magic-chime.wav": "Effects/Magic Chime - rising sparkle.wav",
};

/** Text files for Windows Notepad: Windows line endings. */
function windowsText(text) {
  return Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8");
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8")).version;
}

/**
 * Make every file of the kit in memory.
 * @returns {Map<string, Buffer>} kit-relative path ("/" separators) to contents, in a fixed order.
 */
export function makeKitFiles(version) {
  const files = new Map();
  const readme = fs.readFileSync(path.join(here, "files/README.txt"), "utf8").replaceAll("{{version}}", version);
  files.set("README.txt", windowsText(readme));
  for (const { file, make, kind } of SOUNDS) {
    const { channels, rate } = make();
    master(channels, rate, TARGET_LUFS[kind]);
    files.set(file, encodeWav(channels, rate));
  }
  files.set("Local soundboard/soundboard.html", fs.readFileSync(path.join(here, "files/soundboard.html")));
  files.set("Local soundboard/notes.txt", windowsText(fs.readFileSync(path.join(here, "files/notes.txt"), "utf8")));
  for (const [copy, original] of Object.entries(SOUNDBOARD_COPIES)) files.set(copy, files.get(original));
  return files;
}

/**
 * Build the kit folder and its zip.
 * @param {{ outRoot?: string, version?: string }} options outRoot defaults to the repository's out/ folder.
 * @returns {{ kitDir: string, zipPath: string, files: Map<string, Buffer> }}
 */
export function buildDemoKit({ outRoot = path.join(repository, "out"), version = readVersion() } = {}) {
  const files = makeKitFiles(version);
  const kitDir = path.join(outRoot, "demo-kit", KIT_FOLDER);
  // Only this script's own output folder is replaced.
  fs.rmSync(kitDir, { recursive: true, force: true });
  for (const [name, data] of files) {
    const target = path.join(kitDir, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  const zipPath = path.join(outRoot, "make", `Lyre-${version}-demo-kit.zip`);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const entries = [...files].map(([name, data]) => ({ name: `${KIT_FOLDER}/${name}`, data }));
  fs.writeFileSync(zipPath, createZip(entries));
  return { kitDir, zipPath, files };
}

function main(argv) {
  const outIndex = argv.indexOf("--out");
  const outRoot = outIndex >= 0 ? path.resolve(argv[outIndex + 1] ?? "") : undefined;
  if (outIndex >= 0 && !argv[outIndex + 1]) {
    console.error("Usage: node scripts/demo-kit/build.mjs [--out <folder>]");
    process.exit(2);
  }
  const started = Date.now();
  const { kitDir, zipPath, files } = buildDemoKit({ outRoot });
  for (const [name, data] of files) console.log(`${(data.length / 1024).toFixed(0).padStart(6)} KB  ${name}`);
  const size = fs.statSync(zipPath).size;
  console.log(`\nKit folder: ${kitDir}`);
  console.log(`Zip: ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

/** Run only when started as a script, not when imported by the tests. */
function startedDirectly() {
  if (!process.argv[1]) return false;
  const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
}

if (startedDirectly()) {
  main(process.argv.slice(2));
}
