// Tests for the Lyre demo kit (scripts/demo-kit/build.mjs): every file is
// there, the sounds are valid WAV files at sensible levels, the zip opens and
// is small enough, and building twice gives the same bytes.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeWav, encodeWav, integratedLoudness, limit, peakDb } from "./demo-kit/audio.mjs";
import { EXTRA_FORMATS, KIT_FOLDER, SOUNDBOARD_COPIES, SOUNDS, TARGET_LUFS, buildDemoKit } from "./demo-kit/build.mjs";
import { parseFile } from "music-metadata";
import { createZip, readZip } from "./demo-kit/zip.mjs";

const MAX_ZIP_BYTES = 25_000_000;
const VERSION = "9.8.7";

/** Every file in a folder, as "/"-separated paths relative to it, sorted. */
function listFiles(folder, prefix = "") {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listFiles(path.join(folder, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

describe("demo kit build", () => {
  let first;
  let second;
  const roots = [];

  before(() => {
    for (let n = 0; n < 2; n++) roots.push(fs.mkdtempSync(path.join(os.tmpdir(), "lyre-demo-kit-test-")));
    first = buildDemoKit({ outRoot: roots[0], version: VERSION });
    second = buildDemoKit({ outRoot: roots[1], version: VERSION });
  });

  after(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  test("writes every file of the kit and the zip where the release expects them", () => {
    assert.equal(first.kitDir, path.join(roots[0], "demo-kit", KIT_FOLDER));
    assert.equal(first.zipPath, path.join(roots[0], "make", `Lyre-${VERSION}-demo-kit.zip`));
    const expected = [
      "README.txt",
      "Local soundboard/soundboard.html",
      "Local soundboard/notes.txt",
      ...SOUNDS.map((sound) => sound.file),
      ...Object.keys(SOUNDBOARD_COPIES),
      ...Object.keys(EXTRA_FORMATS),
    ].sort();
    assert.deepEqual(listFiles(first.kitDir), expected);
    for (const name of expected) {
      assert.ok(fs.statSync(path.join(first.kitDir, ...name.split("/"))).size > 0, `${name} is empty`);
    }
    assert.equal(SOUNDS.filter((s) => s.kind === "music").length, 4);
    assert.equal(SOUNDS.filter((s) => s.kind === "ambience").length, 2);
    assert.equal(SOUNDS.filter((s) => s.kind === "effect").length, 5);
  });

  test("names are safe on Windows", () => {
    for (const name of listFiles(first.kitDir)) {
      for (const part of name.split("/")) {
        assert.doesNotMatch(part, /[<>:"\\|?*]/, `${name} has a character Windows does not allow`);
        assert.doesNotMatch(part, /[. ]$/, `${name} ends in a dot or space`);
      }
    }
  });

  test("every sound is a valid WAV file of the right shape and length", () => {
    for (const { file, kind } of SOUNDS) {
      const { rate, channels, seconds } = decodeWav(fs.readFileSync(path.join(first.kitDir, file)));
      if (kind === "music") {
        assert.equal(rate, 44_100, file);
        assert.equal(channels.length, 2, `${file} is stereo`);
        assert.ok(seconds >= 30 && seconds <= 45, `${file} lasts ${seconds} s`);
      } else if (kind === "ambience") {
        assert.ok(Math.abs(seconds - 30) < 0.01, `${file} lasts ${seconds} s`);
      } else {
        assert.ok(seconds >= 0.5 && seconds <= 8, `${file} lasts ${seconds} s`);
      }
    }
  });

  test("no sound clips: every peak stays below -1 dBFS", () => {
    for (const { file } of SOUNDS) {
      const { channels } = decodeWav(fs.readFileSync(path.join(first.kitDir, file)));
      const peak = peakDb(channels);
      assert.ok(peak < -1, `${file} peaks at ${peak.toFixed(2)} dBFS`);
      assert.ok(peak > -20, `${file} is nearly silent (peak ${peak.toFixed(2)} dBFS)`);
    }
  });

  test("loudness is close to its target: music about -16 LUFS, ambience quieter", () => {
    for (const { file, kind } of SOUNDS) {
      const { channels, rate } = decodeWav(fs.readFileSync(path.join(first.kitDir, file)));
      const loudness = integratedLoudness(channels, rate);
      assert.ok(Math.abs(loudness - TARGET_LUFS[kind]) <= 1.5, `${file} is ${loudness.toFixed(1)} LUFS, target ${TARGET_LUFS[kind]}`);
    }
    assert.ok(TARGET_LUFS.music >= -17 && TARGET_LUFS.music <= -15);
    assert.ok(TARGET_LUFS.ambience < TARGET_LUFS.music);
  });

  test("sounds marked (loops well) join up: no jump where the end meets the start", () => {
    const loops = SOUNDS.filter((s) => s.file.includes("(loops well)"));
    assert.ok(loops.length >= 3);
    for (const { file } of loops) {
      const { channels } = decodeWav(fs.readFileSync(path.join(first.kitDir, file)));
      for (const channel of channels) {
        // The largest step between neighbouring samples anywhere in the file.
        let largest = 0;
        for (let i = 1; i < channel.length; i++) largest = Math.max(largest, Math.abs(channel[i] - channel[i - 1]));
        const seam = Math.abs(channel[0] - channel[channel.length - 1]);
        assert.ok(seam <= largest, `${file}: the loop point jumps by ${seam.toFixed(4)}`);
      }
    }
  });

  test("the local soundboard plays only files that are in its folder", () => {
    const html = fs.readFileSync(path.join(first.kitDir, "Local soundboard/soundboard.html"), "utf8");
    const sounds = [...html.matchAll(/data-sound="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(sounds.length, 3);
    for (const sound of sounds) assert.ok(fs.existsSync(path.join(first.kitDir, "Local soundboard", sound)), sound);
    // It loads nothing from elsewhere: a local file may not, so the page would break.
    assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)=/i);
    assert.match(html, /"\.\.\/README\.txt"/);
    assert.match(html, /"https:\/\/example\.com\/"/);
    assert.match(html, /"notes\.txt"/);
  });

  // 0.3.0: Lyre reads title, artist and album from a file's tags (DAT-5), plays AIFF through a converted copy
  // (BUG-10) and refuses a file that is not audio whatever its name (UX review 3). The kit lets Nik see all three.
  test("every sound carries title, artist and album tags that Lyre's tag reader finds", async () => {
    for (const { file } of SOUNDS) {
      const { common } = await parseFile(path.join(first.kitDir, ...file.split("/")));
      assert.equal(common.title, path.basename(file, ".wav").split(" - ")[0], file);
      assert.equal(common.artist, "Lyre demo kit", file);
      assert.equal(common.album, `Lyre demo kit: ${file.split("/")[0]}`, file);
    }
  });

  test("Extra formats holds an AIFF copy of an effect, of the same length", async () => {
    const aiff = Object.keys(EXTRA_FORMATS).find((name) => name.endsWith(".aiff"));
    const { format } = await parseFile(path.join(first.kitDir, ...aiff.split("/")));
    assert.equal(format.container, "AIFF");
    const original = decodeWav(fs.readFileSync(path.join(first.kitDir, ...EXTRA_FORMATS[aiff].split("/"))));
    assert.ok(Math.abs(format.duration - original.seconds) < 0.01, `${format.duration} s against ${original.seconds} s`);
  });

  test("Extra formats holds a text file named like an MP3, which is not audio", async () => {
    const fake = Object.keys(EXTRA_FORMATS).find((name) => name.endsWith(".mp3"));
    const text = fs.readFileSync(path.join(first.kitDir, ...fake.split("/")), "utf8");
    assert.match(text, /not a sound/);
    const parsed = await parseFile(path.join(first.kitDir, ...fake.split("/"))).catch(() => null);
    assert.ok(!parsed?.format.duration, "no audio length");
  });

  test("the README names the version and says how to use the kit, for Notepad", () => {
    const readme = fs.readFileSync(path.join(first.kitDir, "README.txt"), "utf8");
    assert.match(readme, new RegExp(`Lyre ${VERSION.replace(/\./g, "\\.")} demo kit`));
    assert.match(readme, /Music folder onto the Playlists page/);
    assert.match(readme, /Effects folder/);
    assert.match(readme, /Local soundboard\\soundboard\.html/);
    assert.match(readme, /test script/);
    assert.match(readme, /Extra formats folder/);
    assert.doesNotMatch(readme, /\{\{/);
    assert.doesNotMatch(readme, /[^\r]\n/, "Windows line endings");
  });

  test("the zip opens, holds exactly the kit's files and is under 25 MB", () => {
    const archive = fs.readFileSync(first.zipPath);
    assert.ok(archive.length < MAX_ZIP_BYTES, `zip is ${archive.length} bytes`);
    const entries = readZip(archive);
    assert.deepEqual(entries.map((e) => e.name).sort(), listFiles(first.kitDir).map((name) => `${KIT_FOLDER}/${name}`));
    for (const { name, data } of entries) {
      const onDisk = fs.readFileSync(path.join(first.kitDir, ...name.split("/").slice(1)));
      assert.ok(data.equals(onDisk), `${name} differs from the folder`);
    }
  });

  test("building twice gives byte-identical files and zip", () => {
    assert.ok(fs.readFileSync(first.zipPath).equals(fs.readFileSync(second.zipPath)), "zips differ");
    for (const name of listFiles(first.kitDir)) {
      const a = fs.readFileSync(path.join(first.kitDir, ...name.split("/")));
      const b = fs.readFileSync(path.join(second.kitDir, ...name.split("/")));
      assert.ok(a.equals(b), `${name} differs between builds`);
    }
  });
});

describe("demo kit helpers", () => {
  test("loudness meter: a -20 dBFS 1 kHz tone on both channels reads -20 LUFS", () => {
    const rate = 48_000;
    const tone = Float64Array.from({ length: rate * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / rate));
    assert.ok(Math.abs(integratedLoudness([tone, tone], rate) - -20) < 0.1);
    // Mono counts as one channel: 3 dB lower.
    assert.ok(Math.abs(integratedLoudness([tone], rate) - -23.01) < 0.1);
    assert.equal(integratedLoudness([new Float64Array(rate)], rate), -Infinity);
  });

  test("limiter holds peaks under the ceiling and leaves quiet parts alone", () => {
    const rate = 44_100;
    const signal = Float64Array.from({ length: rate }, (_, i) => 0.2 * Math.sin(i / 10));
    signal[20_000] = 1.4;
    limit([signal], rate, -1.5);
    assert.ok(peakDb([signal]) <= -1.5 + 1e-9);
    assert.ok(Math.abs(signal[5000] - 0.2 * Math.sin(500)) < 1e-12);
  });

  test("WAV files round-trip and broken headers are refused", () => {
    const left = Float64Array.from([0, 0.5, -0.5, 0.25]);
    const right = Float64Array.from([0.1, -0.1, 0.2, -0.2]);
    const wav = encodeWav([left, right], 44_100);
    const { rate, channels } = decodeWav(wav);
    assert.equal(rate, 44_100);
    assert.ok(Math.abs(channels[0][1] - 0.5) < 1e-4 && Math.abs(channels[1][3] + 0.2) < 1e-4);
    const truncated = wav.subarray(0, wav.length - 2);
    assert.throws(() => decodeWav(truncated), /Not a valid 16-bit PCM WAV file/);
  });

  test("zip round-trips stored and deflated files and refuses unsafe names", () => {
    const entries = [
      { name: "kit/a.txt", data: Buffer.from("hello hello hello hello hello") },
      { name: "kit/sub/noise.bin", data: Buffer.from([7, 200, 3]) },
      { name: "kit/empty.txt", data: Buffer.alloc(0) },
    ];
    const read = readZip(createZip(entries));
    assert.deepEqual(read.map((e) => e.name), entries.map((e) => e.name));
    read.forEach((entry, i) => assert.ok(entry.data.equals(entries[i].data)));
    for (const name of ["../evil.txt", "/abs.txt", "kit\\win.txt"]) {
      assert.throws(() => createZip([{ name, data: Buffer.alloc(1) }]), /Unsafe name/);
    }
  });
});
