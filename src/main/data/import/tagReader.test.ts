/**
 * DAT-5: what Lyre takes from a file's embedded tags. The real reader is music-metadata (ESM-only), reached through
 * createMusicMetadataTagReader; most tests feed it the shape that library returns, and the last ones run the library
 * itself on real files, loaded the way the library's process loads it.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { findBundledFfmpeg } from "../../media/bundledFfmpeg";
import { wavBytes, writeFile } from "../../media/testing/wavFiles";
import { musicMetadataTagReader } from "./musicMetadata";
import { cleanTags, cleanText, createMusicMetadataTagReader, titleFromFileName, type MusicMetadataResult } from "./tagReader";

describe("titleFromFileName (the prototype's file-name title)", () => {
  it.each([
    ["03 The Night King.flac", "The Night King"],
    ["1-07 Misty Mountains.flac", "Misty Mountains"],
    ["02 - Leaving Caladan.mp3", "Leaving Caladan"],
    ["Heroic Sting - short rise, don't loop.wav", "Heroic Sting - short rise, don't loop"],
    ["rain_on_tent.ogg", "rain on tent"],
    ["2049.flac", "2049"],
    ["noext", "noext"],
  ])("%s gives %s", (file, title) => {
    expect(titleFromFileName(file)).toBe(title);
  });
});

describe("cleanTags", () => {
  it("trims, drops control characters and empty values, and shortens what the library cannot hold", () => {
    expect(
      cleanTags({
        title: "  Wings\u0000 of Kynareth ",
        artist: "",
        album: "x".repeat(600),
        trackNumber: 7,
        durationMs: 155_432.6,
        moods: [" Calm ", ""],
        genres: ["Soundtrack"],
        comment: "Amazon.com Song ID: 1234",
      }),
    ).toEqual({
      title: "Wings of Kynareth",
      artist: null,
      album: "x".repeat(500),
      trackNumber: 7,
      discNumber: null,
      durationMs: 155_433,
      moods: ["Calm"],
      genres: ["Soundtrack"],
      comment: "Amazon.com Song ID: 1234",
    });
    expect(cleanTags({ durationMs: Number.NaN, trackNumber: -1 })).toMatchObject({ durationMs: null, trackNumber: null });
  });
});

describe("createMusicMetadataTagReader", () => {
  const result = (common: MusicMetadataResult["common"], duration?: number): MusicMetadataResult => ({ common, format: { duration } });

  it("maps title, artist, album, track and disc numbers, duration, mood, genre and comment", async () => {
    const reader = createMusicMetadataTagReader(async () =>
      result(
        {
          title: "Wings of Kynareth",
          artist: "Jeremy Soule",
          album: "The Elder Scrolls IV: Oblivion",
          track: { no: 7, of: 26 },
          disk: { no: 1, of: 1 },
          genre: ["Soundtrack", "Ambient"],
          mood: "Peaceful",
          comment: [{ text: "loops well" }],
        },
        155.4,
      ),
    );
    expect(await reader.read("/m/07.flac")).toEqual({
      title: "Wings of Kynareth",
      artist: "Jeremy Soule",
      album: "The Elder Scrolls IV: Oblivion",
      trackNumber: 7,
      discNumber: 1,
      durationMs: 155_400,
      moods: ["Peaceful"],
      genres: ["Soundtrack", "Ambient"],
      comment: "loops well",
    });
  });

  it("uses the album artist when there is no artist, and reads comments as plain text in older versions", async () => {
    const reader = createMusicMetadataTagReader(async () => result({ albumartist: "Various", comment: ["first", "second"] }));
    expect(await reader.read("/m/x.mp3")).toMatchObject({ artist: "Various", title: null, comment: "first\nsecond", durationMs: null });
  });

  it("asks the library to skip pictures (covers are large and not needed) and to work out the length when no header gives it (UX review 7)", async () => {
    const calls: unknown[] = [];
    const reader = createMusicMetadataTagReader(async (file, options) => {
      calls.push([file, options]);
      return result({});
    });
    await reader.read("/m/x.flac");
    expect(calls).toEqual([["/m/x.flac", { skipCovers: true, duration: true }]]);
  });
});

describe("music-metadata itself (DAT-5)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-tags-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads a WAV file's title, artist, album and length", async () => {
    const file = writeFile(dir, "03 tavern.wav", wavBytes({ seconds: 2.5 }, { title: "Tavern Warmth", artist: "The Lute Guild", album: "Inns of the North" }));
    expect(await musicMetadataTagReader.read(file)).toMatchObject({
      title: "Tavern Warmth",
      artist: "The Lute Guild",
      album: "Inns of the North",
      durationMs: 2500,
    });
  });

  it("gives a file without tags its length and no title", async () => {
    const file = writeFile(dir, "plain.wav", wavBytes({ seconds: 1 }));
    expect(await musicMetadataTagReader.read(file)).toMatchObject({ title: null, artist: null, album: null, durationMs: 1000 });
  });

  it("finds no title or length in a file that is not audio (the import then names the track after its file)", async () => {
    const file = writeFile(dir, "notes.wav", Buffer.from("not really audio"));
    const tags = await musicMetadataTagReader.read(file).catch(() => ({ title: null as string | null, durationMs: null as number | null }));
    expect(tags).toMatchObject({ title: null, durationMs: null });
  });
});

describe("the length of an Ogg Vorbis file (UX review 7)", () => {
  const ffmpeg = findBundledFfmpeg(process.cwd());
  it.runIf(ffmpeg)("is read, though Ogg has no header naming it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-ogg-"));
    try {
      const file = path.join(dir, "rain.ogg");
      execFileSync(ffmpeg as string, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=95", "-c:a", "libvorbis", file]);
      expect(await musicMetadataTagReader.read(file)).toMatchObject({ durationMs: 95000 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cleanText drops text-direction controls (security review 12)", () => {
  it("removes bidi embeddings, overrides and isolates, which can make a name read backwards", () => {
    expect(cleanText("evil\u202Egnp.mp3")).toBe("evilgnp.mp3");
    expect(cleanText("\u2066Title\u2069 \u202A\u202B\u202C\u202D\u2067\u2068x")).toBe("Title x");
  });
});
