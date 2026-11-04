import { describe, expect, it } from "vitest";

import { conversionOf, isLossyCodec } from "./formats";

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
});
