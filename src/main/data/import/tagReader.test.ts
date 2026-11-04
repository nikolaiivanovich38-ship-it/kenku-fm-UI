/**
 * DAT-5: what Lyre takes from a file's embedded tags. The real reader
 * (music-metadata, requested in the wave 2 report) is reached through
 * createMusicMetadataTagReader; these tests feed it the shape that library
 * returns, so wiring it in is one line.
 */
import { describe, expect, it } from "vitest";
import { cleanTags, createMusicMetadataTagReader, titleFromFileName, type MusicMetadataResult } from "./tagReader";

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

  it("asks the library to skip pictures (covers are large and not needed)", async () => {
    const calls: unknown[] = [];
    const reader = createMusicMetadataTagReader(async (file, options) => {
      calls.push([file, options]);
      return result({});
    });
    await reader.read("/m/x.flac");
    expect(calls).toEqual([["/m/x.flac", { skipCovers: true }]]);
  });
});
