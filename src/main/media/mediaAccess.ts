/**
 * BUG-10, PLY-11: which files the main process may convert or copy for the
 * player. The existing local-file rules apply (SEC-15, src/main/security):
 *
 * - the address must be a local file address (`checkLocalFileUrl`: no
 *   network host, no `\\server` path, no encoded separators) and a full path;
 * - the file is compared by its real path (every link and junction resolved)
 *   with the real paths of the library folders, so a link inside a library
 *   folder that leads elsewhere is refused;
 * - it must be a file, not a folder.
 *
 * The library folders are the ones the game master added to the library;
 * the host passes them in (`libraryFolders`). A mapped network drive inside
 * a library folder is allowed: the game master chose that folder.
 */
import fs from "fs";
import nodePath from "path";
import { fileURLToPath } from "url";

import { checkLocalFileUrl, isLocalFile } from "../../common/security/urlPolicy";
import { isInsideFolder } from "../security/localFiles";

export type AccessResult =
  | { ok: true; path: string; size: number; mtimeMs: number }
  | { ok: false; message: string };

type Refusal = Extract<AccessResult, { ok: false }>;

/** Whether the file may not be prepared (the project's compiler settings do not narrow on `ok`). */
export function isRefused(result: AccessResult): result is Refusal {
  return !result.ok;
}

/** The file-system calls used here; tests and the cache share Node's. */
export interface AccessFileSystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>;
}

const nodeFileSystem: AccessFileSystem = {
  realpath: (path) => fs.promises.realpath(path),
  stat: (path) => fs.promises.stat(path),
};

const NOT_A_FILE = "This is not a file on this computer.";
const OUTSIDE = "Lyre only plays files from your library folders.";

export class MediaAccess {
  private readonly libraryFolders: () => readonly string[];
  private readonly windowsPaths: boolean;
  private readonly pathApi: typeof nodePath.posix;
  private readonly fileSystem: AccessFileSystem;

  constructor(options: {
    /** The folders the game master added to the library. */
    libraryFolders: () => readonly string[];
    windowsPaths?: boolean;
    fileSystem?: AccessFileSystem;
  }) {
    this.libraryFolders = options.libraryFolders;
    this.windowsPaths = options.windowsPaths ?? process.platform === "win32";
    this.pathApi = this.windowsPaths ? nodePath.win32 : nodePath.posix;
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
  }

  async check(address: string): Promise<AccessResult> {
    const checked = checkLocalFileUrl(address);
    if (!isLocalFile(checked)) {
      return { ok: false, message: NOT_A_FILE };
    }
    let typedPath: string;
    try {
      typedPath = fileURLToPath(checked.url, { windows: this.windowsPaths });
    } catch {
      return { ok: false, message: NOT_A_FILE };
    }
    if (!this.pathApi.isAbsolute(typedPath)) {
      return { ok: false, message: NOT_A_FILE };
    }
    let realPath: string;
    try {
      realPath = await this.fileSystem.realpath(typedPath);
    } catch {
      return { ok: false, message: `Can't find ${this.pathApi.basename(typedPath)}. Check that it is still there.` };
    }
    if (!(await this.inLibrary(realPath))) {
      return { ok: false, message: OUTSIDE };
    }
    try {
      const stat = await this.fileSystem.stat(realPath);
      if (!stat.isFile()) {
        return { ok: false, message: NOT_A_FILE };
      }
      return { ok: true, path: realPath, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return { ok: false, message: `Can't find ${this.pathApi.basename(typedPath)}. Check that it is still there.` };
    }
  }

  private async inLibrary(realPath: string): Promise<boolean> {
    for (const folder of this.libraryFolders()) {
      let realFolder: string;
      try {
        realFolder = await this.fileSystem.realpath(folder);
      } catch {
        continue; // A library folder that is gone (an unplugged drive) allows nothing.
      }
      if (isInsideFolder(realPath, realFolder, this.pathApi)) {
        return true;
      }
    }
    return false;
  }
}
