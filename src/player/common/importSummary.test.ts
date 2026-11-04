import { describe, expect, it } from "vitest";

import { AudioFile, FolderImportResult, ROOT_PATH } from "./folderImport";
import { foldersWithAudio, summariseImport } from "./importSummary";

function audio(count: number): AudioFile[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    url: `file:///a${i}.mp3`,
    title: `A${i}`,
  }));
}

function result(
  folders: Record<string, number>,
  extra: Partial<FolderImportResult> = {}
): FolderImportResult {
  const directories: FolderImportResult["directories"] = {
    [ROOT_PATH]: { path: ROOT_PATH, name: "root", audioFiles: audio(folders[ROOT_PATH] ?? 0) },
  };
  for (const [path, count] of Object.entries(folders)) {
    if (path !== ROOT_PATH) {
      const name = path.split("/").pop() ?? path;
      directories[path] = { path, name, audioFiles: audio(count) };
    }
  }
  return { directories, skippedFiles: [], unreadable: [], ...extra };
}

describe("foldersWithAudio", () => {
  it("returns non-root folders that contain audio, in drop order", () => {
    const folders = foldersWithAudio(
      result({ "/": 2, "/Combat": 3, "/Empty": 0, "/Combat/Boss": 1 }).directories
    );
    expect(folders.map((folder) => folder.path)).toEqual(["/Combat", "/Combat/Boss"]);
  });
});

describe("summariseImport", () => {
  it.each<[string, FolderImportResult, Parameters<typeof summariseImport>[1], string, string]>([
    [
      "folders to playlists with skipped files",
      result(
        { "/Combat": 200, "/Town": 40, "/Town/Tavern": 3 },
        { skippedFiles: ["cover.jpg", "notes.txt", "a.pdf", "b.png", "c.png", "d.png", "e.png"] }
      ),
      "playlists",
      "warning",
      "Added 243 tracks to 3 playlists. Skipped 7 files that aren't audio (e.g. cover.jpg).",
    ],
    [
      "one folder to one playlist",
      result({ "/Combat": 1 }),
      "playlists",
      "success",
      "Added 1 track to 1 playlist.",
    ],
    [
      "folders to soundboards",
      result({ "/Doors": 4, "/Weather": 2 }),
      "soundboards",
      "success",
      "Added 6 sounds to 2 soundboards.",
    ],
    [
      "loose files on the playlists page",
      result({ "/": 2 }),
      "playlists",
      "info",
      "No playlists were added. To make a playlist, drop a folder of audio files here. To add single tracks, open a playlist and drop them there.",
    ],
    [
      "tracks into a playlist",
      result({ "/": 5, "/Sub": 2 }),
      "playlist",
      "success",
      "Added 7 tracks to the playlist.",
    ],
    [
      "sounds into a soundboard",
      result({ "/": 1 }),
      "soundboard",
      "success",
      "Added 1 sound to the soundboard.",
    ],
    [
      "nothing that is audio",
      result({ "/": 0 }, { skippedFiles: ["cover.jpg"] }),
      "playlist",
      "info",
      "No audio files were found, so nothing was added. Skipped 1 file that isn't audio (cover.jpg). Lyre can play MP3, WAV, OGG, OPUS, FLAC, M4A, AAC or WEBM files.",
    ],
    [
      "an unreadable folder",
      result({}, { unreadable: [{ kind: "folder", name: "Battle", path: "/Battle" }] }),
      "playlists",
      "error",
      "Couldn't read the folder 'Battle'. Try adding the files with the + button instead.",
    ],
    [
      "added some, one folder unreadable",
      result(
        { "/Town": 3 },
        {
          unreadable: [
            { kind: "folder", name: "Battle", path: "/Battle" },
            { kind: "folder", name: "Boss", path: "/Boss" },
          ],
        }
      ),
      "playlists",
      "warning",
      "Added 3 tracks to 1 playlist. Couldn't read 2 folders (e.g. 'Battle'). Try adding the files with the + button instead.",
    ],
    [
      "an unreadable file",
      result({ "/": 1 }, { unreadable: [{ kind: "file", name: "broken.mp3", path: "/broken.mp3" }] }),
      "soundboard",
      "warning",
      "Added 1 sound to the soundboard. Couldn't read the file 'broken.mp3'. Try adding the files with the + button instead.",
    ],
  ])("%s", (_, input, target, severity, message) => {
    expect(summariseImport(input, target)).toEqual({ severity, message });
  });
});
