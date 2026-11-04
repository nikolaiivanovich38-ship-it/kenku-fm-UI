import Store from "electron-store";
import { LocalFileFolders } from "./localFiles";

let folders: LocalFileFolders | null = null;

/**
 * SEC-15: the folders whose files open without asking, saved by the main
 * process in `local-files.json` in the data folder. The file is opened on
 * first use, not on import (FND-1: nothing may touch the data folder before
 * the Kenku FM carry-over).
 */
export function localFileFolders(): LocalFileFolders {
  if (!folders) {
    let store: Store<{ folders: string[] }> | null = null;
    const open = () => (store ??= new Store<{ folders: string[] }>({ name: "local-files", defaults: { folders: [] } }));
    folders = new LocalFileFolders({
      get: () => open().get("folders"),
      set: (value) => open().set("folders", value),
    });
  }
  return folders;
}
