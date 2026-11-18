/** 0.5.2 item 14: Find missing files says why it took each file (content, name, sound), and ticks only the sure ones. */
import { describe, expect, it } from "vitest";
import { howSure, reasonWords } from "./model";

const at = (from: string, to: string) => ({ from: `H:\\Old\\${from}`, to: `E:\\New\\${to}` });

describe("howSure", () => {
  it("words each kind of match and ticks only what is sure or likely", () => {
    expect(howSure({ ...at("a.flac", "a.flac"), confidence: "sure", reasons: ["content", "name"] }, { sizeBytes: 9 })).toEqual({ words: "Same name and size", warn: false, ticked: true });
    expect(howSure({ ...at("a.flac", "b.flac"), confidence: "sure", reasons: ["content"] }, { sizeBytes: 9 })).toEqual({ words: "Same file under another name", warn: false, ticked: true });
    expect(howSure({ ...at("a.flac", "a.mp3"), confidence: "likely", reasons: ["name", "sound"] }, { sizeBytes: 9 })).toEqual({ words: "Same name, length and loudness", warn: false, ticked: true });
    expect(howSure({ ...at("a.flac", "Battle.mp3"), confidence: "name", reasons: ["sound"] }, { sizeBytes: 9 })).toEqual({ words: "Same length and loudness, another name: check it", warn: true, ticked: false });
    expect(howSure({ ...at("a.flac", "a.flac"), confidence: "name", reasons: ["name"] }, { sizeBytes: 9 })).toEqual({ words: "Same name, different size: check it", warn: true, ticked: false });
    expect(howSure({ ...at("a.flac", "a.flac"), confidence: "name", reasons: ["name"] }, { sizeBytes: null })).toEqual({ words: "Same name: check it", warn: true, ticked: false });
  });
});

describe("reasonWords", () => {
  it("says why a candidate was offered", () => {
    expect(reasonWords(["content", "name"])).toBe("same content and name");
    expect(reasonWords(["name", "sound"])).toBe("same name and length and loudness");
    expect(reasonWords(["sound"])).toBe("same length and loudness");
    expect(reasonWords([])).toBe("");
  });
});
