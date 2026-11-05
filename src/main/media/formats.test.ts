import { describe, expect, it } from "vitest";

import { conversionOf, demuxerArgs, isLossyCodec } from "./formats";
import { AUDIO_EXTENSIONS } from "../data/import/audioFiles";

describe("formats (BUG-10): what the player plays itself and what is converted", () => {
  it("leaves every format Chromium plays as it is", () => {
    for (const name of ["a.flac", "a.mp3", "a.wav", "a.ogg", "a.oga", "a.opus", "a.m4a", "a.aac", "a.webm", "A.FLAC"]) {
      expect(conversionOf(name), name).toBeNull();
    }
  });

  it("converts WMA, checking first whether it is WMA Lossless", () => {
    expect(conversionOf("C:\\Music\\Old.WMA")).toBe("check");
  });

  it("converts formats that are always lossless to a lossless copy", () => {
    for (const name of ["a.aif", "a.aiff", "a.ape", "a.wv", "a.tta"]) {
      expect(conversionOf(name), name).toBe("lossless");
    }
  });

  it("does not try files that are not audio it knows", () => {
    expect(conversionOf("notes.txt")).toBeNull();
    expect(conversionOf("no-extension")).toBeNull();
  });

  it("knows which codecs lose detail; any other counts as lossless", () => {
    for (const codec of ["wmalossless", "flac", "alac", "ape", "wavpack", "tta", "pcm_s16le", "mystery"]) {
      expect(isLossyCodec(codec), codec).toBe(false);
    }
    for (const codec of ["wmav1", "wmav2", "wmapro", "mp3", "aac", "vorbis"]) {
      expect(isLossyCodec(codec), codec).toBe(true);
    }
  });

  it("names ffmpeg's reader from the file's extension, so ffmpeg never guesses from the content (security review 7)", () => {
    expect(demuxerArgs("C:\\Music\\Old.WMA")).toEqual(["-f", "asf"]);
    expect(demuxerArgs("/m/a.aif")).toEqual(["-f", "aiff"]);
    expect(demuxerArgs("/m/a.m4a")).toEqual(["-f", "mov"]);
    expect(demuxerArgs("/m/a.mka")).toEqual(["-f", "matroska"]);
    expect(demuxerArgs("/m/a.opus")).toEqual(["-f", "ogg"]);
    // Musepack has two readers, one per stream version; only those two are allowed.
    expect(demuxerArgs("/m/a.mpc")).toEqual(["-format_whitelist", "mpc,mpc8"]);
  });

  it("has a reader for every extension Lyre adds, and none for anything else", () => {
    for (const extension of AUDIO_EXTENSIONS) expect(demuxerArgs(`a${extension}`), extension).not.toBeNull();
    for (const name of ["a.m3u8", "a.txt", "a.ffconcat", "noextension", "a.webm"]) expect(demuxerArgs(name), name).toBeNull();
  });
});
