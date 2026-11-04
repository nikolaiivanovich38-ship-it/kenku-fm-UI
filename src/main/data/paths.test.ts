import { describe, expect, it } from "vitest";
import { fileNameOf, findRoot, isAbsolutePath, joinRoot, relativeToRoot } from "./paths";

describe("paths relative to library roots", () => {
  it("stores Windows paths under a root with forward slashes, ignoring case", () => {
    expect(relativeToRoot("H:\\Audio\\Soundtracks", "h:\\audio\\soundtracks\\Witcher 3\\Silver.flac")).toBe(
      "Witcher 3/Silver.flac",
    );
    expect(relativeToRoot("H:\\Audio\\Soundtracks\\", "H:/Audio/Soundtracks/a.mp3")).toBe("a.mp3");
  });

  it("returns null for files outside the root or on another drive", () => {
    expect(relativeToRoot("H:\\Audio\\Soundtracks", "H:\\Audio\\Other\\a.mp3")).toBeNull();
    expect(relativeToRoot("H:\\Audio\\Soundtracks", "D:\\Audio\\Soundtracks\\a.mp3")).toBeNull();
    expect(relativeToRoot("H:\\Audio\\Soundtracks", "H:\\Audio\\Soundtracks")).toBeNull();
    expect(relativeToRoot("H:\\Audio\\Sound", "H:\\Audio\\Soundtracks\\a.mp3")).toBeNull();
    expect(relativeToRoot("/music", "H:\\music\\a.mp3")).toBeNull();
  });

  it("handles POSIX paths case-sensitively", () => {
    expect(relativeToRoot("/home/gm/Music", "/home/gm/Music/Tavern/a.ogg")).toBe("Tavern/a.ogg");
    expect(relativeToRoot("/home/gm/Music", "/home/gm/music/a.ogg")).toBeNull();
  });

  it("joins a root and a relative path back together", () => {
    expect(joinRoot("H:\\Audio\\Soundtracks", "Witcher 3/Silver.flac")).toBe("H:\\Audio\\Soundtracks\\Witcher 3\\Silver.flac");
    expect(joinRoot("/home/gm/Music", "Tavern/a.ogg")).toBe("/home/gm/Music/Tavern/a.ogg");
  });

  it("picks the deepest root when roots nest", () => {
    const roots = [
      { id: "all", path: "H:\\Audio" },
      { id: "ost", path: "H:\\Audio\\Soundtracks" },
    ];
    expect(findRoot(roots, "H:\\Audio\\Soundtracks\\a.mp3")).toEqual({ root: roots[1], relative: "a.mp3" });
    expect(findRoot(roots, "H:\\Audio\\Effects\\b.wav")).toEqual({ root: roots[0], relative: "Effects/b.wav" });
    expect(findRoot(roots, "C:\\b.wav")).toBeNull();
  });

  it("knows file names and absolute paths in both styles", () => {
    expect(fileNameOf("H:\\Audio\\tavern.mp3")).toBe("tavern.mp3");
    expect(fileNameOf("/x/y/tavern.mp3")).toBe("tavern.mp3");
    expect(isAbsolutePath("C:\\a.mp3")).toBe(true);
    expect(isAbsolutePath("\\\\nas\\share\\a.mp3")).toBe(true);
    expect(isAbsolutePath("/a.mp3")).toBe(true);
    expect(isAbsolutePath("a.mp3")).toBe(false);
  });
});
