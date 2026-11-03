import { afterEach, describe, expect, it } from "vitest";

import { cleanFileName, encodeFilePath, getDropURL } from "./drop";

function dataTransferWith(files: File[]): DataTransfer {
  return { files } as unknown as DataTransfer;
}

const originalPlayer = window.player;

afterEach(() => {
  window.player = originalPlayer;
});

describe("encodeFilePath", () => {
  it.each([
    ["/Users/nik/Music/Battle Theme.mp3", "file:///Users/nik/Music/Battle%20Theme.mp3"],
    ["C:\\Music\\Tavern #2.ogg", "file://C:/Music/Tavern%20%232.ogg"],
  ])("%s -> %s", (path, expected) => {
    expect(encodeFilePath(path)).toBe(expected);
  });
});

describe("cleanFileName", () => {
  it.each([
    ["battle theme.mp3", "Battle Theme"],
    ["  spaced   out .flac", "Spaced Out"],
    ["no-extension", "No Extension"],
  ])("%s -> %s", (name, expected) => {
    expect(cleanFileName(name)).toBe(expected);
  });
});

describe("getDropURL", () => {
  it("returns a file URL for the first dropped file", () => {
    window.player = {
      getPathForFile: (file: File) => `/music/${file.name}`,
    } as unknown as typeof window.player;
    expect(getDropURL(dataTransferWith([new File(["x"], "a b.mp3")]))).toBe(
      "file:///music/a%20b.mp3"
    );
  });

  it("returns undefined when nothing was dropped", () => {
    expect(getDropURL(dataTransferWith([]))).toBeUndefined();
  });

  it("returns undefined instead of throwing where window.player is missing (main window)", () => {
    window.player = undefined as unknown as typeof window.player;
    expect(getDropURL(dataTransferWith([new File(["x"], "a.mp3")]))).toBeUndefined();
  });

  it("returns undefined when there is no DataTransfer", () => {
    expect(getDropURL(null)).toBeUndefined();
  });
});
