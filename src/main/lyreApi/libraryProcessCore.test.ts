/**
 * The folders MEDIA_PREPARE may read from (libraryProcessCore.ts mediaFolders): the library folders, and the
 * folder of each file added from elsewhere, worked out in the file's own path style (security review 11).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { openLibrary } from "../data";
import { mediaFolders } from "./libraryProcessCore";

describe("mediaFolders", () => {
  it("gives a file at the top of a Windows drive the drive's root (E:\\), never the drive-relative E:", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-folders-"));
    const library = openLibrary({ folder: dir });
    try {
      library.store.changeWithoutHistory(() => {
        library.store.run("INSERT INTO tracks (id, path, file_name, created_at, updated_at) VALUES ('a', 'E:\\x.mp3', 'x.mp3', 1, 1)");
        library.store.run("INSERT INTO tracks (id, path, file_name, created_at, updated_at) VALUES ('b', 'D:\\Sfx\\Rain\\y.wav', 'y.wav', 1, 1)");
        library.store.run("INSERT INTO tracks (id, path, file_name, created_at, updated_at) VALUES ('c', '/music/z.flac', 'z.flac', 1, 1)");
      });
      expect(mediaFolders(library).sort()).toEqual(["/music", "D:\\Sfx\\Rain", "E:\\"].sort());
    } finally {
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
