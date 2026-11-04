import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaAccess } from "./mediaAccess";

let root: string;
let library: string;
let outside: string;
let folders: string[];

const url = (p: string) => pathToFileURL(p).href;
const access = () => new MediaAccess({ libraryFolders: () => folders, windowsPaths: false });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "media-access-")));
  library = path.join(root, "Library");
  outside = path.join(root, "Private");
  fs.mkdirSync(path.join(library, "Ambience"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(library, "tavern.flac"), "12345");
  fs.writeFileSync(path.join(library, "Ambience", "rain.wma"), "123");
  fs.writeFileSync(path.join(outside, "diary.txt"), "secret");
  folders = [library];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MediaAccess (BUG-10, PLY-11): the main process prepares library files only", () => {
  it("allows a file in a library folder or its subfolders, with its real path, size and time", async () => {
    const answer = await access().check(url(path.join(library, "Ambience", "rain.wma")));
    const stat = fs.statSync(path.join(library, "Ambience", "rain.wma"));
    expect(answer).toEqual({ ok: true, path: path.join(library, "Ambience", "rain.wma"), size: 3, mtimeMs: stat.mtimeMs });
  });

  it("refuses a file outside the library folders", async () => {
    expect(await access().check(url(path.join(outside, "diary.txt")))).toEqual({
      ok: false,
      message: "Lyre only plays files from your library folders.",
    });
  });

  it("refuses a parent-folder trick and a link that leads out of the folder", async () => {
    fs.symlinkSync(path.join(outside, "diary.txt"), path.join(library, "diary.flac"));
    expect((await access().check(url(path.join(library, "diary.flac")))).ok).toBe(false);
    expect((await access().check(`${url(library)}/..%2FPrivate%2Fdiary.txt`)).ok).toBe(false);
    expect((await access().check(`${url(library)}/../Private/diary.txt`)).ok).toBe(false);
  });

  it("follows a library folder that is itself a link", async () => {
    const linked = path.join(root, "Linked");
    fs.symlinkSync(library, linked);
    folders = [linked];
    expect((await access().check(url(path.join(library, "tavern.flac")))).ok).toBe(true);
  });

  it("refuses a folder and says so for a missing file", async () => {
    expect((await access().check(url(path.join(library, "Ambience")))).ok).toBe(false);
    expect(await access().check(url(path.join(library, "gone.flac")))).toEqual({
      ok: false,
      message: "Can't find gone.flac. Check that it is still there.",
    });
  });

  it("refuses network folders, web addresses and anything that is not a file address", async () => {
    for (const address of ["file://server/share/a.flac", "file:////server/share/a.flac", "https://example.com/a.flac", "C:x.flac", ""]) {
      expect(await access().check(address), address).toEqual({ ok: false, message: "This is not a file on this computer." });
    }
  });

  it("refuses everything while there are no library folders", async () => {
    folders = [];
    expect((await access().check(url(path.join(library, "tavern.flac")))).ok).toBe(false);
  });
});
