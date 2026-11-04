import { describe, expect, it } from "vitest";

import {
  countAudioFiles,
  getDroppedEntries,
  importDroppedEntries,
  readAllEntries,
} from "./folderImport";
import {
  entryFor,
  fakeDataTransfer,
  fakeDirectoryEntry,
  fakeFile,
  fakeFileEntry,
} from "./testing/fakeDataTransfer";

let nextId = 0;
const options = {
  getPathForFile: (file: File) => `C:\\Music\\${file.name}`,
  createId: () => `id-${nextId++}`,
};

function tracks(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => entryFor(`${prefix} ${i}.mp3`, "audio/mpeg"));
}

describe("readAllEntries (BUG-2)", () => {
  it("keeps reading until the reader returns an empty batch", async () => {
    const folder = fakeDirectoryEntry("Big", tracks("t", 250), { batchSize: 100 });
    expect(await readAllEntries(folder)).toHaveLength(250);
  });

  it("returns an empty list for an empty folder", async () => {
    expect(await readAllEntries(fakeDirectoryEntry("Empty", []))).toEqual([]);
  });
});

describe("importDroppedEntries", () => {
  it("imports 250 files across nested folders and keeps the structure (BUG-2)", async () => {
    const boss = fakeDirectoryEntry("Boss", tracks("boss", 30));
    const combat = fakeDirectoryEntry("Combat", [...tracks("fight", 120), boss]);
    const session = fakeDirectoryEntry("Session", [...tracks("ambient", 100), combat]);

    const result = await importDroppedEntries([session], options);

    expect(countAudioFiles(result.directories)).toBe(250);
    expect(Object.keys(result.directories)).toEqual([
      "/",
      "/Session",
      "/Session/Combat",
      "/Session/Combat/Boss",
    ]);
    expect(result.directories["/Session"].audioFiles).toHaveLength(100);
    expect(result.directories["/Session/Combat"].audioFiles).toHaveLength(120);
    expect(result.directories["/Session/Combat/Boss"]).toMatchObject({
      name: "Boss",
      path: "/Session/Combat/Boss",
    });
    expect(result.directories["/Session/Combat/Boss"].audioFiles).toHaveLength(30);
  });

  it("stores tracks as {id, url, title} with an encoded file URL", async () => {
    const result = await importDroppedEntries(
      [entryFor("my_song name.mp3", "audio/mpeg")],
      { ...options, createId: () => "fixed" }
    );
    expect(result.directories["/"].audioFiles).toEqual([
      { id: "fixed", url: "file://C:/Music/my_song%20name.mp3", title: "my song name" },
    ]);
  });

  it("puts loose files in the root folder", async () => {
    const result = await importDroppedEntries(
      [entryFor("a.mp3", "audio/mpeg"), entryFor("b.ogg", "audio/ogg")],
      options
    );
    expect(result.directories["/"].audioFiles).toHaveLength(2);
  });

  it("lists non-audio files as skipped but ignores system files", async () => {
    const folder = fakeDirectoryEntry("Mixed", [
      entryFor("a.mp3", "audio/mpeg"),
      entryFor("cover.jpg", "image/jpeg"),
      entryFor(".DS_Store", ""),
      entryFor("Thumbs.db", ""),
    ]);
    const result = await importDroppedEntries([folder], options);
    expect(result.skippedFiles).toEqual(["cover.jpg"]);
    expect(countAudioFiles(result.directories)).toBe(1);
  });

  it("reports unreadable folders and files and carries on", async () => {
    const result = await importDroppedEntries(
      [
        fakeDirectoryEntry("Locked", [], { failRead: true }),
        fakeFileEntry(fakeFile("gone.mp3", "audio/mpeg"), { fail: true }),
        fakeDirectoryEntry("Fine", tracks("ok", 2)),
      ],
      options
    );
    expect(result.unreadable).toEqual([
      { kind: "folder", name: "Locked", path: "/Locked" },
      { kind: "file", name: "gone.mp3", path: "/gone.mp3" },
    ]);
    expect(result.directories["/Locked"]).toBeUndefined();
    expect(result.directories["/Fine"].audioFiles).toHaveLength(2);
  });

  it("reports a file without a path on disk as unreadable", async () => {
    const result = await importDroppedEntries([entryFor("a.mp3", "audio/mpeg")], {
      getPathForFile: () => "",
    });
    expect(result.unreadable).toEqual([{ kind: "file", name: "a.mp3", path: "/a.mp3" }]);
    expect(countAudioFiles(result.directories)).toBe(0);
  });

  it("ignores missing entries", async () => {
    const result = await importDroppedEntries([null, undefined], options);
    expect(countAudioFiles(result.directories)).toBe(0);
  });
});

describe("getDroppedEntries", () => {
  it("returns file entries and skips text and links (BUG-1)", () => {
    const a = entryFor("a.mp3");
    const dataTransfer = fakeDataTransfer({ entries: [a], strings: ["https://x.test"] });
    expect(getDroppedEntries(dataTransfer as unknown as DataTransfer)).toEqual([a]);
  });

  it("handles a missing DataTransfer", () => {
    expect(getDroppedEntries(null)).toEqual([]);
  });
});
