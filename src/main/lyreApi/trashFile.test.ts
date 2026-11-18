/**
 * 0.5.2 item 1 (security, docs/security.md "w52-lib"): the main process sends a file to the Recycle Bin for the
 * library only when it is a full path to one audio file that is there; never a folder, a link, another kind of file,
 * or anything that is not text. Never deleted outright: only shell.trashItem.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trashAudioFile } from "./trashFile";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-trash-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (name: string, body = "x") => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};

describe("trashAudioFile", () => {
  it("sends one audio file to the bin with trashItem, and nothing else", async () => {
    const trash = vi.fn(async (_p: string) => undefined);
    const song = file("Scores/theme.flac");
    await trashAudioFile(song, trash);
    expect(trash).toHaveBeenCalledWith(song);
  });

  it.each([
    ["a relative path", () => "Scores/theme.flac"],
    ["not text", () => 42 as unknown as string],
    ["a NUL in the path", () => `${path.join(dir, "a")}\0.flac`],
    ["a folder", () => (fs.mkdirSync(path.join(dir, "Folder.flac")), path.join(dir, "Folder.flac"))],
    ["a file that is not audio", () => file("notes.txt")],
    ["a file that is not there", () => path.join(dir, "gone.flac")],
  ])("refuses %s, in plain words, without calling trashItem", async (_what, make) => {
    const trash = vi.fn(async (_p: string) => undefined);
    await expect(trashAudioFile(make(), trash)).rejects.toThrow(/./);
    expect(trash).not.toHaveBeenCalled();
  });

  it("refuses a link, even to an audio file", async () => {
    const target = file("real.flac");
    const link = path.join(dir, "link.flac");
    try {
      fs.symlinkSync(target, link);
    } catch {
      return; // Windows without the right to make links
    }
    const trash = vi.fn(async (_p: string) => undefined);
    await expect(trashAudioFile(link, trash)).rejects.toThrow(/./);
    expect(trash).not.toHaveBeenCalled();
  });

  it("passes on trashItem's failure in plain words", async () => {
    const song = file("b.mp3");
    await expect(trashAudioFile(song, async () => Promise.reject(new Error("EPERM")))).rejects.toThrow("Lyre could not move b.mp3 to the Recycle Bin.");
  });
});
