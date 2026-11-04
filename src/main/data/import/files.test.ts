/**
 * EDT-6 building blocks: which files count as audio, walking folders, guessing
 * a track's kind from its folder (as the prototype does), file facts with the
 * quick checksum used to relink moved files (DAT-8).
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempFolder } from "../test/helpers";
import { conversionOf } from "../../media/formats";
import { AUDIO_EXTENSIONS, collectAudioFiles, isAudioFile } from "./audioFiles";
import { guessKind } from "./kindGuess";
import { readFileFacts, QUICK_CHECKSUM_BYTES } from "./fileFacts";
import { writeAudio } from "./testing/fixtures";

let temp: ReturnType<typeof makeTempFolder>;
beforeEach(() => {
  temp = makeTempFolder("lyre-import-");
});
afterEach(() => temp.cleanup());

describe("audio files", () => {
  it("knows the formats the prototype lists and every format the player converts", () => {
    for (const name of ["a.flac", "b.MP3", "c.wav", "d.ogg", "e.m4a", "f.aac", "g.wma", "h.aif", "i.aiff", "j.opus"]) {
      expect(isAudioFile(name), name).toBe(true);
    }
    for (const name of ["cover.jpg", "notes.txt", "desktop.ini", "album.cue", "track.flac.part", "flac"]) {
      expect(isAudioFile(name), name).toBe(false);
    }
    for (const extension of [".wma", ".asf", ".mka", ".aif", ".aiff", ".aifc", ".ape", ".wv", ".tta", ".ac3", ".mpc"]) {
      expect(conversionOf(`x${extension}`), extension).not.toBeNull();
      expect(AUDIO_EXTENSIONS, extension).toContain(extension);
    }
  });

  it("walks a folder and its subfolders, keeping audio files in a natural order and leaving hidden and system folders alone", async () => {
    const root = path.join(temp.folder, "Rings of Power");
    writeAudio(root, "10 Numenor.flac");
    writeAudio(root, "2 Khazad-dum.flac");
    writeAudio(root, "1 Galadriel.flac");
    writeAudio(root, "cover.jpg");
    writeAudio(root, "Disc 2/01 Sauron.flac");
    writeAudio(root, ".thumbnails/x.mp3");
    writeAudio(root, "$RECYCLE.BIN/deleted.mp3");
    const found = await collectAudioFiles([root]);
    expect(found.files.map((f) => path.relative(root, f.path))).toEqual([
      "1 Galadriel.flac",
      "2 Khazad-dum.flac",
      "10 Numenor.flac",
      path.join("Disc 2", "01 Sauron.flac"),
    ]);
    expect(found.files.every((f) => f.chosenFolder === root)).toBe(true);
    expect(found.problems).toEqual([]);
  });

  it("takes single files as given, says which are not audio or not there, and lists each file once", async () => {
    const a = writeAudio(temp.folder, "Effects/door.wav");
    const notes = writeAudio(temp.folder, "notes.txt");
    const missing = path.join(temp.folder, "gone.mp3");
    const found = await collectAudioFiles([a, notes, missing, path.join(temp.folder, "Effects"), a]);
    expect(found.files.map((f) => f.path)).toEqual([a]);
    expect(found.files[0].chosenFolder).toBe(path.join(temp.folder, "Effects"));
    expect(found.problems).toEqual([
      { path: notes, reason: "not an audio file Lyre can play" },
      { path: missing, reason: "not found" },
    ]);
  });

  it("does not follow links, so a folder linking to itself cannot trap the walk", async () => {
    const root = path.join(temp.folder, "Music");
    writeAudio(root, "a.mp3");
    try {
      fs.symlinkSync(root, path.join(root, "loop"), "dir");
    } catch {
      return; // creating links needs rights this machine does not give
    }
    const found = await collectAudioFiles([root]);
    expect(found.files.map((f) => path.basename(f.path))).toEqual(["a.mp3"]);
  });

  it("stops walking when cancelled", async () => {
    writeAudio(temp.folder, "a.mp3");
    const controller = new AbortController();
    controller.abort();
    await expect(collectAudioFiles([temp.folder], { signal: controller.signal })).rejects.toThrow(/cancelled/i);
  });
});

describe("guessing the kind from the folder (prototype core.js importFiles)", () => {
  it.each([
    ["H:\\Audio\\Ambience\\Rain\\rain.flac", "H:\\Audio\\Ambience", "amb"],
    ["H:\\Audio\\Atmospheres\\cave.flac", "H:\\Audio\\Atmospheres", "amb"],
    ["H:\\Audio\\Beds\\low hum.flac", "H:\\Audio\\Beds", "amb"],
    ["H:\\Audio\\Sound Effects\\Doors\\creak.wav", "H:\\Audio\\Sound Effects", "fx"],
    ["H:\\Audio\\SFX\\sword.wav", "H:\\Audio\\SFX", "fx"],
    ["H:\\Audio\\Foley\\steps.wav", "H:\\Audio\\Foley", "fx"],
    ["H:\\Audio\\Scores\\Bear McCreary\\01 Galadriel.flac", "H:\\Audio\\Scores\\Bear McCreary", "music"],
    ["H:\\Audio\\Scores\\Bedtime Stories\\01 Lullaby.flac", "H:\\Audio\\Scores\\Bedtime Stories", "music"],
    ["/home/nik/Music/Effects/door.wav", "/home/nik/Music/Effects", "fx"],
  ])("%s is %s", (file, chosen, kind) => {
    expect(guessKind(file, chosen)).toBe(kind);
  });

  it("looks only at the folders from the chosen one down, not at the folders above it", () => {
    expect(guessKind("H:\\Ambience project\\Scores\\theme.flac", "H:\\Ambience project\\Scores")).toBe("music");
    expect(guessKind("H:\\Ambience project\\Scores\\theme.flac", "H:\\Ambience project")).toBe("amb");
  });

  it("lets the nearest folder decide", () => {
    expect(guessKind("H:\\Effects\\Ambience\\wind.flac", "H:\\Effects")).toBe("amb");
  });
});

describe("file facts", () => {
  it("records size, modification time and a quick checksum of the start and end of the file", async () => {
    const big = Buffer.alloc(QUICK_CHECKSUM_BYTES * 3, 1);
    const a = writeAudio(temp.folder, "a.flac", big);
    const middleChanged = Buffer.from(big);
    middleChanged[QUICK_CHECKSUM_BYTES + 5] = 2;
    const b = writeAudio(temp.folder, "b.flac", middleChanged);
    const endChanged = Buffer.from(big);
    endChanged[big.length - 1] = 2;
    const c = writeAudio(temp.folder, "c.flac", endChanged);
    const [fa, fb, fc] = await Promise.all([a, b, c].map((file) => readFileFacts(file)));
    expect(fa).toMatchObject({ path: a, size: big.length, mtimeMs: expect.any(Number), checksum: expect.stringMatching(/^q1:[0-9a-f]{64}$/) });
    // The quick checksum reads the first and last 64 KiB only, so a 5,000-file import stays fast;
    // with the size it tells moved copies apart from different files.
    expect(fb.checksum).toBe(fa.checksum);
    expect(fc.checksum).not.toBe(fa.checksum);
    const small = await readFileFacts(writeAudio(temp.folder, "s.wav", "tiny"));
    expect(small.size).toBe(4);
  });
});
